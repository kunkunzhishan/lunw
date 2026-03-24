import { buildSourceRefsFromBlocks, extractTerms, searchBlocks } from "@/lib/paper-utils";
import { readAppSettings } from "@/lib/settings";
import type { PaperBlock, PaperRecord, PaperSummary, TextPaperBlock } from "@/lib/types";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface VisualCandidateForNote {
  assetId: string;
  page: number;
  type: "image" | "table";
  caption?: string;
}

interface FormulaCandidateForNote {
  formulaNumber: number;
  page: number;
  latex: string;
  context?: string;
}

interface LlmEndpoint {
  type: "chat" | "responses";
  url: string;
}

function buildEndpoints(baseUrl: string): LlmEndpoint[] {
  const normalized = baseUrl.replace(/\/$/, "");
  const endpoints: LlmEndpoint[] = [
    { type: "chat", url: `${normalized}/chat/completions` },
    { type: "responses", url: `${normalized}/responses` },
  ];
  if (!/\/v1$/i.test(normalized)) {
    endpoints.push({ type: "chat", url: `${normalized}/v1/chat/completions` });
    endpoints.push({ type: "responses", url: `${normalized}/v1/responses` });
  }
  const unique = new Map<string, LlmEndpoint>();
  for (const endpoint of endpoints) {
    unique.set(`${endpoint.type}:${endpoint.url}`, endpoint);
  }
  return Array.from(unique.values());
}

function extractResponseText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim();
  }

  const output = record.output;
  if (!Array.isArray(output)) {
    return undefined;
  }

  const texts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const itemRecord = item as Record<string, unknown>;
    const content = itemRecord.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") {
        continue;
      }
      const contentRecord = contentItem as Record<string, unknown>;
      if (typeof contentRecord.text === "string" && contentRecord.text.trim()) {
        texts.push(contentRecord.text.trim());
      }
    }
  }

  return texts.join("\n").trim() || undefined;
}

function extractResponseTextFromSse(raw: string) {
  const doneText: string[] = [];
  let completedResponse: unknown;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) {
      continue;
    }
    const jsonText = trimmed.slice(6).trim();
    if (!jsonText || jsonText === "[DONE]") {
      continue;
    }
    try {
      const event = JSON.parse(jsonText) as Record<string, unknown>;
      if (event.type === "response.output_text.done" && typeof event.text === "string") {
        doneText.push(event.text);
      }
      if (event.type === "response.completed" && event.response) {
        completedResponse = event.response;
      }
    } catch {
      continue;
    }
  }

  const fromCompleted = extractResponseText(completedResponse);
  if (fromCompleted?.trim()) {
    return fromCompleted.trim();
  }
  return doneText.join("\n").trim() || undefined;
}

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      return undefined;
    }
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      return undefined;
    }
  }
}

async function callChatCompletion(messages: ChatMessage[], temperature = 0.2) {
  const settings = await readAppSettings();
  if (!settings.llmApiKey) {
    throw new Error("LLM_API_KEY 未配置");
  }

  const endpoints = buildEndpoints(settings.llmBaseUrl);
  const errors: string[] = [];

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];
    const systemInstructions = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const nonSystemMessages = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    const body = endpoint.type === "chat"
      ? {
          model: settings.llmModel,
          temperature,
          messages,
        }
      : {
          model: settings.llmModel,
          temperature,
          instructions: systemInstructions || "You are a helpful assistant.",
          input: nonSystemMessages.length ? nonSystemMessages : [{ role: "user", content: "请继续。" }],
          stream: false,
        };

    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.llmApiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const body = (await response.text()).trim();
      errors.push(`[${response.status}] ${endpoint.url}: ${body || "empty response"}`);
      const isFallbackable = response.status === 404 || response.status === 405;
      const hasNextCandidate = index < endpoints.length - 1;
      if (isFallbackable && hasNextCandidate) {
        continue;
      }
      throw new Error(errors.join("\n"));
    }

    if (endpoint.type === "chat") {
      const payload = await response.json();
      const content = payload.choices?.[0]?.message?.content as string | undefined;
      if (content?.trim()) {
        return content;
      }
    } else {
      const contentType = response.headers.get("content-type") ?? "";
      const content = contentType.includes("text/event-stream")
        ? extractResponseTextFromSse(await response.text())
        : extractResponseText(await response.json());
      if (content?.trim()) {
        return content;
      }
    }

    errors.push(`[200] ${endpoint.url}: empty response payload`);
  }

  throw new Error(errors.join("\n") || "LLM 请求失败");
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

