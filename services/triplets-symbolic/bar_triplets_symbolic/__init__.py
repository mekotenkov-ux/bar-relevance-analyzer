"""Deterministic semantic-triplet extraction for BAR experiments."""

from .core import extract_supported_triplets
from .schema import DocumentInput, SemanticEntity, SupportedTriplet

__all__ = [
    "DocumentInput",
    "SemanticEntity",
    "SupportedTriplet",
    "extract_supported_triplets",
]
