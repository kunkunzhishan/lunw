"use client";

import React from "react";
import {
  BookOpen,
  Folder,
  History,
  Library,
  Plus,
  Settings,
  Trash2,
  ArrowRightLeft,
  CheckSquare,
} from "lucide-react";

interface Paper {
  id: string;
  title: string;
  authors: string[];
  repositoryId: string;
  updatedAt: string;
  status: string;
}

interface Repository {
  id: string;
  name: string;
  paperCount: number;
}

interface RepositoryContextMenu {
  repositoryId: string;
  repositoryName: string;
  x: number;
  y: number;
}

export const Sidebar = ({
  activeId,
  activeRepositoryId,
  uploadRepositoryId,
  selectedPaperIds,
  onDeletePaper,
  onDeletePapers,
  onDeleteRepository,
  onFileSelected,
  onMovePapers,
  onRenameRepository,
  onRepositoryFilterChange,
  onRepositoryForUploadChange,
  onOpenSettings,
  onSelect,
  onTogglePaperSelection,
  onCreateRepository,
  papers,
  repositories,
}: {
  activeId?: string;
  activeRepositoryId: string;
  uploadRepositoryId: string;
  selectedPaperIds: string[];
  onDeletePaper: (id: string) => void;
  onDeletePapers: (ids: string[]) => void;
  onDeleteRepository: (id: string) => void;
  onFileSelected: (file: File, repositoryId: string) => void;
  onMovePapers: (ids: string[], repositoryId: string) => void;
  onRenameRepository: (id: string, name: string) => void;
  onRepositoryFilterChange: (repositoryId: string) => void;
  onRepositoryForUploadChange: (repositoryId: string) => void;
  onOpenSettings: () => void;
  onSelect: (id: string) => void;
  onTogglePaperSelection: (id: string, checked: boolean) => void;
  onCreateRepository: (name: string) => void;
  papers: Paper[];
  repositories: Repository[];
}) => {
  const [dragOverRepositoryId, setDragOverRepositoryId] = React.useState<string | null>(null);
  const [bulkTargetRepositoryId, setBulkTargetRepositoryId] = React.useState(uploadRepositoryId);
  const [isUploadDragOver, setIsUploadDragOver] = React.useState(false);
  const [isCreatingRepository, setIsCreatingRepository] = React.useState(false);
  const [creatingRepositoryName, setCreatingRepositoryName] = React.useState("");
  const [editingRepositoryId, setEditingRepositoryId] = React.useState<string | null>(null);
  const [editingRepositoryName, setEditingRepositoryName] = React.useState("");
  const [repositoryMenu, setRepositoryMenu] = React.useState<RepositoryContextMenu | null>(null);

  React.useEffect(() => {
    if (!repositories.length) {
      return;
    }
    if (!repositories.some((repository) => repository.id === bulkTargetRepositoryId)) {
      setBulkTargetRepositoryId(repositories[0].id);
    }
  }, [bulkTargetRepositoryId, repositories]);

  React.useEffect(() => {
    if (!repositoryMenu) {
      return;
    }

    const closeMenu = () => setRepositoryMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [repositoryMenu]);

  const visiblePapers = papers.filter((paper) =>
    activeRepositoryId === "all" ? true : paper.repositoryId === activeRepositoryId,
  );

  const selectedSet = new Set(selectedPaperIds);
  const selectedVisibleIds = visiblePapers
    .filter((paper) => selectedSet.has(paper.id))
    .map((paper) => paper.id);
  const allVisibleSelected = visiblePapers.length > 0 && selectedVisibleIds.length === visiblePapers.length;

  const handleDropToRepository = (event: React.DragEvent<HTMLButtonElement>, repositoryId: string) => {
    event.preventDefault();
    setDragOverRepositoryId(null);

    let ids: string[] = [];
    const raw = event.dataTransfer.getData("application/json");
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { paperIds?: unknown };
        ids = Array.isArray(parsed.paperIds)
          ? parsed.paperIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          : [];
      } catch {
        ids = [];
      }
    }

    if (!ids.length) {
      return;
    }
    onMovePapers(ids, repositoryId);
  };

  const finishCreateRepository = () => {
    const normalized = creatingRepositoryName.trim();
    if (normalized) {
      onCreateRepository(normalized);
    }
    setCreatingRepositoryName("");
    setIsCreatingRepository(false);
  };

  const finishRenameRepository = (repositoryId: string) => {
    const normalized = editingRepositoryName.trim();
    if (normalized) {
      onRenameRepository(repositoryId, normalized);
    }
    setEditingRepositoryId(null);
    setEditingRepositoryName("");
  };

  const handleUploadDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsUploadDragOver(false);
    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    const pdfFile = droppedFiles.find((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (pdfFile) {
      onFileSelected(pdfFile, uploadRepositoryId);
    }
  };

  return (
    <div className="w-72 h-full min-h-0 overflow-hidden border-r border-slate-200 bg-white flex flex-col shrink-0">
      <div className="p-5">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center text-white font-bold">
            R
          </div>
          <span className="font-bold text-lg tracking-tight">ScholarBase</span>
        </div>

        <div
          className={`rounded-2xl border p-3 space-y-2 transition-colors ${
            isUploadDragOver ? "border-teal-400 bg-teal-50" : "border-slate-200 bg-slate-50"
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsUploadDragOver(true);
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsUploadDragOver(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setIsUploadDragOver(false);
            }
          }}
          onDrop={handleUploadDrop}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Plus size={16} className="text-teal-600" />
            <span>导入论文</span>
          </div>
          <select
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600"
            value={uploadRepositoryId}
            onChange={(event) => onRepositoryForUploadChange(event.target.value)}
          >
            {repositories.map((repository) => (
              <option key={repository.id} value={repository.id}>
                导入到：{repository.name}
              </option>
            ))}
          </select>
          <label
            className={`block w-full cursor-pointer rounded-xl border px-3 py-2 text-center text-sm ${
              isUploadDragOver
                ? "border-teal-300 bg-white text-teal-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
          >
            {isUploadDragOver ? "松开以上传 PDF" : "拖拽 PDF 到这里，或点击选择"}
            <input
              accept="application/pdf"
              className="hidden"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file) {
                  onFileSelected(file, uploadRepositoryId);
                }
              }}
            />
          </label>
        </div>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto px-4 pb-6 space-y-6">
        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">主菜单</h3>
          <div className="space-y-1">
            <NavItem icon={<Library size={18} />} label="我的书库" active />
            <NavItem icon={<History size={18} />} label="最近阅读" />
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between px-2">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">仓库</h3>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
              title="新建仓库"
              onClick={() => {
                setIsCreatingRepository(true);
                setEditingRepositoryId(null);
                setEditingRepositoryName("");
              }}
            >
              <Plus size={13} />
            </button>
          </div>

          {isCreatingRepository ? (
            <div className="mb-2 px-2">
              <div className="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-2 py-1.5">
                <Folder size={14} className="shrink-0 text-teal-600" />
                <input
                  autoFocus
                  type="text"
                  className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                  placeholder="输入仓库名后回车"
                  value={creatingRepositoryName}
                  onChange={(event) => setCreatingRepositoryName(event.target.value)}
                  onBlur={finishCreateRepository}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      finishCreateRepository();
                    }
                    if (event.key === "Escape") {
                      setCreatingRepositoryName("");
                      setIsCreatingRepository(false);
                    }
                  }}
                />
              </div>
            </div>
          ) : null}

          <div className="space-y-1">
            <RepositoryItem
              active={activeRepositoryId === "all"}
              count={papers.length}
              label="全部论文"
              onClick={() => onRepositoryFilterChange("all")}
            />
            {repositories.map((repository) => (
              <div key={repository.id} className="group">
                <div
                  className={`flex items-center rounded-lg transition-colors ${
                    activeRepositoryId === repository.id
                      ? "bg-teal-50 font-medium text-teal-700"
                      : "text-slate-600 hover:bg-slate-50"
                  } ${dragOverRepositoryId === repository.id ? "ring-2 ring-teal-300" : ""}`}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center justify-between px-2 py-1.5 text-sm"
                    onClick={() => onRepositoryFilterChange(repository.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setRepositoryMenu({
                        repositoryId: repository.id,
                        repositoryName: repository.name,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOverRepositoryId(repository.id);
                    }}
                    onDragLeave={() => setDragOverRepositoryId((current) => (current === repository.id ? null : current))}
                    onDrop={(event) => handleDropToRepository(event, repository.id)}
                  >
                    <span className="min-w-0 truncate flex items-center gap-2">
                      <Folder size={14} />
                      {editingRepositoryId === repository.id ? (
                        <input
                          autoFocus
                          type="text"
                          className="w-full min-w-0 bg-transparent text-sm outline-none"
                          value={editingRepositoryName}
                          onChange={(event) => setEditingRepositoryName(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          onBlur={() => finishRenameRepository(repository.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              finishRenameRepository(repository.id);
                            }
                            if (event.key === "Escape") {
                              setEditingRepositoryId(null);
                              setEditingRepositoryName("");
                            }
                          }}
                        />
                      ) : (
                        repository.name
                      )}
                    </span>
                    <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                      {repository.paperCount}
                    </span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between px-2">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">论文列表</h3>
            <span className="text-[11px] text-slate-400">可拖拽到仓库</span>
          </div>

          {visiblePapers.length > 0 ? (
            <div className="mb-2 rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
              <label className="mb-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    for (const paper of visiblePapers) {
                      onTogglePaperSelection(paper.id, checked);
                    }
                  }}
                />
                <span className="inline-flex items-center gap-1">
                  <CheckSquare size={12} />
                  全选可见
                </span>
              </label>

              {selectedPaperIds.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-[11px] text-slate-500">已选 {selectedPaperIds.length} 篇</div>
                  <div className="flex items-center gap-2">
                    <select
                      className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px]"
                      value={bulkTargetRepositoryId}
                      onChange={(event) => setBulkTargetRepositoryId(event.target.value)}
                    >
                      {repositories.map((repository) => (
                        <option key={repository.id} value={repository.id}>
                          {repository.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] hover:bg-slate-50"
                      onClick={() => onMovePapers(selectedPaperIds, bulkTargetRepositoryId)}
                    >
                      <ArrowRightLeft size={12} />
                      移动
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] text-red-600 hover:bg-red-50"
                      onClick={() => {
                        const confirmed = window.confirm(`确认删除选中的 ${selectedPaperIds.length} 篇论文吗？`);
                        if (confirmed) {
                          onDeletePapers(selectedPaperIds);
                        }
                      }}
                    >
                      <Trash2 size={12} />
                      删除
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-slate-500">勾选后可批量删除或批量移动。</div>
              )}
            </div>
          ) : null}

          <div className="space-y-1">
            {visiblePapers.map((paper) => (
              <div
                key={paper.id}
                draggable
                onDragStart={(event) => {
                  const ids = selectedSet.has(paper.id) ? selectedPaperIds : [paper.id];
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/json", JSON.stringify({ paperIds: ids }));
                  event.dataTransfer.setData("text/plain", paper.id);
                }}
                className={`group relative overflow-hidden rounded-lg border transition-colors ${
                  activeId === paper.id
                    ? "border-teal-200 bg-teal-50 text-teal-700"
                    : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-start gap-2 p-2 pr-10">
                  <label className="mt-0.5">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(paper.id)}
                      onChange={(event) => onTogglePaperSelection(paper.id, event.target.checked)}
                    />
                  </label>
                  <button type="button" onClick={() => onSelect(paper.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-start gap-2">
                      <div
                        className={`mt-1 shrink-0 ${
                          activeId === paper.id ? "text-teal-600" : "text-slate-400 group-hover:text-slate-600"
                        }`}
                      >
                        <BookOpen size={16} />
                      </div>
                      <div className="min-w-0 overflow-hidden">
                        <p className="text-sm font-medium leading-tight mb-0.5 break-words">{paper.title}</p>
                        <p className="mt-1 text-[11px] opacity-70 truncate">
                          {(paper.authors[0] || "Unknown author")} · {new Date(paper.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
                <button
                  type="button"
                  title="删除文献"
                  className="absolute right-2 top-2 rounded-md border border-red-200 bg-white p-1 text-red-500 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => {
                    const confirmed = window.confirm(`确认删除《${paper.title}》吗？`);
                    if (confirmed) {
                      onDeletePaper(paper.id);
                    }
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}

            {papers.length === 0 ? <div className="px-2 text-sm text-slate-400">还没有论文，先上传一个 PDF。</div> : null}
            {papers.length > 0 && visiblePapers.length === 0 ? (
              <div className="px-2 text-sm text-slate-400">当前仓库下还没有论文。</div>
            ) : null}
          </div>
        </div>

      </nav>

      {repositoryMenu ? (
        <div
          className="fixed z-50 min-w-[140px] rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
          style={{
            left: `${repositoryMenu.x}px`,
            top: `${repositoryMenu.y}px`,
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="w-full rounded-md px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
            onClick={() => {
              setEditingRepositoryId(repositoryMenu.repositoryId);
              setEditingRepositoryName(repositoryMenu.repositoryName);
              setIsCreatingRepository(false);
              setRepositoryMenu(null);
            }}
          >
            重命名
          </button>
          {repositoryMenu.repositoryId !== "repo-default" ? (
            <button
              type="button"
              className="w-full rounded-md px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
              onClick={() => {
                const confirmed = window.confirm(
                  `确认删除仓库「${repositoryMenu.repositoryName}」吗？其中论文会移动到默认仓库。`,
                );
                if (confirmed) {
                  onDeleteRepository(repositoryMenu.repositoryId);
                }
                setRepositoryMenu(null);
              }}
            >
              删除仓库
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="p-4 border-t border-slate-100 bg-slate-50/50">
        <button
          type="button"
          className="w-full flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:bg-slate-50 transition-all"
          onClick={onOpenSettings}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Settings size={16} className="text-slate-500" />
            <span>设置</span>
          </div>
          <span className="text-[11px] text-slate-400">配置接口与目录</span>
        </button>
      </div>
    </div>
  );
};

const NavItem = ({ icon, label, active = false }: { icon: React.ReactNode; label: string; active?: boolean }) => (
  <button
    type="button"
    className={`w-full flex items-center justify-between p-2 rounded-lg group transition-all ${
      active ? "bg-teal-50 text-teal-700 font-medium" : "text-slate-600 hover:bg-slate-50"
    }`}
  >
    <div className="flex items-center gap-3">
      <span className={active ? "text-teal-600" : "text-slate-400 group-hover:text-slate-600"}>{icon}</span>
      <span className="text-sm">{label}</span>
    </div>
    {active && <div className="w-1 h-4 bg-teal-600 rounded-full" />}
  </button>
);

const RepositoryItem = ({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors ${
      active ? "bg-teal-50 font-medium text-teal-700" : "text-slate-600 hover:bg-slate-50"
    }`}
  >
    <span className="truncate">{label}</span>
    <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{count}</span>
  </button>
);
