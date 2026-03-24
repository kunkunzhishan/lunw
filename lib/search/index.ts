import { composeRecommendations } from "@/lib/search/composer";
import { planRecommendationSearch } from "@/lib/search/planner";
import { scoreRecommendationCandidates } from "@/lib/search/ranker";
import { runRetrievers } from "@/lib/search/retrievers";
import type {
  PaperRecord,
  RecommendationResponse,
  RecommendationSourceType,
  SearchEntryType,
  SearchResult,
} from "@/lib/types";

interface RecommendationAgentInput {
  currentPaper?: PaperRecord | null;
  historyPapers?: PaperRecord[];
  query?: string;
  sourceType: RecommendationSourceType;
}

export async function runRecommendationAgent(input: RecommendationAgentInput): Promise<RecommendationResponse> {
  const plan = planRecommendationSearch({
    entryType: input.sourceType,
    query: input.query,
    currentPaper: input.currentPaper,
    historyPapers: input.historyPapers,
  });
  const retrieved = await runRetrievers(plan);
  const scored = scoreRecommendationCandidates({
    items: retrieved.items,
    plan,
    currentPaper: input.currentPaper,
    historyPapers: input.historyPapers,
  });

  return composeRecommendations({
    errors: retrieved.errors,
    plan,
    scoredItems: scored,
    sourceType: input.sourceType,
    sourcesUsed: retrieved.sourcesUsed,
  });
}

export async function runQaContextAgent(params: {
  currentPaper?: PaperRecord | null;
  query: string;
}) {
  const plan = planRecommendationSearch({
    entryType: "qa_web_context" as SearchEntryType,
    query: params.query,
    currentPaper: params.currentPaper,
  });
  const retrieved = await runRetrievers(plan);
  const scored = scoreRecommendationCandidates({
    items: retrieved.items,
    plan,
    currentPaper: params.currentPaper,
  });

  const items = scored.slice(0, 4).map((candidate): SearchResult => ({
    title: `[${candidate.item.source}] ${candidate.item.title}`,
    url: candidate.item.url,
    content: candidate.item.abstract || candidate.evidence.join("；"),
  }));

  return {
    errors: retrieved.errors,
    plan,
    sourcesUsed: retrieved.sourcesUsed,
    items,
  };
}
