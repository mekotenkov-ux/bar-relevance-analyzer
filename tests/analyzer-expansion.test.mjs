import assert from "node:assert/strict";
import test from "node:test";
import {
  XMLRIVER_REGION_CATALOG_VERSION,
  XMLRIVER_REGION_SOURCES,
  resolveXmlRiverRegion,
  searchXmlRiverRegions,
  xmlRiverCountries,
  xmlRiverRegions,
  xmlRiverRegionsForCountry,
} from "../lib/xmlriver-regions.ts";

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

test("XMLRiver region catalog resolves human labels, decorated codes, and legacy country aliases", () => {
  assert.equal(resolveXmlRiverRegion("yandex", "Москва")?.code, "213");
  assert.deepEqual(resolveXmlRiverRegion("yandex", "Москва — 213"), {
    code: "213",
    label: "Москва",
    canonicalName: "Москва, Россия",
    displayLabel: "Москва, Россия — 213",
    countryCode: "RU",
    kind: "city",
    known: true,
  });
  assert.equal(resolveXmlRiverRegion("google", "Москва")?.code, "1011969");
  assert.equal(resolveXmlRiverRegion("google", "ru")?.code, "2643");
  assert.equal(resolveXmlRiverRegion("yandex", "москва и область")?.code, "1");
  assert.deepEqual(resolveXmlRiverRegion("google", "999999999"), {
    code: "999999999",
    label: "Регион 999999999",
    canonicalName: "",
    displayLabel: "Регион XMLRiver — 999999999",
    countryCode: "",
    kind: "region",
    known: false,
  });
  assert.equal(resolveXmlRiverRegion("google", "точно неизвестный регион"), null);
  assert.deepEqual(searchXmlRiverRegions("yandex", "нижний", 5).map((region) => region.code), ["47", "11168"]);
  assert.deepEqual(searchXmlRiverRegions("yandex", "Москва — 213", 5).map((region) => region.code), ["213"]);
  assert.equal(resolveXmlRiverRegion("yandex", "Москва, Россия — 213")?.code, "213");
  assert.equal(resolveXmlRiverRegion("google", "Springfield, Illinois, United States")?.code, "1016864");
  assert.equal(resolveXmlRiverRegion("google", "Springfield, Illinois, United States — 1016864")?.code, "1016864");
  const springfields = searchXmlRiverRegions("google", "Springfield", 50);
  assert.ok(springfields.length > 10);
  assert.equal(new Set(springfields.map((region) => region.displayLabel)).size, springfields.length);
  assert.equal(springfields.find((region) => region.code === "1016864")?.displayLabel, "Springfield, Illinois, United States — 1016864");
});

test("XMLRiver region snapshot contains complete official offline catalogs", () => {
  assert.equal(xmlRiverRegions("google").length, 99_819);
  assert.equal(xmlRiverRegions("yandex").length, 708);
  assert.equal(resolveXmlRiverRegion("google", "Kabul")?.code, "1000002");
  assert.deepEqual(resolveXmlRiverRegion("yandex", "Нерюнгринский район"), {
    code: "101987",
    label: "Нерюнгринский район",
    canonicalName: "Нерюнгринский район, Россия",
    displayLabel: "Нерюнгринский район, Россия — 101987",
    countryCode: "RU",
    kind: "region",
    known: true,
  });
  assert.match(XMLRIVER_REGION_SOURCES.google.coverage, /99819/u);
  assert.match(XMLRIVER_REGION_SOURCES.yandex.coverage, /708/u);
  assert.match(XMLRIVER_REGION_SOURCES.google.sha256, /^[a-f\d]{64}$/u);
});

test("XMLRiver exposes deterministic countries and filters locations by country", () => {
  const yandexCountries = xmlRiverCountries("yandex");
  const googleCountries = xmlRiverCountries("google");
  assert.equal(new Set(yandexCountries.map((country) => country.countryCode)).size, yandexCountries.length);
  assert.equal(new Set(googleCountries.map((country) => country.countryCode)).size, googleCountries.length);
  assert.equal(yandexCountries.find((country) => country.code === "137")?.countryCode, "JP");
  assert.equal(yandexCountries.find((country) => country.code === "113")?.countryCode, "AT");
  assert.equal(yandexCountries.find((country) => country.code === "137")?.kind, "country");
  assert.deepEqual(searchXmlRiverRegions("yandex", "", 100, "jp").map((region) => region.code), ["137"]);
  const russianMoscow = searchXmlRiverRegions("yandex", "Москва", 10, "RU");
  assert.equal(russianMoscow[0]?.code, "213");
  assert.ok(russianMoscow.every((region) => region.countryCode === "RU"));
  assert.deepEqual(searchXmlRiverRegions("yandex", "Москва", 10, "JP"), []);
  assert.ok(xmlRiverRegionsForCountry("yandex", "ru").some((region) => region.code === "213"));
  assert.ok(xmlRiverRegionsForCountry("google", "US").some((region) => region.code === "1016864"));
});

test("XMLRiver region API returns searchable human-readable catalog and source version", { concurrency: false }, async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/xmlriver-regions?engine=google&q=москва&limit=5"), environment(), context());
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.engine, "google");
  assert.equal(data.version, XMLRIVER_REGION_CATALOG_VERSION);
  assert.equal(data.total, 99_819);
  assert.equal(data.regions[0].label, "Москва");
  assert.equal(data.regions[0].code, "1011969");
  assert.match(data.regions[0].displayLabel, /Russia — 1011969$/u);
  assert.match(data.source.catalog, /^https:\/\/xmlriver\.com\//);

  const countriesResponse = await worker.fetch(new Request("http://localhost/api/xmlriver-regions?engine=yandex&countries=1"), environment(), context());
  const countriesData = await countriesResponse.json();
  assert.equal(countriesResponse.status, 200);
  assert.equal(countriesData.total, countriesData.countries.length);
  assert.equal(countriesData.countries.find((country) => country.countryCode === "JP")?.code, "137");

  const filteredResponse = await worker.fetch(new Request("http://localhost/api/xmlriver-regions?engine=yandex&countryCode=RU&q=Москва&limit=5"), environment(), context());
  const filteredData = await filteredResponse.json();
  assert.equal(filteredResponse.status, 200);
  assert.equal(filteredData.countryCode, "RU");
  assert.equal(filteredData.regions[0].code, "213");
});

test("competitor search sends normalized numeric XMLRiver region and returns its label", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let requestedRegion = "";
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    requestedRegion = url.searchParams.get("lr") ?? "";
    return new Response(xmlPage(0), { status: 200, headers: { "content-type": "application/xml; charset=utf-8" } });
  };

  try {
    const worker = await loadWorker();
    const { response, data } = await post(worker, "/api/search-competitors", {
      query: "курсы seo",
      engine: "yandex",
      region: "Москва (213)",
      count: 1,
      credentials: { user: "test-user", key: "test-key" },
    });
    assert.equal(response.status, 200, data.error || "search failed");
    assert.equal(requestedRegion, "213");
    assert.equal(data.region.code, "213");
    assert.equal(data.region.label, "Москва");
    assert.equal(data.region.displayLabel, "Москва, Россия — 213");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

test("configured Firecrawl is an automatic sequential fallback, rejects bad stubs, and is skipped on snapshot recalc", { concurrency: false }, async () => {
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
