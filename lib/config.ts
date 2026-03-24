import path from "path";

export const APP_ROOT = process.cwd();
export const STORAGE_ROOT = path.join(APP_ROOT, "storage");
export const PDF_ROOT = path.join(STORAGE_ROOT, "papers");
export const PAPER_ASSET_ROOT = path.join(STORAGE_ROOT, "paper-assets");
export const MINERU_OUTPUT_ROOT = path.join(STORAGE_ROOT, "mineru-output");
export const NOTE_ROOT = path.join(STORAGE_ROOT, "notes");
export const DB_PATH = path.join(STORAGE_ROOT, "db.json");
export const SETTINGS_PATH = path.join(STORAGE_ROOT, "settings.json");

function readEnvOrDefault(value: string | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

function readEnvNumber(value: string | undefined, fallback: number) {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readEnvBool(value: string | undefined, fallback: boolean) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

export type MineruMode = "api" | "local";

export function normalizeMineruMode(value: string | undefined): MineruMode {
  return value?.trim().toLowerCase() === "local" ? "local" : "api";
}

export const MINERU_CLI = readEnvOrDefault(
  process.env.MINERU_CLI_PATH,
  path.join(APP_ROOT, ".venv-mineru", "bin", "mineru"),
);

export const MINERU_MODE = normalizeMineruMode(process.env.MINERU_MODE);
export const MINERU_DEVICE = readEnvOrDefault(process.env.MINERU_DEVICE, "mps");
export const MINERU_SOURCE = readEnvOrDefault(process.env.MINERU_SOURCE, "huggingface");
export const MINERU_API_BASE_URL = readEnvOrDefault(process.env.MINERU_API_BASE_URL, "https://mineru.net/api/v4");
export const MINERU_API_TOKEN = process.env.MINERU_API_TOKEN?.trim() ?? "";
export const MINERU_API_MODEL_VERSION = readEnvOrDefault(process.env.MINERU_API_MODEL_VERSION, "vlm");
export const MINERU_API_POLL_INTERVAL_MS = readEnvNumber(process.env.MINERU_API_POLL_INTERVAL_MS, 2000);
export const MINERU_API_TIMEOUT_MS = readEnvNumber(process.env.MINERU_API_TIMEOUT_MS, 10 * 60 * 1000);
export const MINERU_API_ENABLE_FORMULA = readEnvBool(process.env.MINERU_API_ENABLE_FORMULA, true);
export const MINERU_API_ENABLE_TABLE = readEnvBool(process.env.MINERU_API_ENABLE_TABLE, true);
export const MINERU_API_IS_OCR = readEnvBool(process.env.MINERU_API_IS_OCR, false);
export const MINERU_API_LANGUAGE = process.env.MINERU_API_LANGUAGE?.trim() ?? "";

export const llmConfig = {
  baseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
  model: process.env.LLM_MODEL ?? "gpt-4o-mini",
  apiKey: process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
};

export const searchConfig = {
  tavilyApiKey: process.env.TAVILY_API_KEY ?? "",
};

export const obsidianExportDir =
  process.env.OBSIDIAN_EXPORT_DIR ?? path.join(NOTE_ROOT, "obsidian");
