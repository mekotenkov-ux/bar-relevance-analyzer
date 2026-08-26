from __future__ import annotations

import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock, RLock
import time
from typing import Any
from urllib.parse import urlsplit

from bar_triplets_symbolic.core import extract_supported_triplets
from bar_triplets_symbolic.engines import SyntaxEngine, make_engine
from bar_triplets_symbolic.io import load_payload
from bar_triplets_symbolic.schema import dataclass_dict


def bounded_environment_integer(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


# These are integrity/emergency guards for a local service, not report limits.
# Normal analyzed pages are already bounded and sanitized by the TypeScript
# snapshot contract before they reach this endpoint.
MAX_REQUEST_BYTES = bounded_environment_integer("TRIPLET_SPACY_MAX_REQUEST_BYTES", 128_000_000, 8_000_000, 256_000_000)
MAX_RELATIONS = bounded_environment_integer("TRIPLET_SPACY_MAX_RELATIONS", 25_000, 1_000, 100_000)


def error_code(error: Exception) -> str:
    message = str(error).lower()
    if "model" in message and "not installed" in message:
        return "model_unavailable"
    if isinstance(error, (ModuleNotFoundError, ImportError)) or "is not installed" in message:
        return "dependency_unavailable"
    if isinstance(error, (ValueError, TypeError, KeyError, json.JSONDecodeError)):
        return "invalid_request"
    return "analysis_failed"


class SpacyApplication:
    def __init__(self, model: str | None = None) -> None:
        self.model = model
        self._cache_lock = RLock()
        self._engines: dict[str, tuple[SyntaxEngine, Lock]] = {}

    def engine_for(self, language: str) -> tuple[SyntaxEngine, Lock]:
        with self._cache_lock:
            cached = self._engines.get(language)
            if cached is not None:
                return cached
            engine = make_engine("spacy", language, self.model)
            result = (engine, Lock())
            self._engines[language] = result
            return result

    def analyze(self, payload: Any) -> dict[str, Any]:
        language, documents, entities, min_support = load_payload(payload)
        engine, engine_lock = self.engine_for(language)
        maximum_relations = max(1, min(MAX_RELATIONS, int(payload.get("max_relations") or 1_000)))
        started = time.perf_counter()
        with engine_lock:
            relations, meta = extract_supported_triplets(engine, documents, entities, min_support)
        finished = time.perf_counter()
        return {
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
                "analysis_ms": round((finished - started) * 1000, 1),
            },
        }


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


class Handler(BaseHTTPRequestHandler):
    server_version = "BAR-spaCy/1.0"

    @property
    def application(self) -> SpacyApplication:
        return self.server.application  # type: ignore[attr-defined,no-any-return]

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if urlsplit(self.path).path != "/healthz":
            self.send_json(404, {"ok": False, "error": {"code": "not_found", "message": "Not found"}})
            return
        self.send_json(200, {"ok": True, "status": "ready", "engine": "spacy"})

    def do_POST(self) -> None:  # noqa: N802
        if urlsplit(self.path).path.rstrip("/") != "/v1/triplets":
            self.send_json(404, {"ok": False, "error": {"code": "not_found", "message": "Not found"}})
            return
        try:
            length = int(self.headers.get("content-length") or "0")
            if length <= 0 or length > MAX_REQUEST_BYTES:
                raise ValueError("Request body is empty or too large")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            self.send_json(200, self.application.analyze(payload))
        except Exception as error:
            code = error_code(error)
            status = 400 if code == "invalid_request" else 503 if code in {"dependency_unavailable", "model_unavailable"} else 500
            self.send_json(status, {"ok": False, "error": {"code": code, "message": (str(error) or error.__class__.__name__)[:1000]}})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="BAR deterministic spaCy triplet service")
    parser.add_argument("--host", default=os.environ.get("TRIPLET_SPACY_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("TRIPLET_SPACY_PORT", "8092")))
    parser.add_argument("--model", default=os.environ.get("TRIPLET_SPACY_MODEL") or None)
    arguments = parser.parse_args()
    server = ReusableThreadingHTTPServer((arguments.host, arguments.port), Handler)
    server.application = SpacyApplication(arguments.model)  # type: ignore[attr-defined]
    print(json.dumps({"status": "ready", "engine": "spacy", "host": arguments.host, "port": arguments.port}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
