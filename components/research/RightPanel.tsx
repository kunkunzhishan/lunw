"use client";

import React from "react";
import {
  MessageSquare,
  Sparkles,
  BookOpen,
  StickyNote,
  Send,
  ArrowUpRight,
  ExternalLink,
  ChevronRight,
  X,
} from "lucide-react";
import katex from "katex";

import type { ChatMessage, ExportedNote, RecommendationItem, RecommendationResponse } from "@/lib/types";

export type RightPanelTab = "chat" | "related" | "notes";

interface ChatMathSegment {
  type: "text" | "math";
  value: string;
  displayMode?: boolean;
}

function parseChatMathSegments(input: string): ChatMathSegment[] {
  const segments: ChatMathSegment[] = [];
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

const ChatMessageContent = ({ content }: { content: string }) => {
  const segments = React.useMemo(() => parseChatMathSegments(content), [content]);
  return (
    <div className="whitespace-pre-wrap leading-7">
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <React.Fragment key={`text-${index}`}>{segment.value}</React.Fragment>;
        }
        try {
          const rendered = katex.renderToString(segment.value, {
            displayMode: segment.displayMode ?? false,
            throwOnError: false,
            strict: "ignore",
          });
          return (
            <span
              className={`inline-math ${segment.displayMode ? "inline-math-display" : ""}`}
              dangerouslySetInnerHTML={{ __html: rendered }}
              key={`math-${index}`}
            />
          );
        } catch {
          return <code className="rounded bg-slate-200/70 px-1 py-0.5 text-xs" key={`fallback-${index}`}>{segment.value}</code>;
        }
      })}
    </div>
  );
};

export interface ChatContextRef {
  id: string;
  blockId: string;
  label: string;
  quoteText?: string;
  quoteStart?: number;
  quoteEnd?: number;
}

export const RightPanel = ({
  activeScope,
  activeTab,
  busy,
  chatContextRefs,
  messages,
  note,
  onChangeScope,
  onClearChatContext,
  onRemoveChatContext,
  onSubmitChat,
  onTabChange,
  recommendationData,
  recommendations,
}: {
  activeScope: "current" | "history" | "direction";
  activeTab: RightPanelTab;
  busy: boolean;
  chatContextRefs: ChatContextRef[];
  messages: ChatMessage[];
  note?: ExportedNote;
  onChangeScope: (scope: "current" | "history" | "direction") => void;
  onClearChatContext: () => void;
  onRemoveChatContext: (contextId: string) => void;
  onSubmitChat: (question: string) => Promise<boolean> | boolean;
  onTabChange: (tab: RightPanelTab) => void;
  recommendationData: RecommendationResponse | null;
  recommendations: RecommendationItem[];
}) => {

  return (
    <div className="flex-1 w-full border-l border-slate-200 bg-white flex flex-col shrink-0 min-h-0">
      {/* Tabs */}
      <div className="flex border-b border-slate-100 p-2 gap-1 bg-slate-50/50">
        <TabButton 
          active={activeTab === 'chat'} 
          onClick={() => onTabChange('chat')} 
          icon={<MessageSquare size={16} />} 
          label="AI 问答" 
        />
        <TabButton 
          active={activeTab === 'related'} 
          onClick={() => onTabChange('related')} 
          icon={<BookOpen size={16} />} 
          label="相关推荐" 
        />
        <TabButton 
          active={activeTab === 'notes'} 
          onClick={() => onTabChange('notes')} 
          icon={<StickyNote size={16} />} 
          label="笔记预览" 
        />
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "chat" && (
          <ChatTab
            busy={busy}
            chatContextRefs={chatContextRefs}
            messages={messages}
            onClearChatContext={onClearChatContext}
            onRemoveChatContext={onRemoveChatContext}
            onSubmitChat={onSubmitChat}
          />
        )}
        {activeTab === "related" && (
          <RelatedTab
            activeScope={activeScope}
            recommendationData={recommendationData}
            onChangeScope={onChangeScope}
            recommendations={recommendations}
          />
        )}
        {activeTab === "notes" && <NotesTab note={note} />}
      </div>
    </div>
  );
};

