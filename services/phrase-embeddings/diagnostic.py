from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import sys
from typing import Any, Iterable, Sequence
import urllib.error
import urllib.request


SERVICE_DIRECTORY = Path(__file__).resolve().parent
DEFAULT_FIXTURE = SERVICE_DIRECTORY / "fixtures" / "seo-courses.csv"


def stable_unique(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(values))


def load_rows(path: Path) -> tuple[list[str], list[str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=";")
        required = {"Фраза", "Лучший ключ"}
        missing = required.difference(reader.fieldnames or [])
        if missing:
            raise ValueError(f"CSV is missing columns: {', '.join(sorted(missing))}")
        rows = [
            ((row.get("Лучший ключ") or "").strip(), (row.get("Фраза") or "").strip())
            for row in reader
        ]
    rows = [(query, candidate) for query, candidate in rows if query and candidate]
    if not rows:
        raise ValueError("CSV does not contain non-empty phrase/key rows")
    return stable_unique(query for query, _ in rows), stable_unique(candidate for _, candidate in rows)


def get_json(url: str, timeout: float) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def post_json(url: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def chunks(values: Sequence[str], size: int) -> Iterable[Sequence[str]]:
    for index in range(0, len(values), size):
        yield values[index:index + size]


def run(arguments: argparse.Namespace) -> dict[str, Any]:
    queries, candidates = load_rows(arguments.csv.resolve())
    base_url = arguments.url.rstrip("/")
    health = get_json(f"{base_url}/healthz", arguments.timeout)
    ranked: list[dict[str, Any]] = []
    request_meta: list[dict[str, Any]] = []
    for candidate_chunk in chunks(candidates, arguments.chunk_size):
        result = post_json(
            f"{base_url}/v1/similarity",
            {"queries": queries, "candidates": list(candidate_chunk)},
            arguments.timeout,
        )
        best = result.get("best")
        if not isinstance(best, list) or len(best) != len(candidate_chunk):
            raise RuntimeError("Service returned an invalid best-score array")
        request_meta.append(result.get("meta") or {})
        for candidate, match in zip(candidate_chunk, best, strict=True):
            query_index = int(match["query_index"])
            ranked.append({
                "candidate": candidate,
                "best_query": queries[query_index],
                "score": float(match["score"]),
            })
    ranked.sort(key=lambda row: (-row["score"], row["candidate"].casefold()))
    return {
        "ok": True,
        "fixture": str(arguments.csv.resolve()),
        "service": {
            "url": base_url,
            "model": health.get("model"),
            "revision": health.get("revision"),
            "dimensions": health.get("dimensions"),
            "device": health.get("device"),
        },
        "query_count": len(queries),
        "candidate_count": len(candidates),
        "requests": request_meta,
        "ranking": ranked,
    }


def positive_integer(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("value must be positive")
    return number


def parse_arguments(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a live BAR E5 phrase-similarity diagnostic")
    parser.add_argument("--url", default="http://127.0.0.1:8093")
    parser.add_argument("--csv", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--chunk-size", type=positive_integer, default=512)
    parser.add_argument("--timeout", type=float, default=900.0)
    parser.add_argument("--output", type=Path, default=None)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    arguments = parse_arguments(argv)
    try:
        result = run(arguments)
        rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        if arguments.output is not None:
            arguments.output.parent.mkdir(parents=True, exist_ok=True)
            arguments.output.write_text(rendered, encoding="utf-8")
        print(rendered, end="")
        return 0
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, urllib.error.URLError) as error:
        print(f"diagnostic error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
