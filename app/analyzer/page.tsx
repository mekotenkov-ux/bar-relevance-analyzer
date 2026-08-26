"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  DEFAULT_STOP_PHRASES,
  DEFAULT_STOP_PHRASES_TEXT,
  DEFAULT_STOP_WORDS,
  DEFAULT_STOP_WORDS_TEXT,
  OPTIONAL_WEB_STOP_PHRASES,
  OPTIONAL_WEB_STOP_WORDS,
} from "@/lib/default-stop-terms";
import { CLOUD_LAYOUT_HEIGHT, CLOUD_LAYOUT_WIDTH, packCloudWords } from "@/lib/cloud-layout";
import styles from "./analyzer.module.css";

type InputMode = "url" | "text";
type SearchEngine = "google" | "yandex";
type Device = "desktop" | "tablet" | "mobile";
type StatusValue = "Добавить" | "Норма" | "Снизить";
type ZoneKey = "all" | "title" | "h1" | "text" | "headings" | "anchors";
type PageDraft = { name: string; mode: InputMode; url: string; text: string };
type ZoneMetrics = {
  available: boolean;
  sites: number;
  ownCount: number;
  medianCount: number;
  q25Count: number;
  q75Count: number;
  importance: number;
  status: StatusValue;
};

type SemanticRow = {
  key: string;
  forms: string[];
  sites: number;
  df?: number;
  ownCount: number;
  ownFrequency?: number;
  medianCount: number;
  medianFrequency?: number;
  q25: number;
  q75: number;
  idf?: number;
  competitorTfidf?: number;
  tfidfNormalized?: number;
  importance: number;
  priority?: number;
  bestKeyword?: string;
  keywordHit?: boolean;
  status: StatusValue;
  zones?: Partial<Record<ZoneKey, ZoneMetrics>>;
};
type TermRow = SemanticRow & { term: string; averageFrequency?: number; ownTfidf?: number };
type NgramRow = SemanticRow & {
  phrase: string;
  df: number;
  ownFrequency: number;
  medianFrequency: number;
  keySimilarity: number;
  priority: number;
  bestKeyword: string;
};
type CloudWord = { key: string; word: string; count: number; weight: number; frequency: number; sites: number };
type ProfileLemma = {
  key: string;
  lemma: string;
  count: number;
  frequency?: number;
  zones?: Partial<Record<ZoneKey, { available: boolean; count: number; frequency?: number }>>;
};
type ComparisonProfile = {
  id: string;
  name: string;
  url: string;
  position?: number;
  cloud: CloudWord[];
  cloudZones: Record<ZoneKey, CloudWord[]>;
  lemmas: ProfileLemma[];
  lemmaZones?: Partial<Record<ZoneKey, ProfileLemma[]>>;
  zoneLemmas?: Partial<Record<ZoneKey, ProfileLemma[]>>;
  zones?: Partial<Record<ZoneKey, { lemmas?: ProfileLemma[] }>>;
};
type DocumentRow = {
  name: string;
  url: string;
  position?: number;
  title: string;
  words: number;
  contentWords: number;
  uniqueTerms: number;
  headings: number;
  sentences: number;
  truncated: boolean;
  keyTfidfScore: number;
  keyTfidfRaw: number;
  weightedCoverage: number;
  weightedDensity: number;
  ours: boolean;
};
type TripletCandidate = {
  id: string;
  key: string;
  label: string;
  forms: string[];
  importance: number;
  sites: number;
};
type TripletDocument = { id: string; name: string; url: string; ours: boolean };
type TripletExample = { sentenceId: string; text: string; documentId: string; documentName: string; ours: boolean };
type TripletEdge = {
  id: string;
  sourceId: string;
  sourceLabel: string;
  predicate: string;
  targetId: string;
  targetLabel: string;
  negated: boolean;
  occurrences: number;
  documentCount: number;
  documents: TripletDocument[];
  examples: TripletExample[];
};
type TripletAnalysisResult = {
  status: "disabled" | "unavailable" | "empty" | "ready";
  enabled: boolean;
  threshold: number;
  candidates: TripletCandidate[];
  edges: TripletEdge[];
  meta?: {
    candidateCount?: number;
    totalCandidateCount?: number;
    processedCandidateCount?: number;
    evidenceSentenceCount?: number;
    processedSentenceCount?: number;
    uniqueSentenceCount?: number;
    totalSentenceCount?: number;
    corpusSentenceCount?: number;
    documentCount?: number;
    inputTokens?: number;
    truncated?: boolean;
    maxCandidates?: number;
    maxSentences?: number;
    maxInputTokens?: number;
    minSupport?: number;
    min_support?: number;
    relationCount?: number;
    relationLimit?: number;
  };
  model?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  message?: string;
};
type AnalysisResult = {
  meta: {
    query: string;
    queries: string[];
    serpQuery: string;
    analyzedAt: string;
    competitorsFound: number;
    competitorsRequested: number;
    competitorsAnalyzed: number;
    engine?: SearchEngine;
    region?: string;
    device?: Device;
    language: string;
    languageLabel: string;
    confidence: "high" | "medium" | "low";
    snapshotId: string;
    stopWords?: string[];
    stopPhrases?: string[];
  };
  summary: {
    keyTfidfScore: number;
    keyTfidfRaw: number;
    weightedCoverage: number;
    weightedDensity: number;
    ownWords: number;
    medianWords: number;
    recommendedMin: number;
    recommendedMax: number;
    recommendation: string;
  };
  terms: TermRow[];
  lemmas: TermRow[];
  termZones?: Partial<Record<ZoneKey, TermRow[]>>;
  lemmaZones?: Partial<Record<ZoneKey, TermRow[]>>;
  zones?: Partial<Record<ZoneKey, { terms?: TermRow[]; lemmas?: TermRow[] }>>;
  ngrams: NgramRow[];
  clouds: {
    competitors: CloudWord[];
    own: CloudWord[];
    zones: Record<ZoneKey, { competitors: CloudWord[]; own: CloudWord[] }>;
  };
  comparisonProfiles?: ComparisonProfile[];
  chart: Array<{ term: string; competitors: number; own: number; q25: number; q75: number }>;
  documents: DocumentRow[];
  warnings: Array<{ name: string; position?: number; error: string }>;
  snapshot: unknown;
  methodology: Record<string, string | number>;
  filters?: { stopWords?: string[]; stopPhrases?: string[] };
  triplets?: TripletAnalysisResult;
};
type SearchResponse = {
  competitors: Array<{ position: number; name: string; title: string; url: string; snippet: string }>;
  credentialSource: "server" | "browser";
  error?: string;
};
type TripletResponse = { triplets?: TripletAnalysisResult; error?: string };

const XMLRIVER_STORAGE_KEY = "bar:xmlriver:credentials:v1";
const REPORT_STORAGE_KEY = "bar:last-report:v10";
const LEGACY_REPORT_STORAGE_KEY = "bar:last-report:v9";
const TERM_PAGE_SIZE = 20;
const NGRAM_PAGE_SIZE = 15;
const CHART_PAGE_SIZE = 12;
const TRIPLET_EDGE_PAGE_SIZE = 30;
const EMPTY_TRIPLET_CANDIDATES: TripletCandidate[] = [];
const EMPTY_TRIPLET_EDGES: TripletEdge[] = [];
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

