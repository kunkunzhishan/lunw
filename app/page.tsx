"use client";

import { useEffect, useState } from "react";

import { EmptyState } from "@/components/research/EmptyState";
import { LoadingState } from "@/components/research/LoadingState";
import { PaperReader } from "@/components/research/PaperReader";
import { RightPanel, type ChatContextRef, type RightPanelTab } from "@/components/research/RightPanel";
import { Sidebar } from "@/components/research/Sidebar";
import { TopBar } from "@/components/research/TopBar";
import type { PaperRecord, PaperStatus, RecommendationResponse, TextPaperBlock } from "@/lib/types";

type ViewState = "idle" | "uploading" | "parsing" | "ready" | "error";

interface PaperListItem {
  id: string;
  title: string;
  authors: string[];
  repositoryId: string;
  status: PaperStatus;
  createdAt: string;
  updatedAt: string;
}

interface RepositoryListItem {
  id: string;
  name: string;
  paperCount: number;
  createdAt: string;
  updatedAt: string;
}

interface AppSettingsForm {
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
  obsidianExportDir: string;
  mineruApiToken: string;
}

interface ApiErrorPayload {
  error: string;
}

interface DirectoryPickerPayload {
  directory?: string;
  canceled?: boolean;
}

const DEFAULT_REPOSITORY_ID = "repo-default";

const statusToView = (status: PaperStatus): ViewState =>
  status === "ready" ? "ready" : status === "error" ? "error" : status;

const normalizeRepositoryId = (value: string | undefined) => value?.trim() || DEFAULT_REPOSITORY_ID;

async function parseJsonResponse<T>(response: Response): Promise<T | ApiErrorPayload> {
  const raw = await response.text();
  if (!raw.trim()) {
    return { error: `服务返回空响应（HTTP ${response.status}）` };
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return { error: `服务返回非 JSON 响应（HTTP ${response.status}）` };
  }
}

function hasApiError(payload: unknown): payload is ApiErrorPayload {
  return Boolean(payload && typeof payload === "object" && "error" in payload);
}

