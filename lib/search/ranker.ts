import type { PaperRecord, RetrievedItem, ScoredItem, SearchPlan } from "@/lib/types";

function normalize(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ").trim();
}

function tokenize(text: string) {
  return normalize(text).split(/\s+/).filter(Boolean);
}

function titleKey(title: string) {
  return normalize(title).replace(/\s+/g, "");
}

function dedupeItems(items: RetrievedItem[]) {
  const seen = new Map<string, RetrievedItem>();
  for (const item of items) {
    const key = item.url || titleKey(item.title);
    const current = seen.get(key);
    if (!current || (item.citationHint ?? 0) > (current.citationHint ?? 0)) {
      seen.set(key, item);
    }
  }
  return Array.from(seen.values());
}

export function scoreRecommendationCandidates(params: {
  items: RetrievedItem[];
  plan: SearchPlan;
  currentPaper?: PaperRecord | null;
  historyPapers?: PaperRecord[];
}) {
  const uniqueItems = dedupeItems(params.items);
  const intentTokens = tokenize([params.plan.intent, ...params.plan.seedQueries].join(" "));
  const currentTitle = params.currentPaper ? normalize(params.currentPaper.title) : "";
  const historyTitles = (params.historyPapers ?? []).map((paper) => normalize(paper.title));

  const scored: ScoredItem[] = uniqueItems.map((item) => {
    const haystack = normalize([item.title, item.abstract, item.authors.join(" ")].join(" "));
    const relevanceScore = intentTokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
    const noveltyScore = historyTitles.some((title) => title && haystack.includes(title)) ? 0 : 2;
    const sourceCredibilityScore =
      item.source === "semantic-scholar" ? 3 : item.source === "crossref" ? 2.5 : 2;
    const academicSignalScore = Math.min(4, Math.log10((item.citationHint ?? 1) + 1) * 2)
      + (item.year && item.year >= 2022 ? 1 : 0);
    const evidence = [
      relevanceScore > 0 ? "命中检索意图关键词" : "标题/摘要弱匹配",
      noveltyScore > 0 ? "与已读历史重复度低" : "与已读论文存在重合",
      item.citationHint ? `引用提示 ${item.citationHint}` : "暂无引用提示",
    ];

    return {
      item,
      relevanceScore,
      noveltyScore,
      sourceCredibilityScore,
      academicSignalScore,
      totalScore:
        relevanceScore * 2.4 +
        noveltyScore * 1.3 +
        sourceCredibilityScore +
        academicSignalScore +
        (currentTitle && normalize(item.title).includes(currentTitle) ? 0.5 : 0),
      evidence,
    };
  });

  const filtered = scored
    .filter((candidate) => candidate.relevanceScore > 0 || candidate.item.abstract.length > 40)
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 8);

  if (!filtered.length) {
    throw new Error("排序后没有保留下有效推荐结果。");
  }

  return filtered;
}
