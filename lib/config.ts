import path from "path";

export const APP_ROOT = process.cwd();
export const STORAGE_ROOT = path.join(APP_ROOT, "storage");
export const PDF_ROOT = path.join(STORAGE_ROOT, "papers");
export const PAPER_ASSET_ROOT = path.join(STORAGE_ROOT, "paper-assets");
export const MINERU_OUTPUT_ROOT = path.join(STORAGE_ROOT, "mineru-output");
export const NOTE_ROOT = path.join(STORAGE_ROOT, "notes");
export const DB_PATH = path.join(STORAGE_ROOT, "db.json");

function readEnvOrDefault(value: string | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

export const MINERU_CLI = readEnvOrDefault(
  process.env.MINERU_CLI_PATH,
  path.join(APP_ROOT, ".venv-mineru", "bin", "mineru"),
);

export const MINERU_DEVICE = readEnvOrDefault(process.env.MINERU_DEVICE, "mps");
export const MINERU_SOURCE = readEnvOrDefault(process.env.MINERU_SOURCE, "huggingface");

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
