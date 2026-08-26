import assert from "node:assert/strict";
import test from "node:test";

const E5_URL = "http://127.0.0.1:8093/v1/similarity";

async function loadWorker(label) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("e5-phrase-similarity-v11", `${label}-${process.pid}-${Date.now()}-${Math.random()}`);
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
  return { response, data: await response.json() };
}

const FILLER = [
  "аналитика поискового спроса помогает составлять структуру сайта и план развития проекта",
  "практические задания включают исследование конкурентов работу с контентом и измерение результатов",
  "студенты изучают инструменты маркетинга стратегию продвижения отчётность и веб аналитику",
].join(". ");

function corpusPayload() {
  const competitors = Array.from({ length: 5 }, (_, index) => ({
    name: `Конкурент ${index + 1}`,
    text: [
      "SEO курсы дают системные знания и практику.",
      index < 2 ? "SEO обучение помогает освоить профессию." : "Учебная программа развивает навыки.",
      "Бизнес академия предлагает образовательные программы.",
      index < 4 ? "Технический аудит входит в программу." : "Контентная стратегия входит в программу.",
      index < 2 ? "SMM продвижение разбирается на отдельном занятии." : "Аналитика трафика разбирается на занятии.",
      FILLER,
      FILLER,
    ].join(" "),
  }));
  return {
    queries: ["seo курсы"],
    serpQuery: "seo курсы",
    language: "ru",
    ownPage: { name: "Наша страница", text: `${FILLER}. ${FILLER}.` },
    competitors,
    search: { engine: "yandex", region: "ru", device: "desktop", found: competitors.length },
  };
}

function mockScore(candidate) {
  const normalized = candidate.toLocaleLowerCase("ru-RU");
  if (normalized.includes("seo") && normalized.includes("обуч")) return 0.95;
  if (normalized.includes("smm") && normalized.includes("продвиж")) return 0.94;
  if (normalized.includes("техническ") && normalized.includes("аудит")) return 0.82;
  if (normalized.includes("бизнес") && normalized.includes("академ")) return 0.75;
  if (normalized.includes("seo") && normalized.includes("курс")) return 0.2;
  return 0.7;
}

function rowByWords(report, ...words) {
  return report.ngrams.find((row) => {
    const text = `${row.phrase} ${row.forms.join(" ")}`.toLocaleLowerCase("ru-RU");
    return words.every((word) => text.includes(word));
  });
}

async function withEnvironment(values, callback) {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { return await callback(); }
  finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("E5 replaces only N-gram similarity, preserves DF weighting, and is cached in snapshot", { concurrency: false }, async () => {
  await withEnvironment({ PHRASE_EMBEDDINGS_URL: E5_URL, PHRASE_EMBEDDINGS_CHUNK_SIZE: "512" }, async () => {
    const originalFetch = globalThis.fetch;
    let serviceCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      assert.equal(url, E5_URL);
      serviceCalls += 1;
      const body = JSON.parse(String(init?.body ?? "{}"));
      assert.deepEqual(body.queries, ["seo курсы"]);
      return Response.json({
        ok: true,
        model: "intfloat/multilingual-e5-large-instruct",
        revision: "test-revision",
        dimensions: 1024,
        best: body.candidates.map((candidate) => ({ query_index: 0, score: mockScore(candidate) })),
      });
    };
    try {
      const worker = await loadWorker("service");
      const initial = await postAnalysis(worker, corpusPayload());
      assert.equal(initial.response.status, 200, initial.data.error || "E5 analysis failed");
      assert.equal(serviceCalls, 1, "all compact fixture candidates should fit one E5 batch");
      assert.equal(initial.data.meta.phraseSimilarityEngine, "e5");
      assert.equal(initial.data.meta.phraseSimilarityMethod, "Multilingual E5");
      assert.equal(initial.data.meta.phraseSimilarityCoverage, 100);
      assert.equal(initial.data.snapshot.phraseSimilarity.version, 1);
      assert.deepEqual(initial.data.snapshot.phraseSimilarity.queries, ["seo курсы"]);

      const exact = rowByWords(initial.data, "seo", "курс");
      const business = rowByWords(initial.data, "бизнес", "академ");
      const smm = rowByWords(initial.data, "smm", "продвиж");
      const audit = rowByWords(initial.data, "техническ", "аудит");
      assert.ok(exact && business && smm && audit, "fixture phrases must survive the N-gram filters");
      assert.equal(exact.keySimilarity, 1, "exact query override must stay perfect even if E5 returns 0.2");
      assert.equal(business.keySimilarity, 0.75);
      assert.equal(smm.keySimilarity, 0.94);
      assert.equal(audit.keySimilarity, 0.82);
      assert.ok(business.sites > smm.sites);
      assert.ok(business.importance > smm.importance, "DF must smooth a high E5 score from a rare phrase");
      const expectedBusiness = 100 * Math.pow(business.df * business.keySimilarity, 0.7);
      assert.ok(Math.abs(business.importance - expectedBusiness) <= 0.2, "unboosted importance must remain normalized DF × E5");

      const initialNgrams = structuredClone(initial.data.ngrams);
      const callsBeforeRecalc = serviceCalls;
      globalThis.fetch = async () => {
        serviceCalls += 1;
        throw new Error("snapshot recalculation must not call E5");
      };
      const recalculated = await postAnalysis(worker, {
        queries: ["seo курсы"],
        language: "ru",
        snapshot: initial.data.snapshot,
        stopWords: ["стопкоторогонет"],
      });
      assert.equal(recalculated.response.status, 200, recalculated.data.error || "cached E5 recalculation failed");
      assert.equal(serviceCalls, callsBeforeRecalc);
      assert.equal(recalculated.data.meta.phraseSimilarityMethod, "Multilingual E5 — кэш snapshot");
      assert.deepEqual(recalculated.data.ngrams, initialNgrams);

      const changedQuery = await postAnalysis(worker, {
        queries: ["продвижение сайтов"],
        language: "ru",
        snapshot: initial.data.snapshot,
      });
      assert.equal(changedQuery.response.status, 200, changedQuery.data.error || "local snapshot fallback failed");
      assert.equal(serviceCalls, callsBeforeRecalc);
      assert.equal(changedQuery.data.meta.phraseSimilarityEngine, "local");
      assert.deepEqual(changedQuery.data.snapshot.phraseSimilarity, initial.data.snapshot.phraseSimilarity, "query mismatch must not erase the original E5 cache");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("an unavailable E5 service falls back without changing document metrics", { concurrency: false }, async () => {
  const worker = await loadWorker("fallback");
  const baseline = await withEnvironment({ PHRASE_EMBEDDINGS_URL: undefined }, () => postAnalysis(worker, corpusPayload()));
  assert.equal(baseline.response.status, 200, baseline.data.error || "baseline analysis failed");

  await withEnvironment({ PHRASE_EMBEDDINGS_URL: E5_URL }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("offline", { status: 503 });
    try {
      const fallback = await postAnalysis(worker, corpusPayload());
      assert.equal(fallback.response.status, 200, fallback.data.error || "E5 fallback broke the main report");
      assert.equal(fallback.data.meta.phraseSimilarityEngine, "local");
      assert.match(fallback.data.meta.phraseSimilarityError, /HTTP 503/u);
      assert.deepEqual(fallback.data.terms, baseline.data.terms, "E5 must not affect lemma analytics");
      for (const field of ["keyTfidfScore", "keyTfidfRaw", "weightedCoverage", "weightedDensity"]) {
        assert.equal(fallback.data.summary[field], baseline.data.summary[field], `${field} must remain independent of E5`);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
