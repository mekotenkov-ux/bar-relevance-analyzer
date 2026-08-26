import snowballFactory from "snowball-stemmers";
import * as stopwordModule from "stopword";
import type { PhraseSimilarityProvider, PhraseSimilarityResult } from "./phrase-similarity";
import { LANGUAGE_CONFIGS } from "./language-support";
import { initializeRussianMorphology, russianLemma } from "./russian-morphology";

export { LANGUAGE_CONFIGS } from "./language-support";

export type PageInput = { name?: string; url?: string; text?: string; position?: number; title?: string };
export type SearchContext = {
  engine?: "google" | "yandex";
  region?: string;
  device?: "desktop" | "tablet" | "mobile";
  found?: number;
};

export type CorpusSnapshot = {
  version: 5;
  id: string;
  createdAt: string;
  language: string;
  serpQuery: string;
  search: SearchContext;
  competitors: SerializedDocument[];
  own: SerializedDocument;
  warnings: AnalysisWarning[];
  phraseSimilarity?: SnapshotPhraseSimilarity;
};

type SnapshotPhraseSimilarity = {
  version: 1;
  engine: "e5";
  model: string;
  revision?: string;
  queries: string[];
  rows: Array<[key: string, label: string, score: number, bestQueryIndex: number]>;
};

type AnalyzeDependencies = {
  phraseSimilarity?: PhraseSimilarityProvider;
  assetOrigin?: string;
};

export type AnalyzeRequest = {
  query?: string;
  queries?: string[];
  serpQuery?: string;
  language?: string;
  ownPage?: PageInput;
  competitors?: PageInput[];
  snapshot?: CorpusSnapshot;
  search?: SearchContext;
  stopWords?: string | string[];
  stopPhrases?: string | string[];
};

type WarningCode = "fetch_failed" | "low_quality" | "corpus_anomaly" | "analysis_failed";
type AnalysisWarning = {
  name: string;
  url?: string;
  position?: number;
  code: WarningCode;
  error: string;
  source?: "http" | "firecrawl" | "text";
};
type Token = { surface: string; key: string; stop: boolean; meaningful: boolean };
type FormCounts = Map<string, Map<string, number>>;
type PhraseForms = Map<string, Map<string, number>>;
type NgramNestingCount = {
  total: number;
  standalone: number;
  parents: Map<string, number>;
};
type NgramNestingCounts = Map<string, NgramNestingCount>;
type SerializedNgramNestingCounts = Array<[
  key: string,
  total: number,
  standalone: number,
  parents: Array<[key: string, count: number]>,
]>;
export const ANALYSIS_ZONES = ["all", "title", "h1", "headings", "text", "anchors"] as const;
export type AnalysisZone = typeof ANALYSIS_ZONES[number];
type PreparedZones = Record<AnalysisZone, { available: boolean; blocks: string[] }>;
type ZoneAnalysis = {
  available: boolean;
  wordCount: number;
  contentWordCount: number;
  termCounts: Map<string, number>;
  termForms: FormCounts;
  ngramCounts: Map<string, number>;
  ngramNesting: NgramNestingCounts;
};
type SerializedZoneAnalysis = Omit<ZoneAnalysis, "termCounts" | "termForms" | "ngramCounts" | "ngramNesting"> & {
  termCounts: Array<[string, number]>;
  termForms: Array<[string, Array<[string, number]>]>;
  ngramCounts: Array<[string, number]>;
  ngramNesting: SerializedNgramNestingCounts;
};
type PreparedPage = {
  name: string;
  url: string;
  position?: number;
  title: string;
  text: string;
  headings: number;
  truncated: boolean;
  htmlLanguage: string;
  source: "http" | "firecrawl" | "text";
  qualityScore: number;
  zones: PreparedZones;
};
type DocumentAnalysis = {
  name: string;
  url: string;
  position?: number;
  title: string;
  wordCount: number;
  contentWordCount: number;
  uniqueTerms: number;
  headings: number;
  sentences: number;
  truncated: boolean;
  source: "http" | "firecrawl" | "text";
  qualityScore: number;
  termCounts: Map<string, number>;
  termForms: FormCounts;
  ngramCounts: Map<string, number>;
  ngramForms: PhraseForms;
  ngramNesting: NgramNestingCounts;
  zones: Record<AnalysisZone, ZoneAnalysis>;
};
type SerializedDocument = Omit<DocumentAnalysis, "termCounts" | "termForms" | "ngramCounts" | "ngramForms" | "ngramNesting" | "zones"> & {
  termCounts: Array<[string, number]>;
  termForms: Array<[string, Array<[string, number]>]>;
  ngramCounts: Array<[string, number]>;
  ngramForms: Array<[string, Array<[string, number]>]>;
  ngramNesting: SerializedNgramNestingCounts;
  zones: Record<AnalysisZone, SerializedZoneAnalysis>;
};
type BaseRow = {
  key: string;
  label: string;
  forms: string[];
  counts: number[];
  frequencies: number[];
  sites: number;
  ownCount: number;
  ownFrequency: number;
  medianCount: number;
  medianFrequency: number;
  q25: number;
  q75: number;
  averageFrequency: number;
  idf: number;
  competitorTfidf: number;
  ownTfidf: number;
  status: "Добавить" | "Норма" | "Снизить";
};

const MAX_TEXT_LENGTH = 200_000;
const MAX_REMOTE_LENGTH = 2_000_000;
const MAX_FIRECRAWL_RESPONSE_LENGTH = 5_000_000;
const PAGE_PREPARE_CONCURRENCY = 4;
const DIRECT_PAGE_TIMEOUT_MS = 15_000;
const FIRECRAWL_TIMEOUT_MS = 30_000;
const MAX_QUERIES = 20;
const MAX_QUERY_LENGTH = 160;
const SNAPSHOT_TERMS = 4_000;
const SNAPSHOT_NGRAMS = 6_000;
const SNAPSHOT_NGRAM_PARENTS_PER_KEY = 20;
const SNAPSHOT_VERSION = 5;
const SNAPSHOT_PHRASE_SIMILARITIES_MAXIMUM = 100_000;
const SNAPSHOT_COMPETITORS_MAXIMUM = 500;
const SNAPSHOT_FORMS_PER_KEY = 5;
const SNAPSHOT_KEY_MAX_CHARACTERS = 256;
const SNAPSHOT_FORM_MAX_CHARACTERS = 256;
const SNAPSHOT_COUNT_MAXIMUM = 1_000_000;
const SNAPSHOT_WARNINGS_MAXIMUM = 1_000;
const TERM_ALIASES: Record<string, Record<string, string>> = {
  ru: { мес: "месяц" },
};
const canonicalAliasDisplayCache = new Map<string, Map<string, string>>();

const stopwordExports = stopwordModule as unknown as Record<string, readonly string[]>;
type LanguageStopwords = { single: Set<string>; phrases: string[][] };
const stopwordCache = new Map<string, LanguageStopwords>();
const stemmerCache = new Map<string, { stem: (value: string) => string }>();

function normalizeSurface(value: string, language: string) {
  let normalized: string;
  try { normalized = value.normalize("NFKC").toLocaleLowerCase(language); }
  catch { normalized = value.normalize("NFKC").toLowerCase(); }
  return normalized.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function languageStopwords(language: string) {
  const cached = stopwordCache.get(language);
  if (cached) return cached;
  const exportName = LANGUAGE_CONFIGS[language]?.stopwords;
  const words = exportName ? stopwordExports[exportName] ?? [] : [];
  const result: LanguageStopwords = { single: new Set<string>(), phrases: [] };
  const seenPhrases = new Set<string>();
  for (const word of words) {
    const parts = segmentWords(String(word), language)
      .map((part) => normalizeSurface(part, language))
      .filter(Boolean);
    if (parts.length === 1) {
      result.single.add(parts[0]);
      continue;
    }
    if (parts.length < 2) continue;
    const identity = parts.join("\u0000");
    if (seenPhrases.has(identity)) continue;
    seenPhrases.add(identity);
    result.phrases.push(parts);
  }
  stopwordCache.set(language, result);
  return result;
}

function languageStemmer(language: string) {
  const algorithm = LANGUAGE_CONFIGS[language]?.stemmer;
  if (!algorithm) return null;
  const cached = stemmerCache.get(algorithm);
  if (cached) return cached;
  try {
    const stemmer = snowballFactory.newStemmer(algorithm) as { stem: (value: string) => string };
    stemmerCache.set(algorithm, stemmer);
    return stemmer;
  } catch { return null; }
}

function segmentWords(text: string, language: string) {
  try {
    const segmenter = new Intl.Segmenter(language, { granularity: "word" });
    return [...segmenter.segment(text)].filter((part) => part.isWordLike).map((part) => part.segment);
  } catch {
    return text.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) ?? [];
  }
}

function tokenLength(value: string) { return Array.from(value).length; }
function oneCharacterWordsAllowed(language: string) { return ["zh", "ja", "ko", "th"].includes(language); }

function termKey(surface: string, language: string) {
  const canonicalSurface = TERM_ALIASES[language]?.[surface] ?? surface;
  // SEO is commonly typed with visually identical Latin/Cyrillic letters. Keep
  // the original surface form for display, but merge only this narrow acronym.
  if (/^[sс][eе][oо]$/u.test(canonicalSurface)) return "seo";
  if (language === "ru" && tokenLength(canonicalSurface) > 1 && /^\p{L}+$/u.test(canonicalSurface)) {
    const lemma = normalizeSurface(russianLemma(canonicalSurface), language) || canonicalSurface;
    return TERM_ALIASES[language]?.[lemma] ?? lemma;
  }
  const stemmer = languageStemmer(language);
  if (!stemmer || tokenLength(canonicalSurface) <= 3 || !/^\p{L}+$/u.test(canonicalSurface)) return canonicalSurface;
  try { return stemmer.stem(canonicalSurface) || canonicalSurface; }
  catch { return canonicalSurface; }
}

function tokenize(text: string, language: string) {
  const stopwords = languageStopwords(language);
  return segmentWords(text, language).map((raw): Token | null => {
    const surface = normalizeSurface(raw, language);
    if (!surface) return null;
    const meaningful = oneCharacterWordsAllowed(language) ? tokenLength(surface) >= 1 : tokenLength(surface) > 1;
    return { surface, key: termKey(surface, language), stop: stopwords.single.has(surface), meaningful };
  }).filter((token): token is Token => Boolean(token));
}

export function semanticTokenKeys(text: string, language: string) {
  return tokenize(text, language).map((token) => token.key);
}

export function semanticCandidateEntries(text: string, language: string) {
  const tokens = tokenize(text, language);
  const terms = countTerms(tokens);
  const ngrams = countNgrams(tokens);
  return {
    lemmas: [...terms.counts.keys()].map((key) => ({
      key,
      forms: [...(terms.forms.get(key)?.keys() ?? [])],
    })),
    ngrams: [...ngrams.counts.keys()].map((key) => ({
      key,
      forms: [...(ngrams.forms.get(key)?.keys() ?? [])],
    })),
  };
}

function contentTokens(tokens: Token[]) {
  return tokens.filter((token) => !token.stop && token.meaningful && !/^\d+$/u.test(token.surface));
}

function increment(map: Map<string, number>, key: string, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function addForm(forms: FormCounts, key: string, surface: string) {
  const variants = forms.get(key) ?? new Map<string, number>();
  increment(variants, surface);
  forms.set(key, variants);
}

function countTerms(tokens: Token[]) {
  const counts = new Map<string, number>();
  const forms: FormCounts = new Map();
  for (const token of contentTokens(tokens)) { increment(counts, token.key); addForm(forms, token.key, token.surface); }
  return { counts, forms };
}

function ngramAt(tokens: Token[], index: number, size: number) {
  if (index < 0 || index + size > tokens.length) return null;
  const slice = tokens.slice(index, index + size);
  if (slice.some((token) => token.stop || !token.meaningful || /^\d+$/u.test(token.surface))) return null;
  if (new Set(slice.map((token) => token.key)).size === 1) return null;
  return {
    key: slice.map((token) => token.key).join(" "),
    surface: slice.map((token) => token.surface).join(" "),
  };
}

function mergeNgramNesting(target: NgramNestingCounts, source: NgramNestingCounts) {
  for (const [key, evidence] of source) {
    const combined = target.get(key) ?? { total: 0, standalone: 0, parents: new Map<string, number>() };
    combined.total += evidence.total;
    combined.standalone += evidence.standalone;
    for (const [parent, count] of evidence.parents) increment(combined.parents, parent, count);
    target.set(key, combined);
  }
}

function countNgrams(tokens: Token[]) {
  const counts = new Map<string, number>();
  const forms: PhraseForms = new Map();
  const nesting: NgramNestingCounts = new Map();
  for (let size = 2; size <= 3; size += 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const current = ngramAt(tokens, index, size);
      if (!current) continue;
      increment(counts, current.key);
      addForm(forms, current.key, current.surface);
      if (size !== 2) continue;

      const evidence = nesting.get(current.key) ?? { total: 0, standalone: 0, parents: new Map<string, number>() };
      evidence.total += 1;
      const parentKeys = new Set<string>();
      const leftParent = ngramAt(tokens, index - 1, 3);
      const rightParent = ngramAt(tokens, index, 3);
      if (leftParent) parentKeys.add(leftParent.key);
      if (rightParent) parentKeys.add(rightParent.key);
      if (!parentKeys.size) evidence.standalone += 1;
      for (const parentKey of parentKeys) increment(evidence.parents, parentKey);
      nesting.set(current.key, evidence);
    }
  }
  return { counts, forms, nesting };
}

function sentenceBlocks(block: string, language: string) {
  try {
    return [...new Intl.Segmenter(language, { granularity: "sentence" }).segment(block)]
      .map((part) => part.segment.trim())
      .filter(Boolean);
  } catch {
    return block.split(/(?<=[.!?…])\s+|[\r\n]+/u).map((part) => part.trim()).filter(Boolean);
  }
}

function countNgramBlocks(blocks: string[], language: string) {
  const counts = new Map<string, number>();
  const forms: PhraseForms = new Map();
  const nesting: NgramNestingCounts = new Map();
  for (const block of blocks) {
    // N-grams are positional evidence inside a sentence. Crossing a full stop
    // would turn "Google Search. Console ..." into a false parent phrase.
    for (const sentence of sentenceBlocks(block, language)) {
      const current = countNgrams(tokenize(sentence, language));
      for (const [key, count] of current.counts) increment(counts, key, count);
      mergeForms(forms, current.forms);
      mergeNgramNesting(nesting, current.nesting);
    }
  }
  return { counts, forms, nesting };
}

function mergeForms(target: FormCounts, source: FormCounts) {
  for (const [key, variants] of source) {
    const combined = target.get(key) ?? new Map<string, number>();
    for (const [form, count] of variants) increment(combined, form, count);
    target.set(key, combined);
  }
}

function topForms(variants: Map<string, number> | undefined, language: string, limit = 4) {
  return [...(variants?.entries() ?? [])]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], language))
    .slice(0, limit).map(([form]) => form);
}

function canonicalAliasDisplay(key: string, language: string) {
  let displays = canonicalAliasDisplayCache.get(language);
  if (!displays) {
    displays = new Map<string, string>();
    const canonicalTargets = new Set(Object.values(TERM_ALIASES[language] ?? {}));
    for (const target of canonicalTargets) {
      const normalized = normalizeSurface(target, language);
      if (normalized) displays.set(termKey(normalized, language), normalized);
    }
    canonicalAliasDisplayCache.set(language, displays);
  }
  return displays.get(key);
}

function preferredForm(key: string, variants: Map<string, number> | undefined, queryForms: FormCounts, language: string) {
  return canonicalAliasDisplay(key, language)
    || topForms(queryForms.get(key), language, 1)[0]
    || topForms(variants, language, 1)[0]
    || key;
}

function decodeEntities(text: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", laquo: "«", raquo: "»" };
  return text.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}

