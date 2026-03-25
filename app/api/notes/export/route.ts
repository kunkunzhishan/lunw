import { promises as fs } from "fs";
import path from "path";

import { NextResponse } from "next/server";

import { PAPER_ASSET_ROOT } from "@/lib/config";
import { generateObsidianNote } from "@/lib/llm";
import { readAppSettings } from "@/lib/settings";
import { getPaper, listRepositories, saveExport, writeMarkdownNote } from "@/lib/storage";
import type { ExportedNote } from "@/lib/types";

function toSafeName(value: string, fallback: string) {
  const normalized = value
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "_")
    .replace(/_+/g, "_");
  return normalized || fallback;
}

type PaperForExport = NonNullable<Awaited<ReturnType<typeof getPaper>>>;
type VisualSelectionItem = {
  block: Extract<PaperForExport["blocks"][number], { type: "image" | "table" }>;
  caption: string;
};

const NOTE_MATCH_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "are",
  "was",
  "were",
  "into",
  "onto",
  "about",
  "using",
  "paper",
  "model",
  "method",
  "results",
  "section",
  "figure",
  "table",
  "公式",
  "图表",
]);

function tokenizeForMatching(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !NOTE_MATCH_STOP_WORDS.has(token));
}

function extractMentionedPages(markdown: string) {
  const pages = new Set<number>();

  for (const match of markdown.matchAll(/\bP\s*([0-9]{1,4})\b/gi)) {
    const page = Number(match[1]);
    if (Number.isFinite(page)) {
      pages.add(page);
    }
  }
  for (const match of markdown.matchAll(/第\s*([0-9]{1,4})\s*页/g)) {
    const page = Number(match[1]);
    if (Number.isFinite(page)) {
      pages.add(page);
    }
  }

  return pages;
}

function extractMentionedVisualNumbers(markdown: string) {
  const figureNumbers = new Set<number>();
  const tableNumbers = new Set<number>();

  for (const match of markdown.matchAll(/\b(?:figure|fig\.?)\s*([0-9]{1,3})\b/gi)) {
    const number = Number(match[1]);
    if (Number.isFinite(number)) {
      figureNumbers.add(number);
    }
  }
  for (const match of markdown.matchAll(/\btable\s*([0-9]{1,3})\b/gi)) {
    const number = Number(match[1]);
    if (Number.isFinite(number)) {
      tableNumbers.add(number);
    }
  }
  for (const match of markdown.matchAll(/图\s*([0-9]{1,3})/g)) {
    const number = Number(match[1]);
    if (Number.isFinite(number)) {
      figureNumbers.add(number);
    }
  }
  for (const match of markdown.matchAll(/表\s*([0-9]{1,3})/g)) {
    const number = Number(match[1]);
    if (Number.isFinite(number)) {
      tableNumbers.add(number);
    }
  }

  return {
    figureNumbers,
    tableNumbers,
    hasGenericVisualMention: /(?:\bfigure\b|\bfig\.?\b|\btable\b|图表|图\s*[0-9]|表\s*[0-9])/i.test(markdown),
  };
}

function extractCaptionLabel(caption: string) {
  const match = caption.match(/\b(Figure|Fig\.?|Table)\s*([0-9]{1,3})\b/i);
  if (!match) {
    return null;
  }
  return {
    kind: /table/i.test(match[1]) ? "table" as const : "figure" as const,
    number: Number(match[2]),
  };
}

function scoreVisualIntrinsic(caption: string, blockType: "image" | "table") {
  const normalized = caption.trim();
  if (!normalized) {
    return 0;
  }

  let score = 0;
  const hasFigureLabel = /\b(?:figure|fig\.?|table)\s*\d+\b/i.test(normalized);
  const isFirstMainVisual = /\b(?:figure|fig\.?|table)\s*1\b/i.test(normalized);
  const hasOverviewSignal = /(framework|overview|architecture|pipeline|workflow|system|method|approach|框架|总览|结构|流程|方法)/i.test(normalized);
  const hasResultSignal = /(result|comparison|ablation|performance|accuracy|f1|bleu|rouge|benchmark|error|qualitative|quantitative|结果|对比|消融|性能|准确率)/i.test(normalized);

  if (hasFigureLabel) {
    score += 2;
  }
  if (isFirstMainVisual) {
    score += 3;
  }
  if (hasOverviewSignal) {
    score += blockType === "image" ? 4 : 2;
  }
  if (hasResultSignal) {
    score += 3;
  }
  if (normalized.length >= 12 && normalized.length <= 260) {
    score += 1;
  }

  return score;
}

