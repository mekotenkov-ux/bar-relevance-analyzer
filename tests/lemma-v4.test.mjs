import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("lemma-v4-test", `${process.pid}-${Date.now()}-${Math.random()}`);
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
  const data = await response.json();
  return { response, data };
}

const COMMON_TEXT = [
  "Практический курс объясняет технический аудит сайта, структуру страниц, поисковую аналитику и исследование спроса.",
  "Студенты изучают контентную стратегию, семантическое ядро, внутренние ссылки, индексацию и измерение результатов.",
  "Программа содержит уроки, упражнения, разборы проектов, рекомендации преподавателей и работу с реальными данными.",
  "Материалы помогают планировать публикации, исправлять ошибки, улучшать качество страниц и оценивать эффективность изменений.",
].join(" ");

function richText(extra) {
  return `${extra} ${COMMON_TEXT} ${COMMON_TEXT}`;
}

const textCompetitors = [
  {
    name: "Академия один",
    position: 1,
    text: richText("seo продвижение сайта. Лучший онлайн курс seo включает аналитику и практику."),
  },
  {
    name: "Школа два",
    position: 2,
    text: richText("Продвижения сайта требуют системного подхода. Лучший онлайн курс включает аналитику и практику."),
  },
  {
    name: "Институт три",
    position: 3,
    text: richText("Специалисты занимаются продвижению проекта и измерением показателей. Лучший онлайн курс включает аналитику."),
  },
  {
    name: "Центр четыре",
    position: 4,
    text: richText("Управление продвижением проекта начинается с исследования. Лучший онлайн курс включает практику и аналитику."),
  },
];

const textOwnPage = {
  name: "Наша страница",
  text: richText("Онлайн курс знакомит с продвижением сайта, аналитикой, исследованиями и практической работой."),
};

let initialTextReportPromise;

async function initialTextReport() {
  if (!initialTextReportPromise) {
    initialTextReportPromise = loadWorker().then(async (worker) => {
      const result = await postAnalysis(worker, {
        queries: ["курсы seo"],
        serpQuery: "курсы seo",
        language: "ru",
        competitors: textCompetitors,
        ownPage: textOwnPage,
        search: { engine: "google", region: "ru", device: "desktop", found: textCompetitors.length },
      });
      assert.equal(result.response.status, 200, result.data.error || "initial text analysis failed");
      return { worker, report: result.data };
    });
  }
  return initialTextReportPromise;
}

function termForms(row) {
  return [row?.key, row?.term, ...(row?.forms ?? [])].filter(Boolean);
}

function findTerm(report, surface) {
  return report.terms.find((row) => termForms(row).includes(surface));
}

function findTermPrefix(report, prefix) {
  return report.terms.find((row) => termForms(row).some((form) => form.startsWith(prefix)));
}

function phraseForms(row) {
  return [row?.key, row?.phrase, ...(row?.forms ?? [])].filter(Boolean);
}

function containsPhrase(report, phrase) {
  return report.ngrams.some((row) => phraseForms(row).some((form) => form.includes(phrase)));
}

test("a query lemma is included even when its competitor DF is below the normal cutoff", { concurrency: false }, async () => {
  const { report } = await initialTextReport();
  const seo = findTerm(report, "seo");

  assert.ok(seo, "the exact Latin query lemma SEO must not be dropped");
  assert.equal(seo.sites, 1, "the fixture intentionally gives SEO a low document frequency");
  assert.equal(seo.keywordHit, true);
});

test("a custom stop word removes every stem form and every n-gram containing that stem", { concurrency: false }, async () => {
  const { worker, report: initial } = await initialTextReport();
  assert.ok(initial.terms.some((row) => termForms(row).some((form) => /^продвижен/u.test(form))), "fixture must contain the promotion stem before filtering");
  assert.ok(initial.ngrams.some((row) => phraseForms(row).some((form) => /продвижен/u.test(form))), "fixture must contain a promotion phrase before filtering");

  const result = await postAnalysis(worker, {
    queries: ["курсы seo"],
    snapshot: initial.snapshot,
    stopWords: "продвижение",
  });

  assert.equal(result.response.status, 200, result.data.error || "stop-word recalculation failed");
  assert.ok(result.data.terms.every((row) => termForms(row).every((form) => !/^продвижен/u.test(form))));
  assert.ok(result.data.ngrams.every((row) => phraseForms(row).every((form) => !/продвижен/u.test(form))));
  assert.ok(findTermPrefix(result.data, "аналитик"), "an unrelated lemma must remain in the report");
});

