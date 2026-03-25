import { nanoid } from "nanoid";

import type { PaperBlock, PaperRecord, RecommendationItem, SearchResult, SourceRef, TextPaperBlock } from "@/lib/types";

function cleanLine(line: string) {
  return line.replace(/\s+/g, " ").trim();
}

export function inferTitle(text: string, fallback: string) {
  const lines = text
    .split(/\n+/)
    .map(cleanLine)
    .filter(Boolean)
    .slice(0, 12);

  return lines.find((line) => line.length > 20 && line.length < 180) ?? fallback;
}

export function extractTerms(text: string) {
  const matches = text.match(/\b[A-Z][A-Za-z0-9-]{2,}\b/g) ?? [];
  return Array.from(new Set(matches)).slice(0, 12);
}

export function searchBlocks(query: string, blocks: PaperBlock[]): TextPaperBlock[] {
  const textBlocks = blocks.filter((block): block is TextPaperBlock => block.type === "text" || block.type === "heading");
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/)
    .filter(Boolean);

  if (!tokens.length) {
    return textBlocks.slice(0, 4);
  }

  return [...textBlocks]
    .map((block) => {
      const haystack = `${block.english} ${block.chinese ?? ""}`.toLowerCase();
      const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
      return { block, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.block.order - b.block.order)
    .slice(0, 4)
    .map((item) => item.block);
}

export function buildSourceRefsFromBlocks(blocks: TextPaperBlock[]): SourceRef[] {
  return blocks.map((block) => ({
    type: "paper",
    label: block.type === "heading" ? block.english : `第 ${block.page} 页段落`,
    blockId: block.id,
  }));
}

export function mergeSearchResultsIntoRecommendations(
  results: SearchResult[],
  sourceType: RecommendationItem["sourceType"],
): RecommendationItem[] {
  return results.slice(0, 5).map((result, index) => ({
    id: nanoid(),
    title: result.title,
    url: result.url,
    reason: result.content.slice(0, 140) || "来自联网检索结果。",
    sourceType,
    score: 1 - index * 0.1,
    source: "semantic-scholar",
    authors: [],
    evidenceRefs: [result.title],
    nextStep: "沿着这条结果继续扩展相关工作。",
  }));
}

export function buildMarkdownNote(paper: PaperRecord) {
  if (!paper.summary) {
    throw new Error("导出笔记前请先生成摘要。");
  }

  const summary = paper.summary;
  const annotations = paper.annotations.slice(0, 20);
  const textByBlockId = new Map(
    paper.blocks
      .filter((block): block is TextPaperBlock => block.type === "text" || block.type === "heading")
      .map((block) => [block.id, block]),
  );
  const rawAnnotationLines = annotations.map((item, index) => {
    const block = textByBlockId.get(item.blockId);
    const quote = item.quoteText?.trim()
      || (
        block &&
        item.quoteStart !== undefined &&
        item.quoteEnd !== undefined &&
        item.quoteStart >= 0 &&
        item.quoteEnd > item.quoteStart &&
        item.quoteEnd <= block.english.length
          ? block.english.slice(item.quoteStart, item.quoteEnd)
          : ""
      );
    return [
      `### 批注 ${index + 1}${block ? `（P${block.page}）` : ""}`,
      "原文：",
      `> ${quote || "（未捕获原文片段）"}`,
      "批注：",
      item.content || "（空批注）",
    ].join("\n");
  });

  return `# ${paper.title}

## 正文摘要
${summary.oneLiner}

## 研究问题与方法
${summary.researchProblem}
${summary.coreMethod}

## 关键证据与实验结论
${summary.findings}

## 创新点
${summary.innovations.map((item) => `- ${item}`).join("\n")}

## 局限性
${summary.limitations.map((item) => `- ${item}`).join("\n")}

## 后续方向
${summary.ideas.map((item) => `- ${item}`).join("\n")}

## 批注原文与批注（原样）
${rawAnnotationLines.join("\n\n") || "暂无"}
`;
}
