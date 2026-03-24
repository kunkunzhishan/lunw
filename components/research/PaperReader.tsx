"use client";

import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, ImageIcon, Quote, Sigma, Table2, StickyNote, X } from "lucide-react";
import katex from "katex";

import type { AssetPaperBlock, PaperAnnotation, PaperBlock, PaperRecord, TextPaperBlock } from "@/lib/types";

interface InlineMathSegment {
  type: "text" | "math";
  value: string;
  displayMode?: boolean;
}

function parseInlineMathSegments(input: string): InlineMathSegment[] {
  const segments: InlineMathSegment[] = [];
  const pattern = /\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$/g;
  let lastIndex = 0;

  for (const match of input.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", value: input.slice(lastIndex, index) });
    }

    const blockDollar = match[1];
    const inlineParen = match[2];
    const blockBracket = match[3];
    const inlineDollar = match[4];
    const mathValue = (blockDollar ?? inlineParen ?? blockBracket ?? inlineDollar ?? "").trim();

    if (mathValue) {
      segments.push({
        type: "math",
        value: mathValue,
        displayMode: Boolean(blockDollar || blockBracket),
      });
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < input.length) {
    segments.push({ type: "text", value: input.slice(lastIndex) });
  }

  return segments.length ? segments : [{ type: "text", value: input }];
}

function normalizeCaptionText(input: string) {
  const normalized = input
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .replace(/\$\s+/g, "$")
    .replace(/\s+\$/g, "$")
    .trim();

  const primaryPattern = /\b(?:Figure|Fig\.?|Table)\s*\d+\s*[:.]\s*[^.?!。！？]+[.?!。！？]?/i;
  const primary = normalized.match(primaryPattern)?.[0]?.trim();
  const mathNoiseCount = (normalized.match(/[\\{}$]/g) ?? []).length;
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;

  if (primary && (mathNoiseCount >= 14 || tokenCount > 48 || normalized.length > 280)) {
    return primary;
  }

  return normalized;
}

type ParentheticalStyle = "numericCitation" | "authorCitation" | "aside" | "enumeration";

interface CitationTextSegment {
  type: "text" | "citation";
  value: string;
  style?: ParentheticalStyle;
}

function insertEnumerationLineBreaks(input: string) {
  const markerPattern = /(?:\(\d{1,2}\)|（\d{1,2}）)/g;
  const markerCount = (input.match(markerPattern) ?? []).length;
  if (markerCount < 2) {
    return input;
  }

  return input
    .replace(/\s*(\(\d{1,2}\)|（\d{1,2}）)\s*/g, "\n$1 ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function isEnumeratedSentence(value: string) {
  return /^(\(\d{1,2}\)|（\d{1,2}）)\s*/.test(value.trim());
}

function classifyCitationStyle(parenthesized: string): ParentheticalStyle | null {
  const normalized = parenthesized.trim();
  const inner = normalized.startsWith("（")
    ? normalized.slice(1, -1).trim()
    : normalized.slice(1, -1).trim();
  if (!inner) {
    return null;
  }

  if (/^\d{1,2}$/.test(inner)) {
    return "enumeration";
  }

  if (/^\d{1,3}(?:\s*[-,]\s*\d{1,3})*$/.test(inner)) {
    return "numericCitation";
  }

  const hasYear = /(?:19|20)\d{2}[a-z]?/i.test(inner);
  const hasAuthorHint = /\bet al\.?\b|[A-Z][a-z]+/i.test(inner);
  const hasCitationDelimiter = inner.includes(";") || inner.includes(",");

  if (hasYear && (hasAuthorHint || hasCitationDelimiter)) {
    return "authorCitation";
  }

  if (inner.length <= 72 && !/[\\{}$]/.test(inner)) {
    return "aside";
  }

  return null;
}

function splitCitationText(input: string): CitationTextSegment[] {
  const segments: CitationTextSegment[] = [];
  const pattern = /(?:\([^()\n]{1,160}\)|（[^（）\n]{1,160}）)/g;
  let lastIndex = 0;

  for (const match of input.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", value: input.slice(lastIndex, index) });
    }

    const value = match[0];
    const style = classifyCitationStyle(value);
    if (style) {
      segments.push({ type: "citation", value, style });
    } else {
      segments.push({ type: "text", value });
    }

    lastIndex = index + value.length;
  }

  if (lastIndex < input.length) {
    segments.push({ type: "text", value: input.slice(lastIndex) });
  }

  return segments.length ? segments : [{ type: "text", value: input }];
}

