# Deterministic triplets: spaCy/Stanza contract

## Scope

The deterministic experiment does not use an LLM and does not reuse the old
`importance >= 70` gate. Its candidate vocabulary is every lemma and every
N-gram visible in the recalculated BAR report. Importance remains display
metadata and must not decide whether a candidate can become a subject or object.

The two adapters must produce the common structures in
`lib/deterministic-triplets-contract.ts`. The local TypeScript layer validates
and aggregates them. Python must never invent candidate ids, labels, keys,
documents, zones or evidence text.

## Current BAR data and honest limitations

- `analyzePayload()` returns the visible vocabulary in `report.terms` (the same
  rows are also exposed as `report.lemmas`) and `report.ngrams`.
- The recalculated `report.snapshot` is the trusted source of bounded sentences.
  Each snapshot-v5 sentence has `id`, `text`, `tokenKeys` and `tokenCount`.
- The corpus is intentionally bounded to 500 sentences/12,000 tokens per page
  and 2,500 sentences/60,000 tokens globally. A benchmark must report
  `sentenceCorpusTruncated`; absence from a truncated corpus is not evidence of
  absence from the original page.
- Snapshot v5 builds sentences only from `zones.all.blocks` and stores no
  narrower zone provenance. Therefore current evidence must use `zones: ["all"]`
  (or `unknown` for imported legacy evidence). It is incorrect to claim `title`,
  `h1`, `text`, and so on by guessing from the sentence string. Exact zone
  filtering needs a future snapshot field populated while HTML zones are still
  available.

## Input construction

1. Re-run `analyzePayload()` from the supplied snapshot and current keys/stops.
   This keeps recalculation fetch-free and normalizes client-supplied bounds.
2. Build one local candidate dictionary from all `report.terms` and all
   `report.ngrams`. Do not filter by importance, similarity, status or own count.
3. Use opaque ids generated with `deterministicCandidateId(kind, key)`. The
   Python response echoes only these ids; edge labels and semantic keys are
   resolved from the local dictionary after validation.
4. Send each document sentence separately with a globally unique id such as
   `own:s17` or `<stable-competitor-id>:s17`. Do not merge identical sentences
   across documents: document support would otherwise become ambiguous.
5. Send candidate `label` and `forms` to the selected parser. BAR `key` values
   are Snowball-style semantic keys and are not guaranteed to equal spaCy or
   Stanza lemmas. Each adapter must parse candidate forms with its own pipeline
   and match the resulting lemma sequences against sentences. Longest matching
   candidate wins for a given syntactic head; a shorter lemma can still be used
   when it occupies a different dependency role.

## Shared parser normalization

Each parsed token uses zero-based token indexes, Universal POS tags and Universal
Dependencies labels. Character offsets are zero-based Unicode code-point
offsets, inclusive at start and exclusive at end. This is explicit because
Python string offsets and JavaScript UTF-16 indexes differ for non-BMP text.

An emitted argument must:

- resolve to a known report candidate;
- be a contiguous candidate-form match whose syntactic head lies inside it;
- preserve its exact sentence surface and token/character positions;
- have a nominal head (`NOUN`, `PROPN`, `PRON`, or `NUM`) in the first version.

The predicate is the shortest explicit lexical `VERB`/`AUX` token. Its surface
and position stay verbatim, while `lemma` is the canonical grouping key. Polarity
is a separate boolean. Do not invent a zero copula or an omitted agent.

## Initial extraction patterns

- Active: `nsubj`/`csubj` -> lexical verb -> `obj`, `iobj`, `obl`, `xcomp`, or
  `ccomp` when both endpoints resolve to report candidates.
- Passive: require both patient (`nsubj:pass`) and explicit agent
  (`obl:agent` or the engine-equivalent dependency); normalize the result to
  semantic agent -> verb -> patient.
- Copular: explicit `cop` plus `nsubj`, with a candidate complement.
- Clausal: a controlled `xcomp`/`ccomp` relation only when the dependency path
  supplies explicit candidate endpoints.
- Coordination: propagate coordinated subjects or objects that share the same
  predicate. This is how one entity may obtain multiple targets.
- Negation: `neg`/negative particle attached to the predicate sets `negated`.

Nominal `nmod` chains, cross-sentence coreference, implicit subjects, inferred
causality, and fuzzy semantic links are excluded from the first benchmark. They
create many attractive but unsupported false relations.

## Aggregation and the “two times” rule

The relation identity is:

`source(kind,key) + predicate lemma + target(kind,key) + polarity`.

The positional occurrence identity is:

`document + sentence + subject span + predicate span + object span`.

Identical output from spaCy and Stanza for the same positions is one occurrence,
not two. A relation is shown only when it occurs in at least two distinct
document-scoped sentences. The edge retains separate `occurrences`,
`sentenceCount`, and `documentCount` values, plus per-engine support. Repetition
on one page is allowed; requiring two documents would be a different, stricter
filter and must not be silently substituted for the requested rule.

## Integration points

- Replace the candidate selection inside `buildTripletSelection()` with a new
  deterministic builder; do not mutate the existing LLM experiment while it is
  being archived.
- Route the optional triplet action through one configured engine
  (`spacy` or `stanza`) and map `DeterministicTripletEdge` to the current UI edge
  fields. Add `sentenceCount` and engine metadata rather than calling
  `documentCount` “occurrences”.
- Keep the existing report toggle off by default. Recalculation must reuse the
  snapshot and must not search or fetch competitors again.
- The UI can expose an engine selector during the experiment, but both choices
  must consume the same candidate/sentence payload and render the same fields.

## Required tests

The contract unit suite already covers:

- two engines agreeing on one sentence do not pass support 2;
- two distinct sentences do pass, with document and engine counts preserved;
- one source keeps several independently supported targets;
- exact surface grounding and Unicode code-point offsets;
- affirmative and negated relations remain separate.

Adapter parity fixtures should additionally cover Russian and English active,
passive, copular, negated and coordinated clauses; morphology across different
surface forms; repeated boilerplate; ambiguous attachment; a missing passive
agent; overlapping lemma/N-gram candidates; unsupported and malformed language
input. The benchmark must record wall time, peak working set, parsed sentence
count, valid/rejected occurrence counts, supported edge count and a manually
labelled precision sample for both engines on the same SEO corpus.
