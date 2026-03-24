import path from "path";

import { nanoid } from "nanoid";
import { NextResponse } from "next/server";

import { extractPdfText } from "@/lib/pdf";
import { inferTitle } from "@/lib/paper-utils";
import { savePaper, writeUploadedPdf } from "@/lib/storage";
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

  const id = nanoid();
  const createdAt = new Date().toISOString();
  const safeName = `${id}${path.extname(file.name) || ".pdf"}`;
  const uploadPath = await writeUploadedPdf(safeName, new Uint8Array(await file.arrayBuffer()));
  let stage = "extract";

  try {
    const extracted = await extractPdfText(uploadPath, id);
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
      uploadPath,
      status: "ready",
      createdAt,
      updatedAt: createdAt,
      text: extracted.text,
      blocks: extracted.blocks,
      assets: extracted.assets,
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
      uploadPath,
      status: "error",
      createdAt,
      updatedAt: createdAt,
      text: "",
      blocks: [],
      assets: [],
      chatHistory: [],
      recommendations: [],
      parseError:
        error instanceof Error ? `[${stage}] ${error.message}` : `[${stage}] PDF 解析失败`,
    };

    await savePaper(paper);
    return NextResponse.json({ error: paper.parseError }, { status: 500 });
  }
}
