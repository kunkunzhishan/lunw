import { nanoid } from "nanoid";
import { NextResponse } from "next/server";

import { getPaper, updatePaper } from "@/lib/storage";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    blockId?: unknown;
    content?: unknown;
    quoteText?: unknown;
    quoteStart?: unknown;
    quoteEnd?: unknown;
    threadId?: unknown;
  };
  const blockId = typeof body.blockId === "string" ? body.blockId.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const quoteText = typeof body.quoteText === "string" ? body.quoteText.trim() : "";
  const quoteStartRaw = Number(body.quoteStart);
  const quoteEndRaw = Number(body.quoteEnd);
  const quoteStart = Number.isInteger(quoteStartRaw) && quoteStartRaw >= 0 ? quoteStartRaw : undefined;
  const quoteEnd = Number.isInteger(quoteEndRaw) && quoteEndRaw >= 0 ? quoteEndRaw : undefined;
  const threadIdRaw = typeof body.threadId === "string" ? body.threadId.trim() : "";

  if (!blockId) {
    return NextResponse.json({ error: "缺少 blockId。" }, { status: 400 });
  }
  if (!content) {
    return NextResponse.json({ error: "批注内容不能为空。" }, { status: 400 });
  }
  if (content.length > 800) {
    return NextResponse.json({ error: "批注内容不能超过 800 个字符。" }, { status: 400 });
  }
  if (quoteText.length > 400) {
    return NextResponse.json({ error: "引用文本不能超过 400 个字符。" }, { status: 400 });
  }
  if ((quoteStart !== undefined && quoteEnd === undefined) || (quoteStart === undefined && quoteEnd !== undefined)) {
    return NextResponse.json({ error: "锚点参数不完整。" }, { status: 400 });
  }
  if (quoteStart !== undefined && quoteEnd !== undefined && quoteStart >= quoteEnd) {
    return NextResponse.json({ error: "锚点范围无效。" }, { status: 400 });
  }

  const paper = await getPaper(id);
  if (!paper) {
    return NextResponse.json({ error: "论文不存在。" }, { status: 404 });
  }
  const targetBlock = paper.blocks.find((block) => block.id === blockId);
  if (!targetBlock) {
    return NextResponse.json({ error: "目标段落不存在。" }, { status: 404 });
  }
  let finalQuoteStart = quoteStart;
  let finalQuoteEnd = quoteEnd;
  let finalQuoteText = quoteText || undefined;
  if (targetBlock.type !== "text" && targetBlock.type !== "heading") {
    finalQuoteStart = undefined;
    finalQuoteEnd = undefined;
    finalQuoteText = quoteText || undefined;
  } else {
    const textLength = targetBlock.english.length;
    const isRangeValid = quoteStart !== undefined
      && quoteEnd !== undefined
      && quoteStart < quoteEnd
      && quoteStart >= 0
      && quoteEnd <= textLength;
    if (!isRangeValid) {
      return NextResponse.json({ error: "请先精确选中要批注的文本。" }, { status: 400 });
    }
    finalQuoteStart = quoteStart;
    finalQuoteEnd = quoteEnd;
    finalQuoteText = targetBlock.english.slice(quoteStart, quoteEnd).trim() || quoteText || undefined;
    if (!finalQuoteText) {
      finalQuoteStart = undefined;
      finalQuoteEnd = undefined;
      return NextResponse.json({ error: "选区为空，请重新选择。" }, { status: 400 });
    }
  }

  const now = new Date().toISOString();
  const threadId = threadIdRaw || `thread-${nanoid(10)}`;
  const updated = await updatePaper(id, (currentPaper) => ({
    ...currentPaper,
    annotations: [
      ...currentPaper.annotations,
      {
        id: nanoid(),
        blockId,
        threadId,
        quoteText: finalQuoteText,
        quoteStart: finalQuoteStart,
        quoteEnd: finalQuoteEnd,
        content,
        createdAt: now,
        updatedAt: now,
      },
    ],
    updatedAt: now,
  }));

  if (!updated) {
    return NextResponse.json({ error: "论文不存在。" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  const body = (await request.json()) as { annotationId?: unknown };
  const annotationId = typeof body.annotationId === "string" ? body.annotationId.trim() : "";

  if (!annotationId) {
    return NextResponse.json({ error: "缺少 annotationId。" }, { status: 400 });
  }

  const updated = await updatePaper(id, (paper) => ({
    ...paper,
    annotations: paper.annotations.filter((annotation) => annotation.id !== annotationId),
    updatedAt: new Date().toISOString(),
  }));

  if (!updated) {
    return NextResponse.json({ error: "论文不存在。" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
