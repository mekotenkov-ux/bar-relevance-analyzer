from __future__ import annotations

import unicodedata
from collections.abc import Iterable


_LIGHT_SUFFIXES: dict[str, tuple[str, ...]] = {
    "en": (
        "ization",
        "ational",
        "fulness",
        "ousness",
        "iveness",
        "ments",
        "ment",
        "ingly",
        "edly",
        "ing",
        "ied",
        "ers",
        "er",
        "ed",
    ),
    "ru": (
        "иями",
        "ями",
        "ами",
        "ией",
        "иям",
        "иях",
        "ого",
        "ему",
        "ому",
        "ыми",
        "ими",
        "ение",
        "ения",
        "ений",
        "ие",
        "ые",
        "ое",
        "ий",
        "ый",
        "ой",
        "ем",
        "им",
        "ом",
        "ым",
        "их",
        "ых",
        "ую",
        "юю",
        "ая",
        "яя",
        "ою",
        "ею",
        "ия",
        "ья",
        "ев",
        "ов",
        "еи",
        "ии",
        "ей",
        "ам",
        "ям",
        "ах",
        "ях",
        "ы",
        "и",
        "а",
        "я",
        "у",
        "ю",
        "е",
        "о",
    ),
}


def _is_dense_script(codepoint: int) -> bool:
    return any(
        start <= codepoint <= end
        for start, end in (
            (0x3040, 0x30FF),
            (0x3400, 0x9FFF),
            (0xAC00, 0xD7AF),
            (0x0E00, 0x0EFF),
            (0x1000, 0x109F),
            (0x1780, 0x17FF),
            (0x20000, 0x323AF),
        )
    )


def _word_tokens(value: str) -> list[str]:
    tokens: list[str] = []
    current: list[str] = []
    for char in unicodedata.normalize("NFKC", value).casefold():
        category = unicodedata.category(char)
        if _is_dense_script(ord(char)):
            if current:
                tokens.append("".join(current))
                current = []
            if not char.isspace():
                tokens.append(char)
        elif char.isalnum() or category.startswith("M"):
            current.append(char)
        elif current:
            tokens.append("".join(current))
            current = []
    if current:
        tokens.append("".join(current))
    return tokens


def _light_stem(token: str, language: str | None) -> str:
    base_language = (language or "").split("-", 1)[0].casefold()
    if base_language == "en":
        if token.endswith("ies") and len(token) > 4:
            return token[:-3] + "y"
        if token.endswith(("sses", "shes", "ches", "xes", "zes")) and len(token) > 4:
            return token[:-2]
        if token.endswith("s") and not token.endswith(("ss", "us", "is")) and len(token) > 3:
            return token[:-1]
    for suffix in _LIGHT_SUFFIXES.get(base_language, ()):
        if token.endswith(suffix) and len(token) - len(suffix) >= 3:
            return token[: -len(suffix)]
    return token


def _semantic_tokens(value: str, language: str | None) -> list[str]:
    return [_light_stem(token, language) for token in _word_tokens(value)]


def _contains_sequence(haystack: list[str], needle: list[str]) -> bool:
    if not needle or len(needle) > len(haystack):
        return False
    return any(
        haystack[index : index + len(needle)] == needle
        for index in range(len(haystack) - len(needle) + 1)
    )


def known_target_reference_is_grounded(
    *,
    source_id: str,
    target_id: str,
    sentence_entity_ids: Iterable[str],
    supplied_label: str,
    known_label: str | None,
    known_aliases: Iterable[str],
    sentence: str,
    language: str | None,
) -> bool:
    """Validate an untrusted model's target id against local entity evidence."""
    if target_id == source_id or target_id not in set(sentence_entity_ids) or not known_label:
        return False
    supplied = _semantic_tokens(supplied_label, language)
    if not supplied or not _contains_sequence(_semantic_tokens(sentence, language), supplied):
        return False
    return any(
        supplied == _semantic_tokens(surface, language)
        for surface in (known_label, *known_aliases)
    )
