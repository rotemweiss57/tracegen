/**
 * LLM Enhancement Module
 *
 * Takes a complete DebugPacket (already assembled by heuristics) and enhances it
 * with LLM-generated analysis: actual code fix, root cause narrative, fix strategy.
 *
 * Uses Claude Haiku by default for speed and cost efficiency (~$0.003/analysis).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { DebugPacket, LLMEnhancement } from "./types.js";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_SNIPPET_CHARS = 3000;
const MAX_EXTERNAL_CHARS = 1500;
const MAX_CONTEXT_CHARS = 2000;

function loadProjectContext(projectRoot: string): string | null {
  try {
    const contextPath = join(projectRoot, ".tracegen", "context.md");
    const content = readFileSync(contextPath, "utf-8");
    return content.slice(0, MAX_CONTEXT_CHARS);
  } catch {
    return null;
  }
}

function buildPrompt(packet: DebugPacket): string {
  const failure = packet.testRun.failures[0];
  if (!failure) return "";

  const cause = packet.rootCauses[0];
  const projectFrames = failure.stackTrace.filter((f) => f.isProjectFile);

  // Build focused prompt sections
  const sections: string[] = [];

  // Project context (if available from `tracegen init`)
  const projectContext = loadProjectContext(packet.projectRoot);
  if (projectContext) {
    sections.push(projectContext);
  }

  // Error info
  sections.push(`## Error
${failure.errorType ? `${failure.errorType}: ` : ""}${failure.errorMessage}`);

  // Stack trace (project files only)
  if (projectFrames.length > 0) {
    sections.push(`## Stack Trace
${projectFrames.map((f) => `${f.function ?? ""} ${f.file}:${f.line}`).join("\n")}`);
  }

  // Heuristic analysis (so the LLM can build on it)
  if (cause) {
    sections.push(`## Heuristic Analysis
Category: ${cause.category} (${cause.confidence} confidence)
Explanation: ${cause.explanation}
Suggested fix: ${cause.suggestedFix ?? "none"}`);
  }

  // Code context (truncated to stay within token budget)
  const snippets = packet.localContext.snippets.slice(0, 4);
  if (snippets.length > 0) {
    const snippetText = snippets
      .map((s) => `### ${s.file} (lines ${s.startLine}-${s.endLine})\n\`\`\`${s.language}\n${s.content}\n\`\`\``)
      .join("\n\n");
    sections.push(`## Relevant Code\n${snippetText.slice(0, MAX_SNIPPET_CHARS)}`);
  }

  // External knowledge (if available)
  if (packet.externalKnowledge.searchAvailable && packet.externalKnowledge.summary) {
    sections.push(`## External Context (web search results)\n${packet.externalKnowledge.summary.slice(0, MAX_EXTERNAL_CHARS)}`);
  }

  // Git context
  if (packet.gitContext.available && packet.gitContext.diff) {
    sections.push(`## Recent Git Changes\n\`\`\`diff\n${packet.gitContext.diff.slice(0, 1000)}\n\`\`\``);
  }

  return sections.join("\n\n");
}

const SYSTEM_PROMPT = `You are a debugging expert analyzing a code error. You will receive:
- The error message and stack trace
- The heuristic analysis (category + basic fix suggestion)
- Relevant source code around the error
- Optionally: web search results and git changes

Your job is to provide DEEPER analysis than the heuristic engine:

1. ROOT CAUSE NARRATIVE: Trace the data flow. Don't just say "null access at line X" — explain WHERE the null comes from, WHY it's null, and HOW it flows to the crash site. 2-3 sentences max.

2. CODE FIX: Generate the actual code that fixes the bug. Show only the changed lines in a code block. Include the file path.

3. FIX EXPLANATION: One sentence explaining what the fix does and why it works.

4. FIX ALTERNATIVES: List 1-2 alternative approaches (one-liner each).

5. EXTERNAL SYNTHESIS: If web search results are provided, synthesize them into one sentence of relevant context. If none, say null.

Respond in this EXACT JSON format (no markdown, no extra text):
{
  "rootCauseNarrative": "...",
  "codeFix": "...",
  "fixFile": "path/to/file.ts",
  "fixExplanation": "...",
  "fixAlternatives": ["...", "..."],
  "externalSynthesis": "..." or null
}`;

export async function enhanceWithLLM(
  packet: DebugPacket,
  apiKey: string,
  model?: string,
): Promise<LLMEnhancement> {
  const client = new Anthropic({ apiKey });
  const selectedModel = model ?? DEFAULT_MODEL;

  const userPrompt = buildPrompt(packet);
  if (!userPrompt) {
    throw new Error("No failure data to enhance");
  }

  const response = await client.messages.create({
    model: selectedModel,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  // Extract text from response
  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from LLM");
  }

  // Parse the JSON response
  const raw = textBlock.text.trim();

  // Handle potential markdown code fences
  const jsonStr = raw.startsWith("{")
    ? raw
    : raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

  const parsed = JSON.parse(jsonStr) as {
    rootCauseNarrative?: string;
    codeFix?: string;
    fixFile?: string;
    fixExplanation?: string;
    fixAlternatives?: string[];
    externalSynthesis?: string | null;
  };

  return {
    rootCauseNarrative: parsed.rootCauseNarrative ?? "Analysis unavailable",
    codeFix: parsed.codeFix ?? "",
    fixFile: parsed.fixFile ?? "",
    fixExplanation: parsed.fixExplanation ?? "",
    fixAlternatives: parsed.fixAlternatives ?? [],
    externalSynthesis: parsed.externalSynthesis ?? null,
    model: selectedModel,
  };
}
