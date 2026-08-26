import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("importance-v7-test", `${process.pid}-${Date.now()}-${Math.random()}`);
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
  return { response, data: await response.json() };
}

const MONTH_FORMS = ["мес.", "месяц", "месяцев", "месяца", "месяцы"];
const COMMON_TEXT = [
  "аналитика стратегия продвижение аудит контент структура сайт страница запрос трафик",
  "обучение практика программа материал исследование инструмент результат специалист проект",
  "поисковый технический семантика оптимизация индексирование маркетинг отчет показатель",
].join(" ");

function zoneCopy(month, academy = "") {
  return `seo курс ${month} обучение ${academy}`.replace(/\s+/g, " ").trim();
}

function competitorHtml(index, own = false) {
  const academy = !own && index < 2 ? "academy" : "";
  const forms = own
    ? ["мес.", "мес", "месяц", "месяцев", "месяца"]
    : Array(5).fill(MONTH_FORMS[index % MONTH_FORMS.length]);
  return `<!doctype html><html lang="ru"><head><title>${zoneCopy(forms[0], academy)}</title></head>
    <body><header><h1>${zoneCopy(forms[1], academy)}</h1></header><main>
      <h2>${zoneCopy(forms[2], academy)}</h2>
      <p>${zoneCopy(forms[3], academy)} ${COMMON_TEXT} ${COMMON_TEXT}</p>
      <a href="/course">${zoneCopy(forms[4], academy)}</a>
    </main></body></html>`;
}