function pickRelevantVisualBlocks(paper: PaperForExport, markdown: string) {
  const noteTokens = new Set(tokenizeForMatching(markdown));
  const noteLower = markdown.toLowerCase();
  const mentionedPages = extractMentionedPages(markdown);
  const mentionedVisuals = extractMentionedVisualNumbers(markdown);

  const scored = paper.blocks
    .filter(
      (block): block is Extract<PaperForExport["blocks"][number], { type: "image" | "table" }> =>
        block.type === "image" || block.type === "table",
    )
    .map((block) => {
      const caption = (block.english ?? "").trim();
      const captionTokens = tokenizeForMatching(caption);
      const label = extractCaptionLabel(caption);
      let relevanceScore = 0;

      if (mentionedPages.has(block.page)) {
        relevanceScore += 2;
      }
      if (label?.kind === "figure" && mentionedVisuals.figureNumbers.has(label.number)) {
        relevanceScore += 4;
      }
      if (label?.kind === "table" && mentionedVisuals.tableNumbers.has(label.number)) {
        relevanceScore += 4;
      }

      let overlap = 0;
      for (const token of captionTokens) {
        if (noteTokens.has(token)) {
          overlap += 1;
        }
      }
      if (overlap >= 2) {
        relevanceScore += 2;
      } else if (overlap === 1) {
        relevanceScore += 1;
      }

      if (caption.length >= 12 && noteLower.includes(caption.toLowerCase().slice(0, Math.min(24, caption.length)))) {
        relevanceScore += 2;
      }

      const intrinsicScore = scoreVisualIntrinsic(caption, block.type);
      const score = relevanceScore * 2 + intrinsicScore;
      return { block, caption, label, relevanceScore, intrinsicScore, score };
    });

  const strictMatches = scored
    .filter((item) => item.relevanceScore >= 3)
    .sort((left, right) => right.score - left.score || left.block.order - right.block.order);
  const contextMatches = scored
    .filter((item) => item.relevanceScore > 0)
    .sort((left, right) => right.score - left.score || left.block.order - right.block.order);
  const intrinsicMatches = scored
    .filter((item) => item.intrinsicScore >= 3 || (item.label?.number === 1 && item.intrinsicScore >= 2))
    .sort((left, right) => right.intrinsicScore - left.intrinsicScore || left.block.order - right.block.order);
  const broadMatches = scored
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.block.order - right.block.order);

  const selected: typeof broadMatches = [];
  const seenAssetIds = new Set<string>();
  const addMatches = (items: typeof broadMatches, limit: number) => {
    for (const item of items) {
      if (selected.length >= limit) {
        break;
      }
      if (seenAssetIds.has(item.block.assetId)) {
        continue;
      }
      selected.push(item);
      seenAssetIds.add(item.block.assetId);
    }
  };

  const targetCount = mentionedVisuals.hasGenericVisualMention ? 6 : 4;
  const minCount = Math.min(3, targetCount);

  addMatches(strictMatches, targetCount);
  if (selected.length < minCount) {
    addMatches(contextMatches, minCount);
  }
  if (selected.length < minCount) {
    addMatches(intrinsicMatches, minCount);
  }
  if (selected.length < targetCount) {
    addMatches(contextMatches, targetCount);
  }
  if (selected.length < targetCount) {
    addMatches(intrinsicMatches, targetCount);
  }
  if (selected.length === 0) {
    addMatches(broadMatches, 2);
  }
  if (selected.length < targetCount) {
    addMatches(broadMatches, targetCount);
  }

  return selected.map((item) => ({
    block: item.block,
    caption: item.caption,
  }));
}

