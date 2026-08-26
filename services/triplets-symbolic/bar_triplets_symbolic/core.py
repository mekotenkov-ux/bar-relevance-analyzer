from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
import hashlib
import re

from .engines import SyntaxEngine, normalize_word
from .schema import (
    DocumentInput,
    EntityMention,
    EvidenceSpan,
    ParsedSentence,
    ParsedToken,
    SemanticEntity,
    SupportedTriplet,
    TripletOccurrence,
)


CONTENT_POS = {"ADJ", "ADV", "AUX", "NOUN", "NUM", "PROPN", "PRON", "VERB", "X"}
# Pronouns are intentionally excluded: without coreference resolution, edges
# such as "which -> changes -> profession" look grammatical but do not name a
# semantic entity from the report.
# Acronyms, product names and foreign SEO terms are frequently tagged X by
# small multilingual pipelines. They are report-controlled entities, so X is a
# deterministic recall extension rather than free-form entity discovery.
ENTITY_POS = {"NOUN", "PROPN", "X"}
PREDICATE_POS = {"VERB", "AUX"}
SUBJECT_DEPS = {"nsubj", "csubj", "nsubjpass"}
OBJECT_DEPS = {"obj", "dobj", "iobj", "pobj", "obl", "attr", "oprd"}
CLAUSAL_OBJECT_DEPS = {"xcomp", "ccomp"}
NEGATION_WORDS = {"не", "ни", "нет", "not", "no", "never", "n't"}


def dep_base(value: str) -> str:
    normalized = value.lower().replace(":", "")
    if normalized in {"nsubjpass", "auxpass"}:
        return normalized
    return value.lower().split(":", 1)[0]


def passive_subject(value: str) -> bool:
    normalized = value.lower().replace("_", ":")
    return normalized in {"nsubj:pass", "nsubjpass", "csubj:pass", "csubjpass"}


def passive_agent(value: str) -> bool:
    normalized = value.lower().replace("_", ":")
    return normalized in {"agent", "obl:agent"}


def content_tokens(tokens: Sequence[ParsedToken]) -> list[ParsedToken]:
    return [token for token in tokens if token.upos in CONTENT_POS and re.search(r"[\w\d]", token.text, re.UNICODE)]


def entity_variant_texts(entity: SemanticEntity) -> tuple[str, ...]:
    values = [entity.label, *entity.forms]
    if " " in entity.key or len(entity.key) > 2:
        values.append(entity.key)
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        bounded = " ".join(value.split()).strip()
        folded = normalize_word(bounded)
        if not bounded or folded in seen:
            continue
        seen.add(folded)
        result.append(bounded)
    return tuple(result)


def sentence_signature(value: str) -> str:
    return re.sub(r"[^\w]+", " ", normalize_word(value), flags=re.UNICODE).strip()


@dataclass(frozen=True)
class EntityPattern:
    entity: SemanticEntity
    lemmas: tuple[str, ...]


def build_patterns(engine: SyntaxEngine, entities: Sequence[SemanticEntity]) -> list[EntityPattern]:
    requests: list[tuple[SemanticEntity, str]] = []
    for entity in entities:
        requests.extend((entity, value) for value in entity_variant_texts(entity))
    parsed = engine.parse_many([value for _, value in requests]) if requests else []
    unique: dict[tuple[str, tuple[str, ...]], EntityPattern] = {}
    for (entity, _), tokens in zip(requests, parsed, strict=True):
        lemmas = tuple(token.lemma for token in content_tokens(tokens) if token.lemma)
        if not lemmas:
            continue
        unique[(entity.id, lemmas)] = EntityPattern(entity=entity, lemmas=lemmas)
    return sorted(unique.values(), key=lambda item: (-len(item.lemmas), item.entity.kind != "ngram", item.entity.id))


def mention_head(tokens: Sequence[ParsedToken], included: set[int]) -> int:
    for index in sorted(included):
        token = tokens[index]
        if token.head == index or token.head not in included:
            return index
    return min(included)


