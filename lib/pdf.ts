import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import { randomUUID } from "crypto";

import {
  MINERU_API_BASE_URL,
  MINERU_API_ENABLE_FORMULA,
  MINERU_API_ENABLE_TABLE,
  MINERU_API_IS_OCR,
  MINERU_API_LANGUAGE,
  MINERU_API_MODEL_VERSION,
  MINERU_API_POLL_INTERVAL_MS,
  MINERU_API_TIMEOUT_MS,
  MINERU_CLI,
  MINERU_DEVICE,
  MINERU_MODE,
  MINERU_OUTPUT_ROOT,
  MINERU_SOURCE,
  PAPER_ASSET_ROOT,
  type MineruMode,
  normalizeMineruMode,
} from "@/lib/config";
import { readAppSettings } from "@/lib/settings";
import type { PaperAsset, PaperBlock, TextPaperBlock } from "@/lib/types";

interface MineruContentItem {
  type?: string;
  text?: string;
  text_level?: number;
  text_format?: string;
  list_items?: string[];
  code_body?: string;
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

export interface ExtractPdfOptions {
  mode?: MineruMode;
}

interface MineruRunOutput {
  contentListPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildMineruApiUrl(endpoint: string) {
  const base = MINERU_API_BASE_URL.endsWith("/") ? MINERU_API_BASE_URL : `${MINERU_API_BASE_URL}/`;
  return new URL(endpoint.replace(/^\//, ""), base).toString();
}

function ensureMineruApiToken(token: string) {
  if (!token) {
    throw new Error("MinerU API token 未配置。请在设置中填写处理 PDF 的 token。");
  }
}

async function requestMineruApi(endpoint: string, init: RequestInit, token: string) {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(buildMineruApiUrl(endpoint), {
      ...init,
      headers,
    });
  } catch (error) {
    throw new Error(`请求 MinerU API 失败：${describeError(error)}`);
  }

  const rawText = await response.text();
  let payload: unknown;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    throw new Error(`MinerU API 返回非 JSON 响应 (status=${response.status})。`);
  }

  if (!response.ok) {
    const detail = rawText.trim();
    throw new Error(
      `MinerU API 请求失败 (status=${response.status})。${detail ? ` body: ${detail.slice(0, 500)}` : ""}`,
    );
  }

  if (!isRecord(payload)) {
    throw new Error("MinerU API 响应格式异常。");
  }

  const code = typeof payload.code === "number" ? payload.code : Number.NaN;
  if (code !== 0) {
    const msg = readNonEmptyString(payload.msg) ?? "unknown";
    throw new Error(`MinerU API 返回错误 (code=${Number.isFinite(code) ? code : "unknown"})：${msg}`);
  }

  return payload.data;
}

function extractUploadUrl(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (!isRecord(value)) {
    return undefined;
  }
  return readNonEmptyString(value.url)
    ?? readNonEmptyString(value.upload_url)
    ?? readNonEmptyString(value.file_url)
    ?? readNonEmptyString(value.put_url);
}

async function requestUploadUrl(fileName: string, paperId: string, token: string) {
  const requestBody: Record<string, unknown> = {
    files: [{ name: fileName, data_id: paperId }],
    model_version: MINERU_API_MODEL_VERSION,
    enable_formula: MINERU_API_ENABLE_FORMULA,
    enable_table: MINERU_API_ENABLE_TABLE,
  };

  if (MINERU_API_LANGUAGE) {
    requestBody.lang = MINERU_API_LANGUAGE;
  }
  if (MINERU_API_MODEL_VERSION === "pipeline") {
    requestBody.is_ocr = MINERU_API_IS_OCR;
  }

  const data = await requestMineruApi("/file-urls/batch", {
    method: "POST",
    body: JSON.stringify(requestBody),
  }, token);

  if (!isRecord(data)) {
    throw new Error("MinerU file-urls/batch 响应格式异常。");
  }

  const batchId = readNonEmptyString(data.batch_id);
  if (!batchId) {
    throw new Error("MinerU file-urls/batch 未返回 batch_id。");
  }

  const directUploadUrl = extractUploadUrl(data.upload_url)
    ?? extractUploadUrl(data.file_url)
    ?? extractUploadUrl(data.url);
  if (directUploadUrl) {
    return { batchId, uploadUrl: directUploadUrl };
  }

  const candidates: unknown[] = [];
  if (Array.isArray(data.file_urls)) {
    candidates.push(...data.file_urls);
  }
  if (Array.isArray(data.files)) {
    candidates.push(...data.files);
  }

  const uploadUrl = candidates
    .map((item) => extractUploadUrl(item))
    .find((value): value is string => Boolean(value));
  if (!uploadUrl) {
    throw new Error("MinerU file-urls/batch 未返回可用上传地址。");
  }

  return { batchId, uploadUrl };
}

async function uploadToSignedUrl(uploadUrl: string, filePath: string) {
  const fileBuffer = await fs.readFile(filePath);
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: "PUT",
      body: fileBuffer,
    });
  } catch (error) {
    throw new Error(`上传 PDF 到 MinerU 失败：${describeError(error)}`);
  }

  if (!response.ok) {
    const body = (await response.text()).trim();
    throw new Error(
      `上传 PDF 到 MinerU 失败 (status=${response.status})。${body ? ` body: ${body.slice(0, 500)}` : ""}`,
    );
  }
}

