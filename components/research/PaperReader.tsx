"use client";

import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronRight, Highlighter, ImageIcon, List, Quote, Sigma, Table2, StickyNote, X } from "lucide-react";
import katex from "katex";

import type {
  AssetPaperBlock,
  FormulaPaperBlock,
  PaperAnnotation,
  PaperBlock,
  PaperHighlight,
  PaperRecord,
  TextPaperBlock,
} from "@/lib/types";

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

type ParentheticalStyle = "numericCitation" | "authorCitation" | "aside" | "enumeration" | "bracketCitation";

interface CitationTextSegment {
  type: "text" | "citation";
  value: string;
  style?: ParentheticalStyle;
}

function insertEnumerationLineBreaks(input: string) {
  const markerPattern = /(?:\(\d{1,2}\)|（\d{1,2}）)/g;
  const bulletReferencePattern = /(?:[•●▪◦]\s*\[\d{1,4}\])/g;
  const bulletEntryPattern = /(?:[•●▪◦∙·◆◇○◉▫‣⁃]\s*(?:\[\d{1,4}\]|[A-Z\u4e00-\u9fa5]))/g;
  const bracketReferencePattern = /(?:\[\d{1,4}\])/g;
  const markerCount = (input.match(markerPattern) ?? []).length;
  const bulletReferenceCount = (input.match(bulletReferencePattern) ?? []).length;
  const bulletEntryCount = (input.match(bulletEntryPattern) ?? []).length;
  const bracketReferenceCount = (input.match(bracketReferencePattern) ?? []).length;

  if (markerCount < 2 && bulletReferenceCount < 2 && bulletEntryCount < 2 && bracketReferenceCount < 2) {
    return input;
  }

  let normalized = input;
  if (markerCount >= 2) {
    normalized = normalized.replace(/\s*(\(\d{1,2}\)|（\d{1,2}）)\s*/g, "\n$1 ");
  }
  if (bulletReferenceCount >= 2) {
    normalized = normalized.replace(/\s*([•●▪◦]\s*\[\d{1,4}\])\s*/g, "\n$1 ");
  }
  if (bulletEntryCount >= 2) {
    normalized = normalized.replace(/\s*([•●▪◦∙·◆◇○◉▫‣⁃])\s*(?=(?:\[\d{1,4}\]|[A-Z\u4e00-\u9fa5]))/g, "\n$1 ");
  }
  if (bracketReferenceCount >= 2) {
    normalized = normalized.replace(/\s*(\[\d{1,4}\])\s*/g, "\n$1 ");
  }

  return normalized
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function isEnumeratedSentence(value: string) {
  return /^(\(\d{1,2}\)|（\d{1,2}）)\s*/.test(value.trim());
}

function stripLeadingListMarker(value: string) {
  return value.replace(/^[\s\u200B\u200C\u200D\uFEFF]*[•●▪◦∙·◆◇○◉▫‣⁃-]+\s*/u, "");
}

function isReferenceListLine(value: string) {
  const normalized = value.trim();
  const markerStripped = stripLeadingListMarker(normalized);
  const hasDirectBracketPrefix = /^\[\d{1,4}\](?:\s|$)/.test(normalized);
  if (hasDirectBracketPrefix) {
    return true;
  }

  const hasLeadingBulletMarker = markerStripped !== normalized;
  if (!hasLeadingBulletMarker) {
    return false;
  }

  if (/^\[\d{1,4}\](?:\s|$)/.test(markerStripped)) {
    return true;
  }

  const hasYear = /\b(?:19|20)\d{2}[a-z]?\b/.test(markerStripped);
  const authorInitialCount = (markerStripped.match(/,\s*[A-Z](?:\.[A-Z])*\.?/g) ?? []).length;
  const hasAuthorStart = /^[A-Z][A-Za-z'`-]+,\s*[A-Z](?:\.[A-Z])*\.?/.test(markerStripped);
  const hasVenueHint = /(arxiv|corr|neurips|iclr|icml|acl|emnlp|cvpr|eccv|aaai|url|doi|in:)/i.test(markerStripped);

  return hasYear && (hasAuthorStart || authorInitialCount >= 2 || hasVenueHint);
}

function classifyCitationStyle(token: string): ParentheticalStyle | null {
  const normalized = token.trim();
  if (!normalized) {
    return null;
  }

  if (/^\[\s*\d{1,4}(?:\s*[-,]\s*\d{1,4})*\s*\]$/.test(normalized)) {
    return "bracketCitation";
  }

  if (!((normalized.startsWith("(") && normalized.endsWith(")")) || (normalized.startsWith("（") && normalized.endsWith("）")))) {
    return null;
  }

  const inner = normalized.slice(1, -1).trim();
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
  const pattern = /(?:\([^()\n]{1,160}\)|（[^（）\n]{1,160}）|\[\s*\d{1,4}(?:\s*[-,]\s*\d{1,4})*\s*\])/g;
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

    if (segment.style === "authorCitation") {
      return (
        <span className="text-[0.9em] text-slate-500" key={`${keyPrefix}-citation-${index}`}>
          {segment.value}
        </span>
      );
    }

    if (segment.style === "bracketCitation") {
      return (
        <span className="text-[0.9em] text-slate-400" key={`${keyPrefix}-citation-${index}`}>
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
  forceBlock?: boolean;
  isReferenceLine?: boolean;
}

interface LocalTextRange {
  start: number;
  end: number;
}

interface StyledLocalTextRange extends LocalTextRange {
  kind: "annotation" | "highlight";
}

interface ElementSelectionRange {
  quoteText: string;
  start: number;
  end: number;
}

interface TocItem {
  blockId: string;
  title: string;
  page: number;
  level: number;
}

interface TocNode extends TocItem {
  children: TocNode[];
}

function extractHeadingNumberToken(title: string) {
  const normalized = title.trim();
  const decimalMatch = normalized.match(/^(?:section\s+)?(\d+(?:\.\d+){0,4})(?:[\s.:：、\-]|$)/i);
  if (decimalMatch?.[1]) {
    return decimalMatch[1];
  }
  const chineseChapterMatch = normalized.match(/^(第[一二三四五六七八九十百千\d]+[章节部分])/);
  if (chineseChapterMatch?.[1]) {
    return chineseChapterMatch[1];
  }
  return "";
}

function inferHeadingLevel(title: string, providedLevel?: number) {
  if (Number.isFinite(providedLevel) && (providedLevel as number) > 1) {
    return Math.min(4, Math.max(1, Math.floor(providedLevel as number)));
  }
  const normalized = title.trim();
  const numberToken = extractHeadingNumberToken(normalized);
  if (numberToken && /^\d/.test(numberToken)) {
    return Math.min(4, Math.max(1, numberToken.split(".").length));
  }
  if (/^(?:appendix|references|acknowledg(e)?ments?)/i.test(normalized)) {
    return 1;
  }
  if (/^(?:附录|参考文献|致谢)/.test(normalized)) {
    return 1;
  }
  if (/^[A-Z]\./.test(normalized)) {
    return 2;
  }
  return 1;
}

function normalizeHeadingForCompare(title: string) {
  return title
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s.]/gu, "")
    .trim();
}

function splitSentences(text: string): SentenceChunk[] {
  interface SentenceCandidate {
    text: string;
    forceBlock?: boolean;
    isReferenceLine?: boolean;
  }

  const normalizedText = insertEnumerationLineBreaks(text);
  const lineCandidates = normalizedText
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((line) => {
      const markerStripped = stripLeadingListMarker(line).trim();
      return Boolean(markerStripped);
    });

  const sentences: SentenceCandidate[] = lineCandidates.flatMap((line): SentenceCandidate[] => {
    if (isReferenceListLine(line)) {
      return [{ text: stripLeadingListMarker(line).trim(), forceBlock: true, isReferenceLine: true }];
    }

    return line
      .split(/(?<=[。！？!?\.])\s+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => ({ text: item }));
  });

  return sentences.reduce<{ chunks: SentenceChunk[]; cursor: number }>((state, sentence, index) => {
    const normalized = sentence.text.trim();
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
      text: `${sentence.text}${index < sentences.length - 1 && !sentence.forceBlock ? " " : ""}`,
      start,
      end,
      forceBlock: sentence.forceBlock,
      isReferenceLine: sentence.isReferenceLine,
    });
    state.cursor = Math.max(end, state.cursor);
    return state;
  }, { chunks: [], cursor: 0 }).chunks;
}

