// Local spaCy may legitimately return thousands of supported relations. This
// is an emergency response guard, not a product row limit.
const SYMBOLIC_RESPONSE_MAX_CHARACTERS = 128_000_000;

export type SymbolicEntity = {
  id: string;
  key: string;
  label: string;
  kind: "lemma" | "ngram";
  forms: string[];
  importance: number;
};

export type SymbolicDocument = {
  id: string;
  name: string;
  url: string;
  ours: boolean;
  sentences: Array<{ id: string; text: string }>;
};

export type SymbolicPayload = {
  language: string;
  min_support: number;
  max_relations: number;
  entities: SymbolicEntity[];
  documents: SymbolicDocument[];
};

export type SymbolicEvidence = {
  document_id?: unknown;
  document_name?: unknown;
  document_url?: unknown;
  ours?: unknown;
  sentence_id?: unknown;
  sentence?: unknown;
};

export type SymbolicRelation = {
  id?: unknown;
  source_id?: unknown;
  source_label?: unknown;
  predicate?: unknown;
  target_id?: unknown;
  target_label?: unknown;
  negated?: unknown;
  support?: unknown;
  document_count?: unknown;
  evidence?: SymbolicEvidence[];
};

export type SymbolicResponse = {
  engine: string;
  engine_version: string;
  model: string;
  relations: SymbolicRelation[];
  meta: Record<string, unknown>;
};

export class SymbolicServiceError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number) {
    super(message);
    this.name = "SymbolicServiceError";
  }
}

function timeoutMs() {
  const configured = Number(process.env.TRIPLET_SPACY_TIMEOUT_MS || process.env.TRIPLET_TIMEOUT_MS);
  return Number.isFinite(configured)
    ? Math.min(3_600_000, Math.max(5_000, Math.trunc(configured)))
    : 900_000;
}

function endpoint() {
  const configured = process.env.TRIPLET_SPACY_URL?.trim() || "http://127.0.0.1:8092";
  const url = new URL(configured);
  if (!/^https?:$/.test(url.protocol)) throw new SymbolicServiceError("invalid_url", "TRIPLET_SPACY_URL должен использовать HTTP или HTTPS");
  if (!/\/v1\/triplets\/?$/i.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/triplets`.replace(/\/{2,}/g, "/");
  }
  return url.toString();
}

function stringField(record: Record<string, unknown>, key: string, fallback: string) {
  return typeof record[key] === "string" && record[key].trim() ? record[key].trim() : fallback;
}

export async function runSpacyTriplets(payload: SymbolicPayload): Promise<SymbolicResponse> {
  let response: Response;
  try {
    response = await fetch(endpoint(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (error) {
    throw new SymbolicServiceError(
      "service_unreachable",
      error instanceof Error ? error.message : "Не удалось подключиться к spaCy-сервису",
    );
  }
  const text = await response.text();
  if (text.length > SYMBOLIC_RESPONSE_MAX_CHARACTERS) {
    throw new SymbolicServiceError("response_too_large", "Ответ spaCy превысил безопасный размер", response.status);
  }
  let record: Record<string, unknown>;
  try { record = JSON.parse(text) as Record<string, unknown>; }
  catch { throw new SymbolicServiceError("invalid_response", "spaCy-сервис вернул некорректный JSON", response.status); }
  if (!response.ok || record.ok !== true) {
    const rawError = record.error && typeof record.error === "object"
      ? record.error as Record<string, unknown>
      : {};
    throw new SymbolicServiceError(
      stringField(rawError, "code", response.status === 429 ? "busy" : "service_error"),
      stringField(rawError, "message", `spaCy-сервис вернул HTTP ${response.status}`),
      response.status,
    );
  }
  return {
    engine: stringField(record, "engine", "spacy"),
    engine_version: stringField(record, "engine_version", "unknown"),
    model: stringField(record, "model", "unknown"),
    relations: Array.isArray(record.relations)
      ? record.relations.filter((item): item is SymbolicRelation => Boolean(item) && typeof item === "object")
      : [],
    meta: record.meta && typeof record.meta === "object" ? record.meta as Record<string, unknown> : {},
  };
}
