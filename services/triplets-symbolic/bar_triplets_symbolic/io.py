from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .schema import DocumentInput, SemanticEntity, SentenceInput


def load_payload(payload: Any) -> tuple[str, list[DocumentInput], list[SemanticEntity], int]:
    if not isinstance(payload, dict):
        raise ValueError("Input must be a JSON object")
    language = str(payload.get("language") or "ru")
    min_support = max(2, int(payload.get("min_support") or 2))
    entities: list[SemanticEntity] = []
    for raw in payload.get("entities") or []:
        entities.append(SemanticEntity(
            id=str(raw["id"]),
            key=str(raw.get("key") or raw["id"]),
            label=str(raw.get("label") or raw["id"]),
            kind="ngram" if raw.get("kind") == "ngram" else "lemma",
            forms=tuple(str(value) for value in (raw.get("forms") or []) if str(value).strip()),
            importance=float(raw.get("importance") or 0),
        ))
    documents: list[DocumentInput] = []
    for raw in payload.get("documents") or []:
        sentences = tuple(
            SentenceInput(id=str(sentence["id"]), text=str(sentence["text"]))
            for sentence in (raw.get("sentences") or [])
            if str(sentence.get("text") or "").strip()
        )
        documents.append(DocumentInput(
            id=str(raw["id"]),
            name=str(raw.get("name") or raw["id"]),
            url=str(raw.get("url") or ""),
            ours=bool(raw.get("ours")),
            sentences=sentences,
        ))
    if not entities:
        raise ValueError("At least one semantic entity is required")
    if not documents:
        raise ValueError("At least one document is required")
    return language, documents, entities, min_support


def load_input(path: str | Path) -> tuple[str, list[DocumentInput], list[SemanticEntity], int]:
    return load_payload(json.loads(Path(path).read_text(encoding="utf-8")))
