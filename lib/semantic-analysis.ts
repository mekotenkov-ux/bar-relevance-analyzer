import snowballFactory from "snowball-stemmers";
import * as stopwordModule from "stopword";

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
  useFirecrawl?: boolean;
  stopWords?: string | string[];
  stopPhrases?: string | string[];
  tripletsEnabled?: boolean;
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
};
type SerializedZoneAnalysis = Omit<ZoneAnalysis, "termCounts" | "termForms" | "ngramCounts"> & {
  termCounts: Array<[string, number]>;
  termForms: Array<[string, Array<[string, number]>]>;
  ngramCounts: Array<[string, number]>;
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
export type SnapshotSentence = {
  id: string;
  text: string;
  tokenKeys: string[];
  tokenCount: number;
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
  sentenceCorpus: SnapshotSentence[];
  sentenceCorpusTruncated: boolean;
  termCounts: Map<string, number>;
  termForms: FormCounts;
  ngramCounts: Map<string, number>;
  ngramForms: PhraseForms;
  zones: Record<AnalysisZone, ZoneAnalysis>;
};
type SerializedDocument = Omit<DocumentAnalysis, "termCounts" | "termForms" | "ngramCounts" | "ngramForms" | "zones"> & {
  termCounts: Array<[string, number]>;
  termForms: Array<[string, Array<[string, number]>]>;
  ngramCounts: Array<[string, number]>;
  ngramForms: Array<[string, Array<[string, number]>]>;
  zones: Record<AnalysisZone, SerializedZoneAnalysis>;
};
type LanguageConfig = { label: string; stemmer?: string; stopwords?: string };
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
const SNAPSHOT_VERSION = 5;
// Sentence corpora are reused by the optional local syntax analysis. Keep a
// high per-document integrity guard, but do not reduce normal pages to a small
// representative sample: the source page is already bounded by MAX_TEXT_LENGTH.
const SNAPSHOT_SENTENCES_PER_DOCUMENT = 5_000;
const SNAPSHOT_SENTENCE_TOKENS_PER_DOCUMENT = 80_000;
const SNAPSHOT_SENTENCE_MAX_CHARACTERS = 1_000;
const SNAPSHOT_SENTENCES_TOTAL_BASE = 10_000;
const SNAPSHOT_SENTENCES_PER_SOURCE = 5_000;
const SNAPSHOT_SENTENCES_TOTAL_MAXIMUM = 100_000;
const SNAPSHOT_SENTENCE_TOKENS_TOTAL_BASE = 160_000;
const SNAPSHOT_SENTENCE_TOKENS_PER_SOURCE = 80_000;
const SNAPSHOT_SENTENCE_TOKENS_TOTAL_MAXIMUM = 4_000_000;
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

export const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  ar: { label: "العربية", stemmer: "arabic", stopwords: "ara" },
  hy: { label: "Հայերեն", stemmer: "armenian", stopwords: "hye" },
  eu: { label: "Euskara", stemmer: "basque", stopwords: "eus" },
  bg: { label: "Български", stopwords: "bul" },
  ca: { label: "Català", stemmer: "catalan", stopwords: "cat" },
  zh: { label: "中文", stopwords: "zho" },
  hr: { label: "Hrvatski", stopwords: "hrv" },
  cs: { label: "Čeština", stemmer: "czech", stopwords: "ces" },
  da: { label: "Dansk", stemmer: "danish", stopwords: "dan" },
  nl: { label: "Nederlands", stemmer: "dutch", stopwords: "nld" },
  en: { label: "English", stemmer: "english", stopwords: "eng" },
  et: { label: "Eesti", stopwords: "est" },
  fi: { label: "Suomi", stemmer: "finnish", stopwords: "fin" },
  fr: { label: "Français", stemmer: "french", stopwords: "fra" },
  de: { label: "Deutsch", stemmer: "german", stopwords: "deu" },
  el: { label: "Ελληνικά", stopwords: "ell" },
  he: { label: "עברית", stopwords: "heb" },
  hi: { label: "हिन्दी", stopwords: "hin" },
  hu: { label: "Magyar", stemmer: "hungarian", stopwords: "hun" },
  id: { label: "Bahasa Indonesia", stopwords: "ind" },
  ga: { label: "Gaeilge", stemmer: "irish", stopwords: "gle" },
  it: { label: "Italiano", stemmer: "italian", stopwords: "ita" },
  ja: { label: "日本語", stopwords: "jpn" },
  ko: { label: "한국어", stopwords: "kor" },
  lv: { label: "Latviešu", stopwords: "lav" },
  lt: { label: "Lietuvių", stopwords: "lit" },
  no: { label: "Norsk", stemmer: "norwegian", stopwords: "nob" },
  fa: { label: "فارسی", stopwords: "fas" },
  pl: { label: "Polski", stopwords: "pol" },
  pt: { label: "Português", stemmer: "portuguese", stopwords: "por" },
  ro: { label: "Română", stemmer: "romanian", stopwords: "ron" },
  ru: { label: "Русский", stemmer: "russian", stopwords: "rus" },
  sr: { label: "Српски", stopwords: "srp" },
  sk: { label: "Slovenčina", stopwords: "slk" },
  sl: { label: "Slovenščina", stemmer: "slovene", stopwords: "slv" },
  es: { label: "Español", stemmer: "spanish", stopwords: "spa" },
  sw: { label: "Kiswahili", stopwords: "swa" },
  sv: { label: "Svenska", stemmer: "swedish", stopwords: "swe" },
  ta: { label: "தமிழ்", stemmer: "tamil" },
  th: { label: "ไทย", stopwords: "tha" },
  tr: { label: "Türkçe", stemmer: "turkish", stopwords: "tur" },
  uk: { label: "Українська", stopwords: "ukr" },
  ur: { label: "اردو", stopwords: "urd" },
  vi: { label: "Tiếng Việt", stopwords: "vie" },
};

