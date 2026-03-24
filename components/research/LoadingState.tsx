"use client";

import React from "react";
import { Sparkles, FileText, Languages, BrainCircuit } from "lucide-react";

export const LoadingState = ({ stage }: { stage: "uploading" | "parsing" }) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-50">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center space-y-4">
          <div className="relative w-24 h-24 mx-auto">
            <div className="absolute inset-0 border-4 border-teal-100 rounded-full" />
            <div className="absolute inset-0 border-4 border-teal-600 rounded-full border-t-transparent animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center text-teal-600">
              <FileText size={32} />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-slate-900">
            {stage === "uploading" ? "正在上传论文..." : "正在深度解析论文..."}
          </h2>
          <p className="text-slate-500">正在利用本地管线提取正文，并准备后续摘要与翻译</p>
        </div>

        <div className="space-y-4">
          <LoadingStep icon={<FileText size={18} />} label="上传 PDF 文件" progress={stage === "uploading" ? 70 : 100} active={stage === "uploading"} />
          <LoadingStep icon={<Sparkles size={18} />} label="解析正文与切分段落" progress={stage === "parsing" ? 70 : 0} active={stage === "parsing"} />
          <LoadingStep icon={<Languages size={18} />} label="多语言翻译对齐" progress={0} />
          <LoadingStep icon={<BrainCircuit size={18} />} label="构建知识向量库" progress={0} />
        </div>
      </div>
    </div>
  );
};

const LoadingStep = ({
  icon,
  label,
  progress,
  active = false,
}: {
  icon: React.ReactNode;
  label: string;
  progress: number;
  active?: boolean;
}) => (
  <div className={`p-4 rounded-2xl border transition-all ${active ? 'bg-white border-teal-200 shadow-sm' : 'bg-slate-50 border-slate-100 opacity-60'}`}>
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-3">
        <div className={active ? 'text-teal-600' : 'text-slate-400'}>{icon}</div>
        <span className={`text-sm font-semibold ${active ? 'text-slate-900' : 'text-slate-500'}`}>{label}</span>
      </div>
      <span className="text-[10px] font-bold text-slate-400">{progress}%</span>
    </div>
    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div 
        className={`h-full rounded-full transition-all duration-1000 ${active ? 'bg-teal-500 animate-pulse' : 'bg-slate-200'}`}
        style={{ width: `${progress}%` }}
      />
    </div>
  </div>
);
