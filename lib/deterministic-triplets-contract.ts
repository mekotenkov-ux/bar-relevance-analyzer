/**
 * Parser-neutral contract for dependency-based semantic triplets.
 *
 * spaCy and Stanza adapters must emit the same grounded occurrence shape.
 * This module deliberately contains no HTTP or model-specific code: it owns
 * validation, cross-engine deduplication, support counting and stable edges.
 */

export const DETERMINISTIC_TRIPLET_CONTRACT_VERSION = 1 as const;
export const DETERMINISTIC_TRIPLET_MIN_SENTENCE_SUPPORT = 2;

export type DeterministicEngineName = "spacy" | "stanza";
export type DeterministicEvidenceZone = "all" | "title" | "h1" | "headings" | "text" | "anchors" | "unknown";
export type DeterministicCandidateKind = "lemma" | "ngram";
export type DeterministicSyntaxPattern = "active" | "passive" | "copular" | "clausal";
export type UniversalPos =
  | "ADJ" | "ADP" | "ADV" | "AUX" | "CCONJ" | "DET" | "INTJ"
  | "NOUN" | "NUM" | "PART" | "PRON" | "PROPN" | "PUNCT" | "SCONJ"
  | "SYM" | "VERB" | "X";

/** Inclusive start, exclusive end. Character offsets count Unicode code points. */
export type DeterministicSpan = {
  tokenStart: number;
  tokenEnd: number;
  charStart: number;
  charEnd: number;
};

export type DeterministicEngine = {
  name: DeterministicEngineName;
  version: string;
  model: string;
};

/** Every visible report lemma and N-gram is eligible; importance is metadata only. */
export type DeterministicSemanticCandidate = {
  id: string;
  kind: DeterministicCandidateKind;
  key: string;
  label: string;
  forms: string[];
  tokenKeys: string[];
  importance: number;
  sites: number;
};

export type DeterministicDocument = {
  id: string;
  name: string;
  url: string;
  ours: boolean;
};

export type DeterministicEvidenceSentence = {
  /** Globally unique in the request; recommended form: `${document.id}:${snapshotSentence.id}`. */
  sentenceId: string;
  /** Original snapshot-local id, retained for diagnostics. */
  sourceSentenceId: string;
  text: string;
  tokenCount: number;
  document: DeterministicDocument;
  /** snapshot v5 can truthfully provide only `["all"]`; never infer a narrower zone. */
  zones: DeterministicEvidenceZone[];
};

export type DeterministicParticipant = {
  /** Opaque id supplied by the local candidate dictionary. */
  candidateId: string;
  surface: string;
  span: DeterministicSpan;
  headToken: number;
  upos: UniversalPos;
};

export type DeterministicPredicate = {
  surface: string;
  /** Lemma of the lexical predicate; auxiliaries and negation are not appended. */
  lemma: string;
  span: DeterministicSpan;
  headToken: number;
  upos: "VERB" | "AUX";
};

/**
 * One explicit dependency-path observation. Passive clauses must already be
 * normalized to semantic agent -> predicate -> patient direction by the adapter.
 */
export type DeterministicTripletOccurrence = {
  contractVersion: typeof DETERMINISTIC_TRIPLET_CONTRACT_VERSION;
  engine: DeterministicEngine;
  language: string;
  subject: DeterministicParticipant;
  predicate: DeterministicPredicate;
  object: DeterministicParticipant;
  negated: boolean;
  syntax: DeterministicSyntaxPattern;
  confidence: number;
  evidence: DeterministicEvidenceSentence;
};

export type DeterministicParsedToken = {
  index: number;
  surface: string;
  lemma: string;
  upos: UniversalPos;
  /** Zero-based token index; -1 denotes the dependency root. */
  head: number;
  /** Universal Dependencies label, including an optional subtype. */
  dependency: string;
  charStart: number;
  charEnd: number;
};

/** Optional diagnostics payload used by the spaCy/Stanza comparison harness. */
export type DeterministicParsedSentence = {
  sentenceId: string;
  tokens: DeterministicParsedToken[];
};