const stopwordExports = stopwordModule as unknown as Record<string, readonly string[]>;
const stopwordCache = new Map<string, Set<string>>();
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
  const result = new Set(words.map((word) => normalizeSurface(String(word), language)).filter(Boolean));
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
    return { surface, key: termKey(surface, language), stop: stopwords.has(surface), meaningful };
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

function countNgrams(tokens: Token[]) {
  const counts = new Map<string, number>();
  const forms: PhraseForms = new Map();
  for (let size = 2; size <= 3; size += 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const slice = tokens.slice(index, index + size);
      if (slice.some((token) => token.stop || !token.meaningful || /^\d+$/u.test(token.surface))) continue;
      if (new Set(slice.map((token) => token.key)).size === 1) continue;
      const key = slice.map((token) => token.key).join(" ");
      const surface = slice.map((token) => token.surface).join(" ");
      increment(counts, key);
      addForm(forms, key, surface);
    }
  }
  return { counts, forms };
}

function countNgramBlocks(blocks: string[], language: string) {
  const counts = new Map<string, number>();
  const forms: PhraseForms = new Map();
  for (const block of blocks) {
    const current = countNgrams(tokenize(block, language));
    for (const [key, count] of current.counts) increment(counts, key, count);
    mergeForms(forms, current.forms);
  }
  return { counts, forms };
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

function sentenceSegments(text: string, language: string) {
  try {
    return [...new Intl.Segmenter(language, { granularity: "sentence" }).segment(text)]
      .map((part) => part.segment.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  } catch {
    return (text.match(/[^.!?\u2026]+(?:[.!?\u2026]+|$)/gu) ?? [])
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }
}

function boundedSentenceCorpus(blocks: string[], language: string) {
  const sentences: SnapshotSentence[] = [];
  const seen = new Set<string>();
  let storedTokens = 0;
  for (const block of blocks) {
    for (const rawSentence of sentenceSegments(block, language)) {
      if (sentences.length >= SNAPSHOT_SENTENCES_PER_DOCUMENT || storedTokens >= SNAPSHOT_SENTENCE_TOKENS_PER_DOCUMENT) {
        return { sentences, truncated: true };
      }
      const text = rawSentence.length <= SNAPSHOT_SENTENCE_MAX_CHARACTERS
        ? rawSentence
        : rawSentence.slice(0, SNAPSHOT_SENTENCE_MAX_CHARACTERS).replace(/\s+\S*$/u, "").trim();
      if (!text) continue;
      let normalized: string;
      try { normalized = text.normalize("NFKC").toLocaleLowerCase(language).replace(/\s+/g, " "); }
      catch { normalized = text.normalize("NFKC").toLowerCase().replace(/\s+/g, " "); }
      if (seen.has(normalized)) continue;
      const tokens = tokenize(text, language);
      if (contentTokens(tokens).length < 2 || !tokens.length) continue;
      const remainingTokens = SNAPSHOT_SENTENCE_TOKENS_PER_DOCUMENT - storedTokens;
      if (tokens.length > remainingTokens) return { sentences, truncated: true };
      seen.add(normalized);
      storedTokens += tokens.length;
      sentences.push({
        id: `s${sentences.length + 1}`,
        text,
        tokenKeys: tokens.map((token) => token.key),
        tokenCount: tokens.length,
      });
    }
  }
  return { sentences, truncated: false };
}

function globallyBoundSentenceCorpora(documents: DocumentAnalysis[]) {
  const bounded = documents.map((document) => ({ ...document, sentenceCorpus: [] as SnapshotSentence[] }));
  const cursors = documents.map(() => 0);
  // Scale with the corpus actually accepted into the report. For ordinary
  // SERPs these limits are at least the sum of all per-document limits, so no
  // 2,500-sentence representative slice is applied. Absolute guards still
  // protect snapshot recalculation from hostile browser-owned payloads.
  const sentenceLimit = Math.min(
    SNAPSHOT_SENTENCES_TOTAL_MAXIMUM,
    Math.max(SNAPSHOT_SENTENCES_TOTAL_BASE, documents.length * SNAPSHOT_SENTENCES_PER_SOURCE),
  );
  const tokenLimit = Math.min(
    SNAPSHOT_SENTENCE_TOKENS_TOTAL_MAXIMUM,
    Math.max(SNAPSHOT_SENTENCE_TOKENS_TOTAL_BASE, documents.length * SNAPSHOT_SENTENCE_TOKENS_PER_SOURCE),
  );
  let storedSentences = 0;
  let storedTokens = 0;
  while (storedSentences < sentenceLimit && storedTokens < tokenLimit) {
    let added = false;
    for (let index = 0; index < documents.length; index += 1) {
      if (storedSentences >= sentenceLimit || storedTokens >= tokenLimit) break;
      const sentence = documents[index].sentenceCorpus[cursors[index]];
      cursors[index] += 1;
      if (!sentence) continue;
      if (storedTokens + sentence.tokenCount > tokenLimit) continue;
      bounded[index].sentenceCorpus.push(sentence);
      storedSentences += 1;
      storedTokens += sentence.tokenCount;
      added = true;
    }
    if (!added) break;
  }
  bounded.forEach((document, index) => {
    document.sentenceCorpusTruncated = document.sentenceCorpusTruncated
      || document.sentenceCorpus.length < documents[index].sentenceCorpus.length;
  });
  return bounded;
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
    } satisfies ZoneAnalysis];
  })) as Record<AnalysisZone, ZoneAnalysis>;
  const allZone = analyzedZones.all;
  const tokens = tokenize(input.zones.all.blocks.join("\n"), language);
  const content = contentTokens(tokens);
  if (content.length < 20) throw new Error("Недостаточно содержательных слов для анализа");
  const ngrams = zoneNgrams.all;
  const sentenceCorpus = boundedSentenceCorpus(input.zones.all.blocks, language);
  return {
    name: input.name, url: input.url, position: input.position, title: input.title,
    wordCount: tokens.length, contentWordCount: content.length, uniqueTerms: allZone.termCounts.size,
    headings: input.headings, sentences: sentenceCount(input.zones.all.blocks.join("\n"), language), truncated: input.truncated,
    source: input.source, qualityScore: input.qualityScore,
    sentenceCorpus: sentenceCorpus.sentences, sentenceCorpusTruncated: sentenceCorpus.truncated,
    termCounts: allZone.termCounts, termForms: allZone.termForms, ngramCounts: ngrams.counts, ngramForms: ngrams.forms,
    zones: analyzedZones,
  };
}

