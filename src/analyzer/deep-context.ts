/**
 * Deep Context Generator
 *
 * Uses Claude to analyze the codebase and generate a rich narrative
 * about project patterns, conventions, and architecture.
 * Called during `tracegen init --deep`.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import type { ProjectContext } from "./gather-context.js";
import { formatContext } from "./gather-context.js";

const DEEP_MODEL = "claude-haiku-4-5-20251001";
const MAX_FILE_CHARS = 3000;

const DEEP_SYSTEM_PROMPT = `You are analyzing a software project to create a debugging context document. You will receive:
- Structured project metadata (dependencies, config, file tree)
- 3-5 key source files from the project

Write a concise "Conventions & Patterns" section that captures what a debugging LLM needs to know about this specific codebase. Focus on:

1. **Error handling pattern**: Does the project use try/catch, nullable returns (T | null), Result types, or thrown errors? Be specific about which functions/modules use which pattern.

2. **Architecture pattern**: How do modules connect? Is it MVC, service-repository, functional pipeline, etc.?

3. **Key abstractions**: What are the main types/interfaces that flow through the system? What does the data model look like?

4. **Naming conventions**: How are files, functions, and types named? Any patterns?

5. **Common pitfalls**: Based on the code, what are likely sources of bugs? (e.g., "Functions in auth/ return null for invalid states — callers must check")

6. **Testing approach**: How are tests structured? What's mocked vs real?

Be CONCISE (under 300 words). Use bullet points. Only include observations that would help debug errors in this codebase.

Respond with ONLY the markdown content (no JSON wrapper, no code fences). Start with "## Conventions & Patterns".`;

function selectKeyFiles(ctx: ProjectContext, projectRoot: string): string[] {
  const candidates: string[] = [];

  // Find entry points and key files from the structure
  const structureLines = ctx.structure.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of structureLines) {
    const file = line.replace(/\/$/, "");
    if (/^(index|main|app|server|cli)\.(ts|js|tsx|jsx)$/.test(file)) {
      candidates.push(file);
    }
  }

  // Add first test file if found
  for (const line of structureLines) {
    if (/\.(test|spec)\.(ts|js|tsx|jsx)$/.test(line.trim())) {
      candidates.push(line.trim());
      break;
    }
  }

  // Try to find key source files in common locations
  const tryFiles = [
    "src/index.ts", "src/app.ts", "src/main.ts", "src/cli.ts",
    "src/index.js", "src/app.js", "src/main.js",
    "index.ts", "index.js", "app.ts", "app.js",
  ];

  for (const f of tryFiles) {
    try {
      readFileSync(`${projectRoot}/${f}`, "utf-8");
      if (!candidates.includes(f)) candidates.push(f);
    } catch {
      // File doesn't exist
    }
  }

  return candidates.slice(0, 5);
}

export async function generateDeepContext(
  staticContext: ProjectContext,
  projectRoot: string,
  apiKey: string,
  model?: string,
): Promise<string> {
  const client = new Anthropic({ apiKey });
  const selectedModel = model ?? DEEP_MODEL;

  // Build the prompt with static context + key file contents
  const staticMd = formatContext(staticContext);
  const keyFiles = selectKeyFiles(staticContext, projectRoot);

  const fileSections: string[] = [];
  for (const file of keyFiles) {
    try {
      const content = readFileSync(`${projectRoot}/${file}`, "utf-8");
      fileSections.push(`### ${file}\n\`\`\`\n${content.slice(0, MAX_FILE_CHARS)}\n\`\`\``);
    } catch {
      // Skip unreadable files
    }
  }

  const userPrompt = [
    "# Project Metadata",
    staticMd,
    "",
    "# Key Source Files",
    ...fileSections,
  ].join("\n");

  const response = await client.messages.create({
    model: selectedModel,
    max_tokens: 1024,
    system: DEEP_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return "## Conventions & Patterns\n\nDeep analysis unavailable.";
  }

  return textBlock.text.trim();
}
