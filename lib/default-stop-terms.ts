/**
 * Conservative, editable Russian additions for the multilingual stop-list.
 *
 * Deliberately excluded from this preset: people names, measurement units,
 * commercial modifiers and broad nouns such as "качество", "метод" or
 * "процесс". Depending on the page topic, those terms can carry meaning.
 */
export const DEFAULT_STOP_WORDS = [
  "ах",
  "бы",
  "быть",
  "ведь",
  "весьма",
  "вон",
  "вообще",
  "вообще-то",
  "вот",
  "всё",
  "всё-таки",
  "всякий",
  "где-то",
  "да",
  "давай",
  "даже",
  "далее",
  "должен",
  "должна",
  "ещё",
  "здесь",
  "значит",
  "именно",
  "иной",
  "каждый",
  "как-то",
  "какой-то",
  "короче",
  "который",
  "кстати",
  "кто-то",
  "кому",
  "ладно",
  "ли",
  "лишь",
  "многое",
  "могут",
  "может",
  "можно",
  "надо",
  "наиболее",
  "некий",
  "некоторые",
  "немного",
  "необходимо",
  "нечто",
  "ну",
  "нужно",
  "ныне",
  "окей",
  "очень",
  "поэтому",
  "после",
  "премного",
  "самый",
  "свой",
  "скажем",
  "сколько-то",
  "слишком",
  "совсем",
  "спасибо",
  "спасибочки",
  "теперь",
  "такой",
  "тогда",
  "этот",
  "наш",
  "ваш",
  "угу",
  "уж",
  "фу",
  "ха",
  "хм",
  "что-то",
  "эй",
  "эх",
] as const;

export const DEFAULT_STOP_PHRASES = [
  "в любом случае",
  "иметь место",
  "как бы",
  "между прочим",
  "мог бы",
  "на самом деле",
  "настоящий момент",
  "по большому счёту",
  "с уважением",
  "строго говоря",
  "хотел бы",
  "чаще всего",
  "честно говоря",
] as const;

/**
 * Optional web boilerplate. These terms are common in calls to action,
 * navigation and legal footers, but can be meaningful on some page types.
 */
export const OPTIONAL_WEB_STOP_WORDS = [
  "добавьте",
  "заполните",
  "кликните",
  "нажмите",
  "начните",
  "оставьте",
  "откройте",
  "переходите",
  "подробнее",
  "продолжайте",
  "свяжитесь",
  "скачайте",
  "узнайте",
] as const;

export const OPTIONAL_WEB_STOP_PHRASES = [
  "высокие стандарты",
  "динамичная рыночная среда",
  "завоевать доверие клиентов",
  "ключ к успеху",
  "обработка персональных данных",
  "от души",
  "персональные данные",
  "политика конфиденциальности",
  "политика конфидициальности",
  "шаг за шагом",
] as const;

export const DEFAULT_STOP_WORDS_TEXT = DEFAULT_STOP_WORDS.join("\n");
export const DEFAULT_STOP_PHRASES_TEXT = DEFAULT_STOP_PHRASES.join("\n");
export const OPTIONAL_WEB_STOP_WORDS_TEXT = OPTIONAL_WEB_STOP_WORDS.join("\n");
export const OPTIONAL_WEB_STOP_PHRASES_TEXT = OPTIONAL_WEB_STOP_PHRASES.join("\n");

export type StopTermPreset = {
  language: string;
  label: string;
  words: readonly string[];
  phrases: readonly string[];
  optionalWebWords: readonly string[];
  optionalWebPhrases: readonly string[];
};

const ENGLISH_STOP_WORDS = [
  "actually",
  "anyway",
  "basically",
  "certainly",
  "clearly",
  "generally",
  "maybe",
  "obviously",
  "perhaps",
  "probably",
  "really",
  "simply",
] as const;

const ENGLISH_STOP_PHRASES = [
  "as a matter of fact",
  "at the moment",
  "in any case",
  "in fact",
  "in general",
  "of course",
  "so to speak",
] as const;

const ENGLISH_WEB_STOP_WORDS = [
  "click",
  "contact",
  "continue",
  "download",
  "submit",
] as const;

const ENGLISH_WEB_STOP_PHRASES = [
  "cookie policy",
  "learn more",
  "personal data",
  "privacy policy",
  "read more",
  "terms and conditions",
] as const;

const SPANISH_STOP_WORDS = [
  "ciertamente",
  "entonces",
  "quizá",
  "quizás",
  "realmente",
  "simplemente",
] as const;

const SPANISH_STOP_PHRASES = [
  "de hecho",
  "en cualquier caso",
  "en general",
  "en realidad",
  "por supuesto",
] as const;

const SPANISH_WEB_STOP_WORDS = [
  "contactar",
  "continuar",
  "descargar",
  "enviar",
  "pulsar",
] as const;

const SPANISH_WEB_STOP_PHRASES = [
  "datos personales",
  "leer más",
  "política de cookies",
  "política de privacidad",
  "términos y condiciones",
] as const;

/**
 * Conservative editable additions shown in the UI. These do not replace the
 * analyzer's built-in per-language stopword lists from the `stopword` package.
 */
export const STOP_TERM_PRESETS: Readonly<Record<string, StopTermPreset>> = {
  ru: {
    language: "ru",
    label: "Русский",
    words: DEFAULT_STOP_WORDS,
    phrases: DEFAULT_STOP_PHRASES,
    optionalWebWords: OPTIONAL_WEB_STOP_WORDS,
    optionalWebPhrases: OPTIONAL_WEB_STOP_PHRASES,
  },
  en: {
    language: "en",
    label: "English",
    words: ENGLISH_STOP_WORDS,
    phrases: ENGLISH_STOP_PHRASES,
    optionalWebWords: ENGLISH_WEB_STOP_WORDS,
    optionalWebPhrases: ENGLISH_WEB_STOP_PHRASES,
  },
  es: {
    language: "es",
    label: "Español",
    words: SPANISH_STOP_WORDS,
    phrases: SPANISH_STOP_PHRASES,
    optionalWebWords: SPANISH_WEB_STOP_WORDS,
    optionalWebPhrases: SPANISH_WEB_STOP_PHRASES,
  },
};

const EMPTY_STOP_TERMS: readonly string[] = [];

export function stopTermPresetFor(language: string): StopTermPreset {
  return STOP_TERM_PRESETS[language] ?? {
    language,
    label: language === "auto" ? "Автоопределение" : language.toUpperCase(),
    words: EMPTY_STOP_TERMS,
    phrases: EMPTY_STOP_TERMS,
    optionalWebWords: EMPTY_STOP_TERMS,
    optionalWebPhrases: EMPTY_STOP_TERMS,
  };
}

export function stopTermPresetText(language: string, includeWebNoise = false) {
  const preset = stopTermPresetFor(language);
  const words = includeWebNoise ? [...preset.words, ...preset.optionalWebWords] : [...preset.words];
  const phrases = includeWebNoise ? [...preset.phrases, ...preset.optionalWebPhrases] : [...preset.phrases];
  return { words: words.join("\n"), phrases: phrases.join("\n") };
}
