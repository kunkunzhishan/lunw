"use client";

import React from "react";
import { FileText, Languages, Lightbulb, FileDown, Search, PanelRightOpen } from "lucide-react";

export const TopBar = ({
  activePaperTitle,
  busy,
  onOpenAssistant,
  onSearchChange,
  onSummarize,
  onTranslate,
  onExport,
  searchQuery,
}: {
  activePaperTitle?: string;
  busy: boolean;
  onOpenAssistant: () => void;
  onSearchChange: (value: string) => void;
  onSummarize: () => void;
  onTranslate: () => void;
  onExport: () => void;
  searchQuery: string;
}) => {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-6 backdrop-blur-md">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-800">
            {activePaperTitle ?? "论文阅读"}
          </div>
          <div className="text-xs text-slate-500">英文段落下面紧跟中文翻译，上下滚动阅读。</div>
        </div>
        <div className="relative w-80 max-w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="搜索当前论文中的关键词..." 
            className="w-full pl-10 pr-4 py-2 bg-slate-100 border-none rounded-xl text-sm focus:ring-2 focus:ring-teal-500/20 transition-all outline-none"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <ActionButton disabled={busy} icon={<Languages size={18} />} label="对照翻译" onClick={onTranslate} />
        <ActionButton disabled={busy} icon={<FileText size={18} />} label="生成摘要" onClick={onSummarize} />
        <ActionButton disabled={busy} icon={<Lightbulb size={18} />} label="助手" onClick={onOpenAssistant} />
        <ActionButton disabled={busy} icon={<FileDown size={18} />} label="导出笔记" highlight onClick={onExport} />
        <button
          type="button"
          className="ml-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
          onClick={onOpenAssistant}
        >
          <span className="inline-flex items-center gap-2">
            <PanelRightOpen size={16} />
            打开侧栏
          </span>
        </button>
      </div>
    </header>
  );
};

const ActionButton = ({
  disabled = false,
  icon,
  label,
  highlight = false,
  onClick,
}: {
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  highlight?: boolean;
  onClick: () => void;
}) => (
  <button
    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-60 ${
    highlight 
    ? 'bg-teal-600 text-white hover:bg-teal-700 shadow-sm shadow-teal-100' 
    : 'text-slate-600 hover:bg-slate-100'
  }`}
    disabled={disabled}
    onClick={onClick}
  >
    {icon}
    <span>{label}</span>
  </button>
);