export async function translateTextToChinese(text: string) {
  const normalized = text.trim();
  if (!normalized) {
    return "";
  }

  const hasChinese = /[\u4e00-\u9fff]/.test(normalized);
  const hasLongEnglish = /[A-Za-z]{3,}/.test(normalized);
  if (hasChinese && !hasLongEnglish) {
    return normalized;
  }

  const translated = await callChatCompletion(
    [
      {
        role: "system",
        content: "你是学术翻译助手。请把输入翻译成自然、准确、简洁的中文。只返回翻译结果，不要解释。",
      },
      {
        role: "user",
        content: normalized,
      },
    ],
    0.1,
  );

  return translated.trim();
}

export async function answerPaperQuestion(
  paper: PaperRecord,
  question: string,
  options: { contextBlockIds?: string[] } = {},
) {
  const textBlocks = paper.blocks.filter(
    (block): block is TextPaperBlock => block.type === "text" || block.type === "heading",
  );
  if (!textBlocks.length) {
    throw new Error("论文正文为空，请先重新解析或重新上传。");
  }

  const requestedIds = new Set((options.contextBlockIds ?? []).filter(Boolean));
  const quotedBlocks = requestedIds.size
    ? textBlocks.filter((block) => requestedIds.has(block.id))
    : [];
  const useQuotedOnly = quotedBlocks.length > 0;
  const contextBlocks = useQuotedOnly ? quotedBlocks : textBlocks;
  const fallbackRefs = searchBlocks(question, paper.blocks);
  const refBlocks = useQuotedOnly
    ? contextBlocks
    : (fallbackRefs.length ? fallbackRefs : textBlocks.slice(0, 4));
  const refs = buildSourceRefsFromBlocks(refBlocks.slice(0, 4));

  const contextText = contextBlocks
    .map((block) => `[第 ${block.page} 页] ${block.english}`)
    .join("\n\n");
  const MAX_CONTEXT_CHARS = 120_000;
  const clippedContextText = contextText.length > MAX_CONTEXT_CHARS
    ? `${contextText.slice(0, MAX_CONTEXT_CHARS)}\n\n[上下文过长，已截断]`
    : contextText;

  const historyMessages = paper.chatHistory
    .slice(-6)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  const answer = await callChatCompletion(
    [
      {
        role: "system",
        content:
          "你是一个论文聊天助手。结合论文上下文和用户问题进行回答，表达方式自然、清晰、自由。",
      },
      ...historyMessages,
      {
        role: "user",
        content: `论文标题：${paper.title}\n\n当前问题：${question}\n\n论文上下文：\n${clippedContextText}`,
      },
    ],
    0.4,
  );

  return {
    content: answer.trim(),
    sourceRefs: refs,
  };
}

