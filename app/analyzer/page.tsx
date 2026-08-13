"use client";

import { FormEvent, useMemo, useState } from "react";
import styles from "./analyzer.module.css";

type InputMode = "url" | "text";
type PageDraft = { id: string; name: string; mode: InputMode; url: string; text: string };
type LemmaRow = { lemma: string; sites: number; ownCount: number; median: number; average: number; coverage: number; idf: number; competitorTfidf: number; ownTfidf: number; score: number; status: "Добавить" | "Норма" | "Снизить" };
type NgramRow = { phrase: string; sites: number; ownCount: number; median: number; average: number; idf: number; score: number; status: "Добавить" | "Норма" | "Снизить" };
type CloudWord = { word: string; weight: number };
type DocumentRow = { name: string; url: string; title: string; words: number; uniqueWords: number; headings: number; sentences: number; coverage: number; relevance: number; ours: boolean };
type AnalysisResult = {
  meta: { query: string; analyzedAt: string; competitorsRequested: number; competitorsAnalyzed: number };
  summary: { overallScore: number; similarity: number; semanticCoverage: number; ngramCoverage: number; ownWords: number; medianWords: number; recommendedMin: number; recommendedMax: number; recommendation: string };
  lemmas: LemmaRow[]; ngrams: NgramRow[]; clouds: { competitors: CloudWord[]; own: CloudWord[] };
  chart: Array<{ lemma: string; competitors: number; own: number }>;
  documents: DocumentRow[]; warnings: Array<{ name: string; error: string }>;
};

const sampleOwn = `Онлайн-курсы английского языка для взрослых. Учитесь из дома по гибкому расписанию. На уроках преподаватель объясняет грамматику, помогает расширить словарный запас и исправляет ошибки. Программа подходит начинающим и продолжающим студентам. После регистрации доступен пробный урок. Занятия проходят на интерактивной платформе, домашние задания проверяются автоматически. Можно выбрать индивидуальный формат обучения и удобное время. Школа помогает определить уровень языка и составить персональную программу курса. Студенты получают материалы для самостоятельной работы и поддержку преподавателя в чате.`;
const sampleCompetitors = [
  `Курсы английского языка онлайн для взрослых и детей. Разговорная практика на каждом занятии, индивидуальные уроки с преподавателем и занятия в мини-группах. Пройдите бесплатный тест уровня и запишитесь на пробный урок. Программа обучения включает грамматику, произношение, аудирование, словарный запас и подготовку к экзаменам. Преподаватели имеют международные сертификаты и опыт работы. Уроки проходят на удобной интерактивной платформе. Можно изучать деловой английский, английский для путешествий или готовиться к собеседованию. Персональный план учитывает цели, уровень и график студента.`,
  `Онлайн-школа английского предлагает курсы для начинающих и продолжающих. Индивидуальные занятия помогают быстро развить разговорный английский и уверенно общаться. На первом бесплатном уроке методист определит уровень знаний и подберет программу. В курс входят живые уроки с преподавателем, домашние задания, тренажеры слов и регулярный контроль прогресса. Доступны программы общего английского, деловой язык, подготовка к IELTS и занятия для детей. Все учебные материалы доступны онлайн с телефона и компьютера.`,
  `Изучайте английский язык онлайн с профессиональными преподавателями. Курсы построены вокруг разговорной практики и реальных жизненных ситуаций. Студент выбирает индивидуальные уроки или обучение в группе, удобное расписание и интенсивность. Бесплатное вводное занятие включает тестирование уровня и консультацию методиста. Учебная программа развивает грамматику, лексику, произношение, понимание речи и навыки письма. Школа готовит к международным экзаменам, путешествиям, работе и переезду. Прогресс отслеживается в личном кабинете.`,
];

function blankDraft(name: string): PageDraft {
  return { id: crypto.randomUUID(), name, mode: "url", url: "", text: "" };
}

