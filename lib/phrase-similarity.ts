export type PhraseSimilarityRequest = {
  queries: string[];
  candidates: string[];
  language: string;
  requestId: string;
};

export type PhraseSimilarityBest = {
  queryIndex: number;
  score: number;
};

export type PhraseSimilarityResult = {
  model: string;
  revision?: string;
  dimensions?: number;
  best: PhraseSimilarityBest[];
};

export type PhraseSimilarityProvider = (request: PhraseSimilarityRequest) => Promise<PhraseSimilarityResult>;

const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_TIMEOUT_MS = 300_000;
const RESPONSE_MAX_CHARACTERS = 16_000_000;

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.trunc(parsed))) : fallback;
}

function serviceEndpoint(base: string) {
  const url = new URL(base);
  if (!/^https?:$/u.test(url.protocol)) throw new Error("E5 service protocol must be HTTP or HTTPS");
  if (!/\/v1\/similarity\/?$/iu.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/$/u, "")}/v1/similarity`.replace(/\/{2,}/gu, "/");
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

function configuredUrl() {
  const value = process.env.PHRASE_EMBEDDINGS_URL?.trim();
  return value ? serviceEndpoint(value) : "";
}

function timeoutMs() {
  return boundedInteger(process.env.PHRASE_EMBEDDINGS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 5_000, 900_000);
}

function chunkSize() {
  return boundedInteger(process.env.PHRASE_EMBEDDINGS_CHUNK_SIZE, DEFAULT_CHUNK_SIZE, 16, 4_096);
}

function responseRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("E5 service returned an invalid object");
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function parseBest(value: unknown, expected: number, queryCount: number): PhraseSimilarityBest[] {
  if (!Array.isArray(value) || value.length !== expected) {
    throw new Error(`E5 service returned ${Array.isArray(value) ? value.length : 0} scores for ${expected} candidates`);
  }
  return value.map((entry, index) => {
    const record = responseRecord(entry);
    const rawQueryIndex = record.query_index ?? record.queryIndex;
    const rawScore = record.score;
    const queryIndex = Number(rawQueryIndex);
    const score = Number(rawScore);
    if (!Number.isInteger(queryIndex) || queryIndex < 0 || queryIndex >= queryCount) {
      throw new Error(`E5 service returned an invalid query index for candidate ${index}`);
    }
    if (!Number.isFinite(score)) throw new Error(`E5 service returned a non-finite score for candidate ${index}`);
    return { queryIndex, score: Math.min(1, Math.max(0, score)) };
  });
}

async function postChunk(
  url: string,
  request: PhraseSimilarityRequest,
  candidates: string[],
): Promise<PhraseSimilarityResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      request_id: request.requestId,
      language: request.language,
      queries: request.queries,
      candidates,
    }),
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (!response.ok) throw new Error(`E5 service returned HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > RESPONSE_MAX_CHARACTERS) throw new Error("E5 service response is too large");
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("E5 service returned invalid JSON"); }
  const record = responseRecord(parsed);
  if (record.ok === false) throw new Error(optionalString(record.error, 500) || "E5 service rejected the request");
  return {
    model: optionalString(record.model, 240) || "intfloat/multilingual-e5-large-instruct",
    revision: optionalString(record.revision, 128) || undefined,
    dimensions: Number.isInteger(Number(record.dimensions)) ? Number(record.dimensions) : undefined,
    best: parseBest(record.best, candidates.length, request.queries.length),
  };
}

export function configuredPhraseSimilarityProvider(): PhraseSimilarityProvider | undefined {
  const url = configuredUrl();
  if (!url) return undefined;
  return async (request) => {
    if (!request.queries.length || !request.candidates.length) {
      return { model: "intfloat/multilingual-e5-large-instruct", best: [] };
    }
    const best: PhraseSimilarityBest[] = [];
    let model = "";
    let revision: string | undefined;
    let dimensions: number | undefined;
    const size = chunkSize();
    for (let start = 0; start < request.candidates.length; start += size) {
      const chunk = request.candidates.slice(start, start + size);
      const result = await postChunk(url, request, chunk);
      if (model && result.model !== model) throw new Error("E5 service changed model during one analysis");
      model = result.model;
      revision = result.revision || revision;
      dimensions = result.dimensions ?? dimensions;
      best.push(...result.best);
    }
    if (best.length !== request.candidates.length) throw new Error("E5 service returned an incomplete result");
    return { model, revision, dimensions, best };
  };
}
