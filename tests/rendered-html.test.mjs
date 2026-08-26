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

test("does not publish the archived semantic-triplet API", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request("http://localhost/api/analyze-triplets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }), environment(), context());
  assert.equal(response.status, 404);
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
  assert.match(page, /Важность — оценка 0–100/);
  assert.match(page, /TF-IDF, число документов с леммой и подтверждение в ключах и заголовках/);
  assert.match(page, /распространённость фразы у конкурентов и смысловая связь с ключами/);
  assert.match(page, /Точные коэффициенты не показываются/);
  assert.match(landing, /Важность — оценка 0–100/);
  assert.match(landing, /точные коэффициенты не показываются/);
  const coreImportanceMethodology = core.match(/importance:\s*"([^"]+)"/)?.[1] ?? "";
  assert.equal(coreImportanceMethodology, "Важность рассчитывается по совокупности статистических и семантических сигналов релевантности.");
  assert.doesNotMatch(coreImportanceMethodology, /доля документов|точное совпадение|устойчивое присутствие|\bDF\b|[×*]/iu);
  assert.doesNotMatch(page, /TF-IDF × 1,35|нормализованный TF-IDF|бустер ×1,35|1[,.]15/iu);
  assert.doesNotMatch(landing, /TF-IDF × 1,35|нормализованный TF-IDF|бустер ×1,35|1[,.]15/iu);
  assert.match(page, /Q25–Q75/);
  const lemmaSection = page.slice(page.indexOf("<h2>Леммы и важность</h2>"), page.indexOf('<h2 id="clouds-heading">Облако</h2>'));
  assert.ok(lemmaSection.length > 0, "lemma section must be present in the analyzer source");
  assert.doesNotMatch(lemmaSection, /cosine|косинус/i);
  for (const label of ["TF-IDF ключей", "Взвешенный охват", "Взвешенная плотность"]) {
    assert.match(page, new RegExp(label));
    assert.match(landing, new RegExp(label));
  }
  assert.match(page, /Сравнение документов по метрикам/);
  assert.match(page, /function average\(values: readonly number\[\]\)/);
  assert.match(page, /const competitorMetricAverages =/);
  assert.match(page, /benchmark=\{competitorDocuments\.length \? percent\(competitorMetricAverages\.keyTfidfScore\)/);
  assert.match(page, /benchmark=\{competitorDocuments\.length \? percent\(competitorMetricAverages\.weightedCoverage\)/);
  assert.match(page, /benchmark=\{competitorDocuments\.length \? percent\(competitorMetricAverages\.weightedDensity\)/);
  assert.match(page, /из \{benchmark\}/);
  assert.match(page, /DocumentSortableHeader label="Взвешенная плотность"/);
  assert.match(page, /percent\(result\.summary\.weightedDensity\)/);
  assert.match(page, /percent\(doc\.weightedDensity\)/);
  assert.match(page, /выполнение ориентиров по вхождениям/);
  assert.doesNotMatch(page, /Плотность \/ 1000|weightedDensity\)} \/ 1000|weightedDensity\)}[^\n]*на 1 000 слов/);
  const landingDensityLabel = landing.indexOf("Взвешенная плотность");
  const landingDensity = landing.slice(landingDensityLabel, landing.indexOf("</article>", landingDensityLabel));
  assert.match(landingDensity, /%/);
  assert.match(landingDensity, /выполнение ориентиров/);
  assert.doesNotMatch(landingDensity, /1 000|1000/);
  const densityMethodology = core.match(/weightedDensity:\s*"([^"]+)"/)?.[1] ?? "";
  assert.match(densityMethodology, /Взвешенное выполнение ориентиров/);
  assert.match(densityMethodology, /конкурентных медиан/);
  assert.doesNotMatch(densityMethodology, /medianCount/);
  assert.doesNotMatch(densityMethodology, /1 000|1000/);
  assert.match(page, /N-граммы и связь с ключами/);
  assert.match(page, /Возможно ключ/);
  assert.match(page, /SortableHeader label="Попадание в ключ"/);
  assert.match(page, /row\.keywordHit === true \|\| row\.keyMatch === "exact"/);
  assert.match(core, /keyMatch: exactQueryMatch \? "exact" : semantic\.keySimilarity > 0\.8 \? "possible" : "none"/);
  assert.doesNotMatch(page, /<th>Ближайший ключ<\/th>|<th>Сходство с ключом<\/th>|<th>Приоритет<\/th>/);
  assert.match(page, /function SortableHeader/);
  assert.match(page, /aria-sort=\{ariaSort\}/);
  assert.match(page, /const COLUMN_TOOLTIPS/);
  assert.match(page, /function HelpTip/);
  assert.match(page, /data-tooltip=\{text\}/);
  assert.match(page, /title=\{explanation\}/);
  assert.match(css, /\.helpTip::after/);
  assert.match(page, /<h2 id="clouds-heading">Облако<\/h2>/);
  assert.doesNotMatch(page, /Облака слов: три страницы на одной шкале/);
  assert.match(page, /ТЗ для страницы/);
  assert.match(page, /Копировать MD/);
  assert.match(page, /buildPageBrief/);
  assert.match(page, /\/api\/xmlriver-regions\?/);
  assert.match(page, /<datalist id=\{`xmlriver-regions-/);
  assert.match(page, /region: searchData\.region\?\.displayLabel \|\| searchData\.region\?\.label \|\| region/);
  assert.match(page, /Москва, Россия — 213/);
  assert.match(page, /const \[countryCode, setCountryCode\] = useState\("RU"\)/);
  assert.match(page, /countries=1/);
  assert.match(page, /new URLSearchParams\(\{ engine, countryCode, limit: "100" \}\)/);
  assert.match(page, /<span>Страна<\/span>/);
  assert.match(page, /<span>Город или регион<\/span>/);
  assert.match(page, /const \[language, setLanguage\] = useState\("ru"\)/);
  assert.match(page, /const INITIAL_STOP_TERMS = stopTermPresetText\("ru"\)/);
  assert.match(page, /option\.morphology === "lemmatization" \? "лемматизация"/);
  assert.match(css, /\.queryGrid\s*\{[^}]*align-items:\s*start/);
  assert.match(page, /следующее поле покажет только её регионы/);
  assert.match(page, /Выберите город, регион или всю страну из подсказок XMLRiver/);
  assert.match(page, /nesting\.mergeable !== true/);
  assert.match(page, /nesting\.ownMergeParentComplete !== true/);
  assert.match(page, /nestedChildren/);
  assert.doesNotMatch(page, /ngramNestingNote|частично внутри|все найденные вхождения внутри|Вложенность:/);
  assert.match(page, /https:\/\/t\.me\/closedchannelkotenkov/);
  assert.match(page, /<Link className=\{styles\.brand\} href="\/"/);
  assert.match(page, /XMLRiver — обязательный источник выдачи/);
  assert.match(page, /https:\/\/xmlriver\.com\//);
  assert.match(page, /serverConfigured === false && <a href="https:\/\/xmlriver\.com\/"[^>]*>Подключить XMLRiver ↗<\/a>/);
  assert.match(page, /Firecrawl — дополнительный fallback/);
  assert.match(page, /https:\/\/www\.firecrawl\.dev\//);
  assert.match(page, /firecrawlConfigured === false && <a href="https:\/\/www\.firecrawl\.dev\/"[^>]*>Подключить Firecrawl ↗<\/a>/);
  assert.match(page, /fallback включается автоматически/);
  assert.doesNotMatch(page, /useFirecrawl|Использовать Firecrawl для недоступных URL/);
  assert.doesNotMatch(core, /payload\.useFirecrawl/);
  assert.doesNotMatch(page, /fetch\("\/api\/analyze-triplets"|id="triplets"|Семантические связи/);
  assert.doesNotMatch(page, /\["Все", "Добавить", "Норма", "Снизить"\]/);
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

test("landing demo removes the main-conclusion callout and makes every table column sortable", async () => {
  const landing = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(landing, /Главный вывод/);
  assert.equal((landing.match(/<table>/g) ?? []).length, 3, "landing must keep its three data tables");
  assert.equal(
    (landing.match(/<LandingSortableHeader\s+label=/g) ?? []).length,
    19,
    "all 19 columns across the lemma, N-gram and volume tables must be clickable",
  );
  assert.match(landing, /function LandingSortableHeader/);
  assert.match(landing, /aria-sort=\{ariaSort\}/);
  assert.match(landing, /sortRows\(rows, lemmaSort/);
  assert.match(landing, /sortRows\(ngrams, ngramSort/);
  assert.match(landing, /sortRows\(wordCounts, volumeSort/);
  assert.match(landing, /sortedNgrams\.map/);
  assert.match(landing, /sortedWordCounts\.map/);
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
