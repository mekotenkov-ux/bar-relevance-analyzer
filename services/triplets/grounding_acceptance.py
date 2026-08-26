from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).parent))

from grounding import known_target_reference_is_grounded  # noqa: E402


def grounded(
    *,
    target_id: str,
    supplied_label: str,
    sentence_entity_ids: tuple[str, ...] = ("entity-a", "entity-b", "entity-x"),
    sentence: str = "SEO audits improve search results and ranking signals.",
    known_label: str | None = "search result",
    known_aliases: tuple[str, ...] = ("search results", "organic outcome"),
) -> bool:
    return known_target_reference_is_grounded(
        source_id="entity-a",
        target_id=target_id,
        sentence_entity_ids=sentence_entity_ids,
        supplied_label=supplied_label,
        known_label=known_label,
        known_aliases=known_aliases,
        sentence=sentence,
        language="en",
    )


# A known B id paired with X's perfectly grounded span must not switch entities.
assert not grounded(target_id="entity-b", supplied_label="ranking signals")

# Both an inflected known label and an independently declared alias are valid.
assert grounded(target_id="entity-b", supplied_label="search results")
assert grounded(
    target_id="entity-b",
    supplied_label="organic outcomes",
    sentence="SEO audits improve organic outcomes.",
)

# Unknown ids, self-loops, and labels borrowed from a different sentence fail.
assert not grounded(
    target_id="entity-unknown",
    supplied_label="search results",
    known_label=None,
    known_aliases=(),
)
assert not grounded(
    target_id="entity-a",
    supplied_label="SEO audits",
    known_label="SEO audit",
    known_aliases=("SEO audits",),
)
assert not grounded(
    target_id="entity-b",
    supplied_label="search results",
    sentence="SEO audits support conversions.",
)
assert not grounded(
    target_id="entity-b",
    supplied_label="search results",
    sentence_entity_ids=("entity-a",),
)

print("TRIPLET_GROUNDING_ACCEPTANCE_OK")