def pattern_index(patterns: Sequence[EntityPattern]) -> dict[str, tuple[EntityPattern, ...]]:
    grouped: dict[str, list[EntityPattern]] = defaultdict(list)
    for pattern in patterns:
        grouped[pattern.lemmas[0]].append(pattern)
    return {lemma: tuple(values) for lemma, values in grouped.items()}


def match_mentions(
    sentence: ParsedSentence,
    patterns: Sequence[EntityPattern],
    indexed_patterns: Mapping[str, Sequence[EntityPattern]] | None = None,
) -> list[EntityMention]:
    meaningful = content_tokens(sentence.tokens)
    by_first = indexed_patterns if indexed_patterns is not None else pattern_index(patterns)

    mentions: dict[tuple[str, int, int], EntityMention] = {}
    for offset, token in enumerate(meaningful):
        for pattern in by_first.get(token.lemma, []):
            window = meaningful[offset:offset + len(pattern.lemmas)]
            if len(window) != len(pattern.lemmas):
                continue
            if tuple(item.lemma for item in window) != pattern.lemmas:
                continue
            token_indexes = {item.index for item in window}
            start = min(token_indexes)
            end = max(token_indexes) + 1
            head = mention_head(sentence.tokens, token_indexes)
            mention = EntityMention(
                entity_id=pattern.entity.id,
                label=pattern.entity.label,
                kind=pattern.entity.kind,
                token_start=start,
                token_end=end,
                char_start=min(item.start_char for item in window),
                char_end=max(item.end_char for item in window),
                head=head,
            )
            mentions[(mention.entity_id, mention.token_start, mention.token_end)] = mention
    return list(mentions.values())


def children(tokens: Sequence[ParsedToken]) -> dict[int, list[int]]:
    result: dict[int, list[int]] = defaultdict(list)
    for token in tokens:
        if token.head != token.index and 0 <= token.head < len(tokens):
            result[token.head].append(token.index)
    return result


def conjuncts(seed: int, tokens: Sequence[ParsedToken], child_map: dict[int, list[int]]) -> list[int]:
    result = [seed]
    cursor = 0
    while cursor < len(result):
        current = result[cursor]
        for child in child_map.get(current, []):
            if dep_base(tokens[child].dependency) == "conj" and child not in result:
                result.append(child)
        cursor += 1
    return result


def inherited_subjects(predicate: ParsedToken, tokens: Sequence[ParsedToken], child_map: dict[int, list[int]]) -> list[int]:
    direct = [child for child in child_map.get(predicate.index, []) if dep_base(tokens[child].dependency) in SUBJECT_DEPS]
    if direct:
        return direct
    # Coordination shares an explicit subject. Control verbs (xcomp/ccomp) do
    # not: inheriting there would turn "courses help specialists learn SEO"
    # into the false claim "courses learn SEO".
    if dep_base(predicate.dependency) != "conj":
        return []
    head = predicate.head
    visited: set[int] = set()
    while 0 <= head < len(tokens) and head not in visited:
        visited.add(head)
        inherited = [child for child in child_map.get(head, []) if dep_base(tokens[child].dependency) in SUBJECT_DEPS]
        if inherited:
            return inherited
        if dep_base(tokens[head].dependency) != "conj" or tokens[head].head == head:
            break
        head = tokens[head].head
    return []


def role_mentions(head: int, mentions: Sequence[EntityMention], tokens: Sequence[ParsedToken]) -> list[EntityMention]:
    if not (0 <= head < len(tokens)) or tokens[head].upos not in ENTITY_POS:
        return []
    direct = [mention for mention in mentions if mention.head == head]
    if not direct:
        direct = [mention for mention in mentions if mention.token_start <= head < mention.token_end]
    direct.sort(key=lambda item: (-(item.token_end - item.token_start), item.kind != "ngram", item.entity_id))
    # A head may represent both a phrase and its constituent lemma (for
    # example, "SEO courses" and "courses"). Both are legitimate report
    # entities and may have independently supported relations. De-duplicate
    # aliases of the same entity, but do not discard nested entities.
    distinct: dict[str, EntityMention] = {}
    for mention in direct:
        distinct.setdefault(mention.entity_id, mention)
    return list(distinct.values())