function getSelectionRangeInElement(element: HTMLElement, maxChars = 400): ElementSelectionRange | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const selectionRange = selection.getRangeAt(0);
  if (selectionRange.collapsed) {
    return null;
  }
  try {
    if (!selectionRange.intersectsNode(element)) {
      return null;
    }
  } catch {
    return null;
  }

  const elementRange = document.createRange();
  elementRange.selectNodeContents(element);
  const range = selectionRange.cloneRange();
  if (range.compareBoundaryPoints(Range.START_TO_START, elementRange) < 0) {
    range.setStart(elementRange.startContainer, elementRange.startOffset);
  }
  if (range.compareBoundaryPoints(Range.END_TO_END, elementRange) > 0) {
    range.setEnd(elementRange.endContainer, elementRange.endOffset);
  }

  const rawText = range.toString();
  if (!rawText.trim()) {
    return null;
  }

  const prefixRange = range.cloneRange();
  prefixRange.selectNodeContents(element);
  prefixRange.setEnd(range.startContainer, range.startOffset);

  const rawStart = prefixRange.toString().length;
  const leftTrim = rawText.length - rawText.trimStart().length;
  const rightTrim = rawText.length - rawText.trimEnd().length;
  const start = rawStart + leftTrim;
  const end = rawStart + rawText.length - rightTrim;

  if (end <= start) {
    return null;
  }

  const normalizedText = rawText.trim();
  const quoteText = normalizedText.length <= maxChars ? normalizedText : normalizedText.slice(0, maxChars);
  const quoteEnd = quoteText.length < normalizedText.length ? start + quoteText.length : end;
  return {
    quoteText,
    start,
    end: quoteEnd,
  };
}

