import assert from "node:assert/strict";
import test from "node:test";

import {
  DETERMINISTIC_TRIPLET_CONTRACT_VERSION,
  aggregateDeterministicTriplets,
  deterministicCandidateId,
} from "../lib/deterministic-triplets-contract.ts";

const candidates = [
  {
    id: deterministicCandidateId("ngram", "seo курс"),
    kind: "ngram",
    key: "seo курс",
    label: "SEO курсы",
    forms: ["SEO курсы", "курсы SEO"],
    tokenKeys: ["seo", "курс"],
    importance: 100,
    sites: 8,
  },
  {
    id: deterministicCandidateId("ngram", "продвижен сайт"),
    kind: "ngram",
    key: "продвижен сайт",
    label: "продвижение сайта",
    forms: ["продвижение сайта"],
    tokenKeys: ["продвижен", "сайт"],
    importance: 76,
    sites: 6,
  },
  {
    id: deterministicCandidateId("ngram", "позиц сайт"),
    kind: "ngram",
    key: "позиц сайт",
    label: "позиции сайта",
    forms: ["позиции сайта"],
    tokenKeys: ["позиц", "сайт"],
    importance: 64,
    sites: 5,
  },
];

const [seoCourses, sitePromotion, sitePositions] = candidates;

function spanOf(text, surface, tokenStart, tokenEnd, fromCodePoint = 0) {
  const codePoints = Array.from(text);
  const surfacePoints = Array.from(surface);
  let charStart = -1;
  outer: for (let index = fromCodePoint; index <= codePoints.length - surfacePoints.length; index += 1) {
    for (let offset = 0; offset < surfacePoints.length; offset += 1) {
      if (codePoints[index + offset] !== surfacePoints[offset]) continue outer;
    }
    charStart = index;
    break;
  }
  assert.ok(charStart >= 0, `${surface} must occur in fixture sentence`);
  return { tokenStart, tokenEnd, charStart, charEnd: charStart + surfacePoints.length };
}

function occurrence({
  sentenceId,
  text,
  documentId,
  engine = "spacy",
  verbSurface,
  objectSurface,
  target = sitePromotion,
  tokenOffset = 0,
  negated = false,
}) {
  const subjectSurface = "SEO курсы";
  const subjectSpan = spanOf(text, subjectSurface, tokenOffset, tokenOffset + 2);
  const predicateSpan = spanOf(text, verbSurface, tokenOffset + 2, tokenOffset + 3, subjectSpan.charEnd);
  const objectSpan = spanOf(text, objectSurface, tokenOffset + 3, tokenOffset + 5, predicateSpan.charEnd);
  return {
    contractVersion: DETERMINISTIC_TRIPLET_CONTRACT_VERSION,
    engine: {
      name: engine,
      version: engine === "spacy" ? "3.8.7" : "1.10.1",
      model: engine === "spacy" ? "ru_core_news_sm" : "ru-default",
    },
    language: "ru",
    subject: { candidateId: seoCourses.id, surface: subjectSurface, span: subjectSpan, headToken: tokenOffset + 1, upos: "NOUN" },
    predicate: { surface: verbSurface, lemma: "улучшать", span: predicateSpan, headToken: tokenOffset + 2, upos: "VERB" },
    object: { candidateId: target.id, surface: objectSurface, span: objectSpan, headToken: tokenOffset + 3, upos: "NOUN" },
    negated,
    syntax: "active",
    confidence: engine === "spacy" ? 0.91 : 0.88,
    evidence: {
      sentenceId,
      sourceSentenceId: sentenceId.split(":").at(-1),
      text,
      tokenCount: tokenOffset + 5,
      document: { id: documentId, name: documentId, url: `https://${documentId}.example/`, ours: documentId === "own" },
      zones: ["all"],
    },
  };
}