export default function ResearchPage() {
  const [papers, setPapers] = useState<PaperListItem[]>([]);
  const [repositories, setRepositories] = useState<RepositoryListItem[]>([]);
  const [activePaper, setActivePaper] = useState<PaperRecord | null>(null);
  const [viewState, setViewState] = useState<ViewState>("idle");
  const [activeTab, setActiveTab] = useState<RightPanelTab>("chat");
  const [chatInput, setChatInput] = useState("");
  const [chatContextRefs, setChatContextRefs] = useState<ChatContextRef[]>([]);
  const [selectedPaperIds, setSelectedPaperIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [directionQuery, setDirectionQuery] = useState("");
  const [recommendationScope, setRecommendationScope] = useState<"current" | "history" | "direction">("current");
  const [recommendationData, setRecommendationData] = useState<RecommendationResponse | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [assistantWidth, setAssistantWidth] = useState(420);
  const [isResizingAssistant, setIsResizingAssistant] = useState(false);
  const [activeRepositoryFilter, setActiveRepositoryFilter] = useState("all");
  const [uploadRepositoryId, setUploadRepositoryId] = useState(DEFAULT_REPOSITORY_ID);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [obsidianDirPicking, setObsidianDirPicking] = useState(false);
  const [settingsForm, setSettingsForm] = useState<AppSettingsForm>({
    llmBaseUrl: "",
    llmModel: "",
    llmApiKey: "",
    obsidianExportDir: "",
    mineruApiToken: "",
  });

  async function fetchRepositories() {
    const response = await fetch("/api/repositories");
    const payload = (await response.json()) as RepositoryListItem[] | { error: string };
    if (!response.ok || !Array.isArray(payload)) {
      throw new Error(!Array.isArray(payload) ? payload.error : "加载仓库失败");
    }

    setRepositories(payload);
    setUploadRepositoryId((current) => {
      if (payload.some((item) => item.id === current)) {
        return current;
      }
      return payload[0]?.id ?? DEFAULT_REPOSITORY_ID;
    });
    setActiveRepositoryFilter((current) => {
      if (current === "all") {
        return current;
      }
      return payload.some((item) => item.id === current) ? current : "all";
    });
    return payload;
  }

  async function fetchSettings() {
    const response = await fetch("/api/settings");
    const payload = await parseJsonResponse<AppSettingsForm>(response);
    if (!response.ok || hasApiError(payload)) {
      throw new Error(hasApiError(payload) ? payload.error : "加载设置失败");
    }

    setSettingsForm(payload);
    return payload;
  }

  async function fetchPapers() {
    const response = await fetch("/api/papers");
    const payload = (await response.json()) as (PaperListItem & { repositoryId?: string })[] | { error: string };
    if (!response.ok || !Array.isArray(payload)) {
      throw new Error(!Array.isArray(payload) ? payload.error : "加载论文列表失败");
    }

    const normalized = payload.map((paper) => ({
      ...paper,
      repositoryId: normalizeRepositoryId(paper.repositoryId),
    }));
    setPapers(normalized);
    return normalized;
  }

  async function fetchPaper(id: string) {
    const response = await fetch(`/api/papers/${id}`);
    const payload = (await response.json()) as PaperRecord | { error: string };

    if (!response.ok || "error" in payload) {
      throw new Error("error" in payload ? payload.error : "加载论文失败");
    }

    setActivePaper({
      ...payload,
      repositoryId: normalizeRepositoryId(payload.repositoryId),
    });
    setChatContextRefs([]);
    setSummaryModalOpen(false);
    setViewState(statusToView(payload.status));
    if (payload.recommendationPlan && payload.recommendationSources) {
      setRecommendationData({
        plan: payload.recommendationPlan,
        items: payload.recommendations,
        sourcesUsed: payload.recommendationSources,
      });
    } else {
      setRecommendationData(null);
    }
    return payload;
  }

  async function handleSaveSettings() {
    setError(null);
    setSettingsSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsForm),
      });
      const payload = await parseJsonResponse<AppSettingsForm>(response);
      if (!response.ok || hasApiError(payload)) {
        throw new Error(hasApiError(payload) ? payload.error : "保存设置失败");
      }
      setSettingsForm(payload);
      setSettingsOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存设置失败");
    } finally {
      setSettingsSaving(false);
    }
  }

  async function handlePickObsidianDir() {
    setError(null);
    setObsidianDirPicking(true);
    try {
      const response = await fetch("/api/system/pick-directory", {
        method: "POST",
      });
      const payload = await parseJsonResponse<DirectoryPickerPayload>(response);
      if (!response.ok || hasApiError(payload)) {
        throw new Error(hasApiError(payload) ? payload.error : "选择目录失败");
      }
      if (payload.canceled) {
        return;
      }
      if (!payload.directory?.trim()) {
        throw new Error("未获取到目录路径，请重试。");
      }
      setSettingsForm((current) => ({ ...current, obsidianExportDir: payload.directory ?? current.obsidianExportDir }));
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : "选择目录失败");
    } finally {
      setObsidianDirPicking(false);
    }
  }

  useEffect(() => {
    if (!isResizingAssistant) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = window.innerWidth - event.clientX;
      setAssistantWidth(Math.max(320, Math.min(760, nextWidth)));
    };
    const handleMouseUp = () => {
      setIsResizingAssistant(false);
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingAssistant]);

  useEffect(() => {
    fetchSettings().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "加载设置失败");
    });

    Promise.all([fetchRepositories(), fetchPapers()])
      .then(([, paperItems]) => {
        if (paperItems[0]) {
          return fetchPaper(paperItems[0].id);
        }
        return null;
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "初始化失败");
        setViewState("error");
      });
  }, []);

  async function handleFileUpload(file: File, repositoryId: string) {
    const normalizedName = file.name.trim();

    if (!normalizedName) {
      setError("文件名为空，请重新选择 PDF。");
      setViewState("error");
      return;
    }

    if (file.size <= 0) {
      setError("文件内容为空，请重新选择 PDF。");
      setViewState("error");
      return;
    }

    setError(null);
    setViewState("uploading");
    setIsBusy(true);

    try {
      const uploadFile = new File([file], normalizedName, {
        type: file.type || "application/pdf",
        lastModified: file.lastModified,
      });
      const formData = new FormData();
      formData.append("file", uploadFile, normalizedName);
      formData.append("repositoryId", repositoryId);
      setViewState("parsing");

      const response = await fetch("/api/papers/upload", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as PaperRecord | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "上传失败");
      }

      await Promise.all([fetchRepositories(), fetchPapers()]);
      setActivePaper({
        ...payload,
        repositoryId: normalizeRepositoryId(payload.repositoryId),
      });
      setSelectedPaperIds([]);
      setChatContextRefs([]);
      setSummaryModalOpen(false);
      setRecommendationData(null);
      setViewState(statusToView(payload.status));
      setActiveTab("chat");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传失败");
      setViewState("error");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCreateRepository(name: string) {
    setError(null);
    try {
      const response = await fetch("/api/repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json()) as RepositoryListItem | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "创建仓库失败");
      }
      await fetchRepositories();
      setActiveRepositoryFilter(payload.id);
      setUploadRepositoryId(payload.id);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "创建仓库失败");
    }
  }

  async function handleRenameRepository(id: string, name: string) {
    setError(null);
    try {
      const response = await fetch(`/api/repositories/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json()) as RepositoryListItem | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "重命名仓库失败");
      }
      await fetchRepositories();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "重命名仓库失败");
    }
  }

  async function handleDeleteRepository(id: string) {
    setError(null);
    setIsBusy(true);
    try {
      const response = await fetch(`/api/repositories/${id}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "删除仓库失败");
      }

      await Promise.all([fetchRepositories(), fetchPapers()]);
      setSelectedPaperIds([]);
      if (activeRepositoryFilter === id) {
        setActiveRepositoryFilter("all");
      }
      if (uploadRepositoryId === id) {
        setUploadRepositoryId(DEFAULT_REPOSITORY_ID);
      }
      if (activePaper?.repositoryId === id) {
        await fetchPaper(activePaper.id);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "删除仓库失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleMovePapers(ids: string[], repositoryId: string) {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) {
      return;
    }

    setError(null);
    setIsBusy(true);
    try {
      const response = await fetch("/api/papers/batch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: uniqueIds, repositoryId }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "移动论文失败");
      }

      await Promise.all([fetchRepositories(), fetchPapers()]);
      setSelectedPaperIds((current) => current.filter((id) => !uniqueIds.includes(id)));
      if (activePaper && uniqueIds.includes(activePaper.id)) {
        await fetchPaper(activePaper.id);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "移动论文失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDeletePapers(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) {
      return;
    }

    setError(null);
    setIsBusy(true);

    try {
      const response = await fetch("/api/papers/batch", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: uniqueIds }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "删除失败");
      }

      const [, refreshedPapers] = await Promise.all([fetchRepositories(), fetchPapers()]);
      setSelectedPaperIds((current) => current.filter((id) => !uniqueIds.includes(id)));

      if (!activePaper || !uniqueIds.includes(activePaper.id)) {
        return;
      }

      setAssistantOpen(false);
      setSummaryModalOpen(false);
      setChatContextRefs([]);
      setRecommendationData(null);

      const nextPaper = refreshedPapers.find((paper) =>
        activeRepositoryFilter === "all" ? true : paper.repositoryId === activeRepositoryFilter,
      );

      if (nextPaper) {
        await fetchPaper(nextPaper.id);
      } else {
        setActivePaper(null);
        setViewState("idle");
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "删除失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSummarize() {
    if (!activePaper) {
      return;
    }

    if (activePaper.summary) {
      setSummaryModalOpen(true);
      return;
    }

    setError(null);
    setIsBusy(true);

    try {
      const response = await fetch(`/api/papers/${activePaper.id}/summarize`, {
        method: "POST",
      });
      const payload = (await response.json()) as PaperRecord | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "操作失败");
      }

      setActivePaper({
        ...payload,
        repositoryId: normalizeRepositoryId(payload.repositoryId),
      });
      await Promise.all([fetchRepositories(), fetchPapers()]);
      setSummaryModalOpen(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "操作失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleChatSubmit() {
    if (!activePaper || !chatInput.trim()) {
      return;
    }

    setError(null);
    setIsBusy(true);

    try {
      const response = await fetch(`/api/papers/${activePaper.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: chatInput,
          contextBlockIds: chatContextRefs.map((item) => item.blockId),
        }),
      });

      const payload = (await response.json()) as PaperRecord | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "问答失败");
      }

      setActivePaper({
        ...payload,
        repositoryId: normalizeRepositoryId(payload.repositoryId),
      });
      setChatInput("");
      setChatContextRefs([]);
      setActiveTab("chat");
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "问答失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRecommend(scope: "current" | "history" | "direction") {
    setRecommendationScope(scope);
    setActiveTab("related");
    setError(null);
    setIsBusy(true);

    try {
      const response = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paperId: activePaper?.id,
          type: scope,
          query: scope === "direction" ? directionQuery : undefined,
        }),
      });

      const payload = (await response.json()) as RecommendationResponse | { error?: string };
      if (!response.ok || "error" in payload) {
        throw new Error(("error" in payload ? payload.error : undefined) ?? "推荐失败");
      }
      const recommendationPayload = payload as RecommendationResponse;

      if (activePaper) {
        setActivePaper({
          ...activePaper,
          recommendations: recommendationPayload.items,
          recommendationPlan: recommendationPayload.plan,
          recommendationSources: recommendationPayload.sourcesUsed,
        });
      }
      setRecommendationData(recommendationPayload);
    } catch (recommendError) {
      setError(recommendError instanceof Error ? recommendError.message : "推荐失败");
      setRecommendationData(null);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleExport() {
    if (!activePaper) {
      return;
    }

    const defaultFileName = activePaper.title.replace(/[\\/:*?"<>|]+/g, "_").trim() || activePaper.id;
    const fileNameInput = window.prompt("导出文件名（不需要 .md）", defaultFileName);
    if (fileNameInput === null) {
      return;
    }
    const fileName = fileNameInput.trim() || defaultFileName;

    setError(null);
    setIsBusy(true);

    try {
      const response = await fetch("/api/notes/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperId: activePaper.id, fileName }),
      });
      const payload = await parseJsonResponse<{ error?: string }>(response);
      if (!response.ok) {
        throw new Error(hasApiError(payload) ? payload.error : payload.error ?? "导出失败");
      }

      await fetchPaper(activePaper.id);
      setActiveTab("notes");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "导出失败");
    } finally {
      setIsBusy(false);
    }
  }

  function handleQuoteBlock(block: TextPaperBlock) {
    setAssistantOpen(true);
    setActiveTab("chat");
    const snippet = block.english.replace(/\s+/g, " ").trim();
    const label = snippet.length > 48 ? `${snippet.slice(0, 48)}...` : snippet;
    setChatContextRefs((current) => {
      if (current.some((item) => item.blockId === block.id)) {
        return current;
      }
      return [...current, { blockId: block.id, label: `P${block.page} · ${label}` }];
    });
  }

  async function handleAddAnnotation(params: {
    block: TextPaperBlock;
    content: string;
    quoteText?: string;
    quoteStart?: number;
    quoteEnd?: number;
    threadId?: string;
  }) {
    if (!activePaper) {
      return;
    }

    setError(null);
    setIsBusy(true);
    try {
      const response = await fetch(`/api/papers/${activePaper.id}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId: params.block.id,
          content: params.content,
          quoteText: params.quoteText,
          quoteStart: params.quoteStart,
          quoteEnd: params.quoteEnd,
          threadId: params.threadId,
        }),
      });
      const payload = (await response.json()) as PaperRecord | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "添加批注失败");
      }

      setActivePaper({
        ...payload,
        repositoryId: normalizeRepositoryId(payload.repositoryId),
      });
      await fetchPapers();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "添加批注失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDeleteAnnotation(annotationId: string) {
    if (!activePaper) {
      return;
    }

    setError(null);
    setIsBusy(true);
    try {
      const response = await fetch(`/api/papers/${activePaper.id}/annotations`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          annotationId,
        }),
      });
      const payload = (await response.json()) as PaperRecord | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "删除批注失败");
      }

      setActivePaper({
        ...payload,
        repositoryId: normalizeRepositoryId(payload.repositoryId),
      });
      await fetchPapers();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "删除批注失败");
    } finally {
      setIsBusy(false);
    }
  }

  const filteredBlocks =
    activePaper?.blocks.filter((block) => {
      if (!searchQuery.trim()) {
        return true;
      }

      const haystack = `${"english" in block ? (block.english ?? "") : ""} ${
        "chinese" in block ? (block.chinese ?? "") : ""
      } ${"latex" in block ? (block.latex ?? "") : ""}`.toLowerCase();
      return haystack.includes(searchQuery.toLowerCase());
    }) ?? [];

  return (
    <div className="flex h-screen overflow-hidden text-slate-900 font-sans">
      <Sidebar
        activeId={activePaper?.id}
        activeRepositoryId={activeRepositoryFilter}
        uploadRepositoryId={uploadRepositoryId}
        selectedPaperIds={selectedPaperIds}
        onDeletePaper={(id) => void handleDeletePapers([id])}
        onDeletePapers={(ids) => void handleDeletePapers(ids)}
        onDeleteRepository={(id) => void handleDeleteRepository(id)}
        onFileSelected={(file, repositoryId) => void handleFileUpload(file, repositoryId)}
        onMovePapers={(ids, repositoryId) => void handleMovePapers(ids, repositoryId)}
        onRenameRepository={(id, name) => void handleRenameRepository(id, name)}
        onRepositoryFilterChange={setActiveRepositoryFilter}
        onRepositoryForUploadChange={setUploadRepositoryId}
        onOpenSettings={() => setSettingsOpen(true)}
        onSelect={(id) => {
          setActiveTab("chat");
          void fetchPaper(id).catch((loadError) => {
            setError(loadError instanceof Error ? loadError.message : "加载论文失败");
            setViewState("error");
          });
        }}
        onTogglePaperSelection={(id, checked) =>
          setSelectedPaperIds((current) =>
            checked ? (current.includes(id) ? current : [...current, id]) : current.filter((item) => item !== id),
          )}
        onCreateRepository={(name) => void handleCreateRepository(name)}
        papers={papers}
        repositories={repositories}
      />

      <div className="flex min-w-0 flex-1 flex-col bg-[#f8f9fa]">
        <TopBar
          activePaperTitle={activePaper?.title}
          busy={isBusy}
          onExport={() => void handleExport()}
          onOpenAssistant={() => setAssistantOpen(true)}
          onSearchChange={setSearchQuery}
          onSummarize={() => void handleSummarize()}
          searchQuery={searchQuery}
        />

        {error ? (
          <div className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <main className="flex flex-1 overflow-hidden">
          {(viewState === "idle" || !activePaper) && (
            <EmptyState onFileSelected={(file) => void handleFileUpload(file, uploadRepositoryId)} />
          )}

          {(viewState === "uploading" || viewState === "parsing") && (
            <LoadingState stage={viewState === "uploading" ? "uploading" : "parsing"} />
          )}

          {viewState === "error" && !activePaper && (
            <EmptyState onFileSelected={(file) => void handleFileUpload(file, uploadRepositoryId)} />
          )}

          {activePaper && viewState === "ready" && (
            <PaperReader
              paper={activePaper}
              searchQuery={searchQuery}
              blocks={filteredBlocks}
              quotedBlockIds={chatContextRefs.map((item) => item.blockId)}
              onAddAnnotation={(params) => void handleAddAnnotation(params)}
              onDeleteAnnotation={(annotationId) => void handleDeleteAnnotation(annotationId)}
              onQuoteBlock={handleQuoteBlock}
            />
          )}
        </main>
      </div>

      {activePaper && assistantOpen ? (
        <div className="fixed inset-0 z-30 bg-slate-900/20 backdrop-blur-[1px]">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            onClick={() => setAssistantOpen(false)}
          />
          <div
            className="absolute right-0 top-0 flex h-full flex-col shadow-2xl"
            style={{ width: `${assistantWidth}px` }}
          >
            <div
              className="absolute left-0 top-0 z-10 h-full w-2 -translate-x-1/2 cursor-col-resize"
              onMouseDown={() => setIsResizingAssistant(true)}
            />
            <div className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4">
              <div>
                <div className="text-sm font-semibold text-slate-800">助手侧栏</div>
                <div className="text-xs text-slate-500">问答、推荐和笔记先放这里，不打断阅读。</div>
              </div>
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                onClick={() => setAssistantOpen(false)}
              >
                关闭
              </button>
            </div>
            <RightPanel
              activeScope={recommendationScope}
              activeTab={activeTab}
              busy={isBusy}
              chatInput={chatInput}
              chatContextRefs={chatContextRefs}
              messages={activePaper.chatHistory}
              note={activePaper.lastExport}
              onChangeScope={(scope) => void handleRecommend(scope)}
              onChatInputChange={setChatInput}
              onClearChatContext={() => setChatContextRefs([])}
              onRemoveChatContext={(blockId) =>
                setChatContextRefs((current) => current.filter((item) => item.blockId !== blockId))}
              onSubmitChat={() => void handleChatSubmit()}
              onTabChange={setActiveTab}
              recommendationData={recommendationData}
              recommendations={activePaper.recommendations}
            />
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-[1px]">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            onClick={() => setSettingsOpen(false)}
          />
          <div className="absolute left-1/2 top-1/2 w-[min(760px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">系统设置</div>
                <div className="text-xs text-slate-500">LLM 接口、Obsidian 路径、PDF 处理 token</div>
              </div>
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                onClick={() => setSettingsOpen(false)}
              >
                关闭
              </button>
            </div>

            <div className="space-y-4 p-5">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">LLM Base URL</span>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
                  value={settingsForm.llmBaseUrl}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, llmBaseUrl: event.target.value }))}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">LLM Model</span>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
                  value={settingsForm.llmModel}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, llmModel: event.target.value }))}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">LLM API Key</span>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
                  value={settingsForm.llmApiKey}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, llmApiKey: event.target.value }))}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">Obsidian 导出目录</span>
                <div className="flex items-center gap-2">
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
                    value={settingsForm.obsidianExportDir}
                    placeholder="点击右侧“选择目录”"
                    onChange={(event) =>
                      setSettingsForm((current) => ({ ...current, obsidianExportDir: event.target.value }))}
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                    disabled={obsidianDirPicking}
                    onClick={() => void handlePickObsidianDir()}
                  >
                    {obsidianDirPicking ? "选择中..." : "选择目录"}
                  </button>
                </div>
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-slate-700">PDF 处理 Token (MinerU API)</span>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
                  value={settingsForm.mineruApiToken}
                  onChange={(event) =>
                    setSettingsForm((current) => ({ ...current, mineruApiToken: event.target.value }))}
                />
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                onClick={() => setSettingsOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm text-white hover:bg-teal-700 disabled:opacity-60"
                disabled={settingsSaving}
                onClick={() => void handleSaveSettings()}
              >
                {settingsSaving ? "保存中..." : "保存设置"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {summaryModalOpen && activePaper?.summary ? (
        <div className="fixed inset-0 z-40 bg-slate-900/35 backdrop-blur-[1px]">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            onClick={() => setSummaryModalOpen(false)}
          />
          <div className="absolute left-1/2 top-1/2 max-h-[85vh] w-[min(860px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">论文摘要</div>
                <div className="text-xs text-slate-500">{activePaper.title}</div>
              </div>
              <button
                type="button"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                onClick={() => setSummaryModalOpen(false)}
              >
                关闭
              </button>
            </div>
            <div className="max-h-[calc(85vh-64px)] overflow-y-auto p-5 text-sm leading-7 text-slate-700">
              <div className="mb-3 text-sm font-semibold text-slate-800">一句话总结</div>
              <p className="mb-5">{activePaper.summary.oneLiner}</p>

              <div className="mb-2 text-sm font-semibold text-slate-800">研究问题</div>
              <p className="mb-5">{activePaper.summary.researchProblem}</p>

              <div className="mb-2 text-sm font-semibold text-slate-800">核心方法</div>
              <p className="mb-5">{activePaper.summary.coreMethod}</p>

              <div className="mb-2 text-sm font-semibold text-slate-800">实验结论</div>
              <p className="mb-5">{activePaper.summary.findings}</p>

              <div className="mb-2 text-sm font-semibold text-slate-800">创新点</div>
              <ul className="mb-5 list-disc space-y-1 pl-5">
                {activePaper.summary.innovations.map((item) => <li key={item}>{item}</li>)}
              </ul>

              <div className="mb-2 text-sm font-semibold text-slate-800">局限性</div>
              <ul className="mb-5 list-disc space-y-1 pl-5">
                {activePaper.summary.limitations.map((item) => <li key={item}>{item}</li>)}
              </ul>

              <div className="mb-2 text-sm font-semibold text-slate-800">延伸想法</div>
              <ul className="list-disc space-y-1 pl-5">
                {activePaper.summary.ideas.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
