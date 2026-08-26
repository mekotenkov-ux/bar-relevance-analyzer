import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("semantic-v3-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const environment = () => ({
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
});

const context = () => ({
  waitUntil() {},
  passThroughOnException() {},
});

async function postAnalysis(worker, payload) {
  const response = await worker.fetch(
    new Request("http://localhost/api/analyze-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    environment(),
    context(),
  );
  const data = await response.json();
  return { response, data };
}

const spanishCompetitors = [
  {
    name: "Academia Uno",
    position: 1,
    text: "La auditoría técnica SEO detecta errores de indexación, rastreo, arquitectura, rendimiento y enlaces internos. El curso SEO enseña estrategia de contenidos, investigación de palabras clave, analítica web, optimización para buscadores y medición de resultados. Los estudiantes practican con proyectos, informes, herramientas profesionales y ejemplos reales para mejorar sitios comerciales.",
  },
  {
    name: "Escuela Dos",
    position: 2,
    text: "Nuestro curso avanzado de SEO incluye auditoría técnica, análisis de indexación, arquitectura web, velocidad, enlaces internos y contenido duplicado. La estrategia de contenidos combina palabras clave, intención de búsqueda, analítica, optimización, planificación editorial y ejercicios prácticos para empresas, tiendas y medios digitales.",
  },
  {
    name: "Instituto Tres",
    position: 3,
    text: "Aprende SEO mediante una auditoría técnica completa del sitio. Revisamos rastreo, indexación, rendimiento, arquitectura, enlazado interno y calidad del contenido. El programa desarrolla estrategia de contenidos, investigación de palabras clave, informes de analítica web, optimización continua, talleres guiados y casos empresariales reales.",
  },
  {
    name: "Centro Cuatro",
    position: 4,
    text: "La formación SEO profesional cubre auditoría técnica, errores de rastreo, indexación, rendimiento móvil, arquitectura y enlaces internos. También explica estrategia de contenidos, selección de palabras clave, intención del usuario, analítica web, optimización de páginas, planificación de campañas, evaluación de resultados y prácticas con proyectos reales.",
  },
];

const spanishOwnPage = {
  name: "Nuestra página",
  text: "Curso práctico de marketing digital para profesionales. El programa presenta fundamentos de SEO, contenidos, analítica, campañas, planificación, investigación, comunicación, medición, herramientas, proyectos y ejercicios. Los alumnos estudian ejemplos reales, preparan informes, revisan resultados y desarrollan una estrategia digital para empresas y tiendas en internet.",
};

const workerPromise = loadWorker();
let spanishInitialPromise;

function initialSpanishAnalysis() {
  if (!spanishInitialPromise) {
    spanishInitialPromise = workerPromise.then(async (worker) => {
      const result = await postAnalysis(worker, {
        queries: ["auditoría técnica seo", "estrategia de contenidos"],
        serpQuery: "curso seo",
        language: "es",
        competitors: spanishCompetitors,
        ownPage: spanishOwnPage,
        search: { engine: "google", region: "es", device: "desktop", found: spanishCompetitors.length },
      });
      assert.equal(result.response.status, 200, result.data.error || "initial analysis failed");
      return result.data;
    });
  }
  return spanishInitialPromise;
}

function findTermByForm(report, form) {
  return report.terms.find((row) => row.term === form || row.forms.includes(form));
}

function rawImportance(row, exactQueryMatch) {
  return row.competitorTfidf * row.df * (exactQueryMatch ? 2 : 1) * (row.df >= 0.5 ? 1.15 : 1);
}

function normalizedImportance(rows, row, exactQueryMatch) {
  const maximum = Math.max(0, ...rows.map((candidate) => rawImportance(candidate, candidate.keywordHit ?? false)));
  const raw = rawImportance(row, exactQueryMatch);
  return Math.round(Math.max(1, maximum > 0 ? raw / maximum * 100 : 0) * 10) / 10;
}

test("initial analysis accepts text inputs and returns a reusable corpus snapshot", async () => {
  const report = await initialSpanishAnalysis();

  assert.deepEqual(report.meta.queries, ["auditoría técnica seo", "estrategia de contenidos"]);
  assert.equal(report.meta.serpQuery, "curso seo");
  assert.equal(report.meta.competitorsAnalyzed, spanishCompetitors.length);
  assert.equal(report.warnings.length, 0);
  assert.equal(report.snapshot.version, 5);
  assert.equal(report.snapshot.competitors.length, spanishCompetitors.length);
  assert.equal(report.snapshot.own.name, spanishOwnPage.name);
  assert.equal(report.meta.snapshotId, report.snapshot.id);
  assert.ok(report.snapshot.id.length >= 8);
  assert.ok(report.terms.length > 0);
  assert.ok(report.ngrams.length > 0);
});

test("snapshot recalculation performs no fetch and preserves corpus benchmarks", async () => {
  const initial = await initialSpanishAnalysis();
  const worker = await workerPromise;
  const stableBefore = findTermByForm(initial, "seo");
  assert.ok(stableBefore, "the shared SEO term must be present before recalculation");

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("snapshot recalculation attempted a network fetch");
  };

  let result;
  try {
    result = await postAnalysis(worker, {
      queries: ["curso seo avanzado", "investigación de palabras clave"],
      snapshot: initial.snapshot,
      language: "es",
      ownPage: { url: "https://must-not-be-fetched.invalid/own" },
      competitors: [{ url: "https://must-not-be-fetched.invalid/competitor" }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(result.response.status, 200, result.data.error || "snapshot recalculation failed");
  assert.equal(fetchCalls, 0);
  assert.equal(result.data.snapshot.id, initial.snapshot.id);
  assert.equal(result.data.meta.snapshotId, initial.meta.snapshotId);

  const stableAfter = result.data.terms.find((row) => row.key === stableBefore.key);
  assert.ok(stableAfter, "the same corpus term must remain after recalculation");
  for (const field of ["sites", "df", "idf", "competitorTfidf", "medianFrequency", "q25", "q75"]) {
    assert.equal(stableAfter[field], stableBefore[field], `${field} changed despite reusing the same corpus`);
  }
});

test("lemmas keep their TF-IDF formula while N-grams expose bounded phrase relevance", async () => {
  const report = await initialSpanishAnalysis();
  const lemmaCandidates = report.terms.slice(0, 25);
  const ngramCandidates = report.ngrams.slice(0, 15);
  assert.ok(lemmaCandidates.length > 0);
  assert.ok(ngramCandidates.length > 0);

  for (const row of lemmaCandidates) {
    const expected = normalizedImportance(report.terms, row, row.keywordHit);
    assert.ok(
      Math.abs(row.importance - expected) <= 0.6,
      `${row.term}: expected lemma importance ${expected}, received ${row.importance}`,
    );
    assert.ok(row.df >= 0 && row.df <= 1);
    assert.ok(row.tfidfNormalized >= 0 && row.tfidfNormalized <= 1);
    assert.equal(typeof row.keywordHit, "boolean");
    assert.equal(Object.hasOwn(row, "cosine"), false);
    assert.ok(row.importance >= 0 && row.importance <= 100);
  }

  for (const row of ngramCandidates) {
    assert.ok(row.df >= 0 && row.df <= 1);
    assert.ok(row.tfidfNormalized >= 0 && row.tfidfNormalized <= 1);
    assert.ok(row.keySimilarity >= 0 && row.keySimilarity <= 1);
    assert.equal(Object.hasOwn(row, "cosine"), false);
    assert.ok(row.importance >= 0 && row.importance <= 100);
  }
});

test("multiple keys keep the best matching keyword for each term", async () => {
  const report = await initialSpanishAnalysis();
  const auditTerm = findTermByForm(report, "auditoría");
  const contentTerm = findTermByForm(report, "contenidos");

  assert.ok(auditTerm, "auditoría must be visible as a readable Spanish form");
  assert.ok(contentTerm, "contenidos must be visible as a readable Spanish form");
  assert.equal(auditTerm.bestKeyword, "auditoría técnica seo");
  assert.equal(contentTerm.bestKeyword, "estrategia de contenidos");
  assert.equal(auditTerm.keywordHit, true);
  assert.equal(contentTerm.keywordHit, true);
  assert.equal(Object.hasOwn(auditTerm, "cosine"), false);
  assert.equal(Object.hasOwn(contentTerm, "cosine"), false);
});

test("Spanish analysis preserves accented surface forms and uses Spanish morphology", async () => {
  const report = await initialSpanishAnalysis();
  assert.equal(report.meta.language, "es");

  const auditTerm = findTermByForm(report, "auditoría");
  const optimizationTerm = findTermByForm(report, "optimización");
  assert.ok(auditTerm?.forms.includes("auditoría"));
  assert.ok(optimizationTerm?.forms.includes("optimización"));
  assert.ok(report.terms.some((row) => row.forms.some((form) => /[áéíóúñ]/u.test(form))));
});

test("Chinese text without spaces is segmented with Intl.Segmenter", async () => {
  const worker = await workerPromise;
  const common = "搜索引擎优化课程帮助企业学习网站分析内容策略关键词研究技术审计链接建设用户体验数据监测";
  const competitors = [
    { name: "中文页面一", text: `${common}。${common}。搜索优化课程提供案例练习和专业指导。` },
    { name: "中文页面二", text: `${common}。${common}。企业通过搜索课程改善内容质量和网站体验。` },
    { name: "中文页面三", text: `${common}。${common}。技术团队学习搜索策略分析关键词和优化方法。` },
  ];
  const ownPage = { name: "我们的页面", text: `${common}。数字营销培训介绍网站内容数据和用户研究。${common}。` };

  const { response, data } = await postAnalysis(worker, {
    queries: ["搜索引擎优化", "关键词研究"],
    serpQuery: "搜索优化课程",
    language: "zh",
    competitors,
    ownPage,
    search: { engine: "google", region: "cn", device: "mobile", found: competitors.length },
  });

  assert.equal(response.status, 200, data.error || "Chinese analysis failed");
  assert.equal(data.meta.language, "zh");
  assert.ok(data.snapshot.competitors.every((document) => document.wordCount >= 40));
  assert.ok(data.snapshot.competitors.every((document) => document.uniqueTerms >= 15));
  assert.ok(findTermByForm(data, "搜索"));
  assert.ok(findTermByForm(data, "课程"));
  assert.ok(data.ngrams.length > 0);
});

test("an incompatible snapshot version is rejected", async () => {
  const initial = await initialSpanishAnalysis();
  const worker = await workerPromise;
  const invalidSnapshot = structuredClone(initial.snapshot);
  invalidSnapshot.version = 999;

  const { response, data } = await postAnalysis(worker, {
    queries: ["curso seo"],
    snapshot: invalidSnapshot,
  });

  assert.equal(response.status, 400);
  assert.equal(typeof data.error, "string");
  assert.ok(data.error.length > 10);
  assert.equal(data.snapshot, undefined);
});
