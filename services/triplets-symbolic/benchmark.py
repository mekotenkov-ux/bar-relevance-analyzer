from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def relation_key(value: dict[str, object]) -> tuple[str, str, str, bool]:
    return str(value["source_id"]), str(value["predicate"]), str(value["target_id"]), bool(value.get("negated"))


def evaluate(result: dict[str, object], fixture: dict[str, object]) -> dict[str, object]:
    if "expected_relations" not in fixture:
        return {
            "manual_review_required": True,
            "actual": len(result.get("relations", [])),
        }
    actual = {relation_key(value) for value in result.get("relations", [])}
    expected = {relation_key(value) for value in fixture.get("expected_relations", [])}
    true_positive = len(actual & expected)
    precision = true_positive / len(actual) if actual else 0.0
    recall = true_positive / len(expected) if expected else 1.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "expected": len(expected),
        "actual": len(actual),
        "true_positive": true_positive,
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "f1": round(f1, 3),
        "missing": [list(value) for value in sorted(expected - actual)],
        "unexpected": [list(value) for value in sorted(actual - expected)],
    }


def run_engine(python: str, root: Path, fixture: Path, engine: str, output: Path) -> dict[str, object]:
    environment = dict(os.environ)
    environment["PYTHONPATH"] = str(root)
    started = time.perf_counter()
    completed = subprocess.run(
        [python, str(root / "cli.py"), str(fixture), "--engine", engine, "--output", str(output)],
        cwd=root,
        env=environment,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    elapsed = time.perf_counter() - started
    if completed.returncode:
        return {
            "engine": engine,
            "status": "failed",
            "elapsed_ms": round(elapsed * 1000, 1),
            "error": completed.stderr.strip()[-4000:],
        }
    result = json.loads(output.read_text(encoding="utf-8"))
    fixture_payload = json.loads(fixture.read_text(encoding="utf-8"))
    return {
        "engine": engine,
        "status": "ready",
        "elapsed_ms": round(elapsed * 1000, 1),
        "quality": evaluate(result, fixture_payload),
        "meta": result.get("meta", {}),
        "model": result.get("model"),
        "relations": [
            {
                "source_id": relation.get("source_id"),
                "source": relation.get("source_label"),
                "predicate": relation.get("predicate"),
                "target_id": relation.get("target_id"),
                "target": relation.get("target_label"),
                "negated": relation.get("negated", False),
                "support": relation.get("support"),
                "document_count": relation.get("document_count"),
            }
            for relation in result.get("relations", [])
        ],
        "output": str(output),
    }


def relation_set(engine: dict[str, object]) -> set[tuple[str, str, str, bool]]:
    return {relation_key(value) for value in engine.get("relations", [])}


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare spaCy and Stanza on the same BAR fixture")
    parser.add_argument("--fixture", default="fixtures/seo-ru.json")
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--output-dir", default="results")
    arguments = parser.parse_args()
    root = Path(__file__).resolve().parent
    fixture = (root / arguments.fixture).resolve()
    output_dir = (root / arguments.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    engines = [
        run_engine(arguments.python, root, fixture, engine, output_dir / f"{fixture.stem}-{engine}.json")
        for engine in ("spacy", "stanza")
    ]
    summary = {
        "fixture": str(fixture),
        "minimum_support": 2,
        "engines": engines,
    }
    if len(engines) == 2 and all(item["status"] == "ready" for item in engines):
        left, right = relation_set(engines[0]), relation_set(engines[1])
        union = left | right
        summary["agreement"] = {
            "shared": len(left & right),
            "union": len(union),
            "jaccard": round(len(left & right) / len(union), 3) if union else 1.0,
            "spacy_only": [list(value) for value in sorted(left - right)],
            "stanza_only": [list(value) for value in sorted(right - left)],
        }
    destination = output_dir / f"{fixture.stem}-comparison.json"
    destination.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if all(item["status"] == "ready" for item in engines) else 1


if __name__ == "__main__":
    raise SystemExit(main())
