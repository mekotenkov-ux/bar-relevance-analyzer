export type Lemma = {
  lemma: string;
  competitors: number;
  ours: number;
  median: number;
  documentShare: number;
  importance: number;
  status: "Добавить" | "Норма" | "Снизить";
};

export const lemmas: Lemma[] = [
  { lemma: "английский", competitors: 13, ours: 7, median: 12, documentShare: 100, importance: 9.8, status: "Добавить" },
  { lemma: "курс", competitors: 12, ours: 9, median: 10, documentShare: 92, importance: 8.9, status: "Добавить" },
  { lemma: "язык", competitors: 13, ours: 12, median: 11, documentShare: 100, importance: 8.6, status: "Норма" },
  { lemma: "занятие", competitors: 11, ours: 4, median: 8, documentShare: 85, importance: 7.7, status: "Добавить" },
  { lemma: "обучение", competitors: 12, ours: 6, median: 7, documentShare: 92, importance: 7.1, status: "Добавить" },
  { lemma: "преподаватель", competitors: 10, ours: 3, median: 5, documentShare: 77, importance: 6.5, status: "Добавить" },
  { lemma: "онлайн", competitors: 11, ours: 8, median: 7, documentShare: 85, importance: 6.2, status: "Норма" },
  { lemma: "урок", competitors: 10, ours: 11, median: 6, documentShare: 77, importance: 5.8, status: "Снизить" },
  { lemma: "разговорный", competitors: 9, ours: 2, median: 4, documentShare: 69, importance: 5.4, status: "Добавить" },
  { lemma: "уровень", competitors: 9, ours: 5, median: 5, documentShare: 69, importance: 5.1, status: "Норма" },
  { lemma: "программа", competitors: 8, ours: 7, median: 4, documentShare: 62, importance: 4.7, status: "Снизить" },
  { lemma: "практика", competitors: 8, ours: 3, median: 4, documentShare: 62, importance: 4.5, status: "Добавить" },
];

export const cloudWords: [string, number][] = [
  ["английский", 38], ["курсы", 31], ["язык", 27], ["занятия", 25], ["обучение", 22],
  ["преподаватель", 19], ["разговорный", 18], ["онлайн", 17], ["урок", 16], ["уровень", 15],
  ["практика", 14], ["программа", 14], ["экзамен", 13], ["школа", 13], ["дети", 12],
];

export const oursCloud: [string, number][] = [
  ["английский", 35], ["язык", 30], ["урок", 26], ["курсы", 24], ["онлайн", 22],
  ["программа", 19], ["обучение", 18], ["уровень", 16], ["занятия", 14], ["школа", 13],
  ["преподаватель", 11], ["практика", 10], ["разговорный", 9], ["экзамен", 9], ["дети", 8],
];

export const ngrams = [
  { phrase: "курсы английского языка", sites: 11, median: 4, ours: 2, importance: 9.4, status: "Добавить 2" },
  { phrase: "английский язык онлайн", sites: 10, median: 3, ours: 1, importance: 8.8, status: "Добавить 2" },
  { phrase: "разговорный английский", sites: 9, median: 3, ours: 0, importance: 8.2, status: "Добавить 3" },
  { phrase: "индивидуальные занятия", sites: 8, median: 2, ours: 1, importance: 7.6, status: "Добавить 1" },
  { phrase: "онлайн школа английского", sites: 8, median: 2, ours: 2, importance: 7.1, status: "Норма" },
  { phrase: "пробный урок", sites: 7, median: 2, ours: 3, importance: 6.4, status: "Снизить 1" },
];

export const documents = [
  { position: 1, domain: "englex.ru", url: "/online-courses/", keyTfidfScore: 94, keyTfidfRaw: 2.84, weightedCoverage: 91, weightedDensity: 86, words: 1834 },
  { position: 3, domain: "skyeng.ru", url: "/english-online/", keyTfidfScore: 91, keyTfidfRaw: 2.73, weightedCoverage: 88, weightedDensity: 83, words: 2140 },
  { position: 5, domain: "bkc.ru", url: "/courses/english/", keyTfidfScore: 87, keyTfidfRaw: 2.61, weightedCoverage: 84, weightedDensity: 78, words: 1568 },
  { position: 2, domain: "englishdom.com", url: "/online/", keyTfidfScore: 84, keyTfidfRaw: 2.52, weightedCoverage: 81, weightedDensity: 75, words: 1960 },
  { position: 7, domain: "tetrika-school.ru", url: "/english/", keyTfidfScore: 79, keyTfidfRaw: 2.37, weightedCoverage: 77, weightedDensity: 71, words: 1428 },
  { position: 0, domain: "my-site.ru", url: "/english-course/", keyTfidfScore: 68, keyTfidfRaw: 2.04, weightedCoverage: 64, weightedDensity: 58, words: 1126, ours: true },
];

export const wordCounts = [
  { domain: "englex.ru", words: 1834, useful: 1472, headings: 31, sentences: 146 },
  { domain: "skyeng.ru", words: 2140, useful: 1658, headings: 38, sentences: 173 },
  { domain: "bkc.ru", words: 1568, useful: 1287, headings: 27, sentences: 124 },
  { domain: "englishdom.com", words: 1960, useful: 1511, headings: 34, sentences: 159 },
  { domain: "tetrika-school.ru", words: 1428, useful: 1152, headings: 24, sentences: 116 },
  { domain: "my-site.ru", words: 1126, useful: 904, headings: 19, sentences: 92, ours: true },
];

export const navItems = [
  ["overview", "Сводка", "01"],
  ["lemmas", "Леммы", "02"],
  ["clouds", "Облако и график", "03"],
  ["ngrams", "N-граммы", "04"],
  ["documents", "Документы", "05"],
  ["volume", "Объём текста", "06"],
];
