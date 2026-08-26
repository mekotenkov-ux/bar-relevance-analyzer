import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("density-nesting-v12", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const environment = () => ({ ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } });
const context = () => ({ waitUntil() {}, passThroughOnException() {} });

async function postAnalysis(worker, payload) {
  const response = await worker.fetch(new Request("http://localhost/api/analyze-run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }), environment(), context());
  const data = await response.json();
  assert.equal(response.status, 200, data.error || "analysis failed");
  return data;
}

const FILLERS = [
  "vector", "matrix", "ranking", "strategy", "traffic", "market", "signal", "cluster",
  "document", "phrase", "semantic", "technical", "indexing", "crawler", "website", "research",
  "lesson", "student", "teacher", "practice", "project", "report", "result", "growth",
  "engine", "keyword", "topic", "structure", "analytics", "promotion", "method", "quality",
];

function sizedPairText(totalWords, pairCount) {
  const tokens = [];
  for (let index = 0; index < pairCount; index += 1) tokens.push("alpha", "beta");
  for (let index = tokens.length; index < totalWords; index += 1) tokens.push(FILLERS[index % FILLERS.length]);
  return tokens.join(" ");
}

function rowBySurface(rows, field, surface) {
  const wanted = surface.toLowerCase();
  return rows.find((row) => [row[field], ...(row.forms ?? [])].some((value) => String(value).toLowerCase() === wanted));
}

function setSyntheticZone(document, zone, words, alphaCount, phraseCount) {
  const allZone = document.zones.all;
  document.zones[zone] = {
    available: true,
    wordCount: words,
    contentWordCount: words,
    termCounts: [["alpha", alphaCount], ["beta", phraseCount]],
    termForms: [["alpha", [["alpha", alphaCount]]], ["beta", [["beta", phraseCount]]]],
    ngramCounts: [["alpha beta", phraseCount]],
    ngramNesting: [],
  };
  assert.ok(allZone, "snapshot must retain its original all zone");
}

test("lemma and N-gram targets scale by our zone volume and remain integer targets of at least one", async () => {
  const worker = await loadWorker();
  const competitors = Array.from({ length: 4 }, (_, index) => ({
    name: `Competitor ${index + 1}`,
    text: sizedPairText(120, 4),
  }));
  const initial = await postAnalysis(worker, {
    queries: ["alpha beta"],
    serpQuery: "alpha beta",
    language: "en",
    ownPage: { name: "Own", text: sizedPairText(60, 2) },
    competitors,
  });

  const snapshot = structuredClone(initial.snapshot);
  for (const document of snapshot.competitors) {
    for (const zone of ["title", "h1", "headings", "text", "anchors"]) {
      setSyntheticZone(document, zone, 20, 4, 2);
    }
  }
  for (const zone of ["title", "h1", "headings", "text", "anchors"]) {
    setSyntheticZone(snapshot.own, zone, 10, 2, 1);
  }

  const report = await postAnalysis(worker, {
    queries: ["alpha beta"],
    language: "en",
    snapshot,
  });
  const alpha = rowBySurface(report.terms, "term", "alpha");
  const phrase = rowBySurface(report.ngrams, "phrase", "alpha beta");
  assert.ok(alpha, "alpha lemma must be present");
  assert.ok(phrase, "alpha beta N-gram must be present");

  assert.equal(alpha.densityFactor, 0.5);
  assert.equal(alpha.benchmarkWords, 120);
  assert.equal(alpha.ownWords, 60);
  assert.equal(alpha.medianCount, 2, "global lemma target 4 must scale to 2");
  assert.equal(phrase.medianCount, 2, "global phrase target 4 must scale to 2");
  assert.equal(alpha.status, "Норма", "a value inside the displayed range cannot be Add");
  assert.equal(phrase.status, "Норма", "a phrase inside the displayed range cannot be Add");

  for (const zone of ["title", "h1", "headings", "text", "anchors"]) {
    assert.equal(alpha.zones[zone].densityFactor, 0.5, `${zone}: lemma density factor`);
    assert.equal(alpha.zones[zone].benchmarkWords, 20, `${zone}: competitor benchmark`);
    assert.equal(alpha.zones[zone].ownWords, 10, `${zone}: own volume`);
    assert.equal(alpha.zones[zone].medianCount, 2, `${zone}: lemma target`);
    assert.equal(phrase.zones[zone].medianCount, 1, `${zone}: phrase target`);
    assert.equal(alpha.zones[zone].status, "Норма", `${zone}: lemma is inside range`);
    assert.equal(phrase.zones[zone].status, "Норма", `${zone}: phrase is inside range`);
  }

  for (const row of [...report.terms, ...report.ngrams]) {
    assert.ok(Number.isInteger(row.medianCount) && row.medianCount >= 1);
    assert.ok(Number.isInteger(row.q25Count) && row.q25Count >= 1);
    assert.ok(Number.isInteger(row.q75Count) && row.q75Count >= 1);
  }
  assert.equal(report.snapshot.id, snapshot.id, "snapshot recalculation must preserve identity");
});

test("targets and weighted density scale upward for a page longer than the competitor benchmark", async () => {
  const worker = await loadWorker();
  const competitorText = sizedPairText(120, 4);
  const report = await postAnalysis(worker, {
    queries: ["alpha beta"],
    serpQuery: "alpha beta",
    language: "en",
    ownPage: { name: "Own", text: `${competitorText}\n${competitorText}` },
    competitors: Array.from({ length: 4 }, (_, index) => ({
      name: `Competitor ${index + 1}`,
      text: competitorText,
    })),
  });
  const alpha = rowBySurface(report.terms, "term", "alpha");
  const phrase = rowBySurface(report.ngrams, "phrase", "alpha beta");
  const ownDocument = report.documents.find((document) => document.ours);
  assert.ok(alpha && phrase && ownDocument);
  assert.equal(alpha.densityFactor, 2);
  assert.equal(alpha.medianCount, 8);
  assert.equal(phrase.medianCount, 8);
  assert.equal(alpha.status, "Норма");
  assert.equal(phrase.status, "Норма");
  assert.equal(ownDocument.weightedDensity, 100, "document density must use the same length-normalized targets as the table");
});

function nestingText(partial = false) {
  const filler = Array.from({ length: 64 }, (_, index) => FILLERS[index % FILLERS.length]).join(" ");
  return [
    filler,
    "google search console",
    "google search console",
    "content audit platform",
    partial ? "content audit" : "content audit platform",
    "technical semantic audit",
    "semantic audit platform",
  ].join("\n");
}

async function nestingFixture(worker) {
  return postAnalysis(worker, {
    queries: ["google search"],
    serpQuery: "google search",
    language: "en",
    ownPage: { name: "Own", text: nestingText(true) },
    competitors: Array.from({ length: 4 }, (_, index) => ({
      name: `Nesting competitor ${index + 1}`,
      text: nestingText(true),
    })),
  });
}

test("positional nesting distinguishes a fully covered short phrase from a partially independent phrase", async () => {
  const worker = await loadWorker();
  const report = await nestingFixture(worker);
  const googleSearch = rowBySurface(report.ngrams, "phrase", "google search");
  const contentAudit = rowBySurface(report.ngrams, "phrase", "content audit");
  const semanticAudit = rowBySurface(report.ngrams, "phrase", "semantic audit");
  assert.ok(googleSearch, "google search row must be present");
  assert.ok(contentAudit, "content audit row must be present");
  assert.ok(semanticAudit, "semantic audit row must be present");

  assert.deepEqual(
    {
      classification: googleSearch.nesting.classification,
      complete: googleSearch.nesting.evidenceComplete,
      occurrences: googleSearch.nesting.occurrences,
      nested: googleSearch.nesting.nestedOccurrences,
      standalone: googleSearch.nesting.standaloneOccurrences,
      share: googleSearch.nesting.nestedShare,
    },
    { classification: "fully_nested", complete: true, occurrences: 8, nested: 8, standalone: 0, share: 100 },
  );
  assert.equal(googleSearch.nesting.parents[0].phrase.toLowerCase(), "google search console");
  assert.equal(googleSearch.nesting.parents[0].occurrences, 8);
  assert.equal(googleSearch.nesting.parents[0].sites, 4);
  assert.equal(googleSearch.nesting.mergeable, true);
  assert.equal(googleSearch.nesting.mergeParentPhrase.toLowerCase(), "google search console");

  assert.equal(contentAudit.nesting.classification, "partially_nested");
  assert.equal(contentAudit.nesting.evidenceComplete, true);
  assert.equal(contentAudit.nesting.occurrences, 8);
  assert.equal(contentAudit.nesting.nestedOccurrences, 4);
  assert.equal(contentAudit.nesting.standaloneOccurrences, 4);
  assert.equal(contentAudit.nesting.nestedShare, 50);
  assert.equal(contentAudit.nesting.parents[0].phrase.toLowerCase(), "content audit platform");

  assert.equal(semanticAudit.nesting.classification, "fully_nested");
  assert.equal(semanticAudit.nesting.standaloneOccurrences, 0);
  assert.equal(semanticAudit.nesting.parents.length, 2, "both positional parent phrases must remain visible");
  assert.equal(semanticAudit.nesting.mergeable, false, "multiple parents cannot justify merging into one row");
  assert.equal(semanticAudit.nesting.mergeParentKey, "");

  assert.equal(googleSearch.zones.text.nesting.classification, "fully_nested");
  assert.equal(contentAudit.zones.text.nesting.classification, "partially_nested");
  assert.ok(report.snapshot.competitors.every((document) => document.ngramNesting.length > 0));
});

test("nesting never crosses sentence boundaries and refuses two full-coverage parents", async () => {
  const worker = await loadWorker();
  const filler = Array.from({ length: 64 }, (_, index) => FILLERS[index % FILLERS.length]).join(" ");
  const text = [
    `${filler}.`,
    "google search. Console tools support analytics.",
    "advanced semantic audit platform improves reporting.",
  ].join("\n");
  const report = await postAnalysis(worker, {
    queries: ["search optimization"],
    serpQuery: "search optimization",
    language: "en",
    ownPage: { name: "Own", text },
    competitors: Array.from({ length: 4 }, (_, index) => ({ name: `Boundary competitor ${index + 1}`, text })),
  });
  const googleSearch = rowBySurface(report.ngrams, "phrase", "google search");
  const semanticAudit = rowBySurface(report.ngrams, "phrase", "semantic audit");
  assert.ok(googleSearch && semanticAudit);
  assert.equal(googleSearch.nesting.classification, "independent");
  assert.equal(googleSearch.nesting.standaloneOccurrences, 4);
  assert.equal(googleSearch.nesting.parents.length, 0, "Console in the next sentence cannot become a parent");
  assert.equal(semanticAudit.nesting.classification, "fully_nested");
  assert.equal(semanticAudit.nesting.parents.length, 2);
  assert.ok(semanticAudit.nesting.parents.every((parent) => parent.occurrences === semanticAudit.nesting.occurrences));
  assert.equal(semanticAudit.nesting.mergeable, false, "two equally complete parents are ambiguous");
});

test("own standalone use is retained when competitors only use the short phrase inside one parent", async () => {
  const worker = await loadWorker();
  const filler = Array.from({ length: 64 }, (_, index) => FILLERS[index % FILLERS.length]).join(" ");
  const competitorText = `${filler}. Google search console supports reporting. Google search console supports auditing.`;
  const ownText = `${filler}. Google search helps users. Google search console supports reporting.`;
  const report = await postAnalysis(worker, {
    queries: ["search optimization"],
    serpQuery: "search optimization",
    language: "en",
    ownPage: { name: "Own", text: ownText },
    competitors: Array.from({ length: 4 }, (_, index) => ({ name: `Own-use competitor ${index + 1}`, text: competitorText })),
  });
  const googleSearch = rowBySurface(report.ngrams, "phrase", "google search");
  assert.ok(googleSearch);
  assert.equal(googleSearch.keywordHit, false);
  assert.equal(googleSearch.nesting.classification, "fully_nested");
  assert.equal(googleSearch.nesting.mergeable, true);
  assert.equal(googleSearch.nesting.ownEvidenceComplete, true);
  assert.equal(googleSearch.nesting.ownOccurrences, 2);
  assert.equal(googleSearch.nesting.ownMergeParentOccurrences, 1);
  assert.equal(googleSearch.nesting.ownMergeParentShare, 50);
  assert.equal(googleSearch.nesting.ownMergeParentComplete, false, "our independent context must keep the child row visible");
});

test("snapshot v5 recalculation reuses nesting evidence without fetch and never invents full nesting for old evidence", async () => {
  const worker = await loadWorker();
  const initial = await nestingFixture(worker);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("snapshot recalculation attempted network access"); };
  try {
    const recalculated = await postAnalysis(worker, {
      queries: ["google search"],
      language: "en",
      snapshot: initial.snapshot,
    });
    const initialRow = rowBySurface(initial.ngrams, "phrase", "google search");
    const recalculatedRow = rowBySurface(recalculated.ngrams, "phrase", "google search");
    assert.deepEqual(recalculatedRow.nesting, initialRow.nesting);
    assert.equal(recalculated.snapshot.id, initial.snapshot.id);

    const legacySnapshot = structuredClone(initial.snapshot);
    for (const document of [legacySnapshot.own, ...legacySnapshot.competitors]) {
      delete document.ngramNesting;
      for (const zone of Object.values(document.zones)) delete zone.ngramNesting;
    }
    const legacy = await postAnalysis(worker, {
      queries: ["google search"],
      language: "en",
      snapshot: legacySnapshot,
    });
    const legacyRow = rowBySurface(legacy.ngrams, "phrase", "google search");
    assert.equal(legacyRow.nesting.classification, "insufficient_evidence");
    assert.equal(legacyRow.nesting.evidenceComplete, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
