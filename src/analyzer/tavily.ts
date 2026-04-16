import type { ExternalSource, TavilySearchResult } from "./types.js";

const TAVILY_API_URL = "https://api.tavily.com/search";
const REQUEST_TIMEOUT_MS = 10_000;
const DELAY_BETWEEN_REQUESTS_MS = 200;
const MAX_RESULTS_PER_QUERY = 5;

interface TavilyApiResponse {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    score?: number;
  }>;
  answer?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchSingle(
  query: string,
  apiKey: string,
): Promise<TavilySearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(TAVILY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: MAX_RESULTS_PER_QUERY,
        include_answer: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as TavilyApiResponse;

    return (data.results ?? [])
      .filter(
        (r): r is { title: string; url: string; content: string; score: number } =>
          typeof r.title === "string" &&
          typeof r.url === "string" &&
          typeof r.content === "string" &&
          typeof r.score === "number",
      )
      .map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchTavily(
  queries: string[],
  apiKey: string,
): Promise<ExternalSource[]> {
  if (!apiKey) return [];
  if (queries.length === 0) return [];

  const sources: ExternalSource[] = [];

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i]!;
    const results = await searchSingle(query, apiKey);

    sources.push({ query, results });

    // Delay between requests (skip after last)
    if (i < queries.length - 1) {
      await sleep(DELAY_BETWEEN_REQUESTS_MS);
    }
  }

  return sources;
}
