import { NextResponse } from "next/server";

import { listPapers } from "@/lib/storage";

export async function GET() {
  const papers = await listPapers();

  return NextResponse.json(
    papers.map((paper) => ({
      id: paper.id,
      title: paper.title,
      authors: paper.authors,
      status: paper.status,
      createdAt: paper.createdAt,
      updatedAt: paper.updatedAt,
      summary: paper.summary,
    })),
  );
}
