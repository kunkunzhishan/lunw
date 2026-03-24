export type PaperStatus = "idle" | "uploading" | "parsing" | "ready" | "error";
export type RecommendationSourceType = "direction" | "current" | "history";
export type MessageRole = "user" | "assistant";
export type PaperBlockType = "text" | "heading" | "formula" | "image" | "table";
export type SearchEntryType =
  | RecommendationSourceType
  | "qa_web_context";
export type SearchSource = "semantic-scholar" | "arxiv" | "crossref";

interface PaperBlockBase {
  id: string;
  type: PaperBlockType;
  page: number;
  order: number;
  bbox?: [number, number, number, number];
}

export interface TextPaperBlock extends PaperBlockBase {
  type: "text" | "heading";
  english: string;
  chinese?: string;
  headingLevel?: number;
}

export interface FormulaPaperBlock extends PaperBlockBase {
  type: "formula";
  latex?: string;
  assetId?: string;
  assetPath?: string;
}

export interface AssetPaperBlock extends PaperBlockBase {
  type: "image" | "table";
  assetId: string;
  assetPath: string;
  english?: string;
}

export type PaperBlock = TextPaperBlock | FormulaPaperBlock | AssetPaperBlock;

export interface PaperAsset {
  id: string;
  kind: "image" | "table" | "formula";
  fileName: string;
  relativePath: string;
  mimeType: string;
  page: number;
  order: number;
}

export interface PaperSummary {
  oneLiner: string;
  researchProblem: string;
  coreMethod: string;
  findings: string;
  innovations: string[];
  limitations: string[];
  ideas: string[];
  terms: string[];
}

export interface SourceRef {
  type: "paper" | "academic" | "web" | "inference";
  label: string;
  blockId?: string;
  url?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  sourceRefs: SourceRef[];
  createdAt: string;
}

export interface RecommendationItem {
  id: string;
  title: string;
  url: string;
  reason: string;
  sourceType: RecommendationSourceType;
  score: number;
  source: SearchSource;
  authors: string[];
  year?: number;
  evidenceRefs: string[];
  nextStep: string;
}

export interface ExportedNote {
  paperId: string;
  markdown: string;
  targetPath: string;
  exportedAt: string;
}

export interface PaperAnnotation {
  id: string;
  blockId: string;
  threadId: string;
  quoteText?: string;
  quoteStart?: number;
  quoteEnd?: number;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaperRecord {
  id: string;
  title: string;
  authors: string[];
  source: string;
  repositoryId: string;
  uploadPath: string;
  status: PaperStatus;
  createdAt: string;
  updatedAt: string;
  text: string;
  blocks: PaperBlock[];
  assets: PaperAsset[];
  annotations: PaperAnnotation[];
  summary?: PaperSummary;
  chatHistory: ChatMessage[];
  recommendations: RecommendationItem[];
  recommendationPlan?: SearchPlan;
  recommendationSources?: SearchSource[];
  lastExport?: ExportedNote;
  parseError?: string;
}

export interface DatabaseSchema {
  repositories: RepositoryRecord[];
  papers: PaperRecord[];
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export interface SearchPlan {
  entryType: SearchEntryType;
  intent: string;
  seedQueries: string[];
  followupQueries: string[];
}

export interface RetrievedItem {
  id: string;
  title: string;
  url: string;
  abstract: string;
  source: SearchSource;
  authors: string[];
  year?: number;
  citationHint?: number;
}

export interface ScoredItem {
  item: RetrievedItem;
  relevanceScore: number;
  noveltyScore: number;
  sourceCredibilityScore: number;
  academicSignalScore: number;
  totalScore: number;
  evidence: string[];
}

export interface RecommendationResponse {
  plan: SearchPlan;
  items: RecommendationItem[];
  sourcesUsed: SearchSource[];
  errors?: string[];
}