function removeBlocks(html: string) {
  return html.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|canvas|nav|footer|aside|form|button|select|option|dialog)[^>]*>[\s\S]*?<\/\1>/gi, " ");
}

function markupBlocks(markup: string) {
  return decodeEntities(removeBlocks(markup)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|a|section|article|tr|td|th|blockquote|figure|figcaption)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split(/\n+/)
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter((line) => line.length >= 2);
}

function elementBlocks(markup: string, pattern: string) {
  const blocks: string[] = [];
  const expression = new RegExp(`<(?:${pattern})\\b[^>]*>([\\s\\S]*?)<\\/(?:${pattern})>`, "gi");
  for (const match of markup.matchAll(expression)) blocks.push(...markupBlocks(match[1]));
  return blocks;
}

function extractHtml(html: string) {
  const title = markupBlocks(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").join(" ");
  const htmlLanguage = (html.match(/<html[^>]+lang=["']?([^"'\s>]+)/i)?.[1] ?? "").toLowerCase().split(/[-_]/)[0];
  const headings = (html.match(/<h[1-6]\b/gi) ?? []).length;
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const main = body.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  const article = body.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const candidates = [main, article, body].filter((value): value is string => Boolean(value));
  let source = candidates[candidates.length - 1];
  for (const candidate of candidates) {
    const roughText = removeBlocks(candidate).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (roughText.length >= 800) { source = candidate; break; }
  }
  const header = body.match(/<header\b[^>]*>([\s\S]*?)<\/header>/i)?.[0];
  if (source !== body && header) source = `${header}\n${source}`;
  const cleanedSource = removeBlocks(source);
  const bodyBlocks = markupBlocks(cleanedSource);
  const h1Blocks = elementBlocks(cleanedSource, "h1");
  const headingBlocks = elementBlocks(cleanedSource, "h[2-6]");
  const anchorBlocks = elementBlocks(cleanedSource, "a");
  const textOnlyMarkup = cleanedSource
    .replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, " ")
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, " ");
  const textBlocks = markupBlocks(textOnlyMarkup);
  const titleBlocks = title ? [title] : [];
  const zones: PreparedZones = {
    all: { available: true, blocks: [...titleBlocks, ...bodyBlocks] },
    title: { available: true, blocks: titleBlocks },
    h1: { available: true, blocks: h1Blocks },
    headings: { available: true, blocks: headingBlocks },
    text: { available: true, blocks: textBlocks },
    anchors: { available: true, blocks: anchorBlocks },
  };
  return { title, text: bodyBlocks.join("\n"), headings, htmlLanguage, zones };
}

function limitPreparedZones(zones: PreparedZones): PreparedZones {
  return Object.fromEntries(ANALYSIS_ZONES.map((zone) => {
    const value = zones[zone];
    const limited = value.blocks.join("\n").slice(0, MAX_TEXT_LENGTH);
    return [zone, { available: value.available, blocks: limited ? limited.split(/\n+/) : [] }];
  })) as PreparedZones;
}

function plainTextZones(text: string): PreparedZones {
  const blocks = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return {
    all: { available: true, blocks },
    title: { available: false, blocks: [] },
    h1: { available: false, blocks: [] },
    headings: { available: false, blocks: [] },
    text: { available: true, blocks },
    anchors: { available: false, blocks: [] },
  };
}

type ExtractedHtml = ReturnType<typeof extractHtml>;
type QualityAssessment = {
  accepted: boolean;
  score: number;
  reason: string;
  visibleCharacters: number;
  words: number;
  uniqueWords: number;
};
type RawRemotePage = { html: string; finalUrl: string; truncated: boolean };
type LoadedRemotePage = RawRemotePage & {
  extracted: ExtractedHtml;
  quality: QualityAssessment;
  source: "http" | "firecrawl";
};

class UnsafeRemoteUrlError extends Error {
  constructor(message: string) { super(message); this.name = "UnsafeRemoteUrlError"; }
}

class PagePreparationError extends Error {
  constructor(
    readonly code: Extract<WarningCode, "fetch_failed" | "low_quality">,
    message: string,
    readonly source?: "http" | "firecrawl",
  ) { super(message); this.name = "PagePreparationError"; }
}

const CHALLENGE_MARKUP = [
  /(?:cf-chl|challenge-platform|cf-turnstile|cloudflare[-_ ]challenge)/i,
  /(?:g-recaptcha|h-captcha|data-sitekey|captcha-container)/i,
  /(?:checking[_-]your[_-]browser|browser[_-]check|anti[_-]bot)/i,
];
const STUB_TEXT = [
  /\b(?:just a moment|checking your browser|verify (?:that )?you are human|enable javascript(?: and cookies)?|access denied|request blocked|security check|service unavailable|temporarily unavailable|site under construction|coming soon|domain (?:is )?for sale|buy this domain)\b/i,
  /\b(?:403 forbidden|404 not found|502 bad gateway|503 service unavailable)\b/i,
  /(?:доступ (?:ограничен|запрещ[её]н)|провер(?:яем|ка) браузер|подтвердите[^.]{0,40}(?:не робот|человек)|включите javascript|страница не найдена|сайт временно недоступен|технические работы|ид[её]т проверка безопасности|домен прода[её]тся|купить этот домен)/i,
];

function qualityWords(text: string) {
  try {
    return [...new Intl.Segmenter("und", { granularity: "word" }).segment(text)]
      .filter((part) => part.isWordLike)
      .map((part) => part.segment.normalize("NFKC").toLowerCase());
  } catch { return (text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []); }
}

function assessPageQuality(html: string, extracted: ExtractedHtml): QualityAssessment {
  const text = extracted.text.replace(/\s+/g, " ").trim();
  const words = qualityWords(text).filter((word) => /\p{L}/u.test(word));
  const uniqueWords = new Set(words).size;
  const visibleCharacters = Array.from(text).filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
  const combinedStubText = `${extracted.title}\n${text.slice(0, 2_500)}`;
  const strongChallenge = CHALLENGE_MARKUP.some((pattern) => pattern.test(html.slice(0, 150_000)));
  const stubText = STUB_TEXT.some((pattern) => pattern.test(combinedStubText));
  const lines = extracted.text.split(/\n+/).map((line) => line.trim().toLowerCase()).filter(Boolean);
  const lineCounts = new Map<string, number>();
  for (const line of lines) increment(lineCounts, line);
  const repeatedLines = lines.length ? Math.max(...lineCounts.values()) / lines.length : 0;
  const repeatedDominated = repeatedLines > .55 && lines.length >= 6 && uniqueWords / Math.max(1, words.length) < .35;
  const scriptCharacters = (html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? []).reduce((sum, block) => sum + block.length, 0);
  const scriptDominated = html.length > 0 && scriptCharacters / html.length > .72 && words.length < 120;

  let score = 0;
  score += visibleCharacters >= 1_200 ? 40 : visibleCharacters >= 500 ? 28 : visibleCharacters >= 240 ? 14 : 0;
  score += words.length >= 140 ? 30 : words.length >= 70 ? 22 : words.length >= 35 ? 12 : 0;
  score += uniqueWords >= 80 ? 20 : uniqueWords >= 35 ? 14 : uniqueWords >= 18 ? 8 : 0;
  score += extracted.headings > 0 ? 5 : 0;
  if (strongChallenge) score -= 70;
  if (stubText && (words.length < 250 || visibleCharacters < 1_800)) score -= 55;
  if (scriptDominated) score -= 25;
  if (repeatedDominated) score -= 30;
  score = Math.max(0, Math.min(100, score));

  const hardMinimum = visibleCharacters >= 240 && words.length >= 35 && uniqueWords >= 18;
  const blockedStub = strongChallenge || (stubText && (words.length < 250 || visibleCharacters < 1_800));
  const accepted = hardMinimum && !blockedStub && !scriptDominated && !repeatedDominated && score >= 42;
  const reason = blockedStub
    ? "страница похожа на антибот-проверку или служебную заглушку"
    : !hardMinimum
      ? `слишком мало полезного текста (${words.length} слов, ${visibleCharacters} знаков)`
      : scriptDominated
        ? "получен преимущественно JavaScript без содержательного текста"
        : repeatedDominated
          ? "извлечённый текст состоит преимущественно из повторяющихся блоков"
          : `низкая оценка качества контента (${score}/100)`;
  return { accepted, score, reason, visibleCharacters, words: words.length, uniqueWords };
}

function isUnsafeHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1") return true;
  const parts = host.split(".").map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || parts[0] === 0;
  }
  return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || !host.includes(".");
}

function validateRemoteUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new UnsafeRemoteUrlError("Некорректный URL"); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new UnsafeRemoteUrlError("Поддерживаются только HTTP и HTTPS URL");
  if (url.username || url.password) throw new UnsafeRemoteUrlError("URL с логином или паролем не поддерживается");
  if (isUnsafeHost(url.hostname)) throw new UnsafeRemoteUrlError("Локальные и служебные адреса недоступны");
  if (url.port && !['80', '443'].includes(url.port)) throw new UnsafeRemoteUrlError("Нестандартные порты недоступны");
  return url;
}

