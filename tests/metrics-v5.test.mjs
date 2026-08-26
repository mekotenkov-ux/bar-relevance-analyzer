import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("metrics-v5-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const environment = () => ({
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
});
const context = () => ({ waitUntil() {}, passThroughOnException() {} });

async function postAnalysis(worker, payload) {
  const response = await worker.fetch(new Request("http://localhost/api/analyze-run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }), environment(), context());
  const data = await response.json();
  assert.equal(response.status, 200, data.error || "metric analysis failed");
  return data;
}

const FILLERS = [
  "gamma", "delta", "epsilon", "zeta", "theta", "lambda", "kappa", "sigma",
  "omega", "vector", "matrix", "ranking", "content", "strategy", "audit",
  "search", "traffic", "market", "signal", "cluster", "document", "phrase",
  "semantic", "technical", "indexing", "crawler", "website", "research",
];

function metricText(alphaCount, betaCount, includeSimilarityPair = false, total = 120) {
  const tokens = [
    ...Array(alphaCount).fill("alpha"),
    ...Array(betaCount).fill("beta"),
  ];
  if (includeSimilarityPair) tokens.push("alpha", "quasar", "nebula", "vortex");
  for (let index = tokens.length; index < total; index += 1) {
    tokens.push(FILLERS[(index - alphaCount - betaCount) % FILLERS.length]);
  }
  return tokens.join(" ");
}

const competitors = [1, 2, 3, 4].map((alphaCount, index) => ({
  name: `Benchmark ${index + 1}`,
  position: index + 1,
  text: metricText(alphaCount, 1, index < 2),
}));

const QUERY = "alpha alpha beta";
let fixturePromise;
let zeroTargetFixturePromise;

async function metricFixture() {
  if (!fixturePromise) {
    fixturePromise = loadWorker().then(async (worker) => {
      const report = await postAnalysis(worker, {
        queries: [QUERY],
        serpQuery: "alpha beta",
        language: "en",
        competitors,
        ownPage: { name: "Own baseline", text: metricText(1, 1) },
        search: { engine: "google", region: "us", device: "desktop", found: competitors.length },
      });
      return { worker, report };
    });
  }
  return fixturePromise;
}

const ZERO_TARGET_QUERY = "alpha";
const ZERO_TARGET_TERMS = [
  "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india",
  "juliet", "kilo", "lima", "mango", "nectar", "orbit", "pixel", "quartz", "radar",
];

function zeroTargetText(index, includeMarker = false) {
  const steps = [1, 5, 7, 11, 13, 17];
  const step = steps[index % steps.length];
  const tokens = [];
  for (let roundIndex = 0; roundIndex < 6; roundIndex += 1) {
    for (let termIndex = 0; termIndex < ZERO_TARGET_TERMS.length; termIndex += 1) {
      tokens.push(ZERO_TARGET_TERMS[(termIndex * step + roundIndex + index) % ZERO_TARGET_TERMS.length]);
    }
  }
  if (includeMarker) tokens.push("zeromarker", "raresignal");
  return tokens.join(" ");
}

async function zeroTargetFixture() {
  if (!zeroTargetFixturePromise) {
    zeroTargetFixturePromise = loadWorker().then(async (worker) => {
      const zeroCompetitors = Array.from({ length: 5 }, (_, index) => ({
        name: `Zero target ${index + 1}`,
        position: index + 1,
        text: zeroTargetText(index, index < 2),
      }));
      const report = await postAnalysis(worker, {
        queries: [ZERO_TARGET_QUERY],
        serpQuery: ZERO_TARGET_QUERY,
        language: "en",
        competitors: zeroCompetitors,
        ownPage: { name: "Zero target own", text: zeroTargetText(5) },
        search: { engine: "google", region: "us", device: "desktop", found: zeroCompetitors.length },
      });
      return { worker, report };
    });
  }
  return zeroTargetFixturePromise;
}

function rounded(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function quantile(values, probability) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * probability;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function countsOf(document, field) {
  return new Map(document[field]);
}

function queryRaw(document, corpus) {
  const weights = new Map([["alpha", 2], ["beta", 1]]);
  const termCounts = countsOf(document, "termCounts");
  const totalWeight = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  let weighted = 0;
  for (const [key, weight] of weights) {
    const df = corpus.filter((candidate) => countsOf(candidate, "termCounts").has(key)).length;
    const idf = Math.log((corpus.length + 1) / (df + 1)) + 1;
    weighted += weight * ((termCounts.get(key) ?? 0) / Math.max(1, document.contentWordCount) * idf * 1_000);
  }
  return weighted / totalWeight;
}

function expectedSignals(report) {
  const terms = [...report.terms].sort((left, right) => right.importance - left.importance).slice(0, 30)
    .map((row) => ({ key: row.key, importance: row.importance, target: row.medianCount, kind: "term" }));
  const responseByKey = new Map(report.ngrams.map((row) => [row.key, row]));
  const corpusOrder = new Set(report.snapshot.competitors.flatMap((document) => document.ngramCounts.map(([key]) => key)));
  const availableInCorpusOrder = [...corpusOrder].map((key) => responseByKey.get(key)).filter(Boolean);
  assert.equal(availableInCorpusOrder.length, report.ngrams.length, "the compact fixture must expose its complete accepted N-gram universe");
  const competitorCount = report.snapshot.competitors.length;
  const documentRawWeights = new Map(availableInCorpusOrder.map((row) => {
    const counts = report.snapshot.competitors.map((document) => countsOf(document, "ngramCounts").get(row.key) ?? 0);
    const sites = counts.filter((count) => count > 0).length;
    const idf = Math.log((competitorCount + 1) / (sites + 1)) + 1;
    const competitorTfidf = counts.reduce((sum, count, index) => {
      const contentWords = report.snapshot.competitors[index].contentWordCount;
      return sum + count / Math.max(1, contentWords - 1) * idf * 1_000;
    }, 0) / competitorCount;
    return [row.key, competitorTfidf * (sites / competitorCount)];
  }));
  const maximumDocumentRawWeight = Math.max(0, ...documentRawWeights.values());
  const ngrams = availableInCorpusOrder
    .map((row) => ({
      key: row.key,
      importance: maximumDocumentRawWeight > 0 ? (documentRawWeights.get(row.key) ?? 0) / maximumDocumentRawWeight * 100 : 0,
      target: row.medianCount,
      sites: row.sites,
      kind: "ngram",
    }))
    .filter((row) => row.importance > 0)
    .sort((left, right) => right.importance - left.importance || right.sites - left.sites || left.key.localeCompare(right.key, "en"))
    .slice(0, 20)
    .map((row) => ({ key: row.key, importance: row.importance, target: row.target, kind: row.kind }));
  return { terms, ngrams, all: [...terms, ...ngrams] };
}

function expectedCoverageAndDensity(report, document) {
  const signals = expectedSignals(report);
  const termCounts = countsOf(document, "termCounts");
  const ngramCounts = countsOf(document, "ngramCounts");
  let earned = 0;
  let densityEarned = 0;
  let possible = 0;
  let earnedTerms = 0;
  let earnedNgrams = 0;
  for (const signal of signals.all) {
    const weight = Math.max(0, signal.importance);
    const count = signal.kind === "term" ? termCounts.get(signal.key) ?? 0 : ngramCounts.get(signal.key) ?? 0;
    const contribution = weight * (count > 0 ? 1 : 0);
    const fulfillment = signal.target > 0 ? Math.min(1, count / signal.target) : count > 0 ? 1 : 0;
    earned += contribution;
    if (signal.kind === "term") earnedTerms += contribution;
    else earnedNgrams += contribution;
    densityEarned += weight * fulfillment;
    possible += weight;
  }
  return {
    coverage: possible ? earned / possible * 100 : 0,
    density: possible ? densityEarned / possible * 100 : 0,
    earnedTerms,
    earnedNgrams,
    termSignalCount: signals.terms.length,
    ngramSignalCount: signals.ngrams.length,
  };
}

function responseDocumentForSnapshot(report, snapshotDocument, ours = false) {
  return report.documents.find((document) => document.ours === ours && document.name === snapshotDocument.name);
}

const FORBIDDEN_METRICS = [
  "relevance", "queryRelevance", "similarity", "competitorSimilarity",
  "semanticCoverage", "ngramCoverage", "coverage", "cosine",
];

function assertNewMetricContract(value, label) {
  for (const field of ["keyTfidfRaw", "keyTfidfScore", "weightedCoverage", "weightedDensity"]) {
    assert.equal(typeof value[field], "number", `${label}.${field} must be numeric`);
    assert.ok(Number.isFinite(value[field]), `${label}.${field} must be finite`);
  }
  assert.ok(value.keyTfidfRaw >= 0);
  assert.ok(value.keyTfidfScore >= 0 && value.keyTfidfScore <= 100);
  assert.ok(value.weightedCoverage >= 0 && value.weightedCoverage <= 100);
  assert.ok(value.weightedDensity >= 0 && value.weightedDensity <= value.weightedCoverage && value.weightedDensity <= 100);
  for (const oldField of FORBIDDEN_METRICS) {
    assert.equal(Object.hasOwn(value, oldField), false, `${label} still exposes retired metric ${oldField}`);
  }
}

test("key TF-IDF raw and score use the competitors' Q75 benchmark only", { concurrency: false }, async () => {
  const { report } = await metricFixture();
  const corpus = report.snapshot.competitors;
  const competitorRaw = corpus.map((document) => queryRaw(document, corpus));
  const benchmark = quantile(competitorRaw, .75);

  for (const snapshotDocument of [...corpus, report.snapshot.own]) {
    const ours = snapshotDocument === report.snapshot.own;
    const document = responseDocumentForSnapshot(report, snapshotDocument, ours);
    assert.ok(document, `missing response document ${snapshotDocument.name}`);
    const raw = queryRaw(snapshotDocument, corpus);
    const score = benchmark > 0 ? Math.min(100, Math.max(0, raw / benchmark * 100)) : raw > 0 ? 100 : 0;
    assert.equal(document.keyTfidfRaw, rounded(raw, 3));
    assert.equal(document.keyTfidfScore, rounded(score, 1));
  }

  const own = report.documents.find((document) => document.ours);
  assert.ok(own);
  for (const field of ["keyTfidfRaw", "keyTfidfScore", "weightedCoverage", "weightedDensity"]) {
    assert.equal(report.summary[field], own[field], `summary.${field} must use the same document metric implementation`);
  }
});

test("weighted coverage is binary while density is weighted fulfillment of integer competitor targets", { concurrency: false }, async () => {
  const { report } = await metricFixture();
  const own = report.documents.find((document) => document.ours);
  assert.ok(own);
  const expected = expectedCoverageAndDensity(report, report.snapshot.own);

  assert.equal(expected.termSignalCount, Math.min(30, report.terms.length));
  assert.equal(expected.ngramSignalCount, Math.min(20, report.ngrams.length));
  assert.ok(expected.earnedTerms > 0, "the fixture must earn coverage from important lemmas");
  assert.ok(expected.earnedNgrams > 0, "the fixture must earn coverage from important phrases");
  assert.equal(own.weightedCoverage, rounded(expected.coverage, 1));
  assert.equal(own.weightedDensity, rounded(expected.density, 1));
});

function snapshotWithSignalCount(snapshotValue, signal, count) {
  const snapshot = structuredClone(snapshotValue);
  const field = signal.kind === "term" ? "termCounts" : "ngramCounts";
  const counts = new Map(snapshot.own[field]);
  if (count > 0) counts.set(signal.key, count);
  else counts.delete(signal.key);
  snapshot.own[field] = [...counts];
  return snapshot;
}

test("snapshot recalculation makes zero fetches, keeps benchmarks, and caps density at the target", { concurrency: false }, async () => {
  const { worker, report: initial } = await metricFixture();
  const signal = expectedSignals(initial).all.find((candidate) => candidate.importance > 0 && candidate.target > 1);
  assert.ok(signal, "fixture needs a positively weighted signal with an integer target above one");

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("snapshot metric recalculation attempted a network request");
  };

  let once;
  let atTarget;
  let beyondTarget;
  try {
    once = await postAnalysis(worker, { queries: [QUERY], language: "en", snapshot: snapshotWithSignalCount(initial.snapshot, signal, 1) });
    atTarget = await postAnalysis(worker, { queries: [QUERY], language: "en", snapshot: snapshotWithSignalCount(initial.snapshot, signal, signal.target) });
    beyondTarget = await postAnalysis(worker, { queries: [QUERY], language: "en", snapshot: snapshotWithSignalCount(initial.snapshot, signal, signal.target + 25) });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalls, 0);
  assert.equal(once.meta.snapshotId, initial.meta.snapshotId);
  assert.equal(atTarget.meta.snapshotId, initial.meta.snapshotId);
  assert.equal(beyondTarget.meta.snapshotId, initial.meta.snapshotId);
  assert.equal(once.summary.weightedCoverage, atTarget.summary.weightedCoverage, "repetitions must not increase binary coverage");
  assert.equal(atTarget.summary.weightedCoverage, beyondTarget.summary.weightedCoverage, "coverage stays binary beyond the target");
  assert.ok(atTarget.summary.weightedDensity > once.summary.weightedDensity, "repetitions below the target must increase fulfillment density");
  assert.equal(beyondTarget.summary.weightedDensity, atTarget.summary.weightedDensity, "repetitions beyond the target must be capped");
  for (const report of [once, atTarget, beyondTarget]) {
    const expected = expectedCoverageAndDensity(report, report.snapshot.own);
    assert.equal(report.summary.weightedCoverage, rounded(expected.coverage, 1));
    assert.equal(report.summary.weightedDensity, rounded(expected.density, 1));
  }

  for (const competitor of initial.documents.filter((document) => !document.ours)) {
    const onceDocument = once.documents.find((document) => !document.ours && document.name === competitor.name);
    const atTargetDocument = atTarget.documents.find((document) => !document.ours && document.name === competitor.name);
    const beyondDocument = beyondTarget.documents.find((document) => !document.ours && document.name === competitor.name);
    assert.ok(onceDocument && atTargetDocument && beyondDocument);
    assert.equal(onceDocument.keyTfidfRaw, competitor.keyTfidfRaw);
    assert.equal(onceDocument.keyTfidfScore, competitor.keyTfidfScore);
    assert.equal(atTargetDocument.keyTfidfRaw, competitor.keyTfidfRaw);
    assert.equal(atTargetDocument.keyTfidfScore, competitor.keyTfidfScore);
    assert.equal(beyondDocument.keyTfidfRaw, competitor.keyTfidfRaw);
    assert.equal(beyondDocument.keyTfidfScore, competitor.keyTfidfScore);
  }
});

test("every emitted metric signal has a positive actionable integer target", { concurrency: false }, async () => {
  const { report } = await zeroTargetFixture();
  const signals = expectedSignals(report).all;
  assert.ok(signals.length > 0);
  for (const signal of signals) {
    assert.ok(Number.isInteger(signal.target), `${signal.kind} ${signal.key}: target must be an integer`);
    assert.ok(signal.target >= 1, `${signal.kind} ${signal.key}: emitted target must be at least one`);
    assert.ok(signal.importance >= 1, `${signal.kind} ${signal.key}: emitted importance must be at least one`);
  }
});

test("N-gram phrase similarity affects phrase importance but stays out of document metric formulas", { concurrency: false }, async () => {
  const { report } = await metricFixture();
  assert.ok(new Set(report.ngrams.map((row) => row.keySimilarity)).size > 1, "fixture must exercise multiple similarity values");
  for (const row of report.ngrams) {
    assert.ok(Number.isFinite(row.importance));
    assert.ok(row.importance >= 0 && row.importance <= 100);
  }
  assert.match(report.methodology.weightedCoverage, /30.*20|лемм.*фраз/iu);
  assert.match(report.methodology.weightedDensity, /тех же|лемм.*фраз/iu);
  assert.doesNotMatch(`${report.methodology.weightedCoverage} ${report.methodology.weightedDensity}`, /similarity|сходств/iu);

  const core = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../lib/semantic-analysis.ts", import.meta.url), "utf8"));
  const documentWeightBlock = core.slice(core.indexOf("const ngramDocumentWeightRaw"), core.indexOf("const ngramSemantics"));
  const documentSignalBlock = core.slice(core.indexOf("const importantNgrams = baseNgrams"), core.indexOf("const importantSignals"));
  assert.match(documentWeightBlock, /competitorTfidf\s*\*\s*\(row\.sites\s*\/\s*competitorCount\)/u);
  assert.doesNotMatch(`${documentWeightBlock}\n${documentSignalBlock}`, /keySimilarity|ngramSemantics|allNgramRows/u, "document phrase weights must not consume phrase similarity or outward importance");
});

test("the public report exposes only the three document metrics and bounded N-gram key similarity", { concurrency: false }, async () => {
  const { report } = await metricFixture();
  assertNewMetricContract(report.summary, "summary");
  for (const [index, document] of report.documents.entries()) {
    assertNewMetricContract(document, `documents[${index}]`);
  }

  assert.ok(report.ngrams.length > 0);
  for (const row of report.ngrams) {
    assert.equal(typeof row.keySimilarity, "number");
    assert.ok(Number.isFinite(row.keySimilarity));
    assert.ok(row.keySimilarity >= 0 && row.keySimilarity <= 1);
    assert.equal(Object.hasOwn(row, "cosine"), false);
  }

  const outwardMetricJson = JSON.stringify({
    meta: report.meta,
    summary: report.summary,
    documents: report.documents,
    methodology: report.methodology,
    ngrams: report.ngrams,
  });
  assert.doesNotMatch(outwardMetricJson, /cosine|косинус/iu);
});
