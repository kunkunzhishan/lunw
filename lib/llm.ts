import { llmConfig } from "@/lib/config";
import { buildSourceRefsFromBlocks, extractTerms, searchBlocks } from "@/lib/paper-utils";
import type { PaperBlock, PaperRecord, PaperSummary, SearchResult, TextPaperBlock } from "@/lib/types";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function callChatCompletion(messages: ChatMessage[], temperature = 0.2) {
  if (!llmConfig.apiKey) {
    throw new Error("LLM_API_KEY 未配置");
  }

  const response = await fetch(`${llmConfig.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${llmConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: llmConfig.model,
      temperature,
      messages,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = await response.json();
  return payload.choices?.[0]?.message?.content as string;
}

export async function summarizePaper(paper: PaperRecord): Promise<PaperSummary> {
  const textBlocks = paper.blocks.filter(
    (block): block is TextPaperBlock => block.type === "text" || block.type === "heading",
  );
  if (!textBlocks.length) {
    throw new Error("论文还没有可用于摘要的正文段落。");
  }

  const content = textBlocks
    .slice(0, 8)
    .map((block) => `[Page ${block.page}]\n${block.english}`)
    .join("\n\n");

  const raw = await callChatCompletion(
    [
      {
        role: "system",
        content:
          "你是论文助手。请严格返回 JSON，包含 oneLiner,researchProblem,coreMethod,findings,innovations,limitations,ideas,terms。数组字段必须是字符串数组。",
      },
      {
        role: "user",
        content: `论文标题：${paper.title}\n\n论文内容：\n${content}`,
      },
    ],
    0.1,
  );

  const parsed = JSON.parse(raw) as PaperSummary;
  parsed.terms = parsed.terms?.length ? parsed.terms : extractTerms(paper.text);
  return parsed;
}

export async function translateSections(paper: PaperRecord) {
  const textBlocks = paper.blocks.filter(
    (block): block is TextPaperBlock => block.type === "text" || block.type === "heading",
  );
  if (!textBlocks.length) {
    throw new Error("论文还没有可用于翻译的正文段落。");
  }

  const translatedBlocks: PaperBlock[] = [];
  for (const block of paper.blocks) {
    if (block.type !== "text" && block.type !== "heading") {
      translatedBlocks.push(block);
      continue;
    }

    if (block.chinese?.trim()) {
      translatedBlocks.push(block);
      continue;
    }

    const chinese = await callChatCompletion(
      [
        {
          role: "system",
          content: "你是学术翻译助手。请把输入的英文论文段落翻译成自然、准确的中文，只返回翻译结果。",
        },
        {
          role: "user",
          content: block.english,
        },
      ],
      0.2,
    );

    translatedBlocks.push({
      ...block,
      chinese: chinese.trim(),
    });
  }

  return {
    blocks: translatedBlocks,
  };
}

export async function answerPaperQuestion(paper: PaperRecord, question: string, webResults: SearchResult[]) {
  const relatedBlocks = searchBlocks(question, paper.blocks);
  if (!relatedBlocks.length) {
    throw new Error("没有找到与问题相关的论文段落，请换个问法再试。");
  }

  const refs = buildSourceRefsFromBlocks(relatedBlocks);
  const webContext = webResults
    .map((result) => `- ${result.title}\n${result.content}\n${result.url}`)
    .join("\n\n");

  const answer = await callChatCompletion(
    [
      {
        role: "system",
        content:
          "你是论文问答助手。请优先根据论文内容回答，并在必要时融合联网结果。回答用中文，明确区分论文依据与外部补充，不要编造。",
      },
      {
        role: "user",
        content: `问题：${question}\n\n论文片段：\n${relatedBlocks
          .map((block) => `[第 ${block.page} 页] ${block.english}`)
          .join("\n\n")}\n\n联网补充：\n${webContext || "无"}`,
      },
    ],
    0.2,
  );

  return {
    content: answer.trim(),
    sourceRefs: [
      ...refs,
      ...webResults.slice(0, 3).map((result) => ({ type: "academic" as const, label: result.title, url: result.url })),
    ],
  };
}
