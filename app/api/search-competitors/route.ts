import { resolveXmlRiverRegion, type XmlRiverSearchEngine } from "@/lib/xmlriver-regions";

type SearchEngine = XmlRiverSearchEngine;

type SearchRequest = {
  query?: string;
  engine?: SearchEngine;
  region?: string;
  device?: "desktop" | "tablet" | "mobile";
  count?: number;
  ownUrl?: string;
  language?: string;
  credentials?: { user?: string; key?: string };
};

type Credentials = { user: string; key: string; source: "server" | "browser" };
type Competitor = { position: number; name: string; title: string; url: string; snippet: string };
type ParsedCompetitor = Competitor & { domain: string; normalizedUrl: string };
type SearchWarningCode =
  | "empty_page"
  | "no_new_results"
  | "repeated_page"
  | "page_budget_reached"
  | "time_budget_reached"
  | "page_failed";
type SearchWarning = { code: SearchWarningCode; page: number; message: string };

const MAX_QUERY_LENGTH = 300;
const XMLRIVER_HOST = "https://xmlriver.com";
const XMLRIVER_TIMEOUT_MS = 25_000;
const XMLRIVER_GROUP_SIZE = 10;
const DEFAULT_PAGE_BUDGET = 100;
const DEFAULT_TIME_BUDGET_MS = 120_000;
const SEARCH_PLATFORM_DOMAINS = new Set(["yandex.ru", "ya.ru", "google.com", "google.ru"]);
const YANDEX_LANGUAGES = new Set(["ru", "uk", "be", "kk", "en", "de", "fr", "tr"]);

function positiveIntegerEnvironment(names: string[], fallback: number) {
  for (const name of names) {
    const value = Number(process.env[name]);
    if (Number.isSafeInteger(value) && value > 0) return value;
  }
  return fallback;
}

function searchPageBudget() {
  return positiveIntegerEnvironment(["XMLRIVER_SEARCH_MAX_PAGES", "XMLRIVER_MAX_PAGES"], DEFAULT_PAGE_BUDGET);
}

function searchTimeBudgetMs() {
  return positiveIntegerEnvironment(["XMLRIVER_SEARCH_TIME_BUDGET_MS", "XMLRIVER_TIME_BUDGET_MS"], DEFAULT_TIME_BUDGET_MS);
}

class SearchTimeBudgetError extends Error {
  constructor() {
    super("Исчерпан бюджет времени поиска XMLRiver");
    this.name = "SearchTimeBudgetError";
  }
}

