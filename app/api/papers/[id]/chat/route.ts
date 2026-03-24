import { nanoid } from "nanoid";
import { NextResponse } from "next/server";

import { answerPaperQuestion } from "@/lib/llm";
import { appendChatMessage, getPaper } from "@/lib/storage";
import { runQaContextAgent } from "@/lib/search";
import type { ChatMessage } from "@/lib/types";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const body = (await request.json()) as { question?: string };
  const question = body.question?.trim();

  if (!question) {
    return NextResponse.json({ error: "请输入问题。" }, { status: 400 });
  }

  const paper = await getPaper(id);
  if (!paper) {
    return NextResponse.json({ error: "论文不存在。" }, { status: 404 });
  }

  try {
    const externalContext = await runQaContextAgent({
      currentPaper: paper,
      query: question,
    });
    const answer = await answerPaperQuestion(paper, question, externalContext.items);
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
