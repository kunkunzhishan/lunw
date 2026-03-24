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

  return NextResponse.json(paper);
}