function splitCombinedCredential(raw?: string) {
  const value = raw?.trim().replace(/^['"]|['"]$/g, "");
  if (!value) return null;
  if (value.includes("user=") && value.includes("key=")) {
    const params = new URLSearchParams(value);
    const user = params.get("user")?.trim();
    const key = params.get("key")?.trim();
    return user && key ? { user, key } : null;
  }
  for (const separator of [":", "|"]) {
    const index = value.indexOf(separator);
    if (index > 0 && index < value.length - 1) return { user: value.slice(0, index).trim(), key: value.slice(index + 1).trim() };
  }
  return null;
}

function serverCredentials() {
  const user = process.env.XMLRIVER_USER?.trim();
  const key = (process.env.XMLRIVER_KEY || process.env.XMLRIVER_API_KEY)?.trim();
  if (user && key) return { user, key };
  return splitCombinedCredential(process.env.XMLRIVER || process.env.XMLRIVER_CREDENTIALS);
}

function getCredentials(payload?: SearchRequest): Credentials | null {
  const server = serverCredentials();
  if (server) return { ...server, source: "server" };
  const user = payload?.credentials?.user?.trim();
  const key = payload?.credentials?.key?.trim();
  return user && key ? { user, key, source: "browser" } : null;
}

function decodeXml(value: string) {
  const raw = value.replace(/^<!\[CDATA\[|\]\]>$/g, "").replace(/<[^>]+>/g, " ");
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return raw.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity)
    .replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function normalizeHost(raw?: string) {
  if (!raw) return "";
  try { return new URL(raw).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, ""); }
  catch { return ""; }
}

function rootDomain(host: string) {
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return host;
  const compoundSuffixes = new Set(["co.uk", "org.uk", "com.au", "com.br", "co.jp"]);
  const lastTwo = labels.slice(-2).join(".");
  return compoundSuffixes.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

async function responseXml(response: Response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const headerCharset = response.headers.get("content-type")?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1];
  const prefix = new TextDecoder("ascii").decode(bytes.slice(0, 240));
  const declarationCharset = prefix.match(/<\?xml[^>]+encoding\s*=\s*["']([^"']+)/i)?.[1];
  const charset = (headerCharset || declarationCharset || "utf-8").toLowerCase();
  try { return new TextDecoder(charset).decode(bytes); }
  catch { return new TextDecoder("utf-8").decode(bytes); }
}

function normalizeUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  url.hash = "";
  const publicUrl = url.toString();
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.searchParams.sort();
  return { publicUrl, normalizedUrl: url.toString(), domain: rootDomain(url.hostname) };
}

function parsePage(xml: string, firstPosition: number) {
  const competitors: ParsedCompetitor[] = [];
  const fingerprintParts: string[] = [];
  const documents = [...xml.matchAll(/<doc(?:\s[^>]*)?>([\s\S]*?)<\/doc>/gi)];
  for (let index = 0; index < documents.length; index += 1) {
    const block = documents[index][1];
    const rawUrl = tag(block, "url");
    const normalized = normalizeUrl(rawUrl);
    if (!normalized) continue;
    fingerprintParts.push(normalized.normalizedUrl);
    const host = normalizeHost(normalized.publicUrl);
    const title = tag(block, "title") || host;
    competitors.push({
      position: firstPosition + index,
      name: title,
      title,
      url: normalized.publicUrl,
      snippet: tag(block, "passages") || tag(block, "snippet"),
      domain: normalized.domain,
      normalizedUrl: normalized.normalizedUrl,
    });
  }
  return {
    documentCount: documents.length,
    competitors,
    fingerprint: fingerprintParts.sort().join("\n"),
  };
}

function xmlError(xml: string) {
  const match = xml.match(/<error(?:\s+code=["']?([^"'\s>]+)["']?)?[^>]*>([\s\S]*?)<\/error>/i);
  if (!match) return "";
  const message = decodeXml(match[2]);
  return `XMLRiver${match[1] ? ` (${match[1]})` : ""}: ${message || "ошибка поискового API"}`;
}

function safeErrorMessage(error: unknown, credentials: Pick<Credentials, "user" | "key">) {
  let message = error instanceof Error ? error.message : "Не удалось получить поисковую выдачу";
  for (const secret of [credentials.user, credentials.key]) {
    if (!secret) continue;
    message = message.split(secret).join("[redacted]");
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) message = message.split(encoded).join("[redacted]");
  }
  return message.replace(/([?&](?:user|key)=)[^&\s]+/gi, "$1[redacted]");
}

async function fetchXml(url: URL, deadline: number) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SearchTimeBudgetError();
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/xml,text/xml;q=0.9,*/*;q=0.1", "User-Agent": "BAR-Relevance-Analyzer/3.0 (+https://seomeat.ru/)" },
        signal: AbortSignal.timeout(Math.max(1, Math.min(XMLRIVER_TIMEOUT_MS, remaining))),
      });
      const xml = await responseXml(response);
      if (!response.ok) throw new Error(`XMLRiver вернул HTTP ${response.status}`);
      return xml;
    } catch (error) {
      lastError = error;
      if (Date.now() >= deadline) throw new SearchTimeBudgetError();
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      if (!timedOut || attempt === 2) break;
    }
  }
  if (lastError instanceof Error && (lastError.name === "TimeoutError" || lastError.name === "AbortError")) throw new Error("XMLRiver не ответил после двух попыток по 25 секунд");
  throw lastError instanceof Error ? lastError : new Error("Не удалось получить поисковую выдачу");
}

function inferredYandexLanguage(query: string) {
  if (/[іїєґ]/iu.test(query)) return "uk";
  if (/\p{Script=Cyrl}/u.test(query)) return "ru";
  return "en";
}

export async function GET() {
  const firecrawl = (process.env.FIRECRAWL_API_KEY || process.env.FIRECRAWL)?.trim();
  return Response.json({ serverConfigured: Boolean(serverCredentials()), firecrawlConfigured: Boolean(firecrawl) });
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as SearchRequest;
    const query = payload.query?.trim() ?? "";
    if (query.length < 2) return Response.json({ error: "Введите поисковый запрос" }, { status: 400 });
    if (query.length > MAX_QUERY_LENGTH) return Response.json({ error: "Поисковый запрос слишком длинный" }, { status: 400 });
    const credentials = getCredentials(payload);
    if (!credentials) return Response.json({ error: "Укажите ID пользователя и ключ XMLRiver" }, { status: 400 });

    const engine: SearchEngine = payload.engine === "yandex" ? "yandex" : "google";
    const requestedCount = payload.count === undefined ? 10 : Number(payload.count);
    if (!Number.isSafeInteger(requestedCount) || requestedCount <= 0) {
      return Response.json({ error: "Количество конкурентов должно быть положительным целым числом" }, { status: 400 });
    }

    const firstPage = engine === "yandex" ? 0 : 1;
    const baseUrl = new URL(engine === "yandex" ? "/search_yandex/xml" : "/search/xml", XMLRIVER_HOST);
    baseUrl.searchParams.set("user", credentials.user);
    baseUrl.searchParams.set("key", credentials.key);
    baseUrl.searchParams.set("query", query);
    baseUrl.searchParams.set("groupby", String(XMLRIVER_GROUP_SIZE));
    baseUrl.searchParams.set("device", payload.device || "desktop");
    const regionInput = payload.region?.trim() ?? "";
    const region = regionInput ? resolveXmlRiverRegion(engine, regionInput) : null;
    if (regionInput && !region) {
      return Response.json({ error: "Неизвестный регион XMLRiver. Выберите регион из справочника или укажите его числовой код" }, { status: 400 });
    }
    if (region) baseUrl.searchParams.set(engine === "yandex" ? "lr" : "loc", region.code);
    if (engine === "yandex") {
      const requestedLanguage = payload.language?.trim().toLowerCase();
      baseUrl.searchParams.set("lang", requestedLanguage && requestedLanguage !== "auto" && YANDEX_LANGUAGES.has(requestedLanguage)
        ? requestedLanguage
        : inferredYandexLanguage(query));
    }

    const pageBudget = searchPageBudget();
    const deadline = Date.now() + searchTimeBudgetMs();
    const own = normalizeUrl(payload.ownUrl ?? "");
    const seenDomains = new Set<string>();
    const seenUrls = new Set<string>();
    const seenFingerprints = new Set<string>();
    const competitors: Competitor[] = [];
    const warnings: SearchWarning[] = [];
    let page = firstPage;
    let pagesAttempted = 0;
    let pagesFetched = 0;
    let stopReason: SearchWarningCode | "requested_count_reached" = "requested_count_reached";

    while (competitors.length < requestedCount) {
      if (pagesAttempted >= pageBudget) {
        stopReason = "page_budget_reached";
        warnings.push({ code: stopReason, page, message: `Достигнут безопасный бюджет в ${pageBudget} страниц XMLRiver` });
        break;
      }
      if (Date.now() >= deadline) {
        stopReason = "time_budget_reached";
        warnings.push({ code: stopReason, page, message: "Исчерпан бюджет времени поиска XMLRiver" });
        break;
      }

      const pageUrl = new URL(baseUrl);
      pageUrl.searchParams.set("page", String(page));
      pagesAttempted += 1;
      let xml: string;
      try {
        xml = await fetchXml(pageUrl, deadline);
        const apiError = xmlError(xml);
        if (apiError) throw new Error(apiError);
      } catch (error) {
        stopReason = error instanceof SearchTimeBudgetError ? "time_budget_reached" : "page_failed";
        const message = safeErrorMessage(error, credentials);
        if (!competitors.length) return Response.json({ error: message }, { status: stopReason === "time_budget_reached" ? 504 : 502 });
        warnings.push({ code: stopReason, page, message });
        break;
      }

      pagesFetched += 1;
      const firstPosition = (page - firstPage) * XMLRIVER_GROUP_SIZE + 1;
      const parsed = parsePage(xml, firstPosition);
      if (!parsed.documentCount) {
        stopReason = "empty_page";
        warnings.push({ code: stopReason, page, message: "XMLRiver вернул пустую страницу выдачи" });
        break;
      }
      if (parsed.fingerprint && seenFingerprints.has(parsed.fingerprint)) {
        stopReason = "repeated_page";
        warnings.push({ code: stopReason, page, message: "XMLRiver повторил уже обработанную страницу выдачи" });
        break;
      }
      if (parsed.fingerprint) seenFingerprints.add(parsed.fingerprint);

      const before = competitors.length;
      for (const candidate of parsed.competitors) {
        if (!candidate.domain || SEARCH_PLATFORM_DOMAINS.has(candidate.domain)) continue;
        if (own && (candidate.domain === own.domain || candidate.normalizedUrl === own.normalizedUrl)) continue;
        if (seenDomains.has(candidate.domain) || seenUrls.has(candidate.normalizedUrl)) continue;
        seenDomains.add(candidate.domain);
        seenUrls.add(candidate.normalizedUrl);
        competitors.push({
          position: candidate.position,
          name: candidate.name,
          title: candidate.title,
          url: candidate.url,
          snippet: candidate.snippet,
        });
        if (competitors.length >= requestedCount) break;
      }
      if (competitors.length === before) {
        stopReason = "no_new_results";
        warnings.push({ code: stopReason, page, message: "На следующей странице нет новых уникальных доменов" });
        break;
      }
      page += 1;
    }

    if (!competitors.length) {
      return Response.json({ error: "XMLRiver не вернул подходящих страниц в выдаче", warnings }, { status: 404 });
    }
    return Response.json({
      query,
      engine,
      region,
      language: payload.language || "auto",
      requestedCount,
      competitors,
      credentialSource: credentials.source,
      partial: competitors.length < requestedCount,
      stopReason,
      pagesAttempted,
      pagesFetched,
      pageSize: XMLRIVER_GROUP_SIZE,
      warnings,
    });
  } catch (cause) {
    return Response.json({ error: cause instanceof Error ? cause.message : "Не удалось найти конкурентов" }, { status: 502 });
  }
}
