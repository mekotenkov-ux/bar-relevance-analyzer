import { analyzePayload, type AnalyzeRequest } from "@/lib/semantic-analysis";
import { configuredPhraseSimilarityProvider } from "@/lib/phrase-similarity";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as AnalyzeRequest;
    return Response.json(await analyzePayload(payload, {
      phraseSimilarity: configuredPhraseSimilarityProvider(),
      assetOrigin: new URL(request.url).origin,
    }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось выполнить анализ" }, { status: 400 });
  }
}