const TabButton = ({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) => (
  <button 
    onClick={onClick}
    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all ${
      active ? 'bg-white text-teal-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:bg-slate-200/50'
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);

const ChatTab = ({
  busy,
  chatContextRefs,
  messages,
  onClearChatContext,
  onRemoveChatContext,
  onSubmitChat,
}: {
  busy: boolean;
  chatContextRefs: ChatContextRef[];
  messages: ChatMessage[];
  onClearChatContext: () => void;
  onRemoveChatContext: (contextId: string) => void;
  onSubmitChat: (question: string) => Promise<boolean> | boolean;
}) => {
  const [draft, setDraft] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = React.useCallback(async () => {
    const question = draft.trim();
    if (!question || busy || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      const success = await onSubmitChat(question);
      if (success) {
        setDraft("");
      }
    } finally {
      setSubmitting(false);
    }
  }, [busy, draft, onSubmitChat, submitting]);

  return (
  <div className="h-full flex flex-col p-4">
    <div className="flex-1 space-y-4">
      {messages.length === 0 ? (
        <div className="bg-slate-100 p-4 rounded-2xl rounded-tl-none text-sm text-slate-700 max-w-[95%] space-y-2">
          <div className="flex items-center gap-1.5 text-teal-600 font-bold mb-1">
            <Sparkles size={14} />
            <span>助手待命</span>
          </div>
          <p>你可以直接问：这篇论文解决什么问题、方法核心是什么、某一段该怎么理解，或者让助手联网补充背景。</p>
        </div>
      ) : null}

      {messages.map((message) => (
        <div
          className={`max-w-[95%] rounded-2xl p-4 text-sm ${
            message.role === "user"
              ? "ml-auto rounded-tr-none bg-teal-600 text-white"
              : "rounded-tl-none bg-slate-100 text-slate-700"
          }`}
          key={message.id}
        >
          <ChatMessageContent content={message.content} />
          {message.sourceRefs.length ? (
            <div className="mt-3 space-y-1 border-t border-slate-200/60 pt-3 text-xs text-slate-500">
              {message.sourceRefs.map((ref, index) => (
                <div key={`${message.id}-${index}`}>
                  {ref.type === "paper" ? "论文" : ref.type === "academic" ? "学术检索" : ref.type === "web" ? "网页" : "推断"} · {ref.label}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
      {busy ? (
        <div className="bg-slate-100 p-3 rounded-2xl rounded-tl-none text-sm text-slate-500 max-w-[85%]">
          正在思考并整理引用来源...
        </div>
      ) : null}
    </div>
    
    <div className="mt-4 relative">
      {chatContextRefs.length ? (
        <div className="mb-2 rounded-xl border border-teal-100 bg-teal-50/70 p-2">
          <div className="mb-2 flex items-center justify-between text-xs text-teal-700">
            <span>已引用上下文 ({chatContextRefs.length})</span>
            <button type="button" className="hover:underline" onClick={onClearChatContext}>清空</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {chatContextRefs.map((item) => (
              <button
                type="button"
                key={item.id}
                className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-white px-2 py-0.5 text-[11px] text-teal-700"
                onClick={() => onRemoveChatContext(item.id)}
              >
                <span className="max-w-[170px] truncate">{item.label}</span>
                <X size={12} />
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <textarea 
        placeholder="询问关于论文的任何问题..." 
        className="w-full p-4 pr-12 bg-slate-100 border-none rounded-2xl text-sm resize-none h-24 focus:ring-2 focus:ring-teal-500/20 outline-none"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        className="absolute right-3 bottom-3 p-2 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-colors disabled:opacity-60"
        disabled={busy || submitting || !draft.trim()}
        onClick={() => void handleSubmit()}
      >
        <Send size={16} />
      </button>
    </div>
  </div>
  );
};

const RelatedTab = ({
  activeScope,
  recommendationData,
  onChangeScope,
  recommendations,
}: {
  activeScope: "current" | "history" | "direction";
  recommendationData: RecommendationResponse | null;
  onChangeScope: (scope: "current" | "history" | "direction") => void;
  recommendations: RecommendationItem[];
}) => (
  <div className="p-4 space-y-4">
    <div className="flex gap-2">
      {[
        { id: "current", label: "当前论文" },
        { id: "history", label: "阅读历史" },
        { id: "direction", label: "研究方向" },
      ].map((item) => (
        <button
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            activeScope === item.id ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600"
          }`}
          key={item.id}
          onClick={() => onChangeScope(item.id as "current" | "history" | "direction")}
        >
          {item.label}
        </button>
      ))}
    </div>
    {recommendationData ? (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-2">
        <div className="font-semibold text-slate-800">本次检索计划</div>
        <div>{recommendationData.plan.intent}</div>
        <div>Seed: {recommendationData.plan.seedQueries.join(" · ")}</div>
        <div>Sources: {recommendationData.sourcesUsed.join(", ")}</div>
        {recommendationData.errors?.length ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
            检索警告：{recommendationData.errors.join("；")}
          </div>
        ) : null}
      </div>
    ) : null}
    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">推荐结果</h4>
    {recommendations.length === 0 ? (
      <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">
        还没有推荐结果。点击上面的来源标签，或先上传并选择一篇论文。
      </div>
    ) : null}
    {recommendations.map((paper) => (
      <a
        href={paper.url}
        key={paper.id}
        rel="noreferrer"
        target="_blank"
        className="block rounded-xl border border-slate-100 p-3 transition-colors hover:bg-slate-50 group"
      >
        <div className="mb-1 flex items-start justify-between">
          <h5 className="line-clamp-2 text-sm font-semibold leading-tight text-slate-800 transition-colors group-hover:text-teal-700">
            {paper.title}
          </h5>
          <ArrowUpRight size={14} className="mt-0.5 shrink-0 text-slate-300 group-hover:text-teal-500" />
        </div>
        <p className="mb-2 text-[11px] text-slate-500">
          {paper.sourceType === "current" ? "基于当前论文" : paper.sourceType === "history" ? "基于阅读历史" : "基于研究方向"} · {paper.source}
        </p>
        <p className="text-xs leading-relaxed text-slate-600">{paper.reason}</p>
        <div className="mt-3 space-y-1 text-[11px] text-slate-500">
          {paper.year ? <div>年份：{paper.year}</div> : null}
          {paper.authors.length ? <div>作者：{paper.authors.slice(0, 3).join(", ")}</div> : null}
          <div>证据：{paper.evidenceRefs.join("；")}</div>
          <div>建议：{paper.nextStep}</div>
        </div>
      </a>
    ))}
    <button className="w-full py-2 text-sm font-medium text-slate-500 hover:text-slate-700 flex items-center justify-center gap-1 border border-dashed border-slate-200 rounded-xl">
      <span>查看更多研究方向</span>
      <ChevronRight size={14} />
    </button>
  </div>
);

const NotesTab = ({ note }: { note?: ExportedNote }) => (
  <div className="p-4 flex flex-col h-full">
    <div className="flex items-center justify-between mb-4 px-1">
      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Obsidian 风格笔记</h4>
      {note?.targetPath ? <span className="text-[10px] text-slate-400">{note.targetPath}</span> : null}
    </div>
    
    <div className="flex-1 bg-slate-50 rounded-2xl p-4 font-mono text-[13px] leading-relaxed text-slate-700 border border-slate-100 overflow-y-auto whitespace-pre-wrap">
      {note?.markdown ?? "还没有导出笔记。点击顶部“导出笔记”后会显示完整 Markdown 内容。"}
    </div>
    
    <button className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-900 text-white rounded-xl font-medium hover:bg-black transition-all">
      <ExternalLink size={16} />
      <span>{note ? "已导出，可在目标目录查看" : "点击顶部“导出笔记”写入 Obsidian 目录"}</span>
    </button>
  </div>
);
