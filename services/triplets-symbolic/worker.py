from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any

from bar_triplets_symbolic.core import extract_supported_triplets
from bar_triplets_symbolic.engines import make_engine
from bar_triplets_symbolic.io import load_payload
from bar_triplets_symbolic.schema import dataclass_dict


def relation_guard() -> int:
    try:
        configured = int(os.environ.get("TRIPLET_SPACY_MAX_RELATIONS", "25000"))
    except (TypeError, ValueError):
        configured = 25_000
    return max(1_000, min(100_000, configured))


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")
    sys.stdout.flush()


def unavailable_code(error: Exception) -> str:
    message = str(error).lower()
    if "model" in message and "not installed" in message:
        return "model_unavailable"
    if isinstance(error, (ModuleNotFoundError, ImportError)) or "is not installed" in message:
        return "dependency_unavailable"
    return "analysis_failed"


def main() -> int:
    parser = argparse.ArgumentParser(description="BAR spaCy semantic-triplet worker")
    parser.add_argument("--engine", choices=("spacy", "stanza"), default="spacy")
    parser.add_argument("--model")
    arguments = parser.parse_args()

    try:
        payload = json.load(sys.stdin)
        language, documents, entities, min_support = load_payload(payload)
        started = time.perf_counter()
        engine = make_engine(arguments.engine, language, arguments.model)
        loaded = time.perf_counter()
        relations, meta = extract_supported_triplets(engine, documents, entities, min_support)
        finished = time.perf_counter()
        maximum_relations = max(1, min(relation_guard(), int(payload.get("max_relations") or 1_000)))
        emit({
            "ok": True,
            "engine": engine.name,
            "engine_version": engine.version,
            "model": engine.model_name,
            "language": language,
            "relations": [dataclass_dict(value) for value in relations[:maximum_relations]],
            "meta": {
                **meta,
                "relations_truncated": len(relations) > maximum_relations,
                "relation_limit": maximum_relations,
                "total_relations": len(relations),
                "model_load_ms": round((loaded - started) * 1000, 1),
                "analysis_ms": round((finished - loaded) * 1000, 1),
            },
        })
        return 0
    except Exception as error:
        emit({
            "ok": False,
            "error": {
                "code": unavailable_code(error),
                "message": str(error)[:1000] or error.__class__.__name__,
            },
        })
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
