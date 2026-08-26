import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("ngram-importance-v10", `${process.pid}-${Date.now()}-${Math.random()}`);
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

const BASE_COPY = [
  "аналитика поискового спроса помогает составить структуру сайта и программу обучения",
  "практические задания включают аудит контента техническую оптимизацию и работу с семантикой",
  "студенты изучают продвижение сайтов исследование конкурентов аналитику трафика и отчётность",
  "преподаватели объясняют стратегию инструменты измерение результатов и развитие проекта",
].join(". ");

function competitorHtml(index, structural) {
  const promotedHeading = structural && index < 4
    ? "<h2>Поисковое продвижение</h2>"
    : "";
  const promotedBody = index < 4 && !(structural && index < 4) ? "Поисковое продвижение помогает развивать проект." : "";
  const queryLemmaPhrase = index < 4 ? "SEO программа включает практику." : "Учебная программа включает практику.";
  const gradedPhrases = [
    index < 5 ? "Международная оптимизация расширяет подход." : "",
    index < 4 ? "Данные исследования уточняют стратегию." : "",
    index < 3 ? "Практический интенсив развивает навыки." : "",
  ].filter(Boolean).join(" ");
  return `<!doctype html><html lang="ru"><head><title>Обучение интернет-маркетингу ${index + 1}</title></head><body>
    <main>
      <h1>SEO курсы для специалистов</h1>
      ${promotedHeading}
      <p>SEO курсы дают системные знания. ${queryLemmaPhrase} Курсы практика закрепляют навыки.</p>
      <p>Московская бизнес среда обсуждает образование. Контент стратегия поддерживает развитие.</p>
      <p>${promotedBody} ${gradedPhrases} ${BASE_COPY}. ${BASE_COPY}.</p>
    </main>
  </body></html>`;
}

function ownHtml() {
  return `<!doctype html><html lang="ru"><head><title>Школа продвижения</title></head><body><main>
    <h1>Курсы для специалистов</h1>
    <p>SEO программа и поисковое продвижение. ${BASE_COPY}. ${BASE_COPY}.</p>
  </main></body></html>`;
}