function renderSentenceWithHighlights(text: string, ranges: StyledLocalTextRange[], keyPrefix: string) {
  const normalizedRanges = ranges
    .map((range) => ({
      ...range,
      start: Math.max(0, Math.min(text.length, range.start)),
      end: Math.max(0, Math.min(text.length, range.end)),
    }))
    .filter((range) => range.end > range.start);

  if (!normalizedRanges.length) {
    return renderRichNodes(text, `${keyPrefix}-plain`);
  }

  const boundaries = new Set<number>([0, text.length]);
  for (const range of normalizedRanges) {
    boundaries.add(range.start);
    boundaries.add(range.end);
  }
  const points = Array.from(boundaries).sort((left, right) => left - right);
  const nodes: React.ReactNode[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (end <= start) {
      continue;
    }

    const segment = text.slice(start, end);
    const coveredKinds = new Set(
      normalizedRanges
        .filter((range) => range.start < end && range.end > start)
        .map((range) => range.kind),
    );

    if (!coveredKinds.size) {
      nodes.push(
        <React.Fragment key={`${keyPrefix}-plain-${index}`}>
          {renderRichNodes(segment, `${keyPrefix}-plain-${index}`)}
        </React.Fragment>,
      );
      continue;
    }

    const highlightClass = coveredKinds.has("highlight")
      ? "bg-teal-200/70"
      : "bg-amber-200/80";
    nodes.push(
      <mark className={`rounded px-0.5 ${highlightClass}`} key={`${keyPrefix}-highlight-${index}`}>
        {renderRichNodes(segment, `${keyPrefix}-highlight-${index}`)}
      </mark>,
    );
  }

  return nodes;
}

function buildSelectionKey(params: { blockId: string; quoteStart?: number; quoteEnd?: number; quoteText?: string }) {
  const { blockId, quoteStart, quoteEnd, quoteText } = params;
  if (quoteStart !== undefined && quoteEnd !== undefined) {
    return `${blockId}:${quoteStart}:${quoteEnd}`;
  }
  return `${blockId}:text:${(quoteText ?? "").trim()}`;
}

