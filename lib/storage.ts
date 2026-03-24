import { promises as fs } from "fs";
import path from "path";

import {
  DB_PATH,
  NOTE_ROOT,
  MINERU_OUTPUT_ROOT,
  PAPER_ASSET_ROOT,
  PDF_ROOT,
  STORAGE_ROOT,
  obsidianExportDir,
} from "@/lib/config";
import type {
  AssetPaperBlock,
  ChatMessage,
  DatabaseSchema,
  ExportedNote,
  PaperAsset,
  PaperBlock,
  PaperRecord,
  RecommendationItem,
  SearchPlan,
  SearchSource,
} from "@/lib/types";

const EMPTY_DB: DatabaseSchema = { papers: [] };

async function ensureDir(dirPath: string) {
  if (!dirPath.trim()) {
    return;
  }
  await fs.mkdir(dirPath, { recursive: true });
}

export async function ensureStorage() {
  await ensureDir(STORAGE_ROOT);
  await ensureDir(PDF_ROOT);
  await ensureDir(PAPER_ASSET_ROOT);
  await ensureDir(MINERU_OUTPUT_ROOT);
  await ensureDir(NOTE_ROOT);
  if (obsidianExportDir.trim()) {
    await ensureDir(obsidianExportDir);
  }

  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.writeFile(DB_PATH, JSON.stringify(EMPTY_DB, null, 2), "utf8");
  }
}

function toSafeString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeBbox(value: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 4) {
    return undefined;
  }
  const numbers = value.map((item) => Number(item));
  if (numbers.some((item) => Number.isNaN(item))) {
    return undefined;
  }
  return [numbers[0], numbers[1], numbers[2], numbers[3]];
}

async function copyLegacyAsset(sourcePath: string, paperId: string, assetId: string) {
  const ext = path.extname(sourcePath) || ".png";
  const fileName = `${assetId}${ext}`;
  const targetDir = path.join(PAPER_ASSET_ROOT, paperId);
  await fs.mkdir(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, fileName);
  await fs.copyFile(sourcePath, targetPath);
  return {
    fileName,
    relativePath: path.join(paperId, fileName),
    mimeType: ext.toLowerCase() === ".jpg" || ext.toLowerCase() === ".jpeg" ? "image/jpeg" : "image/png",
  };
}

