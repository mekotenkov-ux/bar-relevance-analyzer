import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_STOP_PHRASES,
  DEFAULT_STOP_WORDS,
} from "../../lib/default-stop-terms.ts";

const [inputName, outputName] = process.argv.slice(2);
if (!inputName || !outputName) {
  throw new Error("Usage: node recalculate_live_report.mjs <input-report.json> <output-report.json>");
}

const markers = /[ÐÑÃÂâ\u0080-\u009f]/u;
function repairText(value) {
  let current = value;
  for (let attempt = 0; attempt < 3 && markers.test(current); attempt += 1) {
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

const source = JSON.parse(fs.readFileSync(inputName, "utf8").replace(/^\uFEFF/u, ""));
const snapshot = repair(source.snapshot);
const response = await fetch("http://localhost:3001/api/analyze-run", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    queries: ["seo курсы"],
    stopWords: [...DEFAULT_STOP_WORDS],
    stopPhrases: [...DEFAULT_STOP_PHRASES],
    snapshot,
  }),
});
const bytes = Buffer.from(await response.arrayBuffer());
if (!response.ok) throw new Error(`BAR recalculation failed (${response.status}): ${bytes.toString("utf8").slice(0, 1000)}`);
fs.mkdirSync(path.dirname(outputName), { recursive: true });
fs.writeFileSync(outputName, bytes);
const report = JSON.parse(bytes.toString("utf8"));
console.log(JSON.stringify({
  terms: report.terms?.length ?? 0,
  ngrams: report.ngrams?.length ?? 0,
  documents: report.documents?.length ?? 0,
  snapshotVersion: report.snapshot?.version,
  snapshotIdStable: report.snapshot?.id === snapshot.id,
}));
