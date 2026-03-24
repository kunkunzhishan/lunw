import { promises as fs } from "fs";
import path from "path";

import { NextResponse } from "next/server";

import { PAPER_ASSET_ROOT } from "@/lib/config";
import { getPaper } from "@/lib/storage";

interface Context {
  params: Promise<{ id: string; assetId: string }>;
}

export async function GET(_: Request, context: Context) {
  const { id, assetId } = await context.params;
  const paper = await getPaper(id);

  if (!paper) {
    return NextResponse.json({ error: "论文不存在。" }, { status: 404 });
  }

  const asset = paper.assets.find((item) => item.id === assetId);
  if (!asset) {
    return NextResponse.json({ error: "资产不存在。" }, { status: 404 });
  }

  const assetPath = path.join(PAPER_ASSET_ROOT, asset.relativePath);
  const bytes = await fs.readFile(assetPath);

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