function detectLanguage(text: string, htmlLanguages: string[]) {
  const declared = htmlLanguages.map((value) => value.toLowerCase().split(/[-_]/)[0]).filter((value) => LANGUAGE_CONFIGS[value]);
  if (declared.length) {
    const counts = new Map<string, number>();
    for (const value of declared) increment(counts, value);
    return [...counts].sort((a, b) => b[1] - a[1])[0][0];
  }
  if (/[іїєґ]/iu.test(text)) return "uk";
  if (/\p{Script=Cyrl}/u.test(text)) return "ru";
  if (/\p{Script=Arabic}/u.test(text)) return "ar";
  if (/\p{Script=Armenian}/u.test(text)) return "hy";
  if (/\p{Script=Greek}/u.test(text)) return "el";
  if (/\p{Script=Hebrew}/u.test(text)) return "he";
  if (/\p{Script=Devanagari}/u.test(text)) return "hi";
  if (/\p{Script=Tamil}/u.test(text)) return "ta";
  if (/\p{Script=Hangul}/u.test(text)) return "ko";
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) return "ja";
  if (/\p{Script=Han}/u.test(text)) return "zh";
  if (/\p{Script=Thai}/u.test(text)) return "th";

  const words = (text.toLowerCase().match(/\p{L}+/gu) ?? []).slice(0, 2_000);
  const candidates = ["en", "de", "fr", "es", "it", "pt", "nl", "pl", "tr", "sv", "da", "fi", "ro", "cs"];
  let best = "en";
  let bestScore = 0;
  for (const language of candidates) {
    const stopwords = languageStopwords(language);
    const score = words.reduce((sum, word) => sum + (stopwords.has(normalizeSurface(word, language)) ? 1 : 0), 0);
    if (score > bestScore) { best = language; bestScore = score; }
  }
  return best;
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
  const canonicalPhrases = new Set<string>();
  for (const entry of stopEntries(payload.stopPhrases)) {
    const surfaces = segmentWords(entry, language).map((raw) => normalizeSurface(raw, language)).filter(Boolean);
    if (!surfaces.length) continue;
    const keys = surfaces.map((surface) => termKey(surface, language));
    phraseKeySequences.push(keys);
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

function statusFor(ownFrequency: number, q25: number, medianFrequency: number, q75: number, minimum: number) {
  const lowTarget = q25 > 0 ? q25 : medianFrequency * .55;
  const highTarget = q75 > 0 ? q75 : medianFrequency * 1.45;
  if (ownFrequency < Math.max(minimum, lowTarget)) return "Добавить" as const;
  if (highTarget > 0 && ownFrequency > Math.max(highTarget * 1.3, medianFrequency * 1.8)) return "Снизить" as const;
  return "Норма" as const;
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
    sentenceCorpusTruncated: Boolean(document.sentenceCorpusTruncated),
    sentenceCorpus: document.sentenceCorpus.map((sentence) => ({
      id: sentence.id,
      text: sentence.text.slice(0, SNAPSHOT_SENTENCE_MAX_CHARACTERS),
      tokenKeys: sentence.tokenKeys.slice(0, SNAPSHOT_SENTENCE_MAX_CHARACTERS),
      tokenCount: Math.max(0, Math.trunc(sentence.tokenCount)),
    })),
    termCounts, termForms: serializeForms(document.termForms, new Set(termCounts.map(([key]) => key))),
    ngramCounts, ngramForms: serializeForms(document.ngramForms, new Set(ngramCounts.map(([key]) => key))),
    zones: Object.fromEntries(ANALYSIS_ZONES.map((zone) => [zone, serializeZoneAnalysis(document.zones[zone])])) as Record<AnalysisZone, SerializedZoneAnalysis>,
  };
}

