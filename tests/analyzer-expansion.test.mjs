import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("analyzer-expansion", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const environment = () => ({
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
});

const context = () => ({ waitUntil() {}, passThroughOnException() {} });

async function post(worker, path, payload) {
  const response = await worker.fetch(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }), environment(), context());
  const data = await response.json();
  return { response, data };
}

function requestUrl(input) {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

function xmlPage(offset, count = 10) {
  const docs = Array.from({ length: count }, (_, index) => {
    const position = offset + index + 1;
    return `<doc><url>https://site-${position}.test/course</url><title>Site ${position}</title><passages>SEO course ${position}</passages></doc>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><response><results><grouping>${docs}</grouping></results></response>`;
}

function longText(marker) {
  return `${marker}. Практический курс поисковой оптимизации включает технический аудит сайта, исследование спроса, семантическое ядро, структуру страниц, внутренние ссылки, контентную стратегию, аналитику, измерение результатов и работу с реальными проектами. Студенты изучают инструменты, исправляют ошибки индексации, улучшают скорость, готовят отчёты и проверяют гипотезы на коммерческих сайтах. ${marker} помогает закрепить материал на практике и сравнить результаты до и после изменений.`;
}

test("XMLRiver pagination returns more than ten unique competitors", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const pages = [];
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    const page = Number(url.searchParams.get("page"));
    pages.push(page);
    const offset = (page - 1) * 10;
    return new Response(xmlPage(offset), { status: 200, headers: { "content-type": "application/xml; charset=utf-8" } });
  };

  try {
    const worker = await loadWorker();
    const { response, data } = await post(worker, "/api/search-competitors", {
      query: "seo курсы",
      engine: "google",
      region: "ru",
      device: "desktop",
      count: 23,
      credentials: { user: "test-user", key: "test-key" },
    });
    assert.equal(response.status, 200, data.error || "search failed");
    assert.equal(data.competitors.length, 23);
    assert.deepEqual(pages, [1, 2, 3]);
    assert.deepEqual(data.competitors.map((row) => row.position), Array.from({ length: 23 }, (_, index) => index + 1));
    assert.equal(new Set(data.competitors.map((row) => new URL(row.url).hostname)).size, 23);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("analysis accepts more than ten competitors and publishes per-document profiles", { concurrency: false }, async () => {
  const worker = await loadWorker();
  const competitors = Array.from({ length: 13 }, (_, index) => ({
    name: `Конкурент ${index + 1}`,
    url: `https://competitor-${index + 1}.test/course`,
    position: index + 1,
    text: longText(`Маркер ${index + 1}`),
  }));

  const { response, data } = await post(worker, "/api/analyze-run", {
    queries: ["seo курсы", "технический аудит"],
    serpQuery: "seo курсы",
    language: "ru",
    competitors,
    ownPage: { name: "Наша страница", text: longText("Наша программа") },
    search: { engine: "google", region: "ru", device: "desktop", found: competitors.length },
  });

  assert.equal(response.status, 200, data.error || "analysis failed");
  assert.equal(data.meta.competitorsAnalyzed, 13);
  assert.equal(data.documents.filter((row) => !row.ours).length, 13);
  assert.equal(data.comparisonProfiles.length, 13);
  assert.equal(new Set(data.comparisonProfiles.map((row) => row.id)).size, 13);
  assert.ok(data.comparisonProfiles.every((row) => Array.isArray(row.cloud) && row.cloud.length > 0));
  assert.ok(data.terms.every((row) => Number.isInteger(row.ownCount) && Number.isInteger(row.medianCount)));
  assert.ok(data.ngrams.every((row) => Number.isInteger(row.ownCount) && Number.isInteger(row.medianCount)));
});

test("Firecrawl is a sequential fallback, rejects bad stubs, and is skipped on snapshot recalc", { concurrency: false }, async () => {
  const previousKey = process.env.FIRECRAWL;
  process.env.FIRECRAWL = "test-firecrawl-key";
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = requestUrl(input);
    if (url.hostname === "api.firecrawl.dev") {
      const body = JSON.parse(String(init.body || "{}"));
      calls.push({ kind: "firecrawl", url: body.url });
      const valid = String(body.url).includes("fallback-ok");
      const html = valid
        ? `<html><title>Recovered course</title><main><h1>Recovered SEO course</h1><p>${longText("Firecrawl восстановил страницу")}</p></main></html>`
        : "<html><title>Just a moment...</title><body>Verify you are human. CAPTCHA.</body></html>";
      return new Response(JSON.stringify({ success: true, data: { html, rawHtml: html } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    calls.push({ kind: "direct", url: url.toString() });
    if (url.hostname === "direct-ok.test") {
      return new Response(`<html><title>Direct course</title><main><h1>Практический SEO курс</h1><p>${longText("Обычный HTTP успешно получил страницу")} ${longText("Расширенная программа прямой страницы")}</p></main></html>`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response("Access denied", { status: 403 });
  };

  const worker = await loadWorker();
  let initial;
  try {
    const result = await post(worker, "/api/analyze-run", {
      queries: ["seo курсы"],
      serpQuery: "seo курсы",
      language: "ru",
      useFirecrawl: true,
      competitors: [
        { name: "Direct", url: "https://direct-ok.test/course", position: 1 },
        { name: "Fallback ok", url: "https://fallback-ok.test/course", position: 2 },
        { name: "Fallback bad", url: "https://fallback-bad.test/course", position: 3 },
      ],
      ownPage: { name: "Наша страница", text: longText("Наша программа") },
      search: { engine: "google", region: "ru", device: "desktop", found: 3 },
    });
    assert.equal(result.response.status, 200, result.data.error || "fallback analysis failed");
    initial = result.data;
    assert.equal(initial.meta.competitorsAnalyzed, 2, JSON.stringify({ calls, warnings: initial.warnings, profiles: initial.comparisonProfiles?.map((row) => row.url) }, null, 2));
    assert.equal(calls.filter((call) => call.kind === "firecrawl").length, 2);
    assert.equal(calls.filter((call) => call.kind === "firecrawl" && call.url.includes("direct-ok")).length, 0);
    assert.ok(initial.warnings.some((warning) => warning.url?.includes("fallback-bad") || warning.name === "Fallback bad"));
  } finally {
    globalThis.fetch = originalFetch;
  }

  let recalcFetches = 0;
  globalThis.fetch = async () => {
    recalcFetches += 1;
    throw new Error("snapshot recalc attempted a network request");
  };
  try {
    const recalculated = await post(worker, "/api/analyze-run", {
      queries: ["продвижение сайтов"],
      snapshot: initial.snapshot,
    });
    assert.equal(recalculated.response.status, 200, recalculated.data.error || "snapshot recalc failed");
    assert.equal(recalcFetches, 0);
    assert.equal(recalculated.data.meta.snapshotId, initial.meta.snapshotId);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.FIRECRAWL;
    else process.env.FIRECRAWL = previousKey;
  }
});
