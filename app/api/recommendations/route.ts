import { NextResponse } from "next/server";

import { runRecommendationAgent } from "@/lib/search";
import { getPaper, listPapers, saveRecommendations } from "@/lib/storage";
import type { RecommendationSourceType } from "@/lib/types";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    paperId?: string;
    type?: RecommendationSourceType;
    query?: string;
  };

  const type = body.type ?? "current";
  const query = body.query?.trim() ?? "";
  let currentPaper = null;
  let historyPapers = undefined;

  if (type === "current" && body.paperId) {
    currentPaper = await getPaper(body.paperId);
    if (!currentPaper) {
      return NextResponse.json({ error: "论文不存在。" }, { status: 404 });
    }
  }

  if (type === "history") {
    historyPapers = (await listPapers()).slice(0, 8);
  }

  if (type === "direction" && !query) {
    return NextResponse.json({ error: "推荐缺少输入内容。" }, { status: 400 });
  }

  try {
    const recommendations = await runRecommendationAgent({
      currentPaper,
      historyPapers,
      query,
      sourceType: type,
    });

    if (body.paperId) {
      await saveRecommendations(body.paperId, recommendations.items, {
        plan: recommendations.plan,
        sourcesUsed: recommendations.sourcesUsed,
      });
    }

    return NextResponse.json(recommendations);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "推荐失败" },
      { status: 500 },
    );
  }
}