function requestUrl(input) {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

const reports = new Map();

async function reportFixture(structural = false) {
  const cacheKey = structural ? "structural" : "plain";
  if (!reports.has(cacheKey)) {
    reports.set(cacheKey, (async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input) => {
        const url = requestUrl(input);
        if (url.hostname === "ours.example.test") {
          return new Response(ownHtml(), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
        }
        const index = Number(url.hostname.match(/competitor-(\d+)/u)?.[1] ?? 1) - 1;
        return new Response(competitorHtml(index, structural), {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      };
      try {
        // Import after replacing fetch: the built worker captures its runtime
        // fetch binding while the module is initialized.
        const worker = await loadWorker();
        const competitors = Array.from({ length: 6 }, (_, index) => ({
          name: `Конкурент ${index + 1}`,
          position: index + 1,
          url: `https://competitor-${index + 1}.example.test/${cacheKey}`,
        }));
        const result = await postAnalysis(worker, {
          queries: ["seo курсы"],
          serpQuery: "seo курсы",
          language: "ru",
          ownPage: { name: "Наша страница", url: `https://ours.example.test/${cacheKey}` },
          competitors,
          search: { engine: "google", region: "ru", device: "desktop", found: competitors.length },
        });
        assert.equal(result.response.status, 200, result.data.error || "N-gram importance fixture failed");
        return result.data;
      } finally {
        globalThis.fetch = originalFetch;
      }
    })());
  }
  return structuredClone(await reports.get(cacheKey));
}

let zeroDfReportPromise;

async function zeroDfExactQueryFixture() {
  if (!zeroDfReportPromise) {
    zeroDfReportPromise = (async () => {
      const worker = await loadWorker();
      const shared = [
        "SEO обучение объясняет аудит сайта, аналитику спроса, техническую оптимизацию и контентную стратегию.",
        "Учебная программа содержит практику, исследование конкурентов, работу с трафиком и измерение результатов.",
        "Специалисты развивают проект, изучают инструменты продвижения и готовят итоговый отчёт.",
      ].join(" ");
      const competitors = Array.from({ length: 6 }, (_, index) => ({
        name: `Конкурент ${index + 1}`,
        text: `${shared} ${index < 3 ? "Московская бизнес среда обсуждает образование и маркетинг." : "Региональная деловая среда обсуждает образование и маркетинг."} ${shared}`,
      }));
      const result = await postAnalysis(worker, {
        queries: ["seo курсы"],
        serpQuery: "seo курсы",
        language: "ru",
        ownPage: { name: "Наша страница", text: `${shared} ${shared}` },
        competitors,
        search: { engine: "google", region: "ru", device: "desktop", found: competitors.length },
      });
      assert.equal(result.response.status, 200, result.data.error || "zero-DF exact-query fixture failed");
      return result.data;
    })();
  }
  return structuredClone(await zeroDfReportPromise);
}

function normalized(value) {
  return String(value).normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
}

function rowBySurface(report, surface) {
  const wanted = normalized(surface);
  return report.ngrams.find((row) => [row.phrase, ...(row.forms ?? [])].some((form) => normalized(form) === wanted));
}

function similarity(row) {
  return Number(row.phraseSimilarity ?? row.keySimilarity ?? 0);
}

function structuralCoverage(report, key) {
  const phraseKeys = [...new Set(key.split(/\s+/u).filter(Boolean))];
  const covered = report.snapshot.competitors.filter((document) => {
    const zones = ["title", "h1", "headings"];
    const headingTerms = new Set(zones.flatMap((zone) => document.zones[zone].termCounts.map(([termKey]) => termKey)));
    return phraseKeys.every((termKey) => headingTerms.has(termKey));
  }).length;
  return covered / report.snapshot.competitors.length;
}

function baseNormalizedScores(report) {
  const raw = new Map(report.ngrams.map((row) => [row.key, row.df * similarity(row)]));
  const maximum = Math.max(0, ...raw.values());
  return new Map([...raw].map(([key, value]) => [key, maximum > 0 && value > 0 ? 100 * (value / maximum) ** 0.7 : 0]));
}

function queryLemmaCoverage(row, queryTermKeys) {
  const phraseKeys = [...new Set(row.key.split(/\s+/u).filter(Boolean))];
  return phraseKeys.length ? phraseKeys.filter((key) => queryTermKeys.has(key)).length / phraseKeys.length : 0;
}

function expectedImportance(base, queryCoverage, headingShare) {
  const afterQuery = base + (100 - base) * 0.6 * queryCoverage ** 2;
  const headingRamp = Math.min(1, Math.max(0, (headingShare - 0.5) / 0.5));
  return Math.min(100, afterQuery + (100 - afterQuery) * 0.15 * headingRamp);
}

test("N-gram importance starts from DF × phrase similarity and then applies query/structural boosts", { concurrency: false }, async () => {
  const plain = await reportFixture(false);
  const structural = await reportFixture(true);
  const base = baseNormalizedScores(plain);
  const queryTermKeys = new Set(plain.terms.filter((row) => row.keywordHit).map((row) => row.key));

  const unboosted = plain.ngrams.filter((row) => {
    const containsQueryLemma = row.key.split(/\s+/u).some((key) => queryTermKeys.has(key));
    return !containsQueryLemma && structuralCoverage(plain, row.key) < 0.5 && similarity(row) > 0;
  });
  assert.ok(unboosted.length >= 2, "fixture must expose unboosted phrases for the base-formula check");
  for (const row of unboosted.slice(0, 12)) {
    const expected = Math.max(1, base.get(row.key) ?? 0);
    assert.ok(
      Math.abs(row.importance - expected) <= 0.25,
      `${row.phrase}: unboosted importance must equal normalized DF × phrase similarity (${expected.toFixed(2)}), got ${row.importance}`,
    );
  }

  const seoProgram = rowBySurface(plain, "seo программа");
  assert.ok(seoProgram, "fixture must contain the query-lemma phrase");
  const seoProgramExpected = expectedImportance(
    base.get(seoProgram.key) ?? 0,
    queryLemmaCoverage(seoProgram, queryTermKeys),
    structuralCoverage(plain, seoProgram.key),
  );
  assert.ok(Math.abs(seoProgram.importance - seoProgramExpected) <= 0.25, "query headroom boost must use 0.60 × K²");
  assert.ok(seoProgram.importance > (base.get(seoProgram.key) ?? 0), "a phrase containing a query lemma must receive a post-normalization boost");

  const plainPromotion = rowBySurface(plain, "поисковое продвижение");
  const structuralPromotion = rowBySurface(structural, "поисковое продвижение");
  assert.ok(plainPromotion && structuralPromotion, "fixture must contain the structural comparison phrase");
  assert.equal(structuralCoverage(plain, plainPromotion.key) < 0.5, true);
  assert.equal(structuralCoverage(structural, structuralPromotion.key) >= 0.5, true);
  const structuralBase = baseNormalizedScores(structural);
  const structuralQueryKeys = new Set(structural.terms.filter((row) => row.keywordHit).map((row) => row.key));
  const structuralExpected = expectedImportance(
    structuralBase.get(structuralPromotion.key) ?? 0,
    queryLemmaCoverage(structuralPromotion, structuralQueryKeys),
    structuralCoverage(structural, structuralPromotion.key),
  );
  assert.ok(Math.abs(structuralPromotion.importance - structuralExpected) <= 0.25, "heading headroom boost must use the smooth share-above-50% ramp");
  assert.ok(
    structuralPromotion.importance > plainPromotion.importance,
    "coverage in title/H1/H2-H6 above 50% of competitors must boost the same phrase",
  );
});

test("heading boost is continuous at 50% and exact-query headroom clears the audited worst case", () => {
  const justBelow = expectedImportance(40, 0, 0.4999);
  const threshold = expectedImportance(40, 0, 0.5);
  const justAbove = expectedImportance(40, 0, 0.5001);
  assert.equal(justBelow, threshold, "heading evidence must not create a threshold jump below 50%");
  assert.ok(justAbove > threshold && justAbove - threshold < 0.01, "heading evidence must start with a smooth ramp above 50%");

  const exactZeroDf = expectedImportance(0, 1, 0);
  const auditedMoscowWorstCase = expectedImportance(48.1850131, 0, 1);
  assert.ok(exactZeroDf > auditedMoscowWorstCase, "zero-DF exact query must outrank the audited phrase even at its maximum heading boost");
});

test("exact SEO phrase outranks irrelevant wording and the scale declines smoothly", { concurrency: false }, async () => {
  const report = await reportFixture(false);
  const exact = rowBySurface(report, "seo курсы");
  const irrelevant = rowBySurface(report, "московская бизнес");
  assert.ok(exact && irrelevant, "fixture must expose both comparison phrases");
  assert.equal(similarity(exact), 1, "the exact input phrase must have full phrase similarity");
  assert.ok(exact.importance > irrelevant.importance, "exact ‘seo курсы’ must outrank irrelevant ‘московская бизнес’");

  const graded = report.ngrams
    .map((row) => row.importance)
    .filter((value) => value > 1 && value < 100)
    .map((value) => Math.round(value * 10) / 10);
  assert.ok(new Set(graded).size >= 5, "importance must form a graded decline rather than a binary/high-low gate");
  assert.ok(report.ngrams.every((row) => row.importance >= 0 && row.importance <= 100), "N-gram importance must remain in 0..100");
});

test("an exact input N-gram with DF=0 and own=0 stays visible and outranks irrelevant wording", { concurrency: false }, async () => {
  const report = await zeroDfExactQueryFixture();
  const exact = rowBySurface(report, "seo курсы");
  const irrelevant = rowBySurface(report, "московская бизнес");
  assert.ok(exact && irrelevant, "both the zero-DF input phrase and comparison phrase must remain visible");
  assert.equal(exact.keywordHit, true);
  assert.equal(exact.sites, 0);
  assert.equal(exact.df, 0);
  assert.equal(exact.ownCount, 0);
  assert.equal(similarity(exact), 1);
  assert.ok(Math.abs(exact.importance - 60) <= 0.2, "a zero-base exact query must receive the 60% query headroom boost");
  assert.ok(exact.importance > irrelevant.importance, "exact ‘seo курсы’ must outrank ‘московская бизнес’ even at DF=0");
});

test("phrase similarity is an N-gram-only signal", async () => {
  const report = await reportFixture(false);
  assert.ok(report.ngrams.every((row) => Number.isFinite(similarity(row))), "every N-gram must expose phrase similarity");
  assert.ok(report.terms.every((row) => !Object.hasOwn(row, "phraseSimilarity") && !Object.hasOwn(row, "keySimilarity") && !Object.hasOwn(row, "cosine")));

  const core = await readFile(new URL("../lib/semantic-analysis.ts", import.meta.url), "utf8");
  const termBlock = core.slice(core.indexOf("const allTermRows"), core.indexOf("const selectedTermKeys"));
  const ngramBlock = core.slice(core.indexOf("const allNgramRows"), core.indexOf("const selectedNgramKeys"));
  assert.doesNotMatch(termBlock, /localSemanticScore|phraseSimilarity|keySimilarity|cosine\s*\(/u, "lemma importance must not consume phrase similarity");
  assert.match(ngramBlock, /localSemanticScore|phraseSimilarity|keySimilarity/u, "N-gram importance must consume the phrase-similarity result");
});
