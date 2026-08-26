from __future__ import annotations

import argparse
from collections import OrderedDict
from dataclasses import dataclass, replace
import json
import math
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
import time
from typing import Any, Protocol, Sequence
from urllib.parse import urlsplit


MODEL_ID = "intfloat/multilingual-e5-large-instruct"
MODEL_REVISION = "274baa43b0e13e37fafa6428dbc7938e62e5c439"
SEMANTIC_INSTRUCTION = "Retrieve semantically similar text"


def bounded_environment_integer(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def environment_boolean(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().casefold() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class ServiceConfig:
    host: str
    port: int
    model_id: str
    model_revision: str
    cache_directory: Path
    threads: int
    batch_size: int
    max_sequence_length: int
    max_request_bytes: int
    max_texts: int
    max_text_characters: int
    max_total_characters: int
    max_pairs: int
    embedding_cache_size: int
    local_files_only: bool


def load_config() -> ServiceConfig:
    project_root = Path(__file__).resolve().parents[2]
    default_cache = project_root / "work" / "hf-cache"
    return ServiceConfig(
        host=os.environ.get("PHRASE_EMBEDDINGS_HOST", "127.0.0.1"),
        port=bounded_environment_integer("PHRASE_EMBEDDINGS_PORT", 8093, 1, 65_535),
        model_id=os.environ.get("PHRASE_EMBEDDINGS_MODEL", MODEL_ID),
        model_revision=os.environ.get("PHRASE_EMBEDDINGS_REVISION", MODEL_REVISION),
        cache_directory=Path(os.environ.get("PHRASE_EMBEDDINGS_CACHE_DIR", str(default_cache))).resolve(),
        threads=bounded_environment_integer(
            "PHRASE_EMBEDDINGS_THREADS", max(1, min(8, os.cpu_count() or 1)), 1, 64
        ),
        batch_size=bounded_environment_integer("PHRASE_EMBEDDINGS_BATCH_SIZE", 16, 1, 256),
        max_sequence_length=bounded_environment_integer("PHRASE_EMBEDDINGS_MAX_SEQUENCE_LENGTH", 128, 16, 512),
        max_request_bytes=bounded_environment_integer(
            "PHRASE_EMBEDDINGS_MAX_REQUEST_BYTES", 16_000_000, 100_000, 128_000_000
        ),
        max_texts=bounded_environment_integer("PHRASE_EMBEDDINGS_MAX_TEXTS", 25_000, 2, 100_000),
        max_text_characters=bounded_environment_integer(
            "PHRASE_EMBEDDINGS_MAX_TEXT_CHARACTERS", 4_096, 32, 32_768
        ),
        max_total_characters=bounded_environment_integer(
            "PHRASE_EMBEDDINGS_MAX_TOTAL_CHARACTERS", 8_000_000, 10_000, 64_000_000
        ),
        max_pairs=bounded_environment_integer("PHRASE_EMBEDDINGS_MAX_PAIRS", 1_000_000, 1_000, 10_000_000),
        embedding_cache_size=bounded_environment_integer(
            "PHRASE_EMBEDDINGS_CACHE_SIZE", 25_000, 128, 100_000
        ),
        local_files_only=environment_boolean("PHRASE_EMBEDDINGS_LOCAL_FILES_ONLY"),
    )


class RequestValidationError(ValueError):
    pass


class SimilarityBackend(Protocol):
    model_id: str
    revision: str
    dimensions: int
    device: str

    def similarity(
        self,
        queries: Sequence[str],
        candidates: Sequence[str],
    ) -> tuple[list[list[float]], dict[str, Any]]:
        """Return a candidate-major cosine matrix and diagnostic metadata."""


def stable_unique(values: Sequence[str]) -> tuple[list[str], list[int]]:
    unique: list[str] = []
    positions: dict[str, int] = {}
    indices: list[int] = []
    for value in values:
        index = positions.get(value)
        if index is None:
            index = len(unique)
            positions[value] = index
            unique.append(value)
        indices.append(index)
    return unique, indices


def query_prompt(query: str) -> str:
    return f"Instruct: {SEMANTIC_INSTRUCTION}\nQuery: {query}"


class E5Backend:
    def __init__(self, config: ServiceConfig) -> None:
        try:
            import numpy as np
            import torch
            from sentence_transformers import SentenceTransformer
        except ImportError as error:
            raise RuntimeError(
                "E5 dependencies are unavailable. Install services/phrase-embeddings/requirements.txt."
            ) from error

        config.cache_directory.mkdir(parents=True, exist_ok=True)
        torch.manual_seed(42)
        torch.set_num_threads(config.threads)
        try:
            torch.set_num_interop_threads(max(1, min(2, config.threads)))
        except RuntimeError:
            pass

        self._np = np
        self._model = SentenceTransformer(
            config.model_id,
            revision=config.model_revision,
            cache_folder=str(config.cache_directory),
            device="cpu",
            local_files_only=config.local_files_only,
        )
        self._model.max_seq_length = config.max_sequence_length
        self._model.eval()
        self._model.float()
        self.model_id = config.model_id
        self.revision = self._resolved_revision()
        dimension_getter = getattr(self._model, "get_embedding_dimension", None)
        if dimension_getter is None:
            dimension_getter = self._model.get_sentence_embedding_dimension
        self.dimensions = int(dimension_getter() or 0)
        self.device = "cpu"
        self.batch_size = config.batch_size
        self.max_sequence_length = config.max_sequence_length
        self.embedding_cache_size = config.embedding_cache_size
        self._embedding_cache: OrderedDict[tuple[str, str], Any] = OrderedDict()

    def _resolved_revision(self) -> str:
        try:
            transformer = self._model[0]
            return str(getattr(transformer.auto_model.config, "_commit_hash", "") or "unknown")
        except (AttributeError, IndexError, KeyError, TypeError):
            return "unknown"

    def _encode(self, texts: Sequence[str]) -> Any:
        return self._model.encode(
            list(texts),
            batch_size=self.batch_size,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=False,
        )

    def _cached_vectors(self, texts: Sequence[str], role: str) -> tuple[Any, int, int]:
        unique_texts, text_indices = stable_unique(texts)
        vectors: list[Any | None] = [None] * len(unique_texts)
        missing_indices: list[int] = []
        cache_hits = 0
        for index, text in enumerate(unique_texts):
            key = (role, text)
            cached = self._embedding_cache.get(key)
            if cached is None:
                missing_indices.append(index)
                continue
            self._embedding_cache.move_to_end(key)
            vectors[index] = cached
            cache_hits += 1

        if missing_indices:
            missing_texts = [unique_texts[index] for index in missing_indices]
            inputs = [query_prompt(text) for text in missing_texts] if role == "query" else missing_texts
            encoded = self._encode(inputs)
            for offset, index in enumerate(missing_indices):
                # A row view would keep the complete encoded batch alive. Store
                # an independent float32 vector so LRU eviction releases memory.
                vector = encoded[offset].copy()
                key = (role, unique_texts[index])
                vectors[index] = vector
                self._embedding_cache[key] = vector
                self._embedding_cache.move_to_end(key)
                while len(self._embedding_cache) > self.embedding_cache_size:
                    self._embedding_cache.popitem(last=False)

        resolved = [vectors[index] for index in text_indices]
        if any(vector is None for vector in resolved):
            raise RuntimeError("Embedding cache failed to resolve a text vector")
        return self._np.stack(resolved), cache_hits, len(missing_indices)

    def similarity(
        self,
        queries: Sequence[str],
        candidates: Sequence[str],
    ) -> tuple[list[list[float]], dict[str, Any]]:
        query_started = time.perf_counter()
        query_vectors, query_cache_hits, query_cache_misses = self._cached_vectors(queries, "query")
        query_ms = (time.perf_counter() - query_started) * 1_000

        candidate_started = time.perf_counter()
        candidate_vectors, candidate_cache_hits, candidate_cache_misses = self._cached_vectors(
            candidates, "candidate"
        )
        candidate_ms = (time.perf_counter() - candidate_started) * 1_000

        scores = self._np.matmul(candidate_vectors, query_vectors.T)
        matrix = [[round(float(score), 8) for score in row] for row in scores]
        return matrix, {
            "unique_queries": len(set(queries)),
            "unique_candidates": len(set(candidates)),
            "query_cache_hits": query_cache_hits,
            "query_cache_misses": query_cache_misses,
            "candidate_cache_hits": candidate_cache_hits,
            "candidate_cache_misses": candidate_cache_misses,
            "embedding_cache_entries": len(self._embedding_cache),
            "embedding_cache_capacity": self.embedding_cache_size,
            "query_encode_ms": round(query_ms, 1),
            "candidate_encode_ms": round(candidate_ms, 1),
            "batch_size": self.batch_size,
            "max_sequence_length": self.max_sequence_length,
        }

    def warmup(self) -> None:
        self.similarity(["проверка смыслового сходства"], ["семантическая проверка"])


def validated_texts(value: Any, field: str, config: ServiceConfig) -> list[str]:
    if not isinstance(value, list) or not value:
        raise RequestValidationError(f"{field} must be a non-empty array of strings")
    result: list[str] = []
    for index, item in enumerate(value):
        if not isinstance(item, str):
            raise RequestValidationError(f"{field}[{index}] must be a string")
        text = item.strip()
        if not text:
            raise RequestValidationError(f"{field}[{index}] must not be empty")
        if len(text) > config.max_text_characters:
            raise RequestValidationError(
                f"{field}[{index}] exceeds the {config.max_text_characters} character limit"
            )
        result.append(text)
    return result


class E5Application:
    def __init__(self, backend: SimilarityBackend, config: ServiceConfig) -> None:
        self.backend = backend
        self.config = config
        self._inference_lock = Lock()

    def health(self) -> dict[str, Any]:
        return {
            "ok": True,
            "status": "ready",
            "engine": "multilingual-e5",
            "model": self.backend.model_id,
            "revision": self.backend.revision,
            "dimensions": self.backend.dimensions,
            "device": self.backend.device,
        }

    def analyze(self, payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise RequestValidationError("Request body must be a JSON object")
        queries = validated_texts(payload.get("queries"), "queries", self.config)
        candidates = validated_texts(payload.get("candidates"), "candidates", self.config)
        text_count = len(queries) + len(candidates)
        total_characters = sum(map(len, queries)) + sum(map(len, candidates))
        pair_count = len(queries) * len(candidates)
        if text_count > self.config.max_texts:
            raise RequestValidationError(f"Request exceeds the {self.config.max_texts} text limit")
        if total_characters > self.config.max_total_characters:
            raise RequestValidationError(
                f"Request exceeds the {self.config.max_total_characters} total character limit"
            )
        if pair_count > self.config.max_pairs:
            raise RequestValidationError(f"Request exceeds the {self.config.max_pairs} pair limit")

        started = time.perf_counter()
        with self._inference_lock:
            scores, backend_meta = self.backend.similarity(queries, candidates)
        analysis_ms = (time.perf_counter() - started) * 1_000
        if len(scores) != len(candidates) or any(len(row) != len(queries) for row in scores):
            raise RuntimeError("Embedding backend returned an invalid score matrix")

        normalized_scores: list[list[float]] = []
        best: list[dict[str, Any]] = []
        for row in scores:
            normalized_row: list[float] = []
            for score in row:
                number = float(score)
                if not math.isfinite(number):
                    raise RuntimeError("Embedding backend returned a non-finite score")
                normalized_row.append(round(max(-1.0, min(1.0, number)), 8))
            normalized_scores.append(normalized_row)
            query_index = max(range(len(normalized_row)), key=normalized_row.__getitem__)
            best.append({
                "query_index": query_index,
                "score": normalized_row[query_index],
            })

        return {
            "ok": True,
            "engine": "multilingual-e5",
            "model": self.backend.model_id,
            "revision": self.backend.revision,
            "dimensions": self.backend.dimensions,
            "scores": normalized_scores,
            "best": best,
            "meta": {
                **backend_meta,
                "query_count": len(queries),
                "candidate_count": len(candidates),
                "pair_count": pair_count,
                "total_characters": total_characters,
                "normalized_embeddings": True,
                "score": "cosine",
                "score_layout": "scores[candidate_index][query_index]",
                "analysis_ms": round(analysis_ms, 1),
            },
        }


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


class Handler(BaseHTTPRequestHandler):
    server_version = "BAR-E5/1.0"

    @property
    def application(self) -> E5Application:
        return self.server.application  # type: ignore[attr-defined,no-any-return]

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if urlsplit(self.path).path != "/healthz":
            self.send_json(404, {"ok": False, "error": {"code": "not_found", "message": "Not found"}})
            return
        self.send_json(200, self.application.health())

    def do_POST(self) -> None:  # noqa: N802
        if urlsplit(self.path).path.rstrip("/") != "/v1/similarity":
            self.send_json(404, {"ok": False, "error": {"code": "not_found", "message": "Not found"}})
            return
        try:
            length = int(self.headers.get("content-length") or "0")
            if length <= 0 or length > self.application.config.max_request_bytes:
                raise RequestValidationError("Request body is empty or too large")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            self.send_json(200, self.application.analyze(payload))
        except (RequestValidationError, json.JSONDecodeError, UnicodeDecodeError, TypeError, ValueError) as error:
            self.send_json(400, {
                "ok": False,
                "error": {"code": "invalid_request", "message": (str(error) or "Invalid request")[:1_000]},
            })
        except Exception as error:
            self.send_json(500, {
                "ok": False,
                "error": {"code": "embedding_failed", "message": (str(error) or error.__class__.__name__)[:1_000]},
            })

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}", flush=True)


def parse_arguments() -> argparse.Namespace:
    defaults = load_config()
    parser = argparse.ArgumentParser(description="BAR local multilingual E5 phrase-similarity service")
    parser.add_argument("--host", default=defaults.host)
    parser.add_argument("--port", type=int, default=defaults.port)
    parser.add_argument("--model", default=defaults.model_id)
    parser.add_argument("--revision", default=defaults.model_revision)
    parser.add_argument("--cache-directory", type=Path, default=defaults.cache_directory)
    return parser.parse_args()


def main() -> int:
    defaults = load_config()
    arguments = parse_arguments()
    config = replace(
        defaults,
        host=arguments.host,
        port=max(1, min(65_535, arguments.port)),
        model_id=arguments.model,
        model_revision=arguments.revision,
        cache_directory=arguments.cache_directory.resolve(),
    )
    backend = E5Backend(config)
    backend.warmup()
    application = E5Application(backend, config)
    server = ReusableThreadingHTTPServer((config.host, config.port), Handler)
    server.application = application  # type: ignore[attr-defined]
    print(json.dumps({
        "status": "ready",
        "engine": "multilingual-e5",
        "model": backend.model_id,
        "revision": backend.revision,
        "dimensions": backend.dimensions,
        "device": backend.device,
        "host": config.host,
        "port": config.port,
    }, ensure_ascii=False), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
