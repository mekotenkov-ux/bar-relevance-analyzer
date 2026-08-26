from __future__ import annotations

from dataclasses import replace
from collections import OrderedDict
import http.client
import json
from pathlib import Path
import sys
from threading import Thread
import unittest


SERVICE_DIRECTORY = Path(__file__).resolve().parent
sys.path.insert(0, str(SERVICE_DIRECTORY))

import server as service  # noqa: E402


class FakeBackend:
    model_id = "test/e5"
    revision = "abc123"
    dimensions = 3
    device = "cpu"

    def __init__(self) -> None:
        self.calls: list[tuple[list[str], list[str]]] = []

    def similarity(
        self,
        queries: list[str],
        candidates: list[str],
    ) -> tuple[list[list[float]], dict[str, int]]:
        self.calls.append((list(queries), list(candidates)))
        matrix = [
            [0.9 - candidate_index * 0.5 - query_index * 0.1 for query_index in range(len(queries))]
            for candidate_index in range(len(candidates))
        ]
        return matrix, {"query_cache_hits": 0, "candidate_cache_hits": 0}


def test_config(**overrides: object) -> service.ServiceConfig:
    base = service.ServiceConfig(
        host="127.0.0.1",
        port=8093,
        model_id="test/e5",
        model_revision="abc123",
        cache_directory=Path("work/test-cache"),
        threads=1,
        batch_size=4,
        max_sequence_length=64,
        max_request_bytes=100_000,
        max_texts=10,
        max_text_characters=100,
        max_total_characters=500,
        max_pairs=20,
        embedding_cache_size=128,
        local_files_only=True,
    )
    return replace(base, **overrides)


class ApplicationTests(unittest.TestCase):
    def test_query_prompt_matches_e5_retrieval_contract(self) -> None:
        self.assertEqual(
            service.query_prompt("курсы SEO"),
            "Instruct: Retrieve semantically similar text\nQuery: курсы SEO",
        )

    def test_candidate_major_matrix_and_best_query(self) -> None:
        backend = FakeBackend()
        application = service.E5Application(backend, test_config())
        result = application.analyze({
            "queries": ["  курсы SEO  ", "обучение продвижению"],
            "candidates": ["SEO обучение", "ремонт автомобиля"],
        })

        self.assertEqual(backend.calls, [
            (["курсы SEO", "обучение продвижению"], ["SEO обучение", "ремонт автомобиля"])
        ])
        self.assertEqual(result["scores"], [[0.9, 0.8], [0.4, 0.3]])
        self.assertEqual(result["best"], [
            {"query_index": 0, "score": 0.9},
            {"query_index": 0, "score": 0.4},
        ])
        self.assertEqual(result["revision"], "abc123")
        self.assertEqual(result["meta"]["score_layout"], "scores[candidate_index][query_index]")
        self.assertTrue(result["meta"]["normalized_embeddings"])

    def test_invalid_and_oversized_inputs_are_rejected(self) -> None:
        application = service.E5Application(FakeBackend(), test_config(max_pairs=2))
        with self.assertRaises(service.RequestValidationError):
            application.analyze({"queries": [], "candidates": ["x"]})
        with self.assertRaises(service.RequestValidationError):
            application.analyze({"queries": ["a", "b"], "candidates": ["x", "y"]})
        with self.assertRaises(service.RequestValidationError):
            application.analyze({"queries": ["a"], "candidates": [123]})

    def test_health_reports_loaded_model_revision(self) -> None:
        health = service.E5Application(FakeBackend(), test_config()).health()
        self.assertEqual(health, {
            "ok": True,
            "status": "ready",
            "engine": "multilingual-e5",
            "model": "test/e5",
            "revision": "abc123",
            "dimensions": 3,
            "device": "cpu",
        })


class BackendCacheTests(unittest.TestCase):
    def test_lru_separates_query_and_candidate_vectors(self) -> None:
        class FakeVector(list[float]):
            def copy(self) -> "FakeVector":
                return FakeVector(self)

        class FakeNumpy:
            @staticmethod
            def stack(vectors: list[FakeVector]) -> list[list[float]]:
                return [list(vector) for vector in vectors]

        backend = object.__new__(service.E5Backend)
        backend._np = FakeNumpy()
        backend._embedding_cache = OrderedDict()
        backend.embedding_cache_size = 2
        encoded_inputs: list[list[str]] = []

        def fake_encode(texts: list[str]) -> list[FakeVector]:
            encoded_inputs.append(list(texts))
            return [FakeVector([float(index), 1.0]) for index, _ in enumerate(texts)]

        backend._encode = fake_encode
        vectors, hits, misses = backend._cached_vectors(["курсы SEO", "курсы SEO"], "query")
        self.assertEqual((hits, misses), (0, 1))
        self.assertEqual(len(vectors), 2)
        self.assertEqual(encoded_inputs, [[service.query_prompt("курсы SEO")]])

        _, hits, misses = backend._cached_vectors(["курсы SEO"], "query")
        self.assertEqual((hits, misses), (1, 0))
        self.assertEqual(len(encoded_inputs), 1)

        _, hits, misses = backend._cached_vectors(["курсы SEO"], "candidate")
        self.assertEqual((hits, misses), (0, 1))
        self.assertEqual(encoded_inputs[-1], ["курсы SEO"])
        self.assertEqual(len(backend._embedding_cache), 2)


class HttpContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.server = service.ReusableThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
        self.server.application = service.E5Application(FakeBackend(), test_config())
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)

    def tearDown(self) -> None:
        self.connection.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def test_health_and_similarity_endpoints(self) -> None:
        self.connection.request("GET", "/healthz")
        health_response = self.connection.getresponse()
        health = json.loads(health_response.read())
        self.assertEqual(health_response.status, 200)
        self.assertEqual(health["revision"], "abc123")

        body = json.dumps({"queries": ["курсы SEO"], "candidates": ["обучение SEO"]})
        self.connection.request("POST", "/v1/similarity", body, {"content-type": "application/json"})
        response = self.connection.getresponse()
        result = json.loads(response.read())
        self.assertEqual(response.status, 200)
        self.assertEqual(result["scores"], [[0.9]])
        self.assertEqual(result["best"], [{"query_index": 0, "score": 0.9}])

    def test_invalid_json_is_a_client_error(self) -> None:
        self.connection.request("POST", "/v1/similarity", b"{", {"content-type": "application/json"})
        response = self.connection.getresponse()
        result = json.loads(response.read())
        self.assertEqual(response.status, 400)
        self.assertEqual(result["error"]["code"], "invalid_request")


if __name__ == "__main__":
    unittest.main()
