import { execFile } from "child_process";
import { promisify } from "util";

import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "目录选择失败";
}

export async function POST() {
  if (process.platform !== "darwin") {
    return NextResponse.json(
      { error: "当前系统暂不支持弹窗选择目录，请手动填写路径。" },
      { status: 501 },
    );
  }

  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      'POSIX path of (choose folder with prompt "请选择导出目录")',
    ]);

    const directory = stdout.trim();
    if (!directory) {
      return NextResponse.json({ error: "未获取到目录路径，请重试。" }, { status: 500 });
    }

    return NextResponse.json({ directory });
  } catch (error) {
    const message = getErrorMessage(error);
    if (/user canceled/i.test(message)) {
      return NextResponse.json({ canceled: true });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
