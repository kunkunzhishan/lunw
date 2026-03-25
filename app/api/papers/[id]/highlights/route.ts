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
    quoteText?: unknown;
    quoteStart?: unknown;
    quoteEnd?: unknown;
  };

  const blockId = typeof body.blockId === "string" ? body.blockId.trim() : "";
  const quoteText = typeof body.quoteText === "string" ? body.quoteText.trim() : "";
  const quoteStartRaw = Number(body.quoteStart);
  const quoteEndRaw = Number(body.quoteEnd);
  const quoteStart = Number.isInteger(quoteStartRaw) && quoteStartRaw >= 0 ? quoteStartRaw : undefined;
  const quoteEnd = Number.isInteger(quoteEndRaw) && quoteEndRaw >= 0 ? quoteEndRaw : undefined;

  if (!blockId) {
    return NextResponse.json({ error: "缺少 blockId。" }, { status: 400 });
  }
  if ((quoteStart !== undefined && quoteEnd === undefined) || (quoteStart === undefined && quoteEnd !== undefined)) {
    return NextResponse.json({ error: "锚点参数不完整。" }, { status: 400 });
  }
  if (quoteStart !== undefined && quoteEnd !== undefined && quoteStart >= quoteEnd) {
    return NextResponse.json({ error: "锚点范围无效。" }, { status: 400 });
  }
  if (quoteText.length > 400) {
    return NextResponse.json({ error: "重点文本不能超过 400 个字符。" }, { status: 400 });
  }
  const paper = await getPaper(id);
  if (!paper) {
    return NextResponse.json({ error: "论文不存在。" }, { status: 404 });
  }
  const targetBlock = paper.blocks.find((block) => block.id === blockId);
  if (!targetBlock || (targetBlock.type !== "text" && targetBlock.type !== "heading")) {
    return NextResponse.json({ error: "目标段落不存在。" }, { status: 404 });
  }
  if (quoteStart === undefined || quoteEnd === undefined) {
    return NextResponse.json({ error: "请先精确选中要划重点的文本。" }, { status: 400 });
  }
  if (quoteEnd > targetBlock.english.length) {
    return NextResponse.json({ error: "选区超出段落范围，请重新选择。" }, { status: 400 });
  }
  const finalQuoteText = targetBlock.english.slice(quoteStart, quoteEnd).trim() || quoteText || undefined;
  const finalQuoteStart = quoteStart;
  const finalQuoteEnd = quoteEnd;
  if (!finalQuoteText) {
    return NextResponse.json({ error: "选区为空，请重新选择。" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const updated = await updatePaper(id, (currentPaper) => {
    const duplicate = currentPaper.highlights.find((item) => {
      if (item.blockId !== blockId) {
        return false;
      }
      const sameRange =
        item.quoteStart !== undefined &&
        item.quoteEnd !== undefined &&
        item.quoteStart === finalQuoteStart &&
        item.quoteEnd === finalQuoteEnd;
      return Boolean(sameRange);
    });

    if (duplicate) {
      return currentPaper;
    }

    return {
      ...currentPaper,
      highlights: [
        ...currentPaper.highlights,
        {
          id: nanoid(),
          blockId,
          quoteText: finalQuoteText,
          quoteStart: finalQuoteStart,
          quoteEnd: finalQuoteEnd,
          createdAt: now,
        },
      ],
      updatedAt: now,
    };
  });

  if (!updated) {
    return NextResponse.json({ error: "论文不存在。" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    highlightId?: unknown;
    blockId?: unknown;
    quoteStart?: unknown;
    quoteEnd?: unknown;
  };
  const highlightId = typeof body.highlightId === "string" ? body.highlightId.trim() : "";
  const blockId = typeof body.blockId === "string" ? body.blockId.trim() : "";
  const quoteStartRaw = Number(body.quoteStart);
  const quoteEndRaw = Number(body.quoteEnd);
  const quoteStart = Number.isInteger(quoteStartRaw) && quoteStartRaw >= 0 ? quoteStartRaw : undefined;
  const quoteEnd = Number.isInteger(quoteEndRaw) && quoteEndRaw >= 0 ? quoteEndRaw : undefined;

  const hasAnchor = Boolean(
    blockId
      && quoteStart !== undefined
      && quoteEnd !== undefined
      && quoteEnd > quoteStart,
  );
  if (!highlightId && !hasAnchor) {
    return NextResponse.json({ error: "缺少 highlightId 或精确锚点参数。" }, { status: 400 });
  }

  const updated = await updatePaper(id, (paper) => ({
    ...paper,
    highlights: paper.highlights.filter((item) => {
      if (highlightId) {
        return item.id !== highlightId;
      }
      return !(
        item.blockId === blockId
        && item.quoteStart === quoteStart
        && item.quoteEnd === quoteEnd
      );
    }),
    updatedAt: new Date().toISOString(),
  }));

  if (!updated) {
    return NextResponse.json({ error: "论文不存在。" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
