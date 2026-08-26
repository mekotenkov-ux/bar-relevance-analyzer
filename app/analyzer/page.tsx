"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  stopTermPresetFor,
  stopTermPresetText,
} from "@/lib/default-stop-terms";
import { CLOUD_LAYOUT_HEIGHT, CLOUD_LAYOUT_WIDTH, packCloudWords } from "@/lib/cloud-layout";
import { LANGUAGE_OPTIONS, languageCapability } from "@/lib/language-support";
import type { XmlRiverRegion } from "@/lib/xmlriver-regions";
import styles from "./analyzer.module.css";

type InputMode = "url" | "text";
type SearchEngine = "google" | "yandex";
type Device = "desktop" | "tablet" | "mobile";
type StatusValue = "Добавить" | "Норма" | "Снизить";
type ZoneKey = "all" | "title" | "h1" | "text" | "headings" | "anchors";
type PageDraft = { name: string; mode: InputMode; url: string; text: string };
type NgramNestingParent = { key: string; phrase: string; occurrences: number; sites: number; share: number };
type NgramNesting = {
  classification: "independent" | "partially_nested" | "fully_nested" | "insufficient_evidence";
  evidenceComplete: boolean;
  occurrences: number;
  standaloneOccurrences: number;
  nestedOccurrences: number;
  nestedShare: number;
  ownClassification?: "independent" | "partially_nested" | "fully_nested" | "insufficient_evidence";
  ownEvidenceComplete?: boolean;
  ownOccurrences?: number;
  ownStandaloneOccurrences?: number;
  ownNestedOccurrences?: number;
  ownMergeParentOccurrences?: number;
  ownMergeParentShare?: number;
  ownMergeParentComplete?: boolean;
  mergeable?: boolean;
  mergeParentKey?: string;
  mergeParentPhrase?: string;
  parents: NgramNestingParent[];
};
type ZoneMetrics = {
  available: boolean;
  sites: number;
  ownCount: number;
  medianCount: number;
  q25Count: number;
  q75Count: number;
  importance: number;
  status: StatusValue;
  nesting?: NgramNesting;
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
  keyMatch?: "exact" | "possible" | "none";
  isExactKeyword?: boolean;
  nesting?: NgramNesting;
  nestedChildren?: Array<{ key: string; phrase: string; occurrences: number }>;
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
    morphologyMode?: "lemmatization" | "stemming" | "tokens";
    morphologyLabel?: string;
    builtInStopwords?: boolean;
    confidence: "high" | "medium" | "low";
    phraseSimilarityMethod?: string;
    phraseSimilarityEngine?: "e5" | "local";
    phraseSimilarityModel?: string;
    phraseSimilarityRevision?: string;
    phraseSimilarityCached?: boolean;
    phraseSimilarityCoverage?: number;
    phraseSimilarityError?: string;
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
};
type SearchResponse = {
  competitors: Array<{ position: number; name: string; title: string; url: string; snippet: string }>;
  credentialSource: "server" | "browser";
  region?: (XmlRiverRegion & { known: boolean }) | null;
  error?: string;
};
type RegionOption = {
  id: string;
  label: string;
  name: string;
  matchLabels: string[];
  countryCode: string;
  kind: "country" | "region" | "city";
  engine: SearchEngine;
};
type SortDirection = "asc" | "desc";
type TermSortKey = "term" | "sites" | "ownCount" | "medianCount" | "importance" | "status";
type NgramSortKey = "phrase" | "keyMark" | "sites" | "ownCount" | "medianCount" | "importance" | "status";
type DocumentSortKey = "position" | "name" | "keyTfidfScore" | "weightedCoverage" | "weightedDensity" | "words";
type SortState<Key extends string> = { key: Key; direction: SortDirection };

const XMLRIVER_STORAGE_KEY = "bar:xmlriver:credentials:v1";
const REPORT_STORAGE_KEY = "bar:last-report:v10";
const LEGACY_REPORT_STORAGE_KEY = "bar:last-report:v9";
const TERM_PAGE_SIZE = 20;
const NGRAM_PAGE_SIZE = 15;
const CHART_PAGE_SIZE = 12;
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const INITIAL_STOP_TERMS = stopTermPresetText("ru");

const COLUMN_TOOLTIPS: Record<string, string> = {
  "Лемма / формы": "Начальная форма слова и найденные в корпусе словоформы.",
  "Фраза / варианты": "N-грамма и варианты её написания, найденные на принятых страницах.",
  "Попадание в ключ": "«Ключ» — точное морфологическое совпадение фразы с ключом. «Возможно ключ» — высокая смысловая близость к одному из ключей.",
  "Документы": "Сколько принятых страниц конкурентов содержит терм в выбранной зоне.",
  "У нас": "Целое число вхождений терма на вашей странице в выбранной зоне.",
  "Ориентир": "Ориентир по конкурентам, нормированный под объём вашей страницы или выбранной зоны. Ниже показан диапазон Q25–Q75.",
  "Важность": "Нормированная оценка 0–100: чем она выше, тем полезнее проверить терм в первую очередь.",
  "Действие": "Рекомендация по сравнению вашей страницы с конкурентным диапазоном.",
  "SERP": "Позиция страницы в полученной поисковой выдаче.",
  "Документ": "Принятая страница конкурента или ваша анализируемая страница.",
  "TF-IDF ключей": "Насколько заметны введённые ключи в документе по TF-IDF.",
  "Взвешенный охват": "Доля важных лемм и фраз, которые присутствуют в документе хотя бы один раз.",
  "Взвешенная плотность": "Насколько документ выполняет ориентир по числу вхождений каждого важного терма.",
  "Слов": "Количество слов в видимом содержимом документа.",
};

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
};

function percent(value: number) { return `${number.format(value)}%`; }
function frequency(value: number) { return number.format(value); }
function average(values: readonly number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0) / values.length;
}
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
function saveReport(report: AnalysisResult, stopWords: string, stopPhrases: string) {
  const stored: StoredReport = { version: 10, report, stopWords, stopPhrases };
  try { sessionStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(stored)); }
  catch { /* A large corpus can exceed the browser session quota; the live report remains usable. */ }
}
function countUp(value: number | undefined) {
  return Math.ceil(Math.max(0, Number.isFinite(value) ? Number(value) : 0));
}
function isCurrentSnapshot(value: unknown) {
  return Boolean(value && typeof value === "object" && Number((value as { version?: unknown }).version) === 5);
}

function normalizeKeyPhrase(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
}

function ngramKeyMark(row: NgramRow, queries: readonly string[]) {
  if (row.keywordHit === true || row.keyMatch === "exact" || row.isExactKeyword === true) return "Ключ" as const;
  const normalizedQueries = new Set(queries.map(normalizeKeyPhrase).filter(Boolean));
  const exact = [row.phrase, ...row.forms].some((value) => normalizedQueries.has(normalizeKeyPhrase(value)));
  if (exact) return "Ключ" as const;
  if (row.keyMatch === "possible" || row.keySimilarity > 0.8) return "Возможно ключ" as const;
  return "" as const;
}

function statusRank(value: StatusValue) {
  return value === "Добавить" ? 0 : value === "Снизить" ? 1 : 2;
}

function compareValues(left: string | number, right: string | number) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "ru", { numeric: true, sensitivity: "base" });
}

function stableSort<Row>(rows: readonly Row[], direction: SortDirection, value: (row: Row) => string | number, tieBreaker: (row: Row) => string) {
  const multiplier = direction === "asc" ? 1 : -1;
  return rows.map((row, index) => ({ row, index })).sort((left, right) => {
    const primary = compareValues(value(left.row), value(right.row)) * multiplier;
    if (primary) return primary;
    const tie = tieBreaker(left.row).localeCompare(tieBreaker(right.row), "ru", { numeric: true, sensitivity: "base" });
    return tie || left.index - right.index;
  }).map(({ row }) => row);
}

function nextSort<Key extends string>(current: SortState<Key>, key: Key, numeric = false): SortState<Key> {
  if (current.key === key) return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  return { key, direction: numeric ? "desc" : "asc" };
}

