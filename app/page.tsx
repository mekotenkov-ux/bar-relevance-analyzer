"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { cloudWords, documents, lemmas, navItems, ngrams, oursCloud, wordCounts } from "./data";

function DownloadButton({ label, rows }: { label: string; rows: Record<string, unknown>[] }) {
  const download = () => {
    const keys = Object.keys(rows[0] || {});
    const csv = [keys.join(";"), ...rows.map((row) => keys.map((key) => String(row[key] ?? "")).join(";"))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = label.toLowerCase().replaceAll(" ", "-") + ".csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  return <button className="button button-ghost" onClick={download}><span>↓</span> Скачать CSV</button>;
}

function SectionHeader({ eyebrow, title, note, rows }: { eyebrow: string; title: string; note: string; rows?: Record<string, unknown>[] }) {
  return (
    <div className="section-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{note}</p>
      </div>
      {rows && <DownloadButton label={title} rows={rows} />}
    </div>
  );
}

export default function Home() {
  const [active, setActive] = useState("overview");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("Все");
  const [sort, setSort] = useState<"importance" | "documentShare">("importance");
  const [menuOpen, setMenuOpen] = useState(false);

  const filteredLemmas = useMemo(() => {
    return lemmas
      .filter((row) => row.lemma.includes(query.toLowerCase()))
      .filter((row) => filter === "Все" || (filter === "Дефицит" ? row.status === "Добавить" : row.status === "Снизить"))
      .sort((a, b) => b[sort] - a[sort]);
  }, [query, filter, sort]);

  const goTo = (id: string) => {
    setActive(id);
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className="app-shell">
      <aside className={"sidebar " + (menuOpen ? "is-open" : "")}>
        <div className="brand-lockup">
          <Image src="/seomeat-logo.svg" alt="SEO Meat" width={152} height={16} priority />
          <span><b>БАР</b> — бесплатный анализ релевантности</span>
        </div>
        <div className="project-card">
          <span className="project-label">Проект</span>
          <strong>Курсы английского</strong>
          <span className="project-url">my-site.ru/english-course</span>
        </div>
        <nav aria-label="Разделы отчёта">
          {navItems.map(([id, label, number]) => (
            <button key={id} onClick={() => goTo(id)} className={active === id ? "active" : ""}>
              <span>{number}</span>{label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="pulse"><i /> Анализ завершён</div>
          <a href="https://seomeat.ru/" target="_blank" rel="noreferrer">Сделано в школе SEO Мясо ↗</a>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="menu-button" aria-label="Открыть меню" onClick={() => setMenuOpen(!menuOpen)}>☰</button>
          <div className="query-lockup">
            <span>Поисковый запрос</span>
            <strong>курсы английского языка</strong>
          </div>
          <div className="topbar-actions">
            <span className="updated">Обновлено сегодня, 14:32</span>
            <button className="button button-dark" onClick={() => window.print()}>Экспорт отчёта</button>
          </div>
        </header>

        <div className="content">
          <section id="overview" className="hero-section report-section">
            <div className="hero-copy">
              <span className="eyebrow">Семантический анализ · Google · Москва</span>
              <h1>Отчёт по метрикам страницы</h1>
              <p>Сравнили вашу страницу с 13 конкурентами из выдачи и нашли точки роста без механического переспама.</p>
            </div>
            <div className="metric-note-card">
              <div className="metric-count"><span>3</span><small>метрики</small></div>
              <div><b>Без единого балла</b><span>Каждый показатель можно проверить отдельно</span></div>
            </div>
          </section>

          <section className="metrics-summary" aria-label="Ключевые показатели">
            <div className="metrics-grid">
              <article><span>TF-IDF ключей</span><strong>68%</strong><em>сырой вес 2,04</em></article>
              <article><span>Взвешенный охват</span><strong>64%</strong><em>важные термины и фразы</em></article>
              <article><span>Взвешенная плотность</span><strong>58%</strong><em>выполнение ориентиров по вхождениям</em></article>
            </div>
            <article className="volume-metric-card"><span>Объём текста</span><strong>1 126</strong><em>слов · нужно ≈ 1 650</em></article>
          </section>

          <section className="priority-card">
            <div className="priority-marker">!</div>
            <div><span className="eyebrow">Главный вывод</span><h3>Добавьте тематическую глубину, а не просто ключи</h3><p>Странице не хватает блоков про разговорную практику, формат занятий и квалификацию преподавателей. Они дадут больше эффекта, чем повтор слова «курс».</p></div>
            <button className="button button-accent" onClick={() => goTo("lemmas")}>Смотреть рекомендации</button>
          </section>

          <section id="lemmas" className="report-section card-section">
            <SectionHeader eyebrow="01 · Лексика" title="Таблица лемм" note="Слова приведены к начальной форме. Важность рассчитывается на основе TF-IDF и других сигналов релевантности." rows={lemmas as unknown as Record<string, unknown>[]} />
            <div className="table-toolbar">
              <div className="segmented">
                {["Все", "Дефицит", "Избыток"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}
              </div>
              <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти лемму" /></label>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Лемма</th><th>Сайтов</th><th>У нас</th><th>Медиана</th><th><button onClick={() => setSort("documentShare")}>Доля документов ↕</button></th><th><button onClick={() => setSort("importance")}>Важность ↕</button></th><th>Рекомендация</th></tr></thead>
                <tbody>{filteredLemmas.map((row) => <tr key={row.lemma}><td><b>{row.lemma}</b></td><td>{row.competitors} / 13</td><td>{row.ours}</td><td>{row.median}</td><td><div className="document-share-cell"><span><i style={{ width: row.documentShare + "%" }} /></span>{row.documentShare}%</div></td><td><strong>{row.importance.toFixed(1)}</strong></td><td><span className={"status status-" + row.status.toLowerCase()}>{row.status}</span></td></tr>)}</tbody>
              </table>
            </div>
            <div className="table-caption">Показано {filteredLemmas.length} из {lemmas.length} лемм</div>
          </section>

          <section id="clouds" className="report-section card-section">
            <SectionHeader eyebrow="02 · Тематический профиль" title="Конкуренты vs наша страница" note="Размер слова отражает нормализованную значимость. Сравнение помогает увидеть темы, которые выдача считает обязательными." />
            <div className="cloud-grid">
              <article className="cloud-card"><div className="mini-head"><div><span>Среднее по конкурентам</span><strong>13 страниц</strong></div><span className="legend-dot competitors">TF‑IDF</span></div><div className="word-cloud competitors-cloud">{cloudWords.map(([word, size], index) => <span key={word} style={{ fontSize: size + "px", opacity: 1 - index * .025 }}>{word}</span>)}</div></article>
              <article className="cloud-card ours"><div className="mini-head"><div><span>Наша страница</span><strong>my-site.ru</strong></div><span className="legend-dot ours-dot">TF‑IDF</span></div><div className="word-cloud ours-cloud">{oursCloud.map(([word, size], index) => <span key={word} style={{ fontSize: size + "px", opacity: 1 - index * .025 }}>{word}</span>)}</div></article>
            </div>
            <div className="comparison-chart">
              <div className="chart-head"><div><h3>Разрыв по ключевым темам</h3><p>Нормализованная значимость, 0–100</p></div><div className="chart-legend"><span><i className="comp-color" /> Конкуренты</span><span><i className="ours-color" /> Наша страница</span></div></div>
              <div className="bar-chart">{lemmas.slice(0, 8).map((row) => {
                const comp = Math.min(100, row.median * 8);
                const ours = Math.min(100, row.ours * 8);
                return <div className="bar-row" key={row.lemma}><b>{row.lemma}</b><div className="bar-track"><i className="comp-bar" style={{ width: comp + "%" }} /><i className="ours-bar" style={{ width: ours + "%" }} /></div><span>{ours} / {comp}</span></div>;
              })}</div>
            </div>
          </section>

          <section id="ngrams" className="report-section card-section">
            <SectionHeader eyebrow="03 · Словосочетания" title="N‑граммы" note="Устойчивые фразы из двух и трёх слов, которые регулярно встречаются в документах поисковой выдачи." rows={ngrams as unknown as Record<string, unknown>[]} />
            <div className="ngram-layout">
              <div className="table-wrap"><table><thead><tr><th>N‑грамма</th><th>Сайтов</th><th>Медиана</th><th>У нас</th><th>Важность</th><th>Действие</th></tr></thead><tbody>{ngrams.map((row) => <tr key={row.phrase}><td><b>{row.phrase}</b></td><td>{row.sites} / 13</td><td>{row.median}</td><td>{row.ours}</td><td><strong>{row.importance}</strong></td><td><span className={row.status === "Норма" ? "status status-норма" : row.status.startsWith("Снизить") ? "status status-снизить" : "status status-добавить"}>{row.status}</span></td></tr>)}</tbody></table></div>
              <aside className="insight-panel"><span className="eyebrow">Быстрая победа</span><strong>«разговорный английский»</strong><p>Фраза есть у 9 из 13 конкурентов и полностью отсутствует на вашей странице.</p><div><span>Дефицит</span><b>3</b><small>рекомендуемых вхождения</small></div></aside>
            </div>
          </section>

          <section id="documents" className="report-section card-section">
            <SectionHeader eyebrow="04 · Выдача" title="Сравнение документов по метрикам" note="Документы отсортированы по TF-IDF входных ключей. Взвешенная плотность показывает выполнение ориентиров по вхождениям важных лемм и фраз." rows={documents as unknown as Record<string, unknown>[]} />
            <div className="documents-list">{documents.map((doc, index) => <article key={doc.domain} className={doc.ours ? "our-document" : ""}><span className="rank">{String(index + 1).padStart(2, "0")}</span><div className="doc-main"><div><strong>{doc.domain}</strong>{doc.ours && <em>Наша страница</em>}</div><span>{doc.url}</span></div><div className="doc-position"><span>Позиция</span><b>{doc.position || "—"}</b></div><div className="document-metrics"><div><span>TF-IDF ключей</span><b>{doc.keyTfidfScore}%</b><small>вес {doc.keyTfidfRaw.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</small></div><div><span>Взвешенный охват</span><b>{doc.weightedCoverage}%</b><small>важных тем</small></div><div><span>Взвешенная плотность</span><b>{doc.weightedDensity}%</b><small>выполнение ориентиров</small></div><div><span>Слов</span><b>{doc.words.toLocaleString("ru-RU")}</b><small>видимый текст</small></div></div></article>)}</div>
          </section>

          <section id="volume" className="report-section card-section">
            <SectionHeader eyebrow="05 · Объём" title="Количество слов" note="Считаем видимый содержательный текст без меню, футера и повторяющихся служебных блоков." rows={wordCounts as unknown as Record<string, unknown>[]} />
            <div className="volume-summary">
              <div><span>Медиана конкурентов</span><strong>1 834</strong><small>слова</small></div>
              <div className="volume-gap"><span>Наша страница</span><strong>1 126</strong><small>−708 слов</small></div>
              <div><span>Рекомендуемый диапазон</span><strong>1 550–1 950</strong><small>без искусственного раздувания</small></div>
            </div>
            <div className="table-wrap"><table><thead><tr><th>Документ</th><th>Всего слов</th><th>Полезный текст</th><th>Заголовки</th><th>Предложения</th><th>От медианы</th></tr></thead><tbody>{wordCounts.map((row) => <tr key={row.domain} className={row.ours ? "highlight-row" : ""}><td><b>{row.domain}</b>{row.ours && <small className="inline-label">наш</small>}</td><td>{row.words.toLocaleString("ru-RU")}</td><td>{row.useful.toLocaleString("ru-RU")}</td><td>{row.headings}</td><td>{row.sentences}</td><td><span className={row.words < 1500 ? "negative" : "positive"}>{row.words - 1834 > 0 ? "+" : ""}{(row.words - 1834).toLocaleString("ru-RU")}</span></td></tr>)}</tbody></table></div>
          </section>

          <footer className="report-footer"><div><Image src="/seomeat-logo.svg" alt="SEO Meat" width={152} height={16} /><span>БАР · бесплатный анализ релевантности</span></div><a href="https://seomeat.ru/" target="_blank" rel="noreferrer">Сделано в школе SEO Мясо ↗</a></footer>
        </div>
      </section>
    </main>
  );
}
