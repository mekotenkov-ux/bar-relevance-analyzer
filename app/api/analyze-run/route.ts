type PageInput = { name?: string; url?: string; text?: string };
type AnalyzeRequest = { query?: string; ownPage?: PageInput; competitors?: PageInput[] };
type DocumentAnalysis = {
  name: string; url: string; title: string; wordCount: number; uniqueWords: number;
  headings: number; sentences: number; lemmaCounts: Map<string, number>;
  ngramCounts: Map<string, number>;
};

const MAX_TEXT_LENGTH = 200_000;
const MAX_REMOTE_LENGTH = 2_000_000;
const MAX_COMPETITORS = 10;
const STOP_WORDS = new Set(
  `а без более больше бы был была были было быть в вам вас весь во вот все всего всех вы где да даже для до его ее если есть еще же за здесь и из или им их к как ко когда кто ли либо мне может мы на над надо наш не него нее нет ни них но ну о об однако он она они оно от очень по под при про раз с сам свою себе себя со так такой там те тем то того тоже той только том ты у уже хотя чего чем что чтобы эта эти это этот я
  a about after again against all am an and any are as at be because been before being below between both but by can did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with you your yours yourself yourselves`.split(/\s+/),
);

function normalizeWord(value: string, keepStopWords = false) {
  let word = value.toLowerCase().replaceAll("ё", "е").replace(/^[-']+|[-']+$/g, "");
  if (word.length < 2 || (!keepStopWords && STOP_WORDS.has(word)) || /^\d+$/.test(word)) return "";
  if (/^[a-z]+$/i.test(word)) {
    if (word.length > 5 && word.endsWith("ies")) word = `${word.slice(0, -3)}y`;
    else if (word.length > 5 && word.endsWith("ing")) word = word.slice(0, -3);
    else if (word.length > 4 && word.endsWith("ed")) word = word.slice(0, -2);
    else if (word.length > 4 && word.endsWith("es")) word = word.slice(0, -2);
    else if (word.length > 3 && word.endsWith("s")) word = word.slice(0, -1);
    return word;
  }
  const replacements: Array<[RegExp, string]> = [
    [/(ейшего|ейшему|ейшим|ейшем)$/u, "ейший"], [/(ского|скому|ским|ском)$/u, "ский"],
    [/(ого|ому|ым)$/u, "ый"], [/(его|ему|им)$/u, "ий"],
    [/(ателями|ателям|ателях|ателем|атели|ателя)$/u, "атель"],
    [/(ениями|ениях|ению|ением|ении|ения|ений)$/u, "ение"],
    [/(аниями|аниях|анию|анием|ании|ания|аний)$/u, "ание"],
    [/(тиями|тиях|тию|тием|тии|тия|тий)$/u, "тие"], [/(иями|иях|ию|ии|ия)$/u, "ие"],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(word) && word.length - replacement.length > 2) return word.replace(pattern, replacement);
  }
  const endings = ["иями", "ями", "ами", "иях", "ях", "ах", "ов", "ев", "ам", "ям", "ом", "ем", "ой", "ей", "ую", "юю", "ы", "и", "а", "я", "у", "ю", "е"];
  for (const ending of endings) {
    if (word.length > ending.length + 3 && word.endsWith(ending)) { word = word.slice(0, -ending.length); break; }
  }
  return word;
}

function tokenize(text: string, keepStopWords = false) {
  const matches = text.match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? [];
  return matches.map((word) => normalizeWord(word, keepStopWords)).filter(Boolean);
}
function decodeEntities(text: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", laquo: "«", raquo: "»" };
  return text.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}