function deserializeSentenceCorpus(value: unknown, language: string): SnapshotSentence[] {
  const entries = snapshotArray(value, SNAPSHOT_SENTENCES_PER_DOCUMENT, "sentenceCorpus");
  const result: SnapshotSentence[] = [];
  let storedTokens = 0;
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Partial<SnapshotSentence>;
    const text = typeof candidate.text === "string" ? candidate.text.slice(0, SNAPSHOT_SENTENCE_MAX_CHARACTERS).trim() : "";
    // Snapshot travels through the browser, so token keys are derived again
    // from the bounded evidence text instead of trusting client-supplied keys.
    const tokens = text ? tokenize(text, language) : [];
    const tokenKeys = tokens.map((token) => token.key);
    if (!text || !tokenKeys.length) continue;
    if (storedTokens + tokenKeys.length > SNAPSHOT_SENTENCE_TOKENS_PER_DOCUMENT) break;
    storedTokens += tokenKeys.length;
    result.push({
      id: typeof candidate.id === "string" && candidate.id.length <= 64 ? candidate.id : `s${result.length + 1}`,
      text,
      tokenKeys,
      tokenCount: tokenKeys.length,
    });
  }
  return result;
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

function deserializeZoneAnalysis(value: unknown, label: string): ZoneAnalysis {
  const zone = snapshotRecord(value, label);
  return {
    available: Boolean(zone.available),
    wordCount: optionalSnapshotCount(zone.wordCount),
    contentWordCount: optionalSnapshotCount(zone.contentWordCount),
    termCounts: deserializeCounts(zone.termCounts, SNAPSHOT_TERMS, `${label}.termCounts`),
    termForms: deserializeForms(zone.termForms, SNAPSHOT_TERMS, `${label}.termForms`),
    ngramCounts: deserializeCounts(zone.ngramCounts, SNAPSHOT_NGRAMS, `${label}.ngramCounts`),
  };
}

