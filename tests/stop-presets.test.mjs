import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const PRESET_MODULE = new URL("../lib/default-stop-terms.ts", import.meta.url);

async function loadPresetModule() {
  const source = await readFile(PRESET_MODULE, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      removeComments: true,
    },
    fileName: "default-stop-terms.ts",
    reportDiagnostics: true,
  });
  const errors = (transpiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors, [], "the default stop-list module must transpile without errors");
  const encoded = Buffer.from(transpiled.outputText, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("stop-preset-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const environment = () => ({
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
});
const context = () => ({ waitUntil() {}, passThroughOnException() {} });

function normalized(value) {
  return String(value).normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
}

function rowForms(row) {
  return [row?.key, row?.term, ...(row?.forms ?? [])].filter(Boolean).map(normalized);
}

function hasTerm(report, surface) {
  const expected = normalized(surface);
  return report.terms.some((row) => rowForms(row).includes(expected));
}

function hasPhrase(report, phrase) {
  const expected = normalized(phrase);
  return report.ngrams.some((row) => [row?.key, row?.phrase, ...(row?.forms ?? [])]
    .filter(Boolean)
    .map(normalized)
    .some((form) => form.includes(expected)));
}

test("the curated preset keeps universal noise and excludes risky semantic terms", async () => {
  const {
    DEFAULT_STOP_WORDS,
    DEFAULT_STOP_PHRASES,
    DEFAULT_STOP_WORDS_TEXT,
    DEFAULT_STOP_PHRASES_TEXT,
    OPTIONAL_WEB_STOP_WORDS,
    OPTIONAL_WEB_STOP_PHRASES,
    OPTIONAL_WEB_STOP_WORDS_TEXT,
    OPTIONAL_WEB_STOP_PHRASES_TEXT,
  } = await loadPresetModule();

  assert.ok(Array.isArray(DEFAULT_STOP_WORDS) && DEFAULT_STOP_WORDS.length > 0);
  assert.ok(Array.isArray(DEFAULT_STOP_PHRASES) && DEFAULT_STOP_PHRASES.length > 0);
  assert.ok(Array.isArray(OPTIONAL_WEB_STOP_WORDS) && OPTIONAL_WEB_STOP_WORDS.length > 0);
  assert.ok(Array.isArray(OPTIONAL_WEB_STOP_PHRASES) && OPTIONAL_WEB_STOP_PHRASES.length > 0);
  assert.equal(DEFAULT_STOP_WORDS_TEXT, DEFAULT_STOP_WORDS.join("\n"));
  assert.equal(DEFAULT_STOP_PHRASES_TEXT, DEFAULT_STOP_PHRASES.join("\n"));
  assert.equal(OPTIONAL_WEB_STOP_WORDS_TEXT, OPTIONAL_WEB_STOP_WORDS.join("\n"));
  assert.equal(OPTIONAL_WEB_STOP_PHRASES_TEXT, OPTIONAL_WEB_STOP_PHRASES.join("\n"));

  const words = new Set(DEFAULT_STOP_WORDS.map(normalized));
  const phrases = new Set(DEFAULT_STOP_PHRASES.map(normalized));
  const optionalWords = new Set(OPTIONAL_WEB_STOP_WORDS.map(normalized));
  const optionalPhrases = new Set(OPTIONAL_WEB_STOP_PHRASES.map(normalized));

  for (const cta of ["нажмите", "оставьте", "скачайте"]) {
    assert.equal(words.has(cta), false, `CTA can carry intent and must not be enabled by default: ${cta}`);
    assert.ok(optionalWords.has(cta), `expected CTA noise in the optional web preset: ${cta}`);
  }
  for (const boilerplate of ["политика конфиденциальности", "политика конфидициальности", "персональные данные"]) {
    assert.equal(phrases.has(boilerplate), false, `web boilerplate must be opt-in: ${boilerplate}`);
    assert.ok(optionalPhrases.has(boilerplate), `expected boilerplate in the optional web preset: ${boilerplate}`);
  }

  for (const risky of ["качество", "метод", "данные", "кг", "мм", "seo"]) {
    assert.equal(words.has(risky), false, `a potentially semantic term must not be in the universal preset: ${risky}`);
    assert.equal(optionalWords.has(risky), false, `a semantic term must not be introduced by the optional web preset: ${risky}`);
  }

  for (const collision of [
    "весь", "другой", "типа", "любого", "любые", "следует", "сверх",
    "абсолютно", "безусловно", "видимо", "возможно", "действительно", "конечно",
    "просто", "прямо", "совершенно", "чрезвычайно", "ужасно",
  ]) {
    assert.equal(words.has(collision), false, `unsafe stem collision or meaningful modifier must not be enabled by default: ${collision}`);
  }
  for (const universal of ["который", "кому", "свой", "такой", "этот", "наш", "ваш"]) {
    assert.ok(words.has(universal), `expected universal pronominal noise in the safe preset: ${universal}`);
  }
});

