import { NextResponse } from "next/server";

import { DEFAULT_REPOSITORY_ID, deletePaper, getPaper, updatePaper } from "@/lib/storage";

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

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const body = (await request.json()) as { repositoryId?: unknown };
  const rawRepositoryId = typeof body.repositoryId === "string" ? body.repositoryId.trim() : "";
  const repositoryId = rawRepositoryId || DEFAULT_REPOSITORY_ID;

  const updated = await updatePaper(id, (paper) => ({
    ...paper,
    repositoryId,
    updatedAt: new Date().toISOString(),
  }));

  if (!updated) {
    return NextResponse.json({ error: "论文不存在。" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(_: Request, context: Context) {
  const { id } = await context.params;
  const removed = await deletePaper(id);

  if (!removed) {
    return NextResponse.json({ error: "论文不存在。" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: removed.id });
}