function deserializeDocument(value: unknown, language: string, label: string): DocumentAnalysis {
  const document = snapshotRecord(value, label);
  const zones = snapshotRecord(document.zones, `${label}.zones`);
  const sentenceCorpus = deserializeSentenceCorpus(document.sentenceCorpus, language);
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
    sentenceCorpusTruncated: Boolean(document.sentenceCorpusTruncated),
    sentenceCorpus,
    termCounts: deserializeCounts(document.termCounts, SNAPSHOT_TERMS, `${label}.termCounts`),
    termForms: deserializeForms(document.termForms, SNAPSHOT_TERMS, `${label}.termForms`),
    ngramCounts: deserializeCounts(document.ngramCounts, SNAPSHOT_NGRAMS, `${label}.ngramCounts`),
    ngramForms: deserializeForms(document.ngramForms, SNAPSHOT_NGRAMS, `${label}.ngramForms`),
    zones: Object.fromEntries(ANALYSIS_ZONES.map((zone) =>
      [zone, deserializeZoneAnalysis(zones[zone], `${label}.zones.${zone}`)])) as Record<AnalysisZone, ZoneAnalysis>,
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

async function buildSnapshot(payload: AnalyzeRequest, serpQuery: string): Promise<CorpusSnapshot> {
  const ownInput = payload.ownPage;
  const competitorInputs = Array.isArray(payload.competitors) ? payload.competitors : [];
  if (!ownInput) throw new Error("Добавьте свою страницу");
  if (!competitorInputs.length) throw new Error("Не найдено ни одного конкурента для анализа");
  if (competitorInputs.length > SNAPSHOT_COMPETITORS_MAXIMUM) throw new Error("За один запуск можно безопасно обработать не более 500 конкурентов");

  const useFirecrawl = payload.useFirecrawl !== false;
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
  const boundedDocuments = globallyBoundSentenceCorpora([own, ...analyzedCompetitors]);
  return {
    version: SNAPSHOT_VERSION, id: snapshotId(), createdAt: new Date().toISOString(), language, serpQuery,
    search: payload.search ?? {}, competitors: boundedDocuments.slice(1).map(serializeDocument), own: serializeDocument(boundedDocuments[0]), warnings,
  };
}

function roundTo50(value: number) { return Math.max(50, Math.round(value / 50) * 50); }

export async function analyzePayload(payload: AnalyzeRequest) {
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
    snapshot = await buildSnapshot(payload, serpQuery);
  }

  const language = snapshot.language;
  const boundedDocuments = globallyBoundSentenceCorpora([
    deserializeDocument(snapshot.own, language, "snapshot.own"),
    ...snapshot.competitors.slice(0, SNAPSHOT_COMPETITORS_MAXIMUM)
      .map((document, index) => deserializeDocument(document, language, `snapshot.competitors[${index}]`)),
  ]);
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
      return [zone, {
        available: ownZone.available || competitorZones.some((value) => value.available),
        sites,
        ownCount,
        ownFrequency,
        medianCount: median(counts),
        medianFrequency,
        q25Count: quantile(counts, .25),
        q75Count: quantile(counts, .75),
        q25Frequency,
        q75Frequency,
        competitorTfidf: tfidfValues.reduce((sum, value) => sum + value, 0) / competitorCount,
        status: statusFor(ownFrequency, q25Frequency, medianFrequency, q75Frequency, .08),
      }];
    })) as Record<AnalysisZone, {
      available: boolean; sites: number; ownCount: number; ownFrequency: number; medianCount: number;
      medianFrequency: number; q25Count: number; q75Count: number; q25Frequency: number; q75Frequency: number;
      competitorTfidf: number; status: BaseRow["status"];
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
        medianCount: Math.max(1, Math.ceil(value.medianCount)),
        q25Count: Math.ceil(value.q25Count),
        q75Count: Math.ceil(value.q75Count),
        importance: round(zoneImportance, 1),
        status: value.status,
      }];
    })) as Record<AnalysisZone, {
      available: boolean; sites: number; ownCount: number; medianCount: number; q25Count: number;
      q75Count: number; importance: number; status: BaseRow["status"];
    }>;
    return {
      key: row.key, term: row.label, forms: row.forms, sites: row.sites, df: round(df, 3), coverage: round(df * 100, 0),
      ownCount: Math.ceil(row.ownCount), ownFrequency: round(row.ownFrequency, 2), medianCount: Math.max(1, Math.ceil(row.medianCount)),
      q25Count: Math.ceil(quantile(row.counts, .25)), q75Count: Math.ceil(quantile(row.counts, .75)),
      medianFrequency: round(row.medianFrequency, 2), q25: round(row.q25, 2), q75: round(row.q75, 2),
      averageFrequency: round(row.averageFrequency, 2), idf: round(row.idf, 3), competitorTfidf: round(row.competitorTfidf, 3),
      ownTfidf: round(row.ownTfidf, 3), tfidfNormalized: round(tfidfNormalized, 3),
      importance: round(importance, 1), keywordHit, bestKeyword: matchingProfile?.keyword ?? "", status: row.status, zones,
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
  const ngramSemantics = new Map(baseNgrams.map((row) => [
    row.key,
    localSemanticScore(row.label, row.key, row.frequencies, profiles, language),
  ]));
  const ngramImportanceRaw = new Map(baseNgrams.map((row) => {
    const df = row.sites / competitorCount;
    return [row.key, df * (ngramSemantics.get(row.key)?.keySimilarity ?? 0)];
  }));
  const maxNgramImportanceRaw = Math.max(0, ...ngramImportanceRaw.values());
  const ngramZoneBases = new Map<string, Record<AnalysisZone, {
    available: boolean; sites: number; ownCount: number; medianCount: number; q25Count: number; q75Count: number;
    frequencies: number[]; ownFrequency: number; medianFrequency: number; q25Frequency: number; q75Frequency: number;
    competitorTfidf: number; status: BaseRow["status"];
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
      return [zone, {
        available: ownZone.available || competitorZones.some((value) => value.available), sites, ownCount,
        medianCount: median(counts), q25Count: quantile(counts, .25), q75Count: quantile(counts, .75),
        frequencies, ownFrequency, medianFrequency, q25Frequency, q75Frequency,
        competitorTfidf: tfidfValues.reduce((sum, value) => sum + value, 0) / competitorCount,
        status: statusFor(ownFrequency, q25Frequency, medianFrequency, q75Frequency, .05),
      }];
    })) as Record<AnalysisZone, {
      available: boolean; sites: number; ownCount: number; medianCount: number; q25Count: number; q75Count: number;
      frequencies: number[]; ownFrequency: number; medianFrequency: number; q25Frequency: number; q75Frequency: number;
      competitorTfidf: number; status: BaseRow["status"];
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
    const zones = Object.fromEntries(ANALYSIS_ZONES.map((zone) => {
      const value = ngramZoneBases.get(row.key)![zone];
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
        medianCount: Math.max(1, Math.ceil(value.medianCount)),
        q25Count: Math.ceil(value.q25Count),
        q75Count: Math.ceil(value.q75Count),
        importance: round(zoneImportance, 1),
        status: value.status,
      }];
    })) as Record<AnalysisZone, {
      available: boolean; sites: number; ownCount: number; medianCount: number; q25Count: number;
      q75Count: number; importance: number; status: BaseRow["status"];
    }>;
    return {
      key: row.key, phrase: row.label, forms: row.forms, sites: row.sites, df: round(df, 3), coverage: round(df * 100, 0),
      ownCount: Math.ceil(row.ownCount), ownFrequency: round(row.ownFrequency, 2), medianCount: Math.max(1, Math.ceil(row.medianCount)),
      medianFrequency: round(row.medianFrequency, 2), q25: round(row.q25, 2), q75: round(row.q75, 2), idf: round(row.idf, 3),
      competitorTfidf: round(row.competitorTfidf, 3), tfidfNormalized: round(tfidfNormalized, 3), keySimilarity: round(semantic.keySimilarity, 3),
      importance: round(Math.max(1, importance), 1), priority: round(priority, 1), bestKeyword: semantic.bestKeyword,
      keywordHit: exactQueryMatch, status: row.status, zones,
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
    ...importantTerms.map((row) => ({ key: row.key, importance: row.importance, targetCount: row.medianCount, kind: "term" as const })),
    ...importantNgrams.map((row) => ({ key: row.key, importance: row.importance, targetCount: row.targetCount, kind: "ngram" as const })),
  ];
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
    for (const signal of importantSignals) {
      const weight = Math.max(0, signal.importance);
      const count = signal.kind === "term"
        ? document.termCounts.get(signal.key) ?? 0
        : document.ngramCounts.get(signal.key) ?? 0;
      const density = signal.targetCount > 0 ? Math.min(1, count / signal.targetCount) : count > 0 ? 1 : 0;
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
      confidence: competitorCount >= 6 ? "high" : competitorCount >= 3 ? "medium" : "low",
      tripletsEnabled: payload.tripletsEnabled === true,
      phraseSimilarityMethod: "Локальное семантическое сходство фразы с входными ключами", snapshotId: snapshot.id,
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
      weightedDensity: "Взвешенное выполнение ориентиров показывает, насколько фактические количества важных лемм и фраз достигают конкурентных медиан. Ориентиры округляются вверх, превышение цели не даёт дополнительного балла, а нулевой ориентир оценивается по факту наличия вхождения.",
      phraseSimilarity: "Сходство с ключом участвует в оценке важности N-грамм и помогает находить близкие фразы; в метрики документов оно не входит.",
    },
  };
}