def evidence_span(mention: EntityMention) -> EvidenceSpan:
    return EvidenceSpan(
        token_start=mention.token_start,
        token_end=mention.token_end,
        char_start=mention.char_start,
        char_end=mention.char_end,
    )


def predicate_span(token: ParsedToken) -> EvidenceSpan:
    return EvidenceSpan(
        token_start=token.index,
        token_end=token.index + 1,
        char_start=token.start_char,
        char_end=token.end_char,
    )


def is_negated(predicate: ParsedToken, tokens: Sequence[ParsedToken], child_map: dict[int, list[int]]) -> bool:
    indexes = {predicate.index, *child_map.get(predicate.index, [])}
    return any(
        dep_base(tokens[index].dependency) == "neg" or normalize_word(tokens[index].text) in NEGATION_WORDS
        for index in indexes
    )


def predicate_lemma(predicate: ParsedToken, passive: bool = False) -> str:
    lemma = predicate.lemma or normalize_word(predicate.text)
    if passive and lemma.endswith(("ся", "сь")) and len(lemma) > 4:
        return lemma[:-2]
    return lemma


def append_occurrence(
    result: list[TripletOccurrence],
    sentence: ParsedSentence,
    source: EntityMention,
    predicate: ParsedToken,
    target: EntityMention,
    pattern: str,
    confidence: float,
    negated: bool,
    predicate_override: str | None = None,
) -> None:
    if source.entity_id == target.entity_id:
        return
    result.append(TripletOccurrence(
        source_id=source.entity_id,
        source_label=source.label,
        predicate=predicate_override or predicate_lemma(predicate),
        target_id=target.entity_id,
        target_label=target.label,
        negated=negated,
        pattern=pattern,
        confidence=confidence,
        document_id=sentence.document_id,
        document_name=sentence.document_name,
        document_url=sentence.document_url,
        ours=sentence.ours,
        sentence_id=sentence.id,
        sentence=sentence.text,
        source_span=evidence_span(source),
        predicate_span=predicate_span(predicate),
        target_span=evidence_span(target),
    ))


