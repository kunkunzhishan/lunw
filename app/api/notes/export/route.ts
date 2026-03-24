import path from "path";

import { NextResponse } from "next/server";

import { buildMarkdownNote } from "@/lib/paper-utils";
import { getPaper, saveExport, writeMarkdownNote } from "@/lib/storage";
import type { ExportedNote } from "@/lib/types";

export async function POST(request: Request) {
  const body = (await request.json()) as { paperId?: string };

  if (!body.paperId) {
    return NextResponse.json({ error: "缺少 paperId。" }, { status: 400 });
  }

  const paper = await getPaper(body.paperId);
  if (!paper) {
    return NextResponse.json({ error: "论文不存在。" }, { status: 404 });
  }

  const markdown = buildMarkdownNote(paper);
  const fileName = `${paper.title.replace(/[^\w\u4e00-\u9fa5-]+/g, "_") || paper.id}.md`;
  const targetPath = await writeMarkdownNote(fileName, markdown);

  const note: ExportedNote = {
    paperId: paper.id,
    markdown,
    targetPath: path.resolve(targetPath),
    exportedAt: new Date().toISOString(),
  };

  await saveExport(paper.id, note);

  return NextResponse.json(note);
}
