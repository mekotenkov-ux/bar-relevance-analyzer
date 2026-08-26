import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_STOP_PHRASES,
  DEFAULT_STOP_WORDS,
} from "../../lib/default-stop-terms.ts";

const directory = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = (process.env.BAR_URL || "http://localhost:3000").replace(/\/$/u, "");
const sourcePath = path.join(directory, "results", "seo-courses-search.json");

function repairText(value) {
  let current = value;
  for (let attempt = 0; attempt < 3 && /[ÐÑÃÂâ\u0080-\u009f]/u.test(current); attempt += 1) {
    const candidate = Buffer.from(current, "latin1").toString("utf8");
    if (!candidate || candidate === current || candidate.includes("�")) break;
    current = candidate;
  }
  return current;
}

function repair(value) {
  if (typeof value === "string") return repairText(value);
  if (Array.isArray(value)) return value.map(repair);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, repair(item)]));
  }
  return value;
}

async function postJson(pathname, body) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} failed (${response.status}): ${text.slice(0, 2_000)}`);
  return { data: JSON.parse(text), elapsedMs: Math.round(performance.now() - started), responseBytes: Buffer.byteLength(text) };
}

const search = repair(JSON.parse(fs.readFileSync(sourcePath, "utf8").replace(/^\uFEFF/u, "")));
const analysis = await postJson("/api/analyze-run", {
  queries: ["seo курсы"],
  serpQuery: "seo курсы",
  language: "ru",
  ownPage: { name: "SEO Meat", url: "https://seomeat.ru/" },
  competitors: search.competitors,
  search: { engine: "yandex", found: search.competitors.length },
  useFirecrawl: true,
  stopWords: [...DEFAULT_STOP_WORDS],
  stopPhrases: [...DEFAULT_STOP_PHRASES],
});

const report = analysis.data;
const snapshotDocuments = [report.snapshot?.own, ...(report.snapshot?.competitors || [])].filter(Boolean);
const corpusSentences = snapshotDocuments.reduce((sum, document) => sum + (document.sentenceCorpus?.length || 0), 0);
const corpusTokens = snapshotDocuments.reduce((sum, document) => sum
  + (document.sentenceCorpus || []).reduce((subtotal, sentence) => subtotal + (sentence.tokenCount || 0), 0), 0);
const corpusTruncatedDocuments = snapshotDocuments.filter((document) => document.sentenceCorpusTruncated).length;

const tripletRun = await postJson("/api/analyze-triplets", {
  tripletsEnabled: true,
  queries: ["seo курсы"],
  stopWords: [...DEFAULT_STOP_WORDS],
  stopPhrases: [...DEFAULT_STOP_PHRASES],
  snapshot: report.snapshot,
});
const triplets = tripletRun.data.triplets;

console.log(JSON.stringify({
  analysis: {
    elapsedMs: analysis.elapsedMs,
    responseBytes: analysis.responseBytes,
    competitors: report.meta?.competitorsAnalyzed,
    warnings: report.warnings?.length || 0,
    lemmas: report.lemmas?.length || 0,
    ngrams: report.ngrams?.length || 0,
    corpusSentences,
    corpusTokens,
    corpusTruncatedDocuments,
  },
  triplets: {
    elapsedMs: tripletRun.elapsedMs,
    responseBytes: tripletRun.responseBytes,
    status: triplets?.status,
    candidates: triplets?.meta?.totalCandidateCount ?? triplets?.candidates?.length,
    processedSentences: triplets?.meta?.processedSentenceCount,
    corpusSentences: triplets?.meta?.totalSentenceCount,
    relations: triplets?.edges?.length || 0,
    relationLimit: triplets?.meta?.relationLimit,
    truncated: triplets?.meta?.truncated,
    minimumSupport: triplets?.edges?.length
      ? Math.min(...triplets.edges.map((edge) => edge.occurrences))
      : null,
    top: (triplets?.edges || []).slice(0, 12).map((edge) => ({
      source: edge.sourceLabel,
      predicate: edge.predicate,
      target: edge.targetLabel,
      support: edge.occurrences,
      documents: edge.documentCount,
    })),
  },
}, null, 2));
