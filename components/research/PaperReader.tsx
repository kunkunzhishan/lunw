"use client";

import React, { useMemo } from "react";
import { BookOpen, ImageIcon, Sigma, Table2 } from "lucide-react";
import katex from "katex";

import type { PaperBlock, PaperRecord, TextPaperBlock } from "@/lib/types";

function FormulaView({
  latex,
  fallbackSrc,
}: {
  latex?: string;
  fallbackSrc?: string;
}) {
  const rendered = useMemo(() => {
    if (!latex?.trim()) {
      return null;
    }
    try {
      return katex.renderToString(latex, {
        displayMode: true,
        throwOnError: false,
        strict: "ignore",
      });
    } catch {
      return null;
    }
  }, [latex]);

  if (rendered) {
    return (
      <div
        className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4"
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    );
  }

  if (fallbackSrc) {
    return (
      <img
        alt="formula"
        className="mx-auto max-h-[360px] rounded-xl border border-slate-200 bg-white object-contain"
        src={fallbackSrc}
      />
    );
  }

  return <div className="text-sm text-red-600">公式渲染失败，且缺少公式图资产。</div>;
}

function BlockCard({
  block,
  paperId,
}: {
  block: PaperBlock;
  paperId: string;
}) {
  const assetSrc = "assetId" in block && block.assetId
    ? `/api/papers/${paperId}/assets/${block.assetId}`
    : undefined;

  if (block.type === "heading" || block.type === "text") {
    const titleClass = block.type === "heading" ? "text-[1.5rem] font-semibold leading-10 text-slate-900" : "text-[1.12rem] leading-8 text-slate-900";
    return (
      <article className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
        <p className={titleClass}>{block.english}</p>
        <p className="mt-3 border-l-2 border-teal-300 pl-3 text-[1.12rem] leading-8 text-slate-800">
          {block.chinese?.trim() || "点击顶部“对照翻译”生成中文。"}
        </p>
      </article>
    );
  }

  if (block.type === "formula") {
    return (
      <article className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-600">
          <Sigma size={16} />
          <span>公式</span>
        </div>
        <FormulaView latex={block.latex} fallbackSrc={assetSrc} />
      </article>
    );
  }

  if (block.type === "table") {
    return (
      <article className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-600">
          <Table2 size={16} />
          <span>表格</span>
        </div>
        <img
          alt={block.english || "table"}
          className="w-full rounded-xl border border-slate-200 bg-white object-contain"
          src={assetSrc}
        />
        {block.english ? <p className="mt-2 text-sm text-slate-600">{block.english}</p> : null}
      </article>
    );
  }

  return (
    <article className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-600">
        <ImageIcon size={16} />
        <span>图片</span>
      </div>
      <img
        alt={block.english || "image"}
        className="w-full rounded-xl border border-slate-200 bg-white object-contain"
        src={assetSrc}
      />
      {block.english ? <p className="mt-2 text-sm text-slate-600">{block.english}</p> : null}
    </article>
  );
}

export const PaperReader = ({
  paper,
  blocks,
  searchQuery,
}: {
  paper: PaperRecord;
  blocks: PaperBlock[];
  searchQuery: string;
}) => {
  const textBlocks = paper.blocks.filter(
    (block): block is TextPaperBlock => block.type === "text" || block.type === "heading",
  );
  const translatedCount = textBlocks.filter((block) => block.chinese?.trim()).length;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-100 px-8 py-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
            <div className="flex items-center gap-2">
              <BookOpen size={16} />
              <span>{paper.title}</span>
            </div>
            <div>单页连读：英文块后紧跟中文</div>
            <div>
              已翻译 {translatedCount}/{textBlocks.length} 块
            </div>
          </div>
        </div>

        {searchQuery ? (
          <div className="rounded-2xl border border-teal-200 bg-teal-50 px-5 py-3 text-sm text-teal-800">
            正在过滤关键词 “{searchQuery}”。
          </div>
        ) : null}

        {blocks.length ? (
          <div className="space-y-4 pb-12">
            {blocks.map((block) => (
              <BlockCard block={block} key={block.id} paperId={paper.id} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
            没有可显示内容，请检查解析结果。
          </div>
        )}
      </div>
    </div>
  );
};
