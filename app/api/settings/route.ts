import { NextResponse } from "next/server";

import { readAppSettings, writeAppSettings } from "@/lib/settings";

export async function GET() {
  const settings = await readAppSettings();
  return NextResponse.json(settings);
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Partial<{
      llmBaseUrl: string;
      llmModel: string;
      llmApiKey: string;
      obsidianExportDir: string;
      mineruApiToken: string;
    }>;

    const saved = await writeAppSettings({
      llmBaseUrl: typeof body.llmBaseUrl === "string" ? body.llmBaseUrl : undefined,
      llmModel: typeof body.llmModel === "string" ? body.llmModel : undefined,
      llmApiKey: typeof body.llmApiKey === "string" ? body.llmApiKey : undefined,
      obsidianExportDir: typeof body.obsidianExportDir === "string" ? body.obsidianExportDir : undefined,
      mineruApiToken: typeof body.mineruApiToken === "string" ? body.mineruApiToken : undefined,
    });
    return NextResponse.json(saved);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存设置失败" },
      { status: 400 },
    );
  }
}