async function migrateLegacyPaper(rawPaper: Record<string, unknown>) {
  const paper = rawPaper as Record<string, unknown>;
  const id = toSafeString(paper.id);
  const sections = Array.isArray(paper.sections) ? paper.sections : [];
  const images = Array.isArray(paper.images) ? paper.images : [];

  if (!id || !sections.length) {
    throw new Error("缺少可迁移的正文 sections。");
  }

  const blocks: PaperBlock[] = [];
  const assets: PaperAsset[] = [];
  let order = 0;
  let lastHeading = "";

  for (const sectionItem of sections) {
    if (!sectionItem || typeof sectionItem !== "object") {
      continue;
    }
    const section = sectionItem as Record<string, unknown>;
    const heading = toSafeString(section.title).trim();
    const english = toSafeString(section.english).replace(/\s+/g, " ").trim();
    const chinese = toSafeString(section.chinese).replace(/\s+/g, " ").trim();
    const page = Number(section.page) || 1;
    const bbox = normalizeBbox(section.bbox);

    if (heading && heading !== lastHeading) {
      order += 1;
      blocks.push({
        id: `block-${order}`,
        type: "heading",
        order,
        page,
        bbox,
        english: heading,
        chinese: "",
        headingLevel: 1,
      });
      lastHeading = heading;
    }

    if (!english) {
      continue;
    }

    order += 1;
    blocks.push({
      id: `block-${order}`,
      type: "text",
      order,
      page,
      bbox,
      english,
      chinese: chinese || undefined,
    });
  }

  for (const imageItem of images) {
    if (!imageItem || typeof imageItem !== "object") {
      continue;
    }
    const image = imageItem as Record<string, unknown>;
    const sourcePath = toSafeString(image.imagePath).trim();
    if (!sourcePath) {
      continue;
    }
    const page = Number(image.page) || 1;
    const kind: AssetPaperBlock["type"] = "image";
    const assetId = `asset-${order + 1}`;
    const copied = await copyLegacyAsset(sourcePath, id, assetId);
    const asset: PaperAsset = {
      id: assetId,
      kind,
      fileName: copied.fileName,
      relativePath: copied.relativePath,
      mimeType: copied.mimeType,
      page,
      order: order + 1,
    };
    assets.push(asset);
    order += 1;
    blocks.push({
      id: `block-${order}`,
      type: "image",
      order,
      page,
      assetId: asset.id,
      assetPath: asset.relativePath,
      english: toSafeString(image.caption).trim() || undefined,
    });
  }

  if (!blocks.length) {
    throw new Error("未迁移出可用 blocks。");
  }

  const migrated: PaperRecord = {
    id,
    title: toSafeString(paper.title) || "Untitled",
    authors: Array.isArray(paper.authors) ? paper.authors.map((item) => toSafeString(item)).filter(Boolean) : [],
    source: toSafeString(paper.source) || "upload",
    uploadPath: toSafeString(paper.uploadPath),
    status: (paper.status as PaperRecord["status"]) || "ready",
    createdAt: toSafeString(paper.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    text: blocks
      .filter(
        (block): block is Extract<PaperBlock, { type: "text" | "heading" }> =>
          block.type === "text" || block.type === "heading",
      )
      .map((block) => block.english)
      .join("\n\n"),
    blocks,
    assets,
    summary: paper.summary as PaperRecord["summary"],
    chatHistory: Array.isArray(paper.chatHistory) ? (paper.chatHistory as PaperRecord["chatHistory"]) : [],
    recommendations: Array.isArray(paper.recommendations)
      ? (paper.recommendations as PaperRecord["recommendations"])
      : [],
    recommendationPlan: paper.recommendationPlan as PaperRecord["recommendationPlan"],
    recommendationSources: paper.recommendationSources as PaperRecord["recommendationSources"],
    lastExport: paper.lastExport as PaperRecord["lastExport"],
    parseError: toSafeString(paper.parseError) || undefined,
  };

  return migrated;
}

async function normalizeDb(raw: DatabaseSchema): Promise<{ db: DatabaseSchema; changed: boolean }> {
  let changed = false;
  const papers: PaperRecord[] = [];

  for (const item of raw.papers ?? []) {
    const rawItem = item as unknown as Record<string, unknown>;
    const hasBlocks = Array.isArray(rawItem.blocks);
    const hasAssets = Array.isArray(rawItem.assets);
    if (hasBlocks && hasAssets) {
      papers.push(item);
      continue;
    }

    try {
      const migrated = await migrateLegacyPaper(rawItem);
      papers.push(migrated);
      changed = true;
    } catch {
      const safeItem = item as unknown as Record<string, unknown>;
      papers.push({
        id: toSafeString(safeItem.id),
        title: toSafeString(safeItem.title) || "Legacy Paper",
        authors: Array.isArray(safeItem.authors) ? safeItem.authors.map((value) => toSafeString(value)).filter(Boolean) : [],
        source: toSafeString(safeItem.source) || "upload",
        uploadPath: toSafeString(safeItem.uploadPath),
        status: "error",
        createdAt: toSafeString(safeItem.createdAt) || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        text: "",
        blocks: [],
        assets: [],
        summary: safeItem.summary as PaperRecord["summary"],
        chatHistory: Array.isArray(safeItem.chatHistory) ? (safeItem.chatHistory as PaperRecord["chatHistory"]) : [],
        recommendations: Array.isArray(safeItem.recommendations)
          ? (safeItem.recommendations as PaperRecord["recommendations"])
          : [],
        recommendationPlan: safeItem.recommendationPlan as PaperRecord["recommendationPlan"],
        recommendationSources: safeItem.recommendationSources as PaperRecord["recommendationSources"],
        lastExport: safeItem.lastExport as PaperRecord["lastExport"],
        parseError: "历史数据迁移失败，请重新上传该论文。",
      });
      changed = true;
    }
  }

  return {
    db: { papers },
    changed,
  };
}

async function readDb(): Promise<DatabaseSchema> {
  await ensureStorage();
  const raw = await fs.readFile(DB_PATH, "utf8");
  const parsed = JSON.parse(raw) as DatabaseSchema;
  const { db, changed } = await normalizeDb(parsed);
  if (changed) {
    await writeDb(db);
  }
  return db;
}

async function writeDb(db: DatabaseSchema) {
  await ensureStorage();
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

export async function listPapers() {
  const db = await readDb();
  return db.papers.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getPaper(id: string) {
  const db = await readDb();
  return db.papers.find((paper) => paper.id === id) ?? null;
}

export async function savePaper(paper: PaperRecord) {
  const db = await readDb();
  const existingIndex = db.papers.findIndex((item) => item.id === paper.id);

  if (existingIndex >= 0) {
    db.papers[existingIndex] = paper;
  } else {
    db.papers.push(paper);
  }

  await writeDb(db);
  return paper;
}

export async function updatePaper(id: string, updater: (paper: PaperRecord) => PaperRecord) {
  const db = await readDb();
  const index = db.papers.findIndex((paper) => paper.id === id);

  if (index < 0) {
    return null;
  }

  db.papers[index] = updater(db.papers[index]);
  await writeDb(db);
  return db.papers[index];
}

export async function appendChatMessage(id: string, messages: ChatMessage[]) {
  return updatePaper(id, (paper) => ({
    ...paper,
    chatHistory: [...paper.chatHistory, ...messages],
    updatedAt: new Date().toISOString(),
  }));
}

export async function saveRecommendations(
  id: string,
  recommendations: RecommendationItem[],
  meta?: { plan?: SearchPlan; sourcesUsed?: SearchSource[] },
) {
  return updatePaper(id, (paper) => ({
    ...paper,
    recommendations,
    recommendationPlan: meta?.plan,
    recommendationSources: meta?.sourcesUsed,
    updatedAt: new Date().toISOString(),
  }));
}

export async function saveExport(id: string, note: ExportedNote) {
  return updatePaper(id, (paper) => ({
    ...paper,
    lastExport: note,
    updatedAt: new Date().toISOString(),
  }));
}

export async function writeUploadedPdf(fileName: string, bytes: Uint8Array) {
  await ensureStorage();
  const targetPath = path.join(PDF_ROOT, fileName);
  await fs.writeFile(targetPath, bytes);
  return targetPath;
}

export async function writeMarkdownNote(fileName: string, markdown: string) {
  await ensureStorage();
  if (!obsidianExportDir.trim()) {
    throw new Error("OBSIDIAN_EXPORT_DIR 未配置");
  }
  const targetPath = path.join(obsidianExportDir, fileName);
  await fs.writeFile(targetPath, markdown, "utf8");
  return targetPath;
}
