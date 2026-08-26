export type MorphologyMode = "lemmatization" | "stemming" | "tokens";

export const SNOWBALL_ALGORITHMS = [
  "arabic", "armenian", "basque", "catalan", "czech", "danish", "dutch",
  "english", "finnish", "french", "german", "hungarian", "irish", "italian",
  "norwegian", "portuguese", "romanian", "russian", "slovene", "spanish",
  "swedish", "tamil", "turkish",
] as const;

export type SnowballAlgorithm = (typeof SNOWBALL_ALGORITHMS)[number];

type StopwordExport =
  | "ara" | "hye" | "eus" | "bul" | "cat" | "zho" | "hrv" | "ces"
  | "dan" | "nld" | "eng" | "est" | "fin" | "fra" | "deu" | "ell"
  | "heb" | "hin" | "hun" | "ind" | "gle" | "ita" | "jpn" | "kor"
  | "lav" | "lit" | "nob" | "fas" | "pol" | "por" | "ron" | "rus"
  | "slk" | "slv" | "spa" | "swa" | "swe" | "tha" | "tur"
  | "ukr" | "urd" | "vie";

export type LanguageConfig = {
  label: string;
  morphology: MorphologyMode;
  stemmer?: SnowballAlgorithm;
  stopwords?: StopwordExport;
};

function stemmed(label: string, stemmer: SnowballAlgorithm, stopwords?: StopwordExport): LanguageConfig {
  return { label, morphology: "stemming", stemmer, stopwords };
}

function tokenized(label: string, stopwords?: StopwordExport): LanguageConfig {
  return { label, morphology: "tokens", stopwords };
}

function lemmatized(label: string, stopwords?: StopwordExport): LanguageConfig {
  return { label, morphology: "lemmatization", stopwords };
}

/**
 * One source of truth for both the analyzer and the language selector.
 *
 * "lemmatization" means dictionary morphology with a normalized word form.
 * "stemming" means Snowball suffix stemming, not dictionary lemmatization.
 * "tokens" means Unicode/Intl word segmentation with normalized surface forms;
 * inflected forms are intentionally not merged in that mode.
 */
export const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  ar: stemmed("العربية", "arabic", "ara"),
  hy: stemmed("Հայերեն", "armenian", "hye"),
  eu: stemmed("Euskara", "basque", "eus"),
  bg: tokenized("Български", "bul"),
  ca: stemmed("Català", "catalan", "cat"),
  zh: tokenized("中文", "zho"),
  hr: tokenized("Hrvatski", "hrv"),
  cs: stemmed("Čeština", "czech", "ces"),
  da: stemmed("Dansk", "danish", "dan"),
  nl: stemmed("Nederlands", "dutch", "nld"),
  en: stemmed("English", "english", "eng"),
  et: tokenized("Eesti", "est"),
  fi: stemmed("Suomi", "finnish", "fin"),
  fr: stemmed("Français", "french", "fra"),
  de: stemmed("Deutsch", "german", "deu"),
  el: tokenized("Ελληνικά", "ell"),
  he: tokenized("עברית", "heb"),
  hi: tokenized("हिन्दी", "hin"),
  hu: stemmed("Magyar", "hungarian", "hun"),
  id: tokenized("Bahasa Indonesia", "ind"),
  ga: stemmed("Gaeilge", "irish", "gle"),
  it: stemmed("Italiano", "italian", "ita"),
  ja: tokenized("日本語", "jpn"),
  ko: tokenized("한국어", "kor"),
  lv: tokenized("Latviešu", "lav"),
  lt: tokenized("Lietuvių", "lit"),
  no: stemmed("Norsk", "norwegian", "nob"),
  fa: tokenized("فارسی", "fas"),
  pl: tokenized("Polski", "pol"),
  pt: stemmed("Português", "portuguese", "por"),
  ro: stemmed("Română", "romanian", "ron"),
  ru: lemmatized("Русский", "rus"),
  sr: tokenized("Српски"),
  sk: tokenized("Slovenčina", "slk"),
  sl: stemmed("Slovenščina", "slovene", "slv"),
  es: stemmed("Español", "spanish", "spa"),
  sw: tokenized("Kiswahili", "swa"),
  sv: stemmed("Svenska", "swedish", "swe"),
  ta: stemmed("தமிழ்", "tamil"),
  th: tokenized("ไทย", "tha"),
  tr: stemmed("Türkçe", "turkish", "tur"),
  uk: tokenized("Українська", "ukr"),
  ur: tokenized("اردو", "urd"),
  vi: tokenized("Tiếng Việt", "vie"),
};

export const LANGUAGE_OPTIONS = Object.entries(LANGUAGE_CONFIGS).map(([code, config]) => ({
  code,
  label: config.label,
  morphology: config.morphology,
  hasBuiltInStopwords: Boolean(config.stopwords),
}));

export function languageCapability(language: string) {
  const config = LANGUAGE_CONFIGS[language];
  if (!config) return null;
  const morphologyLabel = config.morphology === "lemmatization"
    ? "словарная морфологическая лемматизация"
    : config.morphology === "stemming"
      ? "стемминг Snowball"
      : "токенизация без склейки словоформ";
  const stopwordLabel = config.stopwords
    ? "встроенные стоп-слова"
    : "только пользовательские стоп-слова";
  return { ...config, morphologyLabel, stopwordLabel };
}
