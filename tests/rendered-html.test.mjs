import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const environment = () => ({ ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } });
const context = () => ({ waitUntil() {}, passThroughOnException() {} });

test("renders the Russian analyzer interface", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/analyzer", { headers: { accept: "text/html" } }), environment(), context());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /БАР/);
  assert.match(html, /Сравните страницу с реальными конкурентами/);
  assert.match(html, /Найти и проанализировать/);
  assert.doesNotMatch(html, /РЎРµСЂРІРёСЃ|РќР°Р№С‚Рё|РџРѕРёСЃРє|вЂ/);
});

test("keeps large analytical tables paginated and presents the three public document metrics", async () => {
  const [page, landing, core, css, layout, cloudLayout] = await Promise.all([
    readFile(new URL("../app/analyzer/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/semantic-analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/analyzer/analyzer.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/analyzer/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/cloud-layout.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /TERM_PAGE_SIZE = 20/);
  assert.match(page, /NGRAM_PAGE_SIZE = 15/);
  assert.match(page, /const cloudMax = Math\.max\(\.0001, \.\.\.activeCloudFrequencies\)/);
  assert.match(page, /sessionStorage\.setItem\(REPORT_STORAGE_KEY/);
  assert.match(page, /const REPORT_STORAGE_KEY = "bar:last-report:v10"/);
  assert.match(page, /const LEGACY_REPORT_STORAGE_KEY = "bar:last-report:v9"/);
  assert.match(page, /type StoredReport =/);
  assert.match(page, /version: 10/);
  assert.match(page, /version: 10, report/);
  assert.match(page, /stored\?\.version === 10/);
  assert.doesNotMatch(page, /bar:last-report:v8|StoredReportV8|version: 8/);
  assert.match(page, /Стоп-слова/);
  assert.match(page, /Стоп-фразы/);
  assert.match(page, /Зона анализа лемм/);
  assert.match(page, /Зона анализа N-грамм/);
  assert.match(page, /Показать ещё 12/);
  const importanceExplanation = "Важность рассчитывается на основе TF-IDF и других сигналов релевантности.";
  assert.match(page, new RegExp(importanceExplanation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(landing, new RegExp(importanceExplanation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const enumeratedImportanceComponents = /распространённость среди конкурентов|совпадение с входными ключами|устойчивость сигнала по корпусу/iu;
  assert.doesNotMatch(page, enumeratedImportanceComponents);
  assert.doesNotMatch(landing, enumeratedImportanceComponents);
  const coreImportanceMethodology = core.match(/importance:\s*"([^"]+)"/)?.[1] ?? "";
  assert.equal(coreImportanceMethodology, "Важность рассчитывается по совокупности статистических и семантических сигналов релевантности.");
  assert.doesNotMatch(coreImportanceMethodology, /доля документов|точное совпадение|устойчивое присутствие|\bDF\b|[×*]/iu);
  assert.doesNotMatch(page, /TF-IDF × 1,35|нормализованный TF-IDF|бустер ×1,35|1[,.]15/iu);
  assert.doesNotMatch(landing, /TF-IDF × 1,35|нормализованный TF-IDF|бустер ×1,35|1[,.]15/iu);
  assert.match(page, /Q25–Q75/);
  const lemmaSection = page.slice(page.indexOf("<h2>Леммы и важность</h2>"), page.indexOf("<h2>Облака слов:"));
  assert.ok(lemmaSection.length > 0, "lemma section must be present in the analyzer source");
  assert.doesNotMatch(lemmaSection, /cosine|косинус/i);
  for (const label of ["TF-IDF ключей", "Взвешенный охват", "Взвешенная плотность"]) {
    assert.match(page, new RegExp(label));
    assert.match(landing, new RegExp(label));
  }
  assert.match(page, /Сравнение документов по метрикам/);
  assert.match(page, /<span>Взвешенная плотность<\/span>/);
  assert.match(page, /percent\(result\.summary\.weightedDensity\)/);
  assert.match(page, /percent\(doc\.weightedDensity\)/);
  assert.match(page, /выполнение ориентиров по вхождениям/);
  assert.doesNotMatch(page, /Плотность \/ 1000|weightedDensity\)} \/ 1000|weightedDensity\)}[^\n]*на 1 000 слов/);
  const landingDensity = landing.slice(landing.indexOf("<article><span>Взвешенная плотность"), landing.indexOf("</article>", landing.indexOf("<article><span>Взвешенная плотность")));
  assert.match(landingDensity, /%/);
  assert.match(landingDensity, /выполнение ориентиров/);
  assert.doesNotMatch(landingDensity, /1 000|1000/);
  const densityMethodology = core.match(/weightedDensity:\s*"([^"]+)"/)?.[1] ?? "";
  assert.match(densityMethodology, /Взвешенное выполнение ориентиров/);
  assert.match(densityMethodology, /конкурентных медиан/);
  assert.doesNotMatch(densityMethodology, /medianCount/);
  assert.doesNotMatch(densityMethodology, /1 000|1000/);
  assert.match(page, /N-граммы и сходство с ключами/);
  assert.match(page, /Сходство с ключом/);
  assert.match(page, /<summary>Методика расчёта<\/summary>/);
  assert.match(page, /Object\.values\(result\.methodology \|\| \{\}\)/);
  assert.match(page, /typeof value === "string"/);
  assert.doesNotMatch(page, /cosine|косинус/i);
  assert.doesNotMatch(landing, /cosine|косинус/i);
  assert.doesNotMatch(page, /queryRelevance|competitorSimilarity|semanticCoverage|ngramCoverage/);
  assert.doesNotMatch(landing, /queryRelevance|competitorSimilarity|semanticCoverage|ngramCoverage/);
  assert.match(css, /position:\s*sticky/);
  assert.match(css, /\.zoneTabs/);
  assert.match(css, /\.chartMore/);
  assert.match(layout, /БАР — бесплатный анализ релевантности/);

  const cloudZonesBlock = page.slice(page.indexOf("const CLOUD_ZONES"), page.indexOf("type StoredReport ="));
  let previousZoneIndex = -1;
  for (const label of ['label: "Все"', 'label: "Title"', 'label: "H1"', 'label: "H2–H6"', 'label: "Text"', 'label: "<a>"']) {
    const index = cloudZonesBlock.indexOf(label);
    assert.ok(index > previousZoneIndex, `cloud zone ${label} is absent or out of order`);
    previousZoneIndex = index;
  }
  assert.match(page, /const \[cloudZone, setCloudZone\] = useState<ZoneKey>\("all"\)/);
  assert.match(page, /aria-label="HTML-зона облаков слов"/);
  assert.match(page, /result\?\.clouds\.zones\?\.\[cloudZone\]/);
  assert.match(page, /selectedProfile\?\.cloudZones\?\.\[cloudZone\]/);
  assert.doesNotMatch(page, /\bCloudMode\b|\bcloudMode\b|\bsetCloudMode\b/);

  const cloudSection = page.slice(
    page.indexOf('<section className={styles.reportSection} aria-labelledby="clouds-heading">'),
    page.indexOf('<section className={styles.reportSection}>', page.indexOf('aria-labelledby="clouds-heading"')),
  );
  assert.equal((cloudSection.match(/<Cloud\s/g) ?? []).length, 3, "all three comparison clouds must always be rendered");
  assert.match(cloudSection, /title="Среднее конкурентов"/);
  assert.match(cloudSection, /title="Наша страница"/);
  assert.match(cloudSection, /hostLabel\(selectedProfile\.url\).*"Выбранный конкурент"/s);
  assert.match(cloudSection, /Конкурент в третьем облаке/);
  assert.match(cloudSection, /aria-label="Выбрать конкурента для третьего облака слов"/);
  assert.match(cloudSection, /onChange=\{\(event\) => setSelectedCompetitorId\(event\.target\.value\)\}/);
  assert.match(css, /\.cloudGrid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*?\.cloudGrid\s*\{[\s\S]*?grid-auto-flow:\s*column/);

  const cloudLimit = Number(cloudLayout.match(/export const CLOUD_LAYOUT_WORD_LIMIT = (\d+)/)?.[1] ?? 0);
  assert.ok(cloudLimit >= 45, `cloud capacity ${cloudLimit} is below the 45-word acceptance floor`);
  assert.match(page, /packCloudWords\(words, maxFrequency\)/);
  assert.match(cloudLayout, /\.slice\(0, Math\.max\(0, limit\)\)/);
  assert.match(cloudLayout, /\.sort\(\(left, right\) => right\.frequency - left\.frequency/);
  assert.match(cloudLayout, /const centerX = CLOUD_LAYOUT_WIDTH \/ 2/);
  assert.match(cloudLayout, /const centerY = CLOUD_LAYOUT_HEIGHT \/ 2/);
  assert.match(cloudLayout, /commit\(item, centerX, centerY, fontSize, width, height, bounds\)/);
  assert.match(page, /className=\{index === 0 \? styles\.cloudCenter : ""\}/);
  assert.match(cloudLayout, /return 8 \+ Math\.pow\(ratio, 1\.05\) \* 26/);
  assert.doesNotMatch(page, /lengthScale/);
  assert.doesNotMatch(cloudLayout, /lengthScale/);
});

test("competitor benchmarks do not change when only the own page changes", async () => {
  const worker = await loadWorker();
  const suffix = "Программа включает практические занятия, реальные проекты, проверку домашних заданий, поддержку наставника, работу с инструментами аналитики, подготовку стратегии продвижения, исследование спроса и разбор практических примеров для бизнеса.";
  const competitors = [
    "SEO курсы для начинающих. Практическое обучение SEO, семантическое ядро и продвижение сайта.",
    "Курсы SEO онлайн. Обучение поисковой оптимизации, аудит сайта и работа с семантикой.",
    "Профессия SEO специалист. Курс по продвижению сайтов, контенту и аналитике.",
    "Обучение SEO с нуля. Курсы, практика, семантическое ядро и техническая оптимизация.",
    "Онлайн курс SEO. Поисковое продвижение, сбор запросов, аудит и стратегия контента.",
    "SEO обучение для маркетологов. Курсы оптимизации сайта и работа с поисковым спросом.",
  ].map((text, index) => ({ name: `Конкурент ${index + 1}`, position: index + 1, text: `${text} ${suffix}` }));

  const run = async (ownText) => {
    const response = await worker.fetch(new Request("http://localhost/api/analyze-run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "seo курсы", competitors, ownPage: { name: "Наша страница", text: `${ownText} ${suffix}` }, search: { engine: "yandex", region: "213", device: "desktop", found: competitors.length } }),
    }), environment(), context());
    const data = await response.json();
    assert.equal(response.status, 200, data.error || "analysis route failed");
    return data;
  };

  const first = await run("Короткая тестовая страница про интернет-маркетинг, рекламу и развитие бизнеса в сети.");
  const second = await run("SEO курсы и обучение SEO. Семантическое ядро, аудит сайта, продвижение сайта и поисковая оптимизация для начинающих специалистов.");
  const firstTerm = first.terms.find((row) => row.term === "курсы");
  const secondTerm = second.terms.find((row) => row.term === "курсы");
  assert.ok(firstTerm && secondTerm, "query form must stay visible in the lemma table");
  assert.equal(firstTerm.idf, secondTerm.idf);
  assert.equal(firstTerm.competitorTfidf, secondTerm.competitorTfidf);
  assert.ok(first.ngrams.every((row) => !/^(на|и|в|с|по)\b|\b(на|и|в|с|по)$/i.test(row.phrase)));
  assert.ok(first.summary.recommendedMin <= first.summary.recommendedMax);
  assert.equal(first.meta.competitorsAnalyzed, competitors.length);
  assert.equal(first.documents.filter((row) => !row.ours).length, competitors.length);
});
