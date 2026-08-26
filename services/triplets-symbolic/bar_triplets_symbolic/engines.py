from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterable, Sequence
import os
from .schema import ParsedToken


LANGUAGE_ALIASES = {
    "ru": "ru",
    "rus": "ru",
    "russian": "ru",
    "en": "en",
    "eng": "en",
    "english": "en",
}


def normalized_language(language: str) -> str:
    value = language.strip().lower().replace("_", "-").split("-", 1)[0]
    return LANGUAGE_ALIASES.get(value, value)


def normalize_word(value: str) -> str:
    return value.casefold().replace("ё", "е").strip()


def recover_offsets(text: str, surfaces: Sequence[str]) -> list[tuple[int, int]]:
    offsets: list[tuple[int, int]] = []
    cursor = 0
    folded = text.casefold()
    for surface in surfaces:
        candidate = surface or ""
        start = text.find(candidate, cursor)
        if start < 0:
            start = folded.find(candidate.casefold(), cursor)
        if start < 0:
            start = cursor
            while start < len(text) and text[start].isspace():
                start += 1
        end = min(len(text), start + len(candidate))
        offsets.append((start, end))
        cursor = max(cursor, end)
    return offsets


class SyntaxEngine(ABC):
    name: str
    language: str
    model_name: str
    version: str

    @abstractmethod
    def parse_many(self, texts: Sequence[str]) -> list[tuple[ParsedToken, ...]]:
        raise NotImplementedError


class SpacyEngine(SyntaxEngine):
    name = "spacy"

    def __init__(self, language: str, model_name: str | None = None) -> None:
        try:
            import spacy
        except ImportError as error:
            raise RuntimeError("spaCy is not installed; install the symbolic experiment dependencies") from error

        self.language = normalized_language(language)
        self.version = spacy.__version__
        defaults = {"ru": "ru_core_news_sm", "en": "en_core_web_sm"}
        self.model_name = model_name or defaults.get(self.language, "xx_sent_ud_sm")
        try:
            self._nlp = spacy.load(self.model_name, disable=["ner"])
        except OSError as error:
            raise RuntimeError(f"spaCy model {self.model_name!r} is not installed") from error

    def parse_many(self, texts: Sequence[str]) -> list[tuple[ParsedToken, ...]]:
        parsed: list[tuple[ParsedToken, ...]] = []
        for document in self._nlp.pipe(texts, batch_size=64):
            tokens = tuple(
                ParsedToken(
                    index=token.i,
                    text=token.text,
                    lemma=normalize_word(token.lemma_ or token.text),
                    upos=(token.pos_ or "X").upper(),
                    dependency=(token.dep_ or "dep").lower(),
                    head=token.head.i,
                    morphology=str(token.morph),
                    start_char=token.idx,
                    end_char=token.idx + len(token.text),
                )
                for token in document
            )
            parsed.append(tokens)
        return parsed


class StanzaEngine(SyntaxEngine):
    name = "stanza"

    def __init__(self, language: str, model_name: str | None = None) -> None:
        try:
            import stanza
        except ImportError as error:
            raise RuntimeError("Stanza is not installed; install the symbolic experiment dependencies") from error

        self.language = normalized_language(language)
        self.version = stanza.__version__
        self.model_name = model_name or "default_fast"
        processor_packages = {
            "ru": {
                "tokenize": "syntagrus",
                "lemma": "syntagrus_nocharlm",
                "pos": "syntagrus_nocharlm",
                "depparse": "syntagrus_nocharlm",
            },
            "en": {
                "tokenize": "combined_nocharlm",
                "mwt": "combined",
                "lemma": "combined_nocharlm",
                "pos": "combined_nocharlm",
                "depparse": "combined_nocharlm",
            },
        }
        processors = processor_packages.get(self.language)
        if processors is None:
            raise RuntimeError(f"Stanza symbolic experiment has no pinned light package for {self.language!r}")
        model_dir = str(__import__("pathlib").Path(__file__).resolve().parents[1] / ".stanza-models")
        self._pipeline = stanza.Pipeline(
            lang=self.language,
            processors=processors,
            package=None,
            model_dir=model_dir,
            tokenize_no_ssplit=True,
            use_gpu=False,
            download_method=None,
            verbose=False,
        )
        self._batch_size = max(8, min(128, int(os.environ.get("BAR_STANZA_DOCUMENT_BATCH", "64"))))

    def parse_many(self, texts: Sequence[str]) -> list[tuple[ParsedToken, ...]]:
        parsed: list[tuple[ParsedToken, ...]] = []
        for start in range(0, len(texts), self._batch_size):
            batch = texts[start:start + self._batch_size]
            for text, document in zip(batch, self._pipeline.process_many(batch), strict=True):
                words = [word for sentence in document.sentences for word in sentence.words]
                offsets = recover_offsets(text, [word.text for word in words])
                tokens = tuple(
                    ParsedToken(
                        index=index,
                        text=word.text,
                        lemma=normalize_word(word.lemma or word.text),
                        upos=(word.upos or "X").upper(),
                        dependency=(word.deprel or "dep").lower(),
                        head=max(0, int(word.head or 0) - 1) if int(word.head or 0) else index,
                        morphology=word.feats or "",
                        start_char=offsets[index][0],
                        end_char=offsets[index][1],
                    )
                    for index, word in enumerate(words)
                )
                parsed.append(tokens)
        return parsed


def make_engine(name: str, language: str, model_name: str | None = None) -> SyntaxEngine:
    normalized = name.strip().lower()
    if normalized == "spacy":
        return SpacyEngine(language, model_name)
    if normalized == "stanza":
        return StanzaEngine(language, model_name)
    raise ValueError(f"Unsupported syntax engine: {name}")
