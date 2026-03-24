"use client";

import { useEffect, useState } from "react";

import { EmptyState } from "@/components/research/EmptyState";
import { LoadingState } from "@/components/research/LoadingState";
import { PaperReader } from "@/components/research/PaperReader";
import { RightPanel, type RightPanelTab } from "@/components/research/RightPanel";
import { Sidebar } from "@/components/research/Sidebar";
import { TopBar } from "@/components/research/TopBar";
import type { PaperRecord, PaperStatus, RecommendationResponse } from "@/lib/types";

type ViewState = "idle" | "uploading" | "parsing" | "ready" | "error";

interface PaperListItem {
  id: string;
  title: string;
  authors: string[];
  status: PaperStatus;
  createdAt: string;
  updatedAt: string;
}

const statusToView = (status: PaperStatus): ViewState =>
  status === "ready" ? "ready" : status === "error" ? "error" : status;

export default function ResearchPage() {
  const [papers, setPapers] = useState<PaperListItem[]>([]);
  const [activePaper, setActivePaper] = useState<PaperRecord | null>(null);
  const [viewState, setViewState] = useState<ViewState>("idle");
  const [activeTab, setActiveTab] = useState<RightPanelTab>("chat");
  const [chatInput, setChatInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [directionQuery, setDirectionQuery] = useState("");
  const [recommendationScope, setRecommendationScope] = useState<"current" | "history" | "direction">("current");
  const [recommendationData, setRecommendationData] = useState<RecommendationResponse | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);

  async function fetchPapers() {
    const response = await fetch("/api/papers");
    const payload = (await response.json()) as PaperListItem[];
    setPapers(payload);
    return payload;
  }

  async function fetchPaper(id: string) {
    const response = await fetch(`/api/papers/${id}`);
    const payload = (await response.json()) as PaperRecord | { error: string };

    if (!response.ok || "error" in payload) {
      throw new Error("error" in payload ? payload.error : "加载论文失败");
    }

    setActivePaper(payload);
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

  useEffect(() => {
    fetchPapers()
      .then((items) => {
        if (items[0]) {
          return fetchPaper(items[0].id);
        }
        return null;
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "初始化失败");
        setViewState("error");
      });
  }, []);

  async function handleFileUpload(file: File) {
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
      setViewState("parsing");

      const response = await fetch("/api/papers/upload", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as PaperRecord | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "上传失败");
      }

      await fetchPapers();
      setActivePaper(payload);
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

  async function runPaperAction(action: "summarize" | "translate") {
    if (!activePaper) {
      return;
    }

    setError(null);
    setIsBusy(true);

    try {
      const response = await fetch(`/api/papers/${activePaper.id}/${action}`, {
        method: "POST",
      });
      const payload = (await response.json()) as PaperRecord | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "操作失败");
      }

      setActivePaper(payload);
      await fetchPapers();
      setActiveTab(action === "summarize" ? "notes" : "chat");
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
        body: JSON.stringify({ question: chatInput }),
      });

      const payload = (await response.json()) as PaperRecord | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "问答失败");
      }

      setActivePaper(payload);
      setChatInput("");
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

    setError(null);
    setIsBusy(true);

    try {
      const response = await fetch("/api/notes/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperId: activePaper.id }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "导出失败");
      }

      await fetchPaper(activePaper.id);
      setActiveTab("notes");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "导出失败");
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
        onFileSelected={(file) => void handleFileUpload(file)}
        papers={papers}
        onSelect={(id) => {
          setActiveTab("chat");
          void fetchPaper(id).catch((loadError) => {
            setError(loadError instanceof Error ? loadError.message : "加载论文失败");
            setViewState("error");
          });
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col bg-[#f8f9fa]">
        <TopBar
          activePaperTitle={activePaper?.title}
          busy={isBusy}
          onExport={() => void handleExport()}
          onOpenAssistant={() => setAssistantOpen(true)}
          onSearchChange={setSearchQuery}
          onSummarize={() => void runPaperAction("summarize")}
          onTranslate={() => void runPaperAction("translate")}
          searchQuery={searchQuery}
        />

        {error ? (
          <div className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <main className="flex flex-1 overflow-hidden">
          {(viewState === "idle" || !activePaper) && (
            <EmptyState onFileSelected={(file) => void handleFileUpload(file)} />
          )}

          {(viewState === "uploading" || viewState === "parsing") && (
            <LoadingState stage={viewState === "uploading" ? "uploading" : "parsing"} />
          )}

          {viewState === "error" && !activePaper && (
            <EmptyState onFileSelected={(file) => void handleFileUpload(file)} />
          )}

          {activePaper && viewState === "ready" && (
            <>
              <PaperReader
                paper={activePaper}
                searchQuery={searchQuery}
                blocks={filteredBlocks}
              />
            </>
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
          <div className="absolute right-0 top-0 h-full shadow-2xl">
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
              messages={activePaper.chatHistory}
              note={activePaper.lastExport}
              onChangeScope={(scope) => void handleRecommend(scope)}
              onChatInputChange={setChatInput}
              onSubmitChat={() => void handleChatSubmit()}
              onTabChange={setActiveTab}
              recommendationData={recommendationData}
              recommendations={activePaper.recommendations}
              summary={activePaper.summary}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