export type DeterministicEngineBatch = {
  contractVersion: typeof DETERMINISTIC_TRIPLET_CONTRACT_VERSION;
  engine: DeterministicEngine;
  language: string;
  occurrences: DeterministicTripletOccurrence[];
  parsedSentences?: DeterministicParsedSentence[];
  elapsedMs?: number;
  peakWorkingSetMb?: number;
};

export type DeterministicEdgeEvidence = {
  sentenceId: string;
  sourceSentenceId: string;
  text: string;
  document: DeterministicDocument;
  zones: DeterministicEvidenceZone[];
  subject: Pick<DeterministicParticipant, "surface" | "span" | "headToken" | "upos">;
  predicate: Pick<DeterministicPredicate, "surface" | "lemma" | "span" | "headToken" | "upos">;
  object: Pick<DeterministicParticipant, "surface" | "span" | "headToken" | "upos">;
  syntax: DeterministicSyntaxPattern;
  confidence: number;
  engines: DeterministicEngine[];
};

export type DeterministicEngineSupport = DeterministicEngine & {
  occurrences: number;
  sentenceCount: number;
  documentCount: number;
};

export type DeterministicTripletEdge = {
  id: string;
  sourceId: string;
  sourceKind: DeterministicCandidateKind;
  sourceKey: string;
  sourceLabel: string;
  predicate: string;
  predicateKey: string;
  targetId: string;
  targetKind: DeterministicCandidateKind;
  targetKey: string;
  targetLabel: string;
  negated: boolean;
  /** Unique positional observations; engine agreement is deduplicated. */
  occurrences: number;
  /** Unique document + sentence pairs. This is the support threshold. */
  sentenceCount: number;
  documentCount: number;
  zones: DeterministicEvidenceZone[];
  documents: DeterministicDocument[];
  engineSupport: DeterministicEngineSupport[];
  evidence: DeterministicEdgeEvidence[];
};

export type DeterministicAggregationOptions = {
  minSentenceSupport?: number;
  maxEdges?: number;
  maxEvidencePerEdge?: number;
};

export type DeterministicAggregationResult = {
  edges: DeterministicTripletEdge[];
  inputOccurrences: number;
  validOccurrences: number;
  distinctOccurrences: number;
  rejectedOccurrences: number;
  rejectionReasons: Record<string, number>;
  suppressedRelations: number;
  minSentenceSupport: number;
};

const VALID_POS = new Set<UniversalPos>([
  "ADJ", "ADP", "ADV", "AUX", "CCONJ", "DET", "INTJ", "NOUN", "NUM",
  "PART", "PRON", "PROPN", "PUNCT", "SCONJ", "SYM", "VERB", "X",
]);
const VALID_ZONES = new Set<DeterministicEvidenceZone>([
  "all", "title", "h1", "headings", "text", "anchors", "unknown",
]);
const VALID_SYNTAX = new Set<DeterministicSyntaxPattern>(["active", "passive", "copular", "clausal"]);

function boundedText(value: unknown, maximum = 2_000) {
  return typeof value === "string" ? value.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, maximum) : "";
}

function lower(value: string, language: string) {
  try { return value.toLocaleLowerCase(language); }
  catch { return value.toLowerCase(); }
}

function canonical(value: string, language: string) {
  return lower(boundedText(value, 320), language);
}

function codePointSlice(value: string, start: number, end: number) {
  return Array.from(value).slice(start, end).join("");
}

function spansOverlap(left: DeterministicSpan, right: DeterministicSpan) {
  return left.tokenStart < right.tokenEnd && right.tokenStart < left.tokenEnd;
}

function validSpan(span: DeterministicSpan, evidence: DeterministicEvidenceSentence) {
  const characterCount = Array.from(evidence.text).length;
  return Number.isInteger(span.tokenStart)
    && Number.isInteger(span.tokenEnd)
    && Number.isInteger(span.charStart)
    && Number.isInteger(span.charEnd)
    && span.tokenStart >= 0
    && span.tokenEnd > span.tokenStart
    && span.tokenEnd <= evidence.tokenCount
    && span.charStart >= 0
    && span.charEnd > span.charStart
    && span.charEnd <= characterCount;
}

