import { nanoid } from "nanoid";

import type {
  RecommendationItem,
  RecommendationResponse,
  RecommendationSourceType,
  ScoredItem,
  SearchPlan,
  SearchSource,
} from "@/lib/types";

function scopeLabel(type: RecommendationSourceType) {
  return type === "current" ? "当前论文" : type === "history" ? "阅读历史" : "研究方向";
}

export function composeRecommendations(params: {
  errors?: string[];
  plan: SearchPlan;
  scoredItems: ScoredItem[];
  sourceType: RecommendationSourceType;
  sourcesUsed: SearchSource[];
}): RecommendationResponse {
  const items: RecommendationItem[] = params.scoredItems.slice(0, 5).map((candidate, index) => {
    const { item } = candidate;
    const relationText =
      params.sourceType === "current"
        ? "它和当前论文的问题域或方法关键词高度重合"
        : params.sourceType === "history"
          ? "它补充了你最近阅读主题中的相邻方向，且重复度更低"
          : "它与输入研究方向高度相关，并能作为继续展开的抓手";

    return {
      id: nanoid(),
      title: item.title,
      url: item.url,
      reason: `${relationText}；排序证据包括：${candidate.evidence.join("，")}。`,
      sourceType: params.sourceType,
      score: Number(candidate.totalScore.toFixed(2)),
      source: item.source,
      authors: item.authors,
      year: item.year,
      evidenceRefs: [
        ...candidate.evidence,
        `${item.source} · ${item.year ?? "年份未知"}`,
      ],
      nextStep: index === 0 ? "建议先读这篇，再沿引用链追踪相关工作。" : "作为第二梯队候选，用于扩展视野。",
    };
  });

  return {
    errors: params.errors?.length ? params.errors : undefined,
    plan: params.plan,
    items,
    sourcesUsed: params.sourcesUsed,
  };
}

export function buildRecommendationStatus(plan: SearchPlan, sourceType: RecommendationSourceType) {
  return `${scopeLabel(sourceType)} · ${plan.intent}`;
}
