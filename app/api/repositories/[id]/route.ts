import { NextResponse } from "next/server";

import { deleteRepository, renameRepository } from "@/lib/storage";

interface Context {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const body = (await request.json()) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name : "";

  try {
    const repository = await renameRepository(id, name);
    if (!repository) {
      return NextResponse.json({ error: "仓库不存在。" }, { status: 404 });
    }
    return NextResponse.json(repository);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "更新仓库失败" },
      { status: 400 },
    );
  }
}

export async function DELETE(_: Request, context: Context) {
  const { id } = await context.params;

  try {
    const removed = await deleteRepository(id);
    if (!removed) {
      return NextResponse.json({ error: "仓库不存在。" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id: removed.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除仓库失败" },
      { status: 400 },
    );
  }
}
