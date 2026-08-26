import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadLanguageSupport() {
  const source = await readFile(new URL("../lib/language-support.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: "language-support.ts",
    reportDiagnostics: true,
  });
  const errors = (transpiled.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors, []);
  const encoded = Buffer.from(transpiled.outputText, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
}

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("multilingual-v13-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const environment = () => ({ ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } });
const context = () => ({ waitUntil() {}, passThroughOnException() {} });

async function analyze(worker, fixture) {
  const competitors = Array.from({ length: 4 }, (_, index) => ({
    name: `${fixture.language}-${index + 1}`,
    position: index + 1,
    text: `${fixture.text} ${fixture.text}`,
  }));
  const response = await worker.fetch(new Request("http://localhost/api/analyze-run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      queries: [fixture.query],
      serpQuery: fixture.query,
      language: fixture.language,
      competitors,
      ownPage: { name: "own", text: `${fixture.text} ${fixture.text}` },
      search: { engine: "google", region: fixture.language, device: "desktop", found: competitors.length },
    }),
  }), environment(), context());
  const report = await response.json();
  assert.equal(response.status, 200, report.error || `${fixture.language} analysis failed`);
  return report;
}

function rowWithForms(report, expectedForms) {
  return report.terms.find((row) => expectedForms.every((form) => row.forms.includes(form)));
}

test("language registry distinguishes lemmatization, Snowball stemming and token-only processing", async () => {
  const { LANGUAGE_CONFIGS, LANGUAGE_OPTIONS, SNOWBALL_ALGORITHMS, languageCapability } = await loadLanguageSupport();
  assert.equal(LANGUAGE_OPTIONS.length, Object.keys(LANGUAGE_CONFIGS).length);
  assert.ok(LANGUAGE_OPTIONS.length >= 40);
  const algorithms = new Set(SNOWBALL_ALGORITHMS);
  for (const [language, config] of Object.entries(LANGUAGE_CONFIGS)) {
    if (language !== "ru") assert.equal(config.morphology, config.stemmer ? "stemming" : "tokens", language);
    if (config.stemmer) assert.ok(algorithms.has(config.stemmer), `${language}: unknown Snowball stemmer`);
    assert.equal(Boolean(languageCapability(language)), true);
  }
  assert.equal(languageCapability("ru").morphology, "lemmatization");
  assert.match(languageCapability("ru").morphologyLabel, /лемматизация/u);
  assert.equal(languageCapability("uk").morphology, "tokens");
  assert.equal(languageCapability("sr").stopwords, undefined, "unsupported Serbian stopword export must not be promised");
});

test("RU, EN and ES merge inflections while a language without a stemmer keeps forms separate", { concurrency: false }, async () => {
  const worker = await loadWorker();
  const fixtures = [
    {
      language: "ru",
      query: "seo курс",
      forms: ["курс", "курсы", "курса"],
      stopword: "теперь",
      phraseForms: ["seo курс", "seo курсы"],
      text: "seo курс seo курсы seo курса теперь анализ стратегия продвижение обучение аудит контент запрос сайт страница результат исследование инструмент показатель структура рекомендация специалист технология практика тематика семантика",
    },
    {
      language: "en",
      query: "seo course",
      forms: ["course", "courses"],
      stopword: "which",
      phraseForms: ["seo course", "seo courses"],
      text: "seo course seo courses which analysis strategy promotion training audit content query website page result research tool metric structure recommendation specialist technology practice topic semantics marketing search optimization reporting planning measurement business project exercise keyword relevance quality",
    },
    {
      language: "es",
      query: "curso seo",
      forms: ["curso", "cursos"],
      stopword: "para",
      phraseForms: ["curso seo", "cursos seo"],
      text: "curso seo cursos seo para análisis estrategia promoción formación auditoría contenido consulta sitio página resultado investigación herramienta métrica estructura recomendación especialista tecnología práctica tema semántica marketing búsqueda optimización informe planificación medición negocio proyecto ejercicio palabra relevancia calidad",
    },
  ];

  for (const fixture of fixtures) {
    const report = await analyze(worker, fixture);
    assert.equal(report.meta.morphologyMode, fixture.language === "ru" ? "lemmatization" : "stemming", fixture.language);
    assert.match(report.meta.morphologyLabel, fixture.language === "ru" ? /Az\.Morph/u : /Snowball/u);
    assert.equal(report.meta.builtInStopwords, true);
    assert.ok(rowWithForms(report, fixture.forms), `${fixture.language}: inflected forms were not merged`);
    assert.equal(report.terms.some((row) => row.forms.includes(fixture.stopword)), false, `${fixture.language}: built-in stopword leaked`);
    assert.ok(report.ngrams.some((row) => fixture.phraseForms.every((form) => row.forms.includes(form))), `${fixture.language}: normalized N-gram forms were not merged`);
  }

  const russianMorphology = await analyze(worker, {
    language: "ru",
    query: "seo курс",
    text: "seo курс курсы курсов месяц месяца месяцев академия академии лучший лучшие анализ стратегия продвижение обучение аудит контент запрос сайт страница результат исследование инструмент показатель структура рекомендация специалист технология практика тематика семантика маркетинг поиск оптимизация отчет планирование измерение бизнес проект упражнение слово релевантность качество",
  });
  assert.ok(rowWithForms(russianMorphology, ["месяц", "месяца", "месяцев"]), "Russian morphology must merge month forms under a real lemma");
  assert.ok(rowWithForms(russianMorphology, ["академия", "академии"]), "Russian morphology must normalize nouns instead of truncating endings");
  assert.ok(rowWithForms(russianMorphology, ["лучший", "лучшие"]), "Russian morphology must normalize irregular adjective forms");

  const ukrainian = await analyze(worker, {
    language: "uk",
    query: "seo курс",
    text: "seo курс seo курси який аналіз стратегія просування навчання аудит контент запит сайт сторінка результат дослідження інструмент показник структура рекомендація фахівець технологія практика тематика семантика маркетинг пошук оптимізація звіт планування вимірювання бізнес проєкт вправа слово релевантність якість",
  });
  assert.equal(ukrainian.meta.morphologyMode, "tokens");
  assert.match(ukrainian.meta.morphologyLabel, /без склейки/u);
  assert.equal(ukrainian.meta.builtInStopwords, true);
  assert.ok(ukrainian.terms.some((row) => row.forms.includes("курс")));
  assert.ok(ukrainian.terms.some((row) => row.forms.includes("курси")));
  assert.equal(rowWithForms(ukrainian, ["курс", "курси"]), undefined, "token-only forms must remain separate");
  assert.equal(ukrainian.terms.some((row) => row.forms.includes("який")), false);
});