function pickExtractResult(data: unknown, paperId: string, fileName: string) {
  if (!isRecord(data)) {
    throw new Error("MinerU extract-results 响应格式异常。");
  }

  const rawResults = data.extract_result ?? data.result ?? data.results;
  if (Array.isArray(rawResults)) {
    const records = rawResults.filter(isRecord);
    const byDataId = records.find((item) => readNonEmptyString(item.data_id) === paperId);
    if (byDataId) {
      return byDataId;
    }
    const byName = records.find((item) => readNonEmptyString(item.file_name) === fileName);
    if (byName) {
      return byName;
    }
    if (records[0]) {
      return records[0];
    }
  }

  if (isRecord(rawResults)) {
    return rawResults;
  }

  throw new Error("MinerU extract-results 未返回解析结果。");
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (isRecord(cause)) {
      const code = typeof cause.code === "string" ? cause.code : undefined;
      const host = typeof cause.host === "string" ? cause.host : undefined;
      if (code && host) {
        return `${error.message} (${code} @ ${host})`;
      }
      if (code) {
        return `${error.message} (${code})`;
      }
    }
    return error.message;
  }
  return String(error);
}

async function waitForExtractDone(batchId: string, paperId: string, fileName: string, token: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= MINERU_API_TIMEOUT_MS) {
    const data = await requestMineruApi(`/extract-results/batch/${batchId}`, {
      method: "GET",
    }, token);

    const result = pickExtractResult(data, paperId, fileName);
    const state = readNonEmptyString(result.state) ?? "unknown";

    if (state === "done") {
      const fullZipUrl = readNonEmptyString(result.full_zip_url);
      if (!fullZipUrl) {
        throw new Error("MinerU 解析完成，但未返回 full_zip_url。");
      }
      return fullZipUrl;
    }

    if (state === "failed") {
      const reason = readNonEmptyString(result.err_msg) ?? "未知错误";
      throw new Error(`MinerU API 解析失败：${reason}`);
    }

    await sleep(MINERU_API_POLL_INTERVAL_MS);
  }

  throw new Error(`MinerU API 解析超时（>${Math.ceil(MINERU_API_TIMEOUT_MS / 1000)} 秒）。`);
}

async function runUnzip(zipPath: string, outputDir: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("unzip", ["-o", zipPath, "-d", outputDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`解压 MinerU 结果失败 (code=${code})。${stderr ? ` stderr: ${stderr.trim()}` : ""}`));
        return;
      }
      resolve();
    });
  });
}