async function fetchDirectPage(initialUrl: URL): Promise<RawRemotePage> {
  let url = initialUrl;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetch(url, { redirect: "manual", headers: { "User-Agent": "BAR-Relevance-Analyzer/3.0 (+https://seomeat.ru/)", Accept: "text/html,text/plain;q=0.9,*/*;q=0.1" }, signal: AbortSignal.timeout(DIRECT_PAGE_TIMEOUT_MS) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Сайт вернул перенаправление без адреса");
      url = validateRemoteUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Сайт вернул HTTP ${response.status}`);
    const type = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (type && !type.includes("text/html") && !type.includes("text/plain") && !type.includes("application/xhtml")) throw new Error("URL не ведёт на HTML или текстовую страницу");
    if (Number(response.headers.get("content-length") ?? 0) > MAX_REMOTE_LENGTH) throw new Error("Страница больше 2 МБ и не может быть обработана целиком");
    const body = await readResponseTextLimited(response, MAX_REMOTE_LENGTH);
    return { html: body.text, finalUrl: url.toString(), truncated: body.truncated };
  }
  throw new Error("Слишком много перенаправлений");
}

async function readResponseTextLimited(response: Response, maximumBytes: number) {
  const body = response.body;
  if (!body) return { text: "", truncated: false };
  const charset = response.headers.get("content-type")?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || "utf-8";
  let decoder: TextDecoder;
  try { decoder = new TextDecoder(charset); }
  catch { decoder = new TextDecoder("utf-8"); }
  const reader = body.getReader();
  const parts: string[] = [];
  let consumed = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) { parts.push(decoder.decode()); return { text: parts.join(""), truncated: false }; }
      if (!value?.byteLength) continue;
      const remaining = maximumBytes - consumed;
      if (value.byteLength > remaining) {
        if (remaining > 0) parts.push(decoder.decode(value.subarray(0, remaining), { stream: true }));
        await reader.cancel("response exceeded configured limit").catch(() => undefined);
        parts.push(decoder.decode());
        return { text: parts.join(""), truncated: true };
      }
      consumed += value.byteLength;
      parts.push(decoder.decode(value, { stream: true }));
    }
  } finally { reader.releaseLock(); }
}

function evaluatedRemotePage(page: RawRemotePage, source: "http" | "firecrawl"): LoadedRemotePage {
  const extracted = extractHtml(page.html);
  return { ...page, extracted, quality: assessPageQuality(page.html, extracted), source };
}

function firecrawlKey() {
  return (process.env.FIRECRAWL_API_KEY || process.env.FIRECRAWL)?.trim() ?? "";
}

async function fetchFirecrawlPage(url: URL, key: string): Promise<LoadedRemotePage> {
  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      url: url.toString(), formats: ["html", "rawHtml"], onlyMainContent: false,
      blockAds: true, removeBase64Images: true, maxAge: 0, storeInCache: false, timeout: FIRECRAWL_TIMEOUT_MS,
    }),
    signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS + 5_000),
  });
  if (Number(response.headers.get("content-length") ?? 0) > MAX_FIRECRAWL_RESPONSE_LENGTH) {
    throw new Error("ответ Firecrawl слишком большой");
  }
  const boundedBody = await readResponseTextLimited(response, MAX_FIRECRAWL_RESPONSE_LENGTH);
  if (boundedBody.truncated) throw new Error("ответ Firecrawl слишком большой");
  const raw = boundedBody.text;
  let payload: { success?: boolean; error?: string; data?: { html?: string; rawHtml?: string; metadata?: { sourceURL?: string; url?: string } } };
  try { payload = JSON.parse(raw) as typeof payload; }
  catch { throw new Error("Firecrawl вернул некорректный JSON"); }
  if (!response.ok || payload.success === false) throw new Error(payload.error?.trim() || `Firecrawl вернул HTTP ${response.status}`);
  const candidates = [payload.data?.html, payload.data?.rawHtml].filter((html): html is string => Boolean(html?.trim()));
  if (!candidates.length) throw new Error("Firecrawl не вернул HTML страницы");

  const assessed = candidates.map((html) => evaluatedRemotePage({
    html: html.slice(0, MAX_REMOTE_LENGTH), finalUrl: url.toString(), truncated: html.length > MAX_REMOTE_LENGTH,
  }, "firecrawl")).sort((left, right) => right.quality.score - left.quality.score);
  return assessed[0];
}

async function fetchPage(rawUrl: string, useFirecrawl: boolean): Promise<LoadedRemotePage> {
  const validatedUrl = validateRemoteUrl(rawUrl);
  let directFailure: Error | null = null;
  try {
    const direct = evaluatedRemotePage(await fetchDirectPage(validatedUrl), "http");
    if (direct.quality.accepted) return direct;
    directFailure = new PagePreparationError("low_quality", direct.quality.reason, "http");
  } catch (error) {
    if (error instanceof UnsafeRemoteUrlError) throw error;
    directFailure = error instanceof Error ? error : new Error("не удалось загрузить страницу напрямую");
  }

  const key = useFirecrawl ? firecrawlKey() : "";
  if (!key) {
    if (directFailure instanceof PagePreparationError) throw directFailure;
    throw new PagePreparationError("fetch_failed", `Не удалось загрузить страницу: ${directFailure?.message || "ошибка HTTP"}`, "http");
  }

  try {
    const fallback = await fetchFirecrawlPage(validatedUrl, key);
    if (fallback.quality.accepted) return fallback;
    throw new PagePreparationError("low_quality", `Firecrawl: ${fallback.quality.reason}`, "firecrawl");
  } catch (error) {
    if (error instanceof PagePreparationError) throw error;
    const directMessage = directFailure instanceof PagePreparationError
      ? directFailure.message
      : `прямая загрузка: ${directFailure?.message || "ошибка HTTP"}`;
    throw new PagePreparationError("fetch_failed", `${directMessage}; Firecrawl: ${error instanceof Error ? error.message : "ошибка загрузки"}`, "firecrawl");
  }
}

async function prepareInput(input: PageInput, fallbackName: string, useFirecrawl: boolean): Promise<PreparedPage> {
  let text = input.text?.trim() ?? "";
  let url = input.url?.trim() ?? "";
  let title = input.title?.trim() ?? "";
  let headings = 0;
  let truncated = false;
  let htmlLanguage = "";
  let source: PreparedPage["source"] = "text";
  let qualityScore = 100;
  let zones = plainTextZones(text);
  if (!text) {
    if (!url) throw new Error("Нужен URL или текст страницы");
    const fetched = await fetchPage(url, useFirecrawl);
    url = fetched.finalUrl;
    truncated = fetched.truncated;
    const extracted = fetched.extracted;
    title = title || extracted.title;
    text = extracted.text;
    headings = extracted.headings;
    htmlLanguage = extracted.htmlLanguage;
    source = fetched.source;
    qualityScore = fetched.quality.score;
    zones = fetched.extracted.zones;
  }
  if (text.length > MAX_TEXT_LENGTH) { text = text.slice(0, MAX_TEXT_LENGTH); truncated = true; }
  zones = limitPreparedZones(zones);
  if (text.length < 80) throw new Error("На странице слишком мало извлечённого текста");
  const name = input.name?.trim() || title || (url ? new URL(url).hostname : fallbackName);
  return { name, url, position: input.position, title, text, headings, truncated, htmlLanguage, source, qualityScore, zones };
}

async function prepareFirecrawlRetry(page: PreparedPage, key: string): Promise<PreparedPage> {
  if (!page.url) throw new PagePreparationError("fetch_failed", "Для повторной загрузки Firecrawl нужен URL", "firecrawl");
  const loaded = await fetchFirecrawlPage(validateRemoteUrl(page.url), key);
  if (!loaded.quality.accepted) throw new PagePreparationError("low_quality", `Firecrawl: ${loaded.quality.reason}`, "firecrawl");
  let text = loaded.extracted.text;
  let truncated = loaded.truncated;
  if (text.length > MAX_TEXT_LENGTH) { text = text.slice(0, MAX_TEXT_LENGTH); truncated = true; }
  return {
    ...page,
    url: loaded.finalUrl,
    title: page.title || loaded.extracted.title,
    text,
    headings: loaded.extracted.headings,
    truncated,
    htmlLanguage: loaded.extracted.htmlLanguage,
    source: "firecrawl",
    qualityScore: loaded.quality.score,
    zones: limitPreparedZones(loaded.extracted.zones),
  };
}

function sentenceCount(text: string, language: string) {
  try { return [...new Intl.Segmenter(language, { granularity: "sentence" }).segment(text)].filter((part) => part.segment.trim()).length; }
  catch { return (text.match(/[.!?…]+(?=\s|$)/g) ?? []).length; }
}

function analyzePrepared(input: PreparedPage, language: string): DocumentAnalysis {
  const zoneNgrams = Object.fromEntries(ANALYSIS_ZONES.map((zone) =>
    [zone, countNgramBlocks(input.zones[zone].blocks, language)])) as Record<AnalysisZone, ReturnType<typeof countNgramBlocks>>;
  const analyzedZones = Object.fromEntries(ANALYSIS_ZONES.map((zone) => {
    const prepared = input.zones[zone];
    const tokens = tokenize(prepared.blocks.join("\n"), language);
    const content = contentTokens(tokens);
    const terms = countTerms(tokens);
    return [zone, {
      available: prepared.available,
      wordCount: tokens.length,
      contentWordCount: content.length,
      termCounts: terms.counts,
      termForms: terms.forms,
      ngramCounts: zoneNgrams[zone].counts,
      ngramNesting: zoneNgrams[zone].nesting,
    } satisfies ZoneAnalysis];
  })) as Record<AnalysisZone, ZoneAnalysis>;
  const allZone = analyzedZones.all;
  const tokens = tokenize(input.zones.all.blocks.join("\n"), language);
  const content = contentTokens(tokens);
  if (content.length < 20) throw new Error("Недостаточно содержательных слов для анализа");
  const ngrams = zoneNgrams.all;
  return {
    name: input.name, url: input.url, position: input.position, title: input.title,
    wordCount: tokens.length, contentWordCount: content.length, uniqueTerms: allZone.termCounts.size,
    headings: input.headings, sentences: sentenceCount(input.zones.all.blocks.join("\n"), language), truncated: input.truncated,
    source: input.source, qualityScore: input.qualityScore,
    termCounts: allZone.termCounts, termForms: allZone.termForms, ngramCounts: ngrams.counts, ngramForms: ngrams.forms,
    ngramNesting: ngrams.nesting,
    zones: analyzedZones,
  };
}

const LATIN_LANGUAGE_CANDIDATES = Object.freeze([
  "eu", "ca", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de",
  "hu", "id", "ga", "it", "lv", "lt", "no", "pl", "pt", "ro", "sr",
  "sk", "sl", "es", "sw", "sv", "tr", "vi",
]);

const DETECTION_CHARACTER_HINTS: Readonly<Record<string, readonly [RegExp, number][]>> = Object.freeze({
  uk: [[/[іїєґ]/giu, 8]],
  sr: [[/[јљњћђџ]/giu, 8]],
  bg: [[/[ѝ]/giu, 10], [/[ъ]/giu, 1.25]],
  ru: [[/[ыэё]/giu, 4]],
  fa: [[/[پچژگ]/gu, 8], [/[کی]/gu, .8]],
  ur: [[/[ٹڈڑںھہۓے]/gu, 9]],
  vi: [[/[ăâđêôơư]/giu, 5], [/[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/giu, 3]],
  tr: [[/[ğışİ]/gu, 5]],
  ro: [[/[ăîșț]/giu, 5]],
  pl: [[/[ąćęłńśźż]/giu, 5]],
  cs: [[/[ěščřůďťň]/giu, 4]],
  sk: [[/[äĺľôŕ]/giu, 5]],
  hu: [[/[őű]/giu, 5]],
  et: [[/[õ]/giu, 4]],
  lv: [[/[āēģīķļņū]/giu, 5]],
  lt: [[/[ąęėįųū]/giu, 5]],
  de: [[/[ß]/giu, 7]],
  es: [[/[ñ¿¡]/giu, 5]],
  pt: [[/[ãõ]/giu, 5]],
  da: [[/[æøå]/giu, 2]],
  no: [[/[æøå]/giu, 2]],
  sv: [[/[åäö]/giu, 2]],
});

// Serbian written in Latin is almost indistinguishable from Croatian by
// character set alone. A short list of high-precision lexical contrasts keeps
// auto mode useful without pretending that every mixed regional page is
// unambiguous; HTML lang and the manual selector remain stronger signals.
const DETECTION_WORD_HINTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  sr: ["обука", "претрага", "вештина", "вештине", "решење", "тачно", "овде", "време", "obuka", "pretraga", "veština", "veštine", "rešenje", "tačno", "ovde", "vreme"],
  hr: ["tečaj", "pretraživanje", "vještina", "vještine", "rješenje", "točno", "ovdje", "vrijeme"],
});

function regexpMatchCount(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0;
}

function stopwordEvidenceScore(words: string[], candidates: readonly string[], language: string) {
  const normalized = words.map((word) => normalizeSurface(word, language)).filter(Boolean);
  const stops = languageStopwords(language);
  const candidateSets = candidates.map((candidate) => languageStopwords(candidate).single);
  let score = 0;
  for (const word of normalized) {
    if (!stops.single.has(word)) continue;
    const sharedBy = candidateSets.reduce((count, set) => count + Number(set.has(word)), 0);
    score += 1 + Math.log((candidates.length + 1) / (sharedBy + 1));
  }
  for (const phrase of stops.phrases) {
    if (phrase.length > normalized.length) continue;
    for (let start = 0; start <= normalized.length - phrase.length; start += 1) {
      if (phrase.every((part, offset) => normalized[start + offset] === part)) score += phrase.length * 2;
    }
  }
  const hints = DETECTION_WORD_HINTS[language] ?? [];
  if (hints.length) {
    const hintSet = new Set(hints.map((word) => normalizeSurface(word, language)));
    score += normalized.reduce((sum, word) => sum + (hintSet.has(word) ? 5 : 0), 0);
  }
  return score;
}

function characterEvidenceScore(text: string, language: string) {
  return (DETECTION_CHARACTER_HINTS[language] ?? [])
    .reduce((score, [pattern, weight]) => score + regexpMatchCount(text, pattern) * weight, 0);
}

function chooseDetectedLanguage(text: string, candidates: readonly string[], fallback: string) {
  const words = (text.match(/\p{L}+(?:['’]\p{L}+)*/gu) ?? []).slice(0, 4_000);
  let best = fallback;
  let bestScore = stopwordEvidenceScore(words, candidates, fallback) + characterEvidenceScore(text, fallback);
  for (const language of candidates) {
    if (language === fallback) continue;
    const score = stopwordEvidenceScore(words, candidates, language) + characterEvidenceScore(text, language);
    if (score > bestScore) { best = language; bestScore = score; }
  }
  return best;
}

function detectLanguage(text: string, htmlLanguages: string[]) {
  const declared = htmlLanguages.map((value) => value.toLowerCase().split(/[-_]/)[0]).filter((value) => LANGUAGE_CONFIGS[value]);
  if (declared.length) {
    const counts = new Map<string, number>();
    for (const value of declared) increment(counts, value);
    return [...counts].sort((a, b) => b[1] - a[1])[0][0];
  }

  const sample = text.slice(0, 120_000);
  const kanaCount = regexpMatchCount(sample, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const hanCount = regexpMatchCount(sample, /\p{Script=Han}/gu);
  const japaneseLikely = kanaCount >= 2 && kanaCount / Math.max(1, kanaCount + hanCount) >= .02;
  const scriptGroups = [
    { key: "cyrillic", count: regexpMatchCount(sample, /\p{Script=Cyrillic}/gu) },
    { key: "arabic", count: regexpMatchCount(sample, /\p{Script=Arabic}/gu) },
    { key: "armenian", count: regexpMatchCount(sample, /\p{Script=Armenian}/gu) },
    { key: "greek", count: regexpMatchCount(sample, /\p{Script=Greek}/gu) },
    { key: "hebrew", count: regexpMatchCount(sample, /\p{Script=Hebrew}/gu) },
    { key: "devanagari", count: regexpMatchCount(sample, /\p{Script=Devanagari}/gu) },
    { key: "tamil", count: regexpMatchCount(sample, /\p{Script=Tamil}/gu) },
    { key: "hangul", count: regexpMatchCount(sample, /\p{Script=Hangul}/gu) },
    { key: "japanese", count: japaneseLikely ? kanaCount + hanCount : 0 },
    { key: "han", count: japaneseLikely ? 0 : hanCount },
    { key: "thai", count: regexpMatchCount(sample, /\p{Script=Thai}/gu) },
    { key: "latin", count: regexpMatchCount(sample, /\p{Script=Latin}/gu) },
  ].sort((left, right) => right.count - left.count);

  if (!scriptGroups[0]?.count) return "en";

  switch (scriptGroups[0]?.key) {
    case "cyrillic": return chooseDetectedLanguage(sample, ["uk", "sr", "bg", "ru"], "ru");
    case "arabic": return chooseDetectedLanguage(sample, ["ur", "fa", "ar"], "ar");
    case "armenian": return "hy";
    case "greek": return "el";
    case "hebrew": return "he";
    case "devanagari": return "hi";
    case "tamil": return "ta";
    case "hangul": return "ko";
    case "japanese": return "ja";
    case "han": return "zh";
    case "thai": return "th";
    default: return chooseDetectedLanguage(sample, LATIN_LANGUAGE_CANDIDATES, "en");
  }
}

function parseQueries(payload: AnalyzeRequest) {
  const raw = Array.isArray(payload.queries) && payload.queries.length ? payload.queries : [payload.query ?? ""];
  const unique = new Set<string>();
  for (const value of raw.flatMap((item) => String(item).split(/[\n,;]+/))) {
    const query = value.trim().replace(/\s+/g, " ");
    if (query && query.length <= MAX_QUERY_LENGTH) unique.add(query);
    if (unique.size >= MAX_QUERIES) break;
  }
  if (!unique.size) throw new Error("Добавьте хотя бы один ключевой запрос");
  return [...unique];
}

function stopEntries(value: string | string[] | undefined) {
  const inputs = Array.isArray(value) ? value : value == null ? [] : [value];
  const unique = new Set<string>();
  for (const input of inputs) {
    for (const raw of String(input).split(/[\r\n,;]+/)) {
      const entry = raw.trim().replace(/^['"]+|['"]+$/g, "").replace(/\s+/g, " ");
      if (entry) unique.add(entry);
    }
  }
  return [...unique];
}

function parseCustomStops(payload: AnalyzeRequest, language: string) {
  const wordKeys = new Set<string>();
  const canonicalWords = new Set<string>();
  for (const entry of stopEntries(payload.stopWords)) {
    for (const raw of segmentWords(entry, language)) {
      const surface = normalizeSurface(raw, language);
      if (!surface) continue;
      wordKeys.add(termKey(surface, language));
      canonicalWords.add(surface);
    }
  }

  const phraseKeySequences: string[][] = [];
  const phraseIdentities = new Set<string>();
  const addPhraseSequence = (keys: string[]) => {
    const identity = keys.join("\u0000");
    if (!keys.length || phraseIdentities.has(identity)) return;
    phraseIdentities.add(identity);
    phraseKeySequences.push(keys);
  };
  for (const phrase of languageStopwords(language).phrases) {
    addPhraseSequence(phrase.map((surface) => termKey(surface, language)));
  }
  const canonicalPhrases = new Set<string>();
  for (const entry of stopEntries(payload.stopPhrases)) {
    const surfaces = segmentWords(entry, language).map((raw) => normalizeSurface(raw, language)).filter(Boolean);
    if (!surfaces.length) continue;
    const keys = surfaces.map((surface) => termKey(surface, language));
    addPhraseSequence(keys);
    canonicalPhrases.add(surfaces.join(" "));
  }
  return {
    wordKeys,
    phraseKeySequences,
    stopWords: [...canonicalWords],
    stopPhrases: [...canonicalPhrases],
  };
}

function ngramIsStopped(key: string, stops: ReturnType<typeof parseCustomStops>) {
  const keys = key.split(" ");
  if (keys.some((part) => stops.wordKeys.has(part))) return true;
  return stops.phraseKeySequences.some((pattern) => {
    if (pattern.length > keys.length) return false;
    for (let start = 0; start <= keys.length - pattern.length; start += 1) {
      if (pattern.every((part, offset) => keys[start + offset] === part)) return true;
    }
    return false;
  });
}

function round(value: number, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function quantile(values: number[], probability: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * probability;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function median(values: number[]) { return quantile(values, .5); }
function frequency(count: number, words: number) { return words ? count / words * 1_000 : 0; }

function cosine(left: number[], right: number[]) {
  if (left.length !== right.length) return 0;
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]; leftNorm += left[index] ** 2; rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function hashValue(value: string) {
  let hash = 2166136261;
  for (const character of value) { hash ^= character.codePointAt(0) ?? 0; hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function localSurfaceVector(text: string, language: string, dimensions = 256) {
  const vector = Array.from({ length: dimensions }, () => 0);
  const normalized = normalizeSurface(text.replace(/\s+/g, " "), language);
  const words = segmentWords(normalized, language).map((word) => normalizeSurface(word, language)).filter(Boolean);
  const features: Array<[string, number]> = words.map((word) => [`w:${termKey(word, language)}`, 1]);
  const characters = Array.from(` ${normalized} `);
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= characters.length - size; index += 1) features.push([`c:${characters.slice(index, index + size).join("")}`, .25]);
  }
  for (const [feature, weight] of features) {
    const hash = hashValue(feature);
    vector[hash % dimensions] += (hash & 1 ? 1 : -1) * weight;
  }
  return vector;
}

function keywordProfiles(keywords: string[], competitors: DocumentAnalysis[], language: string) {
  return keywords.map((keyword) => {
    const tokens = contentTokens(tokenize(keyword, language));
    const termKeys = [...new Set(tokens.map((token) => token.key))];
    const ngramKeys = [...countNgrams(tokens).counts.keys()];
    const documentVector = competitors.map((document) => {
      const termScore = termKeys.reduce((sum, key) => sum + frequency(document.termCounts.get(key) ?? 0, document.wordCount), 0);
      const phraseScore = ngramKeys.reduce((sum, key) => sum + frequency(document.ngramCounts.get(key) ?? 0, Math.max(1, document.wordCount - 1)), 0);
      return termScore + phraseScore * 1.35;
    });
    return {
      keyword,
      termKeys: new Set(termKeys),
      ngramKeys: new Set(ngramKeys),
      documentVector,
      surfaceVector: localSurfaceVector(keyword, language),
    };
  });
}

function localSemanticScore(label: string, key: string, occurrenceVector: number[], profiles: ReturnType<typeof keywordProfiles>, language: string) {
  const candidateSurface = localSurfaceVector(label, language);
  let best = 0;
  let bestKeyword = profiles[0]?.keyword ?? "";
  for (const profile of profiles) {
    const context = Math.max(0, cosine(occurrenceVector, profile.documentVector));
    const surface = Math.max(0, cosine(candidateSurface, profile.surfaceVector));
    const exact = profile.ngramKeys.has(key) ? 1 : 0;
    if (exact) { best = 1; bestKeyword = profile.keyword; break; }
    const score = Math.max(context, surface * .9, exact);
    if (score > best) { best = score; bestKeyword = profile.keyword; }
  }
  return { keySimilarity: Math.min(1, best), bestKeyword };
}

type NgramSemanticInput = Pick<BaseRow, "key" | "label" | "frequencies">;
type NgramSemanticValue = { keySimilarity: number; bestKeyword: string };
type NgramSemanticResolution = {
  values: Map<string, NgramSemanticValue>;
  source: "e5-service" | "e5-cache" | "local";
  model?: string;
  revision?: string;
  coverage: number;
  cache?: SnapshotPhraseSimilarity;
  error?: string;
};

function sameQueries(left: string[], right: string[]) {
  return left.length === right.length && left.every((query, index) => query === right[index]);
}

function exactKeyword(key: string, profiles: ReturnType<typeof keywordProfiles>) {
  return profiles.find((profile) => profile.ngramKeys.has(key))?.keyword;
}

function localNgramSemantics(rows: NgramSemanticInput[], profiles: ReturnType<typeof keywordProfiles>, language: string) {
  return new Map(rows.map((row) => [
    row.key,
    localSemanticScore(row.label, row.key, row.frequencies, profiles, language),
  ]));
}

function serviceFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "E5 service is unavailable";
  return message.replace(/\s+/gu, " ").trim().slice(0, 500);
}

async function resolveNgramSemantics(input: {
  rows: NgramSemanticInput[];
  queries: string[];
  profiles: ReturnType<typeof keywordProfiles>;
  language: string;
  requestId: string;
  snapshotCache?: SnapshotPhraseSimilarity;
  provider?: PhraseSimilarityProvider;
  allowService: boolean;
}): Promise<NgramSemanticResolution> {
  const values = localNgramSemantics(input.rows, input.profiles, input.language);
  const cache = input.snapshotCache;
  if (!input.allowService) {
    if (!cache || !sameQueries(cache.queries, input.queries)) {
      return { values, source: "local", coverage: 0 };
    }
    const cachedRows = new Map(cache.rows.map((row) => [`${row[0]}\u0000${row[1]}`, row]));
    let matched = 0;
    for (const row of input.rows) {
      const cached = cachedRows.get(`${row.key}\u0000${row.label}`);
      if (!cached) continue;
      matched += 1;
      const exact = exactKeyword(row.key, input.profiles);
      values.set(row.key, exact
        ? { keySimilarity: 1, bestKeyword: exact }
        : { keySimilarity: cached[2], bestKeyword: input.queries[cached[3]] ?? input.queries[0] ?? "" });
    }
    return matched
      ? { values, source: "e5-cache", model: cache.model, revision: cache.revision, coverage: matched / Math.max(1, input.rows.length) }
      : { values, source: "local", coverage: 0 };
  }
  if (!input.provider) return { values, source: "local", coverage: 0 };
  if (input.rows.length > SNAPSHOT_PHRASE_SIMILARITIES_MAXIMUM) {
    return {
      values,
      source: "local",
      coverage: 0,
      error: `E5 candidate guard exceeded (${input.rows.length})`,
    };
  }
  let result: PhraseSimilarityResult;
  try {
    result = await input.provider({
      queries: input.queries,
      candidates: input.rows.map((row) => row.label),
      language: input.language,
      requestId: input.requestId,
    });
  } catch (error) {
    return { values, source: "local", coverage: 0, error: serviceFailureMessage(error) };
  }
  if (result.best.length !== input.rows.length) {
    return { values, source: "local", coverage: 0, error: "E5 service returned an incomplete result" };
  }
  const cacheRows: SnapshotPhraseSimilarity["rows"] = [];
  for (const [index, row] of input.rows.entries()) {
    const item = result.best[index];
    if (!item || !Number.isInteger(item.queryIndex) || item.queryIndex < 0 || item.queryIndex >= input.queries.length
      || !Number.isFinite(item.score)) {
      return { values: localNgramSemantics(input.rows, input.profiles, input.language), source: "local", coverage: 0, error: "E5 service returned invalid scores" };
    }
    const score = round(Math.min(1, Math.max(0, item.score)), 6);
    cacheRows.push([row.key, row.label, score, item.queryIndex]);
    const exact = exactKeyword(row.key, input.profiles);
    values.set(row.key, exact
      ? { keySimilarity: 1, bestKeyword: exact }
      : { keySimilarity: score, bestKeyword: input.queries[item.queryIndex] ?? input.queries[0] ?? "" });
  }
  return {
    values,
    source: "e5-service",
    model: result.model,
    revision: result.revision,
    coverage: 1,
    cache: {
      version: 1,
      engine: "e5",
      model: result.model,
      revision: result.revision,
      queries: [...input.queries],
      rows: cacheRows,
    },
  };
}

function statusFor(ownFrequency: number, q25: number, medianFrequency: number, q75: number, minimum: number) {
  const lowTarget = q25 > 0 ? q25 : medianFrequency * .55;
  const highTarget = q75 > 0 ? q75 : medianFrequency * 1.45;
  if (ownFrequency < Math.max(minimum, lowTarget)) return "Добавить" as const;
  if (highTarget > 0 && ownFrequency > Math.max(highTarget * 1.3, medianFrequency * 1.8)) return "Снизить" as const;
  return "Норма" as const;
}

function densityTargetContext(ownWords: number, competitorWords: number[]) {
  const benchmarkWords = median(competitorWords.filter((value) => value > 0));
  const factor = benchmarkWords > 0 ? Math.max(0, ownWords) / benchmarkWords : 1;
  return {
    ownWords: Math.max(0, Math.trunc(ownWords)),
    benchmarkWords: Math.max(0, Math.ceil(benchmarkWords)),
    factor,
  };
}

function normalizedDensityTarget(value: number, factor: number) {
  // A visible recommendation is actionable only as an integer occurrence and
  // the product contract explicitly forbids a target below one.
  return Math.max(1, Math.ceil(Math.max(0, value) * Math.max(0, factor)));
}

function statusWithinDisplayedRange(
  status: BaseRow["status"],
  ownCount: number,
  q25Count: number,
  q75Count: number,
) {
  return ownCount >= q25Count && ownCount <= q75Count ? "Норма" as const : status;
}

type NestingSource = Pick<ZoneAnalysis, "ngramCounts" | "ngramNesting">;
type NestingClassification = "independent" | "partially_nested" | "fully_nested" | "insufficient_evidence";

function nestingScope(key: string, sources: NestingSource[]) {
  const supportsParents = key.split(/\s+/u).length === 2;
  let occurrences = 0;
  let evidencedOccurrences = 0;
  let positionalStandaloneOccurrences = 0;
  let evidenceComplete = supportsParents;
  for (const source of sources) {
    const count = Math.max(0, source.ngramCounts.get(key) ?? 0);
    const evidence = source.ngramNesting.get(key);
    occurrences += count;
    evidencedOccurrences += evidence?.total ?? 0;
    positionalStandaloneOccurrences += evidence?.standalone ?? 0;
    if (!supportsParents || (evidence?.total ?? 0) !== count) evidenceComplete = false;
  }
  const standaloneOccurrences = Math.min(evidencedOccurrences, positionalStandaloneOccurrences);
  const nestedOccurrences = Math.max(0, evidencedOccurrences - standaloneOccurrences);
  let classification: NestingClassification = "independent";
  if (supportsParents && !evidenceComplete) classification = "insufficient_evidence";
  else if (nestedOccurrences > 0 && standaloneOccurrences === 0) classification = "fully_nested";
  else if (nestedOccurrences > 0) classification = "partially_nested";
  return {
    classification,
    evidenceComplete,
    occurrences: Math.ceil(occurrences),
    standaloneOccurrences: Math.ceil(standaloneOccurrences),
    nestedOccurrences: Math.ceil(nestedOccurrences),
    nestedShare: evidencedOccurrences > 0 ? round(nestedOccurrences / evidencedOccurrences * 100, 1) : 0,
  };
}

function ngramNestingReport(
  key: string,
  competitors: NestingSource[],
  own: NestingSource,
  labels: Map<string, string>,
) {
  const competitorScope = nestingScope(key, competitors);
  const ownScope = nestingScope(key, [own]);
  const parentCounts = new Map<string, number>();
  const parentSites = new Map<string, number>();
  for (const source of competitors) {
    const evidence = source.ngramNesting.get(key);
    if (!evidence) continue;
    for (const [parent, count] of evidence.parents) {
      increment(parentCounts, parent, count);
      if (count > 0) increment(parentSites, parent);
    }
  }
  const parents = [...parentCounts]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([parentKey, occurrences]) => ({
      key: parentKey,
      phrase: labels.get(parentKey) ?? parentKey,
      occurrences: Math.ceil(occurrences),
      sites: parentSites.get(parentKey) ?? 0,
      share: competitorScope.occurrences > 0 ? round(occurrences / competitorScope.occurrences * 100, 1) : 0,
    }));
  const fullCoverageParents = competitorScope.evidenceComplete
    ? parents.filter((parent) => parent.occurrences === competitorScope.occurrences)
    : [];
  // A short phrase can be collapsed only into one unambiguous parent. The
  // middle bigram of a stable four-word expression has two 100% parents and
  // therefore must remain a separate row.
  const mergeParent = fullCoverageParents.length === 1 ? fullCoverageParents[0] : undefined;
  const ownMergeParentOccurrences = mergeParent
    ? own.ngramNesting.get(key)?.parents.get(mergeParent.key) ?? 0
    : 0;
  const ownMergeParentComplete = ownScope.evidenceComplete
    && Boolean(mergeParent)
    && ownMergeParentOccurrences === ownScope.occurrences;
  return {
    ...competitorScope,
    mergeable: Boolean(mergeParent),
    mergeParentKey: mergeParent?.key ?? "",
    mergeParentPhrase: mergeParent?.phrase ?? "",
    ownClassification: ownScope.classification,
    ownEvidenceComplete: ownScope.evidenceComplete,
    ownOccurrences: ownScope.occurrences,
    ownStandaloneOccurrences: ownScope.standaloneOccurrences,
    ownNestedOccurrences: ownScope.nestedOccurrences,
    ownNestedShare: ownScope.nestedShare,
    ownMergeParentOccurrences: Math.ceil(ownMergeParentOccurrences),
    ownMergeParentShare: ownScope.occurrences > 0 ? round(ownMergeParentOccurrences / ownScope.occurrences * 100, 1) : 0,
    ownMergeParentComplete,
    parents,
  };
}

function editGap(status: BaseRow["status"], ownFrequency: number, medianFrequency: number, q75: number) {
  if (status === "Добавить") return Math.min(1, Math.max(0, medianFrequency - ownFrequency) / Math.max(medianFrequency, .01));
  if (status === "Снизить") return Math.min(1, Math.max(0, ownFrequency - Math.max(q75, medianFrequency)) / Math.max(ownFrequency, .01));
  return 0;
}

function serializeForms(forms: FormCounts, allowedKeys: Set<string>) {
  return [...forms].filter(([key]) => allowedKeys.has(key)).map(([key, variants]) => [key, [...variants]
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([form, count]) => [form, Math.max(0, Math.trunc(count))] as [string, number])] as [string, Array<[string, number]>]);
}

function serializeNgramNesting(nesting: NgramNestingCounts, allowedKeys: Set<string>): SerializedNgramNestingCounts {
  return [...nesting]
    .filter(([key, evidence]) => allowedKeys.has(key) && evidence.total > 0)
    .sort((left, right) => right[1].total - left[1].total || left[0].localeCompare(right[0]))
    .slice(0, SNAPSHOT_NGRAMS)
    .map(([key, evidence]) => [
      key,
      Math.max(0, Math.trunc(evidence.total)),
      Math.max(0, Math.min(Math.trunc(evidence.total), Math.trunc(evidence.standalone))),
      [...evidence.parents]
        .filter(([parent, count]) => allowedKeys.has(parent) && count > 0)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, SNAPSHOT_NGRAM_PARENTS_PER_KEY)
        .map(([parent, count]) => [parent, Math.max(0, Math.trunc(count))] as [string, number]),
    ]);
}

function serializeZoneAnalysis(zone: ZoneAnalysis): SerializedZoneAnalysis {
  const termCounts = [...zone.termCounts].sort((a, b) => b[1] - a[1]).slice(0, SNAPSHOT_TERMS)
    .map(([key, count]) => [key, Math.max(0, Math.trunc(count))] as [string, number]);
  const ngramCounts = [...zone.ngramCounts].sort((a, b) => b[1] - a[1]).slice(0, SNAPSHOT_NGRAMS)
    .map(([key, count]) => [key, Math.max(0, Math.trunc(count))] as [string, number]);
  return {
    available: zone.available,
    wordCount: Math.max(0, Math.trunc(zone.wordCount)),
    contentWordCount: Math.max(0, Math.trunc(zone.contentWordCount)),
    termCounts,
    termForms: serializeForms(zone.termForms, new Set(termCounts.map(([key]) => key))),
    ngramCounts,
    ngramNesting: serializeNgramNesting(zone.ngramNesting, new Set(ngramCounts.map(([key]) => key))),
  };
}

function serializeDocument(document: DocumentAnalysis): SerializedDocument {
  const termCounts = [...document.termCounts].sort((a, b) => b[1] - a[1]).slice(0, SNAPSHOT_TERMS)
    .map(([key, count]) => [key, Math.max(0, Math.trunc(count))] as [string, number]);
  const ngramCounts = [...document.ngramCounts].sort((a, b) => b[1] - a[1]).slice(0, SNAPSHOT_NGRAMS)
    .map(([key, count]) => [key, Math.max(0, Math.trunc(count))] as [string, number]);
  return {
    name: document.name, url: document.url, position: document.position, title: document.title,
    wordCount: document.wordCount, contentWordCount: document.contentWordCount, uniqueTerms: document.uniqueTerms,
    headings: document.headings, sentences: document.sentences, truncated: document.truncated,
    source: document.source, qualityScore: document.qualityScore,
    termCounts, termForms: serializeForms(document.termForms, new Set(termCounts.map(([key]) => key))),
    ngramCounts, ngramForms: serializeForms(document.ngramForms, new Set(ngramCounts.map(([key]) => key))),
    ngramNesting: serializeNgramNesting(document.ngramNesting, new Set(ngramCounts.map(([key]) => key))),
    zones: Object.fromEntries(ANALYSIS_ZONES.map((zone) => [zone, serializeZoneAnalysis(document.zones[zone])])) as Record<AnalysisZone, SerializedZoneAnalysis>,
  };
}

function snapshotRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Некорректный snapshot: ${label} должен быть объектом`);
  }
  return value as Record<string, unknown>;
}

