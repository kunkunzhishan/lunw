import { promises as fs } from "fs";
import path from "path";

import { NextResponse } from "next/server";

import { getPaper } from "@/lib/storage";

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;
  const paper = await getPaper(id);

  if (!paper) {
    return NextResponse.json({ error: "论文不存在。" }, { status: 404 });
  }

  const bytes = await fs.readFile(paper.uploadPath);
  const fileName = path.basename(paper.uploadPath);

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
