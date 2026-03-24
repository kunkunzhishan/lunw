import { NextResponse } from "next/server";

import { translateSections } from "@/lib/llm";
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
    const translated = await translateSections(paper);
    const updated = await updatePaper(id, (current) => ({
      ...current,
      blocks: translated.blocks,
      updatedAt: new Date().toISOString(),
    }));

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "翻译失败" },
      { status: 500 },
    );
  }
}
