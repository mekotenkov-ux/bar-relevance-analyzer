import assert from "node:assert/strict";
import test from "node:test";

const ZONES = ["all", "title", "h1", "headings", "text", "anchors"];
const CROWD_TERMS = Array.from({ length: 90 }, (_, index) => `cloudterm${String(index).padStart(3, "0")}`);

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("clouds-v8-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const environment = () => ({ ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } });
const context = () => ({ waitUntil() {}, passThroughOnException() {} });

async function postAnalysis(worker, payload) {
  const response = await worker.fetch(new Request("http://localhost/api/analyze-run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }), environment(), context());
  const data = await response.json();
  return { response, data };
}

function cloudHtml(index, own = false) {
  const sparse = !own && index === 0 ? "sparsecloud ".repeat(6) : "";
  return `<!doctype html><html lang="en"><head>
    <title>titlecloud titlecloud titlecloud title support</title>
  </head><body><main>
    <h1>h1cloud h1cloud h1cloud primary heading</h1>
    <h2>headingcloud headingcloud headingcloud secondary heading</h2>
    <p>textcloud textcloud textcloud ${sparse}${CROWD_TERMS.join(" ")}</p>
    <a href="/course">anchorcloud anchorcloud anchorcloud course link</a>
  </main></body></html>`;
}

function requestUrl(input) {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

let cloudFixturePromise;

async function cloudFixture() {
  if (!cloudFixturePromise) {
    cloudFixturePromise = (async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input) => {
        const url = requestUrl(input);
        const own = url.hostname === "cloud-own.example.test";
        const index = own ? 0 : Number(url.hostname.match(/cloud-(\d+)/)?.[1] ?? 1) - 1;
        return new Response(cloudHtml(index, own), {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      };
      try {
        const worker = await loadWorker();
        const competitors = Array.from({ length: 4 }, (_, index) => ({
          name: `Cloud competitor ${index + 1}`,
          position: index + 1,
          url: `https://cloud-${index + 1}.example.test/page`,
        }));
        const result = await postAnalysis(worker, {
          queries: ["cloud analysis"],
          serpQuery: "cloud analysis",
          language: "en",
          competitors,
          ownPage: { name: "Cloud own", url: "https://cloud-own.example.test/page" },
          search: { engine: "google", region: "us", device: "desktop", found: competitors.length },
        });
        assert.equal(result.response.status, 200, result.data.error || "cloud fixture failed");
        return { worker, report: result.data };
      } finally {
        globalThis.fetch = originalFetch;
      }
    })();
  }
  return cloudFixturePromise;
}

function rounded(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function findCloudWord(words, surface) {
  return words.find((row) => row.word === surface);
}

function countsOf(entries) {
  return new Map(entries);
}

function assertFiniteCloud(words, label) {
  assert.ok(words.length <= 60, `${label}: cloud exceeds the 60-word API limit`);
  for (const [index, row] of words.entries()) {
    assert.equal(typeof row.word, "string", `${label}[${index}].word`);
    assert.ok(row.word.length > 0, `${label}[${index}].word is empty`);
    for (const field of ["count", "weight", "frequency", "sites"]) {
      assert.equal(typeof row[field], "number", `${label}[${index}].${field} must be numeric`);
      assert.ok(Number.isFinite(row[field]), `${label}[${index}].${field} must be finite`);
      assert.ok(row[field] >= 0, `${label}[${index}].${field} must be non-negative`);
    }
  }
}

test("cloud zones preserve strict HTML extraction without leakage", { concurrency: false }, async () => {
  const { report } = await cloudFixture();
  assert.deepEqual(Object.keys(report.clouds.zones), ZONES);
  const expectedZones = new Map([
    ["titlecloud", "title"],
    ["h1cloud", "h1"],
    ["headingcloud", "headings"],
    ["textcloud", "text"],
    ["anchorcloud", "anchors"],
  ]);

  for (const [word, expectedZone] of expectedZones) {
    assert.ok(findCloudWord(report.clouds.zones.all.competitors, word), `${word} must be present in the all-zone aggregate`);
    assert.ok(findCloudWord(report.clouds.zones[expectedZone].competitors, word), `${word} missing from ${expectedZone}`);
    assert.ok(findCloudWord(report.clouds.zones.all.own, word), `${word} must be present in our all-zone cloud`);
    assert.ok(findCloudWord(report.clouds.zones[expectedZone].own, word), `${word} missing from our ${expectedZone} cloud`);
    for (const zone of ZONES.filter((candidate) => candidate !== "all" && candidate !== expectedZone)) {
      assert.equal(findCloudWord(report.clouds.zones[zone].competitors, word), undefined, `${word} leaked into competitor ${zone}`);
      assert.equal(findCloudWord(report.clouds.zones[zone].own, word), undefined, `${word} leaked into our ${zone}`);
    }
  }
});

test("aggregate cloud means include zero documents and competitor profiles expose the selected zone", { concurrency: false }, async () => {
  const { report } = await cloudFixture();
  const sparse = findCloudWord(report.clouds.zones.text.competitors, "sparsecloud");
  assert.ok(sparse, "the sparse word must remain in the text cloud");

  const documents = report.snapshot.competitors;
  const sparseKey = documents[0].zones.text.termForms
    .find(([, forms]) => forms.some(([form]) => form === "sparsecloud"))?.[0];
  assert.ok(sparseKey);
  const values = documents.map((document) => {
    const count = countsOf(document.zones.text.termCounts).get(sparseKey) ?? 0;
    const frequency = document.zones.text.wordCount ? count / document.zones.text.wordCount * 1_000 : 0;
    return { count, frequency };
  });
  assert.deepEqual(values.map((value) => value.count), [6, 0, 0, 0]);
  assert.equal(sparse.count, rounded(values.reduce((sum, value) => sum + value.count, 0) / documents.length));
  assert.equal(sparse.frequency, rounded(values.reduce((sum, value) => sum + value.frequency, 0) / documents.length));
  assert.equal(sparse.weight, sparse.frequency);
  assert.equal(sparse.sites, 1);

  const firstProfile = report.comparisonProfiles.find((profile) => profile.position === 1);
  const secondProfile = report.comparisonProfiles.find((profile) => profile.position === 2);
  assert.ok(firstProfile && secondProfile);
  assert.deepEqual(firstProfile.cloud, firstProfile.cloudZones.all);
  const firstSparse = findCloudWord(firstProfile.cloudZones.text, "sparsecloud");
  assert.ok(firstSparse);
  assert.equal(firstSparse.count, 6);
  assert.equal(firstSparse.frequency, rounded(values[0].frequency));
  assert.equal(findCloudWord(secondProfile.cloudZones.text, "sparsecloud"), undefined);
});

test("cloud payloads are bounded, finite, and deterministic across snapshot recalculation", { concurrency: false }, async () => {
  const { worker, report: initial } = await cloudFixture();
  assert.equal(initial.clouds.zones.text.competitors.length, 60);
  assert.equal(initial.clouds.zones.text.own.length, 60);

  for (const zone of ZONES) {
    assertFiniteCloud(initial.clouds.zones[zone].competitors, `clouds.zones.${zone}.competitors`);
    assertFiniteCloud(initial.clouds.zones[zone].own, `clouds.zones.${zone}.own`);
  }
  for (const profile of initial.comparisonProfiles) {
    assert.deepEqual(Object.keys(profile.cloudZones), ZONES);
    for (const zone of ZONES) assertFiniteCloud(profile.cloudZones[zone], `${profile.id}.cloudZones.${zone}`);
  }

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("cloud snapshot recalculation attempted a network request");
  };
  let recalculated;
  try {
    recalculated = await postAnalysis(worker, { queries: ["cloud analysis"], language: "en", snapshot: initial.snapshot });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(recalculated.response.status, 200, recalculated.data.error || "cloud snapshot recalc failed");
  assert.equal(fetchCalls, 0);
  assert.deepEqual(recalculated.data.clouds, initial.clouds);
  assert.deepEqual(
    recalculated.data.comparisonProfiles.map(({ id, cloud, cloudZones }) => ({ id, cloud, cloudZones })),
    initial.comparisonProfiles.map(({ id, cloud, cloudZones }) => ({ id, cloud, cloudZones })),
  );
});