def extract_sentence_occurrences(sentence: ParsedSentence, mentions: Sequence[EntityMention]) -> list[TripletOccurrence]:
    tokens = sentence.tokens
    child_map = children(tokens)
    result: list[TripletOccurrence] = []

    for predicate in tokens:
        if predicate.upos not in PREDICATE_POS:
            continue
        if dep_base(predicate.dependency) in {"aux", "auxpass", "cop"}:
            continue

        passive_patients = [child for child in child_map.get(predicate.index, []) if passive_subject(tokens[child].dependency)]
        passive_agents: list[int] = []
        for child in child_map.get(predicate.index, []):
            if passive_agent(tokens[child].dependency):
                if tokens[child].upos == "ADP":
                    passive_agents.extend(
                        nested for nested in child_map.get(child, [])
                        if dep_base(tokens[nested].dependency) in {"obj", "pobj", "obl"}
                    )
                else:
                    passive_agents.append(child)
            elif dep_base(tokens[child].dependency) == "prep" and normalize_word(tokens[child].text) in {"by", "кем"}:
                passive_agents.extend(
                    nested for nested in child_map.get(child, [])
                    if dep_base(tokens[nested].dependency) in {"obj", "pobj", "obl"}
                )

        # Russian short passive/middle forms are often not marked nsubj:pass by
        # either small model. An explicit instrumental semantic argument is the
        # conservative signal that lets us normalize agent -> verb -> patient.
        reflexive = predicate.lemma.endswith(("ся", "сь"))
        if reflexive and not passive_patients:
            ordinary_subjects = [child for child in child_map.get(predicate.index, []) if dep_base(tokens[child].dependency) in SUBJECT_DEPS]
            instrumental = [
                child for child in child_map.get(predicate.index, [])
                if dep_base(tokens[child].dependency) in {"iobj", "obl"}
                and "Case=Ins" in tokens[child].morphology
            ]
            if ordinary_subjects and instrumental:
                passive_patients = ordinary_subjects
                passive_agents.extend(instrumental)

        if passive_patients:
            negated = is_negated(predicate, tokens, child_map)
            for agent_head in [item for head in passive_agents for item in conjuncts(head, tokens, child_map)]:
                for patient_head in [item for head in passive_patients for item in conjuncts(head, tokens, child_map)]:
                    for source in role_mentions(agent_head, mentions, tokens):
                        for target in role_mentions(patient_head, mentions, tokens):
                            append_occurrence(
                                result,
                                sentence,
                                source,
                                predicate,
                                target,
                                "passive",
                                0.9,
                                negated,
                                predicate_override=predicate_lemma(predicate, passive=True),
                            )
            # Never silently reverse a passive clause without an explicit agent.
            continue

        subject_heads = inherited_subjects(predicate, tokens, child_map)
        object_heads = [
            child for child in child_map.get(predicate.index, [])
            if dep_base(tokens[child].dependency) in OBJECT_DEPS
        ]
        for preposition in [
            child for child in child_map.get(predicate.index, [])
            if dep_base(tokens[child].dependency) == "prep"
        ]:
            object_heads.extend(
                child for child in child_map.get(preposition, [])
                if dep_base(tokens[child].dependency) in {"obj", "pobj", "obl"}
            )
        expanded_subjects = [item for head in subject_heads for item in conjuncts(head, tokens, child_map)]
        expanded_objects = [item for head in object_heads for item in conjuncts(head, tokens, child_map)]
        negated = is_negated(predicate, tokens, child_map)

        for subject_head in expanded_subjects:
            for object_head in expanded_objects:
                for source in role_mentions(subject_head, mentions, tokens):
                    for target in role_mentions(object_head, mentions, tokens):
                        append_occurrence(result, sentence, source, predicate, target, "active", 1.0, negated)

        if predicate.lemma in {"быть", "являться", "становиться", "считаться"}:
            complements = [
                child for child in child_map.get(predicate.index, [])
                if dep_base(tokens[child].dependency) in {"attr", "obj", "oprd", "xcomp"}
            ]
            for subject_head in expanded_subjects:
                for complement_head in complements:
                    for source in role_mentions(subject_head, mentions, tokens):
                        for target in role_mentions(complement_head, mentions, tokens):
                            append_occurrence(result, sentence, source, predicate, target, "copular", 0.9, negated)

    # Universal Dependencies attach a copula to a nominal/adjectival predicate.
    for complement in tokens:
        copulas = [child for child in child_map.get(complement.index, []) if dep_base(tokens[child].dependency) == "cop"]
        subjects = [child for child in child_map.get(complement.index, []) if dep_base(tokens[child].dependency) in SUBJECT_DEPS]
        if not copulas or not subjects:
            continue
        for subject_head in subjects:
            for source in role_mentions(subject_head, mentions, tokens):
                for target in role_mentions(complement.index, mentions, tokens):
                    append_occurrence(result, sentence, source, tokens[copulas[0]], target, "copular", 0.9, is_negated(complement, tokens, child_map))

    unique: dict[tuple[str, str, str, bool], TripletOccurrence] = {}
    for occurrence in result:
        key = (occurrence.source_id, occurrence.predicate, occurrence.target_id, occurrence.negated)
        current = unique.get(key)
        if current is None or occurrence.confidence > current.confidence:
            unique[key] = occurrence
    return list(unique.values())