test("the analyzer form starts with the preset and exposes restore and clear controls", async () => {
  const page = await readFile(new URL("../app/analyzer/page.tsx", import.meta.url), "utf8");

  assert.match(page, /DEFAULT_STOP_WORDS_TEXT/);
  assert.match(page, /DEFAULT_STOP_PHRASES_TEXT/);
  assert.match(page, /OPTIONAL_WEB_STOP_WORDS/);
  assert.match(page, /OPTIONAL_WEB_STOP_PHRASES/);
  assert.match(page, /useState\(DEFAULT_STOP_WORDS_TEXT\)/);
  assert.match(page, /useState\(DEFAULT_STOP_PHRASES_TEXT\)/);
  assert.match(page, /aria-label=["']Управление стоп-листом["']/u);
  assert.match(page, />Базовый(?:\s|<span>)/u);
  assert.match(page, />\+ Веб-шум(?:\s|<span>)/u);
  assert.match(page, />Очистить<\/button>/u);

  const stopFields = page.slice(page.indexOf("function StopFields"), page.indexOf("function downloadCsv"));
  assert.ok(stopFields.length > 0, "StopFields component must remain present");
  assert.match(stopFields, /applyDefaultStops/);
  assert.match(stopFields, /applyWebStops/);
  assert.match(stopFields, /clearStops/);
  assert.match(stopFields, /setStopWords\(DEFAULT_STOP_WORDS_TEXT\)/);
  assert.match(stopFields, /setStopPhrases\(DEFAULT_STOP_PHRASES_TEXT\)/);
  const applyWebStops = stopFields.slice(stopFields.indexOf("applyWebStops"), stopFields.indexOf("clearStops"));
  assert.match(applyWebStops, /setStopWords\(WEB_STOP_WORDS_TEXT\)/);
  assert.match(applyWebStops, /setStopPhrases\(WEB_STOP_PHRASES_TEXT\)/);
  assert.match(page, /WEB_STOP_WORDS\s*=\s*mergeStopTerms\(DEFAULT_STOP_WORDS,\s*OPTIONAL_WEB_STOP_WORDS\)/);
  assert.match(page, /WEB_STOP_PHRASES\s*=\s*mergeStopTerms\(DEFAULT_STOP_PHRASES,\s*OPTIONAL_WEB_STOP_PHRASES\)/);
  assert.match(stopFields, /setStopWords\(["']{2}\)/);
  assert.match(stopFields, /setStopPhrases\(["']{2}\)/);
});

test("safe and optional presets use the analyzer's existing stem and phrase filters", { concurrency: false }, async () => {
  const {
    DEFAULT_STOP_WORDS,
    DEFAULT_STOP_PHRASES,
    OPTIONAL_WEB_STOP_WORDS,
    OPTIONAL_WEB_STOP_PHRASES,
  } = await loadPresetModule();
  const worker = await loadWorker();
  const semanticText = [
    "SEO качество методы данные кг мм тип вес друг конечный возможность которые нажмите скачайте оставьте политика конфиденциальности.",
    "Аналитика стратегии продвижение обучение аудит контент запросы сайты страницы результаты исследования.",
    "Практический материал объясняет показатели, структуру, инструменты, измерения и рекомендации специалистам.",
  ].join(" ");
  const competitors = Array.from({ length: 4 }, (_, index) => ({
    name: `Документ ${index + 1}`,
    position: index + 1,
    text: `${semanticText} ${semanticText}`,
  }));

  const run = async (stopWords, stopPhrases) => {
    const response = await worker.fetch(new Request("http://localhost/api/analyze-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        queries: ["seo качество метод данные кг мм тип вес друг конечный возможность"],
        serpQuery: "seo качество метод данные кг мм тип вес друг конечный возможность",
        language: "ru",
        stopWords,
        stopPhrases,
        competitors,
        ownPage: { name: "Наша страница", text: `${semanticText} ${semanticText}` },
        search: { engine: "google", region: "ru", device: "desktop", found: competitors.length },
      }),
    }), environment(), context());
    const report = await response.json();
    assert.equal(response.status, 200, report.error || "preset analysis failed");
    return report;
  };

  const safeReport = await run(DEFAULT_STOP_WORDS, DEFAULT_STOP_PHRASES);
  for (const semantic of ["seo", "качество", "методы", "данные", "кг", "мм", "тип", "вес", "друг", "конечный", "возможность"]) {
    assert.equal(hasTerm(safeReport, semantic), true, `default preset must preserve semantic term: ${semantic}`);
  }
  assert.equal(hasTerm(safeReport, "которые"), false, "a grammatical form of the safe stop lemma «который» must be removed");
  for (const optional of ["нажмите", "скачайте", "оставьте"]) {
    assert.equal(hasTerm(safeReport, optional), true, `optional web noise must remain until the user enables it: ${optional}`);
  }
  assert.equal(hasPhrase(safeReport, "политика конфиденциальности"), true);

  const webReport = await run(
    [...new Set([...DEFAULT_STOP_WORDS, ...OPTIONAL_WEB_STOP_WORDS])],
    [...new Set([...DEFAULT_STOP_PHRASES, ...OPTIONAL_WEB_STOP_PHRASES])],
  );
  for (const stopped of ["нажмите", "скачайте", "оставьте"]) {
    assert.equal(hasTerm(webReport, stopped), false, `optional web stop must be removed by the analysis pipeline: ${stopped}`);
  }
  assert.equal(hasPhrase(webReport, "политика конфиденциальности"), false);
});
