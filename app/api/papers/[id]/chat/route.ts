import { nanoid } from "nanoid";
import { NextResponse } from "next/server";

import { answerPaperQuestion } from "@/lib/llm";
import { appendChatMessage, getPaper } from "@/lib/storage";
import type { ChatMessage } from "@/lib/types";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    question?: string;
    contextBlockIds?: string[];
    contextQuotes?: Array<{
      blockId?: string;
      quoteText?: string;
      quoteStart?: number;
      quoteEnd?: number;
    }>;
  };
  const question = body.question?.trim();
  const contextBlockIds = Array.isArray(body.contextBlockIds)
    ? body.contextBlockIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const contextQuotes = Array.isArray(body.contextQuotes)
    ? body.contextQuotes
      .map((item) => ({
        blockId: typeof item.blockId === "string" ? item.blockId.trim() : "",
        quoteText: typeof item.quoteText === "string" ? item.quoteText.trim() : "",
        quoteStart: Number.isInteger(item.quoteStart) ? Number(item.quoteStart) : undefined,
        quoteEnd: Number.isInteger(item.quoteEnd) ? Number(item.quoteEnd) : undefined,
      }))
      .filter((item) => item.blockId)
    : [];

  if (!question) {
    return NextResponse.json({ error: "请输入问题。" }, { status: 400 });
  }

  const paper = await getPaper(id);
  if (!paper) {
    return NextResponse.json({ error: "论文不存在。" }, { status: 404 });
  }

  try {
    const answer = await answerPaperQuestion(paper, question, { contextBlockIds, contextQuotes });
    const createdAt = new Date().toISOString();

    const messages: ChatMessage[] = [
      {
        id: nanoid(),
        role: "user",
        content: question,
        sourceRefs: [],
        createdAt,
      },
      {
        id: nanoid(),
        role: "assistant",
        content: answer.content,
        sourceRefs: answer.sourceRefs,
        createdAt,
      },
    ];

    const updated = await appendChatMessage(id, messages);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "问答失败" },
      { status: 500 },
    );
  }
}