def aggregate_occurrences(occurrences: Sequence[TripletOccurrence], min_support: int = 2) -> list[SupportedTriplet]:
    if min_support < 2:
        raise ValueError("min_support must be at least 2")
    groups: dict[tuple[str, str, str, bool], list[TripletOccurrence]] = defaultdict(list)
    for occurrence in occurrences:
        groups[(occurrence.source_id, occurrence.predicate, occurrence.target_id, occurrence.negated)].append(occurrence)

    result: list[SupportedTriplet] = []
    for (source_id, predicate, target_id, negated), group in groups.items():
        distinct: dict[tuple[str, str], TripletOccurrence] = {}
        for occurrence in group:
            distinct[(occurrence.document_id, occurrence.sentence_id)] = occurrence
        evidence = sorted(distinct.values(), key=lambda item: (not item.ours, item.document_id, item.sentence_id))
        if len(evidence) < min_support:
            continue
        documents = {item.document_id for item in evidence}
        digest = hashlib.sha1(f"{source_id}\x1f{predicate}\x1f{target_id}\x1f{int(negated)}".encode("utf-8")).hexdigest()[:16]
        result.append(SupportedTriplet(
            id=f"rel-{digest}",
            source_id=source_id,
            source_label=evidence[0].source_label,
            predicate=predicate,
            target_id=target_id,
            target_label=evidence[0].target_label,
            negated=negated,
            support=len(evidence),
            document_count=len(documents),
            own_support=sum(1 for item in evidence if item.ours),
            competitor_support=sum(1 for item in evidence if not item.ours),
            confidence=round(sum(item.confidence for item in evidence) / len(evidence), 3),
            patterns=tuple(sorted({item.pattern for item in evidence})),
            evidence=tuple(evidence),
        ))
    return sorted(result, key=lambda item: (-item.support, -item.document_count, item.source_label, item.predicate, item.target_label))


def extract_supported_triplets(
    engine: SyntaxEngine,
    documents: Sequence[DocumentInput],
    entities: Sequence[SemanticEntity],
    min_support: int = 2,
) -> tuple[list[SupportedTriplet], dict[str, int]]:
    patterns = build_patterns(engine, entities)
    indexed_patterns = pattern_index(patterns)
    sentence_inputs = []
    duplicate_sentences = 0
    for document in documents:
        seen_sentences: set[str] = set()
        for sentence in document.sentences:
            signature = sentence_signature(sentence.text)
            if not signature:
                continue
            if signature in seen_sentences:
                duplicate_sentences += 1
                continue
            seen_sentences.add(signature)
            sentence_inputs.append((document, sentence))
    occurrences: list[TripletOccurrence] = []
    matched_sentences = 0
    # Parse in bounded batches. This changes no extraction semantics while
    # avoiding a second full in-memory copy of a large sentence corpus.
    batch_size = 512
    for start in range(0, len(sentence_inputs), batch_size):
        batch = sentence_inputs[start:start + batch_size]
        parsed_tokens = engine.parse_many([sentence.text for _, sentence in batch])
        for (document, source), tokens in zip(batch, parsed_tokens, strict=True):
            sentence = ParsedSentence(
                id=source.id,
                text=source.text,
                document_id=document.id,
                document_name=document.name,
                document_url=document.url,
                ours=document.ours,
                tokens=tokens,
            )
            mentions = match_mentions(sentence, patterns, indexed_patterns)
            if mentions:
                matched_sentences += 1
            occurrences.extend(extract_sentence_occurrences(sentence, mentions))

    supported = aggregate_occurrences(occurrences, min_support=min_support)
    return supported, {
        "documents": len(documents),
        "input_sentences": sum(len(document.sentences) for document in documents),
        "sentences": len(sentence_inputs),
        "duplicate_sentences_suppressed": duplicate_sentences,
        "matched_sentences": matched_sentences,
        "entities": len(entities),
        "patterns": len(patterns),
        "occurrences": len(occurrences),
        "supported_relations": len(supported),
        "min_support": min_support,
    }
