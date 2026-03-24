import { NextResponse } from "next/server";

import { summarizePaper } from "@/lib/llm";
import { getPaper, updatePaper } from "@/lib/storage";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(_: Request, context: Context) {
  const { id } = await context.params;
  const paper = await getPaper(id);

  if (!paper) {
    return NextResponse.json({ error: "论文不存在。" }, { status: 404 });
  }

  try {
    const summary = await summarizePaper(paper);
    const updated = await updatePaper(id, (current) => ({
      ...current,
      summary,
      updatedAt: new Date().toISOString(),
    }));

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "摘要生成失败" },
      { status: 500 },
    );
  }
}