function normalizeRegionOptions(value: unknown, defaultEngine: SearchEngine = "yandex"): RegionOption[] {
  const result: RegionOption[] = [];
  const seen = new Set<string>();
  const add = (item: unknown, fallbackEngine: SearchEngine = defaultEngine) => {
    if (!item || typeof item !== "object") return;
    const source = item as Record<string, unknown>;
    const rawId = source.code ?? source.id ?? source.value ?? source.regionId ?? source.region_id;
    const id = typeof rawId === "string" || typeof rawId === "number" ? String(rawId).trim() : "";
    const rawEngine = source.engine;
    const optionEngine: SearchEngine = rawEngine === "google" ? "google" : rawEngine === "yandex" ? "yandex" : fallbackEngine;
    const rawLabel = source.label ?? source.name ?? source.title ?? source.text;
    const plainLabel = typeof rawLabel === "string" ? rawLabel.trim() : "";
    const canonicalName = typeof source.canonicalName === "string"
      ? source.canonicalName.split(",").map((part) => part.trim()).filter(Boolean).join(", ") : "";
    const rawDisplayLabel = typeof source.displayLabel === "string" ? source.displayLabel.trim() : "";
    const baseLabel = canonicalName || plainLabel;
    const label = rawDisplayLabel || (baseLabel && id ? `${baseLabel} — ${id}` : "");
    const key = `${optionEngine}:${id}`;
    if (!id || !label || seen.has(key)) return;
    seen.add(key);
    const countryCode = typeof source.countryCode === "string" ? source.countryCode.trim().toUpperCase() : "";
    const kind = source.kind === "country" ? "country" : source.kind === "region" ? "region" : "city";
    result.push({ id, label, name: plainLabel || canonicalName || label, matchLabels: [plainLabel, canonicalName].filter(Boolean), countryCode, kind, engine: optionEngine });
  };
  if (Array.isArray(value)) value.forEach((item) => add(item));
  else if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    for (const optionEngine of ["yandex", "google"] as const) {
      const items = source[optionEngine];
      if (Array.isArray(items)) items.forEach((item) => add(item, optionEngine));
    }
  }
  return result.sort((left, right) => left.label.localeCompare(right.label, "ru", { numeric: true, sensitivity: "base" }) || left.id.localeCompare(right.id));
}

function terminalRegionCode(value: string) {
  const match = value.trim().match(/(?:^|[\s([—–-])([1-9]\d{0,11})\s*[)\]]?$/u);
  return match?.[1] ?? "";
}

function normalizedRegionLabel(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ");
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
  let rows: NgramRow[];
  if (result.ngrams.some((row) => row.zones?.[zone])) {
    rows = result.ngrams.flatMap((row) => {
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
        nesting: metrics.nesting ?? row.nesting,
      }];
    });
  } else rows = zone === "all" ? result.ngrams : [];

  const byKey = new Map(rows.map((row) => [row.key, row]));
  const childrenByParent = new Map<string, Array<{ key: string; phrase: string; occurrences: number }>>();
  const hidden = new Set<string>();
  for (const row of rows) {
    const nesting = row.nesting;
    if (row.keywordHit || !nesting?.evidenceComplete || nesting.classification !== "fully_nested" || nesting.mergeable !== true || !nesting.mergeParentKey) continue;
    // Never hide a short phrase unless every occurrence on our page belongs to
    // the same concrete parent selected from competitor evidence.
    if (nesting.ownMergeParentComplete !== true) continue;
    const parent = byKey.get(nesting.mergeParentKey);
    if (!parent) continue;
    hidden.add(row.key);
    const children = childrenByParent.get(parent.key) ?? [];
    children.push({ key: row.key, phrase: row.phrase, occurrences: countUp(nesting.occurrences || row.sites) });
    childrenByParent.set(parent.key, children);
  }
  return rows.filter((row) => !hidden.has(row.key)).map((row) => ({
    ...row,
    nestedChildren: childrenByParent.get(row.key)?.sort((left, right) => right.occurrences - left.occurrences || left.phrase.localeCompare(right.phrase, "ru")),
  })).sort((left, right) => right.importance - left.importance || (right.priority ?? 0) - (left.priority ?? 0) || left.phrase.localeCompare(right.phrase));
}