function requestUrl(input) {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

let importanceFixturePromise;

async function importanceFixture() {
  if (!importanceFixturePromise) {
    importanceFixturePromise = (async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input) => {
        const url = requestUrl(input);
        const own = url.hostname === "ours.example.test";
        const index = own ? 0 : Number(url.hostname.match(/competitor-(\d+)/)?.[1] ?? 1) - 1;
        return new Response(competitorHtml(index, own), {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      };
      try {
        const worker = await loadWorker();
        const competitors = Array.from({ length: 5 }, (_, index) => ({
          name: `Конкурент ${index + 1}`,
          position: index + 1,
          url: `https://competitor-${index + 1}.example.test/course`,
        }));
        const result = await postAnalysis(worker, {
          queries: ["seo курс"],
          serpQuery: "seo курс",
          language: "ru",
          useFirecrawl: false,
          competitors,
          ownPage: { name: "Наша страница", url: "https://ours.example.test/course" },
          search: { engine: "google", region: "ru", device: "desktop", found: competitors.length },
        });
        assert.equal(result.response.status, 200, result.data.error || "importance fixture failed");
        return { worker, report: result.data };
      } finally {
        globalThis.fetch = originalFetch;
      }
    })();
  }
  return importanceFixturePromise;
}

function rounded(value, digits = 1) {
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

function median(values) {
  return values.length ? quantile(values, 0.5) : 0;
}

function counts(document, zone, kind) {
  const source = zone === "global" ? document : document.zones[zone];
  return new Map(source[kind === "term" ? "termCounts" : "ngramCounts"]);
}

function signalRaw(row, report, kind, exactKeys, zone = "global") {
  const corpus = report.snapshot.competitors;
  const values = corpus.map((document) => {
    const source = zone === "global" ? document : document.zones[zone];
    return {
      count: counts(document, zone, kind).get(row.key) ?? 0,
      contentWords: source.contentWordCount,
    };
  });
  const sites = values.filter((value) => value.count > 0).length;
  const df = sites / corpus.length;
  const idf = Math.log((corpus.length + 1) / (sites + 1)) + 1;
  const tfidfValues = values.map((value) => {
    const denominator = kind === "term" ? Math.max(1, value.contentWords) : Math.max(1, value.contentWords - 1);
    return value.count / denominator * idf * 1_000;
  });
  const competitorTfidf = tfidfValues.reduce((sum, value) => sum + value, 0) / corpus.length;
  const exactFactor = kind === "term" ? row.keywordHit ? 2 : 1 : exactKeys.has(row.key) ? 2 : 1;
  const stabilityFactor = df >= 0.5 ? 1.15 : 1;
  return competitorTfidf * df * exactFactor * stabilityFactor;
}

function assertNormalizedImportance(rows, report, kind, exactKeys) {
  const globalRaw = new Map(rows.map((row) => [row.key, signalRaw(row, report, kind, exactKeys)]));
  const globalMaximum = Math.max(0, ...globalRaw.values());
  for (const row of rows) {
    const raw = globalRaw.get(row.key) ?? 0;
    const expected = Math.max(1, globalMaximum > 0 ? raw / globalMaximum * 100 : 0);
    assert.equal(row.importance, rounded(expected), `${kind} ${row.key}: incorrect global importance`);
    assert.ok(row.medianCount >= 1, `${kind} ${row.key}: emitted median target must be at least one`);
    assert.ok(row.importance >= 1, `${kind} ${row.key}: emitted importance must be at least one`);
  }

  for (const zone of ["all", "title", "h1", "headings", "text", "anchors"]) {
    const zoneRaw = new Map(rows.map((row) => [row.key, signalRaw(row, report, kind, exactKeys, zone)]));
    const zoneMaximum = Math.max(0, ...zoneRaw.values());
    for (const row of rows) {
      const metrics = row.zones[zone];
      const raw = zoneRaw.get(row.key) ?? 0;
      const expected = raw > 0 && zoneMaximum > 0 ? Math.max(1, raw / zoneMaximum * 100) : 0;
      const serializedCounts = report.snapshot.competitors.map((document) => counts(document, zone, kind).get(row.key) ?? 0);
      assert.equal(
        metrics.importance,
        rounded(expected),
        `${kind} ${row.key}: incorrect ${zone} importance; raw=${raw}, max=${zoneMaximum}, counts=${serializedCounts.join(",")}`,
      );
      if (raw > 0) {
        assert.ok(metrics.medianCount >= 1, `${kind} ${row.key}: positive ${zone} target must be at least one`);
        assert.ok(metrics.importance >= 1, `${kind} ${row.key}: positive ${zone} importance must be at least one`);
      }
    }
  }
}

function rowWithForm(rows, form) {
  return rows.find((row) => row.term === form || row.phrase === form || row.forms.includes(form));
}

function keyForSurface(report, surface) {
  for (const document of report.snapshot.competitors) {
    for (const [key, forms] of document.termForms) {
      if (forms.some(([form]) => form === surface)) return key;
    }
  }
  return undefined;
}

test("month abbreviations merge before counting while exact query N-grams stay explicit and visible", { concurrency: false }, async () => {
  const { report } = await importanceFixture();
  const monthKey = keyForSurface(report, "месяц");
  const abbreviatedKey = keyForSurface(report, "мес");
  assert.ok(monthKey);
  assert.equal(abbreviatedKey, monthKey, "мес. / мес must use the same key as месяц");

  const monthRows = report.terms.filter((row) => row.key === monthKey || row.forms.includes("мес"));
  assert.equal(monthRows.length, 1, "month forms must not leak into a separate мес row");
  const month = monthRows[0];
  assert.equal(month.term, "месяц", "the merged row must display the canonical full form, not the abbreviation");
  for (const form of ["мес", "месяц", "месяцев"]) assert.ok(month.forms.includes(form), `missing combined form ${form}`);
  assert.equal(month.sites, 5);
  assert.equal(month.ownCount, 5);
  assert.equal(report.terms.some((row) => row !== month && (row.key === "мес" || row.term === "мес")), false);

  const seo = rowWithForm(report.terms, "seo");
  const course = rowWithForm(report.terms, "курс");
  const academy = rowWithForm(report.terms, "academy");
  assert.ok(seo && course && academy);
  assert.ok(Math.min(seo.importance, course.importance) > month.importance, "query terms must outrank a generic month signal");
  assert.ok(month.importance > academy.importance, "a rare academy-like signal must be demoted by DF");
  assert.equal(academy.ownCount, 0, "a useful competitor signal may be emitted when our count is zero");

  const exactTermKeys = new Set([seo.key, course.key]);
  assertNormalizedImportance(report.terms, report, "term", exactTermKeys);

  const exactPhrase = report.ngrams.find((row) => row.key === `${seo.key} ${course.key}`);
  const genericMonthPhrase = report.ngrams.find((row) => row.key === `${course.key} ${month.key}`);
  assert.ok(exactPhrase && genericMonthPhrase);
  assert.equal(exactPhrase.keywordHit, true, "the exact input phrase must keep its explicit keyword marker");
  assert.equal(exactPhrase.keySimilarity, 1, "the exact input phrase must keep full query similarity");
  assert.equal(exactPhrase.importance, 100, "an exact query present in every competitor must reach the top of the public scale");
  for (const zone of ["all", "title", "h1", "headings", "text", "anchors"]) {
    assert.equal(exactPhrase.zones[zone].importance, 100, `the fully covered exact query must lead the ${zone} scale`);
  }
  assert.ok(genericMonthPhrase.importance >= 1 && genericMonthPhrase.importance <= 100, "all emitted N-grams must remain on the public 1..100 scale");
  assert.ok(report.ngrams.some((row) => row.ownCount === 0), "N-grams with ownCount=0 must remain available when competitors support them");
});

test("snapshot v5 recalculation is fetch-free and v4 snapshots are rejected", { concurrency: false }, async () => {
  const { worker, report: initial } = await importanceFixture();
  assert.equal(initial.snapshot.version, 5);

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("snapshot recalculation attempted a network request");
  };
  let recalculated;
  try {
    recalculated = await postAnalysis(worker, { queries: ["seo курс"], language: "ru", snapshot: initial.snapshot });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(recalculated.response.status, 200, recalculated.data.error || "v5 snapshot recalculation failed");
  assert.equal(fetchCalls, 0);
  assert.equal(recalculated.data.snapshot.version, 5);
  assert.equal(recalculated.data.meta.snapshotId, initial.meta.snapshotId);

  const oldSnapshot = structuredClone(initial.snapshot);
  oldSnapshot.version = 4;
  const rejected = await postAnalysis(worker, { queries: ["seo курс"], snapshot: oldSnapshot });
  assert.equal(rejected.response.status, 400);
  assert.equal(typeof rejected.data.error, "string");
});

const CROWDED_NGRAM_TERMS = Array.from({ length: 180 }, (_, index) => `crowdterm${String(index).padStart(3, "0")}`);
let crowdedNgramFixturePromise;

async function crowdedNgramFixture() {
  if (!crowdedNgramFixturePromise) {
    crowdedNgramFixturePromise = loadWorker().then(async (worker) => {
      const competitors = Array.from({ length: 5 }, (_, index) => ({
        name: `Crowded phrase ${index + 1}`,
        position: index + 1,
        text: `${index < 2 ? "precision query" : "alternate subject"} ${CROWDED_NGRAM_TERMS.join(" ")}`,
      }));
      const result = await postAnalysis(worker, {
        queries: ["precision query"],
        serpQuery: "precision query",
        language: "en",
        competitors,
        ownPage: { name: "Own crowded page", text: `precision query ${CROWDED_NGRAM_TERMS.join(" ")}` },
        search: { engine: "google", region: "us", device: "desktop", found: competitors.length },
      });
      assert.equal(result.response.status, 200, result.data.error || "crowded N-gram fixture failed");
      return result.data;
    });
  }
  return crowdedNgramFixturePromise;
}

test("an exact query N-gram is perfect, keeps its keyword, survives the cap, and averages zero documents", { concurrency: false }, async () => {
  const report = await crowdedNgramFixture();
  const precision = rowWithForm(report.terms, "precision");
  const query = rowWithForm(report.terms, "query");
  assert.ok(precision && query);
  const exactKey = `${precision.key} ${query.key}`;
  const exact = report.ngrams.find((row) => row.key === exactKey);

  assert.ok(intersectionCount(report.snapshot.competitors, "ngramCounts") > 200, "the fixture must exceed the outward N-gram cap");
  assert.ok(report.ngrams.length >= 200, "the capped global selection must remain populated");
  assert.ok(exact, "an exact input phrase must survive the outward cap");
  assert.equal(exact.keySimilarity, 1);
  assert.equal(exact.bestKeyword, "precision query");
  assert.equal(exact.sites, 2);

  const corpus = report.snapshot.competitors;
  const counts = corpus.map((document) => new Map(document.ngramCounts).get(exactKey) ?? 0);
  const sites = counts.filter((count) => count > 0).length;
  const idf = Math.log((corpus.length + 1) / (sites + 1)) + 1;
  const valuesIncludingZeros = corpus.map((document, index) =>
    counts[index] / Math.max(1, document.contentWordCount - 1) * idf * 1_000);
  const expectedMean = valuesIncludingZeros.reduce((sum, value) => sum + value, 0) / corpus.length;
  const positiveMedian = median(valuesIncludingZeros.filter((value) => value > 0));
  assert.equal(exact.competitorTfidf, rounded(expectedMean, 3), "N-gram TF-IDF must average the complete corpus, including zero documents");
  assert.notEqual(rounded(expectedMean, 3), rounded(positiveMedian, 3), "fixture must distinguish complete-corpus mean from positive-only median");
});

const CROWDED_ZONE_TERMS = Array.from({ length: 360 }, (_, index) => `bulkterm${String(index).padStart(3, "0")}`);

function crowdedZoneHtml(index, own = false) {
  const title = own || index < 2 ? "structuralrare titlemarker" : "ordinarytitle commonmarker";
  const h1 = own ? "ownonly headingmarker" : "sharedheading basictopic";
  return `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main>
    <h1>${h1}</h1><p>baseline topic ownonly headingmarker ${CROWDED_ZONE_TERMS.join(" ")}</p>
  </main></body></html>`;
}

let crowdedZoneFixturePromise;

async function crowdedZoneFixture() {
  if (!crowdedZoneFixturePromise) {
    crowdedZoneFixturePromise = (async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input) => {
        const url = requestUrl(input);
        const own = url.hostname === "zone-own.example.test";
        const index = own ? 0 : Number(url.hostname.match(/zone-(\d+)/)?.[1] ?? 1) - 1;
        return new Response(crowdedZoneHtml(index, own), {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      };
      try {
        const worker = await loadWorker();
        const competitors = Array.from({ length: 6 }, (_, index) => ({
          name: `Zone cap ${index + 1}`,
          position: index + 1,
          url: `https://zone-${index + 1}.example.test/page`,
        }));
        const result = await postAnalysis(worker, {
          queries: ["baseline topic"],
          serpQuery: "baseline topic",
          language: "en",
          useFirecrawl: false,
          competitors,
          ownPage: { name: "Zone own", url: "https://zone-own.example.test/page" },
          search: { engine: "google", region: "us", device: "desktop", found: competitors.length },
        });
        assert.equal(result.response.status, 200, result.data.error || "crowded zone fixture failed");
        return result.data;
      } finally {
        globalThis.fetch = originalFetch;
      }
    })();
  }
  return crowdedZoneFixturePromise;
}

function intersectionCount(documents, field) {
  const [first, ...rest] = documents.map((document) => new Set(document[field].map(([key]) => key)));
  return [...first].filter((key) => rest.every((keys) => keys.has(key))).length;
}

test("own-only and rare structural signals survive global filters and caps with visible zone importance", { concurrency: false }, async () => {
  const report = await crowdedZoneFixture();
  assert.ok(intersectionCount(report.snapshot.competitors, "termCounts") > 300, "fixture must exceed the global term cap");
  assert.ok(intersectionCount(report.snapshot.competitors, "ngramCounts") > 200, "fixture must exceed the global N-gram cap");

  const structuralTerm = rowWithForm(report.terms, "structuralrare");
  assert.ok(structuralTerm, "a title signal below global minSites must survive the crowded global table");
  assert.equal(structuralTerm.sites, 2);
  assert.equal(structuralTerm.zones.title.sites, 2);
  assert.equal(structuralTerm.zones.title.ownCount, 1);
  assert.ok(structuralTerm.zones.title.importance >= 1);

  const structuralPhrase = report.ngrams.find((row) => row.forms.includes("structuralrare titlemarker"));
  assert.ok(structuralPhrase, "a title phrase below global minSites must survive the crowded N-gram table");
  assert.equal(structuralPhrase.sites, 2);
  assert.equal(structuralPhrase.zones.title.sites, 2);
  assert.equal(structuralPhrase.zones.title.ownCount, 1);
  assert.ok(structuralPhrase.zones.title.importance >= 1);

  const ownOnlyTerm = rowWithForm(report.terms, "ownonly");
  assert.ok(ownOnlyTerm, "an own-only visible H1 term must remain available");
  assert.equal(ownOnlyTerm.zones.h1.sites, 0);
  assert.equal(ownOnlyTerm.zones.h1.ownCount, 1);
  assert.equal(ownOnlyTerm.zones.h1.importance, 1);

  const ownOnlyPhrase = report.ngrams.find((row) => row.forms.includes("ownonly headingmarker"));
  assert.ok(ownOnlyPhrase, "an own-only visible H1 phrase must remain available");
  assert.equal(ownOnlyPhrase.zones.h1.sites, 0);
  assert.equal(ownOnlyPhrase.zones.h1.ownCount, 1);
  assert.equal(ownOnlyPhrase.zones.h1.importance, 1);
});