function mergeStopTerms(...groups: ReadonlyArray<readonly string[]>) {
  const seen = new Set<string>();
  return groups.flatMap((group) => group.filter((item) => {
    const key = item.normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

const WEB_STOP_WORDS = mergeStopTerms(DEFAULT_STOP_WORDS, OPTIONAL_WEB_STOP_WORDS);
const WEB_STOP_PHRASES = mergeStopTerms(DEFAULT_STOP_PHRASES, OPTIONAL_WEB_STOP_PHRASES);
const WEB_STOP_WORDS_TEXT = WEB_STOP_WORDS.join("\n");
const WEB_STOP_PHRASES_TEXT = WEB_STOP_PHRASES.join("\n");

const ZONES: Array<{ key: ZoneKey; label: string; hint: string }> = [
  { key: "all", label: "Общее", hint: "Весь видимый документ" },
  { key: "title", label: "Title", hint: "Заголовок документа" },
  { key: "h1", label: "H1", hint: "Главный заголовок" },
  { key: "text", label: "Text", hint: "Основной текст" },
  { key: "headings", label: "H2–H6", hint: "Подзаголовки" },
  { key: "anchors", label: "A", hint: "Тексты ссылок" },
];

const CLOUD_ZONES: Array<{ key: ZoneKey; label: string; hint: string }> = [
  { key: "all", label: "Все", hint: "Весь видимый документ" },
  { key: "title", label: "Title", hint: "Заголовок документа" },
  { key: "h1", label: "H1", hint: "Главный заголовок" },
  { key: "headings", label: "H2–H6", hint: "Подзаголовки" },
  { key: "text", label: "Text", hint: "Основной текст" },
  { key: "anchors", label: "<a>", hint: "Тексты ссылок" },
];

type StoredReport = {
  version: 10;
  report: AnalysisResult;
  stopWords: string;
  stopPhrases: string;
  tripletsEnabled?: boolean;
};

const LANGUAGES = [
  ["ar", "العربية"], ["hy", "Հայերեն"], ["eu", "Euskara"], ["bg", "Български"],
  ["ca", "Català"], ["zh", "中文"], ["hr", "Hrvatski"], ["cs", "Čeština"],
  ["da", "Dansk"], ["nl", "Nederlands"], ["en", "English"], ["et", "Eesti"],
  ["fi", "Suomi"], ["fr", "Français"], ["de", "Deutsch"], ["el", "Ελληνικά"],
  ["he", "עברית"], ["hi", "हिन्दी"], ["hu", "Magyar"], ["id", "Bahasa Indonesia"],
  ["ga", "Gaeilge"], ["it", "Italiano"], ["ja", "日本語"], ["ko", "한국어"],
  ["lv", "Latviešu"], ["lt", "Lietuvių"], ["no", "Norsk"], ["fa", "فارسی"],
  ["pl", "Polski"], ["pt", "Português"], ["ro", "Română"], ["ru", "Русский"],
  ["sr", "Српски"], ["sk", "Slovenčina"], ["sl", "Slovenščina"], ["es", "Español"],
  ["sw", "Kiswahili"], ["sv", "Svenska"], ["ta", "தமிழ்"], ["th", "ไทย"],
  ["tr", "Türkçe"], ["uk", "Українська"], ["ur", "اردو"], ["vi", "Tiếng Việt"],
] as const;

function percent(value: number) { return `${number.format(value)}%`; }
function frequency(value: number) { return number.format(value); }
function hostLabel(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, ""); }
  catch { return value || "—"; }
}
function parseKeys(value: string, fallback: string) {
  const source = value.trim() || fallback.trim();
  const seen = new Set<string>();
  return source.split(/[\n,;]+/u).map((item) => item.trim()).filter((item) => {
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}
function parseStops(value: string) {
  const seen = new Set<string>();
  return value.split(/[\n,;]+/u).map((item) => item.trim()).filter((item) => {
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function saveReport(report: AnalysisResult, stopWords: string, stopPhrases: string, tripletsEnabled = false) {
  const stored: StoredReport = { version: 10, report, stopWords, stopPhrases, tripletsEnabled };
  try { sessionStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(stored)); }
  catch { /* A large corpus can exceed the browser session quota; the live report remains usable. */ }
}
function countUp(value: number | undefined) {
  return Math.ceil(Math.max(0, Number.isFinite(value) ? Number(value) : 0));
}
function largestCount(...values: unknown[]) {
  return values.reduce<number>((largest, value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(largest, Math.trunc(numeric)) : largest;
  }, 0);
}
function isCurrentSnapshot(value: unknown) {
  return Boolean(value && typeof value === "object" && Number((value as { version?: unknown }).version) === 5);
}
function pluralRu(value: number, one: string, few: string, many: string) {
  const count = Math.abs(Math.trunc(value));
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}
function termsForZone(result: AnalysisResult | null, zone: ZoneKey) {
  if (!result) return [];
  const baseRows = Array.isArray(result.terms) ? result.terms : Array.isArray(result.lemmas) ? result.lemmas : [];
  if (baseRows.some((row) => row.zones?.[zone])) {
    return baseRows.flatMap((row) => {
      const metrics = row.zones?.[zone];
      const hasEvidence = Boolean(metrics && (metrics.sites > 0 || metrics.ownCount > 0));
      if (!metrics?.available || (!hasEvidence && !(zone === "all" && row.keywordHit))) return [];
      return [{
        ...row,
        sites: metrics.sites,
        ownCount: metrics.ownCount,
        medianCount: metrics.medianCount,
        q25: metrics.q25Count,
        q75: metrics.q75Count,
        importance: metrics.importance,
        status: metrics.status,
      }];
    }).sort((left, right) => right.importance - left.importance || right.sites - left.sites || left.term.localeCompare(right.term));
  }
  if (zone === "all") return baseRows;
  const direct = result.termZones?.[zone] ?? result.lemmaZones?.[zone];
  if (Array.isArray(direct)) return direct;
  const nested = result.zones?.[zone];
  return Array.isArray(nested?.terms) ? nested.terms : Array.isArray(nested?.lemmas) ? nested.lemmas : [];
}
function ngramsForZone(result: AnalysisResult | null, zone: ZoneKey) {
  if (!result || !Array.isArray(result.ngrams)) return [];
  if (result.ngrams.some((row) => row.zones?.[zone])) {
    return result.ngrams.flatMap((row) => {
      const metrics = row.zones?.[zone];
      if (!metrics?.available || (metrics.sites <= 0 && metrics.ownCount <= 0 && !(zone === "all" && row.keywordHit))) return [];
      return [{
        ...row,
        sites: metrics.sites,
        ownCount: metrics.ownCount,
        medianCount: metrics.medianCount,
        q25: metrics.q25Count,
        q75: metrics.q75Count,
        importance: metrics.importance,
        status: metrics.status,
      }];
    }).sort((left, right) => right.importance - left.importance || (right.priority ?? 0) - (left.priority ?? 0) || left.phrase.localeCompare(right.phrase));
  }
  return zone === "all" ? result.ngrams : [];
}

function profileLemmaCount(profile: ComparisonProfile | undefined, row: TermRow, zone: ZoneKey) {
  const baseItems = Array.isArray(profile?.lemmas) ? profile.lemmas : [];
  const baseMatch = baseItems.find((item) => item.key === row.key) ?? baseItems.find((item) => item.lemma === row.term);
  if (zone === "all") return countUp(baseMatch?.count);
  const zoneMetric = baseMatch?.zones?.[zone];
  if (zoneMetric) return zoneMetric.available ? countUp(zoneMetric.count) : 0;
  const zoneItems = profile?.lemmaZones?.[zone] ?? profile?.zoneLemmas?.[zone] ?? profile?.zones?.[zone]?.lemmas;
  const items = Array.isArray(zoneItems) ? zoneItems : [];
  const match = items.find((item) => item.key === row.key) ?? items.find((item) => item.lemma === row.term);
  return countUp(match?.count);
}

function PageEditor({ draft, onChange }: { draft: PageDraft; onChange: (draft: PageDraft) => void }) {
  return <div className={styles.pageEditor}>
    <div className={styles.modeSwitch} aria-label="Способ добавления своей страницы">
      <button type="button" className={draft.mode === "url" ? styles.activeMode : ""} onClick={() => onChange({ ...draft, mode: "url" })}>По URL</button>
      <button type="button" className={draft.mode === "text" ? styles.activeMode : ""} onClick={() => onChange({ ...draft, mode: "text" })}>Вставить текст</button>
    </div>
    {draft.mode === "url" ? <label className={styles.field}>
      <span>URL вашей страницы</span>
      <input className={styles.input} type="url" required value={draft.url} onChange={(event) => onChange({ ...draft, url: event.target.value })} placeholder="https://example.com/page" />
      <small>Домен будет исключён из поисковой выдачи.</small>
    </label> : <label className={styles.field}>
      <span>Текст вашей страницы</span>
      <textarea className={styles.textarea} required value={draft.text} onChange={(event) => onChange({ ...draft, text: event.target.value })} placeholder="Вставьте основной текст страницы…" maxLength={200000} />
      <small>{integer.format(draft.text.length)} / 200 000 символов</small>
    </label>}
  </div>;
}

function StopFields({
  stopWords,
  stopPhrases,
  setStopWords,
  setStopPhrases,
  compact = false,
}: {
  stopWords: string;
  stopPhrases: string;
  setStopWords: (value: string) => void;
  setStopPhrases: (value: string) => void;
  compact?: boolean;
}) {
  const applyDefaultStops = () => {
    setStopWords(DEFAULT_STOP_WORDS_TEXT);
    setStopPhrases(DEFAULT_STOP_PHRASES_TEXT);
  };
  const applyWebStops = () => {
    setStopWords(WEB_STOP_WORDS_TEXT);
    setStopPhrases(WEB_STOP_PHRASES_TEXT);
  };
  const clearStops = () => {
    setStopWords("");
    setStopPhrases("");
  };

  return <div className={`${styles.stopGrid} ${compact ? styles.stopGridCompact : ""}`}>
    <div className={styles.stopPresetBar}>
      <div className={styles.stopPresetCopy}>
        <strong>Безопасный редактируемый стоп-лист</strong>
        <span>Базовый набор содержит только служебную лексику. «Веб-шум» дополнительно включает CTA и юридические шаблоны — применяйте его осознанно, если они не относятся к теме страницы.</span>
      </div>
      <div className={styles.stopPresetActions} role="group" aria-label="Управление стоп-листом">
        <button type="button" onClick={applyDefaultStops} aria-label="Восстановить безопасный базовый набор стоп-термов">Базовый <span>{DEFAULT_STOP_WORDS.length + DEFAULT_STOP_PHRASES.length}</span></button>
        <button type="button" onClick={applyWebStops} aria-label="Добавить к базовому набору CTA и юридический веб-шум">+ Веб-шум <span>+{OPTIONAL_WEB_STOP_WORDS.length + OPTIONAL_WEB_STOP_PHRASES.length}</span></button>
        <button type="button" onClick={clearStops}>Очистить</button>
      </div>
    </div>
    <label className={styles.field}>
      <span>Стоп-слова</span>
      <textarea className={`${styles.textarea} ${styles.stopTextarea}`} value={stopWords} onChange={(event) => setStopWords(event.target.value)} placeholder={'например\nсайт\nкомпания'} />
      <small>По одному с новой строки или через запятую. Исключается указанное слово и все его лемматизированные формы; фразы с ним тоже не попадут в отчёт.</small>
    </label>
    <label className={styles.field}>
      <span>Стоп-фразы</span>
      <textarea className={`${styles.textarea} ${styles.stopTextarea}`} value={stopPhrases} onChange={(event) => setStopPhrases(event.target.value)} placeholder={'политика конфиденциальности\nоставить заявку'} />
      <small>По одной фразе с новой строки или через запятую. Совпавшие лемматизированные фразы исключаются из анализа.</small>
    </label>
  </div>;
}

function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [keys.map(escape).join(";"), ...rows.map((row) => keys.map((key) => escape(row[key])).join(";"))].join("\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function Status({ value }: { value: StatusValue }) {
  const className = value === "Добавить" ? styles.add : value === "Снизить" ? styles.reduce : styles.normal;
  return <span className={`${styles.status} ${className}`}><span aria-hidden="true">{value === "Добавить" ? "+" : value === "Снизить" ? "−" : "✓"}</span>{value}</span>;
}
function Pagination({ page, pages, total, setPage }: { page: number; pages: number; total: number; setPage: (page: number) => void }) {
  if (!total) return <div className={styles.pagination}><span>Ничего не найдено</span></div>;
  return <div className={styles.pagination}>
    <span>{integer.format(total)} строк · страница {page} из {pages}</span>
    <div><button type="button" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Предыдущая страница">←</button><button type="button" onClick={() => setPage(Math.min(pages, page + 1))} disabled={page >= pages} aria-label="Следующая страница">→</button></div>
  </div>;
}
function Cloud({ title, note, words, maxFrequency, own = false }: { title: string; note: string; words: CloudWord[]; maxFrequency: number; own?: boolean }) {
  const arranged = useMemo(() => packCloudWords(words, maxFrequency), [words, maxFrequency]);
  return <article className={`${styles.cloudCard} ${own ? styles.cloudOwn : ""}`}>
    <header><div><h3>{title}</h3><p>{note}</p></div><span>/ 1 000 слов</span></header>
    <div className={styles.cloud} aria-label={`Облако слов: ${title}`}>{arranged.map((packed, index) => {
      const item = packed.item;
      const details = `${item.word}: ${frequency(item.frequency)} на 1 000 слов${item.sites > 0 ? ` · ${integer.format(item.sites)} документов` : ""}`;
      return <span key={`${item.key}-${item.word}`} className={index === 0 ? styles.cloudCenter : ""} style={{ left: `${packed.left / CLOUD_LAYOUT_WIDTH * 100}%`, top: `${packed.top / CLOUD_LAYOUT_HEIGHT * 100}%`, fontSize: `${packed.fontSize}px`, zIndex: arranged.length - index }} title={details} aria-label={details}><b>{item.word}</b></span>;
    })}{!arranged.length && <p className={styles.empty}>Недостаточно данных</p>}</div>
  </article>;
}
function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <div className={styles.metric}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function FilterButtons({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className={styles.filters} aria-label="Фильтр по действию">{["Все", "Добавить", "Норма", "Снизить"].map((item) => <button key={item} type="button" className={value === item ? styles.activeFilter : ""} onClick={() => onChange(item)}>{item}</button>)}</div>;
}

export default function AnalyzerPage() {
  const [serpQuery, setSerpQuery] = useState("");
  const [analysisKeys, setAnalysisKeys] = useState("");
  const [language, setLanguage] = useState("auto");
  const [engine, setEngine] = useState<SearchEngine>("yandex");
  const [region, setRegion] = useState("213");
  const [device, setDevice] = useState<Device>("desktop");
  const [competitorCount, setCompetitorCount] = useState(10);
  const [useFirecrawl, setUseFirecrawl] = useState(true);
  const [stopWords, setStopWords] = useState(DEFAULT_STOP_WORDS_TEXT);
  const [stopPhrases, setStopPhrases] = useState(DEFAULT_STOP_PHRASES_TEXT);
  const [ownPage, setOwnPage] = useState<PageDraft>({ name: "Наша страница", mode: "url", url: "", text: "" });
  const [serverConfigured, setServerConfigured] = useState<boolean | null>(null);
  const [firecrawlConfigured, setFirecrawlConfigured] = useState<boolean | null>(null);
  const [xmlUser, setXmlUser] = useState("");
  const [xmlKey, setXmlKey] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("Ищем конкурентов в выдаче XMLRiver…");
  const [error, setError] = useState("");
  const [termFilter, setTermFilter] = useState("Все");
  const [termSearch, setTermSearch] = useState("");
  const [termPage, setTermPage] = useState(1);
  const [ngramFilter, setNgramFilter] = useState("Добавить");
  const [ngramSearch, setNgramSearch] = useState("");
  const [ngramPage, setNgramPage] = useState(1);
  const [ngramZone, setNgramZone] = useState<ZoneKey>("all");
  const [activeZone, setActiveZone] = useState<ZoneKey>("all");
  const [chartLimit, setChartLimit] = useState(CHART_PAGE_SIZE);
  const [selectedCompetitorId, setSelectedCompetitorId] = useState("");
  const [cloudZone, setCloudZone] = useState<ZoneKey>("all");
  const [tripletsEnabled, setTripletsEnabled] = useState(false);
  const [tripletPhase, setTripletPhase] = useState<"idle" | "selecting" | "extracting">("idle");
  const [tripletError, setTripletError] = useState("");
  const [tripletSeed, setTripletSeed] = useState("all");
  const [tripletEdgeLimit, setTripletEdgeLimit] = useState(TRIPLET_EDGE_PAGE_SIZE);
  const xmlCredentialsLoaded = useRef(false);

  useEffect(() => {
    queueMicrotask(() => {
      // Purge credentials saved by older releases. XMLRiver access now lives
      // only for the lifetime of this browser tab.
      try { localStorage.removeItem(XMLRIVER_STORAGE_KEY); } catch { /* Storage can be unavailable in hardened browsers. */ }
      try {
        const saved = JSON.parse(sessionStorage.getItem(XMLRIVER_STORAGE_KEY) || "{}") as { user?: string; key?: string };
        setXmlUser(typeof saved.user === "string" ? saved.user : "");
        setXmlKey(typeof saved.key === "string" ? saved.key : "");
      } catch { try { sessionStorage.removeItem(XMLRIVER_STORAGE_KEY); } catch { /* Keep credentials in memory only. */ } }
      finally { xmlCredentialsLoaded.current = true; }
      try {
        const rawStored = sessionStorage.getItem(REPORT_STORAGE_KEY);
        const stored = JSON.parse(rawStored || "null") as StoredReport | null;
        const report = stored?.version === 10 ? stored.report : null;
        sessionStorage.removeItem(LEGACY_REPORT_STORAGE_KEY);
        if (report?.meta?.serpQuery && (Array.isArray(report.terms) || Array.isArray(report.lemmas))) {
          setResult(report);
          setTripletsEnabled(Boolean(stored?.tripletsEnabled ?? report.triplets?.enabled));
          setSerpQuery(report.meta.serpQuery);
          setAnalysisKeys((report.meta.queries || []).join("\n") || report.meta.query);
          const restoredStopWords = report.meta.stopWords ?? report.filters?.stopWords;
          const restoredStopPhrases = report.meta.stopPhrases ?? report.filters?.stopPhrases;
          setStopWords(typeof stored?.stopWords === "string" ? stored.stopWords : Array.isArray(restoredStopWords) ? restoredStopWords.join("\n") : "");
          setStopPhrases(typeof stored?.stopPhrases === "string" ? stored.stopPhrases : Array.isArray(restoredStopPhrases) ? restoredStopPhrases.join("\n") : "");
          setEngine(report.meta.engine || "yandex"); setRegion(report.meta.region || ""); setDevice(report.meta.device || "desktop");
        }
      } catch { sessionStorage.removeItem(REPORT_STORAGE_KEY); sessionStorage.removeItem(LEGACY_REPORT_STORAGE_KEY); }
    });
    fetch("/api/search-competitors").then((response) => response.json()).then((data: { serverConfigured?: boolean; firecrawlConfigured?: boolean }) => {
      setServerConfigured(Boolean(data.serverConfigured));
      setFirecrawlConfigured(Boolean(data.firecrawlConfigured));
      if (!data.firecrawlConfigured) setUseFirecrawl(false);
    }).catch(() => { setServerConfigured(false); setFirecrawlConfigured(false); setUseFirecrawl(false); });
  }, []);
  useEffect(() => {
    if (!xmlCredentialsLoaded.current) return;
    try {
      if (xmlUser.trim() && xmlKey.trim()) {
        sessionStorage.setItem(XMLRIVER_STORAGE_KEY, JSON.stringify({ user: xmlUser, key: xmlKey }));
      } else {
        sessionStorage.removeItem(XMLRIVER_STORAGE_KEY);
      }
    } catch { /* Keep credentials in React state when browser storage is unavailable. */ }
  }, [xmlUser, xmlKey]);

  const comparisonProfiles = Array.isArray(result?.comparisonProfiles)
    ? result.comparisonProfiles.filter((profile) => profile && profile.id && Array.isArray(profile.lemmas) && Array.isArray(profile.cloud))
    : [];

  const ownReady = ownPage.mode === "url" ? ownPage.url.trim() : ownPage.text.trim();
  const credentialsReady = serverConfigured === true || Boolean(xmlUser.trim() && xmlKey.trim());
  const canAnalyze = Boolean(serpQuery.trim() && ownReady && credentialsReady && !loading);
  const currentKeys = parseKeys(analysisKeys, result?.meta.serpQuery || serpQuery);
  const snapshotIsCurrent = isCurrentSnapshot(result?.snapshot);
  const zoneTerms = useMemo(() => termsForZone(result, activeZone), [result, activeZone]);
  const zoneNgrams = useMemo(() => ngramsForZone(result, ngramZone), [result, ngramZone]);

  const visibleTerms = useMemo(() => zoneTerms.filter((row) => `${row.term} ${row.forms.join(" ")}`.toLowerCase().includes(termSearch.toLowerCase())).filter((row) => termFilter === "Все" || row.status === termFilter), [zoneTerms, termFilter, termSearch]);
  const termPages = Math.max(1, Math.ceil(visibleTerms.length / TERM_PAGE_SIZE));
  const safeTermPage = Math.min(termPage, termPages);
  const pagedTerms = visibleTerms.slice((safeTermPage - 1) * TERM_PAGE_SIZE, safeTermPage * TERM_PAGE_SIZE);
  const visibleNgrams = useMemo(() => zoneNgrams.filter((row) => `${row.phrase} ${row.forms.join(" ")} ${row.bestKeyword}`.toLowerCase().includes(ngramSearch.toLowerCase())).filter((row) => ngramFilter === "Все" || row.status === ngramFilter), [zoneNgrams, ngramFilter, ngramSearch]);
  const ngramPages = Math.max(1, Math.ceil(visibleNgrams.length / NGRAM_PAGE_SIZE));
  const safeNgramPage = Math.min(ngramPage, ngramPages);
  const pagedNgrams = visibleNgrams.slice((safeNgramPage - 1) * NGRAM_PAGE_SIZE, safeNgramPage * NGRAM_PAGE_SIZE);

  const selectZone = (zone: ZoneKey) => {
    setActiveZone(zone);
    setTermFilter("Все");
    setTermPage(1);
    setChartLimit(CHART_PAGE_SIZE);
  };

  const buildTriplets = async (baseReport: AnalysisResult | null = result) => {
    if (!baseReport?.snapshot || tripletPhase !== "idle") return;
    if (!isCurrentSnapshot(baseReport.snapshot)) {
      setTripletError("Корпус создан старой версией. Обновите конкурентов перед построением связей.");
      return;
    }
    setTripletsEnabled(true);
    saveReport(baseReport, stopWords, stopPhrases, true);
    setTripletPhase("selecting");
    setTripletError("");
    setTripletSeed("all");
    setTripletEdgeLimit(TRIPLET_EDGE_PAGE_SIZE);
    const phaseTimer = window.setTimeout(() => setTripletPhase("extracting"), 450);
    try {
      const response = await fetch("/api/analyze-triplets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripletsEnabled: true,
          snapshot: baseReport.snapshot,
          queries: baseReport.meta.queries?.length ? baseReport.meta.queries : [baseReport.meta.query],
          stopWords: parseStops(stopWords),
          stopPhrases: parseStops(stopPhrases),
        }),
      });
      const data = await response.json() as TripletResponse;
      if (!response.ok) throw new Error(data.error || "Не удалось построить семантические связи");
      if (!data.triplets || !Array.isArray(data.triplets.candidates) || !Array.isArray(data.triplets.edges)) {
        throw new Error("Сервис связей вернул неполный результат");
      }
      const nextReport = { ...baseReport, triplets: data.triplets };
      setResult(nextReport);
      saveReport(nextReport, stopWords, stopPhrases, true);
    } catch (cause) {
      setTripletError(cause instanceof Error ? cause.message : "Не удалось построить семантические связи");
    } finally {
      window.clearTimeout(phaseTimer);
      setTripletPhase("idle");
    }
  };

  const updateTripletsEnabled = (enabled: boolean) => {
    setTripletsEnabled(enabled);
    if (result) saveReport(result, stopWords, stopPhrases, enabled);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canAnalyze) return;
    setActiveZone("all"); setTermFilter("Все"); setTermPage(1); setChartLimit(CHART_PAGE_SIZE); setNgramZone("all"); setNgramPage(1); setCloudZone("all");
    setLoading(true); setLoadingText("Ищем конкурентов в выдаче XMLRiver…"); setError(""); setResult(null);
    sessionStorage.removeItem(REPORT_STORAGE_KEY); sessionStorage.removeItem(LEGACY_REPORT_STORAGE_KEY);
    try {
      const searchResponse = await fetch("/api/search-competitors", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: serpQuery, language, engine, region, device, count: competitorCount, ownUrl: ownPage.mode === "url" ? ownPage.url : "", credentials: serverConfigured ? undefined : { user: xmlUser, key: xmlKey } }),
      });
      const searchData = await searchResponse.json() as SearchResponse;
      if (!searchResponse.ok) throw new Error(searchData.error || "Не удалось найти конкурентов");
      setLoadingText(`Найдено ${searchData.competitors.length} страниц. Загружаем и анализируем контент…`);
      const analyzeResponse = await fetch("/api/analyze-run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serpQuery, queries: parseKeys(analysisKeys, serpQuery), stopWords: parseStops(stopWords), stopPhrases: parseStops(stopPhrases), language, useFirecrawl,
          ownPage: { name: ownPage.name, url: ownPage.mode === "url" ? ownPage.url : "", text: ownPage.mode === "text" ? ownPage.text : "" },
          competitors: searchData.competitors.map((item) => ({ name: item.name, title: item.title, url: item.url, position: item.position })),
          search: { engine, region, device, found: searchData.competitors.length },
        }),
      });
      const data = await analyzeResponse.json() as AnalysisResult & { error?: string };
      if (!analyzeResponse.ok) throw new Error(data.error || "Не удалось выполнить анализ найденных страниц");
      setResult(data); setAnalysisKeys(data.meta.queries.join("\n")); saveReport(data, stopWords, stopPhrases, tripletsEnabled);
      requestAnimationFrame(() => document.getElementById("report")?.scrollIntoView({ behavior: "smooth" }));
      if (tripletsEnabled) void buildTriplets(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось выполнить анализ"); }
    finally { setLoading(false); }
  };

  const recalculate = async () => {
    if (!result?.snapshot || !isCurrentSnapshot(result.snapshot) || !currentKeys.length || loading) return;
    setLoading(true); setLoadingText("Пересчитываем метрики по новым ключам без повторной загрузки конкурентов…"); setError("");
    try {
      const response = await fetch("/api/analyze-run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: currentKeys, stopWords: parseStops(stopWords), stopPhrases: parseStops(stopPhrases), snapshot: result.snapshot }),
      });
      const data = await response.json() as AnalysisResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось пересчитать отчёт");
      setResult(data); setAnalysisKeys(data.meta.queries.join("\n")); saveReport(data, stopWords, stopPhrases, tripletsEnabled);
      setTripletError(""); setTripletSeed("all"); setTripletEdgeLimit(TRIPLET_EDGE_PAGE_SIZE);
      if (tripletsEnabled) void buildTriplets(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось пересчитать отчёт"); }
    finally { setLoading(false); }
  };

  const refreshCompetitors = () => {
    if (result) {
      setSerpQuery(result.meta.serpQuery);
      setAnalysisKeys(result.meta.queries.join("\n"));
      setLanguage(result.meta.language || "auto");
    }
    setActiveZone("all"); setTermFilter("Все"); setTermPage(1); setChartLimit(CHART_PAGE_SIZE); setNgramZone("all"); setNgramPage(1); setCloudZone("all");
    setResult(null); setError(""); setTripletError(""); setTripletPhase("idle"); sessionStorage.removeItem(REPORT_STORAGE_KEY); sessionStorage.removeItem(LEGACY_REPORT_STORAGE_KEY);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };

  const selectedProfile = comparisonProfiles.find((profile) => profile.id === selectedCompetitorId) ?? comparisonProfiles[0];
  const comparisonRows = visibleTerms.slice(0, chartLimit).map((row) => ({
    term: row.term,
    own: countUp(row.ownCount),
    median: countUp(row.medianCount),
    selected: profileLemmaCount(selectedProfile, row, activeZone),
  }));
  const comparisonMax = Math.max(1, ...comparisonRows.flatMap((item) => [item.own, item.median, item.selected]));
  const cloudZoneData = result?.clouds.zones?.[cloudZone] ?? (cloudZone === "all" ? result?.clouds : undefined);
  const aggregateCloud = cloudZoneData?.competitors ?? [];
  const ownCloud = cloudZoneData?.own ?? [];
  const selectedCloud = selectedProfile?.cloudZones?.[cloudZone] ?? (cloudZone === "all" ? selectedProfile?.cloud ?? [] : []);
  const activeCloudFrequencies = [...aggregateCloud, ...ownCloud, ...selectedCloud].map((item) => item.frequency);
  const cloudMax = Math.max(.0001, ...activeCloudFrequencies);
  const cloudZoneHint = CLOUD_ZONES.find((zone) => zone.key === cloudZone)?.hint ?? "Весь видимый документ";
  const wordMax = result ? Math.max(1, result.summary.recommendedMax, ...result.documents.map((item) => item.words)) : 1;
  const tripletData = result?.triplets;
  const tripletCandidates = Array.isArray(tripletData?.candidates) ? tripletData.candidates : EMPTY_TRIPLET_CANDIDATES;
  const tripletEdges = Array.isArray(tripletData?.edges) ? tripletData.edges : EMPTY_TRIPLET_EDGES;
  const tripletLanguage = result?.meta.language || "ru";
  const connectedTripletCandidates = useMemo(() => {
    const candidatesById = new Map(tripletCandidates.map((candidate) => [candidate.id, candidate]));
    const connected = new Map<string, TripletCandidate>();
    for (const edge of tripletEdges) {
      const add = (id: string, label: string) => {
        if (!id || connected.has(id)) return;
        connected.set(id, candidatesById.get(id) ?? { id, key: id, label, forms: [label], importance: 0, sites: 0 });
      };
      add(edge.sourceId, edge.sourceLabel);
      add(edge.targetId, edge.targetLabel);
    }
    return [...connected.values()].sort((left, right) => left.label.localeCompare(right.label, tripletLanguage));
  }, [tripletCandidates, tripletEdges, tripletLanguage]);
  const tripletCandidateCount = largestCount(tripletData?.meta?.totalCandidateCount, tripletData?.meta?.candidateCount, tripletCandidates.length);
  const tripletProcessedSentenceCount = largestCount(tripletData?.meta?.processedSentenceCount) || largestCount(tripletData?.meta?.evidenceSentenceCount);
  const tripletCorpusSentenceCount = largestCount(tripletData?.meta?.totalSentenceCount, tripletData?.meta?.corpusSentenceCount, tripletProcessedSentenceCount);
  const tripletRelationCount = largestCount(tripletData?.meta?.relationCount, tripletEdges.length);
  const tripletIncompleteCorpus = Boolean(tripletData?.meta?.truncated);
  const filteredTripletEdges = useMemo(() => tripletSeed === "all"
    ? tripletEdges
    : tripletEdges.filter((edge) => edge.sourceId === tripletSeed || edge.targetId === tripletSeed), [tripletEdges, tripletSeed]);
  const visibleTripletEdges = useMemo(() => filteredTripletEdges.slice(0, tripletEdgeLimit), [filteredTripletEdges, tripletEdgeLimit]);
  const tripletBusy = tripletPhase !== "idle";
  const tripletStatusLabel = tripletBusy
    ? tripletPhase === "selecting" ? "Отбираем предложения" : "Извлекаем связи"
    : tripletError ? "Ошибка"
      : tripletData?.status === "ready" ? "Готово"
        : tripletData?.status === "empty" ? "Связи не найдены"
          : tripletData?.status === "unavailable" ? "spaCy недоступен"
            : "Выключено";

  return <main className={styles.page}>
    <header className={styles.header}>
      <a className={styles.brand} href="https://seomeat.ru/" target="_blank" rel="noreferrer"><Image src="/seomeat-logo.svg" alt="SEO Meat" width={152} height={16} priority /><span><b>БАР</b><small>Бесплатный анализ релевантности</small></span></a>
      <nav className={styles.headerRight} aria-label="Ссылки проекта"><a href="https://seomeat.ru/" target="_blank" rel="noreferrer">Школа SEO Мясо ↗</a><a href="https://t.me/seokotenkov" target="_blank" rel="noreferrer">@seokotenkov ↗</a><span className={styles.live}><i />Сервис работает</span></nav>
    </header>

    <div className={styles.shell}>
      {!result && <>
        <section className={styles.intro}><span className={styles.eyebrow}>Мультиязычный семантический анализ</span><h1>Сравните страницу с реальными конкурентами из поиска</h1><p>Запрос выдачи определяет конкурентов. Ключи анализа и списки исключений можно менять после расчёта — повторно искать и загружать страницы не потребуется.</p></section>
        <form className={styles.form} onSubmit={submit}>
          <section className={styles.card}>
            <div className={styles.cardHead}><div><span className={styles.step}>01 · Корпус</span><h2>Запрос для поиска конкурентов</h2></div><span className={styles.subtle}>количество задаёте вы</span></div>
            <label className={styles.field}><span>Запрос поисковой выдачи</span><input className={styles.input} required value={serpQuery} onChange={(event) => setSerpQuery(event.target.value)} placeholder="Например: seo курсы" /><small>По нему XMLRiver найдёт состав конкурентов.</small></label>
            <label className={styles.field}><span>Ключи для анализа</span><textarea className={`${styles.textarea} ${styles.keysTextarea}`} value={analysisKeys} onChange={(event) => setAnalysisKeys(event.target.value)} placeholder={'seo курсы\nобучение seo, курсы продвижения'} maxLength={3200} /><small>До 20 фраз через запятую или с новой строки. Если оставить пустым, используется запрос выдачи.</small></label>
            <div className={styles.queryGrid}>
              <label className={styles.field}><span>Язык контента</span><select className={styles.input} value={language} onChange={(event) => setLanguage(event.target.value)}><option value="auto">Автоопределение</option>{LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label} · {code.toUpperCase()}</option>)}</select></label>
              <label className={styles.field}><span>Поисковая система</span><select className={styles.input} value={engine} onChange={(event) => { const next = event.target.value as SearchEngine; setEngine(next); setRegion(next === "yandex" ? "213" : ""); }}><option value="yandex">Яндекс</option><option value="google">Google</option></select></label>
              <label className={styles.field}><span>{engine === "yandex" ? "Регион Яндекса" : "Location ID Google"}</span><input className={styles.input} inputMode="numeric" value={region} onChange={(event) => setRegion(event.target.value.replace(/\D/g, ""))} placeholder={engine === "yandex" ? "213 — Москва" : "Необязательно"} /></label>
              <label className={styles.field}><span>Устройство</span><select className={styles.input} value={device} onChange={(event) => setDevice(event.target.value as Device)}><option value="desktop">Компьютер</option><option value="mobile">Телефон</option><option value="tablet">Планшет</option></select></label>
              <label className={styles.field}><span>Конкурентов</span><input className={styles.input} type="number" min={1} step={1} value={competitorCount} onChange={(event) => setCompetitorCount(Math.max(1, Math.trunc(Number(event.target.value) || 1)))} /></label>
            </div>
          </section>
          <section className={styles.card}>
            <div className={styles.cardHead}><div><span className={styles.step}>02 · Своя страница</span><h2>Что сравниваем</h2></div><span className={styles.subtle}>URL или готовый текст</span></div>
            <PageEditor draft={ownPage} onChange={setOwnPage} />
            <label className={`${styles.fetchOption} ${firecrawlConfigured === false ? styles.fetchOptionDisabled : ""}`}><input aria-label="Использовать Firecrawl для недоступных URL" type="checkbox" checked={useFirecrawl} disabled={firecrawlConfigured === false} onChange={(event) => setUseFirecrawl(event.target.checked)} /><span><b>Firecrawl для недоступных URL</b><small>{firecrawlConfigured === false ? "Ключ FIRECRAWL не найден в окружении сервера." : "Включается только после неудачной обычной загрузки или обнаружения заглушки."}</small></span></label>
            <label className={`${styles.fetchOption} ${styles.tripletOption} ${loading ? styles.fetchOptionDisabled : ""}`}><input aria-label="Построить семантические связи после основного анализа" type="checkbox" checked={tripletsEnabled} disabled={loading} onChange={(event) => updateTripletsEnabled(event.target.checked)} /><span><b>Семантические связи · spaCy · опционально</b><small>Сначала строится обычный отчёт. Затем локальный анализатор извлекает из всего сохранённого корпуса все леммы и N-граммы — биграммы и триграммы, определяет части речи и оставляет только связи, подтверждённые минимум двумя разными предложениями.</small></span></label>
          </section>
          <section className={`${styles.card} ${styles.stopCard}`}>
            <div className={styles.cardHead}><div><span className={styles.step}>03 · Исключения</span><h2>Стоп-слова и стоп-фразы</h2></div><span className={styles.subtle}>необязательно</span></div>
            <StopFields stopWords={stopWords} stopPhrases={stopPhrases} setStopWords={setStopWords} setStopPhrases={setStopPhrases} />
          </section>
          <details className={styles.credentials} open={serverConfigured === false}>
            <summary><span><b>Доступ XMLRiver</b><small>{serverConfigured === null ? "Проверяем…" : serverConfigured ? "Ключ подключён на сервере" : "Введите ключ — он хранится только до закрытия этой вкладки"}</small></span><i>{serverConfigured ? "Подключён" : "Настроить"}</i></summary>
            {!serverConfigured && <div className={styles.credentialsBody}><label className={styles.field}><span>ID пользователя</span><input className={styles.input} autoComplete="username" value={xmlUser} onChange={(event) => setXmlUser(event.target.value)} placeholder="user" /></label><label className={styles.field}><span>Ключ XMLRiver</span><input className={styles.input} type="password" autoComplete="current-password" value={xmlKey} onChange={(event) => setXmlKey(event.target.value)} placeholder="••••••••••••" /></label></div>}
          </details>
          {error && <div className={styles.error} role="alert">{error}</div>}
          {loading ? <div className={styles.loading} role="status"><span className={styles.spinner} /><div><strong>Выполняем анализ</strong><span>{loadingText}</span></div></div> : <div className={styles.actions}><p>Автоязык учитывает HTML lang и письменность текста. Недоступные страницы будут отмечены.</p><button className={styles.primary} type="submit" disabled={!canAnalyze}>Найти и проанализировать <span>→</span></button></div>}
        </form>
      </>}

      {result && <section id="report" className={styles.report}>
        <div className={styles.resultTop}>
          <div><span className={styles.eyebrow}>Семантический отчёт</span><h1>{result.meta.serpQuery}</h1><p>Корпус рассчитан {new Date(result.meta.analyzedAt).toLocaleString("ru-RU")}</p></div>
          <div className={styles.resultActions}><button className={styles.ghostButton} type="button" onClick={refreshCompetitors}>↻ Обновить конкурентов</button><button className={styles.exportButton} type="button" onClick={() => window.print()}>Экспорт PDF</button></div>
        </div>

        <section className={styles.keyEditor} aria-label="Ключи анализа">
          <div className={styles.keyEditorCopy}><span className={styles.step}>Настройки этого отчёта</span><h2>Пересчитать на том же корпусе</h2><p>Ключи, стоп-слова и стоп-фразы применятся к уже загруженным страницам. Поиск конкурентов и сетевые запросы повторно не запускаются.</p></div>
          <div className={styles.recalcInputs}>
            <label className={styles.field}><span>Ключевые фразы</span><textarea className={`${styles.textarea} ${styles.reportKeysTextarea}`} value={analysisKeys} onChange={(event) => setAnalysisKeys(event.target.value)} placeholder={result.meta.serpQuery} /><small>{currentKeys.length} из 20 ключей · запятая или новая строка</small></label>
            <StopFields compact stopWords={stopWords} stopPhrases={stopPhrases} setStopWords={setStopWords} setStopPhrases={setStopPhrases} />
            <label className={`${styles.fetchOption} ${styles.tripletOption} ${styles.tripletReportOption} ${loading || tripletBusy || !snapshotIsCurrent ? styles.fetchOptionDisabled : ""}`}><input aria-label="Пересчитывать семантические связи" type="checkbox" checked={tripletsEnabled} disabled={loading || tripletBusy || !snapshotIsCurrent} onChange={(event) => updateTripletsEnabled(event.target.checked)} /><span><b>Семантические связи после пересчёта</b><small>Используется сохранённый корпус: поиск и загрузка конкурентов повторно не запускаются. spaCy повторно размечает предложения только при включённой опции.</small></span></label>
          </div>
          <button className={styles.recalculateButton} type="button" onClick={recalculate} disabled={loading || tripletBusy || !snapshotIsCurrent || !currentKeys.length}>{loading ? "Пересчитываем…" : "Пересчитать отчёт"}</button>
        </section>

        {!snapshotIsCurrent && <div className={styles.legacySnapshot} role="alert"><div><strong>Сохранённый корпус нужно обновить</strong><p>Этот отчёт можно просматривать, но пересчёт и семантические связи требуют актуальный snapshot v5.</p></div><button type="button" onClick={refreshCompetitors}>Обновить конкурентов</button></div>}
        {loading && <div className={styles.loading} role="status"><span className={styles.spinner} /><div><strong>Обновляем отчёт</strong><span>{loadingText}</span></div></div>}
        {error && <div className={styles.error} role="alert">{error}</div>}

        <div className={styles.contextBar} aria-label="Параметры отчёта">
          <span>{result.meta.engine === "google" ? "Google" : "Яндекс"}</span>{result.meta.region && <span>Регион {result.meta.region}</span>}
          <span>{result.meta.device === "mobile" ? "Телефон" : result.meta.device === "tablet" ? "Планшет" : "Компьютер"}</span>
          <span>Язык: {result.meta.languageLabel} · {result.meta.language.toUpperCase()}</span><span>Ключей: {result.meta.queries.length}</span>
          {!!result.meta.stopWords?.length && <span>Стоп-слов: {integer.format(result.meta.stopWords.length)}</span>}{!!result.meta.stopPhrases?.length && <span>Стоп-фраз: {integer.format(result.meta.stopPhrases.length)}</span>}
          <span>Найдено {integer.format(result.meta.competitorsFound)}</span><span>В расчёте {integer.format(result.meta.competitorsAnalyzed)}</span>
          <span className={result.meta.confidence === "high" ? styles.confidenceHigh : result.meta.confidence === "medium" ? styles.confidenceMedium : styles.confidenceLow}>Надёжность: {result.meta.confidence === "high" ? "высокая" : result.meta.confidence === "medium" ? "средняя" : "низкая"}</span>
        </div>

        {result.warnings.length > 0 && <details className={styles.warning}><summary>Не вошли в расчёт: {integer.format(result.warnings.length)} {result.warnings.length === 1 ? "страница" : "страницы"}</summary><ul>{result.warnings.map((warning) => <li key={`${warning.position}-${warning.name}-${warning.error}`}><b>{warning.position ? `${integer.format(warning.position)}. ` : ""}{warning.name}</b> — {warning.error}</li>)}</ul></details>}

        <div className={styles.summaryMetrics}>
          <div className={styles.metricGrid}>
            <Metric label="TF-IDF ключей" value={percent(result.summary.keyTfidfScore)} note={`сырой вес ${number.format(result.summary.keyTfidfRaw)}`} />
            <Metric label="Взвешенный охват" value={percent(result.summary.weightedCoverage)} note="доля важных терминов и фраз" />
            <Metric label="Взвешенная плотность" value={percent(result.summary.weightedDensity)} note="выполнение ориентиров по вхождениям" />
          </div>
          <div className={styles.volumeMetric}><Metric label="Объём текста" value={integer.format(result.summary.ownWords)} note={`медиана конкурентов ${integer.format(result.summary.medianWords)}`} /></div>
        </div>

        <div className={styles.recommendation}><div><span>Главный вывод</span><strong>{result.summary.recommendation}</strong></div><p>Ориентир по объёму: {integer.format(result.summary.recommendedMin)}–{integer.format(result.summary.recommendedMax)} слов (Q25–Q75 конкурентов).</p></div>

        <section className={styles.reportSection}>
          <div className={styles.sectionHead}><div><span className={styles.sectionIndex}>01</span><h2>Леммы и важность</h2><p>Важность рассчитывается на основе TF-IDF и других сигналов релевантности.</p></div><button className={styles.download} type="button" onClick={() => downloadCsv("terms.csv", visibleTerms.map((row) => ({ Лемма: row.term, Словоформы: row.forms.join(", "), Зона: ZONES.find((item) => item.key === activeZone)?.label, "Входит в ключ": row.keywordHit ? "Да" : "Нет", Документы: countUp(row.sites), "У нас": countUp(row.ownCount), Ориентир: countUp(row.medianCount), Q25: countUp(row.q25), Q75: countUp(row.q75), Важность: row.importance, Действие: row.status })))}>Скачать CSV</button></div>
          <div className={styles.zoneTabs} role="tablist" aria-label="Зона анализа лемм">{ZONES.map((zone) => <button key={zone.key} type="button" role="tab" aria-selected={activeZone === zone.key} className={activeZone === zone.key ? styles.activeZone : ""} title={zone.hint} onClick={() => selectZone(zone.key)}>{zone.label}</button>)}</div>
          <div className={styles.comparisonTop}>
            <div><h3>Сравнение вхождений по леммам</h3><p>{ZONES.find((item) => item.key === activeZone)?.hint} · абсолютные целые вхождения · единая шкала от нуля</p></div>
            <label className={styles.competitorSelect}><span>Конкурент для сравнения</span><select value={selectedProfile?.id ?? ""} disabled={!comparisonProfiles.length} onChange={(event) => setSelectedCompetitorId(event.target.value)}>{!comparisonProfiles.length && <option value="">Профили недоступны</option>}{comparisonProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.position ? `№${integer.format(profile.position)} · ` : ""}{hostLabel(profile.url)}</option>)}</select></label>
          </div>
          <div className={styles.compareLegend} aria-label="Легенда графика"><span><i className={styles.compareOwn} />Наша страница</span><span><i className={styles.compareMedian} />Медиана</span><span><i className={styles.compareSelected} />{selectedProfile ? hostLabel(selectedProfile.url) : "Выбранный конкурент"}</span></div>
          <div className={styles.lemmaComparison}>{comparisonRows.map((item) => <div className={styles.lemmaCompareRow} key={item.term} aria-label={`${item.term}: наша страница ${integer.format(item.own)}, медиана ${integer.format(item.median)}, конкурент ${integer.format(item.selected)} вхождений`}>
            <strong title={item.term}>{item.term}</strong>
            <div className={styles.lemmaPlot}>
              <span><i className={styles.compareOwn} style={{ width: `${item.own / comparisonMax * 100}%` }} /></span>
              <span><i className={styles.compareMedian} style={{ width: `${item.median / comparisonMax * 100}%` }} /></span>
              <span><i className={styles.compareSelected} style={{ width: `${item.selected / comparisonMax * 100}%` }} /></span>
            </div>
            <div className={styles.comparisonValues}><b>{integer.format(item.own)}</b><b>{integer.format(item.median)}</b><b>{integer.format(item.selected)}</b></div>
          </div>)}{!comparisonRows.length && <p className={styles.empty}>Нет лемм для текущей зоны и фильтра.</p>}</div>
          {chartLimit < visibleTerms.length && <div className={styles.chartMore}><button type="button" onClick={() => setChartLimit((value) => value + CHART_PAGE_SIZE)}>Показать ещё 12 <span>{integer.format(visibleTerms.length - chartLimit)} осталось</span></button></div>}
          <div className={styles.tableTools}><FilterButtons value={termFilter} onChange={(value) => { setTermFilter(value); setTermPage(1); setChartLimit(CHART_PAGE_SIZE); }} /><input className={styles.search} value={termSearch} onChange={(event) => { setTermSearch(event.target.value); setTermPage(1); setChartLimit(CHART_PAGE_SIZE); }} placeholder="Лемма или словоформа" aria-label="Поиск по леммам" /></div>
          <div className={styles.tableWrap}><table className={`${styles.table} ${styles.lemmaTable}`}>
            <thead><tr><th>Лемма / формы</th><th>Документы</th><th>У нас</th><th>Ориентир</th><th>Важность</th><th>Действие</th></tr></thead>
            <tbody>{pagedTerms.map((row) => <tr key={row.key}>
              <td className={styles.termCell}><div className={styles.termTitle}><strong>{row.term}</strong>{row.keywordHit && <span className={styles.keywordBadge}>ключ</span>}</div><small>{row.forms.filter((form) => form !== row.term).slice(0, 5).join(" · ") || "основная форма"}</small></td>
              <td><b>{integer.format(countUp(row.sites))} из {integer.format(result.meta.competitorsAnalyzed)}</b><small>страниц с леммой</small></td>
              <td><b>{integer.format(countUp(row.ownCount))}</b><small>вхождений</small></td>
              <td><b>{integer.format(countUp(row.medianCount))}</b><small>{integer.format(countUp(row.q25))}–{integer.format(countUp(row.q75))}</small></td>
              <td><b>{number.format(row.importance)}</b></td>
              <td><Status value={row.status} /></td>
            </tr>)}</tbody>
          </table></div>
          <Pagination page={safeTermPage} pages={termPages} total={visibleTerms.length} setPage={setTermPage} />
        </section>

        <section className={styles.reportSection} aria-labelledby="clouds-heading">
          <div className={styles.sectionHead}><div><span className={styles.sectionIndex}>02</span><h2 id="clouds-heading">Облака слов: три страницы на одной шкале</h2><p>Среднее по конкурентам, наша страница и выбранный конкурент всегда видны рядом. Размер слова отражает частоту в выбранной HTML-зоне.</p></div></div>
          <div className={styles.cloudStage}>
            <div className={styles.cloudToolbar}>
              <div className={styles.zoneTabs} role="tablist" aria-label="HTML-зона облаков слов">{CLOUD_ZONES.map((zone) => <button key={zone.key} type="button" role="tab" aria-selected={cloudZone === zone.key} aria-label={`Показать облака слов: ${zone.hint}`} className={cloudZone === zone.key ? styles.activeZone : ""} title={zone.hint} onClick={() => setCloudZone(zone.key)}>{zone.label}</button>)}</div>
              <label className={styles.competitorSelect}><span>Конкурент в третьем облаке</span><select aria-label="Выбрать конкурента для третьего облака слов" value={selectedProfile?.id ?? ""} disabled={!comparisonProfiles.length} onChange={(event) => setSelectedCompetitorId(event.target.value)}>{!comparisonProfiles.length && <option value="">Профили недоступны</option>}{comparisonProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.position ? `№${integer.format(profile.position)} · ` : ""}{hostLabel(profile.url)}</option>)}</select></label>
            </div>
            <div className={styles.cloudGrid} role="group" aria-label={`Сравнение облаков слов: ${cloudZoneHint}`}>
              <Cloud title="Среднее конкурентов" note={`${integer.format(result.meta.competitorsAnalyzed)} страниц · ${cloudZoneHint}`} words={aggregateCloud} maxFrequency={cloudMax} />
              <Cloud title="Наша страница" note={`${cloudZoneHint}${cloudZone === "all" ? ` · ${integer.format(result.summary.ownWords)} слов` : ""}`} words={ownCloud} maxFrequency={cloudMax} own />
              <Cloud title={selectedProfile ? hostLabel(selectedProfile.url) : "Выбранный конкурент"} note={selectedProfile ? `${selectedProfile.position ? `Позиция ${integer.format(selectedProfile.position)} · ` : ""}${cloudZoneHint}` : `Нет профиля · ${cloudZoneHint}`} words={selectedCloud} maxFrequency={cloudMax} />
            </div>
          </div>
        </section>

        <section className={styles.reportSection}>
          <div className={styles.sectionHead}><div><span className={styles.sectionIndex}>03</span><h2>N-граммы и сходство с ключами</h2><p>Важность фразы учитывает её распространённость у принятых конкурентов, сходство с входными ключами и подтверждение в Title и H1–H6. Шкала нормирована плавно; в метрики документов сходство не входит.</p></div><button className={styles.download} type="button" onClick={() => downloadCsv("ngrams.csv", visibleNgrams.map((row) => ({ Фраза: row.phrase, Варианты: row.forms.join(", "), Зона: ZONES.find((item) => item.key === ngramZone)?.label, "Лучший ключ": row.bestKeyword, "Входит в ключ": row.keywordHit ? "Да" : "Нет", Документы: countUp(row.sites), "У нас": countUp(row.ownCount), Ориентир: countUp(row.medianCount), Q25: countUp(row.q25), Q75: countUp(row.q75), "Важность зоны": row.importance, "Сходство с ключом": row.keySimilarity, "Приоритет (глобальный)": row.priority, Действие: row.status })))}>Скачать CSV</button></div>
          <div className={styles.zoneTabs} role="tablist" aria-label="Зона анализа N-грамм">{ZONES.map((zone) => <button key={zone.key} type="button" role="tab" aria-selected={ngramZone === zone.key} className={ngramZone === zone.key ? styles.activeZone : ""} title={zone.hint} onClick={() => { setNgramZone(zone.key); setNgramPage(1); }}>{zone.label}</button>)}</div>
          <div className={styles.tableTools}><FilterButtons value={ngramFilter} onChange={(value) => { setNgramFilter(value); setNgramPage(1); }} /><input className={styles.search} value={ngramSearch} onChange={(event) => { setNgramSearch(event.target.value); setNgramPage(1); }} placeholder="Фраза или входной ключ" aria-label="Поиск по N-граммам" /></div>
          <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>Фраза / варианты</th><th>Ближайший ключ</th><th>Документы</th><th>У нас</th><th>Ориентир</th><th>Сходство с ключом</th><th>Важность</th><th>Приоритет</th><th>Действие</th></tr></thead>
            <tbody>{pagedNgrams.map((row) => <tr key={row.key}><td className={styles.termCell}><div className={styles.termTitle}><strong>{row.phrase}</strong>{row.keywordHit && <span className={styles.keywordBadge}>ключ</span>}</div><small>{row.forms.filter((form) => form !== row.phrase).slice(0, 3).join(" · ") || "основная форма"}</small></td><td className={styles.keywordCell}><b>{row.bestKeyword || "—"}</b><small>входной ключ</small></td><td><b>{integer.format(countUp(row.sites))} из {integer.format(result.meta.competitorsAnalyzed)}</b><small>страниц с фразой</small></td><td><b>{integer.format(countUp(row.ownCount))}</b><small>вхождений в зоне</small></td><td><b>{integer.format(countUp(row.medianCount))}</b><small>{integer.format(countUp(row.q25))}–{integer.format(countUp(row.q75))}</small></td><td><b>{number.format(row.keySimilarity)}</b><small>близость к ключу</small></td><td><b>{number.format(row.importance)}</b><small>для активной зоны</small></td><td><b>{number.format(row.priority)}</b><small>глобальный</small></td><td><Status value={row.status} /></td></tr>)}</tbody>
          </table></div><Pagination page={safeNgramPage} pages={ngramPages} total={visibleNgrams.length} setPage={setNgramPage} />
        </section>

        <section id="triplets" className={`${styles.reportSection} ${styles.tripletSection}`}>
          <div className={styles.sectionHead}>
            <div><span className={styles.sectionIndex}>04</span><h2>Семантические связи</h2><p>spaCy отдельно разбирает весь сохранённый корпус и извлекает из предложений все леммы, биграммы и триграммы — не только строки компактных таблиц. Затем определяет части речи, позиции и вероятные роли «сущность → действие → сущность». Повторно искать и загружать конкурентов не нужно.</p></div>
            <div className={styles.tripletHeadActions}>
              <span className={`${styles.tripletStatus} ${tripletBusy ? styles.tripletStatusBusy : tripletError ? styles.tripletStatusError : tripletData?.status === "ready" ? styles.tripletStatusReady : tripletData?.status === "unavailable" ? styles.tripletStatusWarning : ""}`} aria-live="polite"><i />{tripletStatusLabel}</span>
              <button className={styles.tripletBuildButton} type="button" disabled={loading || tripletBusy || !snapshotIsCurrent} onClick={() => void buildTriplets(result)}>{tripletData?.status === "ready" ? "Пересобрать связи" : "Построить связи"}</button>
            </div>
          </div>

          {tripletBusy && <div className={styles.tripletProgress} role="status" aria-live="polite"><div><i className={tripletPhase === "extracting" ? styles.tripletProgressExtracting : ""} /></div><strong>{tripletPhase === "selecting" ? "Готовим сущности и предложения" : "spaCy размечает предложения"}</strong><span>{tripletPhase === "selecting" ? "Извлекаем все леммы, биграммы и триграммы из полного сохранённого корпуса." : "Определяем части речи и позиции, затем объединяем одинаковые связи и проверяем минимум два разных доказательства."}</span></div>}
          {tripletError && <div className={styles.tripletMessageError} role="alert"><strong>Связи не построены</strong><span>{tripletError}</span><button type="button" onClick={() => void buildTriplets(result)}>Повторить</button></div>}

          {!tripletBusy && !tripletError && !tripletData && <div className={styles.tripletIntro}><div><strong>Анализ выключен по умолчанию</strong><p>Обычный семантический отчёт уже готов. Нажмите «Построить связи», чтобы отдельно запустить локальный синтаксический разбор spaCy.</p></div><ul><li>учитывается весь сохранённый корпус, а не только строки таблиц</li><li>одна сущность может иметь несколько связей</li><li>связь показывается минимум по двум предложениям</li></ul></div>}

          {!tripletBusy && !tripletError && tripletData?.status === "unavailable" && <div className={styles.tripletUnavailable}><strong>spaCy сейчас недоступен</strong><p>{tripletData.message || "Основной отчёт сохранён и полностью доступен. Запустите локальный сервис spaCy и повторите только этот этап."}</p></div>}
          {!tripletBusy && !tripletError && tripletData?.status === "disabled" && <div className={styles.tripletIntro}><div><strong>Дополнительный анализ выключен</strong><p>{tripletData.message || "Включите опцию и постройте связи, когда они понадобятся."}</p></div></div>}
          {!tripletBusy && !tripletError && tripletData?.status === "empty" && <div className={styles.tripletEmptyState}><strong>Подтверждённых связей не найдено</strong><p>{tripletData.message || "Кандидаты были проверены, но в предложениях корпуса не нашлось достаточно ясных связей."}</p><span>{integer.format(tripletCandidateCount)} сущностей · {integer.format(tripletProcessedSentenceCount)} предложений</span></div>}
          {!tripletBusy && !tripletError && tripletData?.status === "empty" && tripletIncompleteCorpus && <div className={styles.tripletTruncated}>Сервис сообщил, что обработал не весь сохранённый корпус. Повторите этап связей после обновления локального spaCy-сервиса.</div>}

          {!tripletBusy && !tripletError && tripletData?.status === "ready" && <>
            <div className={styles.tripletToolbar}>
              <label className={styles.competitorSelect}><span>Сущность в центре связей</span><select value={tripletSeed} onChange={(event) => { setTripletSeed(event.target.value); setTripletEdgeLimit(TRIPLET_EDGE_PAGE_SIZE); }}><option value="all">Все связанные сущности · {integer.format(connectedTripletCandidates.length)}</option>{connectedTripletCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}{candidate.importance > 0 ? ` · ${number.format(candidate.importance)}%` : ""}</option>)}</select></label>
              <div className={styles.tripletStats} aria-label="Сводка анализа связей"><span><b>{integer.format(tripletRelationCount)}</b> {pluralRu(tripletRelationCount, "связь", "связи", "связей")}</span><span><b>{integer.format(tripletProcessedSentenceCount)}</b>{tripletCorpusSentenceCount > tripletProcessedSentenceCount ? ` из ${integer.format(tripletCorpusSentenceCount)}` : ""} {pluralRu(tripletCorpusSentenceCount || tripletProcessedSentenceCount, "предложение", "предложения", "предложений")}</span><span><b>{integer.format(tripletCandidateCount)}</b> {pluralRu(tripletCandidateCount, "сущность", "сущности", "сущностей")}</span></div>
            </div>
            {tripletData.message && <div className={styles.tripletNotice}>{tripletData.message}</div>}
            {tripletIncompleteCorpus && <div className={styles.tripletTruncated}>Сервис сообщил, что обработал не весь сохранённый корпус. В таблице показаны все полученные связи; повторите этап после обновления локального spaCy-сервиса.</div>}
            <div className={styles.tripletGraph} role="list" aria-label="Семантические связи между сущностями">
              {visibleTripletEdges.map((edge) => <article className={styles.tripletEdge} role="listitem" key={edge.id}>
                <div className={styles.tripletPath}>
                  <strong className={styles.tripletNode}>{edge.sourceLabel}</strong>
                  <span className={styles.tripletPredicate}><i aria-hidden="true">→</i><b>{edge.negated && <em>не</em>}{edge.predicate}</b><i aria-hidden="true">→</i></span>
                  <strong className={`${styles.tripletNode} ${styles.tripletTarget}`}>{edge.targetLabel}</strong>
                </div>
                <div className={styles.tripletEvidence}>
                  <span><b>{integer.format(edge.occurrences)}</b> {pluralRu(edge.occurrences, "упоминание", "упоминания", "упоминаний")}</span><span><b>{integer.format(edge.documentCount)}</b> {pluralRu(edge.documentCount, "документ", "документа", "документов")}</span>
                  <div className={styles.tripletDocuments}>{(Array.isArray(edge.documents) ? edge.documents : []).slice(0, 5).map((document) => document.url ? <a key={document.id} href={document.url} target="_blank" rel="noreferrer" title={document.name}>{document.ours ? "Наша страница" : hostLabel(document.url)}</a> : <span key={document.id}>{document.ours ? "Наша страница" : document.name}</span>)}</div>
                  {!!edge.examples?.length && <details className={styles.tripletExamples}><summary>Примеры · {integer.format(edge.examples.length)}</summary><div>{edge.examples.slice(0, 3).map((example) => <blockquote key={example.sentenceId}><p>{example.text}</p><cite>{example.ours ? "Наша страница" : example.documentName}</cite></blockquote>)}</div></details>}
                </div>
              </article>)}
              {!visibleTripletEdges.length && <div className={styles.tripletEmptyState}><strong>У выбранной сущности нет подтверждённых связей</strong><p>Выберите другую сущность или покажите все связи.</p></div>}
            </div>
            {filteredTripletEdges.length > visibleTripletEdges.length && <div className={styles.tripletMore}><button type="button" onClick={() => setTripletEdgeLimit((value) => value + TRIPLET_EDGE_PAGE_SIZE)}>Показать ещё <span>+{integer.format(Math.min(TRIPLET_EDGE_PAGE_SIZE, filteredTripletEdges.length - visibleTripletEdges.length))}</span><small>Показано {integer.format(visibleTripletEdges.length)} из {integer.format(filteredTripletEdges.length)}</small></button></div>}
          </>}
        </section>

        <section className={styles.reportSection}>
          <div className={styles.sectionHead}><div><span className={styles.sectionIndex}>05</span><h2>Сравнение документов по метрикам</h2><p>Документы отсортированы по TF-IDF входных ключей. Взвешенная плотность показывает выполнение ориентиров по вхождениям важных лемм и фраз.</p></div></div>
          <div className={styles.documentTable} role="table" aria-label="Сравнение документов по метрикам">
            <div className={styles.documentHeader} role="row"><span>SERP</span><span>Документ</span><span>TF-IDF ключей</span><span>Взвешенный охват</span><span>Взвешенная плотность</span><span>Слов</span></div>
            {result.documents.map((doc, index) => <div className={`${styles.documentRow} ${doc.ours ? styles.ownDocument : ""}`} role="row" key={`${doc.url}-${index}`}><span className={styles.serpPosition}>{doc.ours ? "—" : doc.position ?? "—"}</span><div className={styles.documentName}><strong>{doc.ours ? "Наша страница" : doc.title || doc.name}</strong>{doc.url ? <a href={doc.url} target="_blank" rel="noreferrer">{hostLabel(doc.url)}</a> : <span>вставленный текст</span>}{doc.truncated && <em>частично загружена</em>}</div><div className={styles.docValue}><b>{percent(doc.keyTfidfScore)}</b><small>сырой вес {number.format(doc.keyTfidfRaw)}</small></div><div className={styles.docValue}><b>{percent(doc.weightedCoverage)}</b><small>важные термины и фразы</small></div><div className={styles.docValue}><b>{percent(doc.weightedDensity)}</b><small>выполнение ориентиров</small></div><div className={styles.docValue}><b>{integer.format(doc.words)}</b><small>{integer.format(doc.uniqueTerms)} уникальных</small></div></div>)}
          </div>
        </section>

        <section className={styles.reportSection}>
          <div className={styles.sectionHead}><div><span className={styles.sectionIndex}>06</span><h2>Количество слов</h2><p>Рекомендуемый диапазон — центральные 50% конкурентов.</p></div><div className={styles.rangeSummary}><span>Рекомендуемый диапазон</span><b>{integer.format(result.summary.recommendedMin)}–{integer.format(result.summary.recommendedMax)}</b></div></div>
          <div className={styles.wordChart}><div className={styles.wordRange}><strong>Q25–Q75</strong><div><i style={{ left: `${result.summary.recommendedMin / wordMax * 100}%`, width: `${Math.max(0, result.summary.recommendedMax - result.summary.recommendedMin) / wordMax * 100}%` }} /></div><b>{integer.format(result.summary.recommendedMin)}–{integer.format(result.summary.recommendedMax)}</b></div>{result.documents.slice(0, 12).map((doc, index) => <div className={`${styles.wordRow} ${doc.ours ? styles.wordOwn : ""}`} key={`${doc.url}-words-${index}`}><strong title={doc.title || doc.name}>{doc.ours ? "Наша страница" : `${doc.position ? `${doc.position}. ` : ""}${hostLabel(doc.url)}`}</strong><div><i style={{ width: `${doc.words / wordMax * 100}%` }} /></div><b>{integer.format(doc.words)}</b></div>)}</div>
        </section>

        <details className={styles.methodology}><summary>Методика расчёта</summary><div><p>Метрики вычисляются локально по собранному мультиязычному корпусу и входным ключам.</p>{Object.values(result.methodology || {}).filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((description, index) => <p key={`${index}-${description}`}>{description}</p>)}</div></details>
        <footer className={styles.footer}><Image src="/seomeat-logo.svg" alt="SEO Meat" width={152} height={16} /><span>БАР · Сделано в школе SEO Мясо</span><div className={styles.footerLinks}><a href="https://seomeat.ru/" target="_blank" rel="noreferrer">Школа ↗</a><a href="https://t.me/seokotenkov" target="_blank" rel="noreferrer">Создатель ↗</a></div></footer>
      </section>}
    </div>
  </main>;
}