function snapshotArray(value: unknown, limit: number, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Некорректный snapshot: ${label} должен быть массивом`);
  if (value.length > limit) throw new Error(`Некорректный snapshot: ${label} превышает лимит ${limit}`);
  // Slice before traversal so even a mutable client-owned array cannot expand
  // while it is being validated.
  return value.slice(0, limit);
}

function snapshotString(value: unknown, maximum: number, label: string) {
  if (typeof value !== "string") throw new Error(`Некорректный snapshot: ${label} должен быть строкой`);
  const result = value.trim();
  if (!result || result.length > maximum) {
    throw new Error(`Некорректный snapshot: ${label} пустой или превышает лимит ${maximum}`);
  }
  return result;
}

function optionalSnapshotString(value: unknown, maximum: number, fallback = "") {
  return typeof value === "string" ? value.slice(0, maximum) : fallback;
}

function snapshotCount(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > SNAPSHOT_COUNT_MAXIMUM) {
    throw new Error(`Некорректный snapshot: ${label} должен быть конечным неотрицательным числом`);
  }
  return Math.trunc(value);
}

function optionalSnapshotCount(value: unknown, maximum = SNAPSHOT_COUNT_MAXIMUM) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(maximum, Math.trunc(value))
    : 0;
}

function deserializeCounts(value: unknown, limit: number, label: string): Map<string, number> {
  const result = new Map<string, number>();
  for (const [index, rawTuple] of snapshotArray(value, limit, label).entries()) {
    if (!Array.isArray(rawTuple) || rawTuple.length < 2) {
      throw new Error(`Некорректный snapshot: ${label}[${index}] должен быть парой`);
    }
    const key = snapshotString(rawTuple[0], SNAPSHOT_KEY_MAX_CHARACTERS, `${label}[${index}].key`);
    const count = snapshotCount(rawTuple[1], `${label}[${index}].count`);
    result.set(key, count);
  }
  return result;
}

function deserializeForms(value: unknown, limit: number, label: string): FormCounts {
  const result: FormCounts = new Map();
  for (const [index, rawTuple] of snapshotArray(value, limit, label).entries()) {
    if (!Array.isArray(rawTuple) || rawTuple.length < 2) {
      throw new Error(`Некорректный snapshot: ${label}[${index}] должен быть парой`);
    }
    const key = snapshotString(rawTuple[0], SNAPSHOT_KEY_MAX_CHARACTERS, `${label}[${index}].key`);
    const variants = new Map<string, number>();
    for (const [variantIndex, rawVariant] of snapshotArray(rawTuple[1], SNAPSHOT_FORMS_PER_KEY, `${label}[${index}].forms`).entries()) {
      if (!Array.isArray(rawVariant) || rawVariant.length < 2) {
        throw new Error(`Некорректный snapshot: ${label}[${index}].forms[${variantIndex}] должен быть парой`);
      }
      const form = snapshotString(rawVariant[0], SNAPSHOT_FORM_MAX_CHARACTERS, `${label}[${index}].forms[${variantIndex}].form`);
      const count = snapshotCount(rawVariant[1], `${label}[${index}].forms[${variantIndex}].count`);
      variants.set(form, count);
    }
    result.set(key, variants);
  }
  return result;
}

function deserializeNgramNesting(value: unknown, label: string): NgramNestingCounts {
  const result: NgramNestingCounts = new Map();
  // The field is additive inside snapshot v5. Snapshots made before positional
  // nesting was introduced remain valid, but can never claim complete proof.
  if (value === undefined || value === null) return result;
  for (const [index, rawTuple] of snapshotArray(value, SNAPSHOT_NGRAMS, label).entries()) {
    if (!Array.isArray(rawTuple) || rawTuple.length < 4) {
      throw new Error(`Некорректный snapshot: ${label}[${index}] должен быть четвёркой`);
    }
    const key = snapshotString(rawTuple[0], SNAPSHOT_KEY_MAX_CHARACTERS, `${label}[${index}].key`);
    if (result.has(key)) throw new Error(`Некорректный snapshot: повтор вложенности ${key}`);
    const total = snapshotCount(rawTuple[1], `${label}[${index}].total`);
    const standalone = snapshotCount(rawTuple[2], `${label}[${index}].standalone`);
    if (standalone > total) throw new Error(`Некорректный snapshot: ${label}[${index}].standalone превышает total`);
    const parents = new Map<string, number>();
    for (const [parentIndex, rawParent] of snapshotArray(
      rawTuple[3],
      SNAPSHOT_NGRAM_PARENTS_PER_KEY,
      `${label}[${index}].parents`,
    ).entries()) {
      if (!Array.isArray(rawParent) || rawParent.length < 2) {
        throw new Error(`Некорректный snapshot: ${label}[${index}].parents[${parentIndex}] должен быть парой`);
      }
      const parent = snapshotString(
        rawParent[0],
        SNAPSHOT_KEY_MAX_CHARACTERS,
        `${label}[${index}].parents[${parentIndex}].key`,
      );
      if (parents.has(parent)) throw new Error(`Некорректный snapshot: повтор родительской фразы ${parent}`);
      const count = snapshotCount(rawParent[1], `${label}[${index}].parents[${parentIndex}].count`);
      if (count > total) throw new Error(`Некорректный snapshot: связь ${parent} превышает total`);
      parents.set(parent, count);
    }
    result.set(key, { total, standalone, parents });
  }
  return result;
}

function deserializeZoneAnalysis(value: unknown, label: string): ZoneAnalysis {
  const zone = snapshotRecord(value, label);
  return {
    available: Boolean(zone.available),
    wordCount: optionalSnapshotCount(zone.wordCount),
    contentWordCount: optionalSnapshotCount(zone.contentWordCount),
    termCounts: deserializeCounts(zone.termCounts, SNAPSHOT_TERMS, `${label}.termCounts`),
    termForms: deserializeForms(zone.termForms, SNAPSHOT_TERMS, `${label}.termForms`),
    ngramCounts: deserializeCounts(zone.ngramCounts, SNAPSHOT_NGRAMS, `${label}.ngramCounts`),
    ngramNesting: deserializeNgramNesting(zone.ngramNesting, `${label}.ngramNesting`),
  };
}

function deserializeDocument(value: unknown, language: string, label: string): DocumentAnalysis {
  const document = snapshotRecord(value, label);
  const zones = snapshotRecord(document.zones, `${label}.zones`);
  return {
    name: optionalSnapshotString(document.name, 512, "Документ"),
    url: optionalSnapshotString(document.url, 2_048),
    position: optionalSnapshotCount(document.position) || undefined,
    title: optionalSnapshotString(document.title, 1_000),
    wordCount: optionalSnapshotCount(document.wordCount),
    contentWordCount: optionalSnapshotCount(document.contentWordCount),
    uniqueTerms: optionalSnapshotCount(document.uniqueTerms),
    headings: optionalSnapshotCount(document.headings),
    sentences: optionalSnapshotCount(document.sentences),
    truncated: Boolean(document.truncated),
    source: document.source === "http" || document.source === "firecrawl" || document.source === "text" ? document.source : "text",
    qualityScore: typeof document.qualityScore === "number" && Number.isFinite(document.qualityScore)
      ? Math.min(100, Math.max(0, document.qualityScore))
      : 100,
    termCounts: deserializeCounts(document.termCounts, SNAPSHOT_TERMS, `${label}.termCounts`),
    termForms: deserializeForms(document.termForms, SNAPSHOT_TERMS, `${label}.termForms`),
    ngramCounts: deserializeCounts(document.ngramCounts, SNAPSHOT_NGRAMS, `${label}.ngramCounts`),
    ngramForms: deserializeForms(document.ngramForms, SNAPSHOT_NGRAMS, `${label}.ngramForms`),
    ngramNesting: deserializeNgramNesting(document.ngramNesting, `${label}.ngramNesting`),
    zones: Object.fromEntries(ANALYSIS_ZONES.map((zone) =>
      [zone, deserializeZoneAnalysis(zones[zone], `${label}.zones.${zone}`)])) as Record<AnalysisZone, ZoneAnalysis>,
  };
}

function deserializePhraseSimilarity(value: unknown): SnapshotPhraseSimilarity | undefined {
  if (value === undefined || value === null) return undefined;
  const cache = snapshotRecord(value, "snapshot.phraseSimilarity");
  if (cache.version !== 1 || cache.engine !== "e5") {
    throw new Error("Некорректный snapshot: неизвестная версия сходства фраз");
  }
  const queries = snapshotArray(cache.queries, MAX_QUERIES, "snapshot.phraseSimilarity.queries")
    .map((query, index) => snapshotString(query, MAX_QUERY_LENGTH, `snapshot.phraseSimilarity.queries[${index}]`));
  if (!queries.length) throw new Error("Некорректный snapshot: кэш E5 не содержит ключей");
  const seen = new Set<string>();
  const rows = snapshotArray(
    cache.rows,
    SNAPSHOT_PHRASE_SIMILARITIES_MAXIMUM,
    "snapshot.phraseSimilarity.rows",
  ).map((rawRow, index) => {
    if (!Array.isArray(rawRow) || rawRow.length < 4) {
      throw new Error(`Некорректный snapshot: snapshot.phraseSimilarity.rows[${index}] должен быть четвёркой`);
    }
    const key = snapshotString(rawRow[0], SNAPSHOT_KEY_MAX_CHARACTERS, `snapshot.phraseSimilarity.rows[${index}].key`);
    const label = snapshotString(rawRow[1], SNAPSHOT_FORM_MAX_CHARACTERS, `snapshot.phraseSimilarity.rows[${index}].label`);
    const score = Number(rawRow[2]);
    const bestQueryIndex = Number(rawRow[3]);
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      throw new Error(`Некорректный snapshot: snapshot.phraseSimilarity.rows[${index}].score вне диапазона`);
    }
    if (!Number.isInteger(bestQueryIndex) || bestQueryIndex < 0 || bestQueryIndex >= queries.length) {
      throw new Error(`Некорректный snapshot: snapshot.phraseSimilarity.rows[${index}].bestQueryIndex вне диапазона`);
    }
    const identity = `${key}\u0000${label}`;
    if (seen.has(identity)) throw new Error(`Некорректный snapshot: повтор строки E5 ${key}`);
    seen.add(identity);
    return [key, label, round(score, 6), bestQueryIndex] as [string, string, number, number];
  });
  return {
    version: 1,
    engine: "e5",
    model: snapshotString(cache.model, 240, "snapshot.phraseSimilarity.model"),
    revision: optionalSnapshotString(cache.revision, 128) || undefined,
    queries,
    rows,
  };
}

function normalizeClientSnapshot(value: unknown): CorpusSnapshot {
  const raw = snapshotRecord(value, "snapshot");
  if (raw.version !== SNAPSHOT_VERSION) {
    throw new Error("Корпус создан старой версией — обновите конкурентов (требуется snapshot v5)");
  }
  const language = snapshotString(raw.language, 16, "snapshot.language").toLowerCase();
  if (!LANGUAGE_CONFIGS[language]) throw new Error("Некорректный snapshot: язык не поддерживается");
  snapshotRecord(raw.own, "snapshot.own");
  const competitors = snapshotArray(raw.competitors, SNAPSHOT_COMPETITORS_MAXIMUM, "snapshot.competitors");
  if (!competitors.length) throw new Error("Некорректный snapshot: нужен хотя бы один конкурент");

  const rawSearch = snapshotRecord(raw.search, "snapshot.search");
  const search: SearchContext = {
    engine: rawSearch.engine === "google" || rawSearch.engine === "yandex" ? rawSearch.engine : undefined,
    region: optionalSnapshotString(rawSearch.region, 128) || undefined,
    device: rawSearch.device === "desktop" || rawSearch.device === "tablet" || rawSearch.device === "mobile"
      ? rawSearch.device
      : undefined,
    found: optionalSnapshotCount(rawSearch.found) || undefined,
  };
  const warnings = snapshotArray(raw.warnings, SNAPSHOT_WARNINGS_MAXIMUM, "snapshot.warnings").map((value, index) => {
    const warning = snapshotRecord(value, `snapshot.warnings[${index}]`);
    const code: WarningCode = warning.code === "low_quality" || warning.code === "corpus_anomaly"
      || warning.code === "analysis_failed" || warning.code === "fetch_failed"
      ? warning.code
      : "analysis_failed";
    const source = warning.source === "http" || warning.source === "firecrawl" || warning.source === "text"
      ? warning.source
      : undefined;
    return {
      name: optionalSnapshotString(warning.name, 512, `Документ ${index + 1}`),
      url: optionalSnapshotString(warning.url, 2_048) || undefined,
      position: optionalSnapshotCount(warning.position) || undefined,
      code,
      error: optionalSnapshotString(warning.error, 2_000, "Ошибка обработки"),
      source,
    } satisfies AnalysisWarning;
  });

  return {
    version: SNAPSHOT_VERSION,
    id: optionalSnapshotString(raw.id, 128, snapshotId()),
    createdAt: optionalSnapshotString(raw.createdAt, 64, new Date().toISOString()),
    language,
    serpQuery: optionalSnapshotString(raw.serpQuery, MAX_QUERY_LENGTH),
    search,
    competitors: competitors as SerializedDocument[],
    own: raw.own as SerializedDocument,
    warnings,
    phraseSimilarity: deserializePhraseSimilarity(raw.phraseSimilarity),
  };
}

function snapshotId() {
  try { return crypto.randomUUID(); }
  catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

async function settleWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
  const results: Array<PromiseSettledResult<R>> = Array(items.length);
  let nextIndex = 0;
  const run = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try { results[index] = { status: "fulfilled", value: await worker(items[index], index) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run));
  return results;
}

function preparationWarning(input: PageInput, fallbackName: string, reason: unknown): AnalysisWarning {
  const error = reason instanceof Error ? reason : new Error("Не удалось обработать страницу");
  return {
    name: input.name?.trim() || input.url?.trim() || fallbackName,
    url: input.url?.trim() || undefined,
    position: input.position,
    code: error instanceof PagePreparationError ? error.code : "fetch_failed",
    error: error.message,
    source: error instanceof PagePreparationError ? error.source : input.text?.trim() ? "text" : "http",
  };
}

function filterCorpusAnomalies(documents: DocumentAnalysis[]) {
  if (documents.length < 4) return { documents, warnings: [] as AnalysisWarning[], anomalies: [] as Array<{ index: number; document: DocumentAnalysis; detail: string }> };
  const medianWords = median(documents.map((document) => document.contentWordCount));
  const medianUnique = median(documents.map((document) => document.uniqueTerms));
  const minimumWords = Math.max(20, Math.floor(medianWords * .15));
  const maximumWords = Math.max(5_000, Math.ceil(medianWords * 8));
  const minimumUnique = Math.max(10, Math.floor(medianUnique * .12));
  const accepted: DocumentAnalysis[] = [];
  const warnings: AnalysisWarning[] = [];
  const anomalies: Array<{ index: number; document: DocumentAnalysis; detail: string }> = [];
  documents.forEach((document, index) => {
    const tooShort = document.contentWordCount < minimumWords;
    const tooLong = document.contentWordCount > maximumWords;
    const tooSparse = document.uniqueTerms < minimumUnique;
    if (!tooShort && !tooLong && !tooSparse) { accepted.push(document); return; }
    const detail = tooShort
      ? `слишком мало содержательных слов относительно корпуса (${document.contentWordCount}, медиана ${Math.round(medianWords)})`
      : tooLong
        ? `объём страницы аномально велик относительно корпуса (${document.contentWordCount}, медиана ${Math.round(medianWords)})`
        : `слишком мало уникальных лемм относительно корпуса (${document.uniqueTerms}, медиана ${Math.round(medianUnique)})`;
    warnings.push({
      name: document.name, url: document.url || undefined, position: document.position,
      code: "corpus_anomaly", error: `Страница исключена из корпуса: ${detail}.`, source: document.source,
    });
    anomalies.push({ index, document, detail });
  });
  const minimumUsefulCorpus = Math.min(3, documents.length);
  return accepted.length >= minimumUsefulCorpus
    ? { documents: accepted, warnings, anomalies }
    : { documents, warnings: [] as AnalysisWarning[], anomalies: [] as Array<{ index: number; document: DocumentAnalysis; detail: string }> };
}

async function buildSnapshot(payload: AnalyzeRequest, serpQuery: string, dependencies: AnalyzeDependencies): Promise<CorpusSnapshot> {
  const ownInput = payload.ownPage;
  const competitorInputs = Array.isArray(payload.competitors) ? payload.competitors : [];
  if (!ownInput) throw new Error("Добавьте свою страницу");
  if (!competitorInputs.length) throw new Error("Не найдено ни одного конкурента для анализа");
  if (competitorInputs.length > SNAPSHOT_COMPETITORS_MAXIMUM) throw new Error("За один запуск можно безопасно обработать не более 500 конкурентов");

  // Firecrawl is a server-side fallback: configuring a key enables it
  // automatically, while an absent key keeps the direct HTTP path unchanged.
  // The client cannot accidentally disable a configured recovery path.
  const useFirecrawl = Boolean(firecrawlKey());
  const inputs = [ownInput, ...competitorInputs];
  const settled = await settleWithConcurrency(inputs, PAGE_PREPARE_CONCURRENCY, (input, index) =>
    prepareInput(input, index === 0 ? "Наша страница" : `Конкурент ${index}`, useFirecrawl));
  const ownResult = settled[0];
  if (ownResult.status === "rejected") throw ownResult.reason;
  const ownPrepared = ownResult.value;
  const competitorResults = settled.slice(1);
  const preparedCompetitors = competitorResults.flatMap((result, index) => result.status === "fulfilled"
    ? [{ page: result.value, inputIndex: index }]
    : []);
  const warnings: AnalysisWarning[] = competitorResults.flatMap((result, index) => result.status === "rejected"
    ? [preparationWarning(competitorInputs[index], `Конкурент ${index + 1}`, result.reason)]
    : []);
  if (!preparedCompetitors.length) throw new Error("Не удалось обработать ни одного конкурента");

  const requestedLanguage = payload.language?.trim().toLowerCase() ?? "auto";
  const detectionText = `${serpQuery}\n${ownPrepared.text.slice(0, 8_000)}\n${preparedCompetitors.map(({ page }) => page.text.slice(0, 3_000)).join("\n")}`;
  const language = requestedLanguage !== "auto" && LANGUAGE_CONFIGS[requestedLanguage]
    ? requestedLanguage
    : detectLanguage(detectionText, [ownPrepared.htmlLanguage, ...preparedCompetitors.map(({ page }) => page.htmlLanguage)]);
  if (language === "ru") await initializeRussianMorphology(dependencies.assetOrigin);

  const analyzedRecords: Array<{ page: PreparedPage; inputIndex: number; document: DocumentAnalysis }> = [];
  preparedCompetitors.forEach(({ page, inputIndex }) => {
    try { analyzedRecords.push({ page, inputIndex, document: analyzePrepared(page, language) }); }
    catch (error) { warnings.push({
      name: page.name, url: page.url || undefined, position: page.position, code: "analysis_failed",
      error: error instanceof Error ? error.message : `Не удалось обработать документ ${inputIndex + 1}`, source: page.source,
    }); }
  });
  let anomalyResult = filterCorpusAnomalies(analyzedRecords.map((record) => record.document));
  const fallbackKey = useFirecrawl ? firecrawlKey() : "";
  const retryableAnomalies = fallbackKey
    ? anomalyResult.anomalies.filter(({ index }) => analyzedRecords[index]?.page.source === "http" && Boolean(analyzedRecords[index]?.page.url))
    : [];
  if (retryableAnomalies.length) {
    const retryResults = await settleWithConcurrency(retryableAnomalies, PAGE_PREPARE_CONCURRENCY, async ({ index }) => {
      const record = analyzedRecords[index];
      const page = await prepareFirecrawlRetry(record.page, fallbackKey);
      return { index, page, document: analyzePrepared(page, language) };
    });
    for (const result of retryResults) {
      if (result.status !== "fulfilled") continue;
      analyzedRecords[result.value.index] = {
        ...analyzedRecords[result.value.index], page: result.value.page, document: result.value.document,
      };
    }
    anomalyResult = filterCorpusAnomalies(analyzedRecords.map((record) => record.document));
  }
  const analyzedCompetitors = anomalyResult.documents;
  warnings.push(...anomalyResult.warnings);
  if (!analyzedCompetitors.length) throw new Error("Не удалось получить содержательный корпус конкурентов");
  const own = analyzePrepared(ownPrepared, language);
  return {
    version: SNAPSHOT_VERSION, id: snapshotId(), createdAt: new Date().toISOString(), language, serpQuery,
    search: payload.search ?? {}, competitors: analyzedCompetitors.map(serializeDocument), own: serializeDocument(own), warnings,
  };
}

function roundTo50(value: number) { return Math.max(50, Math.round(value / 50) * 50); }

export async function analyzePayload(payload: AnalyzeRequest, dependencies: AnalyzeDependencies = {}) {
  const queries = parseQueries(payload);
  const payloadSerpQuery = typeof payload.serpQuery === "string" ? payload.serpQuery.trim() : "";
  const snapshotSerpQuery = typeof payload.snapshot?.serpQuery === "string" ? payload.snapshot.serpQuery.trim() : "";
  const serpQuery = payloadSerpQuery || snapshotSerpQuery || queries[0];
  let snapshot: CorpusSnapshot;
  if (payload.snapshot) {
    snapshot = normalizeClientSnapshot(payload.snapshot);
    const requestedLanguage = typeof payload.language === "string" ? payload.language.trim().toLowerCase() : "";
    if (requestedLanguage && requestedLanguage !== "auto" && requestedLanguage !== snapshot.language) {
      throw new Error("Для смены языка нужно обновить корпус конкурентов");
    }
  } else {
    snapshot = await buildSnapshot(payload, serpQuery, dependencies);
  }

  const language = snapshot.language;
  if (language === "ru") await initializeRussianMorphology(dependencies.assetOrigin);
  const boundedDocuments = [
    deserializeDocument(snapshot.own, language, "snapshot.own"),
    ...snapshot.competitors.slice(0, SNAPSHOT_COMPETITORS_MAXIMUM)
      .map((document, index) => deserializeDocument(document, language, `snapshot.competitors[${index}]`)),
  ];
  const ownPage = boundedDocuments[0];
  const competitors = boundedDocuments.slice(1);
  snapshot = {
    ...snapshot,
    own: serializeDocument(ownPage),
    competitors: competitors.map(serializeDocument),
  };
  const competitorCount = competitors.length;
  const queryTokens = tokenize(queries.join(" "), language);
  const queryTermAnalysis = countTerms(queryTokens);
  const queryTerms = queryTermAnalysis.forms;
  const queryKeySet = new Set(queryTermAnalysis.counts.keys());
  const stops = parseCustomStops(payload, language);
  const queryKeyWeights = [...queryTermAnalysis.counts.entries()].filter(([key]) => !stops.wordKeys.has(key));
  const queryNgramKeySet = new Set<string>();
  const queryPhraseForms: PhraseForms = new Map();
  for (const query of queries) {
    const analysis = countNgrams(tokenize(query, language));
    for (const key of analysis.counts.keys()) queryNgramKeySet.add(key);
    mergeForms(queryPhraseForms, analysis.forms);
  }
  const corpusForms: FormCounts = new Map();
  const corpusPhraseForms: PhraseForms = new Map();
  for (const document of competitors) { mergeForms(corpusForms, document.termForms); mergeForms(corpusPhraseForms, document.ngramForms); }
  mergeForms(corpusPhraseForms, queryPhraseForms);

  const structuralZones: AnalysisZone[] = ["title", "h1", "headings", "anchors"];
  const headingZones: AnalysisZone[] = ["title", "h1", "headings"];
  const structuralTermDocumentFrequency = new Map<string, number>();
  const structuralNgramDocumentFrequency = new Map<string, number>();
  for (const document of competitors) {
    const termKeys = new Set<string>();
    const ngramKeys = new Set<string>();
    for (const zone of structuralZones) {
      for (const key of document.zones[zone].termCounts.keys()) termKeys.add(key);
      for (const key of document.zones[zone].ngramCounts.keys()) ngramKeys.add(key);
    }
    for (const key of termKeys) increment(structuralTermDocumentFrequency, key);
    for (const key of ngramKeys) increment(structuralNgramDocumentFrequency, key);
  }

  const documentFrequency = new Map<string, number>();
  for (const document of competitors) for (const term of document.termCounts.keys()) increment(documentFrequency, term);
  const idf = (term: string) => Math.log((competitorCount + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1;
  const profiles = keywordProfiles(queries, competitors, language);
  const headingTermKeys = competitors.map((document) => {
    const keys = new Set<string>();
    for (const zone of headingZones) {
      for (const key of document.zones[zone].termCounts.keys()) keys.add(key);
    }
    return keys;
  });

  const ngramQueryLemmaCoverage = (key: string) => {
    const phraseKeys = [...new Set(key.split(/\s+/u).filter(Boolean))];
    if (!phraseKeys.length) return 0;
    return profiles.reduce((best, profile) => {
      const matches = phraseKeys.filter((phraseKey) => profile.termKeys.has(phraseKey)).length;
      return Math.max(best, matches / phraseKeys.length);
    }, 0);
  };

  const ngramHeadingCoverage = (key: string) => {
    const phraseKeys = [...new Set(key.split(/\s+/u).filter(Boolean))];
    if (!phraseKeys.length || !competitorCount) return 0;
    const matchingDocuments = headingTermKeys.filter((keys) => phraseKeys.every((phraseKey) => keys.has(phraseKey))).length;
    return matchingDocuments / competitorCount;
  };

  const smoothNgramImportance = (raw: number, maximum: number) => {
    if (!(raw > 0) || !(maximum > 0)) return 0;
    return 100 * Math.pow(Math.min(1, raw / maximum), .7);
  };

  const boostNgramImportance = (base: number, queryCoverage: number, headingCoverage: number) => {
    const boundedBase = Math.min(100, Math.max(0, base));
    const boundedQueryCoverage = Math.min(1, Math.max(0, queryCoverage));
    const headingRamp = Math.min(1, Math.max(0, (headingCoverage - .5) / .5));
    const afterQuery = boundedBase + (100 - boundedBase) * .6 * boundedQueryCoverage ** 2;
    return Math.min(100, afterQuery + (100 - afterQuery) * .15 * headingRamp);
  };

  const minSites = competitorCount >= 6 ? 3 : competitorCount >= 3 ? 2 : 1;
  const globalDensityContext = densityTargetContext(
    ownPage.wordCount,
    competitors.map((document) => document.wordCount),
  );
  const termUniverse = new Set([...competitors.flatMap((document) => [...document.termCounts.keys()]), ...queryKeySet]);
  const baseTerms: BaseRow[] = [...termUniverse].map((key) => {
    const counts = competitors.map((document) => document.termCounts.get(key) ?? 0);
    const frequencies = competitors.map((document, index) => frequency(counts[index], document.wordCount));
    const tfidfValues = competitors.map((document, index) => (counts[index] / Math.max(1, document.contentWordCount)) * idf(key) * 1_000);
    const sites = counts.filter((count) => count > 0).length;
    const ownCount = ownPage.termCounts.get(key) ?? 0;
    const ownFrequency = frequency(ownCount, ownPage.wordCount);
    const q25 = quantile(frequencies, .25);
    const medianFrequency = median(frequencies);
    const q75 = quantile(frequencies, .75);
    return {
      key, label: preferredForm(key, corpusForms.get(key), queryTerms, language), forms: topForms(corpusForms.get(key), language),
      counts, frequencies, sites, ownCount, ownFrequency, medianCount: median(counts), medianFrequency, q25, q75,
      averageFrequency: frequencies.reduce((sum, value) => sum + value, 0) / competitorCount,
      idf: idf(key), competitorTfidf: tfidfValues.reduce((sum, value) => sum + value, 0) / competitorCount,
      ownTfidf: (ownCount / Math.max(1, ownPage.contentWordCount)) * idf(key) * 1_000,
      status: statusFor(ownFrequency, q25, medianFrequency, q75, .08),
    };
  }).filter((row) => !stops.wordKeys.has(row.key) && (
    row.sites >= minSites
    || queryKeySet.has(row.key)
    || (structuralTermDocumentFrequency.get(row.key) ?? 0) >= 2
  ));

  const maxTermTfidf = Math.max(.0001, ...baseTerms.map((row) => row.competitorTfidf));
  const rawImportance = (tfidf: number, df: number, exactQueryMatch: boolean) =>
    tfidf * df * (exactQueryMatch ? 2 : 1) * (df >= .5 ? 1.15 : 1);
  const normalizedImportance = (raw: number, maximum: number) => maximum > 0 ? raw / maximum * 100 : 0;
  const termImportanceRaw = new Map(baseTerms.map((row) => {
    const df = row.sites / competitorCount;
    return [row.key, rawImportance(row.competitorTfidf, df, queryKeySet.has(row.key))];
  }));
  const maxTermImportanceRaw = Math.max(0, ...termImportanceRaw.values());
  const zoneBases = new Map<string, Record<AnalysisZone, {
    available: boolean;
    sites: number;
    ownCount: number;
    ownFrequency: number;
    medianCount: number;
    medianFrequency: number;
    q25Count: number;
    q75Count: number;
    q25Frequency: number;
    q75Frequency: number;
    competitorTfidf: number;
    densityFactor: number;
    benchmarkWords: number;
    ownWords: number;
    status: BaseRow["status"];
  }>>();
  for (const row of baseTerms) {
    zoneBases.set(row.key, Object.fromEntries(ANALYSIS_ZONES.map((zone) => {
      const competitorZones = competitors.map((document) => document.zones[zone]);
      const counts = competitorZones.map((value) => value.termCounts.get(row.key) ?? 0);
      const frequencies = competitorZones.map((value, index) => frequency(counts[index], value.wordCount));
      const sites = counts.filter((count) => count > 0).length;
      const zoneIdf = Math.log((competitorCount + 1) / (sites + 1)) + 1;
      const tfidfValues = competitorZones.map((value, index) =>
        (counts[index] / Math.max(1, value.contentWordCount)) * zoneIdf * 1_000);
      const ownZone = ownPage.zones[zone];
      const ownCount = ownZone.termCounts.get(row.key) ?? 0;
      const ownFrequency = frequency(ownCount, ownZone.wordCount);
      const q25Frequency = quantile(frequencies, .25);
      const medianFrequency = median(frequencies);
      const q75Frequency = quantile(frequencies, .75);
      const densityContext = densityTargetContext(
        ownZone.wordCount,
        competitorZones.filter((value) => value.available).map((value) => value.wordCount),
      );
      const q25Count = normalizedDensityTarget(quantile(counts, .25), densityContext.factor);
      const medianCount = normalizedDensityTarget(median(counts), densityContext.factor);
      const q75Count = Math.max(q25Count, normalizedDensityTarget(quantile(counts, .75), densityContext.factor));
      const frequencyStatus = statusFor(ownFrequency, q25Frequency, medianFrequency, q75Frequency, .08);
      return [zone, {
        available: ownZone.available || competitorZones.some((value) => value.available),
        sites,
        ownCount,
        ownFrequency,
        medianCount,
        medianFrequency,
        q25Count,
        q75Count,
        q25Frequency,
        q75Frequency,
        competitorTfidf: tfidfValues.reduce((sum, value) => sum + value, 0) / competitorCount,
        densityFactor: densityContext.factor,
        benchmarkWords: densityContext.benchmarkWords,
        ownWords: densityContext.ownWords,
        status: statusWithinDisplayedRange(frequencyStatus, ownCount, q25Count, q75Count),
      }];
    })) as Record<AnalysisZone, {
      available: boolean; sites: number; ownCount: number; ownFrequency: number; medianCount: number;
      medianFrequency: number; q25Count: number; q75Count: number; q25Frequency: number; q75Frequency: number;
      competitorTfidf: number; densityFactor: number; benchmarkWords: number; ownWords: number; status: BaseRow["status"];
    }>);
  }
  const maxZoneImportanceRaw = Object.fromEntries(ANALYSIS_ZONES.map((zone) => [zone, Math.max(
    0,
    ...baseTerms.map((row) => {
      const value = zoneBases.get(row.key)?.[zone];
      if (!value) return 0;
      const df = value.sites / competitorCount;
      return rawImportance(value.competitorTfidf, df, queryKeySet.has(row.key));
    }),
  )])) as Record<AnalysisZone, number>;
  const allTermRows = baseTerms.map((row) => {
    const df = row.sites / competitorCount;
    const tfidfNormalized = Math.min(1, row.competitorTfidf / maxTermTfidf);
    const matchingProfile = profiles.find((profile) => profile.termKeys.has(row.key));
    const keywordHit = queryKeySet.has(row.key);
    const normalized = normalizedImportance(termImportanceRaw.get(row.key) ?? 0, maxTermImportanceRaw);
    const importance = keywordHit ? Math.max(1, normalized) : normalized;
    const normalizedQ25Count = normalizedDensityTarget(quantile(row.counts, .25), globalDensityContext.factor);
    const normalizedMedianCount = normalizedDensityTarget(row.medianCount, globalDensityContext.factor);
    const normalizedQ75Count = Math.max(
      normalizedQ25Count,
      normalizedDensityTarget(quantile(row.counts, .75), globalDensityContext.factor),
    );
    const normalizedStatus = statusWithinDisplayedRange(
      row.status,
      row.ownCount,
      normalizedQ25Count,
      normalizedQ75Count,
    );
    const zones = Object.fromEntries(ANALYSIS_ZONES.map((zone) => {
      const value = zoneBases.get(row.key)![zone];
      const zoneDf = value.sites / competitorCount;
      const zoneRaw = rawImportance(value.competitorTfidf, zoneDf, keywordHit);
      const normalizedZoneImportance = normalizedImportance(zoneRaw, maxZoneImportanceRaw[zone]);
      const visibleEvidence = zoneRaw > 0 || value.ownCount > 0 || (zone === "all" && keywordHit);
      const zoneImportance = visibleEvidence ? Math.max(1, normalizedZoneImportance) : 0;
      return [zone, {
        available: value.available,
        sites: value.sites,
        ownCount: Math.ceil(value.ownCount),
        medianCount: value.medianCount,
        q25Count: value.q25Count,
        q75Count: value.q75Count,
        densityFactor: round(value.densityFactor, 3),
        benchmarkWords: value.benchmarkWords,
        ownWords: value.ownWords,
        importance: round(zoneImportance, 1),
        status: value.status,
      }];
    })) as Record<AnalysisZone, {
      available: boolean; sites: number; ownCount: number; medianCount: number; q25Count: number;
      q75Count: number; densityFactor: number; benchmarkWords: number; ownWords: number;
      importance: number; status: BaseRow["status"];
    }>;
    return {
      key: row.key, term: row.label, forms: row.forms, sites: row.sites, df: round(df, 3), coverage: round(df * 100, 0),
      ownCount: Math.ceil(row.ownCount), ownFrequency: round(row.ownFrequency, 2), medianCount: normalizedMedianCount,
      q25Count: normalizedQ25Count, q75Count: normalizedQ75Count,
      densityFactor: round(globalDensityContext.factor, 3), benchmarkWords: globalDensityContext.benchmarkWords,
      ownWords: globalDensityContext.ownWords,
      medianFrequency: round(row.medianFrequency, 2), q25: round(row.q25, 2), q75: round(row.q75, 2),
      averageFrequency: round(row.averageFrequency, 2), idf: round(row.idf, 3), competitorTfidf: round(row.competitorTfidf, 3),
      ownTfidf: round(row.ownTfidf, 3), tfidfNormalized: round(tfidfNormalized, 3),
      importance: round(importance, 1), keywordHit, bestKeyword: matchingProfile?.keyword ?? "", status: normalizedStatus, zones,
    };
  });
  const selectedTermKeys = new Set(
    [...allTermRows]
      .filter((row) => row.importance >= 1)
      .sort((a, b) => b.importance - a.importance || b.sites - a.sites || a.term.localeCompare(b.term, language))
      .slice(0, 300)
      .map((row) => row.key),
  );
  for (const zone of ANALYSIS_ZONES) {
    [...allTermRows]
      .filter((row) => row.zones[zone].importance >= 1)
      .sort((a, b) => b.zones[zone].importance - a.zones[zone].importance || b.importance - a.importance)
      .slice(0, 100)
      .forEach((row) => selectedTermKeys.add(row.key));
  }
  for (const key of queryKeySet) selectedTermKeys.add(key);
  const termRows = allTermRows
    .filter((row) => selectedTermKeys.has(row.key))
    .map((row) => ({ ...row, importance: Math.max(1, row.importance) }))
    .sort((a, b) => b.importance - a.importance || b.sites - a.sites || a.term.localeCompare(b.term, language));

  const ngramUniverse = new Set([
    ...competitors.flatMap((document) => [...document.ngramCounts.keys()]),
    ...queryNgramKeySet,
  ].filter((key) => !ngramIsStopped(key, stops)));
  const baseNgrams: BaseRow[] = [...ngramUniverse].map((key) => {
    const counts = competitors.map((document) => document.ngramCounts.get(key) ?? 0);
    const frequencies = competitors.map((document, index) => frequency(counts[index], Math.max(1, document.wordCount - 1)));
    const sites = counts.filter((count) => count > 0).length;
    const phraseIdf = Math.log((competitorCount + 1) / (sites + 1)) + 1;
    const tfidfValues = competitors.map((document, index) =>
      (counts[index] / Math.max(1, document.contentWordCount - 1)) * phraseIdf * 1_000);
    const ownCount = ownPage.ngramCounts.get(key) ?? 0;
    const ownFrequency = frequency(ownCount, Math.max(1, ownPage.wordCount - 1));
    const q25 = quantile(frequencies, .25);
    const medianFrequency = median(frequencies);
    const q75 = quantile(frequencies, .75);
    return {
      key,
      label: (queryNgramKeySet.has(key) ? topForms(queryPhraseForms.get(key), language, 1)[0] : "")
        || topForms(corpusPhraseForms.get(key), language, 1)[0]
        || key,
      forms: topForms(corpusPhraseForms.get(key), language, 3),
      counts, frequencies, sites, ownCount, ownFrequency, medianCount: median(counts), medianFrequency, q25, q75,
      averageFrequency: frequencies.reduce((sum, value) => sum + value, 0) / competitorCount,
      idf: phraseIdf,
      competitorTfidf: tfidfValues.reduce((sum, value) => sum + value, 0) / competitorCount,
      ownTfidf: (ownCount / Math.max(1, ownPage.contentWordCount - 1)) * phraseIdf * 1_000,
      status: statusFor(ownFrequency, q25, medianFrequency, q75, .05),
    };
  }).filter((row) => row.sites >= minSites
    || queryNgramKeySet.has(row.key)
    || (structuralNgramDocumentFrequency.get(row.key) ?? 0) >= 2);
  const ngramLabels = new Map(baseNgrams.map((row) => [row.key, row.label]));

  const maxNgramTfidf = Math.max(.0001, ...baseNgrams.map((row) => row.competitorTfidf));
  const ngramDocumentWeightRaw = new Map(baseNgrams.map((row) => [
    row.key,
    row.competitorTfidf * (row.sites / competitorCount),
  ]));
  const maxNgramDocumentWeightRaw = Math.max(0, ...ngramDocumentWeightRaw.values());
  const ngramDocumentWeights = new Map([...ngramDocumentWeightRaw].map(([key, raw]) => [
    key,
    normalizedImportance(raw, maxNgramDocumentWeightRaw),
  ]));
  const ngramSemanticResolution = await resolveNgramSemantics({
    rows: baseNgrams,
    queries,
    profiles,
    language,
    requestId: snapshot.id,
    snapshotCache: snapshot.phraseSimilarity,
    provider: dependencies.phraseSimilarity,
    allowService: !payload.snapshot,
  });
  const ngramSemantics = ngramSemanticResolution.values;
  if (!payload.snapshot && ngramSemanticResolution.cache) {
    snapshot = { ...snapshot, phraseSimilarity: ngramSemanticResolution.cache };
  }
  const ngramImportanceRaw = new Map(baseNgrams.map((row) => {
    const df = row.sites / competitorCount;
    return [row.key, df * (ngramSemantics.get(row.key)?.keySimilarity ?? 0)];
  }));
  const maxNgramImportanceRaw = Math.max(0, ...ngramImportanceRaw.values());
  const ngramZoneBases = new Map<string, Record<AnalysisZone, {
    available: boolean; sites: number; ownCount: number; medianCount: number; q25Count: number; q75Count: number;
    frequencies: number[]; ownFrequency: number; medianFrequency: number; q25Frequency: number; q75Frequency: number;
    competitorTfidf: number; densityFactor: number; benchmarkWords: number; ownWords: number; status: BaseRow["status"];
  }>>();
  for (const row of baseNgrams) {
    ngramZoneBases.set(row.key, Object.fromEntries(ANALYSIS_ZONES.map((zone) => {
      const competitorZones = competitors.map((document) => document.zones[zone]);
      const counts = competitorZones.map((value) => value.ngramCounts.get(row.key) ?? 0);
      const frequencies = competitorZones.map((value, index) => frequency(counts[index], Math.max(1, value.wordCount - 1)));
      const sites = counts.filter((count) => count > 0).length;
      const zoneIdf = Math.log((competitorCount + 1) / (sites + 1)) + 1;
      const tfidfValues = competitorZones.map((value, index) =>
        (counts[index] / Math.max(1, value.contentWordCount - 1)) * zoneIdf * 1_000);
      const ownZone = ownPage.zones[zone];
      const ownCount = ownZone.ngramCounts.get(row.key) ?? 0;
      const ownFrequency = frequency(ownCount, Math.max(1, ownZone.wordCount - 1));
      const q25Frequency = quantile(frequencies, .25);
      const medianFrequency = median(frequencies);
      const q75Frequency = quantile(frequencies, .75);
      const densityContext = densityTargetContext(
        ownZone.wordCount,
        competitorZones.filter((value) => value.available).map((value) => value.wordCount),
      );
      const q25Count = normalizedDensityTarget(quantile(counts, .25), densityContext.factor);
      const medianCount = normalizedDensityTarget(median(counts), densityContext.factor);
      const q75Count = Math.max(q25Count, normalizedDensityTarget(quantile(counts, .75), densityContext.factor));
      const frequencyStatus = statusFor(ownFrequency, q25Frequency, medianFrequency, q75Frequency, .05);
      return [zone, {
        available: ownZone.available || competitorZones.some((value) => value.available), sites, ownCount,
        medianCount, q25Count, q75Count,
        frequencies, ownFrequency, medianFrequency, q25Frequency, q75Frequency,
        competitorTfidf: tfidfValues.reduce((sum, value) => sum + value, 0) / competitorCount,
        densityFactor: densityContext.factor,
        benchmarkWords: densityContext.benchmarkWords,
        ownWords: densityContext.ownWords,
        status: statusWithinDisplayedRange(frequencyStatus, ownCount, q25Count, q75Count),
      }];
    })) as Record<AnalysisZone, {
      available: boolean; sites: number; ownCount: number; medianCount: number; q25Count: number; q75Count: number;
      frequencies: number[]; ownFrequency: number; medianFrequency: number; q25Frequency: number; q75Frequency: number;
      competitorTfidf: number; densityFactor: number; benchmarkWords: number; ownWords: number; status: BaseRow["status"];
    }>);
  }
  const maxNgramZoneImportanceRaw = Object.fromEntries(ANALYSIS_ZONES.map((zone) => [zone, Math.max(
    0,
    ...baseNgrams.map((row) => {
      const value = ngramZoneBases.get(row.key)?.[zone];
      if (!value) return 0;
      const df = value.sites / competitorCount;
      return df * (ngramSemantics.get(row.key)?.keySimilarity ?? 0);
    }),
  )])) as Record<AnalysisZone, number>;
  const allNgramRows = baseNgrams.map((row) => {
    const semantic = ngramSemantics.get(row.key) ?? { keySimilarity: 0, bestKeyword: profiles[0]?.keyword ?? "" };
    const df = row.sites / competitorCount;
    const tfidfNormalized = Math.min(1, row.competitorTfidf / maxNgramTfidf);
    const exactQueryMatch = queryNgramKeySet.has(row.key);
    const queryLemmaCoverage = ngramQueryLemmaCoverage(row.key);
    const headingCoverage = ngramHeadingCoverage(row.key);
    const normalized = smoothNgramImportance(ngramImportanceRaw.get(row.key) ?? 0, maxNgramImportanceRaw);
    const importance = boostNgramImportance(normalized, queryLemmaCoverage, headingCoverage);
    const priority = importance * editGap(row.status, row.ownFrequency, row.medianFrequency, row.q75);
    const normalizedQ25Count = normalizedDensityTarget(quantile(row.counts, .25), globalDensityContext.factor);
    const normalizedMedianCount = normalizedDensityTarget(row.medianCount, globalDensityContext.factor);
    const normalizedQ75Count = Math.max(
      normalizedQ25Count,
      normalizedDensityTarget(quantile(row.counts, .75), globalDensityContext.factor),
    );
    const normalizedStatus = statusWithinDisplayedRange(
      row.status,
      row.ownCount,
      normalizedQ25Count,
      normalizedQ75Count,
    );
    const zones = Object.fromEntries(ANALYSIS_ZONES.map((zone) => {
      const value = ngramZoneBases.get(row.key)![zone];
      const competitorZones = competitors.map((document) => document.zones[zone]);
      const ownZone = ownPage.zones[zone];
      const zoneDf = value.sites / competitorCount;
      const zoneRaw = zoneDf * semantic.keySimilarity;
      const normalizedZoneImportance = smoothNgramImportance(zoneRaw, maxNgramZoneImportanceRaw[zone]);
      const boostedZoneImportance = boostNgramImportance(normalizedZoneImportance, queryLemmaCoverage, headingCoverage);
      const visibleEvidence = zoneRaw > 0 || value.ownCount > 0 || (zone === "all" && queryLemmaCoverage > 0);
      const zoneImportance = visibleEvidence ? Math.max(1, boostedZoneImportance) : 0;
      return [zone, {
        available: value.available,
        sites: value.sites,
        ownCount: Math.ceil(value.ownCount),
        medianCount: value.medianCount,
        q25Count: value.q25Count,
        q75Count: value.q75Count,
        densityFactor: round(value.densityFactor, 3),
        benchmarkWords: value.benchmarkWords,
        ownWords: value.ownWords,
        importance: round(zoneImportance, 1),
        status: value.status,
        nesting: ngramNestingReport(row.key, competitorZones, ownZone, ngramLabels),
      }];
    })) as Record<AnalysisZone, {
      available: boolean; sites: number; ownCount: number; medianCount: number; q25Count: number;
      q75Count: number; densityFactor: number; benchmarkWords: number; ownWords: number;
      importance: number; status: BaseRow["status"]; nesting: ReturnType<typeof ngramNestingReport>;
    }>;
    return {
      key: row.key, phrase: row.label, forms: row.forms, sites: row.sites, df: round(df, 3), coverage: round(df * 100, 0),
      ownCount: Math.ceil(row.ownCount), ownFrequency: round(row.ownFrequency, 2), medianCount: normalizedMedianCount,
      q25Count: normalizedQ25Count, q75Count: normalizedQ75Count,
      densityFactor: round(globalDensityContext.factor, 3), benchmarkWords: globalDensityContext.benchmarkWords,
      ownWords: globalDensityContext.ownWords,
      medianFrequency: round(row.medianFrequency, 2), q25: round(row.q25, 2), q75: round(row.q75, 2), idf: round(row.idf, 3),
      competitorTfidf: round(row.competitorTfidf, 3), tfidfNormalized: round(tfidfNormalized, 3), keySimilarity: round(semantic.keySimilarity, 3),
      importance: round(Math.max(1, importance), 1), priority: round(priority, 1), bestKeyword: semantic.bestKeyword,
      keywordHit: exactQueryMatch,
      keyMatch: exactQueryMatch ? "exact" : semantic.keySimilarity > 0.8 ? "possible" : "none",
      status: normalizedStatus,
      nesting: ngramNestingReport(row.key, competitors, ownPage, ngramLabels),
      zones,
    };
  });
  const selectedNgramKeys = new Set(
    [...allNgramRows]
      .filter((row) => row.importance >= 1)
      .sort((a, b) => b.importance - a.importance || b.keySimilarity - a.keySimilarity || b.sites - a.sites)
      .slice(0, 200)
      .map((row) => row.key),
  );
  for (const zone of ANALYSIS_ZONES) {
    [...allNgramRows]
      .filter((row) => row.zones[zone].importance >= 1)
      .sort((a, b) => b.zones[zone].importance - a.zones[zone].importance || b.importance - a.importance)
      .slice(0, 100)
      .forEach((row) => selectedNgramKeys.add(row.key));
  }
  // Keep a global importance union alongside the per-zone selections so that
  // a strong phrase cannot disappear merely because another HTML zone is noisy.
  [...allNgramRows]
    .sort((a, b) => b.importance - a.importance || b.sites - a.sites || a.key.localeCompare(b.key))
    .slice(0, 20)
    .forEach((row) => selectedNgramKeys.add(row.key));
  for (const key of queryNgramKeySet) selectedNgramKeys.add(key);
  const ngramRows = allNgramRows
    .filter((row) => selectedNgramKeys.has(row.key))
    .map((row) => ({ ...row, importance: Math.max(1, row.importance) }))
    .sort((a, b) => b.importance - a.importance || b.keySimilarity - a.keySimilarity || b.sites - a.sites);

  const importantTerms = [...termRows].sort((a, b) => b.importance - a.importance).slice(0, 30);
  const rawTermTargets = new Map(baseTerms.map((row) => [row.key, Math.max(1, Math.ceil(row.medianCount))]));
  const importantNgrams = baseNgrams
    .map((row) => ({
      key: row.key,
      importance: ngramDocumentWeights.get(row.key) ?? 0,
      targetCount: Math.max(1, Math.ceil(row.medianCount)),
      sites: row.sites,
    }))
    .filter((row) => row.importance > 0)
    .sort((a, b) => b.importance - a.importance || b.sites - a.sites || a.key.localeCompare(b.key, language))
    .slice(0, 20);
  const importantSignals = [
    ...importantTerms.map((row) => ({
      key: row.key,
      importance: row.importance,
      targetCount: rawTermTargets.get(row.key) ?? 1,
      kind: "term" as const,
    })),
    ...importantNgrams.map((row) => ({ key: row.key, importance: row.importance, targetCount: row.targetCount, kind: "ngram" as const })),
  ];
  const competitorDocumentWords = competitors.map((document) => document.wordCount);
  const weightedCoverageFor = (document: DocumentAnalysis) => {
    let earned = 0, possible = 0;
    for (const signal of importantSignals) {
      const weight = Math.max(0, signal.importance);
      const count = signal.kind === "term"
        ? document.termCounts.get(signal.key) ?? 0
        : document.ngramCounts.get(signal.key) ?? 0;
      earned += weight * (count > 0 ? 1 : 0);
      possible += weight;
    }
    return possible ? earned / possible * 100 : 0;
  };
  const weightedDensityFor = (document: DocumentAnalysis) => {
    let earned = 0, possible = 0;
    const documentDensityContext = densityTargetContext(document.wordCount, competitorDocumentWords);
    for (const signal of importantSignals) {
      const weight = Math.max(0, signal.importance);
      const count = signal.kind === "term"
        ? document.termCounts.get(signal.key) ?? 0
        : document.ngramCounts.get(signal.key) ?? 0;
      const targetCount = normalizedDensityTarget(signal.targetCount, documentDensityContext.factor);
      const density = Math.min(1, count / targetCount);
      earned += weight * density;
      possible += weight;
    }
    return possible ? earned / possible * 100 : 0;
  };
  const queryWeightTotal = queryKeyWeights.reduce((sum, [, weight]) => sum + weight, 0);
  const keyTfidfRawFor = (document: DocumentAnalysis) => {
    if (!queryWeightTotal) return 0;
    const contentWords = Math.max(1, document.contentWordCount);
    const weightedTfidf = queryKeyWeights.reduce((sum, [key, weight]) => {
      const count = document.termCounts.get(key) ?? 0;
      const tfidfPerThousand = count / contentWords * idf(key) * 1_000;
      return sum + weight * tfidfPerThousand;
    }, 0);
    return weightedTfidf / queryWeightTotal;
  };
  const competitorKeyTfidfRaw = competitors.map(keyTfidfRawFor);
  const q75KeyTfidfRaw = quantile(competitorKeyTfidfRaw, .75);
  const positiveKeyTfidfMaximum = Math.max(0, ...competitorKeyTfidfRaw.filter((value) => value > 0));
  const keyTfidfBenchmark = q75KeyTfidfRaw > 0 ? q75KeyTfidfRaw : positiveKeyTfidfMaximum;
  const keyTfidfScoreFor = (raw: number) => keyTfidfBenchmark > 0
    ? Math.min(100, Math.max(0, raw / keyTfidfBenchmark * 100))
    : raw > 0 ? 100 : 0;

  const serializeReportDocument = (document: DocumentAnalysis, ours = false) => {
    const keyTfidfRaw = keyTfidfRawFor(document);
    return {
      name: document.name, url: document.url, position: document.position, title: document.title,
      words: document.wordCount, contentWords: document.contentWordCount, uniqueTerms: document.uniqueTerms,
      headings: document.headings, sentences: document.sentences, truncated: document.truncated,
      source: document.source, qualityScore: Math.round(document.qualityScore),
      keyTfidfScore: round(keyTfidfScoreFor(keyTfidfRaw), 1),
      keyTfidfRaw: round(keyTfidfRaw, 3),
      weightedCoverage: round(weightedCoverageFor(document), 1),
      weightedDensity: round(weightedDensityFor(document), 1),
      ours,
    };
  };
  const competitorDocuments = competitors.map((document) => serializeReportDocument(document));
  const ownDocument = serializeReportDocument(ownPage, true);
  const documents = [...competitorDocuments, ownDocument].sort((a, b) =>
    b.keyTfidfScore - a.keyTfidfScore
    || b.weightedCoverage - a.weightedCoverage
    || b.weightedDensity - a.weightedDensity);

  const wordCounts = competitors.map((document) => document.wordCount);
  const medianWords = median(wordCounts);
  const recommendedMin = roundTo50(quantile(wordCounts, .25));
  const recommendedMax = Math.max(recommendedMin, roundTo50(quantile(wordCounts, .75)));
  const missing = termRows.filter((row) => row.status === "Добавить").slice(0, 5).map((row) => row.term);
  const recommendation = missing.length
    ? `Приоритетные темы для расширения: ${missing.join(", ")}.`
    : "Критичных тематических пробелов относительно конкурентного диапазона не найдено.";

  type CloudWord = { key: string; word: string; count: number; weight: number; frequency: number; sites: number };
  const cloudLimit = 60;
  const safeRound = (value: number, digits = 2) => Number.isFinite(value) ? round(value, digits) : 0;
  const zoneSiteCounts = {} as Record<AnalysisZone, Map<string, number>>;
  const cloudZones = Object.fromEntries(ANALYSIS_ZONES.map((zone) => {
    const siteCounts = new Map<string, number>();
    const aggregateForms: FormCounts = new Map();
    const keys = new Set<string>();
    for (const document of competitors) {
      const value = document.zones[zone];
      mergeForms(aggregateForms, value.termForms);
      for (const [key, count] of value.termCounts) {
        if (count <= 0 || stops.wordKeys.has(key)) continue;
        keys.add(key);
        increment(siteCounts, key);
      }
    }
    zoneSiteCounts[zone] = siteCounts;
    const competitorWords: CloudWord[] = [...keys].map((key) => {
      let totalCount = 0;
      let totalFrequency = 0;
      for (const document of competitors) {
        const value = document.zones[zone];
        const count = Math.max(0, value.termCounts.get(key) ?? 0);
        totalCount += count;
        totalFrequency += frequency(count, value.wordCount);
      }
      const meanCount = competitorCount ? totalCount / competitorCount : 0;
      const meanFrequency = competitorCount ? totalFrequency / competitorCount : 0;
      return {
        key,
        word: preferredForm(key, aggregateForms.get(key), queryTerms, language),
        count: safeRound(meanCount),
        weight: safeRound(meanFrequency),
        frequency: safeRound(meanFrequency),
        sites: siteCounts.get(key) ?? 0,
      };
    }).filter((row) => row.count > 0)
      .sort((left, right) => right.weight - left.weight || right.sites - left.sites || left.word.localeCompare(right.word, language))
      .slice(0, cloudLimit);

    const ownZone = ownPage.zones[zone];
    const ownWords: CloudWord[] = !ownZone.available ? [] : [...ownZone.termCounts.entries()]
      .filter(([key, count]) => count > 0 && !stops.wordKeys.has(key))
      .map(([key, rawCount]) => {
        const count = Math.max(0, Math.trunc(rawCount));
        const termFrequency = safeRound(frequency(count, ownZone.wordCount));
        return {
          key,
          word: preferredForm(key, ownZone.termForms.get(key), queryTerms, language),
          count,
          weight: termFrequency,
          frequency: termFrequency,
          sites: siteCounts.get(key) ?? 0,
        };
      }).sort((left, right) => right.weight - left.weight || right.count - left.count || left.word.localeCompare(right.word, language))
      .slice(0, cloudLimit);
    return [zone, { competitors: competitorWords, own: ownWords }];
  })) as Record<AnalysisZone, { competitors: CloudWord[]; own: CloudWord[] }>;
  const competitorCloud = cloudZones.all.competitors;
  const ownCloud = cloudZones.all.own;

  const documentCloudForZone = (document: DocumentAnalysis, zone: AnalysisZone): CloudWord[] => {
    const value = document.zones[zone];
    if (!value.available) return [];
    const siteCounts = zoneSiteCounts[zone];
    return [...value.termCounts.entries()]
      .filter(([key, count]) => count > 0 && !stops.wordKeys.has(key))
      .map(([key, rawCount]) => {
        const count = Math.max(0, Math.trunc(rawCount));
        const termFrequency = safeRound(frequency(count, value.wordCount));
        return {
          key,
          word: preferredForm(key, value.termForms.get(key), queryTerms, language),
          count,
          weight: termFrequency,
          frequency: termFrequency,
          sites: siteCounts.get(key) ?? 0,
        };
      }).sort((left, right) => right.weight - left.weight || right.count - left.count || left.word.localeCompare(right.word, language))
      .slice(0, cloudLimit);
  };

  const profileTerms = termRows;
  const comparisonProfiles = competitors.map((document, index) => {
    const identity = document.url || document.name;
    const cloudZones = Object.fromEntries(ANALYSIS_ZONES.map((zone) =>
      [zone, documentCloudForZone(document, zone)])) as Record<AnalysisZone, CloudWord[]>;
    const cloud = cloudZones.all;
    return {
      id: `competitor-${hashValue(identity).toString(36)}`,
      name: document.name,
      url: document.url,
      position: document.position ?? index + 1,
      wordCount: Math.max(0, Math.trunc(document.wordCount)),
      lemmas: profileTerms.map((row) => {
        const count = Math.max(0, Math.trunc(document.termCounts.get(row.key) ?? 0));
        const zones = Object.fromEntries(ANALYSIS_ZONES.map((zone) => {
          const value = document.zones[zone];
          const zoneCount = Math.max(0, Math.trunc(value.termCounts.get(row.key) ?? 0));
          return [zone, {
            available: value.available,
            count: zoneCount,
            frequency: round(frequency(zoneCount, value.wordCount), 2),
          }];
        })) as Record<AnalysisZone, { available: boolean; count: number; frequency: number }>;
        return { key: row.key, lemma: row.term, count, frequency: round(frequency(count, document.wordCount), 2), zones };
      }),
      cloud,
      cloudZones,
    };
  });

  return {
    meta: {
      query: queries.join(", "), queries, serpQuery, analyzedAt: new Date().toISOString(),
      competitorsFound: snapshot.search.found ?? snapshot.competitors.length,
      competitorsRequested: snapshot.competitors.length + snapshot.warnings.length,
      competitorsAnalyzed: competitorCount,
      engine: snapshot.search.engine ?? "yandex", region: snapshot.search.region ?? "", device: snapshot.search.device ?? "desktop",
      language, languageLabel: LANGUAGE_CONFIGS[language]?.label ?? language,
      morphologyMode: LANGUAGE_CONFIGS[language]?.morphology ?? "tokens",
      morphologyLabel: LANGUAGE_CONFIGS[language]?.morphology === "lemmatization"
        ? "Словарная лемматизация Az.Morph"
        : LANGUAGE_CONFIGS[language]?.morphology === "stemming"
          ? "Стемминг Snowball"
          : "Токенизация без склейки словоформ",
      builtInStopwords: Boolean(LANGUAGE_CONFIGS[language]?.stopwords),
      confidence: competitorCount >= 6 ? "high" : competitorCount >= 3 ? "medium" : "low",
      phraseSimilarityMethod: ngramSemanticResolution.source === "e5-service"
        ? "Multilingual E5"
        : ngramSemanticResolution.source === "e5-cache"
          ? "Multilingual E5 — кэш snapshot"
          : "Локальный резервный алгоритм",
      phraseSimilarityEngine: ngramSemanticResolution.source === "local" ? "local" : "e5",
      phraseSimilarityModel: ngramSemanticResolution.model,
      phraseSimilarityRevision: ngramSemanticResolution.revision,
      phraseSimilarityCached: ngramSemanticResolution.source === "e5-cache",
      phraseSimilarityCoverage: round(ngramSemanticResolution.coverage * 100, 1),
      phraseSimilarityError: ngramSemanticResolution.error,
      snapshotId: snapshot.id,
      stopWords: stops.stopWords, stopPhrases: stops.stopPhrases,
    },
    summary: {
      keyTfidfScore: ownDocument.keyTfidfScore,
      keyTfidfRaw: ownDocument.keyTfidfRaw,
      weightedCoverage: ownDocument.weightedCoverage,
      weightedDensity: ownDocument.weightedDensity,
      ownWords: ownPage.wordCount, medianWords: round(medianWords, 0),
      recommendedMin, recommendedMax, recommendation,
    },
    terms: termRows,
    lemmas: termRows,
    ngrams: ngramRows,
    clouds: { competitors: competitorCloud, own: ownCloud, zones: cloudZones },
    chart: termRows.filter((row) => row.status === "Добавить").slice(0, 12).map((row) => ({ term: row.term, competitors: row.medianFrequency, own: row.ownFrequency, q25: row.q25, q75: row.q75 })),
    documents,
    comparisonProfiles,
    warnings: snapshot.warnings,
    snapshot,
    methodology: {
      frequencyUnit: "Частота нормируется относительно объёма видимого текста, чтобы страницы разной длины можно было сравнивать.",
      benchmark: "Ключевой TF-IDF страницы сравнивается с верхним квартилем принятых конкурентов; для пустого ориентира применяется устойчивый резервный эталон.",
      tfidf: "TF-IDF рассчитывается по корпусу принятых конкурентов с учётом документов без вхождений.",
      importance: "Важность рассчитывается по совокупности статистических и семантических сигналов релевантности.",
      keyTfidfRaw: "Сырой ключевой TF-IDF отражает присутствие уникальных лемм входных ключей с учётом их повторяемости в наборе запросов; пользовательские стоп-леммы исключаются.",
      keyTfidfScore: "Итоговый балл ключевого TF-IDF показывает положение страницы относительно устойчивого конкурентного ориентира.",
      weightedCoverage: "Взвешенный охват показывает, какая доля важных лемм и фраз присутствует на странице; повторные вхождения не увеличивают охват.",
      weightedDensity: "Взвешенное выполнение ориентиров показывает, насколько фактические количества важных лемм и фраз достигают конкурентных медиан, нормированных под объём каждого документа. Ориентиры округляются вверх и не бывают меньше одного; превышение цели не даёт дополнительного балла.",
      phraseSimilarity: "Сходство N-грамм с ключами рассчитывается Multilingual E5, когда локальный сервис подключён; при его отсутствии применяется детерминированный резервный алгоритм. Сигнал участвует только в важности N-грамм и не входит в метрики документов.",
    },
  };
}
