import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("spacy-triplets-v10", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

const environment = () => ({ ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } });
const context = () => ({ waitUntil() {}, passThroughOnException() {} });

async function post(worker, path, payload) {
  const response = await worker.fetch(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }), environment(), context());
  return { response, data: await response.json() };
}

const ENV_KEYS = [
  "TRIPLET_ENGINE",
  "TRIPLET_SPACY_URL",
  "TRIPLETS_SERVICE_URL",
  "TRIPLET_API_URL",
  "TRIPLET_API_KEY",
  "TRIPLET_MODEL",
  "TRIPLETS_LLM_MODEL",
];

async function withEnv(values, action) {
  const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  ENV_KEYS.forEach((key) => delete process.env[key]);
  Object.assign(process.env, values);
  try { return await action(); }
  finally {
    for (const key of ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const workerPromise = loadWorker();
let reportPromise;

async function reportFixture() {
  if (!reportPromise) {
    reportPromise = workerPromise.then(async (worker) => {
      const relationCopy = [
        "SEO курсы улучшают видимость сайта.",
        "SEO курсы увеличивают органический трафик.",
        "Практические занятия объясняют поисковое продвижение, аналитику, контент и техническую оптимизацию.",
        "Студенты выполняют аудит, исследуют конкурентов и измеряют результаты проекта.",
      ].join(" ");
      const result = await post(worker, "/api/analyze-run", {
        queries: ["seo курсы"],
        serpQuery: "seo курсы",
        language: "ru",
        ownPage: { name: "Наша страница", text: `${relationCopy} ${relationCopy}` },
        competitors: Array.from({ length: 3 }, (_, index) => ({
          name: `Конкурент ${index + 1}`,
          url: `https://competitor-${index + 1}.example/seo`,
          text: `${relationCopy} Дополнительный пример ${index + 1} описывает программу, преподавателей и учебные материалы.`,
        })),
        search: { engine: "google", region: "ru", device: "desktop", found: 3 },
      });
      assert.equal(result.response.status, 200, result.data.error || "spaCy acceptance fixture failed");
      assert.equal(result.data.snapshot.version, 5);
      return result.data;
    });
  }
  return structuredClone(await reportPromise);
}

function normalized(value) {
  return String(value).normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
}

function candidateSurfaces(candidate) {
  return [candidate.label, candidate.phrase, candidate.term, ...(candidate.forms ?? []), ...(candidate.aliases ?? [])]
    .filter(Boolean).map(normalized);
}

function candidateFor(candidates, words, kind = "ngram") {
  return candidates.find((candidate) => (!candidate.kind || candidate.kind === kind)
    && candidateSurfaces(candidate).some((surface) => words.every((word) => surface.includes(normalized(word)))));
}

function flatSentences(request) {
  if (Array.isArray(request.documents)) {
    return request.documents.flatMap((document) => (document.sentences ?? []).map((sentence) => ({
      ...sentence,
      document_id: document.id,
      document_name: document.name,
      document_url: document.url,
      ours: document.ours,
    })));
  }
  return (request.sentences ?? []).map((sentence) => ({
    ...sentence,
    document_id: sentence.document_id ?? sentence.source?.document_id ?? "unknown",
    document_name: sentence.document_name ?? sentence.source?.domain ?? sentence.source?.document_id ?? "unknown",
    document_url: sentence.document_url ?? "",
    ours: sentence.ours ?? sentence.source?.kind === "own",
  }));
}

function codePointSpan(text, surface) {
  const points = Array.from(text);
  const wanted = Array.from(surface);
  let charStart = -1;
  outer: for (let index = 0; index <= points.length - wanted.length; index += 1) {
    for (let offset = 0; offset < wanted.length; offset += 1) {
      if (normalized(points[index + offset]) !== normalized(wanted[offset])) continue outer;
    }
    charStart = index;
    break;
  }
  assert.ok(charStart >= 0, `${surface} must occur in evidence`);
  const prefix = points.slice(0, charStart).join("");
  const tokenStart = prefix.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  const tokenLength = surface.match(/[\p{L}\p{N}]+/gu)?.length ?? 1;
  return { token_start: tokenStart, token_end: tokenStart + tokenLength, char_start: charStart, char_end: charStart + wanted.length };
}

function relationEvidence(sentences, sourceSurface, predicateSurface, targetSurface, limit = 2) {
  return sentences.filter((sentence) => {
    const text = normalized(sentence.text);
    return text.includes(normalized(sourceSurface)) && text.includes(normalized(predicateSurface)) && text.includes(normalized(targetSurface));
  }).slice(0, limit).map((sentence) => ({
    source_id: "",
    source_label: sourceSurface,
    predicate: normalized(predicateSurface) === "улучшают" ? "улучшать" : "увеличивать",
    target_id: "",
    target_label: targetSurface,
    negated: false,
    pattern: "active",
    confidence: 0.92,
    document_id: sentence.document_id,
    document_name: sentence.document_name,
    document_url: sentence.document_url,
    ours: Boolean(sentence.ours),
    sentence_id: sentence.id,
    sentence: sentence.text,
    source_span: codePointSpan(sentence.text, sourceSurface),
    predicate_span: codePointSpan(sentence.text, predicateSurface),
    target_span: codePointSpan(sentence.text, targetSurface),
  }));
}

function symbolicResponse(request) {
  const candidates = request.candidates ?? request.entities ?? [];
  const sentences = flatSentences(request);
  const source = candidateFor(candidates, ["seo", "курс"]);
  const visibility = candidateFor(candidates, ["видимость", "сайт"]);
  const traffic = candidateFor(candidates, ["органический", "трафик"]);
  const sourceSurface = candidateSurfaces(source ?? {}).find((value) => value.includes("seo") && value.includes("курс")) || "seo курсы";
  const visibilitySurface = candidateSurfaces(visibility ?? {}).find((value) => value.includes("видим") && value.includes("сайт")) || "видимость сайта";
  const trafficSurface = candidateSurfaces(traffic ?? {}).find((value) => value.includes("органичес") && value.includes("трафик")) || "органический трафик";
  const visibilityEvidence = relationEvidence(sentences, sourceSurface, "улучшают", visibilitySurface);
  const trafficEvidence = relationEvidence(sentences, sourceSurface, "увеличивают", trafficSurface);
  const relation = (target, predicate, evidence, support = evidence.length) => ({
    id: `rel-${predicate}-${target?.id ?? "missing"}`,
    source_id: source?.id ?? "missing-source",
    source_label: source?.label ?? sourceSurface,
    predicate,
    target_id: target?.id ?? "missing-target",
    target_label: target?.label ?? (target === visibility ? visibilitySurface : trafficSurface),
    negated: false,
    support,
    sentence_count: support,
    document_count: new Set(evidence.map((item) => item.document_id)).size,
    own_support: evidence.filter((item) => item.ours).length,
    competitor_support: evidence.filter((item) => !item.ours).length,
    confidence: 0.92,
    patterns: ["active"],
    evidence: evidence.map((item) => ({ ...item, source_id: source?.id, target_id: target?.id })),
  });
  const supported = [
    relation(visibility, "улучшать", visibilityEvidence),
    relation(traffic, "увеличивать", trafficEvidence),
  ];
  const singleton = relation(traffic, "упоминать", trafficEvidence.slice(0, 1), 1);
  return {
    ok: true,
    engine: "spacy",
    engine_version: "3.8.15",
    model: "ru_core_news_sm",
    language: "ru",
    relations: [...supported, singleton],
    edges: [...supported, singleton],
    meta: { min_support: 2, supported_relations: supported.length },
  };
}

test("semantic links OFF makes zero spaCy or LLM calls", { concurrency: false }, async () => {
  const worker = await workerPromise;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("disabled semantic links attempted a model call");
  };
  try {
    await withEnv({
      TRIPLET_ENGINE: "spacy",
      TRIPLET_SPACY_URL: "http://127.0.0.1:8092",
      TRIPLET_API_URL: "http://127.0.0.1:11434/v1",
      TRIPLET_MODEL: "stale-llm",
    }, async () => {
      const { response, data } = await post(worker, "/api/analyze-triplets", { tripletsEnabled: false });
      assert.equal(response.status, 200);
      assert.equal(data.triplets.status, "disabled");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls, 0);
});

test("spaCy ON calls only the local parser and keeps one-to-many relations supported by two sentences", { concurrency: false }, async () => {
  const worker = await workerPromise;
  const report = await reportFixture();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body || "{}"));
    calls.push({ url, body });
    return new Response(JSON.stringify(symbolicResponse(body)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await withEnv({
      TRIPLET_ENGINE: "spacy",
      TRIPLET_SPACY_URL: "http://127.0.0.1:8092",
      // These stale values must be ignored while the selected engine is spaCy.
      TRIPLET_API_URL: "http://127.0.0.1:11434/v1",
      TRIPLET_MODEL: "bar-triplets",
      TRIPLETS_LLM_MODEL: "qwen3:1.7b",
    }, async () => {
      const { response, data } = await post(worker, "/api/analyze-triplets", {
        tripletsEnabled: true,
        snapshot: report.snapshot,
        queries: ["seo курсы"],
      });
      assert.equal(response.status, 200, data.error || "spaCy semantic-link request failed");
      assert.equal(calls.length, 1, "spaCy mode must make exactly one local parser call");
      assert.match(calls[0].url, /^http:\/\/(?:127\.0\.0\.1|localhost):8092\/v1\/triplets\/?$/u);
      assert.doesNotMatch(calls[0].url, /11434|chat\/completions/iu, "spaCy mode must not call the stale LLM endpoint");
      assert.doesNotMatch(JSON.stringify(calls[0].body), /"messages"|"prompt"|reasoning_effort|chat\/completions/iu);

      const sentCandidates = calls[0].body.candidates ?? calls[0].body.entities ?? [];
      assert.ok(sentCandidates.some((candidate) => candidate.kind === "lemma"), "all report lemmas must be offered to spaCy");
      assert.ok(sentCandidates.some((candidate) => candidate.kind === "ngram"), "all report N-grams must be offered to spaCy");
      assert.equal(calls[0].body.min_support ?? calls[0].body.minSupport, 2, "the local service contract must request support 2");

      assert.equal(data.triplets.status, "ready");
      assert.match(data.triplets.model ?? data.triplets.engine ?? "", /spacy|ru_core_news_sm/iu);
      assert.equal(data.triplets.edges.length, 2, "the singleton relation returned by the adapter must be filtered out");
      assert.equal(new Set(data.triplets.edges.map((edge) => edge.sourceId)).size, 1, "one source must retain multiple targets");
      assert.equal(new Set(data.triplets.edges.map((edge) => edge.targetId)).size, 2);
      assert.ok(data.triplets.edges.every((edge) => (edge.sentenceCount ?? edge.occurrences) >= 2));
      assert.ok(data.triplets.edges.every((edge) => edge.documentCount >= 1));
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("spaCy API preserves more than 512 supported relations and requests enough service capacity", { concurrency: false }, async () => {
  const worker = await workerPromise;
  const report = await reportFixture();
  const originalFetch = globalThis.fetch;
  const relationCount = 600;
  let requestBody;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body || "{}"));
    const candidates = requestBody.candidates ?? requestBody.entities ?? [];
    const sentences = flatSentences(requestBody);
    assert.ok(candidates.length >= 2, "the large-result fixture needs two known entities");
    assert.ok(sentences.length >= 2, "the large-result fixture needs two distinct evidence sentences");
    const source = candidates[0];
    const target = candidates[1];
    const evidence = sentences.slice(0, 2).map((sentence) => ({
      source_id: source.id,
      source_label: source.label,
      predicate: "связывать",
      target_id: target.id,
      target_label: target.label,
      negated: false,
      pattern: "acceptance",
      confidence: 0.91,
      document_id: sentence.document_id,
      document_name: sentence.document_name,
      document_url: sentence.document_url,
      ours: Boolean(sentence.ours),
      sentence_id: sentence.id,
      sentence: sentence.text,
    }));
    const relations = Array.from({ length: relationCount }, (_, index) => ({
      id: `large-relation-${index + 1}`,
      source_id: source.id,
      source_label: source.label,
      predicate: `связь ${index + 1}`,
      target_id: target.id,
      target_label: target.label,
      negated: false,
      support: 2,
      sentence_count: 2,
      document_count: new Set(evidence.map((item) => item.document_id)).size,
      confidence: 0.91,
      evidence: evidence.map((item) => ({ ...item, predicate: `связь ${index + 1}` })),
    }));
    return new Response(JSON.stringify({
      ok: true,
      engine: "spacy",
      engine_version: "3.8.15",
      model: "ru_core_news_sm",
      language: "ru",
      relations,
      edges: relations,
      meta: {
        min_support: 2,
        processed_relations: relationCount,
        supported_relations: relationCount,
        relations_truncated: false,
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await withEnv({ TRIPLET_ENGINE: "spacy", TRIPLET_SPACY_URL: "http://127.0.0.1:8092" }, async () => {
      const { response, data } = await post(worker, "/api/analyze-triplets", {
        tripletsEnabled: true,
        snapshot: report.snapshot,
        queries: ["seo курсы"],
      });
      assert.equal(response.status, 200, data.error || "large spaCy result failed");
      assert.equal(requestBody.min_support ?? requestBody.minSupport, 2, "support must remain two for a larger corpus");
      assert.ok(
        requestBody.max_relations === undefined || requestBody.max_relations === 0 || requestBody.max_relations >= relationCount,
        `the service request must not cap ${relationCount} relations at ${requestBody.max_relations}`,
      );
      assert.equal(data.triplets.status, "ready");
      assert.equal(data.triplets.edges.length, relationCount, "the API must not silently cut a result above 512 rows");
      assert.ok(data.triplets.edges.every((edge) => edge.occurrences >= 2), "the min-support invariant must survive the larger result");
      assert.equal(new Set(data.triplets.edges.map((edge) => edge.id)).size, relationCount);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stale LLM variables never activate an LLM and the default remains local spaCy", { concurrency: false }, async () => {
  const worker = await workerPromise;
  const report = await reportFixture();
  const originalFetch = globalThis.fetch;
  const calledUrls = [];
  globalThis.fetch = async (input) => {
    calledUrls.push(String(input));
    throw new Error("local spaCy is intentionally offline in this assertion");
  };
  try {
    await withEnv({
      TRIPLET_API_URL: "http://127.0.0.1:11434/v1",
      TRIPLET_MODEL: "bar-triplets",
      TRIPLETS_SERVICE_URL: "http://127.0.0.1:8091",
    }, async () => {
      const { response, data } = await post(worker, "/api/analyze-triplets", {
        tripletsEnabled: true,
        snapshot: report.snapshot,
        queries: ["seo курсы"],
      });
      assert.equal(response.status, 200);
      assert.equal(data.triplets.status, "unavailable");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(calledUrls.length >= 1, "the default semantic engine must attempt local spaCy");
  assert.ok(calledUrls.every((url) => /^http:\/\/(?:127\.0\.0\.1|localhost):8092\/v1\/triplets\/?$/u.test(url)));
  assert.ok(calledUrls.every((url) => !/11434|8091|chat\/completions/iu.test(url)), "stale LLM endpoints must not be called");

  const core = await readFile(new URL("../lib/semantic-triplets.ts", import.meta.url), "utf8");
  assert.match(core, /TRIPLET_ENGINE[\s\S]{0,160}["']llm["']/u, "the archived LLM branch must retain an explicit engine gate");
});

test("the report pages a large relation result while preserving the entity filter and full-corpus metadata", async () => {
  const [page, pythonWorker] = await Promise.all([
    readFile(new URL("../app/analyzer/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../services/triplets-symbolic/worker.py", import.meta.url), "utf8"),
  ]);
  assert.match(page, /const TRIPLET_EDGE_PAGE_SIZE = 30/u);
  assert.match(page, /filteredTripletEdges\.slice\(0, tripletEdgeLimit\)/u, "the UI must not mount every relation at once");
  assert.match(page, /setTripletEdgeLimit\(\(value\) => value \+ TRIPLET_EDGE_PAGE_SIZE\)/u);
  assert.match(page, /Показано \{integer\.format\(visibleTripletEdges\.length\)\} из \{integer\.format\(filteredTripletEdges\.length\)\}/u);
  assert.match(page, /edge\.sourceId === tripletSeed \|\| edge\.targetId === tripletSeed/u, "the entity filter must include incoming and outgoing relations");
  assert.match(page, /setTripletSeed\(event\.target\.value\); setTripletEdgeLimit\(TRIPLET_EDGE_PAGE_SIZE\)/u, "changing the entity must keep the filter and reset only its page");
  assert.match(page, /connectedTripletCandidates\.map\(\(candidate\) => <option/u, "the selector must include entities participating in any returned relation");
  assert.doesNotMatch(page, /\{tripletCandidates\.map\(\(candidate\) => <option/u, "a large corpus must not mount every candidate as an option");
  assert.match(page, /processedSentenceCount[\s\S]{0,300}totalSentenceCount/u, "the UI must understand full-corpus progress metadata");
  assert.doesNotMatch(page, /репрезентативный срез/iu);
  assert.doesNotMatch(page, /до \{integer\.format\(tripletData\.meta\.maxSentences\)\}/u, "legacy maxSentences must not be presented as the analyzed corpus");
  assert.doesNotMatch(pythonWorker, /min\(512,/u, "the local parser must not retain the old 512-relation ceiling");
});