function extractHtml(html: string) {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const headings = (html.match(/<h[1-6]\b/gi) ?? []).length;
  const text = decodeEntities(html.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|canvas|nav|footer)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|section|article)>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[\t ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return { title, text, headings };
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
  try { url = new URL(raw); } catch { throw new Error("Некорректный URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Поддерживаются только HTTP и HTTPS URL");
  if (url.username || url.password) throw new Error("URL с логином или паролем не поддерживается");
  if (isUnsafeHost(url.hostname)) throw new Error("Локальные и служебные адреса недоступны");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Нестандартные порты недоступны");
  return url;
}
async function fetchPage(rawUrl: string) {
  let url = validateRemoteUrl(rawUrl);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetch(url, { redirect: "manual", headers: { "User-Agent": "CopykillerSemantic/1.0 (+https://seomeat.ru/)", Accept: "text/html,text/plain;q=0.9,*/*;q=0.1" }, signal: AbortSignal.timeout(12_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Сайт вернул перенаправление без адреса");
      url = validateRemoteUrl(new URL(location, url).toString()); continue;
    }
    if (!response.ok) throw new Error(`Сайт вернул HTTP ${response.status}`);
    const type = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (type && !type.includes("text/html") && !type.includes("text/plain") && !type.includes("application/xhtml")) throw new Error("URL не ведёт на HTML или текстовую страницу");
    if (Number(response.headers.get("content-length") ?? 0) > MAX_REMOTE_LENGTH) throw new Error("Страница слишком большая для анализа");
    return { html: (await response.text()).slice(0, MAX_REMOTE_LENGTH), finalUrl: url.toString() };
  }
  throw new Error("Слишком много перенаправлений");
}
function countItems(items: string[]) { const counts = new Map<string, number>(); for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1); return counts; }
function buildNgrams(tokens: string[]) {
  const phrases: string[] = [];
  for (let size = 2; size <= 3; size += 1) for (let index = 0; index <= tokens.length - size; index += 1) {
    const slice = tokens.slice(index, index + size);
    if (!slice.every((token) => STOP_WORDS.has(token)) && !slice.some((token) => token.length < 2)) phrases.push(slice.join(" "));
  }
  return countItems(phrases);
}
async function analyzeInput(input: PageInput, fallbackName: string): Promise<DocumentAnalysis> {
  let text = input.text?.trim() ?? ""; let url = input.url?.trim() ?? ""; let title = ""; let headings = 0;
  if (!text) {
    if (!url) throw new Error("Нужен URL или текст страницы");
    const fetched = await fetchPage(url); url = fetched.finalUrl;
    const extracted = extractHtml(fetched.html); title = extracted.title; text = extracted.text; headings = extracted.headings;
  }
  if (text.length > MAX_TEXT_LENGTH) text = text.slice(0, MAX_TEXT_LENGTH);
  if (text.length < 80) throw new Error("На странице слишком мало текста для анализа");
  const tokens = tokenize(text); const allTokens = tokenize(text, true);
  if (tokens.length < 20) throw new Error("Недостаточно содержательных слов для анализа");
  const lemmaCounts = countItems(tokens);
  const name = input.name?.trim() || title || (url ? new URL(url).hostname : fallbackName);
  return { name, url, title, wordCount: allTokens.length, uniqueWords: lemmaCounts.size, headings, sentences: Math.max(1, (text.match(/[.!?…]+(?:\s|$)/g) ?? []).length), lemmaCounts, ngramCounts: buildNgrams(allTokens) };
}
function median(values: number[]) { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function round(value: number, digits = 1) { const scale = 10 ** digits; return Math.round(value * scale) / scale; }
function cosine(left: Map<string, number>, right: Map<string, number>) {
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;
  for (const [key, value] of left) dot += value * (right.get(key) ?? 0);
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as AnalyzeRequest;
    const ownInput = payload.ownPage; const competitorInputs = Array.isArray(payload.competitors) ? payload.competitors.slice(0, MAX_COMPETITORS) : [];
    if (!ownInput) return Response.json({ error: "Добавьте свою страницу" }, { status: 400 });
    if (!competitorInputs.length) return Response.json({ error: "Добавьте хотя бы одного конкурента" }, { status: 400 });
    const ownPage = await analyzeInput(ownInput, "Наша страница");
    const settled = await Promise.allSettled(competitorInputs.map((input, index) => analyzeInput(input, `Конкурент ${index + 1}`)));
    const competitors = settled.filter((result): result is PromiseFulfilledResult<DocumentAnalysis> => result.status === "fulfilled").map((result) => result.value);
    const warnings = settled.flatMap((result, index) => result.status === "rejected" ? [{ name: competitorInputs[index].name || competitorInputs[index].url || `Конкурент ${index + 1}`, error: result.reason instanceof Error ? result.reason.message : "Не удалось обработать" }] : []);
    if (!competitors.length) return Response.json({ error: "Не удалось обработать ни одного конкурента", warnings }, { status: 400 });

    const allDocuments = [ownPage, ...competitors]; const documentFrequency = new Map<string, number>();
    for (const document of allDocuments) for (const term of document.lemmaCounts.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    const totalDocuments = allDocuments.length; const idf = (term: string) => Math.log((totalDocuments + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1;
    const vectorFor = (document: DocumentAnalysis) => { const vector = new Map<string, number>(); for (const [term, count] of document.lemmaCounts) vector.set(term, (count / document.wordCount) * idf(term)); return vector; };
    const vectors = allDocuments.map(vectorFor); const centroid = new Map<string, number>();
    for (const vector of vectors.slice(1)) for (const [term, value] of vector) centroid.set(term, (centroid.get(term) ?? 0) + value / competitors.length);

    const competitorTerms = new Set(competitors.flatMap((document) => [...document.lemmaCounts.keys()]));
    const lemmaRows = [...competitorTerms].map((lemma) => {
      const counts = competitors.map((document) => document.lemmaCounts.get(lemma) ?? 0); const sites = counts.filter(Boolean).length;
      const ownCount = ownPage.lemmaCounts.get(lemma) ?? 0; const medianCount = median(counts); const average = counts.reduce((sum, value) => sum + value, 0) / competitors.length;
      const competitorTfidf = competitors.reduce((sum, document) => sum + ((document.lemmaCounts.get(lemma) ?? 0) / document.wordCount) * idf(lemma) * 1000, 0) / competitors.length;
      const ownTfidf = (ownCount / ownPage.wordCount) * idf(lemma) * 1000;
      const status = ownCount < Math.max(1, medianCount * .7) ? "Добавить" : ownCount > Math.max(medianCount * 1.6, medianCount + 3) ? "Снизить" : "Норма";
      const score = idf(lemma) * (sites / competitors.length) * (1 + Math.max(0, medianCount - ownCount) / Math.max(1, medianCount));
      return { lemma, sites, ownCount, median: round(medianCount), average: round(average), coverage: round(sites / competitors.length * 100, 0), idf: round(idf(lemma), 3), competitorTfidf: round(competitorTfidf, 3), ownTfidf: round(ownTfidf, 3), score: round(score, 2), status };
    }).sort((a, b) => b.score - a.score || b.sites - a.sites).slice(0, 150);

    const ngramUniverse = new Set(competitors.flatMap((document) => [...document.ngramCounts.keys()])); const minSites = competitors.length >= 3 ? 2 : 1;
    const ngramRows = [...ngramUniverse].map((phrase) => {
      const counts = competitors.map((document) => document.ngramCounts.get(phrase) ?? 0); const sites = counts.filter(Boolean).length; const ownCount = ownPage.ngramCounts.get(phrase) ?? 0;
      const medianCount = median(counts); const average = counts.reduce((sum, value) => sum + value, 0) / competitors.length; const phraseIdf = Math.log((competitors.length + 1) / (sites + 1)) + 1;
      const status = ownCount < Math.max(1, medianCount * .7) ? "Добавить" : ownCount > Math.max(medianCount * 1.7, medianCount + 2) ? "Снизить" : "Норма";
      return { phrase, sites, ownCount, median: round(medianCount), average: round(average), idf: round(phraseIdf, 3), score: round(phraseIdf * sites / competitors.length * (1 + Math.max(0, medianCount - ownCount)), 2), status };
    }).filter((row) => row.sites >= minSites).sort((a, b) => b.score - a.score).slice(0, 100);

    const topTerms = [...centroid.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([term]) => term);
    const serialize = (document: DocumentAnalysis, vector: Map<string, number>, ours = false) => ({
      name: document.name, url: document.url, title: document.title, words: document.wordCount, uniqueWords: document.uniqueWords, headings: document.headings, sentences: document.sentences,
      coverage: round(topTerms.filter((term) => document.lemmaCounts.has(term)).length / Math.max(1, topTerms.length) * 100, 0), relevance: round(cosine(vector, centroid) * 100, 0), ours,
    });
    const documents = allDocuments.map((document, index) => serialize(document, vectors[index], index === 0)).sort((a, b) => b.relevance - a.relevance);
    const medianWords = median(competitors.map((document) => document.wordCount)); const semanticCoverage = topTerms.filter((term) => ownPage.lemmaCounts.has(term)).length / Math.max(1, topTerms.length) * 100;
    const importantNgrams = ngramRows.slice(0, 30); const ngramCoverage = importantNgrams.filter((row) => row.ownCount > 0).length / Math.max(1, importantNgrams.length) * 100;
    const similarity = cosine(vectors[0], centroid) * 100; const missing = lemmaRows.filter((row) => row.status === "Добавить").slice(0, 5).map((row) => row.lemma);
    return Response.json({
      meta: { query: payload.query?.trim() ?? "", analyzedAt: new Date().toISOString(), competitorsRequested: competitorInputs.length, competitorsAnalyzed: competitors.length },
      summary: { overallScore: Math.round(similarity * .55 + semanticCoverage * .3 + ngramCoverage * .15), similarity: round(similarity, 0), semanticCoverage: round(semanticCoverage, 0), ngramCoverage: round(ngramCoverage, 0), ownWords: ownPage.wordCount, medianWords: round(medianWords, 0), recommendedMin: Math.max(100, Math.round(medianWords * .85 / 50) * 50), recommendedMax: Math.max(150, Math.round(medianWords * 1.15 / 50) * 50), recommendation: missing.length ? `В первую очередь раскройте темы: ${missing.join(", ")}.` : "Критичных семантических пробелов не найдено." },
      lemmas: lemmaRows, ngrams: ngramRows,
      clouds: { competitors: [...centroid.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([word, weight]) => ({ word, weight: round(weight * 10000, 2) })), own: [...vectors[0].entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([word, weight]) => ({ word, weight: round(weight * 10000, 2) })) },
      chart: lemmaRows.slice(0, 12).map((row) => ({ lemma: row.lemma, competitors: row.average, own: row.ownCount })), documents, warnings,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось выполнить анализ" }, { status: 400 });
  }
}
