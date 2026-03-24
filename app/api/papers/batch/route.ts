import { NextResponse } from "next/server";

import { deletePapers, movePapersToRepository } from "@/lib/storage";

function normalizeIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as { ids?: unknown; repositoryId?: unknown };
  const ids = normalizeIds(body.ids);
  const repositoryId = typeof body.repositoryId === "string" ? body.repositoryId.trim() : "";

  if (!ids.length) {
    return NextResponse.json({ error: "缺少 ids。" }, { status: 400 });
  }
  if (!repositoryId) {
    return NextResponse.json({ error: "缺少 repositoryId。" }, { status: 400 });
  }

  const movedCount = await movePapersToRepository(ids, repositoryId);
  if (movedCount === null) {
    return NextResponse.json({ error: "仓库不存在。" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, movedCount });
}

export async function DELETE(request: Request) {
  const body = (await request.json()) as { ids?: unknown };
  const ids = normalizeIds(body.ids);

  if (!ids.length) {
    return NextResponse.json({ error: "缺少 ids。" }, { status: 400 });
  }

  const removed = await deletePapers(ids);
  return NextResponse.json({
    ok: true,
    deletedCount: removed.length,
    ids: removed.map((paper) => paper.id),
  });
}
