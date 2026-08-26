from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal


EngineName = Literal["spacy", "stanza"]
EntityKind = Literal["lemma", "ngram"]


@dataclass(frozen=True)
class SemanticEntity:
    id: str
    key: str
    label: str
    kind: EntityKind
    forms: tuple[str, ...] = ()
    importance: float = 0.0


@dataclass(frozen=True)
class SentenceInput:
    id: str
    text: str


@dataclass(frozen=True)
class DocumentInput:
    id: str
    name: str
    url: str
    ours: bool
    sentences: tuple[SentenceInput, ...]


@dataclass(frozen=True)
class ParsedToken:
    index: int
    text: str
    lemma: str
    upos: str
    dependency: str
    head: int
    morphology: str
    start_char: int
    end_char: int


@dataclass(frozen=True)
class ParsedSentence:
    id: str
    text: str
    document_id: str
    document_name: str
    document_url: str
    ours: bool
    tokens: tuple[ParsedToken, ...]


@dataclass(frozen=True)
class EntityMention:
    entity_id: str
    label: str
    kind: EntityKind
    token_start: int
    token_end: int
    char_start: int
    char_end: int
    head: int


@dataclass(frozen=True)
class EvidenceSpan:
    token_start: int
    token_end: int
    char_start: int
    char_end: int


@dataclass(frozen=True)
class TripletOccurrence:
    source_id: str
    source_label: str
    predicate: str
    target_id: str
    target_label: str
    negated: bool
    pattern: str
    confidence: float
    document_id: str
    document_name: str
    document_url: str
    ours: bool
    sentence_id: str
    sentence: str
    source_span: EvidenceSpan
    predicate_span: EvidenceSpan
    target_span: EvidenceSpan


@dataclass(frozen=True)
class SupportedTriplet:
    id: str
    source_id: str
    source_label: str
    predicate: str
    target_id: str
    target_label: str
    negated: bool
    support: int
    document_count: int
    own_support: int
    competitor_support: int
    confidence: float
    patterns: tuple[str, ...]
    evidence: tuple[TripletOccurrence, ...] = field(default_factory=tuple)


def dataclass_dict(value: Any) -> Any:
    if hasattr(value, "__dataclass_fields__"):
        return {key: dataclass_dict(item) for key, item in asdict(value).items()}
    if isinstance(value, dict):
        return {key: dataclass_dict(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [dataclass_dict(item) for item in value]
    return value
