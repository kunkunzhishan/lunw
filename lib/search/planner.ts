import { extractTerms } from "@/lib/paper-utils";
import type { PaperRecord, SearchEntryType, SearchPlan } from "@/lib/types";

interface PlannerInput {
  entryType: SearchEntryType;
  query?: string;
  currentPaper?: PaperRecord | null;
  historyPapers?: PaperRecord[];
}

function uniq(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

export function planRecommendationSearch(input: PlannerInput): SearchPlan {
  const { currentPaper, entryType, historyPapers = [], query } = input;

  if (entryType === "direction") {
    if (!query?.trim()) {
      throw new Error("研究方向推荐缺少 query。");
    }

    const seed = query.trim();
    return {
      entryType,
      intent: `围绕研究方向“${seed}”寻找基础论文、近期工作与综述。`,
      seedQueries: uniq([
        seed,
        `${seed} survey`,
        `${seed} recent paper`,
      ]),
      followupQueries: uniq([
        `${seed} benchmark`,
        `${seed} code`,
      ]),
    };
  }

  if (entryType === "current") {
    if (!currentPaper) {
      throw new Error("当前论文推荐缺少 paper 上下文。");
    }

    const terms = currentPaper.summary?.terms?.slice(0, 4) ?? extractTerms(currentPaper.text).slice(0, 4);
    return {
      entryType,
      intent: `寻找与当前论文 ${currentPaper.title} 最相关的论文、相关工作和延伸方向。`,
      seedQueries: uniq([
        currentPaper.title,
        `${currentPaper.title} related work`,
        ...terms.map((term) => `${term} paper`),
      ]),
      followupQueries: uniq([
        `${currentPaper.title} citation`,
        `${terms.join(" ")} survey`,
      ]),
    };
  }

  if (entryType === "history") {
    if (!historyPapers.length) {
      throw new Error("阅读历史推荐需要至少一篇已读论文。");
    }

    const historyTitles = historyPapers.slice(0, 5).map((paper) => paper.title);
    const historyTerms = uniq(
      historyPapers.flatMap((paper) => paper.summary?.terms?.slice(0, 3) ?? extractTerms(paper.text).slice(0, 2)),
    ).slice(0, 6);

    return {
      entryType,
      intent: "基于最近阅读历史聚合同主题脉络，发现尚未阅读的新论文。",
      seedQueries: uniq([
        ...historyTitles,
        historyTerms.join(" "),
      ]),
      followupQueries: uniq([
        `${historyTerms.join(" ")} survey`,
        `${historyTerms.join(" ")} related work`,
      ]),
    };
  }

  if (!query?.trim()) {
    throw new Error("问答联网补充缺少 query。");
  }

  const baseQuery = currentPaper ? `${currentPaper.title} ${query.trim()}` : query.trim();

  return {
    entryType,
    intent: "为论文问答补充外部学术背景与相关工作。",
    seedQueries: uniq([
      baseQuery,
      `${baseQuery} paper`,
    ]),
    followupQueries: uniq([
      `${baseQuery} survey`,
    ]),
  };
}