function PageEditor({ draft, onChange, own = false }: { draft: PageDraft; onChange: (draft: PageDraft) => void; own?: boolean }) {
  return <div className={styles.pageEditor}>
    <div className={styles.modeSwitch} aria-label="Способ добавления страницы">
      <button type="button" className={draft.mode === "url" ? styles.activeMode : ""} onClick={() => onChange({ ...draft, mode: "url" })}>По URL</button>
      <button type="button" className={draft.mode === "text" ? styles.activeMode : ""} onClick={() => onChange({ ...draft, mode: "text" })}>Вставить текст</button>
    </div>
    {draft.mode === "url" ? <label className={styles.field}>
      <span>{own ? "URL вашей страницы" : "URL конкурента"}</span>
      <input className={styles.input} type="url" value={draft.url} onChange={(event) => onChange({ ...draft, url: event.target.value })} placeholder="https://example.ru/page" />
      <small className={styles.hint}>Сервис сам загрузит HTML и извлечёт содержательный текст.</small>
    </label> : <label className={styles.field}>
      <span>{own ? "Текст вашей страницы" : "Текст страницы конкурента"}</span>
      <textarea className={styles.textarea} value={draft.text} onChange={(event) => onChange({ ...draft, text: event.target.value })} placeholder="Вставьте основной текст страницы…" maxLength={200000} />
      <small className={styles.hint}>{draft.text.length.toLocaleString("ru-RU")} / 200 000 символов</small>
    </label>}
  </div>;
}