async function runShellCommand(command: string, args: string[], label: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${label} 失败 (code=${code})。${stderr ? ` stderr: ${stderr.trim()}` : ""}`));
        return;
      }
      resolve();
    });
  });
}

async function downloadMineruZip(fullZipUrl: string, zipPath: string) {
  try {
    const zipResponse = await fetch(fullZipUrl);
    if (!zipResponse.ok) {
      const body = (await zipResponse.text()).trim();
      throw new Error(
        `下载 MinerU 结果失败 (status=${zipResponse.status})。${body ? ` body: ${body.slice(0, 500)}` : ""}`,
      );
    }

    const zipBuffer = Buffer.from(await zipResponse.arrayBuffer());
    await fs.writeFile(zipPath, zipBuffer);
  } catch (error) {
    await runShellCommand("curl", ["-fL", fullZipUrl, "-o", zipPath], "通过 curl 下载 MinerU 结果");
    await ensureFileExists(zipPath, "MinerU 结果压缩包");
  }
}

async function findFirstFileBySuffix(rootDir: string, suffix: string): Promise<string | undefined> {
  const queue = [rootDir];

  while (queue.length) {
    const currentDir = queue.shift();
    if (!currentDir) {
      continue;
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(suffix)) {
        return fullPath;
      }
    }
  }

  return undefined;
}

async function runMineruApi(filePath: string, paperId: string): Promise<MineruRunOutput> {
  const settings = await readAppSettings();
  const token = settings.mineruApiToken.trim();
  ensureMineruApiToken(token);
  await fs.mkdir(MINERU_OUTPUT_ROOT, { recursive: true });

  const fileName = path.basename(filePath);
  const fileBaseName = path.basename(filePath, path.extname(filePath));
  const runId = randomUUID();
  const outputDir = path.join(MINERU_OUTPUT_ROOT, fileBaseName, "api", runId);
  const extractedDir = path.join(outputDir, "extract");
  const zipPath = path.join(outputDir, "result.zip");

  await fs.mkdir(extractedDir, { recursive: true });

  const { batchId, uploadUrl } = await requestUploadUrl(fileName, paperId, token);
  await uploadToSignedUrl(uploadUrl, filePath);
  const fullZipUrl = await waitForExtractDone(batchId, paperId, fileName, token);
  await downloadMineruZip(fullZipUrl, zipPath);
  await runUnzip(zipPath, extractedDir);

  const contentListPath = await findFirstFileBySuffix(extractedDir, "_content_list.json");
  if (!contentListPath) {
    throw new Error("MinerU API 结果中缺少 *_content_list.json。");
  }

  return { contentListPath };
}

function resolveLocalOutputDir(filePath: string) {
  const fileBaseName = path.basename(filePath, path.extname(filePath));
  return path.join(MINERU_OUTPUT_ROOT, fileBaseName, "auto");
}

async function runMineruLocal(filePath: string): Promise<MineruRunOutput> {
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

  const outputDir = resolveLocalOutputDir(filePath);
  const fileBaseName = path.basename(filePath, path.extname(filePath));
  const contentListPath = path.join(outputDir, `${fileBaseName}_content_list.json`);
  return { contentListPath };
}

async function runMineru(filePath: string, paperId: string, mode: MineruMode): Promise<MineruRunOutput> {
  if (mode === "local") {
    return runMineruLocal(filePath);
  }
  return runMineruApi(filePath, paperId);
}

function trimText(text: string | undefined) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function normalizeCaptionCandidate(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .trim();
}

function selectReadableCaption(captions: string[] | undefined, sourceType: "image" | "table") {
  if (!captions?.length) {
    return undefined;
  }

  const normalized = captions.map((value) => normalizeCaptionCandidate(trimText(value))).filter(Boolean);
  if (!normalized.length) {
    return undefined;
  }

  const label = sourceType === "table" ? "Table" : "(?:Figure|Fig\\.?)";
  const primaryPattern = new RegExp(`\\b${label}\\s*\\d+\\s*[:.]\\s*[^.?!。！？]+[.?!。！？]?`, "i");
  const hasNumberPattern = new RegExp(`\\b${label}\\s*\\d+`, "i");

  const byPrimarySentence = normalized
    .map((value) => value.match(primaryPattern)?.[0]?.trim())
    .find(Boolean);
  if (byPrimarySentence) {
    return byPrimarySentence;
  }

  const byLabel = normalized.find((value) => hasNumberPattern.test(value));
  if (byLabel) {
    return byLabel;
  }

  return normalized[0];
}

async function ensureFileExists(filePath: string, label: string) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`${label} 缺失: ${filePath}`);
  }
}

export async function extractPdfText(
  filePath: string,
  paperId: string,
  options: ExtractPdfOptions = {},
): Promise<ExtractedPdfPayload> {
  const mode = normalizeMineruMode(options.mode ?? MINERU_MODE);
  const { contentListPath } = await runMineru(filePath, paperId, mode);
  const outputDir = path.dirname(contentListPath);

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
  const layoutNoiseTypes = new Set([
    "discarded",
    "page_number",
    "footer",
    "header",
    "page_header",
    "page_footer",
    "page_footnote",
    "aside_text",
  ]);

  for (const item of contentList) {
    const sourceType = item.type;
    if (!sourceType || layoutNoiseTypes.has(sourceType)) {
      continue;
    }

    order += 1;
    const page = (item.page_idx ?? 0) + 1;
    const bbox =
      Array.isArray(item.bbox) && item.bbox.length === 4
        ? ([item.bbox[0], item.bbox[1], item.bbox[2], item.bbox[3]] as [number, number, number, number])
        : undefined;

    if (sourceType === "list") {
      const entries = Array.isArray(item.list_items)
        ? item.list_items.map((value) => trimText(value)).filter(Boolean)
        : [];
      const english = entries.length
        ? entries.map((value) => (value.startsWith("•") ? value : `• ${value}`)).join("\n")
        : trimText(item.text);
      if (!english) {
        continue;
      }

      blocks.push({
        id: `block-${order}`,
        type: "text",
        order,
        page,
        bbox,
        english,
      });
      continue;
    }

    if (sourceType === "text" || sourceType === "code") {
      const codeBody = sourceType === "code" ? trimText(item.code_body) : "";
      const english = codeBody || trimText(item.text);
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
        latex:
          item.text_format === "latex" || (item.text ?? "").trim().startsWith("$")
            ? (item.text ?? "").trim()
            : undefined,
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
        english: selectReadableCaption(captions, sourceType),
      });
      continue;
    }

    const fallbackText = trimText(item.text);
    if (fallbackText) {
      blocks.push({
        id: `block-${order}`,
        type: "text",
        order,
        page,
        bbox,
        english: fallbackText,
      });
    }
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