function pickRelevantVisualBlocksFromGeneratedNote(
  paper: PaperForExport,
  markdown: string,
  preferredAssetIds: string[],
) {
  const heuristic = pickRelevantVisualBlocks(paper, markdown);
  const allVisuals: VisualSelectionItem[] = paper.blocks
    .filter(
      (block): block is Extract<PaperForExport["blocks"][number], { type: "image" | "table" }> =>
        block.type === "image" || block.type === "table",
    )
    .map((block) => ({
      block,
      caption: (block.english ?? "").trim(),
    }));

  if (!allVisuals.length) {
    return [];
  }

  if (!preferredAssetIds.length) {
    return heuristic;
  }

  const selectedSet = new Set(preferredAssetIds);
  const selectedFromLlm = allVisuals
    .filter((item) => selectedSet.has(item.block.assetId))
    .sort((left, right) => left.block.order - right.block.order);

  const merged: VisualSelectionItem[] = [];
  const seenAssetIds = new Set<string>();
  const add = (items: VisualSelectionItem[], limit: number) => {
    for (const item of items) {
      if (merged.length >= limit) {
        break;
      }
      if (seenAssetIds.has(item.block.assetId)) {
        continue;
      }
      merged.push(item);
      seenAssetIds.add(item.block.assetId);
    }
  };

  const targetCount = 6;
  add(selectedFromLlm, targetCount);
  if (merged.length < 3) {
    add(heuristic, 3);
  }
  if (merged.length < targetCount) {
    add(heuristic, targetCount);
  }

  return merged;
}

async function copyVisualAssetsToObsidian(params: {
  paper: NonNullable<Awaited<ReturnType<typeof getPaper>>>;
  obsidianRoot: string;
  repositoryDir: string;
  baseFileName: string;
  visualBlocks: VisualSelectionItem[];
}) {
  const { paper, obsidianRoot, repositoryDir, baseFileName, visualBlocks } = params;
  if (!visualBlocks.length) {
    return [];
  }

  const assetsDirName = `${baseFileName}_assets`;
  const assetsTargetDir = path.join(obsidianRoot, repositoryDir, assetsDirName);
  await fs.mkdir(assetsTargetDir, { recursive: true });

  const copied: Array<{
    label: string;
    page: number;
    caption?: string;
    obsidianLink: string;
    mentionHints: string[];
  }> = [];

  for (const item of visualBlocks) {
    const asset = paper.assets.find((candidate) => candidate.id === item.block.assetId);
    if (!asset) {
      continue;
    }

    const sourcePath = path.join(PAPER_ASSET_ROOT, asset.relativePath);
    const targetPath = path.join(assetsTargetDir, asset.fileName);
    try {
      await fs.copyFile(sourcePath, targetPath);
    } catch {
      continue;
    }

    copied.push({
      label: item.block.type === "table" ? "表格" : "图片",
      page: item.block.page,
      caption: item.caption || undefined,
      obsidianLink: `![[${assetsDirName}/${asset.fileName}]]`,
      mentionHints: (() => {
        const label = extractCaptionLabel(item.caption);
        if (!label || !Number.isFinite(label.number)) {
          return [];
        }
        if (label.kind === "figure") {
          return [`figure ${label.number}`, `fig ${label.number}`, `fig. ${label.number}`, `图${label.number}`];
        }
        return [`table ${label.number}`, `表${label.number}`];
      })(),
    });
  }

  return copied;
}

