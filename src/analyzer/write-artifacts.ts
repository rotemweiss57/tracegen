import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DebugPacket } from "./types.js";

function generateAgentPrompt(packet: DebugPacket): string {
  const sections: string[] = [];

  sections.push("You are debugging a test failure. Here is the structured analysis:");
  sections.push("");

  // Failure info
  for (const failure of packet.testRun.failures) {
    sections.push("---");
    sections.push("");

    const errorPrefix = failure.errorType ? `${failure.errorType}: ` : "";
    sections.push(`ERROR: ${errorPrefix}${failure.errorMessage}`);

    const location = failure.stackTrace.find((f) => f.isProjectFile);
    if (location?.file && location.line) {
      sections.push(`FILE: ${location.file}:${location.line}`);
    }
    if (failure.testName) {
      sections.push(`TEST: ${failure.testName}`);
    }
    sections.push("");
  }

  // Root causes
  if (packet.rootCauses.length > 0) {
    sections.push("ROOT CAUSE ANALYSIS:");
    sections.push("");
    for (const cause of packet.rootCauses) {
      sections.push(
        `[${cause.confidence.toUpperCase()}] ${cause.category.replace(/_/g, " ")}: ${cause.explanation}`,
      );
      if (cause.suggestedFix) {
        sections.push(`  SUGGESTED FIX: ${cause.suggestedFix}`);
      }
      sections.push("");
    }
  }

  // Code context
  if (packet.localContext.snippets.length > 0) {
    sections.push("RELEVANT CODE:");
    sections.push("");
    for (const snippet of packet.localContext.snippets.slice(0, 3)) {
      sections.push(`--- ${snippet.file} (lines ${snippet.startLine}-${snippet.endLine}) ---`);
      sections.push("```" + snippet.language);
      sections.push(snippet.content);
      sections.push("```");
      sections.push("");
    }
  }

  // External context
  if (packet.externalKnowledge.searchAvailable && packet.externalKnowledge.summary) {
    sections.push("EXTERNAL CONTEXT (from web search):");
    sections.push(packet.externalKnowledge.summary);
    sections.push("");
  }

  // Git diff
  if (packet.gitContext.available && packet.gitContext.diff) {
    sections.push("GIT DIFF (recent changes that may be relevant):");
    sections.push("```diff");
    sections.push(packet.gitContext.diff);
    sections.push("```");
    sections.push("");
  }

  // Action instruction
  sections.push("---");
  sections.push("");
  sections.push("Please fix this issue. Focus on the root cause analysis above.");
  if (packet.rootCauses[0]) {
    const cause = packet.rootCauses[0];
    const location = packet.testRun.failures[0]?.stackTrace.find(
      (f) => f.isProjectFile,
    );
    if (location?.file) {
      sections.push(
        `Start with ${cause.category.replace(/_/g, " ")} in ${location.file}${location.line ? ` near line ${location.line}` : ""}.`,
      );
    }
  }

  return sections.join("\n");
}

export async function writeArtifacts(
  packet: DebugPacket,
  report: string,
  htmlReport: string,
  outputDir: string,
): Promise<void> {
  await mkdir(outputDir, { recursive: true });

  const agentPrompt = generateAgentPrompt(packet);

  await Promise.all([
    writeFile(
      join(outputDir, "debug-packet.json"),
      JSON.stringify(packet, null, 2),
      "utf-8",
    ),
    writeFile(join(outputDir, "debug-report.md"), report, "utf-8"),
    writeFile(join(outputDir, "debug-report.html"), htmlReport, "utf-8"),
    writeFile(join(outputDir, "agent-prompt.txt"), agentPrompt, "utf-8"),
  ]);
}