function engineIdentity(engine: DeterministicEngine) {
  return `${engine.name}\u0000${engine.version}\u0000${engine.model}`;
}

function participantIdentity(candidate: DeterministicSemanticCandidate) {
  return `${candidate.kind}\u0000${candidate.key}`;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function deterministicCandidateId(kind: DeterministicCandidateKind, key: string) {
  return `${kind}-${stableHash(`${kind}\u0000${key.normalize("NFKC")}`)}`;
}

function candidateDictionary(candidates: readonly DeterministicSemanticCandidate[]) {
  const result = new Map<string, DeterministicSemanticCandidate>();
  for (const candidate of candidates) {
    if (!candidate || !boundedText(candidate.id, 160) || !boundedText(candidate.key, 320) || !boundedText(candidate.label, 320)) {
      throw new Error("deterministic triplet candidate is incomplete");
    }
    if (candidate.kind !== "lemma" && candidate.kind !== "ngram") throw new Error("deterministic triplet candidate kind is invalid");
    if (result.has(candidate.id)) throw new Error(`duplicate deterministic triplet candidate id: ${candidate.id}`);
    result.set(candidate.id, candidate);
  }
  return result;
}

function occurrenceRejectionReason(
  occurrence: DeterministicTripletOccurrence,
  candidates: ReadonlyMap<string, DeterministicSemanticCandidate>,
) {
  if (!occurrence || occurrence.contractVersion !== DETERMINISTIC_TRIPLET_CONTRACT_VERSION) return "contract_version";
  if (!occurrence.engine || !["spacy", "stanza"].includes(occurrence.engine.name)
    || !boundedText(occurrence.engine.version, 80) || !boundedText(occurrence.engine.model, 160)) return "engine";
  if (!boundedText(occurrence.language, 32)) return "language";
  const evidence = occurrence.evidence;
  if (!evidence || !boundedText(evidence.sentenceId, 200) || !boundedText(evidence.text, 2_000)
    || !Number.isInteger(evidence.tokenCount) || evidence.tokenCount < 1
    || !evidence.document || !boundedText(evidence.document.id, 160)) return "evidence";
  if (!Array.isArray(evidence.zones) || !evidence.zones.length || evidence.zones.some((zone) => !VALID_ZONES.has(zone))) return "zones";
  if (!occurrence.subject || !occurrence.object || !occurrence.predicate) return "roles";
  const source = candidates.get(occurrence.subject.candidateId);
  const target = candidates.get(occurrence.object.candidateId);
  if (!source || !target) return "unknown_candidate";
  if (participantIdentity(source) === participantIdentity(target)) return "self_relation";
  if (!VALID_POS.has(occurrence.subject.upos) || !VALID_POS.has(occurrence.object.upos)) return "participant_pos";
  if (!validSpan(occurrence.subject.span, evidence) || !validSpan(occurrence.object.span, evidence)
    || !validSpan(occurrence.predicate.span, evidence)) return "span";
  if (spansOverlap(occurrence.subject.span, occurrence.object.span)) return "overlapping_participants";
  if (!Number.isInteger(occurrence.subject.headToken) || occurrence.subject.headToken < occurrence.subject.span.tokenStart
    || occurrence.subject.headToken >= occurrence.subject.span.tokenEnd
    || !Number.isInteger(occurrence.object.headToken) || occurrence.object.headToken < occurrence.object.span.tokenStart
    || occurrence.object.headToken >= occurrence.object.span.tokenEnd
    || !Number.isInteger(occurrence.predicate.headToken) || occurrence.predicate.headToken < occurrence.predicate.span.tokenStart
    || occurrence.predicate.headToken >= occurrence.predicate.span.tokenEnd) return "head_position";
  if (codePointSlice(evidence.text, occurrence.subject.span.charStart, occurrence.subject.span.charEnd) !== occurrence.subject.surface
    || codePointSlice(evidence.text, occurrence.object.span.charStart, occurrence.object.span.charEnd) !== occurrence.object.surface
    || codePointSlice(evidence.text, occurrence.predicate.span.charStart, occurrence.predicate.span.charEnd) !== occurrence.predicate.surface) return "surface_grounding";
  if ((occurrence.predicate.upos !== "VERB" && occurrence.predicate.upos !== "AUX")
    || !boundedText(occurrence.predicate.lemma, 160)) return "predicate";
  if (!VALID_SYNTAX.has(occurrence.syntax)) return "syntax";
  if (!Number.isFinite(occurrence.confidence) || occurrence.confidence < 0 || occurrence.confidence > 1) return "confidence";
  return "";
}

type EvidenceAggregate = {
  evidence: DeterministicEdgeEvidence;
  engines: Map<string, DeterministicEngine>;
};

type RelationAggregate = {
  relationKey: string;
  source: DeterministicSemanticCandidate;
  target: DeterministicSemanticCandidate;
  predicate: string;
  predicateKey: string;
  negated: boolean;
  evidence: Map<string, EvidenceAggregate>;
  sentences: Set<string>;
  documents: Map<string, DeterministicDocument>;
  zones: Set<DeterministicEvidenceZone>;
  engineEvidence: Map<string, {
    engine: DeterministicEngine;
    occurrences: Set<string>;
    sentences: Set<string>;
    documents: Set<string>;
  }>;
};

/**
 * Aggregates already grounded spaCy/Stanza observations. A relation is emitted
 * only when it appears in at least two distinct document-scoped sentences by
 * default. Two engines agreeing on one sentence still contribute support=1.
 */
export function aggregateDeterministicTriplets(
  candidatesInput: readonly DeterministicSemanticCandidate[],
  occurrences: readonly DeterministicTripletOccurrence[],
  options: DeterministicAggregationOptions = {},
): DeterministicAggregationResult {
  const candidates = candidateDictionary(candidatesInput);
  const minSentenceSupport = Number.isFinite(options.minSentenceSupport)
    ? Math.max(1, Math.trunc(options.minSentenceSupport!))
    : DETERMINISTIC_TRIPLET_MIN_SENTENCE_SUPPORT;
  const maxEdges = Number.isFinite(options.maxEdges) ? Math.max(1, Math.trunc(options.maxEdges!)) : 256;
  const maxEvidence = Number.isFinite(options.maxEvidencePerEdge)
    ? Math.max(1, Math.trunc(options.maxEvidencePerEdge!))
    : 6;
  const relations = new Map<string, RelationAggregate>();
  const rejectionReasons: Record<string, number> = {};
  let validOccurrences = 0;

  for (const occurrence of occurrences) {
    const reason = occurrenceRejectionReason(occurrence, candidates);
    if (reason) {
      rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
      continue;
    }
    validOccurrences += 1;
    const source = candidates.get(occurrence.subject.candidateId)!;
    const target = candidates.get(occurrence.object.candidateId)!;
    const predicateKey = canonical(occurrence.predicate.lemma, occurrence.language);
    const relationKey = [participantIdentity(source), predicateKey, participantIdentity(target), occurrence.negated ? "1" : "0"].join("\u0000");
    let relation = relations.get(relationKey);
    if (!relation) {
      relation = {
        relationKey,
        source,
        target,
        predicate: boundedText(occurrence.predicate.lemma, 160),
        predicateKey,
        negated: occurrence.negated,
        evidence: new Map(),
        sentences: new Set(),
        documents: new Map(),
        zones: new Set(),
        engineEvidence: new Map(),
      };
      relations.set(relationKey, relation);
    }
    const sentenceKey = `${occurrence.evidence.document.id}\u0000${occurrence.evidence.sentenceId}`;
    const positionalKey = [
      sentenceKey,
      occurrence.subject.span.tokenStart, occurrence.subject.span.tokenEnd,
      occurrence.predicate.span.tokenStart, occurrence.predicate.span.tokenEnd,
      occurrence.object.span.tokenStart, occurrence.object.span.tokenEnd,
    ].join("\u0000");
    relation.sentences.add(sentenceKey);
    relation.documents.set(occurrence.evidence.document.id, occurrence.evidence.document);
    occurrence.evidence.zones.forEach((zone) => relation!.zones.add(zone));

    let evidence = relation.evidence.get(positionalKey);
    if (!evidence) {
      evidence = {
        evidence: {
          sentenceId: occurrence.evidence.sentenceId,
          sourceSentenceId: occurrence.evidence.sourceSentenceId,
          text: occurrence.evidence.text,
          document: occurrence.evidence.document,
          zones: [...new Set(occurrence.evidence.zones)],
          subject: {
            surface: occurrence.subject.surface, span: occurrence.subject.span,
            headToken: occurrence.subject.headToken, upos: occurrence.subject.upos,
          },
          predicate: {
            surface: occurrence.predicate.surface, lemma: occurrence.predicate.lemma, span: occurrence.predicate.span,
            headToken: occurrence.predicate.headToken, upos: occurrence.predicate.upos,
          },
          object: {
            surface: occurrence.object.surface, span: occurrence.object.span,
            headToken: occurrence.object.headToken, upos: occurrence.object.upos,
          },
          syntax: occurrence.syntax,
          confidence: occurrence.confidence,
          engines: [],
        },
        engines: new Map(),
      };
      relation.evidence.set(positionalKey, evidence);
    } else {
      evidence.evidence.confidence = Math.max(evidence.evidence.confidence, occurrence.confidence);
    }
    const engineKey = engineIdentity(occurrence.engine);
    evidence.engines.set(engineKey, occurrence.engine);
    let engineSupport = relation.engineEvidence.get(engineKey);
    if (!engineSupport) {
      engineSupport = { engine: occurrence.engine, occurrences: new Set(), sentences: new Set(), documents: new Set() };
      relation.engineEvidence.set(engineKey, engineSupport);
    }
    engineSupport.occurrences.add(positionalKey);
    engineSupport.sentences.add(sentenceKey);
    engineSupport.documents.add(occurrence.evidence.document.id);
  }

  const eligible = [...relations.values()].filter((relation) => relation.sentences.size >= minSentenceSupport);
  const edges = eligible
    .sort((left, right) => right.sentences.size - left.sentences.size
      || right.documents.size - left.documents.size
      || right.evidence.size - left.evidence.size
      || left.source.label.localeCompare(right.source.label)
      || left.predicateKey.localeCompare(right.predicateKey)
      || left.target.label.localeCompare(right.target.label))
    .slice(0, maxEdges)
    .map((relation): DeterministicTripletEdge => ({
      id: `relation-${stableHash(relation.relationKey)}`,
      sourceId: relation.source.id,
      sourceKind: relation.source.kind,
      sourceKey: relation.source.key,
      sourceLabel: relation.source.label,
      predicate: relation.predicate,
      predicateKey: relation.predicateKey,
      targetId: relation.target.id,
      targetKind: relation.target.kind,
      targetKey: relation.target.key,
      targetLabel: relation.target.label,
      negated: relation.negated,
      occurrences: relation.evidence.size,
      sentenceCount: relation.sentences.size,
      documentCount: relation.documents.size,
      zones: [...relation.zones].sort(),
      documents: [...relation.documents.values()].sort((left, right) => Number(right.ours) - Number(left.ours) || left.id.localeCompare(right.id)),
      engineSupport: [...relation.engineEvidence.values()]
        .map((support) => ({
          ...support.engine,
          occurrences: support.occurrences.size,
          sentenceCount: support.sentences.size,
          documentCount: support.documents.size,
        }))
        .sort((left, right) => right.sentenceCount - left.sentenceCount || left.name.localeCompare(right.name)),
      evidence: [...relation.evidence.values()]
        .sort((left, right) => right.evidence.confidence - left.evidence.confidence
          || left.evidence.document.id.localeCompare(right.evidence.document.id)
          || left.evidence.sentenceId.localeCompare(right.evidence.sentenceId))
        .slice(0, maxEvidence)
        .map((item) => ({ ...item.evidence, engines: [...item.engines.values()] })),
    }));

  return {
    edges,
    inputOccurrences: occurrences.length,
    validOccurrences,
    distinctOccurrences: [...relations.values()].reduce((sum, relation) => sum + relation.evidence.size, 0),
    rejectedOccurrences: occurrences.length - validOccurrences,
    rejectionReasons,
    suppressedRelations: relations.size - eligible.length,
    minSentenceSupport,
  };
}