test("a relation requires two distinct document-scoped sentences, not two engines", () => {
  const text = "SEO курсы улучшают продвижение сайта.";
  const spacy = occurrence({ sentenceId: "own:s1", text, documentId: "own", verbSurface: "улучшают", objectSurface: "продвижение сайта" });
  const stanza = occurrence({ sentenceId: "own:s1", text, documentId: "own", engine: "stanza", verbSurface: "улучшают", objectSurface: "продвижение сайта" });

  const oneSentence = aggregateDeterministicTriplets(candidates, [spacy, stanza]);
  assert.equal(oneSentence.edges.length, 0);
  assert.equal(oneSentence.validOccurrences, 2);
  assert.equal(oneSentence.distinctOccurrences, 1, "engine agreement must deduplicate the positional observation");
  assert.equal(oneSentence.suppressedRelations, 1);

  const second = occurrence({
    sentenceId: "competitor-1:s4",
    text: "SEO курсы улучшили продвижение сайта.",
    documentId: "competitor-1",
    verbSurface: "улучшили",
    objectSurface: "продвижение сайта",
  });
  const supported = aggregateDeterministicTriplets(candidates, [spacy, stanza, second]);
  assert.equal(supported.edges.length, 1);
  assert.equal(supported.edges[0].sentenceCount, 2);
  assert.equal(supported.edges[0].documentCount, 2);
  assert.equal(supported.edges[0].occurrences, 2);
  assert.equal(supported.edges[0].engineSupport.length, 2);
  assert.equal(supported.edges[0].evidence[0].zones[0], "all");
});

test("one source naturally keeps several repeatedly supported targets", () => {
  const promotion = [
    occurrence({ sentenceId: "own:s1", text: "SEO курсы улучшают продвижение сайта.", documentId: "own", verbSurface: "улучшают", objectSurface: "продвижение сайта" }),
    occurrence({ sentenceId: "competitor-1:s1", text: "SEO курсы улучшили продвижение сайта.", documentId: "competitor-1", verbSurface: "улучшили", objectSurface: "продвижение сайта" }),
  ];
  const positions = [
    occurrence({ sentenceId: "own:s2", text: "SEO курсы улучшают позиции сайта.", documentId: "own", verbSurface: "улучшают", objectSurface: "позиции сайта", target: sitePositions }),
    occurrence({ sentenceId: "competitor-2:s1", text: "SEO курсы улучшили позиции сайта.", documentId: "competitor-2", verbSurface: "улучшили", objectSurface: "позиции сайта", target: sitePositions }),
  ];
  const result = aggregateDeterministicTriplets(candidates, [...promotion, ...positions]);
  assert.equal(result.edges.length, 2);
  assert.deepEqual(new Set(result.edges.map((edge) => edge.sourceId)), new Set([seoCourses.id]));
  assert.deepEqual(new Set(result.edges.map((edge) => edge.targetId)), new Set([sitePromotion.id, sitePositions.id]));
});

test("offset validation uses Unicode code points and rejects ungrounded output", () => {
  const unicode = occurrence({
    sentenceId: "own:s9",
    text: "🚀 SEO курсы улучшают позиции сайта.",
    documentId: "own",
    verbSurface: "улучшают",
    objectSurface: "позиции сайта",
    target: sitePositions,
    tokenOffset: 1,
  });
  const invalid = structuredClone(unicode);
  invalid.object.surface = "выдуманные позиции";
  const result = aggregateDeterministicTriplets(candidates, [unicode, invalid], { minSentenceSupport: 1 });
  assert.equal(result.edges.length, 1);
  assert.equal(result.validOccurrences, 1);
  assert.equal(result.rejectedOccurrences, 1);
  assert.equal(result.rejectionReasons.surface_grounding, 1);
});

test("negated and affirmative observations are different relations", () => {
  const affirmative = [
    occurrence({ sentenceId: "own:s1", text: "SEO курсы улучшают позиции сайта.", documentId: "own", verbSurface: "улучшают", objectSurface: "позиции сайта", target: sitePositions }),
    occurrence({ sentenceId: "competitor-1:s1", text: "SEO курсы улучшили позиции сайта.", documentId: "competitor-1", verbSurface: "улучшили", objectSurface: "позиции сайта", target: sitePositions }),
  ];
  const negated = affirmative.map((item, index) => ({
    ...structuredClone(item),
    negated: true,
    evidence: { ...structuredClone(item.evidence), sentenceId: `${item.evidence.document.id}:negative-${index}` },
  }));
  const result = aggregateDeterministicTriplets(candidates, [...affirmative, ...negated]);
  assert.equal(result.edges.length, 2);
  assert.deepEqual(new Set(result.edges.map((edge) => edge.negated)), new Set([false, true]));
});