function escapeMarkdown(value: string) {
  return value.replace(/([\\`*_{}[\]()#+.!|>-])/gu, "\\$1");
}

function adjustmentAction(row: SemanticRow) {
  const own = countUp(row.ownCount);
  const lower = countUp(row.q25);
  const upper = Math.max(lower, countUp(row.q75));
  if (own >= lower && own <= upper) return "";
  if (own < lower) return "Добавить" as const;
  if (own > upper) return "Снизить" as const;
  return "";
}

function buildPageBrief(result: AnalysisResult) {
  const lines = [`# ТЗ для страницы: ${result.meta.serpQuery}`, "", "Работайте по зонам: сначала исправляйте фразы, затем отдельные леммы."];
  let taskCount = 0;
  for (const zone of ZONES) {
    const phraseRows = ngramsForZone(result, zone.key)
      .filter((row) => adjustmentAction(row))
      .sort((left, right) => right.importance - left.importance || left.phrase.localeCompare(right.phrase, "ru"));
    const lemmaRows = termsForZone(result, zone.key)
      .filter((row) => adjustmentAction(row))
      .sort((left, right) => right.importance - left.importance || left.term.localeCompare(right.term, "ru"));
    if (!phraseRows.length && !lemmaRows.length) continue;
    lines.push("", `## ${zone.label} — ${zone.hint}`);
    if (phraseRows.length) {
      lines.push("", "### Фразы");
      for (const row of phraseRows) {
        const action = adjustmentAction(row);
        const verb = action === "Добавить" ? "Добавить" : "Снизить количество вхождений";
        lines.push(`- [ ] ${verb} фразы **${escapeMarkdown(row.phrase)}**: сейчас ${countUp(row.ownCount)}, ориентир ${countUp(row.medianCount)} (диапазон ${countUp(row.q25)}–${countUp(row.q75)}).`);
        taskCount += 1;
      }
    }
    if (lemmaRows.length) {
      lines.push("", "### Леммы");
      for (const row of lemmaRows) {
        const action = adjustmentAction(row);
        const verb = action === "Добавить" ? "Добавить" : "Снизить количество вхождений";
        lines.push(`- [ ] ${verb} леммы **${escapeMarkdown(row.term)}**: сейчас ${countUp(row.ownCount)}, ориентир ${countUp(row.medianCount)} (диапазон ${countUp(row.q25)}–${countUp(row.q75)}).`);
        taskCount += 1;
      }
    }
  }
  if (!taskCount) lines.push("", "Страница уже находится в рекомендуемых диапазонах. Обязательных правок нет.");
  return lines.join("\n");
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
      <button type="button" title="Загрузить и разобрать страницу по публичному URL" className={draft.mode === "url" ? styles.activeMode : ""} onClick={() => onChange({ ...draft, mode: "url" })}>По URL</button>
      <button type="button" title="Проанализировать вставленный текст без загрузки страницы" className={draft.mode === "text" ? styles.activeMode : ""} onClick={() => onChange({ ...draft, mode: "text" })}>Вставить текст</button>
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
  language,
  stopWords,
  stopPhrases,
  setStopWords,
  setStopPhrases,
  compact = false,
}: {
  language: string;
  stopWords: string;
  stopPhrases: string;
  setStopWords: (value: string) => void;
  setStopPhrases: (value: string) => void;
  compact?: boolean;
}) {
  const preset = stopTermPresetFor(language);
  const basePreset = stopTermPresetText(language);
  const webPreset = stopTermPresetText(language, true);
  const presetCount = preset.words.length + preset.phrases.length;
  const webPresetCount = preset.optionalWebWords.length + preset.optionalWebPhrases.length;
  const capability = languageCapability(language);
  const applyDefaultStops = () => {
    setStopWords(basePreset.words);
    setStopPhrases(basePreset.phrases);
  };
  const applyWebStops = () => {
    setStopWords(webPreset.words);
    setStopPhrases(webPreset.phrases);
  };
  const clearStops = () => {
    setStopWords("");
    setStopPhrases("");
  };

  return <div className={`${styles.stopGrid} ${compact ? styles.stopGridCompact : ""}`}>
    <div className={styles.stopPresetBar}>
      <div className={styles.stopPresetCopy}>
        <strong>Дополнительный стоп-лист · {preset.label}</strong>
        <span>{language === "auto"
          ? "Встроенные стоп-слова будут выбраны автоматически после определения языка. Здесь можно добавить свои исключения."
          : `${capability?.stopwordLabel ?? "Пользовательские стоп-слова"} применяются автоматически. Поля ниже — редактируемые дополнения для ${preset.label}.`}</span>
      </div>
      <div className={styles.stopPresetActions} role="group" aria-label="Управление стоп-листом">
        <button type="button" title="Восстановить базовый набор дополнительных стоп-термов для выбранного языка" onClick={applyDefaultStops} disabled={!presetCount} aria-label={`Восстановить базовый дополнительный набор для ${preset.label}`}>Базовый <span>{presetCount}</span></button>
        <button type="button" title="Добавить типовой CTA, юридические фразы и другой веб-шум" onClick={applyWebStops} disabled={!webPresetCount} aria-label={`Добавить CTA и юридический веб-шум для ${preset.label}`}>+ Веб-шум <span>+{webPresetCount}</span></button>
        <button type="button" title="Очистить только дополнительные стоп-слова и стоп-фразы" onClick={clearStops}>Очистить</button>
      </div>
    </div>
    <label className={styles.field}>
      <span>Стоп-слова</span>
      <textarea className={`${styles.textarea} ${styles.stopTextarea}`} value={stopWords} onChange={(event) => setStopWords(event.target.value)} placeholder={'например\nсайт\nкомпания'} />
      <small>{language === "auto" ? "Дополнительные слова нормализуются после автоопределения — по фактическому режиму выбранного языка." : capability?.morphology === "lemmatization" ? "Слово приводится к нормальной форме: его словоформы и фразы с ними исключаются автоматически." : capability?.morphology === "tokens" ? "В этом языке словоформы не склеиваются: добавьте каждое нужное окончание отдельно. Фразы с таким словом тоже исключаются." : "По одному с новой строки или через запятую. Snowball исключает словоформы с тем же стемом; это не словарная лемматизация."}</small>
    </label>
    <label className={styles.field}>
      <span>Стоп-фразы</span>
      <textarea className={`${styles.textarea} ${styles.stopTextarea}`} value={stopPhrases} onChange={(event) => setStopPhrases(event.target.value)} placeholder={'политика конфиденциальности\nоставить заявку'} />
      <small>Фраза совпадает по последовательности {language === "auto" ? "термов, нормализованных после определения языка" : capability?.morphology === "lemmatization" ? "морфологических лемм" : capability?.morphology === "tokens" ? "нормализованных словоформ" : "Snowball-стемов"}; порядок слов сохраняется.</small>
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
  if (value === "Норма") return null;
  const className = value === "Добавить" ? styles.add : styles.reduce;
  return <span className={`${styles.status} ${className}`}><span aria-hidden="true">{value === "Добавить" ? "+" : value === "Снизить" ? "−" : "✓"}</span>{value}</span>;
}
function Pagination({ page, pages, total, setPage }: { page: number; pages: number; total: number; setPage: (page: number) => void }) {
  if (!total) return <div className={styles.pagination}><span>Ничего не найдено</span></div>;
  return <div className={styles.pagination}>
    <span>{integer.format(total)} строк · страница {page} из {pages}</span>
    <div><button type="button" title="Перейти на предыдущую страницу таблицы" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Предыдущая страница">←</button><button type="button" title="Перейти на следующую страницу таблицы" onClick={() => setPage(Math.min(pages, page + 1))} disabled={page >= pages} aria-label="Следующая страница">→</button></div>
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
function HelpTip({ text }: { text: string }) {
  return <button className={styles.helpTip} type="button" aria-label={`Подсказка: ${text}`} data-tooltip={text}>?</button>;
}
function Metric({ label, value, note, tooltip, benchmark }: { label: string; value: string; note: string; tooltip: string; benchmark?: string }) {
  return <div className={styles.metric} title={tooltip}>
    <span className={styles.metricLabel}>{label}<HelpTip text={tooltip} /></span>
    <strong>{value}{benchmark && <em className={styles.metricBenchmark}>из {benchmark}</em>}</strong>
    <small>{note}</small>
  </div>;
}
function FilterButtons({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className={styles.filters} aria-label="Фильтр по действию">{["Все", "Добавить", "Снизить"].map((item) => <button key={item} type="button" title={item === "Все" ? "Показать все строки" : `Показать только строки с действием «${item}»`} className={value === item ? styles.activeFilter : ""} onClick={() => onChange(item)}>{item}</button>)}</div>;
}

function SortableHeader<Key extends string>({ label, sortKey, state, onSort, numeric = false, tooltip }: { label: string; sortKey: Key; state: SortState<Key>; onSort: (state: SortState<Key>) => void; numeric?: boolean; tooltip?: string }) {
  const active = state.key === sortKey;
  const ariaSort = active ? state.direction === "asc" ? "ascending" : "descending" : "none";
  const explanation = tooltip ?? COLUMN_TOOLTIPS[label] ?? `Сортировка таблицы по колонке «${label}».`;
  return <th scope="col" aria-sort={ariaSort}><button className={styles.sortButton} type="button" title={explanation} onClick={() => onSort(nextSort(state, sortKey, numeric))} aria-label={`${label}: ${explanation} ${active ? state.direction === "asc" ? "Сейчас по возрастанию, переключить на убывание." : "Сейчас по убыванию, переключить на возрастание." : "Нажмите, чтобы отсортировать."}`}>{label}<span aria-hidden="true">{active ? state.direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th>;
}

function DocumentSortableHeader({ label, sortKey, state, onSort, numeric = false, tooltip }: { label: string; sortKey: DocumentSortKey; state: SortState<DocumentSortKey>; onSort: (state: SortState<DocumentSortKey>) => void; numeric?: boolean; tooltip?: string }) {
  const active = state.key === sortKey;
  const ariaSort = active ? state.direction === "asc" ? "ascending" : "descending" : "none";
  const explanation = tooltip ?? COLUMN_TOOLTIPS[label] ?? `Сортировка таблицы по колонке «${label}».`;
  return <span role="columnheader" aria-sort={ariaSort}><button className={styles.sortButton} type="button" title={explanation} onClick={() => onSort(nextSort(state, sortKey, numeric))} aria-label={`${label}: ${explanation} ${active ? state.direction === "asc" ? "Сейчас по возрастанию, переключить на убывание." : "Сейчас по убыванию, переключить на возрастание." : "Нажмите, чтобы отсортировать."}`}>{label}<span aria-hidden="true">{active ? state.direction === "asc" ? "↑" : "↓" : "↕"}</span></button></span>;
}

export default function AnalyzerPage() {
  const [serpQuery, setSerpQuery] = useState("");
  const [analysisKeys, setAnalysisKeys] = useState("");
  const [language, setLanguage] = useState("ru");
  const [engine, setEngine] = useState<SearchEngine>("yandex");
  const [countryCode, setCountryCode] = useState("RU");
  const [region, setRegion] = useState("Москва, Россия — 213");
  const [device, setDevice] = useState<Device>("desktop");
  const [competitorCount, setCompetitorCount] = useState(10);
  const [stopWords, setStopWords] = useState(INITIAL_STOP_TERMS.words);
  const [stopPhrases, setStopPhrases] = useState(INITIAL_STOP_TERMS.phrases);
  const [ownPage, setOwnPage] = useState<PageDraft>({ name: "Наша страница", mode: "url", url: "", text: "" });
  const [serverConfigured, setServerConfigured] = useState<boolean | null>(null);
  const [firecrawlConfigured, setFirecrawlConfigured] = useState<boolean | null>(null);
  const [countryOptions, setCountryOptions] = useState<RegionOption[]>([]);
  const [regionOptions, setRegionOptions] = useState<RegionOption[]>([]);
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
  const [termSort, setTermSort] = useState<SortState<TermSortKey>>({ key: "importance", direction: "desc" });
  const [ngramSort, setNgramSort] = useState<SortState<NgramSortKey>>({ key: "importance", direction: "desc" });
  const [documentSort, setDocumentSort] = useState<SortState<DocumentSortKey>>({ key: "keyTfidfScore", direction: "desc" });
  const [briefCopied, setBriefCopied] = useState(false);
  const xmlCredentialsLoaded = useRef(false);
  const stopDrafts = useRef<Record<string, { words: string; phrases: string }>>({
    ru: INITIAL_STOP_TERMS,
  });

  const selectLanguage = (nextLanguage: string) => {
    stopDrafts.current[language] = { words: stopWords, phrases: stopPhrases };
    const nextStops = stopDrafts.current[nextLanguage] ?? stopTermPresetText(nextLanguage);
    stopDrafts.current[nextLanguage] = nextStops;
    setLanguage(nextLanguage);
    setStopWords(nextStops.words);
    setStopPhrases(nextStops.phrases);
  };

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
          setSerpQuery(report.meta.serpQuery);
          setAnalysisKeys((report.meta.queries || []).join("\n") || report.meta.query);
          setLanguage(report.meta.language || "auto");
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
    }).catch(() => { setServerConfigured(false); setFirecrawlConfigured(false); });
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

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/xmlriver-regions?engine=${engine}&countries=1`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("country lookup unavailable")))
      .then((data: { countries?: unknown }) => {
        const options = normalizeRegionOptions(data.countries, engine).filter((option) => option.kind === "country" && option.countryCode);
        setCountryOptions(options);
        setCountryCode((current) => (options.find((option) => option.countryCode === current)
          ?? options.find((option) => option.countryCode === "RU")
          ?? options[0])?.countryCode ?? current);
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) setCountryOptions([]);
      });
    return () => controller.abort();
  }, [engine]);

  useEffect(() => {
    const selectedCode = terminalRegionCode(region);
    if (!selectedCode) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ engine, resolve: region });
    fetch(`/api/xmlriver-regions?${params.toString()}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("region resolve unavailable")))
      .then((data: { region?: { countryCode?: unknown } }) => {
        const resolvedCountry = typeof data.region?.countryCode === "string" ? data.region.countryCode.toUpperCase() : "";
        if (resolvedCountry) setCountryCode((current) => resolvedCountry === current ? current : resolvedCountry);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [engine, region]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const query = region.trim();
      const params = new URLSearchParams({ engine, countryCode, limit: "100" });
      if (query) params.set("q", query);
      fetch(`/api/xmlriver-regions?${params.toString()}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("region lookup unavailable")))
        .then((data: { regions?: unknown }) => {
          const options = normalizeRegionOptions(data.regions, engine);
          setRegionOptions(options);
          const selectedCode = terminalRegionCode(query);
          const exactCode = options.find((option) => option.id === query || option.id === selectedCode);
          const normalizedQuery = normalizedRegionLabel(query);
          const exactNames = options.filter((option) => option.matchLabels
            .some((label) => normalizedRegionLabel(label) === normalizedQuery));
          const canonical = exactCode ?? (exactNames.length === 1 ? exactNames[0] : undefined);
          if (canonical && canonical.label !== query) setRegion(canonical.label);
        })
        .catch((cause: unknown) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setRegionOptions([]); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [countryCode, engine, region]);

  const comparisonProfiles = Array.isArray(result?.comparisonProfiles)
    ? result.comparisonProfiles.filter((profile) => profile && profile.id && Array.isArray(profile.lemmas) && Array.isArray(profile.cloud))
    : [];

  const ownReady = ownPage.mode === "url" ? ownPage.url.trim() : ownPage.text.trim();
  const credentialsReady = serverConfigured === true || Boolean(xmlUser.trim() && xmlKey.trim());
  const canAnalyze = Boolean(serpQuery.trim() && region.trim() && ownReady && credentialsReady && !loading);
  const currentKeys = useMemo(() => parseKeys(analysisKeys, result?.meta.serpQuery || serpQuery), [analysisKeys, result?.meta.serpQuery, serpQuery]);
  const snapshotIsCurrent = isCurrentSnapshot(result?.snapshot);
  const zoneTerms = useMemo(() => termsForZone(result, activeZone), [result, activeZone]);
  const zoneNgrams = useMemo(() => ngramsForZone(result, ngramZone), [result, ngramZone]);

  const visibleTerms = useMemo(() => zoneTerms.filter((row) => `${row.term} ${row.forms.join(" ")}`.toLowerCase().includes(termSearch.toLowerCase())).filter((row) => termFilter === "Все" || row.status === termFilter), [zoneTerms, termFilter, termSearch]);
  const sortedTerms = useMemo(() => stableSort(visibleTerms, termSort.direction, (row) => {
    if (termSort.key === "term") return row.term;
    if (termSort.key === "status") return statusRank(row.status);
    return row[termSort.key];
  }, (row) => row.key), [visibleTerms, termSort]);
  const termPages = Math.max(1, Math.ceil(visibleTerms.length / TERM_PAGE_SIZE));
  const safeTermPage = Math.min(termPage, termPages);
  const pagedTerms = sortedTerms.slice((safeTermPage - 1) * TERM_PAGE_SIZE, safeTermPage * TERM_PAGE_SIZE);
  const visibleNgrams = useMemo(() => zoneNgrams.filter((row) => `${row.phrase} ${row.forms.join(" ")} ${row.bestKeyword} ${(row.nestedChildren ?? []).map((child) => child.phrase).join(" ")}`.toLowerCase().includes(ngramSearch.toLowerCase())).filter((row) => ngramFilter === "Все" || row.status === ngramFilter), [zoneNgrams, ngramFilter, ngramSearch]);
  const sortedNgrams = useMemo(() => stableSort(visibleNgrams, ngramSort.direction, (row) => {
    if (ngramSort.key === "phrase") return row.phrase;
    if (ngramSort.key === "keyMark") return ngramKeyMark(row, currentKeys) === "Ключ" ? 2 : ngramKeyMark(row, currentKeys) === "Возможно ключ" ? 1 : 0;
    if (ngramSort.key === "status") return statusRank(row.status);
    return row[ngramSort.key];
  }, (row) => row.key), [visibleNgrams, ngramSort, currentKeys]);
  const ngramPages = Math.max(1, Math.ceil(visibleNgrams.length / NGRAM_PAGE_SIZE));
  const safeNgramPage = Math.min(ngramPage, ngramPages);
  const pagedNgrams = sortedNgrams.slice((safeNgramPage - 1) * NGRAM_PAGE_SIZE, safeNgramPage * NGRAM_PAGE_SIZE);

  const selectZone = (zone: ZoneKey) => {
    setActiveZone(zone);
    setTermFilter("Все");
    setTermPage(1);
    setChartLimit(CHART_PAGE_SIZE);
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
          serpQuery, queries: parseKeys(analysisKeys, serpQuery), stopWords: parseStops(stopWords), stopPhrases: parseStops(stopPhrases), language,
          ownPage: { name: ownPage.name, url: ownPage.mode === "url" ? ownPage.url : "", text: ownPage.mode === "text" ? ownPage.text : "" },
          competitors: searchData.competitors.map((item) => ({ name: item.name, title: item.title, url: item.url, position: item.position })),
          search: { engine, region: searchData.region?.displayLabel || searchData.region?.label || region, device, found: searchData.competitors.length },
        }),
      });
      const data = await analyzeResponse.json() as AnalysisResult & { error?: string };
      if (!analyzeResponse.ok) throw new Error(data.error || "Не удалось выполнить анализ найденных страниц");
      setResult(data); setAnalysisKeys(data.meta.queries.join("\n")); saveReport(data, stopWords, stopPhrases);
      requestAnimationFrame(() => document.getElementById("report")?.scrollIntoView({ behavior: "smooth" }));
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
      setResult(data); setAnalysisKeys(data.meta.queries.join("\n")); saveReport(data, stopWords, stopPhrases);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось пересчитать отчёт"); }
    finally { setLoading(false); }
  };

  const refreshCompetitors = () => {
    if (result) {
      setSerpQuery(result.meta.serpQuery);
      setAnalysisKeys(result.meta.queries.join("\n"));
      selectLanguage(result.meta.language || "auto");
    }
    setActiveZone("all"); setTermFilter("Все"); setTermPage(1); setChartLimit(CHART_PAGE_SIZE); setNgramZone("all"); setNgramPage(1); setCloudZone("all");
    setResult(null); setError(""); sessionStorage.removeItem(REPORT_STORAGE_KEY); sessionStorage.removeItem(LEGACY_REPORT_STORAGE_KEY);
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
  const competitorDocuments = result?.documents.filter((document) => !document.ours) ?? [];
  const competitorMetricAverages = {
    keyTfidfScore: average(competitorDocuments.map((document) => document.keyTfidfScore)),
    weightedCoverage: average(competitorDocuments.map((document) => document.weightedCoverage)),
    weightedDensity: average(competitorDocuments.map((document) => document.weightedDensity)),
  };
  const availableRegionOptions = regionOptions.filter((option) => option.engine === engine && option.countryCode === countryCode);
  const sortedDocuments = useMemo(() => result ? stableSort(result.documents, documentSort.direction, (row) => {
    if (documentSort.key === "position") return row.ours ? Number.MAX_SAFE_INTEGER : row.position ?? Number.MAX_SAFE_INTEGER - 1;
    if (documentSort.key === "name") return row.ours ? "Наша страница" : row.title || row.name;
    return row[documentSort.key];
  }, (row) => `${row.ours ? "0" : "1"}:${row.position ?? ""}:${row.url}:${row.name}`) : [], [result, documentSort]);
  const pageBrief = useMemo(() => result ? buildPageBrief(result) : "", [result]);

  const copyPageBrief = async () => {
    if (!pageBrief) return;
    try {
      await navigator.clipboard.writeText(pageBrief);
      setBriefCopied(true);
      window.setTimeout(() => setBriefCopied(false), 1800);
    } catch {
      setBriefCopied(false);
    }
  };

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="Главная БАР"><Image src="/seomeat-logo.svg" alt="SEO Meat" width={152} height={16} priority /><span><b>БАР</b><small>Бесплатный анализ релевантности</small></span></Link>
      <nav className={styles.headerRight} aria-label="Ссылки проекта"><Link href="/">Главная БАР</Link><a href="https://seomeat.ru/" target="_blank" rel="noreferrer">Школа SEO Мясо ↗</a><a href="https://t.me/closedchannelkotenkov" target="_blank" rel="noreferrer">ТГК школы ↗</a><a href="https://t.me/seokotenkov" target="_blank" rel="noreferrer">Создатель ↗</a><span className={styles.live}><i />Сервис работает</span></nav>
    </header>

    <div className={styles.shell}>
      {!result && <>
        <section className={styles.intro}><span className={styles.eyebrow}>Мультиязычный семантический анализ</span><h1>Сравните страницу с реальными конкурентами из поиска</h1><p>Запрос выдачи определяет конкурентов. Ключи анализа и списки исключений можно менять после расчёта — повторно искать и загружать страницы не потребуется.</p></section>
        <form className={styles.form} onSubmit={submit}>
          <section className={styles.card}>
            <div className={styles.cardHead}><div><span className={styles.step}>01 · Корпус</span><h2>Запрос для поиска конкурентов</h2></div><span className={styles.subtle}>количество задаёте вы</span></div>
            <aside className={`${styles.integrationCard} ${serverConfigured === false ? styles.integrationRequired : ""}`} aria-label="Подключение XMLRiver">
              <div className={styles.integrationCardHead}>
                <div><strong>XMLRiver — обязательный источник выдачи</strong><p>Получает реальные результаты Яндекса или Google и формирует список конкурентов. Без доступа БАР не сможет собрать корпус для сравнения.</p></div>
                {serverConfigured === false && <a href="https://xmlriver.com/" target="_blank" rel="noreferrer">Подключить XMLRiver ↗</a>}
              </div>
              <p className={`${styles.connectionStatus} ${serverConfigured ? styles.connectionReady : serverConfigured === false ? styles.connectionMissing : ""}`} role="status"><i />{serverConfigured === null ? "Проверяем обязательное подключение…" : serverConfigured ? "Подключён на сервере — поиск конкурентов доступен" : "Не подключён — введите ID и ключ ниже"}</p>
              {serverConfigured === false && <div className={styles.credentialsBody}><label className={styles.field}><span>ID пользователя</span><input className={styles.input} autoComplete="username" value={xmlUser} onChange={(event) => setXmlUser(event.target.value)} placeholder="user" /></label><label className={styles.field}><span>Ключ XMLRiver</span><input className={styles.input} type="password" autoComplete="current-password" value={xmlKey} onChange={(event) => setXmlKey(event.target.value)} placeholder="••••••••••••" /></label><small>Доступ хранится только до закрытия этой вкладки.</small></div>}
            </aside>
            <label className={styles.field}><span>Запрос поисковой выдачи</span><input className={styles.input} required value={serpQuery} onChange={(event) => setSerpQuery(event.target.value)} placeholder="Например: seo курсы" /><small>По нему XMLRiver найдёт состав конкурентов.</small></label>
            <label className={styles.field}><span>Ключи для анализа</span><textarea className={`${styles.textarea} ${styles.keysTextarea}`} value={analysisKeys} onChange={(event) => setAnalysisKeys(event.target.value)} placeholder={'seo курсы\nобучение seo, курсы продвижения'} maxLength={3200} /><small>До 20 фраз через запятую или с новой строки. Если оставить пустым, используется запрос выдачи.</small></label>
            <div className={styles.queryGrid}>
              <label className={styles.field}><span>Язык контента</span><select className={styles.input} value={language} onChange={(event) => selectLanguage(event.target.value)}><option value="auto">Автоопределение</option>{LANGUAGE_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label} · {option.code.toUpperCase()} · {option.morphology === "lemmatization" ? "лемматизация" : option.morphology === "stemming" ? "стемминг" : "без морфологии"}</option>)}</select><small>{language === "auto" ? "Автоязык учитывает HTML lang, доминирующую письменность, характерные буквы и локальные стоп-слова. Для близких языков одной письменности точнее указать язык вручную." : `${languageCapability(language)?.morphologyLabel}; ${languageCapability(language)?.stopwordLabel}.`}</small></label>
              <label className={styles.field}><span>Поисковая система</span><select className={styles.input} value={engine} onChange={(event) => { const next = event.target.value as SearchEngine; setEngine(next); setCountryCode("RU"); setRegion(""); setCountryOptions([]); setRegionOptions([]); }}><option value="yandex">Яндекс</option><option value="google">Google</option></select></label>
              <label className={styles.field}><span>Страна</span><select className={styles.input} value={countryCode} disabled={!countryOptions.length} onChange={(event) => { setCountryCode(event.target.value); setRegion(""); setRegionOptions([]); }}>{!countryOptions.length && <option value="">Загружаем страны…</option>}{countryOptions.map((option) => <option key={`${option.engine}-${option.countryCode}`} value={option.countryCode}>{option.name} · {option.countryCode}</option>)}</select><small>Сначала выберите страну — следующее поле покажет только её регионы.</small></label>
              <label className={styles.field}><span>Город или регион</span><input className={styles.input} required list={`xmlriver-regions-${engine}-${countryCode}`} value={region} onChange={(event) => setRegion(event.target.value)} placeholder="Начните вводить название" /><datalist id={`xmlriver-regions-${engine}-${countryCode}`}>{availableRegionOptions.map((option) => <option key={`${option.engine}-${option.id}`} value={option.label} />)}</datalist><small>{availableRegionOptions.length ? "Выберите город, регион или всю страну из подсказок XMLRiver." : region.trim() ? "Ищем совпадения внутри выбранной страны…" : "После выбора страны начните вводить город или регион."}</small></label>
              <label className={styles.field}><span>Устройство</span><select className={styles.input} value={device} onChange={(event) => setDevice(event.target.value as Device)}><option value="desktop">Компьютер</option><option value="mobile">Телефон</option><option value="tablet">Планшет</option></select></label>
              <label className={styles.field}><span>Конкурентов</span><input className={styles.input} type="number" min={1} step={1} value={competitorCount} onChange={(event) => setCompetitorCount(Math.max(1, Math.trunc(Number(event.target.value) || 1)))} /></label>
            </div>
          </section>
          <section className={styles.card}>
            <div className={styles.cardHead}><div><span className={styles.step}>02 · Своя страница</span><h2>Что сравниваем</h2></div><span className={styles.subtle}>URL или готовый текст</span></div>
            <aside className={styles.integrationCard} aria-label="Подключение Firecrawl">
              <div className={styles.integrationCardHead}>
                <div><strong>Firecrawl — дополнительный fallback</strong><p>Если обычная HTTP-загрузка упирается в защиту или заглушку, Firecrawl автоматически пробует получить полноценную страницу. Это может заметно повысить долю успешно разобранных конкурентов.</p></div>
                {firecrawlConfigured === false && <a href="https://www.firecrawl.dev/" target="_blank" rel="noreferrer">Подключить Firecrawl ↗</a>}
              </div>
              <p className={`${styles.connectionStatus} ${firecrawlConfigured ? styles.connectionReady : firecrawlConfigured === false ? styles.connectionOptional : ""}`} role="status"><i />{firecrawlConfigured === null ? "Проверяем дополнительное подключение…" : firecrawlConfigured ? "Подключён — fallback включается автоматически после неудачной обычной загрузки" : "Не подключён — обычная загрузка продолжит работать без fallback"}</p>
            </aside>
            <PageEditor draft={ownPage} onChange={setOwnPage} />
          </section>
          <section className={`${styles.card} ${styles.stopCard}`}>
            <div className={styles.cardHead}><div><span className={styles.step}>03 · Исключения</span><h2>Стоп-слова и стоп-фразы</h2></div><span className={styles.subtle}>необязательно</span></div>
            <StopFields language={language} stopWords={stopWords} stopPhrases={stopPhrases} setStopWords={setStopWords} setStopPhrases={setStopPhrases} />
          </section>
          {error && <div className={styles.error} role="alert">{error}</div>}
          {loading ? <div className={styles.loading} role="status"><span className={styles.spinner} /><div><strong>Выполняем анализ</strong><span>{loadingText}</span></div></div> : <div className={styles.actions}><p>Автоязык учитывает HTML lang и письменность текста. Недоступные страницы будут отмечены.</p><button className={styles.primary} type="submit" title="Найти конкурентов в выдаче и построить семантический отчёт" disabled={!canAnalyze}>Найти и проанализировать <span>→</span></button></div>}
        </form>
      </>}

      {result && <section id="report" className={styles.report}>
        <div className={styles.resultTop}>
          <div><span className={styles.eyebrow}>Семантический отчёт</span><h1>{result.meta.serpQuery}</h1><p>Корпус рассчитан {new Date(result.meta.analyzedAt).toLocaleString("ru-RU")}</p></div>
          <div className={styles.resultActions}><button className={styles.ghostButton} type="button" title="Вернуться к настройкам и заново собрать корпус конкурентов" onClick={refreshCompetitors}>↻ Обновить конкурентов</button><button className={styles.exportButton} type="button" title="Открыть системную печать для сохранения отчёта в PDF" onClick={() => window.print()}>Экспорт PDF</button></div>
        </div>

        <section className={styles.keyEditor} aria-label="Ключи анализа">
          <div className={styles.keyEditorCopy}><span className={styles.step}>Настройки этого отчёта</span><h2>Пересчитать на том же корпусе</h2><p>Ключи, стоп-слова и стоп-фразы применятся к уже загруженным страницам. Поиск конкурентов и сетевые запросы повторно не запускаются.</p></div>
          <div className={styles.recalcInputs}>
            <label className={styles.field}><span>Ключевые фразы</span><textarea className={`${styles.textarea} ${styles.reportKeysTextarea}`} value={analysisKeys} onChange={(event) => setAnalysisKeys(event.target.value)} placeholder={result.meta.serpQuery} /><small>{currentKeys.length} из 20 ключей · запятая или новая строка</small></label>
            <StopFields compact language={result.meta.language} stopWords={stopWords} stopPhrases={stopPhrases} setStopWords={setStopWords} setStopPhrases={setStopPhrases} />
          </div>
          <button className={styles.recalculateButton} type="button" title="Применить новые ключи и стоп-термы к уже загруженному корпусу без повторного парсинга" onClick={recalculate} disabled={loading || !snapshotIsCurrent || !currentKeys.length}>{loading ? "Пересчитываем…" : "Пересчитать отчёт"}</button>
        </section>

        {!snapshotIsCurrent && <div className={styles.legacySnapshot} role="alert"><div><strong>Сохранённый корпус нужно обновить</strong><p>Этот отчёт можно просматривать, но пересчёт требует актуальный snapshot v5.</p></div><button type="button" onClick={refreshCompetitors}>Обновить конкурентов</button></div>}
        {loading && <div className={styles.loading} role="status"><span className={styles.spinner} /><div><strong>Обновляем отчёт</strong><span>{loadingText}</span></div></div>}
        {error && <div className={styles.error} role="alert">{error}</div>}

        <div className={styles.contextBar} aria-label="Параметры отчёта" title="Условия, на которых собран и рассчитан текущий отчёт">
          <span>{result.meta.engine === "google" ? "Google" : "Яндекс"}</span>{result.meta.region && <span>Регион {result.meta.region}</span>}
          <span>{result.meta.device === "mobile" ? "Телефон" : result.meta.device === "tablet" ? "Планшет" : "Компьютер"}</span>
          <span>Язык: {result.meta.languageLabel} · {result.meta.language.toUpperCase()}</span>
          <span>Слова: {result.meta.morphologyLabel ?? (result.meta.morphologyMode === "lemmatization" ? "Словарная лемматизация" : result.meta.morphologyMode === "stemming" ? "Стемминг Snowball" : "Без склейки словоформ")}</span><span>Ключей: {result.meta.queries.length}</span>
          {!!result.meta.stopWords?.length && <span>Доп. стоп-слов: {integer.format(result.meta.stopWords.length)}</span>}{!!result.meta.stopPhrases?.length && <span>Доп. стоп-фраз: {integer.format(result.meta.stopPhrases.length)}</span>}
          <span>Найдено {integer.format(result.meta.competitorsFound)}</span><span>В расчёте {integer.format(result.meta.competitorsAnalyzed)}</span>
          <span className={result.meta.confidence === "high" ? styles.confidenceHigh : result.meta.confidence === "medium" ? styles.confidenceMedium : styles.confidenceLow}>Надёжность: {result.meta.confidence === "high" ? "высокая" : result.meta.confidence === "medium" ? "средняя" : "низкая"}</span>
        </div>

        {result.warnings.length > 0 && <details className={styles.warning} title="Страницы, исключённые из корпуса из-за ошибки загрузки или признаков антибот-заглушки"><summary>Не вошли в расчёт: {integer.format(result.warnings.length)} {result.warnings.length === 1 ? "страница" : "страницы"}</summary><ul>{result.warnings.map((warning) => <li key={`${warning.position}-${warning.name}-${warning.error}`}><b>{warning.position ? `${integer.format(warning.position)}. ` : ""}{warning.name}</b> — {warning.error}</li>)}</ul></details>}

        <div className={styles.summaryMetrics} aria-label="Сводка нашей страницы и средние показатели конкурентов">
          <div className={styles.metricGrid}>
            <Metric label="TF-IDF ключей" value={percent(result.summary.keyTfidfScore)} benchmark={competitorDocuments.length ? percent(competitorMetricAverages.keyTfidfScore) : undefined} note={`сырой вес ${number.format(result.summary.keyTfidfRaw)} · справа среднее конкурентов`} tooltip="Оценка заметности введённых ключей по TF-IDF. После «из» показано среднее значение принятых конкурентов." />
            <Metric label="Взвешенный охват" value={percent(result.summary.weightedCoverage)} benchmark={competitorDocuments.length ? percent(competitorMetricAverages.weightedCoverage) : undefined} note="доля важных терминов и фраз · справа среднее конкурентов" tooltip="Штучный охват важных лемм и фраз: терм засчитывается, если присутствует хотя бы один раз. После «из» показано среднее конкурентов." />
            <Metric label="Взвешенная плотность" value={percent(result.summary.weightedDensity)} benchmark={competitorDocuments.length ? percent(competitorMetricAverages.weightedDensity) : undefined} note="выполнение ориентиров · справа среднее конкурентов" tooltip="Выполнение ориентиров по числу вхождений каждого важного терма. После «из» показано среднее конкурентов." />
          </div>
          <div className={styles.volumeMetric}><Metric label="Объём текста" value={integer.format(result.summary.ownWords)} note={`медиана конкурентов ${integer.format(result.summary.medianWords)}`} tooltip="Количество слов на вашей странице. Для устойчивого ориентира объёма здесь используется медиана конкурентов." /></div>
        </div>

        <section className={styles.reportSection}>
          <div className={styles.sectionHead}><div><span className={styles.sectionIndex}>01</span><div className={styles.titleWithHelp}><h2>Леммы и важность</h2><HelpTip text="Здесь словоформы объединены в леммы, чтобы сравнивать смысловые термы, а не отдельные окончания." /></div><p><b>Важность — оценка 0–100.</b> Она учитывает TF-IDF, число документов с леммой и подтверждение в ключах и заголовках. Точные коэффициенты не показываются.</p></div><button className={styles.download} type="button" title="Скачать текущую таблицу лемм со всеми строками и выбранной зоной" onClick={() => downloadCsv("terms.csv", sortedTerms.map((row) => ({ Лемма: row.term, Словоформы: row.forms.join(", "), Зона: ZONES.find((item) => item.key === activeZone)?.label, "Входит в ключ": row.keywordHit ? "Да" : "Нет", Документы: countUp(row.sites), "У нас": countUp(row.ownCount), Ориентир: countUp(row.medianCount), Q25: countUp(row.q25), Q75: countUp(row.q75), Важность: row.importance, Действие: row.status })))}>Скачать CSV</button></div>
          <div className={styles.zoneTabs} role="tablist" aria-label="Зона анализа лемм">{ZONES.map((zone) => <button key={zone.key} type="button" role="tab" aria-selected={activeZone === zone.key} className={activeZone === zone.key ? styles.activeZone : ""} title={zone.hint} onClick={() => selectZone(zone.key)}>{zone.label}</button>)}</div>
          <div className={styles.comparisonTop}>
            <div><h3>Сравнение вхождений по леммам</h3><p>{ZONES.find((item) => item.key === activeZone)?.hint} · абсолютные целые вхождения · единая шкала от нуля</p></div>
            <label className={styles.competitorSelect}><span>Конкурент для сравнения</span><select title="Выберите конкурента для третьей серии на графике" value={selectedProfile?.id ?? ""} disabled={!comparisonProfiles.length} onChange={(event) => setSelectedCompetitorId(event.target.value)}>{!comparisonProfiles.length && <option value="">Профили недоступны</option>}{comparisonProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.position ? `№${integer.format(profile.position)} · ` : ""}{hostLabel(profile.url)}</option>)}</select></label>
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
          {chartLimit < visibleTerms.length && <div className={styles.chartMore}><button type="button" title="Добавить на график следующие 12 лемм" onClick={() => setChartLimit((value) => value + CHART_PAGE_SIZE)}>Показать ещё 12 <span>{integer.format(visibleTerms.length - chartLimit)} осталось</span></button></div>}
          <div className={styles.tableTools}><FilterButtons value={termFilter} onChange={(value) => { setTermFilter(value); setTermPage(1); setChartLimit(CHART_PAGE_SIZE); }} /><input className={styles.search} title="Фильтровать таблицу по лемме или любой найденной словоформе" value={termSearch} onChange={(event) => { setTermSearch(event.target.value); setTermPage(1); setChartLimit(CHART_PAGE_SIZE); }} placeholder="Лемма или словоформа" aria-label="Поиск по леммам" /></div>
          <div className={styles.tableWrap}><table className={`${styles.table} ${styles.lemmaTable}`}>
            <thead><tr><SortableHeader label="Лемма / формы" sortKey="term" state={termSort} onSort={(state) => { setTermSort(state); setTermPage(1); }} /><SortableHeader label="Документы" sortKey="sites" state={termSort} onSort={(state) => { setTermSort(state); setTermPage(1); }} numeric /><SortableHeader label="У нас" sortKey="ownCount" state={termSort} onSort={(state) => { setTermSort(state); setTermPage(1); }} numeric /><SortableHeader label="Ориентир" sortKey="medianCount" state={termSort} onSort={(state) => { setTermSort(state); setTermPage(1); }} numeric /><SortableHeader label="Важность" sortKey="importance" state={termSort} onSort={(state) => { setTermSort(state); setTermPage(1); }} numeric /><SortableHeader label="Действие" sortKey="status" state={termSort} onSort={(state) => { setTermSort(state); setTermPage(1); }} /></tr></thead>
            <tbody>{pagedTerms.map((row) => <tr key={row.key}>
              <td className={styles.termCell}><div className={styles.termTitle}><strong>{row.term}</strong>{row.keywordHit && <span className={styles.keywordBadge}>ключ</span>}</div><small>{row.forms.filter((form) => form !== row.term).slice(0, 5).join(" · ") || "основная форма"}</small></td>
              <td><b>{integer.format(countUp(row.sites))} из {integer.format(result.meta.competitorsAnalyzed)}</b></td>
              <td><b>{integer.format(countUp(row.ownCount))}</b><small>вхождений</small></td>
              <td><b>{integer.format(countUp(row.medianCount))}</b><small>{integer.format(countUp(row.q25))}–{integer.format(countUp(row.q75))}</small></td>
              <td><b>{number.format(row.importance)}</b></td>
              <td><Status value={row.status} /></td>
            </tr>)}</tbody>
          </table></div>
          <Pagination page={safeTermPage} pages={termPages} total={visibleTerms.length} setPage={setTermPage} />
        </section>

        <section className={styles.reportSection} aria-labelledby="clouds-heading">
          <div className={styles.sectionHead}><div><span className={styles.sectionIndex}>02</span><div className={styles.titleWithHelp}><h2 id="clouds-heading">Облако</h2><HelpTip text="Три облака используют одну шкалу размеров, поэтому слова можно сравнивать между колонками напрямую." /></div><p>Среднее по конкурентам, наша страница и выбранный конкурент всегда видны рядом. Размер слова отражает частоту в выбранной HTML-зоне.</p></div></div>
          <div className={styles.cloudStage}>
            <div className={styles.cloudToolbar}>
              <div className={styles.zoneTabs} role="tablist" aria-label="HTML-зона облаков слов">{CLOUD_ZONES.map((zone) => <button key={zone.key} type="button" role="tab" aria-selected={cloudZone === zone.key} aria-label={`Показать облака слов: ${zone.hint}`} className={cloudZone === zone.key ? styles.activeZone : ""} title={zone.hint} onClick={() => setCloudZone(zone.key)}>{zone.label}</button>)}</div>
              <label className={styles.competitorSelect}><span>Конкурент в третьем облаке</span><select title="Выберите отдельного конкурента для сравнения со средним и вашей страницей" aria-label="Выбрать конкурента для третьего облака слов" value={selectedProfile?.id ?? ""} disabled={!comparisonProfiles.length} onChange={(event) => setSelectedCompetitorId(event.target.value)}>{!comparisonProfiles.length && <option value="">Профили недоступны</option>}{comparisonProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.position ? `№${integer.format(profile.position)} · ` : ""}{hostLabel(profile.url)}</option>)}</select></label>
            </div>
            <div className={styles.cloudGrid} role="group" aria-label={`Сравнение облаков слов: ${cloudZoneHint}`}>
              <Cloud title="Среднее конкурентов" note={`${integer.format(result.meta.competitorsAnalyzed)} страниц · ${cloudZoneHint}`} words={aggregateCloud} maxFrequency={cloudMax} />
              <Cloud title="Наша страница" note={`${cloudZoneHint}${cloudZone === "all" ? ` · ${integer.format(result.summary.ownWords)} слов` : ""}`} words={ownCloud} maxFrequency={cloudMax} own />
              <Cloud title={selectedProfile ? hostLabel(selectedProfile.url) : "Выбранный конкурент"} note={selectedProfile ? `${selectedProfile.position ? `Позиция ${integer.format(selectedProfile.position)} · ` : ""}${cloudZoneHint}` : `Нет профиля · ${cloudZoneHint}`} words={selectedCloud} maxFrequency={cloudMax} />
            </div>
          </div>
        </section>

        <section className={styles.reportSection}>
          <div className={styles.sectionHead}><div><span className={styles.sectionIndex}>03</span><div className={styles.titleWithHelp}><h2>N-граммы и связь с ключами</h2><HelpTip text="N-граммы — устойчивые фразы из нескольких слов, найденные на страницах корпуса." /></div><p><b>Важность — оценка 0–100.</b> Сначала учитываются распространённость фразы у конкурентов и смысловая связь с ключами, затем — подтверждение в ключе и Title/H1–H6. Точные коэффициенты не показываются. Модель связи: <b>{result.meta.phraseSimilarityMethod || "локальный резервный алгоритм"}</b>.</p></div><button className={styles.download} type="button" title="Скачать текущую таблицу N-грамм со всеми строками и выбранной зоной" onClick={() => downloadCsv("ngrams.csv", sortedNgrams.map((row) => ({ Фраза: row.phrase, Варианты: row.forms.join(", "), "Вложенные фразы": (row.nestedChildren ?? []).map((child) => child.phrase).join(", "), Зона: ZONES.find((item) => item.key === ngramZone)?.label, "Попадание в ключ": ngramKeyMark(row, currentKeys) || "—", Документы: countUp(row.sites), "У нас": countUp(row.ownCount), Ориентир: countUp(row.medianCount), Q25: countUp(row.q25), Q75: countUp(row.q75), Важность: row.importance, Действие: row.status })))}>Скачать CSV</button></div>
          <div className={styles.zoneTabs} role="tablist" aria-label="Зона анализа N-грамм">{ZONES.map((zone) => <button key={zone.key} type="button" role="tab" aria-selected={ngramZone === zone.key} className={ngramZone === zone.key ? styles.activeZone : ""} title={zone.hint} onClick={() => { setNgramZone(zone.key); setNgramPage(1); }}>{zone.label}</button>)}</div>
          <div className={styles.tableTools}><FilterButtons value={ngramFilter} onChange={(value) => { setNgramFilter(value); setNgramPage(1); }} /><input className={styles.search} title="Фильтровать таблицу по фразе, её варианту или входному ключу" value={ngramSearch} onChange={(event) => { setNgramSearch(event.target.value); setNgramPage(1); }} placeholder="Фраза или входной ключ" aria-label="Поиск по N-граммам" /></div>
          <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><SortableHeader label="Фраза / варианты" sortKey="phrase" state={ngramSort} onSort={(state) => { setNgramSort(state); setNgramPage(1); }} /><SortableHeader label="Попадание в ключ" sortKey="keyMark" state={ngramSort} onSort={(state) => { setNgramSort(state); setNgramPage(1); }} numeric /><SortableHeader label="Документы" sortKey="sites" state={ngramSort} onSort={(state) => { setNgramSort(state); setNgramPage(1); }} numeric /><SortableHeader label="У нас" sortKey="ownCount" state={ngramSort} onSort={(state) => { setNgramSort(state); setNgramPage(1); }} numeric /><SortableHeader label="Ориентир" sortKey="medianCount" state={ngramSort} onSort={(state) => { setNgramSort(state); setNgramPage(1); }} numeric /><SortableHeader label="Важность" sortKey="importance" state={ngramSort} onSort={(state) => { setNgramSort(state); setNgramPage(1); }} numeric /><SortableHeader label="Действие" sortKey="status" state={ngramSort} onSort={(state) => { setNgramSort(state); setNgramPage(1); }} /></tr></thead>
            <tbody>{pagedNgrams.map((row) => { const keyMark = ngramKeyMark(row, currentKeys); return <tr key={row.key}><td className={styles.termCell}><strong>{row.phrase}</strong><small>{row.forms.filter((form) => form !== row.phrase).slice(0, 3).join(" · ") || "основная форма"}</small>{!!row.nestedChildren?.length && <span className={styles.nestedChildren}>Включает: {row.nestedChildren.map((child) => `${child.phrase} · ${child.occurrences}`).join("; ")}</span>}</td><td>{keyMark ? <span className={`${styles.keywordBadge} ${keyMark === "Возможно ключ" ? styles.possibleKeywordBadge : ""}`}>{keyMark}</span> : <span aria-label="Нет связи с ключом">—</span>}</td><td><b>{integer.format(countUp(row.sites))} из {integer.format(result.meta.competitorsAnalyzed)}</b></td><td><b>{integer.format(countUp(row.ownCount))}</b><small>вхождений в зоне</small></td><td><b>{integer.format(countUp(row.medianCount))}</b><small>{integer.format(countUp(row.q25))}–{integer.format(countUp(row.q75))}</small></td><td><b>{number.format(row.importance)}</b></td><td><Status value={row.status} /></td></tr>; })}</tbody>
          </table></div><Pagination page={safeNgramPage} pages={ngramPages} total={visibleNgrams.length} setPage={setNgramPage} />
        </section>

        <section className={styles.reportSection}>
          <div className={styles.sectionHead}><div><span className={styles.sectionIndex}>04</span><div className={styles.titleWithHelp}><h2>Сравнение документов по метрикам</h2><HelpTip text="Сопоставление вашей страницы с каждым принятым конкурентом по одинаковым метрикам." /></div><p>Кликните по названию колонки, чтобы сравнить документы по нужной метрике. Взвешенная плотность показывает выполнение ориентиров по вхождениям важных лемм и фраз.</p></div></div>
          <div className={styles.documentTable} role="table" aria-label="Сравнение документов по метрикам">
            <div className={styles.documentHeader} role="row"><DocumentSortableHeader label="SERP" sortKey="position" state={documentSort} onSort={setDocumentSort} numeric /><DocumentSortableHeader label="Документ" sortKey="name" state={documentSort} onSort={setDocumentSort} /><DocumentSortableHeader label="TF-IDF ключей" sortKey="keyTfidfScore" state={documentSort} onSort={setDocumentSort} numeric /><DocumentSortableHeader label="Взвешенный охват" sortKey="weightedCoverage" state={documentSort} onSort={setDocumentSort} numeric /><DocumentSortableHeader label="Взвешенная плотность" sortKey="weightedDensity" state={documentSort} onSort={setDocumentSort} numeric /><DocumentSortableHeader label="Слов" sortKey="words" state={documentSort} onSort={setDocumentSort} numeric /></div>
            {sortedDocuments.map((doc, index) => <div className={`${styles.documentRow} ${doc.ours ? styles.ownDocument : ""}`} role="row" key={`${doc.url}-${index}`}><span className={styles.serpPosition}>{doc.ours ? "—" : doc.position ?? "—"}</span><div className={styles.documentName}><strong>{doc.ours ? "Наша страница" : doc.title || doc.name}</strong>{doc.url ? <a href={doc.url} target="_blank" rel="noreferrer">{hostLabel(doc.url)}</a> : <span>вставленный текст</span>}{doc.truncated && <em>частично загружена</em>}</div><div className={styles.docValue}><b>{percent(doc.keyTfidfScore)}</b><small>сырой вес {number.format(doc.keyTfidfRaw)}</small></div><div className={styles.docValue}><b>{percent(doc.weightedCoverage)}</b><small>важные термины и фразы</small></div><div className={styles.docValue}><b>{percent(doc.weightedDensity)}</b><small>выполнение ориентиров</small></div><div className={styles.docValue}><b>{integer.format(doc.words)}</b><small>{integer.format(doc.uniqueTerms)} уникальных</small></div></div>)}
          </div>
        </section>

        <section className={styles.reportSection}>
          <div className={styles.sectionHead}><div><span className={styles.sectionIndex}>05</span><div className={styles.titleWithHelp}><h2>Количество слов</h2><HelpTip text="Диапазон Q25–Q75 отбрасывает крайние короткие и длинные страницы и показывает центральные 50% конкурентов." /></div><p>Рекомендуемый диапазон — центральные 50% конкурентов.</p></div><div className={styles.rangeSummary}><span>Рекомендуемый диапазон</span><b>{integer.format(result.summary.recommendedMin)}–{integer.format(result.summary.recommendedMax)}</b></div></div>
          <div className={styles.wordChart}><div className={styles.wordRange}><strong>Q25–Q75</strong><div><i style={{ left: `${result.summary.recommendedMin / wordMax * 100}%`, width: `${Math.max(0, result.summary.recommendedMax - result.summary.recommendedMin) / wordMax * 100}%` }} /></div><b>{integer.format(result.summary.recommendedMin)}–{integer.format(result.summary.recommendedMax)}</b></div>{result.documents.slice(0, 12).map((doc, index) => <div className={`${styles.wordRow} ${doc.ours ? styles.wordOwn : ""}`} key={`${doc.url}-words-${index}`}><strong title={doc.title || doc.name}>{doc.ours ? "Наша страница" : `${doc.position ? `${doc.position}. ` : ""}${hostLabel(doc.url)}`}</strong><div><i style={{ width: `${doc.words / wordMax * 100}%` }} /></div><b>{integer.format(doc.words)}</b></div>)}</div>
        </section>

        <section className={`${styles.reportSection} ${styles.briefSection}`} aria-labelledby="page-brief-heading">
          <div className={styles.sectionHead}><div><span className={styles.sectionIndex}>06</span><div className={styles.titleWithHelp}><h2 id="page-brief-heading">ТЗ для страницы</h2><HelpTip text="Готовый список правок можно вставить в редактор, задачу или передать другому агенту." /></div><p>Готовый Markdown сгруппирован по HTML-зонам. В каждой зоне сначала идут фразы, затем отдельные леммы; строки в рекомендуемом диапазоне не добавляются.</p></div><button className={styles.copyBrief} type="button" title="Скопировать всё ТЗ в формате Markdown" onClick={() => void copyPageBrief()} aria-live="polite">{briefCopied ? "Скопировано ✓" : "Копировать MD"}</button></div>
          <pre className={styles.briefMarkdown}><code>{pageBrief}</code></pre>
        </section>

        <details className={styles.methodology} title="Краткие определения показателей отчёта без публикации внутренних коэффициентов"><summary>Методика расчёта</summary><div><p>Метрики вычисляются локально по собранному мультиязычному корпусу и входным ключам.</p>{Object.values(result.methodology || {}).filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((description, index) => <p key={`${index}-${description}`}>{description}</p>)}</div></details>
        <footer className={styles.footer}><a className={styles.footerBrand} href="https://seomeat.ru/" target="_blank" rel="noreferrer" aria-label="Школа SEO Мясо"><Image src="/seomeat-logo.svg" alt="SEO Meat" width={152} height={16} /><span>БАР · Сделано в школе SEO Мясо</span></a><div className={styles.footerLinks}><a href="https://seomeat.ru/" target="_blank" rel="noreferrer">Школа ↗</a><a href="https://t.me/closedchannelkotenkov" target="_blank" rel="noreferrer">ТГК школы ↗</a><a href="https://t.me/seokotenkov" target="_blank" rel="noreferrer">Создатель ↗</a></div></footer>
      </section>}
    </div>
  </main>;
}