function pickInlineVisualAnchorLine(lines: string[], visual: {
  page: number;
  caption?: string;
  captionZh?: string;
  mentionHints: string[];
}) {
  let bestIndex = -1;
  let bestScore = 0;
  const captionTokens = tokenizeForMatching(`${visual.captionZh ?? ""} ${visual.caption ?? ""}`);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const lower = line.toLowerCase();
    let score = 0;
    for (const hint of visual.mentionHints) {
      if (hint && lower.includes(hint.toLowerCase())) {
        score += 8;
      }
    }
    if (new RegExp(`\\bP\\s*${visual.page}\\b`, "i").test(line) || new RegExp(`第\\s*${visual.page}\\s*页`).test(line)) {
      score += 3;
    }

    if (captionTokens.length) {
      const lineTokens = new Set(tokenizeForMatching(lower));
      let overlap = 0;
      for (const token of captionTokens) {
        if (lineTokens.has(token)) {
          overlap += 1;
        }
      }
      score += Math.min(3, overlap);
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestScore > 0 ? bestIndex : -1;
}

function injectVisualsInline(markdown: string, visuals: Array<{
  label: string;
  page: number;
  caption?: string;
  captionZh?: string;
  obsidianLink: string;
  mentionHints: string[];
}>) {
  if (!visuals.length) {
    return markdown.trim();
  }

  const lines = markdown.split("\n");
  const insertionMap = new Map<number, string[]>();

  for (const visual of visuals) {
    let lineIndex = pickInlineVisualAnchorLine(lines, visual);
    if (lineIndex < 0) {
      lineIndex = lines.length - 1;
    }

    const captionLine = (visual.captionZh ?? visual.caption ?? "").trim();
    const block = [
      visual.obsidianLink,
      captionLine ? `> 图注：${captionLine}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const list = insertionMap.get(lineIndex) ?? [];
    list.push(block);
    insertionMap.set(lineIndex, list);
  }

  const merged: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    merged.push(lines[index]);
    const inserts = insertionMap.get(index);
    if (!inserts?.length) {
      continue;
    }
    merged.push("");
    inserts.forEach((item, insertIndex) => {
      if (insertIndex > 0) {
        merged.push("");
      }
      merged.push(item);
    });
    merged.push("");
  }

  return merged.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { paperId?: string; fileName?: string };

    if (!body.paperId) {
      return NextResponse.json({ error: "缺少 paperId。" }, { status: 400 });
    }

    const paper = await getPaper(body.paperId);
    if (!paper) {
      return NextResponse.json({ error: "论文不存在。" }, { status: 404 });
    }

    const repositories = await listRepositories();
    const repositoryName = repositories.find((repo) => repo.id === paper.repositoryId)?.name ?? "默认仓库";
    const repositoryDir = toSafeName(repositoryName, "默认仓库");
    const baseFileName = toSafeName(body.fileName?.trim() || paper.title || paper.id, paper.id);
    const relativePath = path.join(repositoryDir, `${baseFileName}.md`);

    const generated = await generateObsidianNote(paper, repositoryName, {
      visualCandidates: paper.blocks
        .filter(
          (block): block is Extract<PaperForExport["blocks"][number], { type: "image" | "table" }> =>
            block.type === "image" || block.type === "table",
        )
        .map((block) => ({
          assetId: block.assetId,
          page: block.page,
          type: block.type,
          caption: (block.english ?? "").trim(),
        })),
    });
    const markdown = generated.markdown;
    const selectedVisualAssetIds = generated.selectedVisualAssetIds;

    const settings = await readAppSettings();
    const obsidianRoot = settings.obsidianExportDir.trim();
    if (!obsidianRoot) {
      throw new Error("Obsidian 导出目录未配置，请先在设置中填写。");
    }

    const visualBlocks = pickRelevantVisualBlocksFromGeneratedNote(paper, markdown, selectedVisualAssetIds);
    const copiedVisuals = await copyVisualAssetsToObsidian({
      paper,
      obsidianRoot,
      repositoryDir,
      baseFileName,
      visualBlocks,
    });
    const finalMarkdown = injectVisualsInline(markdown, copiedVisuals).trim();

    const targetPath = await writeMarkdownNote(relativePath, finalMarkdown);

    const note: ExportedNote = {
      paperId: paper.id,
      markdown: finalMarkdown,
      targetPath: path.resolve(targetPath),
      exportedAt: new Date().toISOString(),
    };

    await saveExport(paper.id, note);

    return NextResponse.json(note);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "导出失败" },
      { status: 500 },
    );
  }
}