function renderPlainTextWithEmphasis(input: string, keyPrefix: string) {
  const renderAllCaps = (text: string, prefix: string) => {
    const nodes: React.ReactNode[] = [];
    const pattern = /\b[A-Z][A-Z0-9]{1,}\b/g;
    let lastIndex = 0;
    let index = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      if (start > lastIndex) {
        nodes.push(<React.Fragment key={`${prefix}-plain-${index}`}>{text.slice(lastIndex, start)}</React.Fragment>);
      }
      nodes.push(
        <strong className="font-semibold text-slate-900" key={`${prefix}-caps-${index}`}>
          {match[0]}
        </strong>,
      );
      lastIndex = start + match[0].length;
      index += 1;
    }
    if (lastIndex < text.length) {
      nodes.push(<React.Fragment key={`${prefix}-tail`}>{text.slice(lastIndex)}</React.Fragment>);
    }
    return nodes.length ? nodes : [<React.Fragment key={`${prefix}-single`}>{text}</React.Fragment>];
  };

  const nodes: React.ReactNode[] = [];
  let remaining = input;

  const leadMatch = remaining.match(/^(\s*[^:\n]{8,96}:)(\s*)/);
  if (leadMatch) {
    nodes.push(
      <strong className="font-semibold text-slate-900" key={`${keyPrefix}-lead`}>
        {leadMatch[1]}
      </strong>,
    );
    if (leadMatch[2]) {
      nodes.push(<React.Fragment key={`${keyPrefix}-lead-space`}>{leadMatch[2]}</React.Fragment>);
    }
    remaining = remaining.slice(leadMatch[0].length);
  }

  const markerPattern =
    /\b(?:however|therefore|notably|importantly|in summary|in conclusion)\b|(?:值得注意的是|重要的是|总之|核心问题是)/gi;
  let lastIndex = 0;
  let matchIndex = 0;

  for (const match of remaining.matchAll(markerPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(...renderAllCaps(remaining.slice(lastIndex, index), `${keyPrefix}-text-${matchIndex}`));
    }
    nodes.push(
      <strong className="font-semibold text-slate-800" key={`${keyPrefix}-mark-${matchIndex}`}>
        {match[0]}
      </strong>,
    );
    lastIndex = index + match[0].length;
    matchIndex += 1;
  }

  if (lastIndex < remaining.length) {
    nodes.push(...renderAllCaps(remaining.slice(lastIndex), `${keyPrefix}-tail`));
  }

  return nodes.length ? nodes : renderAllCaps(input, `${keyPrefix}-plain`);
}

function renderPlainTextWithCitationStyle(input: string, keyPrefix: string) {
  return splitCitationText(input).map((segment, index) => {
    if (segment.type === "text") {
      return (
        <React.Fragment key={`${keyPrefix}-text-${index}`}>
          {renderPlainTextWithEmphasis(segment.value, `${keyPrefix}-em-${index}`)}
        </React.Fragment>
      );
    }

    if (segment.style === "numericCitation") {
      return (
        <span className="align-super text-[0.72em] text-slate-400" key={`${keyPrefix}-citation-${index}`}>
          {segment.value}
        </span>
      );
    }

    if (segment.style === "enumeration") {
      return (
        <span className="mx-0.5 inline-block text-[0.96em] font-semibold text-slate-700" key={`${keyPrefix}-citation-${index}`}>
          {segment.value}
        </span>
      );
    }

    if (segment.style === "aside") {
      return (
        <span className="text-[0.92em] italic text-slate-500" key={`${keyPrefix}-citation-${index}`}>
          {segment.value}
        </span>
      );
    }

    return (
      <span className="text-[0.9em] text-slate-400" key={`${keyPrefix}-citation-${index}`}>
        {segment.value}
      </span>
    );
  });
}

function renderRichNodes(text: string, keyPrefix: string) {
  const normalizedText = insertEnumerationLineBreaks(text);
  const segments = parseInlineMathSegments(normalizedText);
  const nodes: React.ReactNode[] = [];

  for (const [index, segment] of segments.entries()) {
    if (segment.type === "text") {
      nodes.push(...renderPlainTextWithCitationStyle(segment.value, `${keyPrefix}-plain-${index}`));
      continue;
    }

    try {
      const rendered = katex.renderToString(segment.value, {
        displayMode: segment.displayMode ?? false,
        throwOnError: false,
        strict: "ignore",
      });
      nodes.push(
        <span
          className={`inline-math ${segment.displayMode ? "inline-math-display" : ""}`}
          dangerouslySetInnerHTML={{ __html: rendered }}
          key={`${keyPrefix}-math-${index}`}
        />,
      );
    } catch {
      nodes.push(<React.Fragment key={`${keyPrefix}-math-fallback-${index}`}>{segment.value}</React.Fragment>);
    }
  }

  return nodes;
}

function RichText({
  className,
  text,
}: {
  className: string;
  text: string;
}) {
  const nodes = useMemo(() => renderRichNodes(text, "rich"), [text]);

  return (
    <p className={`${className} whitespace-pre-wrap`}>
      {nodes}
    </p>
  );
}

function FormulaView({
  latex,
  fallbackSrc,
}: {
  latex?: string;
  fallbackSrc?: string;
}) {
  const normalizedLatex = useMemo(() => {
    const raw = latex?.trim();
    if (!raw) {
      return "";
    }

    if (raw.startsWith("$$") && raw.endsWith("$$") && raw.length > 4) {
      return raw.slice(2, -2).trim();
    }
    if (raw.startsWith("\\[") && raw.endsWith("\\]") && raw.length > 4) {
      return raw.slice(2, -2).trim();
    }
    return raw;
  }, [latex]);

  const rendered = useMemo(() => {
    if (!normalizedLatex) {
      return null;
    }
    try {
      return katex.renderToString(normalizedLatex, {
        displayMode: true,
        throwOnError: false,
        strict: "ignore",
      });
    } catch {
      return null;
    }
  }, [normalizedLatex]);

  if (rendered) {
    return (
      <div
        className="formula-readable overflow-x-auto rounded-xl border border-slate-200 bg-white px-4 py-5"
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    );
  }

  if (fallbackSrc) {
    return (
      <img
        alt="formula"
        className="mx-auto max-h-[520px] w-auto max-w-full rounded-xl border border-slate-200 bg-white object-contain"
        src={fallbackSrc}
      />
    );
  }

  return <div className="text-sm text-red-600">公式渲染失败，且缺少公式图资产。</div>;
}