function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [keys.map(escape).join(";"), ...rows.map((row) => keys.map((key) => escape(row[key])).join(";"))].join("\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}

function Status({ value }: { value: LemmaRow["status"] }) {
  const className = value === "Добавить" ? styles.add : value === "Снизить" ? styles.reduce : styles.normal;
  return <span className={`${styles.status} ${className}`}>{value}</span>;
}

function Cloud({ words, own = false }: { words: CloudWord[]; own?: boolean }) {
  const values = words.map((item) => item.weight); const min = Math.min(...values, 0); const max = Math.max(...values, 1);
  return <div className={`${styles.cloud} ${own ? styles.cloudOwn : ""}`}>{words.slice(0, 32).map((item, index) => {
    const size = 13 + ((item.weight - min) / Math.max(.001, max - min)) * 27;
    return <span key={item.word} style={{ fontSize: `${size}px`, opacity: 1 - index * .012 }}>{item.word}</span>;
  })}</div>;
}

export default function AnalyzerPage() {
  const [query, setQuery] = useState("");
  const [ownPage, setOwnPage] = useState<PageDraft>(blankDraft("Наша страница"));
  const [competitors, setCompetitors] = useState<PageDraft[]>([blankDraft("Конкурент 1"), blankDraft("Конкурент 2")]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const [lemmaFilter, setLemmaFilter] = useState("Все"); const [lemmaSearch, setLemmaSearch] = useState("");

  const preparedCompetitors = competitors.filter((item) => item.mode === "url" ? item.url.trim() : item.text.trim());
  const canAnalyze = (ownPage.mode === "url" ? ownPage.url.trim() : ownPage.text.trim()) && preparedCompetitors.length > 0;
  const visibleLemmas = useMemo(() => (result?.lemmas ?? []).filter((row) => row.lemma.includes(lemmaSearch.toLowerCase()))
    .filter((row) => lemmaFilter === "Все" || row.status === lemmaFilter), [result, lemmaFilter, lemmaSearch]);

  const updateCompetitor = (id: string, next: PageDraft) => setCompetitors((items) => items.map((item) => item.id === id ? next : item));
  const loadExample = () => {
    setQuery("курсы английского языка");
    setOwnPage({ ...blankDraft("Наша страница"), mode: "text", text: sampleOwn });
    setCompetitors(sampleCompetitors.map((text, index) => ({ ...blankDraft(`Конкурент ${index + 1}`), mode: "text", text })));
    setResult(null); setError("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!canAnalyze || loading) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/analyze-run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        query,
        ownPage: { name: ownPage.name, url: ownPage.mode === "url" ? ownPage.url : "", text: ownPage.mode === "text" ? ownPage.text : "" },
        competitors: preparedCompetitors.map((item) => ({ name: item.name, url: item.mode === "url" ? item.url : "", text: item.mode === "text" ? item.text : "" })),
      }) });
      const data = await response.json() as AnalysisResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось выполнить анализ");
      setResult(data); requestAnimationFrame(() => document.getElementById("report")?.scrollIntoView({ behavior: "smooth" }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось выполнить анализ"); }
    finally { setLoading(false); }
  };

  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.brand}><img src="/seomeat-logo.svg" alt="SEO Meat" /><span>Copykiller <b>Semantic analyzer</b></span></div>
      <div className={styles.headerRight}><span className={styles.live}>Сервис работает</span><span>URL или готовый текст</span></div>
    </header>
    <div className={styles.shell}>
      {!result && <>
        <section className={styles.hero}>
          <div><span className={styles.eyebrow}>Рабочий семантический анализатор</span><h1>Сравните страницу с конкурентами</h1><p>Добавьте свои данные — URL страниц или готовые тексты. Сервис загрузит контент, нормализует лексику и построит отчёт по реальным входным данным.</p></div>
          <aside className={styles.heroAside}><strong>В одном отчёте</strong><ul><li>Леммы и TF‑IDF</li><li>Облака и сравнительный график</li><li>Биграммы и триграммы</li><li>Релевантность документов</li><li>Объём текста</li></ul></aside>
        </section>
        <form className={styles.form} onSubmit={submit}>
          <section className={styles.card}>
            <div className={styles.cardHead}><div><span className={styles.step}>00 · Контекст</span><h2>Параметры анализа</h2><p>Запрос нужен для подписи отчёта; расчёт выполняется по содержимому страниц.</p></div><button className={styles.ghostButton} type="button" onClick={loadExample}>Заполнить пример</button></div>
            <div className={styles.queryGrid}><label className={styles.field}><span>Поисковый запрос</span><input className={styles.input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Например: курсы английского языка" /></label><label className={styles.field}><span>Регион / поисковая система</span><input className={styles.input} value="Ручное сравнение конкурентов" disabled /></label></div>
          </section>
          <section className={styles.card}>
            <div className={styles.cardHead}><div><span className={styles.step}>01 · Своя страница</span><h2>Что анализируем</h2><p>Выберите URL для автоматической загрузки или вставьте текст вручную.</p></div></div>
            <PageEditor draft={ownPage} onChange={setOwnPage} own />
          </section>
          <section className={styles.card}>
            <div className={styles.cardHead}><div><span className={styles.step}>02 · Конкуренты</span><h2>С чем сравниваем</h2><p>Добавьте от 1 до 10 страниц. Чем больше качественных конкурентов, тем устойчивее медианы.</p></div><span className={styles.hint}>{preparedCompetitors.length} / 10 добавлено</span></div>
            <div className={styles.competitorList}>{competitors.map((item, index) => <article className={styles.competitor} key={item.id}>
              <div className={styles.competitorTop}><span className={styles.number}>{String(index + 1).padStart(2, "0")}</span><input className={styles.nameInput} value={item.name} onChange={(event) => updateCompetitor(item.id, { ...item, name: event.target.value })} aria-label={`Название конкурента ${index + 1}`} />
                <div className={styles.modeSwitch}><button type="button" className={item.mode === "url" ? styles.activeMode : ""} onClick={() => updateCompetitor(item.id, { ...item, mode: "url" })}>URL</button><button type="button" className={item.mode === "text" ? styles.activeMode : ""} onClick={() => updateCompetitor(item.id, { ...item, mode: "text" })}>Текст</button></div>
                <button type="button" className={styles.remove} aria-label="Удалить конкурента" onClick={() => setCompetitors((items) => items.filter((row) => row.id !== item.id))}>×</button></div>
              <div className={styles.competitorBody}>{item.mode === "url" ? <input className={styles.input} type="url" value={item.url} onChange={(event) => updateCompetitor(item.id, { ...item, url: event.target.value })} placeholder="https://competitor.ru/page" /> : <textarea className={styles.textarea} value={item.text} onChange={(event) => updateCompetitor(item.id, { ...item, text: event.target.value })} placeholder="Вставьте текст страницы конкурента…" maxLength={200000} />}</div>
            </article>)}</div>
            {competitors.length < 10 && <button className={styles.addButton} type="button" onClick={() => setCompetitors((items) => [...items, blankDraft(`Конкурент ${items.length + 1}`)])}>＋ Добавить конкурента</button>}
          </section>
          {error && <div className={styles.error}>{error}</div>}
          {loading ? <div className={styles.loading}><span className={styles.spinner} /><div><strong>Анализируем страницы</strong><span>Загружаем контент, считаем леммы, N‑граммы и релевантность документов…</span></div></div> : <div className={styles.actions}><div className={styles.actionLeft}><span>Данные не сохраняются в базе</span><span>·</span><span>до 10 конкурентов</span></div><button className={styles.primary} type="submit" disabled={!canAnalyze}>Запустить анализ →</button></div>}
        </form>
      </>}

      {result && <section id="report">
        <div className={styles.resultTop}><div><span className={styles.eyebrow}>Готовый отчёт · {result.meta.competitorsAnalyzed} конкурентов</span><h1>{result.meta.query || "Семантический анализ страницы"}</h1><p>Рассчитано {new Date(result.meta.analyzedAt).toLocaleString("ru-RU")}</p></div><div className={styles.resultActions}><button className={styles.ghostButton} onClick={() => setResult(null)}>← Изменить данные</button><button className={styles.exportButton} onClick={() => window.print()}>Экспорт PDF</button></div></div>
        {result.warnings.map((warning) => <div className={styles.warning} key={warning.name}><b>{warning.name}:</b> {warning.error}. Страница исключена из расчёта.</div>)}
        <div className={styles.scoreGrid}>
          <div className={styles.scoreMain}><div className={styles.scoreCircle}>{result.summary.overallScore}</div><div><b>Итоговая релевантность</b><span>из 100 возможных</span></div></div>
          <div className={styles.metric}><span>Близость к ТОПу</span><strong>{result.summary.similarity}%</strong></div>
          <div className={styles.metric}><span>Охват лемм</span><strong>{result.summary.semanticCoverage}%</strong></div>
          <div className={styles.metric}><span>Охват N‑грамм</span><strong>{result.summary.ngramCoverage}%</strong></div>
          <div className={styles.metric}><span>Слов у нас / медиана</span><strong>{result.summary.ownWords.toLocaleString("ru-RU")} / {result.summary.medianWords.toLocaleString("ru-RU")}</strong></div>
        </div>
        <div className={styles.recommendation}><b>Главный вывод:</b> {result.summary.recommendation} Рекомендуемый объём: {result.summary.recommendedMin.toLocaleString("ru-RU")}–{result.summary.recommendedMax.toLocaleString("ru-RU")} слов.</div>

        <section className={styles.reportSection}>
          <div className={styles.sectionHead}><div><span className={styles.step}>01 · Лексика</span><h2>Таблица лемм</h2><p>Частотность, медиана конкурентов, TF‑IDF и рекомендуемое действие.</p></div><div className={styles.tools}><div className={styles.filters}>{["Все", "Добавить", "Норма", "Снизить"].map((item) => <button key={item} className={lemmaFilter === item ? styles.activeFilter : ""} onClick={() => setLemmaFilter(item)}>{item}</button>)}</div><input className={styles.search} value={lemmaSearch} onChange={(event) => setLemmaSearch(event.target.value)} placeholder="Найти лемму" /><button className={styles.exportButton} onClick={() => downloadCsv("lemmas.csv", visibleLemmas as unknown as Record<string, unknown>[])}>CSV</button></div></div>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Лемма</th><th>Сайтов</th><th>У нас</th><th>Медиана</th><th>TF‑IDF ТОП</th><th>TF‑IDF у нас</th><th>IDF</th><th>Приоритет</th><th>Действие</th></tr></thead><tbody>{visibleLemmas.map((row) => <tr key={row.lemma}><td><b>{row.lemma}</b></td><td>{row.sites} / {result.meta.competitorsAnalyzed}</td><td>{row.ownCount}</td><td>{row.median}</td><td>{row.competitorTfidf}</td><td>{row.ownTfidf}</td><td>{row.idf}</td><td><b>{row.score}</b></td><td><Status value={row.status} /></td></tr>)}</tbody></table></div>
        </section>

        <section className={styles.reportSection}>
          <div className={styles.sectionHead}><div><span className={styles.step}>02 · Тематический профиль</span><h2>Конкуренты vs наша страница</h2><p>Размер слова соответствует нормализованному TF‑IDF.</p></div></div>
          <div className={styles.cloudGrid}><div><span className={styles.eyebrow}>Среднее конкурентов</span><Cloud words={result.clouds.competitors} /></div><div><span className={styles.eyebrow}>Наша страница</span><Cloud words={result.clouds.own} own /></div></div>
          <div className={styles.chart}>{result.chart.map((row) => { const max = Math.max(1, row.competitors, row.own); return <div className={styles.chartRow} key={row.lemma}><b>{row.lemma}</b><div className={styles.chartBars}><i className={styles.competitorBar} style={{ width: `${row.competitors / max * 100}%` }} /><i className={styles.ownBar} style={{ width: `${row.own / max * 100}%` }} /></div><span>{row.own} / {row.competitors}</span></div>; })}</div>
        </section>

        <section className={styles.reportSection}>
          <div className={styles.sectionHead}><div><span className={styles.step}>03 · Словосочетания</span><h2>N‑граммы</h2><p>Лемматизированные биграммы и триграммы, общие для страниц конкурентов.</p></div><button className={styles.exportButton} onClick={() => downloadCsv("ngrams.csv", result.ngrams as unknown as Record<string, unknown>[])}>Скачать CSV</button></div>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>N‑грамма</th><th>Сайтов</th><th>У нас</th><th>Медиана</th><th>Среднее</th><th>IDF</th><th>Вес</th><th>Действие</th></tr></thead><tbody>{result.ngrams.slice(0, 80).map((row) => <tr key={row.phrase}><td><b>{row.phrase}</b></td><td>{row.sites} / {result.meta.competitorsAnalyzed}</td><td>{row.ownCount}</td><td>{row.median}</td><td>{row.average}</td><td>{row.idf}</td><td><b>{row.score}</b></td><td><Status value={row.status} /></td></tr>)}</tbody></table></div>
        </section>

        <section className={styles.reportSection}>
          <div className={styles.sectionHead}><div><span className={styles.step}>04 · Документы</span><h2>ТОП релевантных документов</h2><p>Косинусная близость к усреднённому тематическому вектору конкурентов.</p></div></div>
          <div className={styles.documents}>{result.documents.map((document, index) => <article className={`${styles.document} ${document.ours ? styles.ownDocument : ""}`} key={`${document.name}-${index}`}><span className={styles.rank}>{String(index + 1).padStart(2, "0")}</span><div className={styles.documentName}><strong>{document.name}{document.ours ? " · наша страница" : ""}</strong><span>{document.url || document.title || "вставленный текст"}</span></div><div className={styles.docMetric}><span>Релевантность</span><b>{document.relevance}%</b></div><div className={styles.docMetric}><span>Покрытие</span><b>{document.coverage}%</b></div><div className={styles.docMetric}><span>Слов</span><b>{document.words.toLocaleString("ru-RU")}</b></div></article>)}</div>
        </section>

        <section className={styles.reportSection}>
          <div className={styles.sectionHead}><div><span className={styles.step}>05 · Объём</span><h2>Количество слов</h2><p>Сравнение объёма, уникальной лексики, заголовков и предложений.</p></div></div>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Документ</th><th>Всего слов</th><th>Уникальных лемм</th><th>Заголовков</th><th>Предложений</th><th>От медианы</th></tr></thead><tbody>{result.documents.map((document) => <tr key={document.name}><td><b>{document.name}{document.ours ? " · наш" : ""}</b></td><td>{document.words.toLocaleString("ru-RU")}</td><td>{document.uniqueWords.toLocaleString("ru-RU")}</td><td>{document.headings}</td><td>{document.sentences}</td><td>{(document.words - result.summary.medianWords).toLocaleString("ru-RU")}</td></tr>)}</tbody></table></div>
        </section>
        <footer className={styles.footer}><img src="/seomeat-logo.svg" alt="SEO Meat" /><span>Copykiller Semantic · анализ по пользовательским данным</span><a href="https://seomeat.ru/" target="_blank" rel="noreferrer">Сделано в школе SEO Мясо ↗</a></footer>
      </section>}
    </div>
  </main>;
}