function BlockCard({
  annotationThreads,
  highlightItems,
  hiddenThreadIds,
  block,
  onAddAnnotation,
  onHideThread,
  onOpenVisual,
  onRemoveAnnotation,
  onRestoreHiddenThreads,
  paperId,
  onOpenQuoteMenu,
  onExplainFormula,
  explainingFormulaBlockId,
  reserveCommentSpace,
}: {
  annotationThreads?: AnnotationThread[];
  highlightItems?: PaperHighlight[];
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
  onExplainFormula?: (block: FormulaPaperBlock) => void;
  explainingFormulaBlockId?: string | null;
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
    const shouldReserveCommentSpace = Boolean(reserveCommentSpace);

    return (
      <article
        id={`reader-block-${block.id}`}
        className={block.type === "heading" ? "pt-4" : ""}
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
              <div
                onContextMenu={(event) => {
                  if (!onOpenQuoteMenu) {
                    return;
                  }
                  const selected = getSelectionRangeInElement(event.currentTarget);
                  if (!selected) {
                    return;
                  }
                  event.preventDefault();
                  onOpenQuoteMenu(block, {
                    x: event.clientX,
                    y: event.clientY,
                    quoteText: selected.quoteText,
                    quoteStart: selected.start,
                    quoteEnd: selected.end,
                  });
                }}
              >
                <RichText className={titleClass} text={block.english} />
              </div>
            ) : (
              <p className={`${titleClass} whitespace-pre-wrap`}>
                {sentenceChunks.map((sentenceChunk, index) => {
                  const sentence = sentenceChunk.text;
                  const isReferenceLineSentence = Boolean(sentenceChunk.isReferenceLine);
                  const displaySentence = isReferenceLineSentence
                    ? stripLeadingListMarker(sentence).trim()
                    : sentence;
                  if (!displaySentence) {
                    return null;
                  }
                  const localRanges: Array<LocalTextRange & { threadId: string }> = [];
                  for (const thread of threads) {
                    const hasValidRange =
                      thread.quoteStart !== undefined &&
                      thread.quoteEnd !== undefined &&
                      thread.quoteStart >= 0 &&
                      thread.quoteEnd > thread.quoteStart &&
                      thread.quoteEnd <= block.english.length;

                    if (hasValidRange) {
                      const quoteStart = thread.quoteStart as number;
                      const quoteEnd = thread.quoteEnd as number;
                      const overlapStart = Math.max(quoteStart, sentenceChunk.start);
                      const overlapEnd = Math.min(quoteEnd, sentenceChunk.end);
                      if (overlapStart < overlapEnd) {
                        localRanges.push({
                          start: overlapStart - sentenceChunk.start,
                          end: overlapEnd - sentenceChunk.start,
                          threadId: thread.threadId,
                        });
                        continue;
                      }
                    }
                  }
                  const highlightRanges: LocalTextRange[] = [];
                  for (const highlight of highlightItems ?? []) {
                    const hasValidRange =
                      highlight.quoteStart !== undefined &&
                      highlight.quoteEnd !== undefined &&
                      highlight.quoteStart >= 0 &&
                      highlight.quoteEnd > highlight.quoteStart &&
                      highlight.quoteEnd <= block.english.length;

                    if (hasValidRange) {
                      const quoteStart = highlight.quoteStart as number;
                      const quoteEnd = highlight.quoteEnd as number;
                      const overlapStart = Math.max(quoteStart, sentenceChunk.start);
                      const overlapEnd = Math.min(quoteEnd, sentenceChunk.end);
                      if (overlapStart < overlapEnd) {
                        highlightRanges.push({
                          start: overlapStart - sentenceChunk.start,
                          end: overlapEnd - sentenceChunk.start,
                        });
                        continue;
                      }
                    }
                  }

                  const relatedThreadIds = Array.from(new Set(localRanges.map((range) => range.threadId)));
                  const linkedToComment = relatedThreadIds.length > 0;
                  const linkedToHighlight = highlightRanges.length > 0;
                  const hasHiddenRelated = relatedThreadIds.some((threadId) => hiddenThreadIds.has(threadId));
                  const enumerated = isEnumeratedSentence(sentence) || sentenceChunk.forceBlock;
                  const spacingClass = isReferenceLineSentence
                    ? "my-0.5 block"
                    : enumerated
                      ? "my-1 block"
                      : "";
                  const referenceLineClass = isReferenceLineSentence
                    ? "text-[0.98rem] leading-7 text-slate-600"
                    : "";
                  return (
                    <span
                      key={`${block.id}-sentence-${index}`}
                      className={`${
                        linkedToComment
                          ? "bg-amber-50/80 ring-1 ring-amber-200"
                          : linkedToHighlight
                            ? "bg-teal-50/60 ring-1 ring-teal-200/80"
                            : ""
                      } ${spacingClass} ${referenceLineClass} ${hasHiddenRelated ? "cursor-pointer" : ""}`}
                      onContextMenu={(event) => {
                        if (!onOpenQuoteMenu) {
                          return;
                        }
                        const selected = getSelectionRangeInElement(event.currentTarget);
                        if (!selected) {
                          return;
                        }
                        event.preventDefault();
                        const displayOffset = Math.max(0, sentence.indexOf(displaySentence));
                        const quoteStart = sentenceChunk.start + displayOffset + selected.start;
                        const quoteEnd = sentenceChunk.start + displayOffset + selected.end;
                        onOpenQuoteMenu(block, {
                          x: event.clientX,
                          y: event.clientY,
                          quoteText: selected.quoteText,
                          quoteStart,
                          quoteEnd,
                        });
                      }}
                      onDoubleClick={() => {
                        if (!hasHiddenRelated || !onRestoreHiddenThreads) {
                          return;
                        }
                        onRestoreHiddenThreads(relatedThreadIds);
                      }}
                    >
                      {renderSentenceWithHighlights(
                        displaySentence,
                        [
                          ...localRanges.map((item) => ({ start: item.start, end: item.end, kind: "annotation" as const })),
                          ...highlightRanges.map((item) => ({ start: item.start, end: item.end, kind: "highlight" as const })),
                        ],
                        `${block.id}-sentence-${index}`,
                      )}
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
    const explanation = block.formulaExplanation?.trim();
    const isExplaining = explainingFormulaBlockId === block.id;
    return (
      <article id={`reader-block-${block.id}`} className="my-4 rounded-2xl border border-slate-200 bg-slate-50/70 px-5 py-4">
        <div className="mb-2 flex items-center justify-between gap-2 text-sm font-medium text-slate-600">
          <span className="inline-flex items-center gap-2">
            <Sigma size={16} />
            <span>公式</span>
          </span>
          {onExplainFormula ? (
            explanation ? (
              <button
                type="button"
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isExplaining}
                onClick={() => onExplainFormula(block)}
              >
                {isExplaining ? "生成中..." : "重新生成注释"}
              </button>
            ) : (
              <span className="text-xs text-slate-500">{isExplaining ? "自动生成中..." : "等待自动生成注释..."}</span>
            )
          ) : null}
        </div>
        <FormulaView latex={block.latex} fallbackSrc={assetSrc} />
        {explanation ? (
          <p className="mt-3 rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2 text-[0.92rem] leading-7 text-slate-700">
            {explanation}
          </p>
        ) : onExplainFormula ? (
          <p className="mt-3 text-xs text-slate-500">系统会自动生成这条公式的中文注释。</p>
        ) : null}
      </article>
    );
  }

  if (block.type === "table") {
    return (
      <article id={`reader-block-${block.id}`} className="my-4 rounded-2xl border border-slate-200 bg-slate-50/70 px-5 py-4">
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
    <article id={`reader-block-${block.id}`} className="my-4 rounded-2xl border border-slate-200 bg-slate-50/70 px-5 py-4">
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
    void left;
    void right;
    return false;
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
  quotedContextKeys,
  onAddAnnotation,
  onAddHighlight,
  onRemoveHighlight,
  onDeleteAnnotation,
  onExplainFormula,
  explainingFormulaBlockId,
  onQuoteBlock,
}: {
  paper: PaperRecord;
  blocks: PaperBlock[];
  searchQuery: string;
  quotedContextKeys?: string[];
  onAddAnnotation?: (params: {
    block: TextPaperBlock;
    content: string;
    quoteText?: string;
    quoteStart?: number;
    quoteEnd?: number;
    threadId?: string;
  }) => void;
  onAddHighlight?: (params: {
    block: TextPaperBlock;
    quoteText?: string;
    quoteStart?: number;
    quoteEnd?: number;
  }) => void;
  onRemoveHighlight?: (params: {
    highlightId?: string;
    blockId: string;
    quoteStart?: number;
    quoteEnd?: number;
  }) => void;
  onDeleteAnnotation?: (annotationId: string) => void;
  onExplainFormula?: (block: FormulaPaperBlock) => void;
  explainingFormulaBlockId?: string | null;
  onQuoteBlock?: (params: {
    block: TextPaperBlock;
    quoteText?: string;
    quoteStart?: number;
    quoteEnd?: number;
  }) => void;
}) => {
  const textBlocks = paper.blocks.filter(
    (block): block is TextPaperBlock => block.type === "text" || block.type === "heading",
  );
  const translatedCount = textBlocks.filter((block) => block.chinese?.trim()).length;
  const readingBlocks = useMemo(() => mergeReadableText(blocks), [blocks]);
  const tocItems = useMemo((): TocItem[] => {
    const headingItems = readingBlocks
      .filter((block): block is TextPaperBlock => block.type === "heading" && block.english.trim().length > 0)
      .map((block) => ({
        blockId: block.id,
        title: block.english.trim(),
        page: block.page,
        level: inferHeadingLevel(block.english, block.headingLevel),
      }));
    if (!headingItems.length) {
      return [];
    }
    const dedupedItems: TocItem[] = [];
    for (const item of headingItems) {
      const prev = dedupedItems[dedupedItems.length - 1];
      if (!prev) {
        dedupedItems.push(item);
        continue;
      }
      const prevToken = extractHeadingNumberToken(prev.title);
      const currentToken = extractHeadingNumberToken(item.title);
      const sameNumberToken = Boolean(prevToken && currentToken && prevToken === currentToken);
      const sameNormalizedTitle = normalizeHeadingForCompare(prev.title) === normalizeHeadingForCompare(item.title);
      if ((sameNumberToken || sameNormalizedTitle) && Math.abs(prev.page - item.page) <= 1) {
        continue;
      }
      dedupedItems.push(item);
    }

    const minLevel = Math.min(...dedupedItems.map((item) => item.level));
    return dedupedItems.map((item) => ({
      ...item,
      level: Math.max(1, item.level - minLevel + 1),
    }));
  }, [readingBlocks]);
  const tocTree = useMemo(() => {
    const roots: TocNode[] = [];
    const parentById = new Map<string, string | null>();
    const stack: TocNode[] = [];

    for (const item of tocItems) {
      const node: TocNode = { ...item, children: [] };
      while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
        stack.pop();
      }
      const parent = stack[stack.length - 1];
      if (parent) {
        parent.children.push(node);
        parentById.set(node.blockId, parent.blockId);
      } else {
        roots.push(node);
        parentById.set(node.blockId, null);
      }
      stack.push(node);
    }

    return {
      roots,
      parentById,
    };
  }, [tocItems]);
  const quotedSet = useMemo(() => new Set(quotedContextKeys ?? []), [quotedContextKeys]);
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
  const highlightsByBlock = useMemo(() => {
    const blockMap = new Map<string, PaperHighlight[]>();
    for (const highlight of paper.highlights) {
      const list = blockMap.get(highlight.blockId) ?? [];
      list.push(highlight);
      blockMap.set(highlight.blockId, list);
    }
    for (const highlights of blockMap.values()) {
      highlights.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }
    return blockMap;
  }, [paper.highlights]);
  const highlightIdBySelectionKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const highlight of paper.highlights) {
      map.set(
        buildSelectionKey({
          blockId: highlight.blockId,
          quoteStart: highlight.quoteStart,
          quoteEnd: highlight.quoteEnd,
          quoteText: highlight.quoteText,
        }),
        highlight.id,
      );
    }
    return map;
  }, [paper.highlights]);
  const [hiddenThreadIds, setHiddenThreadIds] = useState<string[]>([]);
  const hiddenThreadSet = useMemo(() => new Set(hiddenThreadIds), [hiddenThreadIds]);
  const hasAnyVisibleAnnotations = useMemo(
    () => paper.annotations.some((annotation) => !hiddenThreadSet.has(annotation.threadId || `thread-${annotation.id}`)),
    [hiddenThreadSet, paper.annotations],
  );
  const [contextMenu, setContextMenu] = useState<{
    block: TextPaperBlock;
    selectionKey: string;
    existingHighlightId?: string;
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
  const hasContextMenuAnchor = Boolean(
    contextMenu
    && contextMenu.quoteStart !== undefined
    && contextMenu.quoteEnd !== undefined,
  );
  const visualBlocks = useMemo(
    () =>
      readingBlocks.filter(
        (block): block is AssetPaperBlock => block.type === "image" || block.type === "table",
      ),
    [readingBlocks],
  );
  const [activeVisualId, setActiveVisualId] = useState<string | null>(null);
  const [showOriginalPdf, setShowOriginalPdf] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [activeTocBlockId, setActiveTocBlockId] = useState<string | null>(null);
  const [expandedTocIds, setExpandedTocIds] = useState<string[]>([]);
  const expandedTocSet = useMemo(() => new Set(expandedTocIds), [expandedTocIds]);
  const activeVisualIndex = useMemo(
    () => visualBlocks.findIndex((block) => block.id === activeVisualId),
    [activeVisualId, visualBlocks],
  );
  const activeVisual = activeVisualIndex >= 0 ? visualBlocks[activeVisualIndex] : null;

  useEffect(() => {
    setHiddenThreadIds([]);
    setActiveVisualId(null);
    setShowOriginalPdf(false);
    setShowToc(false);
    setActiveTocBlockId(null);
    setExpandedTocIds([]);
  }, [paper.id]);

  const expandTocParents = (blockId: string) => {
    setExpandedTocIds((current) => {
      const next = new Set(current);
      let parentId = tocTree.parentById.get(blockId) ?? null;
      while (parentId) {
        next.add(parentId);
        parentId = tocTree.parentById.get(parentId) ?? null;
      }
      return Array.from(next);
    });
  };

  const jumpToHeading = (blockId: string) => {
    expandTocParents(blockId);
    const target = document.getElementById(`reader-block-${blockId}`);
    if (!target) {
      return;
    }
    target.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    setActiveTocBlockId(blockId);
  };

  const toggleTocNode = (blockId: string) => {
    setExpandedTocIds((current) =>
      current.includes(blockId) ? current.filter((id) => id !== blockId) : [...current, blockId],
    );
  };

  const renderTocNodes = (nodes: TocNode[], depth = 0): React.ReactNode =>
    nodes.map((node) => {
      const hasChildren = node.children.length > 0;
      const isExpanded = expandedTocSet.has(node.blockId);
      const isActive = activeTocBlockId === node.blockId;
      return (
        <div key={node.blockId}>
          <div
            className={`flex items-center rounded-md py-1 pr-2 transition-colors ${
              isActive ? "bg-teal-50 text-teal-700" : "text-slate-700 hover:bg-slate-50"
            }`}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
          >
            {hasChildren ? (
              <button
                type="button"
                className="mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleTocNode(node.blockId);
                }}
                aria-label={isExpanded ? "收起子目录" : "展开子目录"}
              >
                <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
              </button>
            ) : (
              <span className="mr-1 inline-flex h-5 w-5 shrink-0" />
            )}

            <button
              type="button"
              className="min-w-0 flex-1 text-left text-sm"
              onClick={() => jumpToHeading(node.blockId)}
            >
              <span className="mr-2 text-xs text-slate-400">P{node.page}</span>
              <span className="align-middle">{node.title}</span>
            </button>
          </div>

          {hasChildren && isExpanded ? renderTocNodes(node.children, depth + 1) : null}
        </div>
      );
    });

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
        className={`mx-auto flex items-start gap-5 ${
          hasAnyVisibleAnnotations ? "max-w-[1540px]" : "max-w-[1240px]"
        }`}
      >
        <div
          className={`min-w-0 flex-1 rounded-3xl border border-[#e6dfd0] bg-[#fffdf8] shadow-[0_12px_28px_rgba(15,23,42,0.08)] ${
            hasAnyVisibleAnnotations ? "max-w-[1220px]" : "max-w-[920px]"
          }`}
        >
          <div className="border-b border-[#e9e2d5] px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <BookOpen size={16} />
                  <span>{paper.title}</span>
                </div>
                <div>连续阅读模式</div>
                <div>
                  已翻译 {translatedCount}/{textBlocks.length} 块
                </div>
                <div className="text-xs text-slate-500">先选中文字再右键，可添加批注或划重点</div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  onClick={() => setShowToc((current) => !current)}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <List size={14} />
                    {showToc ? "隐藏目录" : "显示目录"}
                  </span>
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  onClick={() => setShowOriginalPdf((current) => !current)}
                >
                  {showOriginalPdf ? "隐藏原始 PDF" : "显示原始 PDF"}
                </button>
              </div>
            </div>

            {showOriginalPdf ? (
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <iframe
                  className="h-[72vh] w-full"
                  src={`/api/papers/${paper.id}/file#toolbar=1&navpanes=0`}
                  title={`${paper.title} 原始 PDF`}
                />
              </div>
            ) : null}
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
                    const menuHeight = 168;
                    const x = Math.min(window.innerWidth - menuWidth, Math.max(8, position.x));
                    const y = Math.min(window.innerHeight - menuHeight, Math.max(8, position.y));
                    const selectionKey = buildSelectionKey({
                      blockId: textBlock.id,
                      quoteStart: position.quoteStart,
                      quoteEnd: position.quoteEnd,
                      quoteText: position.quoteText,
                    });
                    const exactHighlightId = highlightIdBySelectionKey.get(selectionKey);
                    const overlappingHighlightId = exactHighlightId ?? highlightsByBlock
                      .get(textBlock.id)
                      ?.find((item) =>
                        item.quoteStart !== undefined
                        && item.quoteEnd !== undefined
                        && position.quoteStart !== undefined
                        && position.quoteEnd !== undefined
                        && item.quoteStart < position.quoteEnd
                        && item.quoteEnd > position.quoteStart)
                      ?.id;
                    setContextMenu({
                      block: textBlock,
                      selectionKey,
                      existingHighlightId: overlappingHighlightId,
                      x,
                      y,
                      quoteText: position.quoteText,
                      quoteStart: position.quoteStart,
                      quoteEnd: position.quoteEnd,
                    });
                  }}
                  annotationThreads={annotationThreadsByBlock.get(block.id)}
                  highlightItems={highlightsByBlock.get(block.id)}
                  hiddenThreadIds={hiddenThreadSet}
                  onAddAnnotation={onAddAnnotation}
                  onHideThread={(threadId) =>
                    setHiddenThreadIds((current) => (current.includes(threadId) ? current : [...current, threadId]))
                  }
                  onOpenVisual={(visualBlock) => setActiveVisualId(visualBlock.id)}
                  onRemoveAnnotation={onDeleteAnnotation}
                  onExplainFormula={onExplainFormula}
                  explainingFormulaBlockId={explainingFormulaBlockId}
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

        {showToc ? (
          <aside className="sticky top-6 hidden max-h-[calc(100vh-3rem)] w-[280px] shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:block">
            <div className="border-b border-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">论文目录导航</div>
            <div className="max-h-[calc(100vh-7.2rem)] overflow-y-auto px-2 py-2">
              {tocItems.length ? (
                renderTocNodes(tocTree.roots)
              ) : (
                <div className="px-3 py-2 text-sm text-slate-500">当前解析结果里没有识别出目录标题。</div>
              )}
            </div>
          </aside>
        ) : null}
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
              quotedSet.has(contextMenu.selectionKey)
                ? "cursor-not-allowed text-slate-400"
                : "text-slate-700 hover:bg-slate-100"
            }`}
            disabled={quotedSet.has(contextMenu.selectionKey)}
            onClick={() => {
              if (quotedSet.has(contextMenu.selectionKey) || !onQuoteBlock) {
                setContextMenu(null);
                return;
              }
              onQuoteBlock({
                block: contextMenu.block,
                quoteText: contextMenu.quoteText,
                quoteStart: contextMenu.quoteStart,
                quoteEnd: contextMenu.quoteEnd,
              });
              setContextMenu(null);
            }}
          >
            <Quote size={14} />
            {quotedSet.has(contextMenu.selectionKey) ? "已在聊天上下文中" : "添加到聊天上下文"}
          </button>
          <button
            type="button"
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
            disabled={!hasContextMenuAnchor}
            onClick={() => {
              if (!hasContextMenuAnchor) {
                setContextMenu(null);
                return;
              }
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
          <button
            type="button"
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
            disabled={
              (!onAddHighlight && !onRemoveHighlight)
              || !hasContextMenuAnchor
            }
            onClick={() => {
              const hasExisting = Boolean(contextMenu.existingHighlightId);
              if (hasExisting) {
                if (!onRemoveHighlight) {
                  setContextMenu(null);
                  return;
                }
                onRemoveHighlight({
                  highlightId: contextMenu.existingHighlightId,
                  blockId: contextMenu.block.id,
                  quoteStart: contextMenu.quoteStart,
                  quoteEnd: contextMenu.quoteEnd,
                });
                setContextMenu(null);
                return;
              }

              if (!onAddHighlight) {
                setContextMenu(null);
                return;
              }
              onAddHighlight({
                block: contextMenu.block,
                quoteText: contextMenu.quoteText,
                quoteStart: contextMenu.quoteStart,
                quoteEnd: contextMenu.quoteEnd,
              });
              setContextMenu(null);
            }}
          >
            <Highlighter size={14} />
            {contextMenu.existingHighlightId ? "取消划重点" : "划重点"}
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