test("a stop phrase removes exact and containing n-grams without removing its component lemmas", { concurrency: false }, async () => {
  const { worker, report: initial } = await initialTextReport();
  assert.ok(containsPhrase(initial, "онлайн курс"), "fixture must contain the target phrase before filtering");

  const result = await postAnalysis(worker, {
    queries: ["курсы seo"],
    snapshot: initial.snapshot,
    stopPhrases: ["онлайн курс"],
  });

  assert.equal(result.response.status, 200, result.data.error || "stop-phrase recalculation failed");
  assert.equal(containsPhrase(result.data, "онлайн курс"), false, "exact and longer n-grams containing the stopped phrase must be absent");
  assert.ok(findTerm(result.data, "онлайн"), "a phrase stop must not turn its component words into stop words");
  assert.ok(result.data.terms.some((row) => termForms(row).some((form) => /^курс/u.test(form))), "the course lemma must remain independently available");
  assert.ok(findTermPrefix(result.data, "аналитик"), "an unrelated lemma must remain in the report");
});

test("snapshot recalculation performs zero fetches and applies different stop sets independently", { concurrency: false }, async () => {
  const { worker, report: initial } = await initialTextReport();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("snapshot recalculation attempted a network request");
  };

  try {
    const wordStopped = await postAnalysis(worker, {
      queries: ["курсы seo"],
      snapshot: initial.snapshot,
      stopWords: ["продвижение"],
    });
    const phraseStopped = await postAnalysis(worker, {
      queries: ["курсы seo"],
      snapshot: initial.snapshot,
      stopPhrases: "онлайн курс",
    });

    assert.equal(wordStopped.response.status, 200, wordStopped.data.error || "word-stop recalc failed");
    assert.equal(phraseStopped.response.status, 200, phraseStopped.data.error || "phrase-stop recalc failed");
    assert.equal(fetchCalls, 0);
    assert.equal(wordStopped.data.meta.snapshotId, initial.meta.snapshotId);
    assert.equal(phraseStopped.data.meta.snapshotId, initial.meta.snapshotId);
    assert.equal(wordStopped.data.snapshot.version, 5);
    assert.ok(findTerm(wordStopped.data, "онлайн"));
    assert.equal(containsPhrase(wordStopped.data, "онлайн курс"), true);
    assert.ok(phraseStopped.data.terms.some((row) => termForms(row).some((form) => /^продвижен/u.test(form))));
    assert.equal(containsPhrase(phraseStopped.data, "онлайн курс"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("lemma importance uses normalized TF-IDF, DF, stability, and exact-query factors without cosine", { concurrency: false }, async () => {
  const { report } = await initialTextReport();
  assert.ok(report.terms.length > 0);

  const rawImportance = (row) => row.competitorTfidf * row.df * (row.keywordHit ? 2 : 1) * (row.df >= 0.5 ? 1.15 : 1);
  const maximum = Math.max(0, ...report.terms.map(rawImportance));
  for (const row of report.terms) {
    const expected = Math.max(1, maximum > 0 ? rawImportance(row) / maximum * 100 : 0);
    assert.ok(Math.abs(row.importance - expected) <= 0.6, `${row.term}: expected ${expected}, received ${row.importance}`);
    assert.ok(row.medianCount >= 1, `${row.term}: emitted target must be at least one`);
    assert.ok(row.importance >= 1, `${row.term}: emitted importance must be at least one`);
    assert.equal(Object.hasOwn(row, "cosine"), false, `${row.term}: lemma analysis must not expose cosine`);
  }

  const seo = findTerm(report, "seo");
  assert.equal(seo?.keywordHit, true);
  assert.ok(seo.importance >= 1);
});

function zoneHtml(index, own = false) {
  const halfMarker = index <= 2 || own ? "halfmarker" : "";
  const rareMarker = index === 1 || own ? "raremarker" : "";
  const ownHalf = own ? "halfmarker" : "";
  return `<!doctype html>
    <html lang="ru">
      <head><title>titletoken Академия поисковой аналитики</title></head>
      <body><header>
        <h1>hfirsttoken ${halfMarker} ${ownHalf} ${rareMarker} обучение специалистов</h1>
        <nav>navleak служебная навигация</nav>
      </header><main>
        <h2>headingtoken программа технического аудита</h2>
        <h6>Дополнительные материалы и исследования</h6>
        <p>paragraphmarker ${COMMON_TEXT} ${COMMON_TEXT}</p>
        <a href="/guide">anchormarker руководство для студентов</a>
      </main></body>
    </html>`;
}

function requestUrl(input) {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

function assertExclusiveZone(row, expectedZone) {
  assert.ok(row, `${expectedZone} marker is missing from the lemma report`);
  assert.equal(row.zones.all.available, true);
  assert.ok(row.zones.all.sites > 0);
  for (const zone of ["title", "h1", "headings", "text", "anchors"]) {
    assert.equal(row.zones[zone].available, true, `${zone} should be available for fetched HTML`);
    if (zone === expectedZone) {
      assert.ok(row.zones[zone].sites > 0, `${row.term} is missing from ${zone}`);
    } else {
      assert.equal(row.zones[zone].sites, 0, `${row.term} leaked from ${expectedZone} into ${zone}`);
      assert.equal(row.zones[zone].ownCount, 0, `${row.term} leaked into our ${zone} count`);
    }
  }
}

test("HTML zone markers stay in title, h1, h2-h6, paragraph text, and anchors without leakage", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = requestUrl(input);
    const own = url.hostname === "ours.example.com";
    const match = url.hostname.match(/^competitor-(\d+)\./);
    const index = own ? 5 : Number(match?.[1] ?? 1);
    return new Response(zoneHtml(index, own), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };

  try {
    const worker = await loadWorker();
    const competitors = Array.from({ length: 4 }, (_, index) => ({
      name: `Зональный конкурент ${index + 1}`,
      position: index + 1,
      url: `https://competitor-${index + 1}.example.com/course`,
    }));
    const result = await postAnalysis(worker, {
      queries: ["курсы seo raremarker"],
      serpQuery: "курсы seo",
      language: "ru",
      competitors,
      ownPage: { name: "Наша зональная страница", url: "https://ours.example.com/course" },
      search: { engine: "google", region: "ru", device: "desktop", found: competitors.length },
    });

    assert.equal(result.response.status, 200, result.data.error || "zonal analysis failed");
    assertExclusiveZone(findTerm(result.data, "titletoken"), "title");
    assertExclusiveZone(findTerm(result.data, "hfirsttoken"), "h1");
    assertExclusiveZone(findTerm(result.data, "headingtoken"), "headings");
    assertExclusiveZone(findTerm(result.data, "paragraphmarker"), "text");
    assertExclusiveZone(findTerm(result.data, "anchormarker"), "anchors");
    assert.equal(findTerm(result.data, "navleak"), undefined, "navigation inside header must stay excluded");

    const headingPhrase = result.data.ngrams.find((row) => phraseForms(row).some((form) => form.includes("headingtoken программа")));
    assert.ok(headingPhrase, "heading phrase must be present in the N-gram report");
    assert.equal(headingPhrase.zones.headings.sites, 4);
    for (const zone of ["title", "h1", "text", "anchors"]) {
      assert.equal(headingPhrase.zones[zone].sites, 0, `heading phrase leaked into ${zone}`);
    }

    const half = findTerm(result.data, "halfmarker");
    assert.ok(half);
    assert.equal(half.zones.h1.sites, 2);
    assert.equal(half.zones.h1.medianCount, 1, "ceil(median([1, 1, 0, 0])) must be 1");
    assert.equal(half.zones.h1.ownCount, 2);
    assert.ok(Number.isInteger(half.zones.h1.ownCount));
    assert.ok(Number.isInteger(half.zones.h1.medianCount));

    const rare = findTerm(result.data, "raremarker");
    assert.ok(rare, "a low-DF query marker must remain available");
    assert.equal(rare.zones.h1.sites, 1);
    assert.equal(rare.zones.h1.medianCount, 1, "a positive emitted zone signal must expose an actionable integer target");
    assert.ok(rare.zones.h1.importance >= 1);

    const competitorProfiles = result.data.comparisonProfiles.filter((profile) => !profile.ours);
    assert.equal(competitorProfiles.length, 4);
    const firstProfileMarker = competitorProfiles[0].lemmas.find((row) => row.key === half.key);
    const lastProfileMarker = competitorProfiles[3].lemmas.find((row) => row.key === half.key);
    assert.equal(firstProfileMarker?.zones.h1.count, 1);
    assert.equal(lastProfileMarker?.zones.h1.count, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pasted plain text exposes all/text zones but marks structural HTML zones unavailable", { concurrency: false }, async () => {
  const { report } = await initialTextReport();
  const analytics = findTermPrefix(report, "аналитик");
  assert.ok(analytics);
  assert.equal(analytics.zones.all.available, true);
  assert.equal(analytics.zones.text.available, true);
  for (const zone of ["title", "h1", "headings", "anchors"]) {
    assert.equal(analytics.zones[zone].available, false, `${zone} must not be fabricated for pasted text`);
  }
});
