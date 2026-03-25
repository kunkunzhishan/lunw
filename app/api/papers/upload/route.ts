import path from "path";

import { nanoid } from "nanoid";
import { NextResponse } from "next/server";

import { normalizeMineruMode, type MineruMode } from "@/lib/config";
import { extractPdfText } from "@/lib/pdf";
import { inferTitle } from "@/lib/paper-utils";
import { DEFAULT_REPOSITORY_ID, savePaper, writeUploadedPdf } from "@/lib/storage";
import type { PaperRecord } from "@/lib/types";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请先选择 PDF 文件。" }, { status: 400 });
  }

  if (!file.name.trim()) {
    return NextResponse.json({ error: "文件名为空，请重新选择 PDF。" }, { status: 400 });
  }

  if (file.size <= 0) {
    return NextResponse.json({ error: "文件内容为空，请重新选择 PDF。" }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "目前只支持 PDF 文件。" }, { status: 400 });
  }

  const mineruModeRaw = formData.get("mineruMode");
  let mineruMode: MineruMode | undefined;
  if (typeof mineruModeRaw === "string" && mineruModeRaw.trim()) {
    const normalized = mineruModeRaw.trim().toLowerCase();
    if (normalized !== "api" && normalized !== "local") {
      return NextResponse.json({ error: "mineruMode 仅支持 api 或 local。" }, { status: 400 });
    }
    mineruMode = normalizeMineruMode(normalized);
  }

  const id = nanoid();
  const createdAt = new Date().toISOString();
  const repositoryIdRaw = formData.get("repositoryId");
  const repositoryId = typeof repositoryIdRaw === "string" && repositoryIdRaw.trim()
    ? repositoryIdRaw.trim()
    : DEFAULT_REPOSITORY_ID;
  const safeName = `${id}${path.extname(file.name) || ".pdf"}`;
  const uploadPath = await writeUploadedPdf(safeName, new Uint8Array(await file.arrayBuffer()));
  let stage = "extract";

  try {
    const extracted = await extractPdfText(uploadPath, id, { mode: mineruMode });
    stage = "title";
    const title = inferTitle(extracted.title || extracted.text, file.name.replace(/\.pdf$/i, ""));
    stage = "blocks";
    if (!extracted.blocks.length) {
      throw new Error("MinerU 未解析出可用内容块。");
    }
    stage = "save";

    const paper: PaperRecord = {
      id,
      title,
      authors: [],
      source: "upload",
      repositoryId,
      uploadPath,
      status: "ready",
      createdAt,
      updatedAt: createdAt,
      text: extracted.text,
      blocks: extracted.blocks,
      assets: extracted.assets,
      annotations: [],
      highlights: [],
      chatHistory: [],
      recommendations: [],
    };

    await savePaper(paper);
    return NextResponse.json(paper);
  } catch (error) {
    const paper: PaperRecord = {
      id,
      title: file.name.replace(/\.pdf$/i, ""),
      authors: [],
      source: "upload",
      repositoryId,
      uploadPath,
      status: "error",
      createdAt,
      updatedAt: createdAt,
      text: "",
      blocks: [],
      assets: [],
      annotations: [],
      highlights: [],
      chatHistory: [],
      recommendations: [],
      parseError:
        error instanceof Error ? `[${stage}] ${error.message}` : `[${stage}] PDF 解析失败`,
    };

    await savePaper(paper);
    return NextResponse.json({ error: paper.parseError }, { status: 500 });
  }
}
