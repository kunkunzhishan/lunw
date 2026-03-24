import { promises as fs } from "fs";

import {
  MINERU_API_TOKEN,
  SETTINGS_PATH,
  STORAGE_ROOT,
  llmConfig,
  obsidianExportDir,
} from "@/lib/config";

export interface AppSettings {
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
  obsidianExportDir: string;
  mineruApiToken: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  llmBaseUrl: llmConfig.baseUrl,
  llmModel: llmConfig.model,
  llmApiKey: llmConfig.apiKey,
  obsidianExportDir,
  mineruApiToken: MINERU_API_TOKEN,
};

function normalizeSetting(value: unknown, fallback: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || fallback;
}

function normalizeSettings(raw: Partial<AppSettings> | null | undefined): AppSettings {
  return {
    llmBaseUrl: normalizeSetting(raw?.llmBaseUrl, DEFAULT_SETTINGS.llmBaseUrl),
    llmModel: normalizeSetting(raw?.llmModel, DEFAULT_SETTINGS.llmModel),
    llmApiKey: normalizeSetting(raw?.llmApiKey, DEFAULT_SETTINGS.llmApiKey),
    obsidianExportDir: normalizeSetting(raw?.obsidianExportDir, DEFAULT_SETTINGS.obsidianExportDir),
    mineruApiToken: normalizeSetting(raw?.mineruApiToken, DEFAULT_SETTINGS.mineruApiToken),
  };
}

async function ensureSettingsFile() {
  await fs.mkdir(STORAGE_ROOT, { recursive: true });
  try {
    await fs.access(SETTINGS_PATH);
  } catch {
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2), "utf8");
  }
}

export async function readAppSettings() {
  await ensureSettingsFile();

  try {
    const raw = await fs.readFile(SETTINGS_PATH, "utf8");
    const parsed = raw.trim() ? (JSON.parse(raw) as Partial<AppSettings>) : {};
    const normalized = normalizeSettings(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await fs.writeFile(SETTINGS_PATH, JSON.stringify(normalized, null, 2), "utf8");
    }
    return normalized;
  } catch {
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2), "utf8");
    return DEFAULT_SETTINGS;
  }
}

export async function writeAppSettings(next: Partial<AppSettings>) {
  const current = await readAppSettings();
  const patch: Partial<AppSettings> = {};
  for (const [key, value] of Object.entries(next) as [keyof AppSettings, string | undefined][]) {
    if (typeof value === "string") {
      patch[key] = value;
    }
  }
  const merged = normalizeSettings({
    ...current,
    ...patch,
  });
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}
