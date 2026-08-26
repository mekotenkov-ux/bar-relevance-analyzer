#!/usr/bin/env node

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const GOOGLE_SOURCE = "https://xmlriver.com/files/geo.csv";
const YANDEX_SOURCE = "https://xmlriver.com/blog/spisok-kodov-regionov-yandex-poiska-s-ierarhiej.html";
const outputPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../lib/xmlriver-regions.generated.ts");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sourceBytes(fileArgument, url) {
  if (fileArgument) return readFile(path.resolve(fileArgument));
  const response = await fetch(url, { headers: { "user-agent": "BAR-region-catalog-updater/1.0" } });
  if (!response.ok) throw new Error(`Не удалось загрузить ${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  return rows;
}

function googleRows(csv) {
  const rows = parseCsv(csv);
  const expectedHeader = ["Criteria ID", "Name", "Canonical Name", "Parent ID", "Country Code", "Target Type", "Status"];
  if (JSON.stringify(rows[0]) !== JSON.stringify(expectedHeader)) {
    throw new Error("Формат официального Google geo.csv изменился");
  }
  const seen = new Set();
  return rows.slice(1).filter((row) => row.some(Boolean)).map((row, index) => {
    if (row.length !== expectedHeader.length || !/^[1-9]\d*$/u.test(row[0])) {
      throw new Error(`Некорректная строка Google CSV: ${index + 2}`);
    }
    if (seen.has(row[0])) throw new Error(`Дублирующийся Google Criteria ID: ${row[0]}`);
    seen.add(row[0]);
    // Parent ID не нужен во время поиска: полная иерархия уже есть в Canonical Name.
    return [row[0], row[1], row[2], row[4], row[5], row[6]];
  });
}

function decodeHtml(text) {
  return text.replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/giu, " ").replace(/&amp;/giu, "&").replace(/&quot;/giu, '"')
    .replace(/&apos;|&#039;/giu, "'").replace(/&lt;/giu, "<").replace(/&gt;/giu, ">");
}

function yandexRows(html) {
  const start = html.indexOf('<div id="australia"');
  const end = html.indexOf('<div class="comments_template">', start);
  if (start < 0 || end < 0) throw new Error("Не найден официальный список регионов Яндекса в HTML XMLRiver");
  const text = decodeHtml(html.slice(start, end).replace(/<br\s*\/?\s*>/giu, "\n")
    .replace(/<\/div\s*>/giu, "\n").replace(/<[^>]+>/gu, ""));
  const seen = new Set();
  const rows = [];
  for (const line of text.split(/\r?\n/u)) {
    const match = line.trim().match(/^(.*?)\s*\(([1-9]\d*)\)\s*$/u);
    if (!match || seen.has(match[2])) continue;
    seen.add(match[2]);
    rows.push([match[2], match[1].trim()]);
  }
  if (rows.length < 600) throw new Error(`Список Яндекса подозрительно короткий: ${rows.length}`);
  return rows;
}

function base64Lines(rows) {
  const value = gzipSync(Buffer.from(JSON.stringify(rows)), { level: 9 }).toString("base64");
  return value.match(/.{1,120}/gu).map((line) => `  "${line}",`).join("\n");
}

const version = argument("--version");
if (!/^\d{4}-\d{2}-\d{2}$/u.test(version ?? "")) {
  throw new Error("Укажите дату snapshot: --version YYYY-MM-DD");
}

const googleBytes = await sourceBytes(argument("--google-csv"), GOOGLE_SOURCE);
const yandexBytes = await sourceBytes(argument("--yandex-html"), YANDEX_SOURCE);
const google = googleRows(googleBytes.toString("utf8"));
const yandex = yandexRows(yandexBytes.toString("utf8"));
const googleActive = google.filter((row) => row[5] === "Active").length;

const generated = `// СГЕНЕРИРОВАНО scripts/update-xmlriver-regions.mjs. Не редактировать вручную.
// Snapshot официальных таблиц XMLRiver; приложение не обращается к сети для поиска регионов.

export const XMLRIVER_GENERATED_CATALOG_VERSION = "${version}";
export const XMLRIVER_GENERATED_CATALOG_METADATA = Object.freeze({
  google: Object.freeze({
    url: "${GOOGLE_SOURCE}",
    sha256: "${sha256(googleBytes)}",
    rows: ${google.length},
    activeRows: ${googleActive},
  }),
  yandex: Object.freeze({
    url: "${YANDEX_SOURCE}",
    sha256: "${sha256(yandexBytes)}",
    rows: ${yandex.length},
  }),
});

export const XMLRIVER_GOOGLE_REGIONS_GZIP_BASE64 = [
${base64Lines(google)}
].join("");

export const XMLRIVER_YANDEX_REGIONS_GZIP_BASE64 = [
${base64Lines(yandex)}
].join("");
`;

if (process.argv.includes("--check")) {
  const existing = await readFile(outputPath, "utf8").catch(() => "");
  if (existing !== generated) throw new Error("xmlriver-regions.generated.ts не соответствует официальным исходникам");
} else {
  await writeFile(outputPath, generated, "utf8");
  console.log(JSON.stringify({ output: outputPath, version, google: google.length, googleActive, yandex: yandex.length }, null, 2));
}
