#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";

const root = process.cwd();
const dbPath = path.join(root, "storage", "db.json");

function safeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toBlocksFromSections(sections) {
  const blocks = [];
  let order = 0;
  let lastHeading = "";

  for (const section of sections) {
    const heading = safeText(section?.title);
    const english = safeText(section?.english);
    const chinese = safeText(section?.chinese);
    const page = Number(section?.page) || 1;
    if (heading && heading !== lastHeading) {
      order += 1;
      blocks.push({
        id: `block-${order}`,
        type: "heading",
        page,
        order,
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
      page,
      order,
      english,
      chinese: chinese || undefined,
    });
  }
  return blocks;
}

async function main() {
  const raw = JSON.parse(await fs.readFile(dbPath, "utf8"));
  const papers = Array.isArray(raw.papers) ? raw.papers : [];
  let migrated = 0;
  let failed = 0;

  for (const paper of papers) {
    if (Array.isArray(paper.blocks) && Array.isArray(paper.assets)) {
      continue;
    }
    try {
      const sections = Array.isArray(paper.sections) ? paper.sections : [];
      const blocks = toBlocksFromSections(sections);
      if (!blocks.length) {
        throw new Error("no blocks");
      }
      paper.blocks = blocks;
      paper.assets = [];
      paper.text = blocks.filter((item) => item.type === "text" || item.type === "heading").map((item) => item.english).join("\n\n");
      paper.updatedAt = new Date().toISOString();
      delete paper.sections;
      delete paper.images;
      delete paper.imageTextNotes;
      migrated += 1;
    } catch {
      paper.status = "error";
      paper.blocks = [];
      paper.assets = [];
      paper.parseError = "历史数据迁移失败，请重新上传该论文。";
      paper.updatedAt = new Date().toISOString();
      failed += 1;
    }
  }

  await fs.writeFile(dbPath, JSON.stringify({ papers }, null, 2), "utf8");
  console.log(`migration complete: migrated=${migrated}, failed=${failed}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
