"use client";

import React from "react";
import { Library, History, TrendingUp, Settings, Plus, BookOpen, Star } from "lucide-react";

interface Paper {
  id: string;
  title: string;
  authors: string[];
  updatedAt: string;
  status: string;
}

export const Sidebar = ({
  activeId,
  onFileSelected,
  onSelect,
  papers,
}: {
  activeId?: string;
  onFileSelected: (file: File) => void;
  onSelect: (id: string) => void;
  papers: Paper[];
}) => {
  return (
    <div className="w-64 h-full border-r border-slate-200 bg-white flex flex-col shrink-0">
      {/* Brand */}
      <div className="p-6">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center text-white font-bold">
            R
          </div>
          <span className="font-bold text-lg tracking-tight">ScholarBase</span>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Plus size={16} className="text-teal-600" />
            <span>上传论文</span>
          </div>
          <input
            accept="application/pdf"
            className="block w-full cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-teal-700"
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

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-4 space-y-6">
        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">主菜单</h3>
          <div className="space-y-1">
            <NavItem icon={<Library size={18} />} label="我的书库" active />
            <NavItem icon={<History size={18} />} label="最近阅读" />
            <NavItem icon={<TrendingUp size={18} />} label="前沿推荐" />
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">论文列表</h3>
          <div className="space-y-1">
            {papers.map((paper) => (
              <button 
                type="button"
                key={paper.id}
                onClick={() => onSelect(paper.id)}
                className={`w-full text-left p-2 rounded-lg group transition-colors ${
                  activeId === paper.id ? 'bg-teal-50 text-teal-700' : 'hover:bg-slate-50 text-slate-600'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className={`mt-1 shrink-0 ${activeId === paper.id ? 'text-teal-600' : 'text-slate-400 group-hover:text-slate-600'}`}>
                    <BookOpen size={16} />
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-sm font-medium truncate leading-tight mb-0.5">{paper.title}</p>
                    <p className="text-[11px] opacity-70 truncate">
                      {(paper.authors[0] || "Unknown author")} · {new Date(paper.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </button>
            ))}
            {papers.length === 0 ? <div className="px-2 text-sm text-slate-400">还没有论文，先上传一个 PDF。</div> : null}
          </div>
        </div>
        
        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">收藏夹</h3>
          <div className="space-y-1 text-sm text-slate-500">
            <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded-lg cursor-pointer">
              <Star size={14} className="text-amber-400" />
              <span>最近导出笔记</span>
            </div>
            <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded-lg cursor-pointer">
              <Star size={14} className="text-amber-400" />
              <span>高频研究方向</span>
            </div>
          </div>
        </div>
      </nav>

      {/* Bottom Profile/Settings */}
      <div className="p-4 border-t border-slate-100 bg-slate-50/50">
        <button className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white transition-all">
          <div className="w-8 h-8 rounded-full bg-slate-200 bg-[url('https://ui-avatars.com/api/?name=User')] bg-cover" />
          <div className="text-left flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">Dr. Researcher</p>
            <p className="text-[11px] text-slate-500">Premium Account</p>
          </div>
          <Settings size={16} className="text-slate-400" />
        </button>
      </div>
    </div>
  );
};

const NavItem = ({ icon, label, active = false }: { icon: React.ReactNode; label: string; active?: boolean }) => (
  <button type="button" className={`w-full flex items-center justify-between p-2 rounded-lg group transition-all ${
    active ? 'bg-teal-50 text-teal-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
  }`}>
    <div className="flex items-center gap-3">
      <span className={active ? 'text-teal-600' : 'text-slate-400 group-hover:text-slate-600'}>
        {icon}
      </span>
      <span className="text-sm">{label}</span>
    </div>
    {active && <div className="w-1 h-4 bg-teal-600 rounded-full" />}
  </button>
);
