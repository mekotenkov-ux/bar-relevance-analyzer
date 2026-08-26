from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


MOJIBAKE_MARKERS = ("Ð", "Ñ", "Ã", "Â", "â", "\x80", "\x82", "\x8f")


def repair_text(value: str) -> str:
    current = value
    for _ in range(3):
        if not any(marker in current for marker in MOJIBAKE_MARKERS):
            break
        try:
            candidate = current.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            break
        if candidate == current:
            break
        current = candidate
    return current


def repaired(value: Any) -> Any:
    if isinstance(value, str):
        return repair_text(value)
    if isinstance(value, list):
        return [repaired(item) for item in value]
    if isinstance(value, dict):
        return {key: repaired(item) for key, item in value.items()}
    return value


def entity_id(kind: str, key: str) -> str:
    digest = hashlib.sha1(f"{kind}\x1f{key}".encode("utf-8")).hexdigest()[:16]
    return f"{kind}-{digest}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert a BAR report into the shared spaCy/Stanza experiment input")
    parser.add_argument("report")
    parser.add_argument("output")
    parser.add_argument("--min-support", type=int, default=2)
    arguments = parser.parse_args()
    report = repaired(json.loads(Path(arguments.report).read_text(encoding="utf-8-sig")))
    snapshot = report.get("snapshot") or {}

    entities: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for row in report.get("terms") or report.get("lemmas") or []:
        key = str(row.get("key") or "").strip()
        if not key or ("lemma", key) in seen:
            continue
        seen.add(("lemma", key))
        entities.append({
            "id": entity_id("lemma", key),
            "key": key,
            "label": str(row.get("term") or row.get("label") or key),
            "kind": "lemma",
            "importance": float(row.get("importance") or 0),
            "forms": [str(value) for value in (row.get("forms") or [])[:6]],
        })
    for row in report.get("ngrams") or []:
        key = str(row.get("key") or "").strip()
        if not key or ("ngram", key) in seen:
            continue
        seen.add(("ngram", key))
        entities.append({
            "id": entity_id("ngram", key),
            "key": key,
            "label": str(row.get("phrase") or row.get("label") or key),
            "kind": "ngram",
            "importance": float(row.get("importance") or 0),
            "forms": [str(value) for value in (row.get("forms") or [])[:6]],
        })

    documents: list[dict[str, Any]] = []
    for index, document in enumerate([snapshot.get("own"), *(snapshot.get("competitors") or [])]):
        if not isinstance(document, dict):
            continue
        document_id = "own" if index == 0 else f"competitor-{index}"
        sentences = [
            {"id": f"{document_id}:{sentence.get('id') or sentence_index}", "text": str(sentence.get("text") or "")}
            for sentence_index, sentence in enumerate(document.get("sentenceCorpus") or [])
            if isinstance(sentence, dict) and str(sentence.get("text") or "").strip()
        ]
        documents.append({
            "id": document_id,
            "name": str(document.get("name") or document_id),
            "url": str(document.get("url") or ""),
            "ours": index == 0,
            "sentence_corpus_truncated": bool(document.get("sentenceCorpusTruncated")),
            "sentences": sentences,
        })

    payload = {
        "language": str(snapshot.get("language") or report.get("meta", {}).get("language") or "ru"),
        "min_support": max(2, arguments.min_support),
        "source": {
            "report": str(Path(arguments.report).resolve()),
            "snapshot_version": snapshot.get("version"),
            "snapshot_id": snapshot.get("id"),
            "sentence_corpus_truncated": any(document.get("sentence_corpus_truncated") for document in documents),
        },
        "entities": entities,
        "documents": documents,
    }
    Path(arguments.output).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "entities": len(entities),
        "lemmas": sum(1 for item in entities if item["kind"] == "lemma"),
        "ngrams": sum(1 for item in entities if item["kind"] == "ngram"),
        "documents": len(documents),
        "sentences": sum(len(document["sentences"]) for document in documents),
        "sentence_corpus_truncated": payload["source"]["sentence_corpus_truncated"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