function extractFormulaVariables(latex: string) {
  const cleaned = latex
    .replace(/\\(mathrm|text|operatorname)\{([^}]*)\}/g, "$2")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}^_]/g, " ");
  const rawTokens = cleaned.match(/[A-Za-z][A-Za-z0-9]*/g) ?? [];
  const deduped = Array.from(
    new Set(
      rawTokens
        .map((token) => token.trim())
        .filter((token) => token.length >= 1 && token.length <= 12),
    ),
  );
  return deduped.slice(0, 4);
}

function buildFormulaPlainExplanation(latex?: string) {
  const normalized = latex?.trim();
  if (!normalized) {
    return null;
  }

  const signals: string[] = [];
  const hasArgmax = /\\argmax|argmax/i.test(normalized);
  const hasArgmin = /\\argmin|argmin/i.test(normalized);
  const hasEquality = /=/.test(normalized);
  const hasInequality = /<=|>=|<|>|\\leq|\\geq/.test(normalized);
  const hasArrow = /\\to|\\rightarrow|→/.test(normalized);
  const hasSum = /\\sum/.test(normalized);
  const hasIntegral = /\\int/.test(normalized);
  const hasProduct = /\\prod/.test(normalized);
  const hasFraction = /\\frac/.test(normalized);
  const hasNorm = /\\lVert|\\rVert|\|\|/.test(normalized);
  const hasProbability = /\\Pr|P\(|p\(/.test(normalized);
  const hasLogExp = /\\log|\\ln|\\exp/.test(normalized);
  const hasPower = /(?:\^\{[^}]+\}|\^[A-Za-z0-9])/.test(normalized);

  if (hasArgmax) {
    signals.push("在做“最大化”优化，目标是找到让函数值最大的变量");
  } else if (hasArgmin) {
    signals.push("在做“最小化”优化，目标是找到让函数值最小的变量");
  } else if (hasEquality) {
    signals.push("在定义或计算左侧变量，右侧是它的组成方式");
  } else if (hasInequality) {
    signals.push("在表达变量之间的大小约束关系");
  } else if (hasArrow) {
    signals.push("在描述状态/变量从一侧到另一侧的映射或更新");
  } else {
    signals.push("在描述几个变量之间的数学关系");
  }

  if (hasSum || hasIntegral || hasProduct) {
    const aggregateParts: string[] = [];
    if (hasSum) {
      aggregateParts.push("求和");
    }
    if (hasIntegral) {
      aggregateParts.push("积分");
    }
    if (hasProduct) {
      aggregateParts.push("连乘");
    }
    signals.push(`包含${aggregateParts.join(" / ")}，表示把多项信息汇总`);
  }

  if (hasFraction) {
    signals.push("有分式结构，通常表示比例或归一化");
  }
  if (hasNorm) {
    signals.push("含有范数项，常用于衡量误差或距离");
  }
  if (hasProbability) {
    signals.push("带有概率表达，用于建模不确定性");
  }
  if (hasLogExp) {
    signals.push("使用了对数/指数变换，强调尺度变化");
  }
  if (hasPower) {
    signals.push("包含幂次项，体现非线性影响");
  }

  const variableHint = extractFormulaVariables(normalized);
  if (variableHint.length) {
    signals.push(`关注变量：${variableHint.join("、")}`);
  }

  return `白话：${signals.slice(0, 3).join("；")}。`;
}

interface AnnotationThread {
  threadId: string;
  blockId: string;
  quoteText?: string;
  quoteStart?: number;
  quoteEnd?: number;
  comments: PaperAnnotation[];
}

function normalizeComparableText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

interface SentenceChunk {
  text: string;
  start: number;
  end: number;
}

function splitSentences(text: string): SentenceChunk[] {
  return insertEnumerationLineBreaks(text)
    .split(/\n+|(?<=[。！？!?\.])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((sentence, index, list) => {
      const withTrailingSpace = `${sentence}${index < list.length - 1 ? " " : ""}`;
      return withTrailingSpace;
    })
    .reduce<{ chunks: SentenceChunk[]; cursor: number }>((state, sentence) => {
      const normalized = sentence.trim();
      if (!normalized) {
        return state;
      }
      let start = text.indexOf(normalized, state.cursor);
      if (start < 0) {
        start = text.indexOf(normalized);
      }
      if (start < 0) {
        start = state.cursor;
      }
      const end = start + normalized.length;
      state.chunks.push({
        text: sentence,
        start,
        end,
      });
      state.cursor = Math.max(end, state.cursor);
      return state;
    }, { chunks: [], cursor: 0 }).chunks;
}

function findQuoteRange(blockText: string, selectedText: string) {
  const raw = selectedText.trim();
  if (!raw) {
    return undefined;
  }
  const direct = blockText.indexOf(raw);
  if (direct >= 0) {
    return { start: direct, end: direct + raw.length };
  }

  const normalizeWithMap = (value: string) => {
    const chars: string[] = [];
    const map: number[] = [];
    let lastWasSpace = false;
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (/\s/.test(char)) {
        if (!lastWasSpace) {
          chars.push(" ");
          map.push(index);
          lastWasSpace = true;
        }
      } else {
        chars.push(char);
        map.push(index);
        lastWasSpace = false;
      }
    }
    return {
      normalized: chars.join("").trim(),
      map,
    };
  };

  const blockNormalized = normalizeWithMap(blockText);
  const targetNormalized = normalizeWithMap(raw).normalized;
  if (!targetNormalized) {
    return undefined;
  }
  const normalizedStart = blockNormalized.normalized.indexOf(targetNormalized);
  if (normalizedStart < 0) {
    return undefined;
  }
  const normalizedEnd = normalizedStart + targetNormalized.length - 1;
  const start = blockNormalized.map[normalizedStart];
  const end = blockNormalized.map[normalizedEnd] + 1;
  if (start === undefined || end === undefined || start >= end) {
    return undefined;
  }
  return { start, end };
}

function BlockCard({
  annotationThreads,
  hiddenThreadIds,
  block,
  onAddAnnotation,
  onHideThread,
  onOpenVisual,
  onRemoveAnnotation,
  onRestoreHiddenThreads,
  paperId,
  onOpenQuoteMenu,
  reserveCommentSpace,
}: {
  annotationThreads?: AnnotationThread[];
  block: PaperBlock;
  hiddenThreadIds: Set<string>;
  onAddAnnotation?: (params: {
    block: TextPaperBlock;
    content: string;
    quoteText?: string;
    quoteStart?: number;
    quoteEnd?: number;
    threadId?: string;
  }) => void;
  onHideThread?: (threadId: string) => void;
  onOpenVisual?: (block: AssetPaperBlock) => void;
  onRemoveAnnotation?: (annotationId: string) => void;
  onRestoreHiddenThreads?: (threadIds: string[]) => void;
  paperId: string;
  onOpenQuoteMenu?: (block: TextPaperBlock, position: {
    x: number;
    y: number;
    quoteText?: string;
    quoteStart?: number;
    quoteEnd?: number;
  }) => void;
  reserveCommentSpace?: boolean;
}) {
  const [replyThreadId, setReplyThreadId] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const assetSrc = "assetId" in block && block.assetId
    ? `/api/papers/${paperId}/assets/${block.assetId}`
    : undefined;

  if (block.type === "heading" || block.type === "text") {
    const titleClass = block.type === "heading"
      ? "paper-reading-english text-[1.6rem] font-semibold leading-10 text-slate-900"
      : "paper-reading-english text-[1.14rem] leading-9 text-slate-900";

    const sentenceChunks = block.type === "text"
      ? splitSentences(block.english)
      : [{ text: block.english, start: 0, end: block.english.length }];
    const threads = annotationThreads ?? [];
    const visibleThreads = threads.filter((thread) => !hiddenThreadIds.has(thread.threadId));
    const hasVisibleAnnotationThreads = visibleThreads.length > 0;
    const shouldReserveCommentSpace = Boolean(reserveCommentSpace && hasVisibleAnnotationThreads);

    return (
      <article
        className={block.type === "heading" ? "pt-4" : ""}
        onContextMenu={(event) => {
          if (!onOpenQuoteMenu) {
            return;
          }
          event.preventDefault();
          const selection = window.getSelection();
          const selectedText = selection?.toString().trim();
          const quoteText = selectedText && selectedText.length <= 400 ? selectedText : undefined;
          const quoteRange = quoteText ? findQuoteRange(block.english, quoteText) : undefined;
          onOpenQuoteMenu(block, {
            x: event.clientX,
            y: event.clientY,
            quoteText,
            quoteStart: quoteRange?.start,
            quoteEnd: quoteRange?.end,
          });
        }}
      >
        <div
          className={
            shouldReserveCommentSpace
              ? "grid gap-4 xl:grid-cols-[minmax(0,856px)_260px] xl:justify-center"
              : "block"
          }
        >
          <div className="min-w-0">
            {block.type === "heading" ? (
              <RichText className={titleClass} text={block.english} />
            ) : (
              <p className={`${titleClass} whitespace-pre-wrap`}>
                {sentenceChunks.map((sentenceChunk, index) => {
                  const sentence = sentenceChunk.text;
                  const normalizedSentence = normalizeComparableText(sentence);
                  const relatedThreadIds = threads
                    .filter((thread) => {
                      if (thread.quoteStart !== undefined && thread.quoteEnd !== undefined) {
                        return thread.quoteStart < sentenceChunk.end && thread.quoteEnd > sentenceChunk.start;
                      }
                      const quote = normalizeComparableText(thread.quoteText ?? "");
                      if (!quote || !normalizedSentence) {
                        return false;
                      }
                      return normalizedSentence.includes(quote) || quote.includes(normalizedSentence);
                    })
                    .map((thread) => thread.threadId);
                  const linkedToComment = relatedThreadIds.length > 0;
                  const hasHiddenRelated = relatedThreadIds.some((threadId) => hiddenThreadIds.has(threadId));
                  const enumerated = isEnumeratedSentence(sentence);
                  return (
                    <span
                      key={`${block.id}-sentence-${index}`}
                      className={`${
                        linkedToComment ? "bg-amber-50/80 ring-1 ring-amber-200" : ""
                      } ${enumerated ? "my-1 block" : ""} ${hasHiddenRelated ? "cursor-pointer" : ""}`}
                      onDoubleClick={() => {
                        if (!hasHiddenRelated || !onRestoreHiddenThreads) {
                          return;
                        }
                        onRestoreHiddenThreads(relatedThreadIds);
                      }}
                    >
                      {renderRichNodes(sentence, `${block.id}-sentence-${index}`)}
                    </span>
                  );
                })}
              </p>
            )}

            {block.chinese?.trim() ? (
              <RichText
                className="paper-reading-chinese mt-2 border-l-2 border-teal-200 pl-3 text-[1.03rem] leading-8 text-slate-700"
                text={block.chinese}
              />
            ) : null}
          </div>

          {hasVisibleAnnotationThreads ? (
            <aside className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/80 p-3 xl:sticky xl:top-8">
              <div className="flex items-center gap-1 text-xs font-semibold text-amber-700">
                <StickyNote size={13} />
                <span>批注</span>
              </div>

              {visibleThreads.map((thread) => (
                <div
                  key={thread.threadId}
                  className="rounded-lg border border-amber-200 bg-white/90 p-2 text-xs text-slate-700"
                  onDoubleClick={() => {
                    setReplyThreadId(thread.threadId);
                    setReplyContent("");
                  }}
                >
                  <div className="space-y-2">
                    {thread.comments.map((annotation) => (
                      <div key={annotation.id} className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
                        <div className="mb-1 whitespace-pre-wrap leading-5">{annotation.content}</div>
                        <div className="flex items-center justify-between text-[10px] text-slate-500">
                          <span>{new Date(annotation.createdAt).toLocaleString()}</span>
                          <span className="inline-flex items-center gap-2">
                            {onHideThread ? (
                              <button
                                type="button"
                                className="text-slate-500 hover:text-slate-700"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onHideThread(thread.threadId);
                                }}
                              >
                                隐藏
                              </button>
                            ) : null}
                            {onRemoveAnnotation ? (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 text-red-500 hover:text-red-600"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onRemoveAnnotation(annotation.id);
                                }}
                              >
                                <X size={12} />
                                删除
                              </button>
                            ) : null}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {replyThreadId === thread.threadId ? (
                    <div className="mt-2 space-y-2 rounded-md border border-teal-200 bg-teal-50 p-2">
                      <textarea
                        className="w-full rounded-md border border-teal-200 bg-white px-2 py-1.5 text-xs leading-5 outline-none"
                        placeholder="继续添加一条批注..."
                        rows={3}
                        value={replyContent}
                        onChange={(event) => setReplyContent(event.target.value)}
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-white"
                          onClick={() => {
                            setReplyThreadId(null);
                            setReplyContent("");
                          }}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className="rounded-md bg-teal-600 px-2 py-1 text-[11px] text-white hover:bg-teal-700 disabled:opacity-50"
                          disabled={!replyContent.trim()}
                          onClick={() => {
                            const normalized = replyContent.trim();
                            if (!normalized || !onAddAnnotation) {
                              return;
                            }
                            onAddAnnotation({
                              block,
                              content: normalized,
                              quoteText: thread.quoteText,
                              quoteStart: thread.quoteStart,
                              quoteEnd: thread.quoteEnd,
                              threadId: thread.threadId,
                            });
                            setReplyThreadId(null);
                            setReplyContent("");
                          }}
                        >
                          追加
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="mt-2 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                      onClick={() => {
                        setReplyThreadId(thread.threadId);
                        setReplyContent("");
                      }}
                    >
                      + 追加评论
                    </button>
                  )}
                </div>
              ))}
            </aside>
          ) : shouldReserveCommentSpace ? (
            <div className="hidden xl:block" />
          ) : null}
        </div>
      </article>
    );
  }

  if (block.type === "formula") {
    const plainExplanation = buildFormulaPlainExplanation(block.latex);
    return (
      <article className="my-4 rounded-2xl border border-slate-200 bg-slate-50/70 px-5 py-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-600">
          <Sigma size={16} />
          <span>公式</span>
        </div>
        <FormulaView latex={block.latex} fallbackSrc={assetSrc} />
        {plainExplanation ? (
          <p className="mt-3 rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2 text-[0.92rem] leading-7 text-slate-700">
            {plainExplanation}
          </p>
        ) : null}
      </article>
    );
  }

  if (block.type === "table") {
    return (
      <article className="my-4 rounded-2xl border border-slate-200 bg-slate-50/70 px-5 py-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-600">
          <Table2 size={16} />
          <span>表格</span>
        </div>
        <img
          alt={block.english || "table"}
          className="mx-auto max-h-[560px] w-auto max-w-full cursor-zoom-in rounded-xl border border-slate-200 bg-white object-contain"
          src={assetSrc}
          onClick={() => onOpenVisual?.(block as AssetPaperBlock)}
        />
        {block.english ? (
          <RichText
            className="mx-auto mt-2 max-w-3xl text-[0.78rem] italic leading-6 text-slate-500"
            text={normalizeCaptionText(block.english)}
          />
        ) : null}
      </article>
    );
  }

  const imageBlock = block as AssetPaperBlock;

  return (
    <article className="my-4 rounded-2xl border border-slate-200 bg-slate-50/70 px-5 py-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-600">
        <ImageIcon size={16} />
        <span>图片</span>
      </div>
      <img
        alt={imageBlock.english || "image"}
        className="mx-auto max-h-[420px] w-auto max-w-full cursor-zoom-in rounded-xl border border-slate-200 bg-white object-contain"
        src={imageBlock.assetId ? `/api/papers/${paperId}/assets/${imageBlock.assetId}` : undefined}
        onClick={() => onOpenVisual?.(imageBlock)}
      />
      {imageBlock.english ? (
        <RichText
          className="mx-auto mt-2 max-w-3xl text-[0.78rem] italic leading-6 text-slate-500"
          text={normalizeCaptionText(imageBlock.english)}
        />
      ) : null}
    </article>
  );
}

