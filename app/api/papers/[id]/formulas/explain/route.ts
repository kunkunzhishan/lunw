import { NextResponse } from "next/server";

import { explainSingleFormula } from "@/lib/llm";
import { getPaper, updatePaper } from "@/lib/storage";
import type { FormulaPaperBlock } from "@/lib/types";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const body = (await request.json()) as { blockId?: unknown };
  const blockId = typeof body.blockId === "string" ? body.blockId.trim() : "";

  if (!blockId) {
    return NextResponse.json({ error: "缺少 blockId。" }, { status: 400 });
  }

  const paper = await getPaper(id);
  if (!paper) {
    return NextResponse.json({ error: "论文不存在。" }, { status: 404 });
  }

  const block = paper.blocks.find((item) => item.id === blockId);
  if (!block || block.type !== "formula") {
    return NextResponse.json({ error: "目标公式块不存在。" }, { status: 404 });
  }

  try {
    const explanation = await explainSingleFormula({
      paper,
      formulaBlock: block as FormulaPaperBlock,
    });

    const now = new Date().toISOString();
    const updated = await updatePaper(id, (current) => ({
      ...current,
      blocks: current.blocks.map((item) => {
        if (item.id !== blockId || item.type !== "formula") {
          return item;
        }
        return {
          ...item,
          formulaExplanation: explanation,
          formulaExplanationUpdatedAt: now,
        };
      }),
      updatedAt: now,
    }));

    if (!updated) {
      return NextResponse.json({ error: "论文不存在。" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "公式注释失败" },
      { status: 500 },
    );
  }
}
