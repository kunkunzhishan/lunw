import { promises as fs } from "fs";
import path from "path";

import { nanoid } from "nanoid";

import {
  DB_PATH,
  NOTE_ROOT,
  MINERU_OUTPUT_ROOT,
  PAPER_ASSET_ROOT,
  PDF_ROOT,
  STORAGE_ROOT,
} from "@/lib/config";
import { readAppSettings } from "@/lib/settings";
import type {
  AssetPaperBlock,
  ChatMessage,
  DatabaseSchema,
  ExportedNote,
  PaperAnnotation,
  PaperAsset,
  PaperBlock,
  PaperHighlight,
  PaperRecord,
  RecommendationItem,
  RepositoryRecord,
  SearchPlan,
  SearchSource,
} from "@/lib/types";

export const DEFAULT_REPOSITORY_ID = "repo-default";
export const DEFAULT_REPOSITORY_NAME = "默认仓库";

const EMPTY_DB: DatabaseSchema = { repositories: [], papers: [] };

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
  const settings = await readAppSettings();
  if (settings.obsidianExportDir.trim()) {
    await ensureDir(settings.obsidianExportDir);
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

function normalizeRepositoryName(value: unknown) {
  return toSafeString(value).trim();
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

function normalizeAnnotations(value: unknown): PaperAnnotation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const annotations: PaperAnnotation[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const raw = item as Record<string, unknown>;
    const id = toSafeString(raw.id).trim();
    const blockId = toSafeString(raw.blockId).trim();
    const threadIdRaw = toSafeString(raw.threadId).trim();
    const threadId = threadIdRaw || `thread-${id}`;
    const quoteText = toSafeString(raw.quoteText).trim();
    const quoteStartRaw = Number(raw.quoteStart);
    const quoteEndRaw = Number(raw.quoteEnd);
    const quoteStart = Number.isInteger(quoteStartRaw) && quoteStartRaw >= 0 ? quoteStartRaw : undefined;
    const quoteEnd = Number.isInteger(quoteEndRaw) && quoteEndRaw >= 0 ? quoteEndRaw : undefined;
    const content = toSafeString(raw.content).trim();
    const createdAt = toSafeString(raw.createdAt).trim();
    const updatedAt = toSafeString(raw.updatedAt).trim();
    if (!id || !blockId || !content) {
      continue;
    }
    annotations.push({
      id,
      blockId,
      threadId,
      quoteText: quoteText || undefined,
      quoteStart:
        quoteStart !== undefined && quoteEnd !== undefined && quoteStart < quoteEnd
          ? quoteStart
          : undefined,
      quoteEnd:
        quoteStart !== undefined && quoteEnd !== undefined && quoteStart < quoteEnd
          ? quoteEnd
          : undefined,
      content,
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: updatedAt || createdAt || new Date().toISOString(),
    });
  }

  return annotations;
}

function normalizeHighlights(value: unknown): PaperHighlight[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const highlights: PaperHighlight[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const raw = item as Record<string, unknown>;
    const id = toSafeString(raw.id).trim();
    const blockId = toSafeString(raw.blockId).trim();
    const quoteText = toSafeString(raw.quoteText).trim();
    const quoteStartRaw = Number(raw.quoteStart);
    const quoteEndRaw = Number(raw.quoteEnd);
    const quoteStart = Number.isInteger(quoteStartRaw) && quoteStartRaw >= 0 ? quoteStartRaw : undefined;
    const quoteEnd = Number.isInteger(quoteEndRaw) && quoteEndRaw >= 0 ? quoteEndRaw : undefined;
    const createdAt = toSafeString(raw.createdAt).trim();
    if (!id || !blockId) {
      continue;
    }
    highlights.push({
      id,
      blockId,
      quoteText: quoteText || undefined,
      quoteStart:
        quoteStart !== undefined && quoteEnd !== undefined && quoteStart < quoteEnd
          ? quoteStart
          : undefined,
      quoteEnd:
        quoteStart !== undefined && quoteEnd !== undefined && quoteStart < quoteEnd
          ? quoteEnd
          : undefined,
      createdAt: createdAt || new Date().toISOString(),
    });
  }

  return highlights;
}

function createRepositoryRecord(name: string, now: string): RepositoryRecord {
  return {
    id: `repo-${nanoid(8)}`,
    name,
    createdAt: now,
    updatedAt: now,
  };
}

function createDefaultRepository(now: string): RepositoryRecord {
  return {
    id: DEFAULT_REPOSITORY_ID,
    name: DEFAULT_REPOSITORY_NAME,
    createdAt: now,
    updatedAt: now,
  };
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

async function migrateLegacyPaper(rawPaper: Record<string, unknown>, repositoryId: string) {
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
    repositoryId,
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
    annotations: normalizeAnnotations(paper.annotations),
    highlights: normalizeHighlights(paper.highlights),
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

async function normalizeDb(raw: Partial<DatabaseSchema>): Promise<{ db: DatabaseSchema; changed: boolean }> {
  let changed = false;
  const now = new Date().toISOString();
  const repositories: RepositoryRecord[] = [];
  const repoById = new Map<string, RepositoryRecord>();
  const repoByName = new Map<string, RepositoryRecord>();

  const addRepository = (candidate: RepositoryRecord) => {
    if (repoById.has(candidate.id)) {
      changed = true;
      candidate = { ...candidate, id: `repo-${nanoid(8)}` };
    }
    repositories.push(candidate);
    repoById.set(candidate.id, candidate);
    repoByName.set(candidate.name, candidate);
    return candidate;
  };

  const rawRepositories = Array.isArray(raw.repositories) ? raw.repositories : [];
  for (const item of rawRepositories) {
    const rawItem = item as unknown as Record<string, unknown>;
    const name = normalizeRepositoryName(rawItem.name);
    if (!name) {
      changed = true;
      continue;
    }

    const id = toSafeString(rawItem.id).trim() || `repo-${nanoid(8)}`;
    const createdAt = toSafeString(rawItem.createdAt) || now;
    const updatedAt = toSafeString(rawItem.updatedAt) || createdAt;
    const normalizedRepository: RepositoryRecord = { id, name, createdAt, updatedAt };

    if (
      id !== rawItem.id ||
      name !== rawItem.name ||
      createdAt !== rawItem.createdAt ||
      updatedAt !== rawItem.updatedAt
    ) {
      changed = true;
    }

    addRepository(normalizedRepository);
  }

  if (!repoById.has(DEFAULT_REPOSITORY_ID)) {
    addRepository(createDefaultRepository(now));
    changed = true;
  }

  const ensureRepositoryByName = (name: string) => {
    const normalizedName = normalizeRepositoryName(name);
    if (!normalizedName) {
      return DEFAULT_REPOSITORY_ID;
    }

    const existing = repoByName.get(normalizedName);
    if (existing) {
      return existing.id;
    }

    const created = addRepository(createRepositoryRecord(normalizedName, now));
    changed = true;
    return created.id;
  };

  const resolveRepositoryId = (rawPaper: Record<string, unknown>) => {
    const repoId = toSafeString(rawPaper.repositoryId).trim();
    if (repoId && repoById.has(repoId)) {
      return repoId;
    }

    const legacyCategory = toSafeString(rawPaper.category).trim();
    if (legacyCategory) {
      return ensureRepositoryByName(legacyCategory);
    }

    return DEFAULT_REPOSITORY_ID;
  };

  const papers: PaperRecord[] = [];
  const rawPapers = Array.isArray(raw.papers) ? raw.papers : [];

  for (const item of rawPapers) {
    const rawItem = item as unknown as Record<string, unknown>;
    const repositoryId = resolveRepositoryId(rawItem);
    const annotations = normalizeAnnotations(rawItem.annotations);
    const highlights = normalizeHighlights(rawItem.highlights);
    const hasBlocks = Array.isArray(rawItem.blocks);
    const hasAssets = Array.isArray(rawItem.assets);

    if (hasBlocks && hasAssets) {
      const normalizedPaper: PaperRecord = {
        ...item,
        repositoryId,
        annotations,
        highlights,
      };

      if (
        repositoryId !== toSafeString(rawItem.repositoryId).trim() ||
        (typeof rawItem.category === "string" && rawItem.category.trim()) ||
        annotations.length !== (Array.isArray(rawItem.annotations) ? rawItem.annotations.length : 0)
        || highlights.length !== (Array.isArray(rawItem.highlights) ? rawItem.highlights.length : 0)
      ) {
        changed = true;
      }

      papers.push(normalizedPaper);
      continue;
    }

    try {
      const migrated = await migrateLegacyPaper(rawItem, repositoryId);
      papers.push(migrated);
      changed = true;
    } catch {
      const safeItem = item as unknown as Record<string, unknown>;
      papers.push({
        id: toSafeString(safeItem.id),
        title: toSafeString(safeItem.title) || "Legacy Paper",
        authors: Array.isArray(safeItem.authors) ? safeItem.authors.map((value) => toSafeString(value)).filter(Boolean) : [],
        source: toSafeString(safeItem.source) || "upload",
        repositoryId,
        uploadPath: toSafeString(safeItem.uploadPath),
        status: "error",
        createdAt: toSafeString(safeItem.createdAt) || now,
        updatedAt: now,
        text: "",
        blocks: [],
        assets: [],
        annotations: normalizeAnnotations(safeItem.annotations),
        highlights: normalizeHighlights(safeItem.highlights),
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
    db: { repositories, papers },
    changed,
  };
}

async function readDb(): Promise<DatabaseSchema> {
  await ensureStorage();
  const raw = await fs.readFile(DB_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<DatabaseSchema>;
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

export async function listRepositories() {
  const db = await readDb();
  return [...db.repositories].sort((a, b) => {
    if (a.id === DEFAULT_REPOSITORY_ID) {
      return -1;
    }
    if (b.id === DEFAULT_REPOSITORY_ID) {
      return 1;
    }
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

export async function createRepository(name: string) {
  const db = await readDb();
  const normalizedName = normalizeRepositoryName(name);
  if (!normalizedName) {
    throw new Error("仓库名称不能为空。");
  }
  if (normalizedName.length > 24) {
    throw new Error("仓库名称不能超过 24 个字符。");
  }

  const existing = db.repositories.find((repo) => repo.name === normalizedName);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const repository = createRepositoryRecord(normalizedName, now);
  db.repositories.push(repository);
  await writeDb(db);
  return repository;
}

export async function renameRepository(id: string, name: string) {
  const db = await readDb();
  const index = db.repositories.findIndex((repository) => repository.id === id);
  if (index < 0) {
    return null;
  }

  const normalizedName = normalizeRepositoryName(name);
  if (!normalizedName) {
    throw new Error("仓库名称不能为空。");
  }
  if (normalizedName.length > 24) {
    throw new Error("仓库名称不能超过 24 个字符。");
  }

  const duplicate = db.repositories.find((repository) => repository.name === normalizedName && repository.id !== id);
  if (duplicate) {
    throw new Error("已存在同名仓库。");
  }

  db.repositories[index] = {
    ...db.repositories[index],
    name: normalizedName,
    updatedAt: new Date().toISOString(),
  };
  await writeDb(db);
  return db.repositories[index];
}

export async function deleteRepository(id: string) {
  if (id === DEFAULT_REPOSITORY_ID) {
    throw new Error("默认仓库不能删除。");
  }

  const db = await readDb();
  const index = db.repositories.findIndex((repository) => repository.id === id);
  if (index < 0) {
    return null;
  }

  const [removed] = db.repositories.splice(index, 1);
  const now = new Date().toISOString();
  db.papers = db.papers.map((paper) =>
    paper.repositoryId === id
      ? {
          ...paper,
          repositoryId: DEFAULT_REPOSITORY_ID,
          updatedAt: now,
        }
      : paper,
  );
  await writeDb(db);
  return removed;
}

export async function listPapers() {
  const db = await readDb();
  return [...db.papers].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getPaper(id: string) {
  const db = await readDb();
  return db.papers.find((paper) => paper.id === id) ?? null;
}

export async function savePaper(paper: PaperRecord) {
  const db = await readDb();
  const existingIndex = db.papers.findIndex((item) => item.id === paper.id);
  const repositoryExists = db.repositories.some((repository) => repository.id === paper.repositoryId);
  const normalizedPaper: PaperRecord = {
    ...paper,
    repositoryId: repositoryExists ? paper.repositoryId : DEFAULT_REPOSITORY_ID,
    annotations: normalizeAnnotations(paper.annotations),
    highlights: normalizeHighlights(paper.highlights),
  };

  if (existingIndex >= 0) {
    db.papers[existingIndex] = normalizedPaper;
  } else {
    db.papers.push(normalizedPaper);
  }

  await writeDb(db);
  return normalizedPaper;
}

export async function updatePaper(id: string, updater: (paper: PaperRecord) => PaperRecord) {
  const db = await readDb();
  const index = db.papers.findIndex((paper) => paper.id === id);

  if (index < 0) {
    return null;
  }

  const updatedPaper = updater(db.papers[index]);
  const repositoryExists = db.repositories.some((repository) => repository.id === updatedPaper.repositoryId);
  db.papers[index] = {
    ...updatedPaper,
    repositoryId: repositoryExists ? updatedPaper.repositoryId : DEFAULT_REPOSITORY_ID,
    annotations: normalizeAnnotations(updatedPaper.annotations),
    highlights: normalizeHighlights(updatedPaper.highlights),
  };
  await writeDb(db);
  return db.papers[index];
}

export async function movePapersToRepository(ids: string[], repositoryId: string) {
  const db = await readDb();
  const repositoryExists = db.repositories.some((repository) => repository.id === repositoryId);
  if (!repositoryExists) {
    return null;
  }

  const idSet = new Set(ids);
  if (!idSet.size) {
    return 0;
  }

  const now = new Date().toISOString();
  let movedCount = 0;
  db.papers = db.papers.map((paper) => {
    if (!idSet.has(paper.id) || paper.repositoryId === repositoryId) {
      return paper;
    }
    movedCount += 1;
    return {
      ...paper,
      repositoryId,
      updatedAt: now,
    };
  });

  if (movedCount > 0) {
    await writeDb(db);
  }

  return movedCount;
}

async function removePathIfExists(targetPath: string) {
  const normalizedPath = targetPath.trim();
  if (!normalizedPath) {
    return;
  }
  await fs.rm(normalizedPath, { recursive: true, force: true });
}

async function cleanupPaperFiles(paper: PaperRecord) {
  await Promise.allSettled([
    removePathIfExists(paper.uploadPath),
    removePathIfExists(path.join(PAPER_ASSET_ROOT, paper.id)),
    removePathIfExists(path.join(MINERU_OUTPUT_ROOT, paper.id)),
  ]);
}

export async function deletePapers(ids: string[]) {
  const db = await readDb();
  const idSet = new Set(ids);
  if (!idSet.size) {
    return [];
  }

  const removed: PaperRecord[] = [];
  const retained: PaperRecord[] = [];
  for (const paper of db.papers) {
    if (idSet.has(paper.id)) {
      removed.push(paper);
    } else {
      retained.push(paper);
    }
  }

  if (!removed.length) {
    return [];
  }

  db.papers = retained;
  await writeDb(db);
  await Promise.all(removed.map((paper) => cleanupPaperFiles(paper)));
  return removed;
}

export async function deletePaper(id: string) {
  const removed = await deletePapers([id]);
  return removed[0] ?? null;
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
  const settings = await readAppSettings();
  const targetRoot = settings.obsidianExportDir.trim();
  if (!targetRoot) {
    throw new Error("Obsidian 导出目录未配置，请先在设置中填写。");
  }
  const targetPath = path.join(targetRoot, fileName);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, markdown, "utf8");
  return targetPath;
}
