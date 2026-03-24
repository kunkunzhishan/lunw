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
  const recommendations = paper.recommendations.slice(0, 5);
  const chats = paper.chatHistory.slice(-4);

  return `# ${paper.title}

## Metadata
- Created: ${paper.createdAt}
- Source: ${paper.source}
- Authors: ${paper.authors.join(", ") || "Unknown"}
- Status: ${paper.status}

## 一句话总结
${summary.oneLiner}

## 研究问题
${summary.researchProblem}

## 核心方法
${summary.coreMethod}

## 实验结论
${summary.findings}

## 创新点
${summary.innovations.map((item) => `- ${item}`).join("\n")}

## 局限性
${summary.limitations.map((item) => `- ${item}`).join("\n")}

## 术语
${summary.terms.map((item) => `- ${item}`).join("\n")}

## 延伸想法
${summary.ideas.map((item) => `- ${item}`).join("\n")}

## 推荐阅读
${recommendations.map((item) => `- [${item.title}](${item.url}) - ${item.reason}`).join("\n") || "- 暂无"}

## 问答摘录
${chats.map((item) => `### ${item.role === "user" ? "我" : "助手"}\n${item.content}`).join("\n\n") || "暂无"}

## 我的想法
- 
`;
}
