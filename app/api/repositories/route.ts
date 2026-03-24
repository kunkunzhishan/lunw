import { NextResponse } from "next/server";

import { createRepository, listPapers, listRepositories } from "@/lib/storage";

export async function GET() {
  const [repositories, papers] = await Promise.all([listRepositories(), listPapers()]);
  const countMap = new Map<string, number>();
  for (const paper of papers) {
    countMap.set(paper.repositoryId, (countMap.get(paper.repositoryId) ?? 0) + 1);
  }

  return NextResponse.json(
    repositories.map((repository) => ({
      ...repository,
      paperCount: countMap.get(repository.id) ?? 0,
    })),
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name : "";

  try {
    const repository = await createRepository(name);
    return NextResponse.json(repository);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建仓库失败" },
      { status: 400 },
    );
  }
}
