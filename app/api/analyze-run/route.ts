import { analyzePayload, type AnalyzeRequest } from "@/lib/semantic-analysis";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as AnalyzeRequest;
    return Response.json(await analyzePayload(payload));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не удалось выполнить анализ" }, { status: 400 });
  }
}
