import { nanoid } from "nanoid";

import type { RetrievedItem, SearchPlan, SearchSource } from "@/lib/types";

function stripHtml(text: string) {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function parseXmlEntries(xml: string, tag: string) {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const items: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) {
    items.push(match[1]);
  }
  return items;
}

function extractXmlField(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match ? decodeHtml(stripHtml(match[1])) : "";
}

async function fetchSemanticScholar(query: string): Promise<RetrievedItem[]> {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", "5");
  url.searchParams.set("fields", "title,abstract,authors,year,citationCount,url");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "lunw-paper-assistant",
    },
  });

  if (!response.ok) {
    throw new Error(`Semantic Scholar 检索失败: ${response.status}`);
  }

  const payload = await response.json();
  return (payload.data ?? []).map(
    (paper: {
      title?: string;
      abstract?: string;
      authors?: Array<{ name?: string }>;
      year?: number;
      citationCount?: number;
      url?: string;
    }): RetrievedItem => ({
      id: nanoid(),
      title: paper.title?.trim() || "Untitled",
      url: paper.url || "",
      abstract: paper.abstract?.trim() || "",
      source: "semantic-scholar",
      authors: (paper.authors ?? []).map((author) => author.name ?? "").filter(Boolean),
      year: paper.year,
      citationHint: paper.citationCount,
    }),
  );
}

async function fetchArxiv(query: string): Promise<RetrievedItem[]> {
  const url = new URL("http://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `all:${query}`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", "5");
  url.searchParams.set("sortBy", "relevance");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/atom+xml",
      "User-Agent": "lunw-paper-assistant",
    },
  });

  if (!response.ok) {
    throw new Error(`arXiv 检索失败: ${response.status}`);
  }

  const xml = await response.text();
  const entries = parseXmlEntries(xml, "entry");
  return entries.map((entry): RetrievedItem => ({
    id: nanoid(),
    title: extractXmlField(entry, "title"),
    url: extractXmlField(entry, "id"),
    abstract: extractXmlField(entry, "summary"),
    source: "arxiv",
    authors: parseXmlEntries(entry, "name").map((name) => decodeHtml(stripHtml(name))),
    year: Number.parseInt(extractXmlField(entry, "published").slice(0, 4), 10) || undefined,
  }));
}

async function fetchCrossref(query: string): Promise<RetrievedItem[]> {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.title", query);
  url.searchParams.set("rows", "5");
  url.searchParams.set("mailto", "paper-assistant@example.com");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "lunw-paper-assistant",
    },
  });

  if (!response.ok) {
    throw new Error(`Crossref 检索失败: ${response.status}`);
  }

  const payload = await response.json();
  return (payload.message?.items ?? []).map(
    (item: {
      title?: string[];
      abstract?: string;
      author?: Array<{ given?: string; family?: string }>;
      URL?: string;
      "published-print"?: { "date-parts"?: number[][] };
      "published-online"?: { "date-parts"?: number[][] };
      "is-referenced-by-count"?: number;
    }): RetrievedItem => ({
      id: nanoid(),
      title: item.title?.[0]?.trim() || "Untitled",
      url: item.URL || "",
      abstract: decodeHtml(stripHtml(item.abstract ?? "")),
      source: "crossref",
      authors: (item.author ?? [])
        .map((author) => [author.given, author.family].filter(Boolean).join(" ").trim())
        .filter(Boolean),
      year:
        item["published-print"]?.["date-parts"]?.[0]?.[0] ??
        item["published-online"]?.["date-parts"]?.[0]?.[0],
      citationHint: item["is-referenced-by-count"],
    }),
  );
}

export async function runRetrievers(plan: SearchPlan) {
  const queries = [...plan.seedQueries, ...plan.followupQueries].slice(0, 6);
  const sourcesUsed = new Set<SearchSource>();
  const items: RetrievedItem[] = [];
  const errors: string[] = [];

  for (const query of queries) {
    const results = await Promise.allSettled([
      fetchSemanticScholar(query),
      fetchArxiv(query),
      fetchCrossref(query),
    ]);

    const [semanticResult, arxivResult, crossrefResult] = results;

    if (semanticResult.status === "fulfilled" && semanticResult.value.length) {
      sourcesUsed.add("semantic-scholar");
      items.push(...semanticResult.value);
    } else if (semanticResult.status === "rejected") {
      errors.push(semanticResult.reason instanceof Error ? semanticResult.reason.message : "Semantic Scholar 检索失败");
    }

    if (arxivResult.status === "fulfilled" && arxivResult.value.length) {
      sourcesUsed.add("arxiv");
      items.push(...arxivResult.value);
    } else if (arxivResult.status === "rejected") {
      errors.push(arxivResult.reason instanceof Error ? arxivResult.reason.message : "arXiv 检索失败");
    }

    if (crossrefResult.status === "fulfilled" && crossrefResult.value.length) {
      sourcesUsed.add("crossref");
      items.push(...crossrefResult.value);
    } else if (crossrefResult.status === "rejected") {
      errors.push(crossrefResult.reason instanceof Error ? crossrefResult.reason.message : "Crossref 检索失败");
    }
  }

  if (!items.length) {
    throw new Error(errors[0] ?? "学术检索没有返回候选结果。");
  }

  return {
    errors,
    items,
    sourcesUsed: Array.from(sourcesUsed),
  };
}
