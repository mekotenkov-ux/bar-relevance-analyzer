import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("triplets-v9-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const environment = () => ({
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
});
const context = () => ({ waitUntil() {}, passThroughOnException() {} });

async function postTriplets(worker, payload) {
  const response = await worker.fetch(new Request("http://localhost/api/analyze-triplets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }), environment(), context());
  return { response, data: await response.json() };
}

async function postAnalysis(worker, payload) {
  const response = await worker.fetch(new Request("http://localhost/api/analyze-run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }), environment(), context());
  return { response, data: await response.json() };
}

const workerPromise = loadWorker();
let completeReportPromise;

async function completeReport() {
  if (!completeReportPromise) {
    completeReportPromise = workerPromise.then(async (worker) => {
      const sharedCopy = [
        "SEO audits examine crawlability, indexing, site architecture, internal links, page speed, and technical errors.",
        "Professional audit reports explain priorities, implementation steps, measurement, analytics, and expected search results.",
        "Teams use practical checklists, monitoring tools, content research, keyword mapping, and structured recommendations.",
        "The training includes realistic projects, guided exercises, expert feedback, reporting templates, and optimization examples.",
        "Students compare websites, diagnose problems, plan improvements, verify changes, and communicate outcomes to stakeholders.",
      ].join(" ");
      const result = await postAnalysis(worker, {
        queries: ["seo audit"],
        serpQuery: "seo audit",
        language: "en",
        ownPage: { name: "Our page", text: `${sharedCopy} ${sharedCopy}` },
        competitors: Array.from({ length: 6 }, (_, index) => ({
          name: `Competitor ${index + 1}`,
          text: `${sharedCopy} ${index < 2 ? "Specialized crawler diagnostics support technical review." : ""} Competitor example ${index + 1} adds strategy, governance, workflow, and documentation details.`,
        })),
        search: { engine: "google", region: "us", device: "desktop", found: 6 },
      });
      assert.equal(result.response.status, 200, result.data.error || "snapshot fixture failed");
      assert.equal(result.data.snapshot.version, 5);
      return result.data;
    });
  }
  return structuredClone(await completeReportPromise);
}

function eligibleNgrams(report) {
  return report.ngrams.filter((row) => row.importance >= 70 && row.key.split(/\s+/u).length >= 2);
}

function selectedLlmNgrams(report) {
  return eligibleNgrams(report)
    .sort((left, right) => right.importance - left.importance
      || right.sites - left.sites
      || left.key.localeCompare(right.key, report.snapshot.language))
    .slice(0, 20);
}

function focusNgram(report) {
  const selected = selectedLlmNgrams(report);
  const focus = selected.find((row) => row.key.includes("seo") && row.key.includes("audit")) || selected[0];
  assert.ok(focus, "the real report must provide an eligible N-gram");
  return focus;
}

function alphaSuffix(index) {
  let value = index;
  let suffix = "";
  do {
    suffix = String.fromCharCode(97 + value % 26) + suffix;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return suffix;
}

const CROWDED_PHRASES = Array.from({ length: 36 }, (_, index) => {
  const suffix = alphaSuffix(index);
  return `signal${suffix} topic${suffix}`;
});
let crowdedReportPromise;

async function crowdedReport() {
  if (!crowdedReportPromise) {
    crowdedReportPromise = workerPromise.then(async (worker) => {
      const corpusText = `${CROWDED_PHRASES[0]}. ${CROWDED_PHRASES.join(". ")}.`;
      const queryPhrases = CROWDED_PHRASES.slice(1, 21);
      const result = await postAnalysis(worker, {
        queries: queryPhrases,
        serpQuery: queryPhrases[0],
        language: "en",
        ownPage: { name: "Crowded own page", text: corpusText },
        competitors: Array.from({ length: 6 }, (_, index) => ({
          name: `Crowded competitor ${index + 1}`,
          text: `${corpusText} Independent comparison example ${alphaSuffix(index)} provides enough useful content for analysis.`,
        })),
        search: { engine: "google", region: "us", device: "desktop", found: 6 },
      });
      assert.equal(result.response.status, 200, result.data.error || "crowded N-gram fixture failed");
      assert.ok(eligibleNgrams(result.data).length >= 2, "fixture must provide several real eligible N-grams");
      return result.data;
    });
  }
  return structuredClone(await crowdedReportPromise);
}

function sentenceCorpus(sentences) {
  return sentences.map((sentence, index) => ({
    id: sentence.id || `acceptance-sentence-${index + 1}`,
    text: sentence.text,
    tokenKeys: sentence.tokenKeys,
    tokenCount: sentence.tokenKeys.length,
  }));
}

function document(template, name, sentences = [], url = "") {
  return { ...structuredClone(template), name, url, sentenceCorpus: sentenceCorpus(sentences) };
}

function snapshot(base, { ownSentences = [], competitors, version = 5 } = {}) {
  const corpus = structuredClone(base);
  corpus.version = version;
  corpus.id = `triplet-snapshot-${version}`;
  corpus.own = document(corpus.own, "Our page", ownSentences, "https://ours.example.test/seo-audits");
  if (competitors) corpus.competitors = competitors;
  else corpus.competitors = corpus.competitors.map((item) => ({ ...item, sentenceCorpus: [] }));
  corpus.search = { ...corpus.search, found: corpus.competitors.length };
  return corpus;
}

function matchingSentenceFor(focus) {
  return {
    text: `${focus.forms.find((form) => /audits/iu.test(form)) || focus.phrase} improve result and boost reach.`,
    tokenKeys: [...focus.key.split(/\s+/u), "improv", "result", "and", "boost", "reach"],
  };
}

function morphologySentenceFor(focus) {
  return {
    text: `${focus.phrase} improves results and boosts reach.`,
    tokenKeys: [...focus.key.split(/\s+/u), "improv", "result", "and", "boost", "reach"],
  };
}

function unrelatedSentenceFor(focus) {
  const keys = focus.key.split(/\s+/u);
  return {
    text: "The same words are separated here, so this sentence is not evidence.",
    tokenKeys: [keys[0], "separated", ...keys.slice(1), "unrelated", "context"],
  };
}

const ENV_KEYS = [
  "TRIPLET_ENGINE",
  "TRIPLETS_SERVICE_URL",
  "TRIPLET_API_URL",
  "TRIPLET_API_KEY",
  "TRIPLETS_API_TOKEN",
  "TRIPLET_MODEL",
  "TRIPLETS_LLM_MODEL",
  "TRIPLET_SPACY_URL",
  "TRIPLET_SPACY_TIMEOUT_MS",
];

async function withTripletEnv(values, action) {
  const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  try { return await action(); }
  finally {
    for (const key of ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("triplets are OFF by default and make zero external calls", { concurrency: false }, async () => {
  const worker = await workerPromise;
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls += 1;
    throw new Error("disabled triplets attempted an external call");
  };
  try {
    await withTripletEnv({ TRIPLETS_SERVICE_URL: "https://triplets.example.test" }, async () => {
      const { response, data } = await postTriplets(worker, { tripletsEnabled: false });
      assert.equal(response.status, 200);
      assert.equal(data.triplets.status, "disabled");
      assert.equal(data.triplets.enabled, false);
      assert.deepEqual(data.triplets.candidates, []);
      assert.deepEqual(data.triplets.edges, []);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(externalCalls, 0);
});

test("the deferred LLM experiment requires an explicit engine opt-in", { concurrency: false }, async () => {
  const worker = await workerPromise;
  const report = await completeReport();
  const focus = focusNgram(report);
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify({
      ok: false,
      error: { code: "dependency_unavailable", message: "spaCy is not installed" },
    }), { status: 503, headers: { "content-type": "application/json" } });
  };
  try {
    await withTripletEnv({
      TRIPLET_API_URL: "http://127.0.0.1:11434/v1",
      TRIPLET_MODEL: "bar-triplets",
      TRIPLET_API_KEY: "ollama",
    }, async () => {
      const { response, data } = await postTriplets(worker, {
        tripletsEnabled: true,
        snapshot: snapshot(report.snapshot, { ownSentences: [matchingSentenceFor(focus)] }),
        queries: report.meta.queries,
      });
      assert.equal(response.status, 200);
      assert.equal(data.triplets.status, "unavailable");
      assert.deepEqual(data.triplets.edges, []);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(requestedUrls, ["http://127.0.0.1:8092/v1/triplets"]);
  assert.equal(requestedUrls.some((url) => url.includes("11434")), false);
});

test("spaCy is the default engine and receives the complete filtered snapshot union", { concurrency: false }, async () => {
  const worker = await workerPromise;
  const report = await completeReport();
  const focus = focusNgram(report);
  const ownEvidence = matchingSentenceFor(focus);
  const competitorEvidence = {
    text: `${focus.phrase} improve strategy and strengthen visibility.`,
    tokenKeys: [...focus.key.split(/\s+/u), "improv", "strateg", "and", "strengthen", "visibl"],
  };
  const competitors = report.snapshot.competitors.map((item, index) => index === 0
    ? document(item, "Competitor 1", [competitorEvidence], "https://competitor.example.test/audit")
    : { ...structuredClone(item), sentenceCorpus: [] });
  const corpus = snapshot(report.snapshot, { ownSentences: [ownEvidence], competitors });
  const hiddenOwnOnlyKey = "hiddenentitytoken";
  const stoppedOwnOnlyKey = "blockedentitytoken";
  corpus.own.termCounts = [...corpus.own.termCounts, [hiddenOwnOnlyKey, 2], [stoppedOwnOnlyKey, 2]];
  corpus.own.termForms = [...corpus.own.termForms, [hiddenOwnOnlyKey, [[hiddenOwnOnlyKey, 2]]], [stoppedOwnOnlyKey, [[stoppedOwnOnlyKey, 2]]]];
  const originalFetch = globalThis.fetch;
  let requestBody;
  let requestUrl;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body || "{}"));
    const source = requestBody.entities.find((entity) => entity.kind === "ngram");
    const target = requestBody.entities.find((entity) => entity.kind === "lemma" && entity.id !== source?.id);
    assert.ok(source && target, "symbolic request must contain both candidate kinds");
    const evidenceDocuments = requestBody.documents.filter((item) => item.sentences.length > 0);
    assert.ok(evidenceDocuments.length >= 2, "fixture must provide two document-scoped sentences");
    return new Response(JSON.stringify({
      ok: true,
      engine: "spacy",
      engine_version: "3.8.15",
      model: "en_core_web_sm",
      relations: [{
        id: "rel-test",
        source_id: source.id,
        source_label: source.label,
        predicate: "improve",
        target_id: target.id,
        target_label: target.label,
        negated: false,
        support: 2,
        document_count: 2,
        evidence: evidenceDocuments.slice(0, 2).map((item) => ({
          document_id: item.id,
          document_name: item.name,
          document_url: item.url,
          ours: item.ours,
          sentence_id: item.sentences[0].id,
          sentence: item.sentences[0].text,
        })),
      }],
      meta: { min_support: 2, relations_truncated: false },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await withTripletEnv({}, async () => {
      const { response, data } = await postTriplets(worker, {
        tripletsEnabled: true,
        snapshot: corpus,
        queries: report.meta.queries,
        stopWords: [stoppedOwnOnlyKey],
      });
      assert.equal(response.status, 200, data.error || "spaCy dispatcher failed");
      assert.equal(data.triplets.status, "ready");
      assert.equal(data.triplets.threshold, 0);
      assert.equal(data.triplets.edges.length, 1);
      assert.equal(data.triplets.edges[0].occurrences, 2);
      assert.match(data.triplets.model, /^spacy 3\.8\.15/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(requestUrl, "http://127.0.0.1:8092/v1/triplets");
  assert.equal(requestBody.min_support, 2);
  const requestIdentities = new Set(requestBody.entities.map((entity) => `${entity.kind}\u0000${entity.key}`));
  for (const row of report.lemmas) assert.ok(requestIdentities.has(`lemma\u0000${row.key}`), `visible lemma ${row.key} must remain in the complete union`);
  for (const row of report.ngrams) assert.ok(requestIdentities.has(`ngram\u0000${row.key}`), `visible N-gram ${row.key} must remain in the complete union`);
  assert.ok(requestIdentities.has(`lemma\u0000${hiddenOwnOnlyKey}`), "an own-only snapshot term hidden from the compact report must be analyzed");
  assert.equal(requestIdentities.has(`lemma\u0000${stoppedOwnOnlyKey}`), false, "active stop words must still remove hidden snapshot terms");
  assert.ok(requestBody.entities.length > report.lemmas.length + report.ngrams.length, "the complete union must be a superset of compact report rows");
  assert.ok(requestBody.entities.some((entity) => entity.kind === "lemma" && entity.importance < 70));
  assert.ok(requestBody.entities.some((entity) => entity.kind === "ngram"));
});

test("direct Ollama mode disables reasoning and accepts grounded OpenAI-compatible JSON", { concurrency: false }, async () => {
  const worker = await workerPromise;
  const report = await completeReport();
  const focus = focusNgram(report);
  const evidence = matchingSentenceFor(focus);
  const originalFetch = globalThis.fetch;
  let directCalls = 0;
  let directRequest;

  globalThis.fetch = async (input, init) => {
    directCalls += 1;
    const body = JSON.parse(String(init?.body || "{}"));
    directRequest = {
      url: String(input),
      model: body.model,
      reasoningEffort: body.reasoning_effort,
      responseFormat: body.response_format,
      systemPrompt: body.messages?.[0]?.content,
      authorization: String(init?.headers?.authorization || ""),
    };
    const request = JSON.parse(body.messages[1].content);
    directRequest.focusIds = request.focus_entity_ids;
    directRequest.focusLabels = request.entities
      .filter((entity) => request.focus_entity_ids.includes(entity.id))
      .flatMap((entity) => [entity.label, ...entity.aliases]);
    directRequest.sentenceIds = request.sentences.map((sentence) => sentence.id);
    const sentenceId = request.sentences[0].id;
    const sourceId = request.sentences[0].entity_ids[0];
    return new Response(JSON.stringify({
      model: "qwen3:1.7b",
      choices: [{ message: { content: JSON.stringify({
        edges: [{
          source_id: sourceId,
          predicate: "improve",
          target_label: "result",
          sentence_id: sentenceId,
          negated: false,
        }],
      }) } }],
      usage: { prompt_tokens: 90, completion_tokens: 18, total_tokens: 108 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    await withTripletEnv({
      TRIPLET_ENGINE: "llm",
      TRIPLET_API_URL: "http://127.0.0.1:11434/v1",
      TRIPLET_MODEL: "qwen3:1.7b",
      TRIPLET_API_KEY: "ollama",
    }, async () => {
      const corpus = snapshot(report.snapshot, { ownSentences: [evidence] });
      const { response, data } = await postTriplets(worker, {
        tripletsEnabled: true,
        snapshot: corpus,
        queries: report.meta.queries,
      });
      assert.equal(response.status, 200, data.error || "direct Ollama extraction failed");
      assert.equal(data.triplets.status, "ready");
      assert.equal(data.triplets.model, "qwen3:1.7b");
      assert.equal(data.triplets.edges.length, 1);
      assert.equal(data.triplets.edges[0].targetLabel, "result");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(directCalls, 1);
  assert.equal(directRequest.url, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(directRequest.model, "qwen3:1.7b");
  assert.equal(directRequest.reasoningEffort, "none");
  assert.equal(directRequest.responseFormat.type, "json_schema");
  assert.equal(directRequest.responseFormat.json_schema.strict, true);
  assert.deepEqual(directRequest.responseFormat.json_schema.schema.required, ["edges"]);
  assert.deepEqual(
    directRequest.responseFormat.json_schema.schema.properties.edges.items.required,
    ["source_id", "predicate", "target_label", "sentence_id", "negated"],
  );
  const edgeSchema = directRequest.responseFormat.json_schema.schema.properties.edges.items.properties;
  assert.deepEqual(edgeSchema.source_id.enum, directRequest.focusIds);
  assert.deepEqual(edgeSchema.sentence_id.enum, directRequest.sentenceIds);
  assert.equal(Object.hasOwn(edgeSchema, "target_id"), false);
  for (const label of directRequest.focusLabels) assert.ok(edgeSchema.target_label.not.enum.includes(label));
  assert.match(directRequest.systemPrompt, /CONTIGUOUS substring/);
  assert.match(directRequest.systemPrompt, /Never lemmatize, normalize, translate, or paraphrase/);
  assert.match(directRequest.systemPrompt, /Keep the source language/);
  assert.match(directRequest.systemPrompt, /Do not output target_id/);
  assert.match(directRequest.authorization, /^Bearer ollama$/);
});

test("selection enforces importance 70, matches inflections, sends only evidence, and keeps one-to-many relations", { concurrency: false }, async () => {
  const worker = await workerPromise;
  const report = await completeReport();
  const base = report.snapshot;
  const focus = focusNgram(report);
  const matchingSentence = matchingSentenceFor(focus);
  const morphologySentence = morphologySentenceFor(focus);
  const unrelatedSentence = unrelatedSentenceFor(focus);
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  let serviceRequest;
  globalThis.fetch = async (_input, init) => {
    externalCalls += 1;
    serviceRequest = JSON.parse(String(init?.body || "{}"));
    const sentenceId = serviceRequest.sentences[0]?.id;
    const morphologySentenceId = serviceRequest.sentences[1]?.id;
    const sourceId = serviceRequest.sentences[0]?.entity_ids[0];
    return new Response(JSON.stringify({
      model: "acceptance-ie-small",
      edges: [
        { source_id: sourceId, predicate: "improve", target_label: "result", sentence_id: sentenceId, negated: false },
        { source_id: sourceId, predicate: "improves", target_label: "results", sentence_id: morphologySentenceId, negated: false },
        { source_id: sourceId, predicate: "boost", target_label: "reach", sentence_id: sentenceId, negated: false },
        { source_id: sourceId, predicate: "invent", target_label: "customers", sentence_id: sentenceId, negated: false },
        { source_id: sourceId, predicate: "improve", target_label: "customers", sentence_id: sentenceId, negated: false },
        { source_id: "seed-404", predicate: "improve", target_label: "result", sentence_id: sentenceId, negated: false },
        { source_id: sourceId, predicate: "improve", target_label: "result", sentence_id: "sentence-404", negated: false },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 32, total_tokens: 152 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    await withTripletEnv({ TRIPLET_ENGINE: "llm", TRIPLETS_SERVICE_URL: "https://triplets.example.test" }, async () => {
      const corpus = snapshot(base, { ownSentences: [matchingSentence, morphologySentence, unrelatedSentence] });
      const { response, data } = await postTriplets(worker, {
        tripletsEnabled: true,
        snapshot: corpus,
        queries: report.meta.queries,
      });
      assert.equal(response.status, 200, data.error || "triplet extraction failed");
      assert.equal(data.triplets.status, "ready");
      assert.equal(data.triplets.threshold, 70);
      assert.ok(report.ngrams.some((row) => row.importance < 70), "fixture must contain below-threshold N-grams");
      assert.ok(data.triplets.candidates.length > 0);
      assert.ok(data.triplets.candidates.every((candidate) => candidate.importance >= 70));
      assert.ok(data.triplets.candidates.some((candidate) => candidate.key === focus.key));
      assert.ok(serviceRequest.entities.length >= 1);
      assert.equal(serviceRequest.sentences.length, 2, "unrelated sentences must not reach the IE model");
      assert.equal(serviceRequest.sentences[0].text, matchingSentence.text);
      assert.equal(serviceRequest.sentences[1].text, morphologySentence.text);
      assert.ok(serviceRequest.sentences[0].entity_ids.length >= 1);
      assert.equal(data.triplets.edges.length, 2, "hallucinated or ungrounded edges must be rejected");
      assert.ok(data.triplets.edges.every((edge) => edge.sourceId === serviceRequest.sentences[0].entity_ids[0]));
      assert.deepEqual(new Set(data.triplets.edges.map((edge) => edge.targetLabel)), new Set(["result", "reach"]));
      const morphologicalEdge = data.triplets.edges.find((edge) => edge.targetLabel === "result");
      assert.equal(morphologicalEdge?.occurrences, 2, "predicate and target inflections must aggregate into one edge");
      assert.ok(data.triplets.edges.every((edge) => edge.documents.some((item) => item.ours)));
      assert.ok(data.triplets.edges.every((edge) => edge.examples.every((example) => [matchingSentence.text, morphologySentence.text].includes(example.text))));
      assert.equal(data.triplets.model, "acceptance-ie-small");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(externalCalls, 1);
});

test("a known target id is accepted only when its supplied label resolves to that entity", { concurrency: false }, async () => {
  const worker = await workerPromise;
  const report = await crowdedReport();
  const eligible = eligibleNgrams(report);
  assert.ok(eligible.length >= 2, "fixture needs two known entities");
  const sourceTerm = eligible[0];
  const targetTerm = eligible.find((row) => (
    row.key !== sourceTerm.key
    && !row.key.includes(sourceTerm.key)
    && !sourceTerm.key.includes(row.key)
  )) || eligible[1];
  const sourceSurface = sourceTerm.forms?.[0] || sourceTerm.phrase;
  const targetSurface = targetTerm.forms?.[0] || targetTerm.phrase;
  const mainSentence = {
    text: `${sourceSurface} improve ${targetSurface} while unrelated marker appears.`,
    tokenKeys: [],
  };
  const crossSentence = {
    text: `${sourceSurface} support conversions.`,
    tokenKeys: [],
  };
  const originalFetch = globalThis.fetch;
  let serviceRequest;

  globalThis.fetch = async (_input, init) => {
    serviceRequest = JSON.parse(String(init?.body || "{}"));
    const entityById = new Map(serviceRequest.entities.map((entity) => [entity.id, entity]));
    const main = serviceRequest.sentences.find((sentence) => sentence.text === mainSentence.text);
    const cross = serviceRequest.sentences.find((sentence) => sentence.text === crossSentence.text);
    assert.ok(main && cross, "both grounded evidence sentences must reach the service");
    const crossIds = new Set(cross.entity_ids);
    const sourceId = main.entity_ids.find((id) => crossIds.has(id));
    const targetId = main.entity_ids.find((id) => id !== sourceId && !crossIds.has(id));
    assert.ok(sourceId && targetId, "fixture must expose distinct source and target entities");
    const source = entityById.get(sourceId);
    const target = entityById.get(targetId);
    const normalizedMain = main.text.toLocaleLowerCase("en");
    const surfaceInMain = (entity) => [entity.label, ...entity.aliases]
      .find((surface) => normalizedMain.includes(surface.toLocaleLowerCase("en")));
    const suppliedSource = surfaceInMain(source);
    const suppliedTarget = surfaceInMain(target);
    assert.ok(suppliedSource && suppliedTarget, "known aliases must be present in evidence");

    return new Response(JSON.stringify({
      model: "grounding-acceptance",
      edges: [
        // Same sentence, but B's id is paired with X's span: reject.
        { source_id: sourceId, predicate: "improve", target_id: targetId, target_label: "unrelated marker", sentence_id: main.id, negated: false },
        // A locally declared label/alias (including inflected observed forms): accept.
        { source_id: sourceId, predicate: "improve", target_id: targetId, target_label: suppliedTarget, sentence_id: main.id, negated: false },
        { source_id: sourceId, predicate: "improve", target_id: "entity-unknown", target_label: suppliedTarget, sentence_id: main.id, negated: false },
        { source_id: sourceId, predicate: "improve", target_id: sourceId, target_label: suppliedSource, sentence_id: main.id, negated: false },
        // The label and id are borrowed from main but attached to another sentence.
        { source_id: sourceId, predicate: "support", target_id: targetId, target_label: suppliedTarget, sentence_id: cross.id, negated: false },
        { source_id: sourceId, predicate: "improve", target_id: targetId, target_label: suppliedTarget, sentence_id: "sentence-unknown", negated: false },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    await withTripletEnv({ TRIPLET_ENGINE: "llm", TRIPLETS_SERVICE_URL: "https://triplets.example.test" }, async () => {
      const corpus = snapshot(report.snapshot, { ownSentences: [mainSentence, crossSentence] });
      const { response, data } = await postTriplets(worker, {
        tripletsEnabled: true,
        snapshot: corpus,
        queries: report.meta.queries,
      });
      assert.equal(response.status, 200, data.error || "target grounding failed");
      assert.equal(data.triplets.status, "ready");
      assert.equal(data.triplets.edges.length, 1, "mismatched, unknown, self, and cross-sentence targets must be rejected");
      assert.equal(
        data.triplets.edges[0].targetLabel,
        serviceRequest.entities.find((entity) => entity.id === data.triplets.edges[0].targetId)?.label,
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a v5 snapshot never refetches competitors and returns a typed unavailable result without an IE service", { concurrency: false }, async () => {
  const worker = await workerPromise;
  const report = await completeReport();
  const base = report.snapshot;
  const focus = focusNgram(report);
  const matchingSentence = matchingSentenceFor(focus);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("snapshot triplet analysis attempted a network fetch");
  };
  try {
    await withTripletEnv({ TRIPLET_ENGINE: "llm" }, async () => {
      const { response, data } = await postTriplets(worker, {
        tripletsEnabled: true,
        snapshot: snapshot(base, { ownSentences: [matchingSentence] }),
        queries: report.meta.queries,
      });
      assert.equal(response.status, 200, data.error || "unavailable response failed");
      assert.equal(data.triplets.status, "unavailable");
      assert.equal(data.triplets.enabled, true);
      assert.equal(data.triplets.threshold, 70);
      assert.ok(data.triplets.meta.candidateCount >= 1);
      assert.equal(data.triplets.meta.evidenceSentenceCount, 1);
      assert.deepEqual(data.triplets.edges, []);
      assert.equal(typeof data.triplets.message, "string");

      const stopped = await postTriplets(worker, {
        tripletsEnabled: true,
        snapshot: snapshot(base, { ownSentences: [matchingSentence] }),
        queries: report.meta.queries,
        stopPhrases: [focus.phrase],
      });
      assert.equal(stopped.response.status, 200, stopped.data.error || "stop-filter request failed");
      assert.ok(stopped.data.triplets.candidates.every((candidate) => candidate.key !== focus.key));
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0);
});

test("forged snapshot token keys cannot create evidence or trigger the model", { concurrency: false }, async () => {
  const worker = await workerPromise;
  const report = await completeReport();
  const focus = focusNgram(report);
  const forgedSentence = {
    text: "This sentence contains no selected entity and must remain unrelated.",
    tokenKeys: [...focus.key.split(/\s+/u), "forged", "evidence"],
  };
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls += 1;
    throw new Error("forged token keys reached the external model");
  };
  try {
    await withTripletEnv({ TRIPLET_ENGINE: "llm", TRIPLETS_SERVICE_URL: "https://triplets.example.test" }, async () => {
      const { response, data } = await postTriplets(worker, {
        tripletsEnabled: true,
        snapshot: snapshot(report.snapshot, { ownSentences: [forgedSentence] }),
        queries: report.meta.queries,
      });
      assert.equal(response.status, 200, data.error || "forged-token request failed");
      assert.equal(data.triplets.status, "empty");
      assert.equal(data.triplets.meta.evidenceSentenceCount, 0);
      assert.deepEqual(data.triplets.edges, []);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(externalCalls, 0);
});

test("an empty result remains explicitly truncated when relevant text may be beyond the snapshot cap", { concurrency: false }, async () => {
  const worker = await workerPromise;
  const report = await completeReport();
  const corpus = snapshot(report.snapshot, { ownSentences: [] });
  corpus.own.sentenceCorpusTruncated = true;
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls += 1;
    throw new Error("an empty truncated selection reached the model");
  };
  try {
    await withTripletEnv({ TRIPLET_ENGINE: "llm", TRIPLETS_SERVICE_URL: "https://triplets.example.test" }, async () => {
      const { response, data } = await postTriplets(worker, {
        tripletsEnabled: true,
        snapshot: corpus,
        queries: report.meta.queries,
      });
      assert.equal(response.status, 200, data.error || "truncated-empty request failed");
      assert.equal(data.triplets.status, "empty");
      assert.equal(data.triplets.meta.evidenceSentenceCount, 0);
      assert.equal(data.triplets.meta.truncated, true);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(externalCalls, 0);
});

test("candidate, sentence, and token budgets are hard caps", { concurrency: false }, async () => {
  const worker = await workerPromise;
  const crowded = await crowdedReport();
  const crowdedCandidates = eligibleNgrams(crowded);
  const evidenceSentences = (documentIndex) => crowdedCandidates.flatMap((candidate, candidateIndex) => [0, 1].map((variant) => ({
    text: `${candidate.phrase} connects context document ${documentIndex + 1} variant ${candidateIndex + 1}-${variant + 1}.`,
    tokenKeys: [...candidate.key.split(/\s+/u), "connect", "context", `document${documentIndex + 1}`, `variant${candidateIndex + 1}${variant + 1}`],
  })));
  const shortDocuments = Array.from({ length: 50 }, (_, index) => document(
    crowded.snapshot.competitors[index % crowded.snapshot.competitors.length],
    `Competitor ${index + 1}`,
    evidenceSentences(index),
    `https://competitor-${index + 1}.example.test/`,
  ));

  const baseReport = await completeReport();
  const base = baseReport.snapshot;
  const focus = focusNgram(baseReport);
  const longEvidence = (documentIndex) => [0, 1].map((variant) => ({
    text: `${focus.phrase} ${"context".repeat(110)} document ${documentIndex + 1} variant ${variant + 1}.`,
    tokenKeys: [...focus.key.split(/\s+/u), `payload${documentIndex + 1}${variant + 1}`],
  }));
  const longDocuments = Array.from({ length: 45 }, (_, index) => document(
    base.competitors[0],
    `Long competitor ${index + 1}`,
    longEvidence(index),
    `https://long-${index + 1}.example.test/`,
  ));
  const cjkDocuments = Array.from({ length: 12 }, (_, index) => document(
    base.competitors[0],
    `CJK competitor ${index + 1}`,
    [{
      text: `${focus.phrase} ${"汉".repeat(820)} 文档${index + 1}`,
      tokenKeys: [...focus.key.split(/\s+/u), `cjk${index + 1}`],
    }],
    `https://cjk-${index + 1}.example.test/`,
  ));

  await withTripletEnv({ TRIPLET_ENGINE: "llm" }, async () => {
    const sentenceCapped = await postTriplets(worker, {
      tripletsEnabled: true,
      snapshot: snapshot(crowded.snapshot, { ownSentences: evidenceSentences(50), competitors: shortDocuments }),
      queries: crowded.meta.queries,
    });
    assert.equal(sentenceCapped.response.status, 200, sentenceCapped.data.error || "sentence cap request failed");
    assert.equal(sentenceCapped.data.triplets.status, "unavailable");
    assert.ok(sentenceCapped.data.triplets.candidates.length <= 20);
    assert.equal(sentenceCapped.data.triplets.candidates.length, Math.min(20, crowdedCandidates.length));
    assert.equal(sentenceCapped.data.triplets.meta.maxCandidates, 20);
    assert.equal(sentenceCapped.data.triplets.meta.evidenceSentenceCount, 250);
    assert.equal(sentenceCapped.data.triplets.meta.maxSentences, 250);
    assert.ok(sentenceCapped.data.triplets.meta.inputTokens <= 6_000);
    assert.equal(sentenceCapped.data.triplets.meta.maxInputTokens, 6_000);
    assert.equal(sentenceCapped.data.triplets.meta.truncated, true);

    const tokenCapped = await postTriplets(worker, {
      tripletsEnabled: true,
      snapshot: snapshot(base, { ownSentences: longEvidence(45), competitors: longDocuments }),
      queries: baseReport.meta.queries,
    });
    assert.equal(tokenCapped.response.status, 200, tokenCapped.data.error || "token cap request failed");
    assert.equal(tokenCapped.data.triplets.status, "unavailable");
    assert.ok(tokenCapped.data.triplets.meta.evidenceSentenceCount < tokenCapped.data.triplets.meta.maxSentences);
    assert.ok(tokenCapped.data.triplets.meta.inputTokens <= tokenCapped.data.triplets.meta.maxInputTokens);
    assert.equal(tokenCapped.data.triplets.meta.truncated, true);

    const cjkCapped = await postTriplets(worker, {
      tripletsEnabled: true,
      snapshot: snapshot(base, { competitors: cjkDocuments }),
      queries: baseReport.meta.queries,
    });
    assert.equal(cjkCapped.response.status, 200, cjkCapped.data.error || "CJK cap request failed");
    assert.equal(cjkCapped.data.triplets.status, "unavailable");
    assert.ok(cjkCapped.data.triplets.meta.evidenceSentenceCount < cjkDocuments.length);
    assert.ok(cjkCapped.data.triplets.meta.inputTokens <= cjkCapped.data.triplets.meta.maxInputTokens);
    assert.ok(cjkCapped.data.triplets.meta.inputTokens >= cjkCapped.data.triplets.meta.evidenceSentenceCount * 800, "dense CJK text must be budgeted close to one token per character");
    assert.equal(cjkCapped.data.triplets.meta.truncated, true);
  });
});

test("snapshot v4 is rejected before any model call", { concurrency: false }, async () => {
  const worker = await workerPromise;
  const report = await completeReport();
  const base = report.snapshot;
  const focus = focusNgram(report);
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls += 1;
    throw new Error("an obsolete snapshot reached the model");
  };
  try {
    await withTripletEnv({ TRIPLET_ENGINE: "llm", TRIPLETS_SERVICE_URL: "https://triplets.example.test" }, async () => {
      const { response, data } = await postTriplets(worker, {
        tripletsEnabled: true,
        snapshot: snapshot(base, { ownSentences: [matchingSentenceFor(focus)], version: 4 }),
        queries: report.meta.queries,
      });
      assert.equal(response.status, 400);
      assert.match(data.error, /snapshot v5/i);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(externalCalls, 0);
});

test("malformed, empty, and oversized snapshot v5 payloads are rejected before any model call", { concurrency: false }, async () => {
  const worker = await workerPromise;
  const report = await completeReport();
  const cases = [];

  const missingOwn = structuredClone(report.snapshot);
  delete missingOwn.own;
  cases.push(["missing own", missingOwn]);

  const emptyCompetitors = structuredClone(report.snapshot);
  emptyCompetitors.competitors = [];
  cases.push(["empty competitors", emptyCompetitors]);

  const invalidLanguage = structuredClone(report.snapshot);
  invalidLanguage.language = "not-a-language";
  cases.push(["invalid language", invalidLanguage]);

  const malformedZone = structuredClone(report.snapshot);
  malformedZone.own.zones.all = null;
  cases.push(["malformed zone", malformedZone]);

  const malformedForms = structuredClone(report.snapshot);
  malformedForms.own.termForms = [["seo", "not-an-array"]];
  cases.push(["malformed forms", malformedForms]);

  const invalidCount = structuredClone(report.snapshot);
  invalidCount.own.termCounts = [["seo", -1]];
  cases.push(["negative count", invalidCount]);

  const nonFiniteCount = structuredClone(report.snapshot);
  nonFiniteCount.own.ngramCounts = [["seo audit", Number.NaN]];
  cases.push(["non-finite count", nonFiniteCount]);

  const oversizedKey = structuredClone(report.snapshot);
  oversizedKey.own.termCounts = [["x".repeat(257), 1]];
  cases.push(["oversized key", oversizedKey]);

  const oversizedForm = structuredClone(report.snapshot);
  oversizedForm.own.termForms = [["seo", [["x".repeat(257), 1]]]];
  cases.push(["oversized form", oversizedForm]);

  const oversizedCounts = structuredClone(report.snapshot);
  oversizedCounts.own.termCounts = Array.from({ length: 4_001 }, (_, index) => [`term-${index}`, 1]);
  cases.push(["oversized count array", oversizedCounts]);

  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls += 1;
    throw new Error("an invalid snapshot reached the model");
  };
  try {
    await withTripletEnv({ TRIPLET_ENGINE: "llm", TRIPLETS_SERVICE_URL: "https://triplets.example.test" }, async () => {
      for (const [label, invalidSnapshot] of cases) {
        const { response, data } = await postTriplets(worker, {
          tripletsEnabled: true,
          snapshot: invalidSnapshot,
          queries: report.meta.queries,
        });
        assert.equal(response.status, 400, `${label}: ${data.error || "expected a controlled error"}`);
        assert.match(data.error, /snapshot/i, `${label}: error must identify the invalid snapshot`);
        assert.doesNotMatch(data.error, /\.map is not a function|cannot read propert|NaN/i, `${label}: error must stay controlled`);
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(externalCalls, 0);
});

test("the report UI keeps triplets optional, separate, cached as v10, and snapshot-only", async () => {
  const [page, core, css] = await Promise.all([
    readFile(new URL("../app/analyzer/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/semantic-analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/analyzer/analyzer.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /const REPORT_STORAGE_KEY = "bar:last-report:v10"/);
  assert.match(page, /const LEGACY_REPORT_STORAGE_KEY = "bar:last-report:v9"/);
  assert.match(page, /const \[tripletsEnabled, setTripletsEnabled\] = useState\(false\)/);
  assert.match(page, /fetch\("\/api\/analyze-triplets"/);
  assert.match(page, /tripletsEnabled: true/);
  assert.match(page, /snapshot: baseReport\.snapshot/);
  assert.match(page, /Построить связи/);
  assert.match(page, /Семантические связи после пересчёта/);
  assert.match(page, /spaCy/u, "the active deterministic engine must be named in the UI");
  assert.match(page, /N-грамм[\s\S]{0,180}лемм|лемм[\s\S]{0,180}N-грамм/u, "the UI must explain that both report lemmas and N-grams are parsed");
  assert.doesNotMatch(page, /70%/u, "the archived importance-70 hypothesis must not remain in the active UI");
  assert.doesNotMatch(page, /внешний сервис модели/u, "the active spaCy path must not be described as an external model service");
  assert.match(page, /function isCurrentSnapshot/);
  assert.match(page, /if \(!isCurrentSnapshot\(baseReport\.snapshot\)\)/);
  assert.match(page, /disabled=\{loading \|\| tripletBusy \|\| !snapshotIsCurrent \|\| !currentKeys\.length\}/);
  assert.match(page, /Обновить конкурентов/);
  assert.doesNotMatch(page, /репрезентативный срез|часть предложений осталась за безопасным лимитом/u);
  assert.match(page, /Показано \{integer\.format\(visibleTripletEdges\.length\)\} из \{integer\.format\(filteredTripletEdges\.length\)\}/u);
  const buildBlock = page.slice(page.indexOf("const buildTriplets"), page.indexOf("const updateTripletsEnabled"));
  assert.ok(buildBlock.length > 0);
  assert.doesNotMatch(buildBlock, /search-competitors|analyze-run/);
  assert.ok(page.indexOf('id="triplets"') > page.indexOf('id="ngrams"'));
  assert.match(core, /Keep a global importance union[\s\S]*?\.slice\(0, 20\)[\s\S]*?selectedNgramKeys\.add\(row\.key\)/);
  assert.match(css, /\.tripletNode \{[^}]*font-size: 12px/);
  assert.match(css, /\.tripletExamples p \{[^}]*font-size: 12px/);
  assert.match(css, /\.tripletDocuments a, \.tripletDocuments > span \{[^}]*font-size: 11px/);
  assert.match(css, /\.tripletOption small \{[^}]*font-size: 11px/);
});
