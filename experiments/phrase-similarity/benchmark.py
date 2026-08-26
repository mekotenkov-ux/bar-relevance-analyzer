#!/usr/bin/env python3
"""Offline benchmark for BAR phrase-similarity experiments.

The script is intentionally isolated from the production analyzer.  Its smoke
mode uses only the Python standard library and never imports or downloads model
packages.  The full mode compares two local embedding models, an out-of-fold
calibrated scalar ensemble, and character n-gram baselines.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
from dataclasses import asdict, dataclass
import gc
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import sys
import time
import unicodedata
from typing import Any, Iterable, Sequence


EXPERIMENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = EXPERIMENT_DIR.parents[1]
DEFAULT_DATASET = EXPERIMENT_DIR / "fixtures" / "pairs.csv"
DEFAULT_RESULTS_DIR = EXPERIMENT_DIR / "results"
DEFAULT_CACHE_DIR = PROJECT_ROOT / "work" / "hf-cache"

HARRIER_MODEL_ID = "microsoft/harrier-oss-v1-270m"
E5_MODEL_ID = "intfloat/multilingual-e5-large-instruct"
SEMANTIC_INSTRUCTION = "Retrieve semantically similar text"
EXPECTED_PAIR_COUNT = 100


@dataclass(frozen=True)
class Pair:
    id: str
    language: str
    topic: str
    query: str
    candidate: str
    label: int
    relation: str

    @property
    def group(self) -> str:
        return f"{self.language}\x1f{self.topic}\x1f{self.query}"


@dataclass(frozen=True)
class BarPair:
    id: str
    query: str
    candidate: str
    old_similarity: float | None
    source_row: int


def stable_unique(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(values))


def normalized_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold().replace("ё", "е")
    characters = [character if character.isalnum() else " " for character in normalized]
    return " ".join("".join(characters).split())


def character_features(value: str) -> Counter[str]:
    normalized = normalized_text(value)
    if not normalized:
        return Counter()
    bounded = f" {normalized} "
    features: Counter[str] = Counter()
    for size in range(2, 5):
        for index in range(0, len(bounded) - size + 1):
            features[bounded[index:index + size]] += 1
    return features


def sparse_cosine(left: Counter[str], right: Counter[str]) -> float:
    if not left or not right:
        return 0.0
    if len(left) > len(right):
        left, right = right, left
    dot = sum(value * right.get(key, 0) for key, value in left.items())
    left_norm = math.sqrt(sum(value * value for value in left.values()))
    right_norm = math.sqrt(sum(value * value for value in right.values()))
    return dot / (left_norm * right_norm) if left_norm and right_norm else 0.0


def character_similarity(left: str, right: str) -> float:
    return max(0.0, min(1.0, sparse_cosine(character_features(left), character_features(right))))


def load_pairs(path: Path) -> list[Pair]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"id", "language", "topic", "query", "candidate", "label", "relation"}
        missing = required.difference(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Dataset is missing columns: {', '.join(sorted(missing))}")
        pairs: list[Pair] = []
        for row_number, row in enumerate(reader, start=2):
            try:
                label = int(row["label"])
            except (TypeError, ValueError) as error:
                raise ValueError(f"Row {row_number}: label must be an integer") from error
            pair = Pair(
                id=(row["id"] or "").strip(),
                language=(row["language"] or "").strip().lower(),
                topic=(row["topic"] or "").strip(),
                query=(row["query"] or "").strip(),
                candidate=(row["candidate"] or "").strip(),
                label=label,
                relation=(row["relation"] or "").strip(),
            )
            pairs.append(pair)
    validate_pairs(pairs)
    return pairs


def validate_pairs(pairs: Sequence[Pair]) -> None:
    if len(pairs) != EXPECTED_PAIR_COUNT:
        raise ValueError(f"Pilot dataset must contain exactly {EXPECTED_PAIR_COUNT} pairs, got {len(pairs)}")
    ids = [pair.id for pair in pairs]
    if len(ids) != len(set(ids)):
        raise ValueError("Pair ids must be unique")
    for pair in pairs:
        if not all((pair.id, pair.language, pair.topic, pair.query, pair.candidate, pair.relation)):
            raise ValueError(f"Pair {pair.id or '<empty>'} contains an empty required value")
        if pair.label not in {0, 1, 2, 3}:
            raise ValueError(f"Pair {pair.id}: label must be in 0..3")
    groups: dict[str, list[Pair]] = defaultdict(list)
    for pair in pairs:
        groups[pair.group].append(pair)
    if len(groups) < 5:
        raise ValueError("At least five independent query groups are required for grouped cross-validation")
    for group, rows in groups.items():
        binary = {row.label >= 2 for row in rows}
        if binary != {False, True}:
            raise ValueError(f"Query group {group!r} must contain both relevant and irrelevant candidates")
        if not any(row.label == 3 for row in rows):
            raise ValueError(f"Query group {group!r} must contain an equivalent candidate")


def optional_number(value: str) -> float | None:
    normalized = value.strip().replace("\u00a0", "").replace(" ", "")
    if not normalized:
        return None
    percent = normalized.endswith("%")
    if percent:
        normalized = normalized[:-1]
    try:
        number = float(normalized.replace(",", "."))
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    return number / 100.0 if percent else number


def load_bar_pairs(path: Path) -> tuple[list[BarPair], dict[str, Any]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=";")
        required = {"Фраза", "Лучший ключ"}
        missing = required.difference(reader.fieldnames or [])
        if missing:
            raise ValueError(f"BAR CSV is missing columns: {', '.join(sorted(missing))}")
        has_old_similarity = "Сходство с ключом" in (reader.fieldnames or [])
        pairs: list[BarPair] = []
        seen: set[tuple[str, str]] = set()
        input_rows = 0
        skipped_empty = 0
        duplicates = 0
        for row_number, row in enumerate(reader, start=2):
            input_rows += 1
            candidate = (row.get("Фраза") or "").strip()
            query = (row.get("Лучший ключ") or "").strip()
            if not candidate or not query:
                skipped_empty += 1
                continue
            identity = (normalized_text(query), normalized_text(candidate))
            if identity in seen:
                duplicates += 1
                continue
            seen.add(identity)
            pairs.append(BarPair(
                id=f"bar-{len(pairs) + 1:06d}",
                query=query,
                candidate=candidate,
                old_similarity=optional_number(row.get("Сходство с ключом") or "") if has_old_similarity else None,
                source_row=row_number,
            ))
    if not pairs:
        raise ValueError("BAR CSV does not contain any non-empty unique phrase/key pairs")
    return pairs, {
        "path": str(path),
        "delimiter": ";",
        "encoding": "UTF-8 with optional BOM",
        "input_rows": input_rows,
        "unique_pairs": len(pairs),
        "duplicate_pairs_skipped": duplicates,
        "empty_rows_skipped": skipped_empty,
        "old_similarity_column_present": has_old_similarity,
        "unique_keys": len({normalized_text(pair.query) for pair in pairs}),
    }


def package_version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def runtime_dependencies() -> tuple[Any, Any, Any, Any]:
    try:
        import numpy as np
        import psutil
        import torch
        from sentence_transformers import SentenceTransformer
    except ImportError as error:
        raise RuntimeError(
            "Benchmark dependencies are missing. Install experiments/phrase-similarity/requirements.txt first."
        ) from error
    return np, psutil, torch, SentenceTransformer


def resident_memory_mb(psutil_module: Any) -> float:
    return psutil_module.Process(os.getpid()).memory_info().rss / (1024 * 1024)


def resolved_model_revision(model: Any) -> str:
    try:
        transformer = model[0]
        config = transformer.auto_model.config
        return str(getattr(config, "_commit_hash", "") or "unknown")
    except (AttributeError, IndexError, KeyError, TypeError):
        return "unknown"


def model_scores(
    pairs: Sequence[Pair | BarPair],
    *,
    model_id: str,
    revision: str | None,
    kind: str,
    cache_folder: Path,
    batch_size: int,
    max_sequence_length: int,
    device: str,
    progress: bool,
    np: Any,
    psutil_module: Any,
    torch_module: Any,
    sentence_transformer: Any,
) -> tuple[Any, dict[str, Any]]:
    queries = stable_unique(pair.query for pair in pairs)
    candidates = stable_unique(pair.candidate for pair in pairs)
    cache_folder.mkdir(parents=True, exist_ok=True)
    memory_before = resident_memory_mb(psutil_module)
    load_started = time.perf_counter()
    kwargs: dict[str, Any] = {
        "cache_folder": str(cache_folder),
        "device": device,
    }
    if revision:
        kwargs["revision"] = revision
    model = sentence_transformer(model_id, **kwargs)
    model.max_seq_length = max_sequence_length
    model.eval()
    if device == "cpu":
        model.float()
    load_seconds = time.perf_counter() - load_started
    memory_loaded = resident_memory_mb(psutil_module)

    encode_kwargs = {
        "batch_size": batch_size,
        "convert_to_numpy": True,
        "normalize_embeddings": True,
        "show_progress_bar": progress,
    }
    query_started = time.perf_counter()
    if kind == "harrier":
        query_vectors = model.encode(queries, prompt_name="sts_query", **encode_kwargs)
    elif kind == "e5":
        instructed_queries = [f"Instruct: {SEMANTIC_INSTRUCTION}\nQuery: {query}" for query in queries]
        query_vectors = model.encode(instructed_queries, **encode_kwargs)
    else:
        raise ValueError(f"Unsupported model kind: {kind}")
    query_seconds = time.perf_counter() - query_started

    candidate_started = time.perf_counter()
    candidate_vectors = model.encode(candidates, **encode_kwargs)
    candidate_seconds = time.perf_counter() - candidate_started
    memory_encoded = resident_memory_mb(psutil_module)

    query_by_text = {query: query_vectors[index] for index, query in enumerate(queries)}
    candidate_by_text = {candidate: candidate_vectors[index] for index, candidate in enumerate(candidates)}
    scores = np.asarray([
        float(np.dot(query_by_text[pair.query], candidate_by_text[pair.candidate]))
        for pair in pairs
    ], dtype=np.float64)
    dimensions = int(query_vectors.shape[1])
    commit = resolved_model_revision(model)
    encode_seconds = query_seconds + candidate_seconds
    metadata = {
        "model_id": model_id,
        "requested_revision": revision or "main",
        "resolved_revision": commit,
        "dimensions": dimensions,
        "device": device,
        "max_sequence_length": max_sequence_length,
        "batch_size": batch_size,
        "unique_queries": len(queries),
        "unique_candidates": len(candidates),
        "load_seconds": round(load_seconds, 4),
        "query_encode_seconds": round(query_seconds, 4),
        "candidate_encode_seconds": round(candidate_seconds, 4),
        "texts_per_second": round((len(queries) + len(candidates)) / max(encode_seconds, 1e-9), 3),
        "rss_before_mb": round(memory_before, 2),
        "rss_after_load_mb": round(memory_loaded, 2),
        "rss_after_encode_mb": round(memory_encoded, 2),
        "rss_load_delta_mb": round(memory_loaded - memory_before, 2),
    }
    del query_by_text, candidate_by_text, query_vectors, candidate_vectors
    del model
    gc.collect()
    if getattr(torch_module, "cuda", None) is not None and torch_module.cuda.is_available():
        torch_module.cuda.empty_cache()
    return scores, metadata


def sigmoid(values: Any, np: Any) -> Any:
    clipped = np.clip(values, -50.0, 50.0)
    return 1.0 / (1.0 + np.exp(-clipped))


def fit_platt(scores: Any, targets: Any, np: Any) -> dict[str, float | bool]:
    from sklearn.linear_model import LogisticRegression

    mean = float(np.mean(scores))
    scale = float(np.std(scores))
    if scale < 1e-9 or len(np.unique(targets)) < 2:
        prevalence = float(np.mean(targets))
        prevalence = min(1.0 - 1e-6, max(1e-6, prevalence))
        return {
            "mean": mean,
            "scale": 1.0,
            "coefficient": 0.0,
            "intercept": math.log(prevalence / (1.0 - prevalence)),
            "constant": True,
        }
    standardized = ((scores - mean) / scale).reshape(-1, 1)
    classifier = LogisticRegression(C=1.0, solver="lbfgs", max_iter=2_000, random_state=42)
    classifier.fit(standardized, targets)
    coefficient = float(classifier.coef_[0, 0])
    intercept = float(classifier.intercept_[0])
    if coefficient < 0:
        prevalence = float(np.mean(targets))
        prevalence = min(1.0 - 1e-6, max(1e-6, prevalence))
        coefficient = 0.0
        intercept = math.log(prevalence / (1.0 - prevalence))
        constant = True
    else:
        constant = False
    return {
        "mean": mean,
        "scale": scale,
        "coefficient": coefficient,
        "intercept": intercept,
        "constant": constant,
    }


def apply_platt(parameters: dict[str, float | bool], scores: Any, np: Any) -> Any:
    standardized = (scores - float(parameters["mean"])) / float(parameters["scale"])
    logits = standardized * float(parameters["coefficient"]) + float(parameters["intercept"])
    return sigmoid(logits, np)


def grouped_calibration(
    harrier_scores: Any,
    e5_scores: Any,
    pairs: Sequence[Pair],
    requested_folds: int,
    np: Any,
) -> tuple[Any, Any, Any, list[int], dict[str, Any]]:
    from sklearn.model_selection import GroupKFold

    targets = np.asarray([int(pair.label >= 2) for pair in pairs], dtype=np.int64)
    groups = np.asarray([pair.group for pair in pairs], dtype=object)
    group_count = len(set(groups.tolist()))
    fold_count = min(max(2, requested_folds), group_count)
    splitter = GroupKFold(n_splits=fold_count)
    harrier_oof = np.zeros(len(pairs), dtype=np.float64)
    e5_oof = np.zeros(len(pairs), dtype=np.float64)
    fold_ids = [-1] * len(pairs)
    folds: list[dict[str, Any]] = []
    for fold_index, (train_indices, test_indices) in enumerate(
        splitter.split(np.arange(len(pairs)), targets, groups), start=1
    ):
        harrier_parameters = fit_platt(harrier_scores[train_indices], targets[train_indices], np)
        e5_parameters = fit_platt(e5_scores[train_indices], targets[train_indices], np)
        harrier_oof[test_indices] = apply_platt(harrier_parameters, harrier_scores[test_indices], np)
        e5_oof[test_indices] = apply_platt(e5_parameters, e5_scores[test_indices], np)
        test_groups = sorted(set(groups[test_indices].tolist()))
        for index in test_indices.tolist():
            fold_ids[index] = fold_index
        folds.append({
            "fold": fold_index,
            "train_rows": int(len(train_indices)),
            "test_rows": int(len(test_indices)),
            "test_groups": test_groups,
            "harrier": harrier_parameters,
            "e5": e5_parameters,
        })
    if any(fold < 0 for fold in fold_ids):
        raise RuntimeError("Grouped cross-validation did not score every row")
    ensemble = (harrier_oof + e5_oof) / 2.0
    calibration = {
        "method": "out-of-fold Platt scaling by complete query groups",
        "binary_target": "label >= 2",
        "fold_count": fold_count,
        "folds": folds,
        "full_fit_for_diagnostics_only": {
            "harrier": fit_platt(harrier_scores, targets, np),
            "e5": fit_platt(e5_scores, targets, np),
        },
    }
    return harrier_oof, e5_oof, ensemble, fold_ids, calibration


def average_ranks(values: Sequence[float]) -> list[float]:
    indexed = sorted(enumerate(values), key=lambda item: item[1])
    result = [0.0] * len(values)
    cursor = 0
    while cursor < len(indexed):
        end = cursor + 1
        while end < len(indexed) and indexed[end][1] == indexed[cursor][1]:
            end += 1
        average = (cursor + 1 + end) / 2.0
        for position in range(cursor, end):
            result[indexed[position][0]] = average
        cursor = end
    return result


def pearson(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right) or not left:
        return 0.0
    left_mean = sum(left) / len(left)
    right_mean = sum(right) / len(right)
    numerator = sum((a - left_mean) * (b - right_mean) for a, b in zip(left, right))
    left_norm = math.sqrt(sum((a - left_mean) ** 2 for a in left))
    right_norm = math.sqrt(sum((b - right_mean) ** 2 for b in right))
    return numerator / (left_norm * right_norm) if left_norm and right_norm else 0.0


def spearman(labels: Sequence[int], scores: Sequence[float]) -> float:
    return pearson(average_ranks([float(value) for value in labels]), average_ranks(list(scores)))


def dcg(labels: Sequence[int], cutoff: int) -> float:
    return sum((2 ** label - 1) / math.log2(index + 2) for index, label in enumerate(labels[:cutoff]))


def ranking_metrics(scores: Sequence[float], pairs: Sequence[Pair]) -> dict[str, float]:
    groups: dict[str, list[int]] = defaultdict(list)
    for index, pair in enumerate(pairs):
        groups[pair.group].append(index)
    totals: Counter[str] = Counter()
    for indices in groups.values():
        ranked = sorted(indices, key=lambda index: (-scores[index], pairs[index].candidate.casefold(), pairs[index].id))
        labels = [pairs[index].label for index in ranked]
        ideal = sorted(labels, reverse=True)
        for cutoff in (5, 10, 20):
            ideal_dcg = dcg(ideal, cutoff)
            totals[f"ndcg_at_{cutoff}"] += dcg(labels, cutoff) / ideal_dcg if ideal_dcg else 0.0
            visible = labels[:cutoff]
            denominator = max(1, len(visible))
            totals[f"precision_at_{cutoff}"] += sum(label >= 2 for label in visible) / denominator
            totals[f"hard_negative_rate_at_{cutoff}"] += sum(label <= 1 for label in visible) / denominator
        reciprocal = next((1.0 / (index + 1) for index, label in enumerate(labels) if label == 3), 0.0)
        totals["mrr_equivalent"] += reciprocal
    return {key: float(value / len(groups)) for key, value in totals.items()}


def best_threshold_metrics(scores: Any, targets: Any, np: Any) -> dict[str, float]:
    from sklearn.metrics import f1_score, matthews_corrcoef, precision_score, recall_score

    unique = np.unique(scores)
    candidates = np.concatenate(([float(unique.max()) + 1e-9], unique))
    best: tuple[float, float, float, float, float, float] | None = None
    for threshold in candidates:
        predictions = (scores >= threshold).astype(np.int64)
        mcc = float(matthews_corrcoef(targets, predictions))
        f1 = float(f1_score(targets, predictions, zero_division=0))
        recall = float(recall_score(targets, predictions, zero_division=0))
        precision = float(precision_score(targets, predictions, zero_division=0))
        candidate = (mcc, f1, recall, precision, -float(threshold), float(threshold))
        if best is None or candidate[:5] > best[:5]:
            best = candidate
    assert best is not None
    return {
        "diagnostic_threshold": best[5],
        "mcc_at_diagnostic_threshold": best[0],
        "f1_at_diagnostic_threshold": best[1],
        "recall_at_diagnostic_threshold": best[2],
        "precision_at_diagnostic_threshold": best[3],
    }


def arm_metrics(scores: Any, pairs: Sequence[Pair], np: Any) -> dict[str, float]:
    from sklearn.metrics import average_precision_score, roc_auc_score

    labels = [pair.label for pair in pairs]
    targets = np.asarray([int(label >= 2) for label in labels], dtype=np.int64)
    numeric_scores = np.asarray(scores, dtype=np.float64)
    result = {
        "spearman_label": spearman(labels, numeric_scores.tolist()),
        "pr_auc_relevant": float(average_precision_score(targets, numeric_scores)),
        "roc_auc_relevant": float(roc_auc_score(targets, numeric_scores)),
        **ranking_metrics(numeric_scores.tolist(), pairs),
        **best_threshold_metrics(numeric_scores, targets, np),
    }
    return {key: round(value, 6) for key, value in result.items()}


def ranks_within_groups(scores: Sequence[float], pairs: Sequence[Pair]) -> list[int]:
    groups: dict[str, list[int]] = defaultdict(list)
    for index, pair in enumerate(pairs):
        groups[pair.group].append(index)
    ranks = [0] * len(pairs)
    for indices in groups.values():
        ranked = sorted(indices, key=lambda index: (-scores[index], pairs[index].candidate.casefold(), pairs[index].id))
        for rank, index in enumerate(ranked, start=1):
            ranks[index] = rank
    return ranks


def percentiles_within_bar_keys(scores: Sequence[float], pairs: Sequence[BarPair]) -> list[float]:
    groups: dict[str, list[int]] = defaultdict(list)
    for index, pair in enumerate(pairs):
        groups[normalized_text(pair.query)].append(index)
    percentiles = [0.0] * len(pairs)
    for indices in groups.values():
        local_scores = [float(scores[index]) for index in indices]
        local_ranks = average_ranks(local_scores)
        if len(indices) == 1:
            percentiles[indices[0]] = 1.0
            continue
        for local_index, global_index in enumerate(indices):
            percentiles[global_index] = (local_ranks[local_index] - 1.0) / (len(indices) - 1.0)
    return percentiles


def write_bar_snapshot_csv(
    path: Path,
    pairs: Sequence[BarPair],
    harrier_scores: Sequence[float],
    e5_scores: Sequence[float],
) -> dict[str, Any]:
    harrier_percentiles = percentiles_within_bar_keys(harrier_scores, pairs)
    e5_percentiles = percentiles_within_bar_keys(e5_scores, pairs)
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "Фраза",
        "Лучший ключ",
        "Сходство с ключом (старое)",
        "Harrier cosine",
        "E5 cosine",
        "AI raw mean",
        "Harrier percentile внутри ключа",
        "E5 percentile внутри ключа",
        "AI percentile mean внутри ключа",
        "Символьное сходство 2-4",
        "Строка исходного CSV",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=fields,
            delimiter=";",
            quoting=csv.QUOTE_ALL,
            lineterminator="\n",
        )
        writer.writeheader()
        for index, pair in enumerate(pairs):
            harrier = float(harrier_scores[index])
            e5 = float(e5_scores[index])
            writer.writerow({
                "Фраза": pair.candidate,
                "Лучший ключ": pair.query,
                "Сходство с ключом (старое)": "" if pair.old_similarity is None else f"{pair.old_similarity:.8f}",
                "Harrier cosine": f"{harrier:.8f}",
                "E5 cosine": f"{e5:.8f}",
                "AI raw mean": f"{(harrier + e5) / 2.0:.8f}",
                "Harrier percentile внутри ключа": f"{harrier_percentiles[index]:.8f}",
                "E5 percentile внутри ключа": f"{e5_percentiles[index]:.8f}",
                "AI percentile mean внутри ключа": f"{(harrier_percentiles[index] + e5_percentiles[index]) / 2.0:.8f}",
                "Символьное сходство 2-4": f"{character_similarity(pair.query, pair.candidate):.8f}",
                "Строка исходного CSV": pair.source_row,
            })
    return {
        "output": str(path),
        "rows": len(pairs),
        "percentile_definition": "average ascending rank within normalized best-key group, rescaled to 0..1",
        "label_calibration_used": False,
    }


def write_detailed_csv(
    path: Path,
    pairs: Sequence[Pair],
    arms: dict[str, Any],
    fold_ids: Sequence[int],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ranks = {name: ranks_within_groups(values.tolist(), pairs) for name, values in arms.items()}
    base_fields = ["id", "language", "topic", "query", "candidate", "label", "relation", "relevant", "cv_fold"]
    score_fields = list(arms)
    rank_fields = [f"{name}_rank" for name in arms]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=[*base_fields, *score_fields, *rank_fields])
        writer.writeheader()
        for index, pair in enumerate(pairs):
            row: dict[str, Any] = {
                **asdict(pair),
                "relevant": int(pair.label >= 2),
                "cv_fold": fold_ids[index],
            }
            for name, values in arms.items():
                row[name] = f"{float(values[index]):.8f}"
                row[f"{name}_rank"] = ranks[name][index]
            writer.writerow(row)


def relation_diagnostics(arms: dict[str, Any], pairs: Sequence[Pair]) -> dict[str, Any]:
    relations: dict[str, list[int]] = defaultdict(list)
    for index, pair in enumerate(pairs):
        relations[pair.relation].append(index)
    return {
        relation: {
            "rows": len(indices),
            "mean_label": round(sum(pairs[index].label for index in indices) / len(indices), 4),
            "mean_scores": {
                name: round(sum(float(values[index]) for index in indices) / len(indices), 6)
                for name, values in arms.items()
            },
        }
        for relation, indices in sorted(relations.items())
    }


def metrics_for_subset(
    arms: dict[str, Any],
    pairs: Sequence[Pair],
    indices: Sequence[int],
    np: Any,
) -> dict[str, dict[str, float]]:
    subset_pairs = [pairs[index] for index in indices]
    return {
        name: arm_metrics(np.asarray(values, dtype=np.float64)[list(indices)], subset_pairs, np)
        for name, values in arms.items()
    }


def metrics_by_language(
    arms: dict[str, Any],
    pairs: Sequence[Pair],
    all_metrics: dict[str, dict[str, float]],
    np: Any,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "all": {
            "rows": len(pairs),
            "query_groups": len({pair.group for pair in pairs}),
            "metrics": all_metrics,
        },
    }
    for language in sorted({pair.language for pair in pairs}):
        indices = [index for index, pair in enumerate(pairs) if pair.language == language]
        result[language] = {
            "rows": len(indices),
            "query_groups": len({pairs[index].group for index in indices}),
            "metrics": metrics_for_subset(arms, pairs, indices, np),
        }
    return result


def character_trap_diagnostics(
    arms: dict[str, Any],
    pairs: Sequence[Pair],
    all_metrics: dict[str, dict[str, float]],
) -> dict[str, Any]:
    character_scores = [float(value) for value in arms["character_2_4_cosine"]]
    threshold = 0.35
    indices = [
        index for index, pair in enumerate(pairs)
        if pair.label < 2 and (pair.relation == "lexical_trap" or character_scores[index] >= threshold)
    ]
    ranks = {name: ranks_within_groups(values.tolist(), pairs) for name, values in arms.items()}
    arm_diagnostics: dict[str, Any] = {}
    for name, values in arms.items():
        selected = [float(values[index]) for index in indices]
        diagnostic_threshold = float(all_metrics[name]["diagnostic_threshold"])
        arm_diagnostics[name] = {
            "mean_score": round(sum(selected) / len(selected), 6) if selected else 0.0,
            "max_score": round(max(selected), 6) if selected else 0.0,
            "mean_rank_within_query": round(sum(ranks[name][index] for index in indices) / len(indices), 6) if indices else 0.0,
            "share_above_full_diagnostic_threshold": (
                round(sum(float(values[index]) >= diagnostic_threshold for index in indices) / len(indices), 6)
                if indices else 0.0
            ),
        }
    return {
        "definition": "binary-negative rows (label 0/1) explicitly tagged lexical_trap or with character cosine >= 0.35",
        "character_threshold": threshold,
        "rows": len(indices),
        "pairs": [
            {
                "id": pairs[index].id,
                "language": pairs[index].language,
                "query": pairs[index].query,
                "candidate": pairs[index].candidate,
                "label": pairs[index].label,
                "relation": pairs[index].relation,
                "character_score": round(character_scores[index], 6),
            }
            for index in sorted(indices, key=lambda value: (-character_scores[value], pairs[value].id))
        ],
        "arms": arm_diagnostics,
    }


def smoke_summary(
    pairs: Sequence[Pair],
    dataset: Path,
    bar_pairs: Sequence[BarPair] = (),
    bar_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    character_scores = [character_similarity(pair.query, pair.candidate) for pair in pairs]
    exact_scores = [score for score, pair in zip(character_scores, pairs) if pair.relation == "exact"]
    if not exact_scores or any(abs(score - 1.0) > 1e-12 for score in exact_scores):
        raise AssertionError("Pure character cosine must equal one for exact normalized pairs")
    if any(score < 0 or score > 1 for score in character_scores):
        raise AssertionError("Pure character cosine escaped the 0..1 interval")
    groups = Counter(pair.group for pair in pairs)
    summary: dict[str, Any] = {
        "status": "ok",
        "mode": "smoke-no-models",
        "dataset": str(dataset),
        "rows": len(pairs),
        "query_groups": len(groups),
        "rows_per_group": sorted(groups.values()),
        "languages": dict(sorted(Counter(pair.language for pair in pairs).items())),
        "labels": {str(key): value for key, value in sorted(Counter(pair.label for pair in pairs).items())},
        "relations": len(set(pair.relation for pair in pairs)),
        "exact_excluded_rows": sum(pair.relation != "exact" for pair in pairs),
        "character_trap_rows": sum(
            pair.label < 2 and (pair.relation == "lexical_trap" or score >= 0.35)
            for pair, score in zip(pairs, character_scores)
        ),
        "character_score_min": round(min(character_scores), 6),
        "character_score_max": round(max(character_scores), 6),
        "models_imported": False,
    }
    if bar_pairs:
        bar_character_scores = [character_similarity(pair.query, pair.candidate) for pair in bar_pairs]
        summary["bar_csv"] = {
            **(bar_metadata or {}),
            "character_score_min": round(min(bar_character_scores), 6),
            "character_score_max": round(max(bar_character_scores), 6),
        }
    return summary


def full_benchmark(
    arguments: argparse.Namespace,
    pairs: Sequence[Pair],
    bar_pairs: Sequence[BarPair] = (),
    bar_metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    np, psutil_module, torch_module, sentence_transformer = runtime_dependencies()
    torch_module.manual_seed(42)
    np.random.seed(42)
    torch_module.set_num_threads(arguments.threads)
    try:
        torch_module.set_num_interop_threads(max(1, min(2, arguments.threads)))
    except RuntimeError:
        pass

    started = time.perf_counter()
    scoring_pairs: list[Pair | BarPair] = [*pairs, *bar_pairs]
    harrier_all, harrier_metadata = model_scores(
        scoring_pairs,
        model_id=HARRIER_MODEL_ID,
        revision=arguments.harrier_revision,
        kind="harrier",
        cache_folder=arguments.cache_folder,
        batch_size=arguments.batch_size,
        max_sequence_length=arguments.max_sequence_length,
        device=arguments.device,
        progress=not arguments.no_progress,
        np=np,
        psutil_module=psutil_module,
        torch_module=torch_module,
        sentence_transformer=sentence_transformer,
    )
    e5_all, e5_metadata = model_scores(
        scoring_pairs,
        model_id=E5_MODEL_ID,
        revision=arguments.e5_revision,
        kind="e5",
        cache_folder=arguments.cache_folder,
        batch_size=arguments.batch_size,
        max_sequence_length=arguments.max_sequence_length,
        device=arguments.device,
        progress=not arguments.no_progress,
        np=np,
        psutil_module=psutil_module,
        torch_module=torch_module,
        sentence_transformer=sentence_transformer,
    )
    gold_rows = len(pairs)
    harrier = harrier_all[:gold_rows]
    e5 = e5_all[:gold_rows]
    bar_harrier = harrier_all[gold_rows:]
    bar_e5 = e5_all[gold_rows:]
    raw_mean = (harrier + e5) / 2.0
    harrier_calibrated, e5_calibrated, calibrated_mean, fold_ids, calibration = grouped_calibration(
        harrier, e5, pairs, arguments.folds, np
    )
    character = np.asarray([character_similarity(pair.query, pair.candidate) for pair in pairs], dtype=np.float64)
    arms = {
        "harrier_cosine": harrier,
        "e5_cosine": e5,
        "ai_raw_mean": raw_mean,
        "harrier_calibrated_oof": harrier_calibrated,
        "e5_calibrated_oof": e5_calibrated,
        "ai_calibrated_mean_oof": calibrated_mean,
        "character_2_4_cosine": character,
        "ai_char_blend_10": calibrated_mean * 0.90 + character * 0.10,
        "ai_char_blend_20": calibrated_mean * 0.80 + character * 0.20,
        "ai_char_blend_30": calibrated_mean * 0.70 + character * 0.30,
    }
    metrics = {name: arm_metrics(values, pairs, np) for name, values in arms.items()}
    exact_excluded_indices = [index for index, pair in enumerate(pairs) if pair.relation != "exact"]
    exact_excluded_metrics = metrics_for_subset(arms, pairs, exact_excluded_indices, np)
    language_metrics = metrics_by_language(arms, pairs, metrics, np)
    trap_diagnostics = character_trap_diagnostics(arms, pairs, metrics)
    winner = max(
        metrics,
        key=lambda name: (
            metrics[name]["ndcg_at_10"],
            -metrics[name]["hard_negative_rate_at_5"],
            metrics[name]["spearman_label"],
        ),
    )
    detailed_path = arguments.results_dir / "detailed.csv"
    summary_path = arguments.results_dir / "summary.json"
    write_detailed_csv(detailed_path, pairs, arms, fold_ids)
    bar_result: dict[str, Any] | None = None
    if bar_pairs:
        bar_result = write_bar_snapshot_csv(
            arguments.results_dir / "bar-snapshot.csv",
            bar_pairs,
            bar_harrier.tolist(),
            bar_e5.tolist(),
        )
    summary: dict[str, Any] = {
        "status": "ok",
        "mode": "full",
        "created_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dataset": {
            "path": str(arguments.dataset),
            "rows": len(pairs),
            "query_groups": len(set(pair.group for pair in pairs)),
            "languages": dict(sorted(Counter(pair.language for pair in pairs).items())),
            "labels": {str(key): value for key, value in sorted(Counter(pair.label for pair in pairs).items())},
        },
        "configuration": {
            "device": arguments.device,
            "threads": arguments.threads,
            "batch_size": arguments.batch_size,
            "max_sequence_length": arguments.max_sequence_length,
            "cache_folder": str(arguments.cache_folder),
            "semantic_instruction": SEMANTIC_INSTRUCTION,
            "harrier_query_prompt": "sts_query",
            "e5_query_format": "Instruct: <task>\\nQuery: <query>",
            "character_metric": "cosine over normalized character 2..4-gram count vectors",
            "char_blends": "weighted arithmetic mean with out-of-fold calibrated AI mean",
        },
        "versions": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "numpy": package_version("numpy"),
            "psutil": package_version("psutil"),
            "scikit_learn": package_version("scikit-learn"),
            "sentence_transformers": package_version("sentence-transformers"),
            "torch": package_version("torch"),
            "transformers": package_version("transformers"),
        },
        "models": {
            "harrier": harrier_metadata,
            "e5": e5_metadata,
        },
        "calibration": calibration,
        "metrics": metrics,
        "metrics_exact_excluded": {
            "definition": "all pilot rows except relation=exact; existing out-of-fold calibration is reused",
            "rows": len(exact_excluded_indices),
            "metrics": exact_excluded_metrics,
        },
        "metrics_by_language": language_metrics,
        "character_trap": trap_diagnostics,
        "winner_by_ndcg_at_10": winner,
        "relation_diagnostics": relation_diagnostics(arms, pairs),
        "elapsed_seconds": round(time.perf_counter() - started, 4),
        "outputs": {
            "detailed_csv": str(detailed_path),
            "summary_json": str(summary_path),
        },
        "notes": [
            "Raw cosine mean is diagnostic because the two models have different score distributions.",
            "Calibrated values are out-of-fold: each query group is scored by calibrators that never saw that group.",
            "The diagnostic threshold is selected on the same pilot OOF predictions and is not a production threshold.",
            "Character similarity is evaluated independently and only blended in explicitly named experimental arms.",
        ],
    }
    if bar_result is not None:
        summary["bar_csv"] = {
            **(bar_metadata or {}),
            **bar_result,
            "scoring_pool_shared_with_pilot": True,
        }
        summary["outputs"]["bar_snapshot_csv"] = bar_result["output"]
    arguments.results_dir.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary


def positive_integer(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("value must be positive")
    return number


def parse_arguments(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark Harrier, multilingual E5, ensemble, and character phrase similarity")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument(
        "--bar-csv",
        type=Path,
        default=None,
        help="optional semicolon-delimited UTF-8 BAR N-gram export with Фраза and Лучший ключ columns",
    )
    parser.add_argument("--results-dir", type=Path, default=DEFAULT_RESULTS_DIR)
    parser.add_argument("--cache-folder", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument("--batch-size", type=positive_integer, default=16)
    parser.add_argument("--max-sequence-length", type=positive_integer, default=64)
    parser.add_argument("--folds", type=positive_integer, default=5)
    parser.add_argument("--threads", type=positive_integer, default=max(1, min(8, os.cpu_count() or 1)))
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--harrier-revision", default=None)
    parser.add_argument("--e5-revision", default=None)
    parser.add_argument("--no-progress", action="store_true")
    parser.add_argument("--smoke", action="store_true", help="validate fixture and character metric without importing models")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parse_arguments(argv)
    arguments.dataset = arguments.dataset.resolve()
    arguments.results_dir = arguments.results_dir.resolve()
    arguments.cache_folder = arguments.cache_folder.resolve()
    if arguments.bar_csv is not None:
        arguments.bar_csv = arguments.bar_csv.resolve()
    try:
        pairs = load_pairs(arguments.dataset)
        bar_pairs: list[BarPair] = []
        bar_metadata: dict[str, Any] | None = None
        if arguments.bar_csv is not None:
            bar_pairs, bar_metadata = load_bar_pairs(arguments.bar_csv)
        if arguments.smoke:
            print(json.dumps(
                smoke_summary(pairs, arguments.dataset, bar_pairs, bar_metadata),
                ensure_ascii=False,
                indent=2,
            ))
            return 0
        summary = full_benchmark(arguments, pairs, bar_pairs, bar_metadata)
        print(json.dumps({
            "status": summary["status"],
            "winner_by_ndcg_at_10": summary["winner_by_ndcg_at_10"],
            "elapsed_seconds": summary["elapsed_seconds"],
            "outputs": summary["outputs"],
        }, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, RuntimeError, AssertionError) as error:
        print(f"benchmark error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
