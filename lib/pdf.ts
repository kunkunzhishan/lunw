import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";

import {
  MINERU_CLI,
  MINERU_DEVICE,
  MINERU_OUTPUT_ROOT,
  MINERU_SOURCE,
  PAPER_ASSET_ROOT,
} from "@/lib/config";
import type { PaperAsset, PaperBlock, TextPaperBlock } from "@/lib/types";

interface MineruContentItem {
  type?: string;
  text?: string;
  text_level?: number;
  text_format?: string;
  img_path?: string;
  bbox?: number[];
  page_idx?: number;
  image_caption?: string[];
  table_caption?: string[];
}

export interface ExtractedPdfPayload {
  title?: string;
  text: string;
  blocks: PaperBlock[];
  assets: PaperAsset[];
}

async function runMineru(filePath: string) {
  await fs.mkdir(MINERU_OUTPUT_ROOT, { recursive: true });
  const args = [
    "-p",
    filePath,
    "-o",
    MINERU_OUTPUT_ROOT,
    "-b",
    "pipeline",
    "-m",
    "auto",
    "-d",
    MINERU_DEVICE,
    "--source",
    MINERU_SOURCE,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(MINERU_CLI, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: "1",
      },
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`MinerU 命令退出异常 (code=${code})。${stderr ? ` stderr: ${stderr.trim()}` : ""}`));
        return;
      }
      if (stderr.includes("ERROR")) {
        reject(new Error(`MinerU 解析失败: ${stderr.trim()}`));
        return;
      }
      resolve();
    });
  });
}

function trimText(text: string | undefined) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

async function ensureFileExists(filePath: string, label: string) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`${label} 缺失: ${filePath}`);
  }
}

function resolveOutputDir(filePath: string) {
  const fileBaseName = path.basename(filePath, path.extname(filePath));
  return path.join(MINERU_OUTPUT_ROOT, fileBaseName, "auto");
}

export async function extractPdfText(filePath: string, paperId: string): Promise<ExtractedPdfPayload> {
  await runMineru(filePath);

  const outputDir = resolveOutputDir(filePath);
  const fileBaseName = path.basename(filePath, path.extname(filePath));
  const contentListPath = path.join(outputDir, `${fileBaseName}_content_list.json`);

  await ensureFileExists(contentListPath, "MinerU content_list");

  const raw = await fs.readFile(contentListPath, "utf8");
  const contentList = JSON.parse(raw) as MineruContentItem[];
  if (!Array.isArray(contentList) || !contentList.length) {
    throw new Error("MinerU 返回空 content_list。");
  }

  const assetDir = path.join(PAPER_ASSET_ROOT, paperId);
  await fs.mkdir(assetDir, { recursive: true });

  const assets: PaperAsset[] = [];
  const blocks: PaperBlock[] = [];
  const assetBySourcePath = new Map<string, PaperAsset>();
  let order = 0;

  for (const item of contentList) {
    const sourceType = item.type;
    if (!sourceType || sourceType === "discarded") {
      continue;
    }

    order += 1;
    const page = (item.page_idx ?? 0) + 1;
    const bbox =
      Array.isArray(item.bbox) && item.bbox.length === 4
        ? ([item.bbox[0], item.bbox[1], item.bbox[2], item.bbox[3]] as [number, number, number, number])
        : undefined;

    if (sourceType === "text" || sourceType === "code") {
      const english = trimText(item.text);
      if (!english) {
        continue;
      }

      const level = typeof item.text_level === "number" ? item.text_level : 0;
      blocks.push({
        id: `block-${order}`,
        type: level > 0 ? "heading" : "text",
        order,
        page,
        bbox,
        english,
        headingLevel: level > 0 ? level : undefined,
      });
      continue;
    }

    if (
      sourceType === "equation"
      || sourceType === "interline_equation"
      || sourceType === "inline_equation"
    ) {
      let assetId: string | undefined;
      let assetPath: string | undefined;
      if (item.img_path?.trim()) {
        const normalized = item.img_path.trim();
        const existing = assetBySourcePath.get(normalized);
        if (existing) {
          assetId = existing.id;
          assetPath = existing.relativePath;
        } else {
          const sourcePath = path.resolve(outputDir, normalized);
          await ensureFileExists(sourcePath, "公式资产");
          const ext = path.extname(sourcePath) || ".png";
          const id = `asset-${order}`;
          const fileName = `${id}${ext}`;
          const targetPath = path.join(assetDir, fileName);
          await fs.copyFile(sourcePath, targetPath);
          const asset: PaperAsset = {
            id,
            kind: "formula",
            fileName,
            relativePath: path.join(paperId, fileName),
            mimeType: ext.toLowerCase() === ".jpg" || ext.toLowerCase() === ".jpeg" ? "image/jpeg" : "image/png",
            page,
            order,
          };
          assets.push(asset);
          assetBySourcePath.set(normalized, asset);
          assetId = asset.id;
          assetPath = asset.relativePath;
        }
      }

      blocks.push({
        id: `block-${order}`,
        type: "formula",
        order,
        page,
        bbox,
        latex: item.text_format === "latex" ? (item.text ?? "").trim() : undefined,
        assetId,
        assetPath,
      });
      continue;
    }

    if (sourceType === "image" || sourceType === "table") {
      if (!item.img_path?.trim()) {
        throw new Error(`${sourceType} 块缺少 img_path。`);
      }
      const normalized = item.img_path.trim();
      const existing = assetBySourcePath.get(normalized);

      let asset = existing;
      if (!asset) {
        const sourcePath = path.resolve(outputDir, normalized);
        await ensureFileExists(sourcePath, `${sourceType} 资产`);
        const ext = path.extname(sourcePath) || ".png";
        const id = `asset-${order}`;
        const fileName = `${id}${ext}`;
        const targetPath = path.join(assetDir, fileName);
        await fs.copyFile(sourcePath, targetPath);
        asset = {
          id,
          kind: sourceType,
          fileName,
          relativePath: path.join(paperId, fileName),
          mimeType: ext.toLowerCase() === ".jpg" || ext.toLowerCase() === ".jpeg" ? "image/jpeg" : "image/png",
          page,
          order,
        };
        assets.push(asset);
        assetBySourcePath.set(normalized, asset);
      }

      const captions = sourceType === "image" ? item.image_caption : item.table_caption;
      blocks.push({
        id: `block-${order}`,
        type: sourceType,
        order,
        page,
        bbox,
        assetId: asset.id,
        assetPath: asset.relativePath,
        english: captions?.map((value) => trimText(value)).filter(Boolean).join(" "),
      });
      continue;
    }

    throw new Error(`暂不支持的 MinerU 块类型: ${sourceType}`);
  }

  if (!blocks.length) {
    throw new Error("MinerU 未解析出可阅读内容块。");
  }

  const textBlocks = blocks.filter(
    (block): block is TextPaperBlock => block.type === "text" || block.type === "heading",
  );
  const text = textBlocks
    .map((block) => block.english)
    .join("\n\n");

  if (!text.trim()) {
    throw new Error("MinerU 未解析出可用于翻译和摘要的文本。");
  }

  const title = textBlocks.find((block) => block.type === "heading")?.english
    ?? textBlocks[0]?.english
    ?? undefined;

  return {
    title,
    text,
    blocks,
    assets,
  };
}
