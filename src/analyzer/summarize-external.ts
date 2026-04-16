import type { ExternalKnowledge, ExternalSource } from "./types.js";

const MIN_RELEVANCE_SCORE = 0.3;

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function firstSentences(text: string, count: number): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (!sentences) return text.slice(0, 200);
  return sentences.slice(0, count).join("").trim();
}

export function summarizeExternal(
  sources: ExternalSource[],
): ExternalKnowledge {
  if (sources.length === 0) {
    return { sources: [], summary: "", searchAvailable: false };
  }

  // Flatten all results, filter by score, deduplicate by domain
  const seenDomains = new Set<string>();
  const relevantResults: Array<{
    query: string;
    title: string;
    url: string;
    content: string;
    score: number;
  }> = [];

  for (const source of sources) {
    for (const result of source.results) {
      if (result.score < MIN_RELEVANCE_SCORE) continue;

      const domain = extractDomain(result.url);
      if (seenDomains.has(domain)) continue;
      seenDomains.add(domain);

      relevantResults.push({
        query: source.query,
        ...result,
      });
    }
  }

  // Sort by score descending
  relevantResults.sort((a, b) => b.score - a.score);

  // Build summary
  const summaryParts: string[] = [];

  if (relevantResults.length === 0) {
    return {
      sources,
      summary: "Web search returned no highly relevant results.",
      searchAvailable: true,
    };
  }

  for (const r of relevantResults.slice(0, 8)) {
    const snippet = firstSentences(r.content, 2);
    summaryParts.push(`- **[${r.title}](${r.url})**: ${snippet}`);
  }

  const summary = [
    `Found ${relevantResults.length} relevant source(s) across ${seenDomains.size} domain(s):`,
    "",
    ...summaryParts,
  ].join("\n");

  return {
    sources,
    summary,
    searchAvailable: true,
  };
}