test("auto language detection separates ambiguous Cyrillic and Arabic-script languages", { concurrency: false }, async () => {
  const worker = await loadWorker();
  const fixtures = [
    {
      expected: "bg",
      expectedBuiltInStops: true,
      query: "seo курсове",
      text: "seo курсове и практическо обучение за търсене и оптимизация на уебсайт съдържание одит стратегия студенти програма умения онлайн уроци проект резултат връзки инструменти маркетинг бизнес анализ ключови думи техническа проверка преподаватели упражнения сертификат професия",
    },
    {
      expected: "sr",
      expectedBuiltInStops: false,
      query: "сео курсеви",
      text: "сео курсеви и практична обука за претрагу и оптимизацију сајта садржај ревизија стратегија студенти програм вештине онлајн лекције пројекат резултат пракса алати маркетинг посао анализа кључне речи техничка провера предавачи вежбе сертификат решење време овде",
    },
    {
      expected: "fa",
      expectedBuiltInStops: true,
      query: "دوره سئو",
      text: "دوره سئو و آموزش کاربردی برای جستجو و بهینه سازی وبسایت محتوای راهبردی ممیزی دانشجویان برنامه مهارت آنلاین درس پروژه نتیجه تمرین ابزار بازاریابی کسب و کار تحلیل کلمات کلیدی بررسی فنی استاد گواهی پیشرفت پژوهش گزارش اندازه گیری کیفیت",
    },
    {
      expected: "ur",
      expectedBuiltInStops: true,
      query: "SEO کورس",
      text: "SEO کورس اور عملی تربیت کے لیے ویب سائٹ تلاش اور بہتری کا مواد حکمت عملی جائزہ طلبہ پروگرام مہارتیں آن لائن سبق منصوبہ نتیجہ مشق اوزار مارکیٹنگ کاروبار تجزیہ کلیدی الفاظ تکنیکی جانچ اساتذہ سرٹیفکیٹ پیش رفت تحقیق رپورٹ پیمائش معیار پڑھنے والے",
    },
  ];

  for (const fixture of fixtures) {
    const report = await analyze(worker, { language: "auto", query: fixture.query, text: fixture.text });
    assert.equal(report.meta.language, fixture.expected, `${fixture.expected}: auto language mismatch`);
    assert.equal(report.meta.builtInStopwords, fixture.expectedBuiltInStops, `${fixture.expected}: stopword capability must follow detected language`);
  }
});

test("multiword built-in stop entries match token sequences without suppressing component lemmas", { concurrency: false }, async () => {
  const worker = await loadWorker();
  const text = "phân tích seo đến nỗi một cách chiến lược nội dung tìm kiếm tối ưu trang web khóa học sinh viên chương trình kỹ năng trực tuyến bài học dự án kết quả thực hành công cụ tiếp thị kinh doanh dữ liệu nghiên cứu báo cáo đo lường chất lượng chuyên gia công nghệ; nỗi riêng và cách riêng vẫn mang ý nghĩa";
  const report = await analyze(worker, { language: "vi", query: "phân tích seo", text });

  assert.equal(report.ngrams.some((row) => row.forms.includes("đến nỗi") || row.forms.includes("một cách")), false);
  assert.equal(report.terms.find((row) => row.forms.includes("đến"))?.ownCount, 2);
  assert.equal(report.terms.find((row) => row.forms.includes("một"))?.ownCount, 2);
  const standalonePain = report.terms.find((row) => row.forms.includes("nỗi"));
  const standaloneWay = report.terms.find((row) => row.forms.includes("cách"));
  assert.equal(standalonePain?.ownCount, 4, "phrase filtering must not remove component lemma occurrences");
  assert.equal(standaloneWay?.ownCount, 4, "phrase filtering must not remove component lemma occurrences");
});