function mergeReadableText(blocks: PaperBlock[]) {
  const merged: PaperBlock[] = [];
  let pending: TextPaperBlock | null = null;

  const canonicalizeNoiseKey = (value: string) =>
    value
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\b\d+\b/g, "#")
      .replace(/[^\w#\s]/g, "")
      .trim();

  const textFrequency = new Map<string, number>();
  for (const block of blocks) {
    if (block.type !== "text" && block.type !== "heading") {
      continue;
    }
    const key = canonicalizeNoiseKey(block.english ?? "");
    if (!key) {
      continue;
    }
    textFrequency.set(key, (textFrequency.get(key) ?? 0) + 1);
  }

  const isNoiseText = (value: string, blockType: "text" | "heading") => {
    const text = value.trim();
    if (!text) {
      return true;
    }
    if (blockType === "heading") {
      return false;
    }
    if (/^\d{1,3}$/.test(text)) {
      return true;
    }
    if (/^preprint\.?$/i.test(text)) {
      return true;
    }
    if (/^arxiv:\S+/i.test(text)) {
      return true;
    }
    if (/^(?:figure|fig\.?|table)\s*\d+\b/i.test(text) && text.length <= 120) {
      return true;
    }
    if (/^(?:page|doi|isbn)\b[:\s]/i.test(text)) {
      return true;
    }
    if (/^(?:copyright|all rights reserved)\b/i.test(text)) {
      return true;
    }
    if (/^[A-Za-z]$/.test(text) || /^[A-Za-z]\)$/.test(text)) {
      return true;
    }
    if (/^[^\p{L}\p{N}]{3,}$/u.test(text)) {
      return true;
    }

    const symbolCount = (text.match(/[=~_^*`|\\{}[\]<>]/g) ?? []).length;
    const punctuationCount = (text.match(/[.,;:!?，。！？；：]/g) ?? []).length;
    const tokenCount = text.split(/\s+/).filter(Boolean).length;
    if (symbolCount >= 8 && punctuationCount <= 1 && tokenCount <= 20) {
      return true;
    }

    const key = canonicalizeNoiseKey(text);
    if (key && (textFrequency.get(key) ?? 0) >= 3 && text.length <= 90) {
      return true;
    }

    return false;
  };

  const flushPending = () => {
    if (pending) {
      merged.push(pending);
      pending = null;
    }
  };

  const shouldMerge = (left: TextPaperBlock, right: TextPaperBlock) => {
    if (left.type !== "text" || right.type !== "text") {
      return false;
    }
    if (left.page !== right.page) {
      return false;
    }
    const leftText = left.english.trim();
    const rightText = right.english.trim();
    if (!leftText || !rightText) {
      return false;
    }
    if (rightText.startsWith("•") || rightText.startsWith("-")) {
      return false;
    }
    if (/[。！？!?;；:]$/.test(leftText)) {
      return false;
    }
    return true;
  };

  const joinText = (left: string, right: string) => {
    const normalizedLeft = left.trimEnd();
    const normalizedRight = right.trim();
    if (!normalizedLeft) {
      return normalizedRight;
    }
    if (!normalizedRight) {
      return normalizedLeft;
    }
    if (normalizedRight.startsWith("•") || normalizedRight.startsWith("-")) {
      return `${normalizedLeft}\n${normalizedRight}`;
    }
    return `${normalizedLeft} ${normalizedRight}`;
  };

  for (const block of blocks) {
    if (block.type !== "text" && block.type !== "heading") {
      flushPending();
      merged.push(block);
      continue;
    }

    if (block.type === "heading") {
      flushPending();
      merged.push(block);
      continue;
    }

    if (isNoiseText(block.english, block.type)) {
      continue;
    }

    if (!pending) {
      pending = { ...block };
      continue;
    }

    if (shouldMerge(pending, block)) {
      pending = {
        ...pending,
        english: joinText(pending.english, block.english),
        chinese:
          pending.chinese?.trim() || block.chinese?.trim()
            ? joinText(pending.chinese ?? "", block.chinese ?? "")
            : undefined,
      };
      continue;
    }

    flushPending();
    pending = { ...block };
  }

  flushPending();
  return merged;
}

export const PaperReader = ({
  paper,
  blocks,
  searchQuery,
  quotedBlockIds,
  onAddAnnotation,
  onDeleteAnnotation,
  onQuoteBlock,
}: {
  paper: PaperRecord;
  blocks: PaperBlock[];
  searchQuery: string;
  quotedBlockIds?: string[];
  onAddAnnotation?: (params: {
    block: TextPaperBlock;
    content: string;
    quoteText?: string;
    quoteStart?: number;
    quoteEnd?: number;
    threadId?: string;
  }) => void;
  onDeleteAnnotation?: (annotationId: string) => void;
  onQuoteBlock?: (block: TextPaperBlock) => void;
}) => {
  const textBlocks = paper.blocks.filter(
    (block): block is TextPaperBlock => block.type === "text" || block.type === "heading",
  );
  const translatedCount = textBlocks.filter((block) => block.chinese?.trim()).length;
  const readingBlocks = useMemo(() => mergeReadableText(blocks), [blocks]);
  const quotedSet = useMemo(() => new Set(quotedBlockIds ?? []), [quotedBlockIds]);
  const annotationThreadsByBlock = useMemo(() => {
    const threadMap = new Map<string, AnnotationThread>();
    for (const annotation of paper.annotations) {
      const threadId = annotation.threadId || `thread-${annotation.id}`;
      const existing = threadMap.get(threadId);
      if (existing) {
        existing.comments.push(annotation);
        if (!existing.quoteText && annotation.quoteText) {
          existing.quoteText = annotation.quoteText;
        }
        if (existing.quoteStart === undefined && annotation.quoteStart !== undefined) {
          existing.quoteStart = annotation.quoteStart;
        }
        if (existing.quoteEnd === undefined && annotation.quoteEnd !== undefined) {
          existing.quoteEnd = annotation.quoteEnd;
        }
        continue;
      }
      threadMap.set(threadId, {
        threadId,
        blockId: annotation.blockId,
        quoteText: annotation.quoteText,
        quoteStart: annotation.quoteStart,
        quoteEnd: annotation.quoteEnd,
        comments: [annotation],
      });
    }

    const blockMap = new Map<string, AnnotationThread[]>();
    for (const thread of threadMap.values()) {
      thread.comments.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      const list = blockMap.get(thread.blockId) ?? [];
      list.push(thread);
      blockMap.set(thread.blockId, list);
    }

    for (const threads of blockMap.values()) {
      threads.sort((left, right) => {
        const leftTime = left.comments[0]?.createdAt ?? "";
        const rightTime = right.comments[0]?.createdAt ?? "";
        return leftTime.localeCompare(rightTime);
      });
    }

    return blockMap;
  }, [paper.annotations]);
  const [hiddenThreadIds, setHiddenThreadIds] = useState<string[]>([]);
  const hiddenThreadSet = useMemo(() => new Set(hiddenThreadIds), [hiddenThreadIds]);
  const hasAnyVisibleAnnotations = useMemo(
    () => paper.annotations.some((annotation) => !hiddenThreadSet.has(annotation.threadId || `thread-${annotation.id}`)),
    [hiddenThreadSet, paper.annotations],
  );
  const [contextMenu, setContextMenu] = useState<{
    block: TextPaperBlock;
    x: number;
    y: number;
    quoteText?: string;
    quoteStart?: number;
    quoteEnd?: number;
  } | null>(null);
  const [annotationComposer, setAnnotationComposer] = useState<{
    block: TextPaperBlock;
    x: number;
    y: number;
    quoteText?: string;
    quoteStart?: number;
    quoteEnd?: number;
    content: string;
  } | null>(null);
  const visualBlocks = useMemo(
    () =>
      readingBlocks.filter(
        (block): block is AssetPaperBlock => block.type === "image" || block.type === "table",
      ),
    [readingBlocks],
  );
  const [activeVisualId, setActiveVisualId] = useState<string | null>(null);
  const activeVisualIndex = useMemo(
    () => visualBlocks.findIndex((block) => block.id === activeVisualId),
    [activeVisualId, visualBlocks],
  );
  const activeVisual = activeVisualIndex >= 0 ? visualBlocks[activeVisualIndex] : null;

  useEffect(() => {
    setHiddenThreadIds([]);
    setActiveVisualId(null);
  }, [paper.id]);

  useEffect(() => {
    const handleWindowClick = () => {
      setContextMenu(null);
      setAnnotationComposer(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
        setAnnotationComposer(null);
        setActiveVisualId(null);
      }
      if (event.key === "ArrowRight" && activeVisual && visualBlocks.length > 1) {
        setActiveVisualId(visualBlocks[(activeVisualIndex + 1) % visualBlocks.length].id);
      }
      if (event.key === "ArrowLeft" && activeVisual && visualBlocks.length > 1) {
        const nextIndex = (activeVisualIndex - 1 + visualBlocks.length) % visualBlocks.length;
        setActiveVisualId(visualBlocks[nextIndex].id);
      }
    };

    window.addEventListener("click", handleWindowClick);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("scroll", handleWindowClick, true);

    return () => {
      window.removeEventListener("click", handleWindowClick);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("scroll", handleWindowClick, true);
    };
  }, [activeVisual, activeVisualIndex, visualBlocks]);

  return (
    <div className="flex-1 overflow-y-auto bg-gradient-to-b from-[#f6f3ec] via-[#f6f4ef] to-[#f3f0e8] px-6 py-8">
      <div
        className={`mx-auto rounded-3xl border border-[#e6dfd0] bg-[#fffdf8] shadow-[0_12px_28px_rgba(15,23,42,0.08)] ${
          hasAnyVisibleAnnotations ? "max-w-[1220px]" : "max-w-[920px]"
        }`}
      >
        <div className="border-b border-[#e9e2d5] px-6 py-4">
          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
            <div className="flex items-center gap-2">
              <BookOpen size={16} />
              <span>{paper.title}</span>
            </div>
            <div>连续阅读模式</div>
            <div>
              已翻译 {translatedCount}/{textBlocks.length} 块
            </div>
          </div>
        </div>

        {searchQuery ? (
          <div className="mx-6 mt-5 rounded-2xl border border-teal-200 bg-teal-50 px-5 py-3 text-sm text-teal-800">
            正在过滤关键词 “{searchQuery}”。
          </div>
        ) : null}

        {readingBlocks.length ? (
          <div className="space-y-5 px-8 pb-12 pt-6">
            {readingBlocks.map((block) => (
              <BlockCard
                block={block}
                key={block.id}
                onOpenQuoteMenu={(textBlock, position) => {
                  const menuWidth = 236;
                  const menuHeight = 120;
                  const x = Math.min(window.innerWidth - menuWidth, Math.max(8, position.x));
                  const y = Math.min(window.innerHeight - menuHeight, Math.max(8, position.y));
                  setContextMenu({
                    block: textBlock,
                    x,
                    y,
                    quoteText: position.quoteText,
                    quoteStart: position.quoteStart,
                    quoteEnd: position.quoteEnd,
                  });
                }}
                annotationThreads={annotationThreadsByBlock.get(block.id)}
                hiddenThreadIds={hiddenThreadSet}
                onAddAnnotation={onAddAnnotation}
                onHideThread={(threadId) =>
                  setHiddenThreadIds((current) => (current.includes(threadId) ? current : [...current, threadId]))
                }
                onOpenVisual={(visualBlock) => setActiveVisualId(visualBlock.id)}
                onRemoveAnnotation={onDeleteAnnotation}
                onRestoreHiddenThreads={(threadIds) =>
                  setHiddenThreadIds((current) => current.filter((threadId) => !threadIds.includes(threadId)))}
                paperId={paper.id}
                reserveCommentSpace={hasAnyVisibleAnnotations}
              />
            ))}
          </div>
        ) : (
          <div className="px-6 py-10 text-center text-sm text-slate-500">
            没有可显示内容，请检查解析结果。
          </div>
        )}
      </div>

      {contextMenu ? (
        <div
          className="fixed z-40 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              quotedSet.has(contextMenu.block.id)
                ? "cursor-not-allowed text-slate-400"
                : "text-slate-700 hover:bg-slate-100"
            }`}
            disabled={quotedSet.has(contextMenu.block.id)}
            onClick={() => {
              if (quotedSet.has(contextMenu.block.id) || !onQuoteBlock) {
                setContextMenu(null);
                return;
              }
              onQuoteBlock(contextMenu.block);
              setContextMenu(null);
            }}
          >
            <Quote size={14} />
            {quotedSet.has(contextMenu.block.id) ? "已在聊天上下文中" : "添加到聊天上下文"}
          </button>
          <button
            type="button"
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
            onClick={() => {
              setAnnotationComposer({
                block: contextMenu.block,
                x: contextMenu.x,
                y: contextMenu.y + 44,
                quoteText: contextMenu.quoteText,
                quoteStart: contextMenu.quoteStart,
                quoteEnd: contextMenu.quoteEnd,
                content: "",
              });
              setContextMenu(null);
            }}
          >
            <StickyNote size={14} />
            添加批注
          </button>
        </div>
      ) : null}

      {annotationComposer ? (
        <div
          className="fixed z-40 w-[320px] rounded-xl border border-teal-200 bg-white p-3 shadow-xl"
          style={{
            left: `${Math.min(window.innerWidth - 340, Math.max(8, annotationComposer.x))}px`,
            top: `${Math.min(window.innerHeight - 220, Math.max(8, annotationComposer.y))}px`,
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <textarea
            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm leading-6 outline-none"
            placeholder="输入批注内容..."
            rows={4}
            value={annotationComposer.content}
            onChange={(event) =>
              setAnnotationComposer((current) => (current ? { ...current, content: event.target.value } : current))}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              onClick={() => setAnnotationComposer(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-md bg-teal-600 px-2 py-1 text-xs text-white hover:bg-teal-700 disabled:opacity-50"
              disabled={!annotationComposer.content.trim()}
              onClick={() => {
                const normalized = annotationComposer.content.trim();
                if (!normalized || !onAddAnnotation) {
                  return;
                }
                onAddAnnotation({
                  block: annotationComposer.block,
                  content: normalized,
                  quoteText: annotationComposer.quoteText,
                  quoteStart: annotationComposer.quoteStart,
                  quoteEnd: annotationComposer.quoteEnd,
                });
                setAnnotationComposer(null);
              }}
            >
              添加
            </button>
          </div>
        </div>
      ) : null}

      {activeVisual ? (
        <div className="fixed inset-0 z-50 bg-slate-900/85">
          <button type="button" className="absolute inset-0 h-full w-full cursor-default" onClick={() => setActiveVisualId(null)} />
          <div className="absolute inset-0 flex items-center justify-center px-6 py-8">
            <div className="relative max-h-full w-full max-w-6xl rounded-2xl border border-slate-700 bg-slate-950/95 p-4 shadow-2xl">
              <div className="mb-3 flex items-center justify-between text-sm text-slate-200">
                <span>{activeVisual.type === "table" ? "表格" : "图片"} · P{activeVisual.page}</span>
                <button
                  type="button"
                  className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                  onClick={() => setActiveVisualId(null)}
                >
                  关闭
                </button>
              </div>
              <img
                alt={activeVisual.english || activeVisual.type}
                className="mx-auto max-h-[76vh] w-auto max-w-full rounded-xl border border-slate-700 bg-black object-contain"
                src={activeVisual.assetId ? `/api/papers/${paper.id}/assets/${activeVisual.assetId}` : undefined}
              />
              {activeVisual.english ? (
                <RichText
                  className="mx-auto mt-3 max-w-4xl text-center text-sm leading-7 text-slate-300"
                  text={normalizeCaptionText(activeVisual.english)}
                />
              ) : null}
              {visualBlocks.length > 1 ? (
                <div className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center justify-between px-2">
                  <button
                    type="button"
                    className="pointer-events-auto rounded-full border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
                    onClick={() => {
                      const nextIndex = (activeVisualIndex - 1 + visualBlocks.length) % visualBlocks.length;
                      setActiveVisualId(visualBlocks[nextIndex].id);
                    }}
                  >
                    上一张
                  </button>
                  <button
                    type="button"
                    className="pointer-events-auto rounded-full border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
                    onClick={() => {
                      const nextIndex = (activeVisualIndex + 1) % visualBlocks.length;
                      setActiveVisualId(visualBlocks[nextIndex].id);
                    }}
                  >
                    下一张
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
