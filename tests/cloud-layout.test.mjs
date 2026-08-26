import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadCloudLayout() {
  const source = await readFile(new URL("../lib/cloud-layout.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "cloud-layout.ts",
    reportDiagnostics: true,
  });
  const errors = (output.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors, [], "cloud layout helper must transpile without TypeScript errors");
  const encoded = Buffer.from(output.outputText, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

const WORD_STEMS = [
  "центр", "seo", "аудит", "semantic", "релевантность", "word cloud", "поисковый спрос",
  "international", "данные", "контент", "query", "оптимизация", "кластер", "analysis",
  "стратегия", "маркетинг", "ranking", "семантика",
];

function syntheticWords() {
  return Array.from({ length: 54 }, (_, index) => ({
    key: `mixed-${index}`,
    word: `${WORD_STEMS[index % WORD_STEMS.length]} ${index + 1}`,
    frequency: 100 - index * 1.35,
    sites: 12 - index % 7,
  }));
}

function boundsOf(word) {
  return {
    left: word.left - word.width / 2,
    right: word.left + word.width / 2,
    top: word.top - word.height / 2,
    bottom: word.top + word.height / 2,
  };
}

function overlaps(left, right, epsilon = 1e-7) {
  return left.left < right.right - epsilon
    && left.right > right.left + epsilon
    && left.top < right.bottom - epsilon
    && left.bottom > right.top + epsilon;
}

test("collision-aware cloud packing places at least 45 mixed-length words in bounds without overlap", async () => {
  const layout = await loadCloudLayout();
  const words = syntheticWords();
  const packed = layout.packCloudWords(words, words[0].frequency);

  assert.equal(words.length, 54);
  assert.ok(packed.length >= 45, `only ${packed.length} of 54 words were placed`);
  assert.ok(packed.length <= layout.CLOUD_LAYOUT_WORD_LIMIT);
  assert.ok(layout.CLOUD_LAYOUT_WIDTH_SAFETY >= 6, "packed boxes must reserve at least 6px for browser font measurement differences");
  assert.equal(packed[0].item.key, words[0].key, "the most frequent word must be first");
  assert.equal(packed[0].left, layout.CLOUD_LAYOUT_WIDTH / 2, "the most frequent word must be horizontally centered");
  assert.equal(packed[0].top, layout.CLOUD_LAYOUT_HEIGHT / 2, "the most frequent word must be vertically centered");

  const boxes = packed.map(boundsOf);
  for (const [index, box] of boxes.entries()) {
    const estimate = layout.estimateCloudTextBox(packed[index].item.word, packed[index].fontSize);
    assert.equal(packed[index].width, estimate.width, `word ${index} must retain the conservative estimated width`);
    assert.equal(packed[index].height, estimate.height, `word ${index} must retain the estimated height`);
    assert.ok(box.left >= 0, `word ${index} crosses the left edge`);
    assert.ok(box.top >= 0, `word ${index} crosses the top edge`);
    assert.ok(box.right <= layout.CLOUD_LAYOUT_WIDTH, `word ${index} crosses the right edge`);
    assert.ok(box.bottom <= layout.CLOUD_LAYOUT_HEIGHT, `word ${index} crosses the bottom edge`);
    for (let other = index + 1; other < boxes.length; other += 1) {
      assert.equal(overlaps(box, boxes[other]), false, `packed boxes ${index} and ${other} overlap`);
    }
  }

  assert.deepEqual(
    layout.packCloudWords(words, words[0].frequency),
    packed,
    "packing the same ranked words must be deterministic",
  );
});

test("base cloud font mapping is finite and monotonic in frequency", async () => {
  const layout = await loadCloudLayout();
  const maximum = 100;
  let previous = -Infinity;
  for (let frequency = 0; frequency <= maximum; frequency += 1) {
    const size = layout.cloudBaseFontSize(frequency, maximum);
    assert.ok(Number.isFinite(size));
    assert.ok(size >= previous, `font size decreased at frequency ${frequency}`);
    previous = size;
  }
  assert.equal(layout.cloudBaseFontSize(0, maximum), 8);
  assert.equal(layout.cloudBaseFontSize(maximum, maximum), 34);
});

test("the analyzer renders the packed coordinates and no longer uses the fixed spiral positions", async () => {
  const [page, layoutSource, css] = await Promise.all([
    readFile(new URL("../app/analyzer/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/cloud-layout.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/analyzer/analyzer.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /import \{ CLOUD_LAYOUT_HEIGHT, CLOUD_LAYOUT_WIDTH, packCloudWords \} from "@\/lib\/cloud-layout"/);
  assert.match(page, /useMemo\(\(\) => packCloudWords\(words, maxFrequency\), \[words, maxFrequency\]\)/);
  assert.match(page, /packed\.left \/ CLOUD_LAYOUT_WIDTH \* 100/);
  assert.match(page, /packed\.top \/ CLOUD_LAYOUT_HEIGHT \* 100/);
  assert.match(page, /fontSize: `\$\{packed\.fontSize\}px`/);
  assert.doesNotMatch(page, /function cloudPosition|GOLDEN_ANGLE_DEGREES|CLOUD_RINGS/);
  assert.match(layoutSource, /const collides = \(bounds: Bounds\)/);
  assert.match(layoutSource, /if \(!isInside\(bounds\) \|\| collides\(bounds\)\) continue/);
  assert.match(layoutSource, /export const CLOUD_LAYOUT_WORD_LIMIT = 54/);
  const widthSafety = Number(layoutSource.match(/export const CLOUD_LAYOUT_WIDTH_SAFETY = (\d+)/)?.[1] ?? 0);
  assert.ok(widthSafety >= 6, `browser text-width safety ${widthSafety}px is too small`);
  assert.match(layoutSource, /units \* fontSize \* 1\.05 \+ CLOUD_LAYOUT_HORIZONTAL_PADDING \+ CLOUD_LAYOUT_WIDTH_SAFETY/);
  assert.match(css, /\.cloudGrid\s*\{[\s\S]*?width:\s*min\(1052px, 100%\)/);
  assert.match(css, /\.cloud > span b\s*\{[^}]*font-weight:\s*inherit/);
  assert.match(css, /@media print[\s\S]*?\.cloud\s*\{\s*height:\s*270px;\s*min-height:\s*270px/);
});