export async function generateObsidianNote(
  paper: PaperRecord,
  repositoryName: string,
  options?: { visualCandidates?: VisualCandidateForNote[] },
) {
  const textBlocks = paper.blocks.filter(
    (block): block is TextPaperBlock => block.type === "text" || block.type === "heading",
  );
  const textPreview = textBlocks
    .slice(0, 40)
    .map((block) => `[P${block.page}] ${block.english}`)
    .join("\n\n")
    .slice(0, 40000);

  const annotationContext = paper.annotations
    .slice(0, 80)
    .map((annotation) => `- (${annotation.blockId}) ${annotation.quoteText ? `「${annotation.quoteText}」` : ""} ${annotation.content}`)
    .join("\n");
  const chatContext = paper.chatHistory
    .slice(-14)
    .map((message) => `- ${message.role === "user" ? "用户" : "助手"}: ${message.content}`)
    .join("\n");

  const visualCandidates = (options?.visualCandidates ?? []).slice(0, 80);
  if (!visualCandidates.length) {
    const markdown = await callChatCompletion(
      [
        {
          role: "system",
          content:
            "你是科研笔记助手。请输出一份可直接放入 Obsidian 的中文 Markdown 笔记，信息密度高，结构清晰，突出可行动结论。数学公式请使用 Obsidian 友好的定界符：行内用 $...$，独立公式用 $$...$$，不要使用 \\(...\\) 或 \\[...\\]。",
        },
        {
          role: "user",
          content: `请基于以下信息生成笔记。\n\n论文标题：${paper.title}\n仓库：${repositoryName}\n\n要求：\n1. 必须包含：一句话总结、问题与方法、关键证据、问答沉淀、批注要点、可执行下一步。\n2. 对于“问答沉淀”和“批注要点”，请做归纳，不要原样堆砌。\n3. 输出纯 Markdown，不要解释你在做什么。\n\n论文正文节选：\n${textPreview}\n\n问答记录：\n${chatContext || "暂无"}\n\n批注：\n${annotationContext || "暂无"}\n`,
        },
      ],
      0.3,
    );
    return {
      markdown: markdown.trim(),
      selectedVisualAssetIds: [] as string[],
    };
  }

  const mapped = visualCandidates.map((candidate, index) => ({
    alias: `V${index + 1}`,
    assetId: candidate.assetId,
    page: candidate.page,
    type: candidate.type,
    caption: (candidate.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
  }));
  const candidateText = mapped
    .map((item) => `${item.alias} | page=${item.page} | type=${item.type} | caption=${item.caption || "-"}`)
    .join("\n");

  const raw = await callChatCompletion(
    [
      {
        role: "system",
        content:
          "你是科研笔记助手。请同时完成两件事：1) 写出高质量中文 Markdown 笔记；2) 从候选图表里选出最应该保留的图。只返回 JSON，格式：{\"markdown\":\"...\",\"selectedAliases\":[\"V1\",\"V3\"]}。selectedAliases 最多 8 个，优先保留：框架图、总览图、关键结果/对比图、消融图。",
      },
      {
        role: "user",
        content: `请基于以下信息生成笔记。\n\n论文标题：${paper.title}\n仓库：${repositoryName}\n\n要求：\n1. markdown 必须包含：一句话总结、问题与方法、关键证据、问答沉淀、批注要点、可执行下一步。\n2. 对于“问答沉淀”和“批注要点”，请做归纳，不要原样堆砌。\n3. markdown 中数学公式请使用 Obsidian 友好的定界符：行内用 $...$，独立公式用 $$...$$。\n4. 只返回 JSON，不要额外解释。\n\n论文正文节选：\n${textPreview}\n\n问答记录：\n${chatContext || "暂无"}\n\n批注：\n${annotationContext || "暂无"}\n\n候选图表：\n${candidateText}\n`,
      },
    ],
    0.3,
  );

  const parsed = safeJsonParse(raw);
  const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  const markdown = typeof record?.markdown === "string"
    ? record.markdown.trim()
    : raw.trim();

  const maybeAliases = record?.selectedAliases ?? record?.selected ?? record?.aliases ?? record?.assetIds;
  const selectedTokens = Array.isArray(maybeAliases)
    ? maybeAliases.filter((item): item is string => typeof item === "string")
    : (raw.match(/\bV\d+\b/g) ?? []);

  const byAlias = new Map(mapped.map((item) => [item.alias.toUpperCase(), item.assetId]));
  const candidateAssetIds = new Set(mapped.map((item) => item.assetId));
  const selectedVisualAssetIds: string[] = [];
  const seen = new Set<string>();
  for (const token of selectedTokens) {
    const normalized = token.trim();
    if (!normalized) {
      continue;
    }
    let assetId = byAlias.get(normalized.toUpperCase());
    if (!assetId && candidateAssetIds.has(normalized)) {
      assetId = normalized;
    }
    if (!assetId || seen.has(assetId)) {
      continue;
    }
    seen.add(assetId);
    selectedVisualAssetIds.push(assetId);
    if (selectedVisualAssetIds.length >= 8) {
      break;
    }
  }

  return {
    markdown,
    selectedVisualAssetIds,
  };
}

export async function explainFormulasForNote(params: {
  paperTitle: string;
  noteMarkdown: string;
  formulas: FormulaCandidateForNote[];
}) {
  const formulas = params.formulas
    .filter((item) => item.latex.trim())
    .slice(0, 8);
  if (!formulas.length) {
    return {} as Record<number, string>;
  }

  const formulasText = formulas
    .map((item) => [
      `公式编号: ${item.formulaNumber}`,
      `页码: ${item.page}`,
      `LaTeX: ${item.latex}`,
      `上下文: ${(item.context ?? "").trim() || "无"}`,
    ].join("\n"))
    .join("\n\n---\n\n");

  const notePreview = params.noteMarkdown.slice(0, 12_000);
  const raw = await callChatCompletion(
    [
      {
        role: "system",
        content:
          "你是论文公式讲解助手。请根据笔记语境解释公式，不要空话。只返回 JSON：{\"items\":[{\"formulaNumber\":1,\"explanation\":\"...\"}]}\n解释要求：\n1) 明确公式在文中作用（在算什么/优化什么/约束什么）；\n2) 点出关键符号含义（2-4个）；\n3) 给一句直觉理解；\n4) 每条 40-120 字中文，不要重复 LaTeX。",
      },
      {
        role: "user",
        content: `论文标题：${params.paperTitle}\n\n笔记节选：\n${notePreview}\n\n待解释公式：\n${formulasText}`,
      },
    ],
    0.2,
  );

  const parsed = safeJsonParse(raw);
  const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  const items = Array.isArray(record?.items) ? record.items : [];

  const result: Record<number, string> = {};
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item as Record<string, unknown>;
    const formulaNumber = Number(candidate.formulaNumber);
    const explanation = typeof candidate.explanation === "string"
      ? candidate.explanation.replace(/\s+/g, " ").trim()
      : "";
    if (!Number.isFinite(formulaNumber) || !explanation) {
      continue;
    }
    result[formulaNumber] = explanation;
  }

  return result;
}
