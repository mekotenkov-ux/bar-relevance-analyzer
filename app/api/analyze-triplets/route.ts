import { analyzeTriplets, type AnalyzeTripletsRequest } from "@/lib/semantic-triplets";

export const runtime = "nodejs";

function boundedRequestCharacters() {
  const configured = Number(process.env.TRIPLET_SPACY_MAX_REQUEST_CHARACTERS);
  if (!Number.isFinite(configured)) return 128_000_000;
  return Math.min(256_000_000, Math.max(8_000_000, Math.trunc(configured)));
}

async function readPayload(request: Request) {
  const maximumCharacters = boundedRequestCharacters();
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maximumCharacters) throw new Error("Snapshot слишком большой для анализа триплетов");
  const text = await request.text();
  if (text.length > maximumCharacters) throw new Error("Snapshot слишком большой для анализа триплетов");
  try { return JSON.parse(text) as AnalyzeTripletsRequest; }
  catch { throw new Error("Некорректный JSON запроса"); }
}

export async function POST(request: Request) {
  try {
    const payload = await readPayload(request);
    return Response.json({ triplets: await analyzeTriplets(payload) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Не удалось выполнить анализ семантических связей" },
      { status: 400 },
    );
  }
}
