"use client";

import React from "react";
import { Upload, FileText, Search, BookOpen } from "lucide-react";

export const EmptyState = ({
  onFileSelected,
}: {
  onFileSelected: (file: File) => void;
}) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-50">
      <div className="max-w-2xl w-full text-center space-y-8">
        <div className="space-y-2">
          <div className="w-20 h-20 bg-teal-100 text-teal-600 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <Upload size={40} />
          </div>
          <h2 className="text-3xl font-bold text-slate-900">开始你的深度研究</h2>
          <p className="text-slate-500 text-lg">上传 PDF 论文，AI 将为你提供摘要、翻译及深度解析</p>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <div className="p-8 bg-white border-2 border-dashed border-slate-200 rounded-3xl hover:border-teal-400 hover:bg-teal-50/30 transition-all group">
            <div className="w-12 h-12 bg-slate-100 text-slate-500 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:bg-teal-100 group-hover:text-teal-600 transition-colors">
              <Upload size={24} />
            </div>
            <h4 className="font-bold text-slate-800">上传本地 PDF</h4>
            <p className="text-xs text-slate-500 mt-1">支持拖拽文件到此处</p>
            <input
              accept="application/pdf"
              className="mt-4 block w-full cursor-pointer rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-teal-700"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onFileSelected(file);
                }
              }}
            />
          </div>
        </div>

        <div className="pt-8 border-t border-slate-200">
          <p className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-6">你可以尝试的功能</p>
          <div className="grid grid-cols-3 gap-6">
            <Feature icon={<FileText size={20} />} title="结构化摘要" desc="提取核心贡献与结论" />
            <Feature icon={<Search size={20} />} title="联网搜索" desc="验证文中引用及背景" />
            <Feature icon={<BookOpen size={20} />} title="相关推荐" desc="基于阅读历史推荐前沿" />
          </div>
        </div>
      </div>
    </div>
  );
};

const Feature = ({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) => (
  <div className="text-center space-y-2">
    <div className="text-teal-600 flex justify-center">{icon}</div>
    <h5 className="text-sm font-bold text-slate-800">{title}</h5>
    <p className="text-[11px] text-slate-500 leading-relaxed">{desc}</p>
  </div>
);
