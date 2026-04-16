import type { DebugPacket, RootCauseHypothesis, TestFailure } from "./types.js";

function renderFailure(failure: TestFailure, index: number): string {
  const lines: string[] = [];

  lines.push(`### Failure ${index + 1}${failure.testName ? `: ${failure.testName}` : ""}`);
  lines.push("");

  if (failure.testFile) {
    lines.push(`**Test file**: \`${failure.testFile}\``);
  }

  lines.push(`**Error**: ${failure.errorType ? `\`${failure.errorType}\`: ` : ""}${failure.errorMessage}`);
  lines.push("");

  // Stack trace
  const projectFrames = failure.stackTrace.filter((f) => f.isProjectFile);
  if (projectFrames.length > 0) {
    lines.push("**Stack trace** (project files):");
    lines.push("");
    for (const frame of projectFrames.slice(0, 8)) {
      const fn = frame.function ? `${frame.function} ` : "";
      lines.push(`- \`${fn}${frame.file}:${frame.line}:${frame.column}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderRootCause(hypothesis: RootCauseHypothesis, index: number): string {
  const lines: string[] = [];
  const icon =
    hypothesis.confidence === "high"
      ? "[HIGH]"
      : hypothesis.confidence === "medium"
        ? "[MED]"
        : "[LOW]";

  lines.push(`### Hypothesis ${index + 1} ${icon}: ${hypothesis.category.replace(/_/g, " ")}`);
  lines.push("");
  lines.push(hypothesis.explanation);
  lines.push("");

  if (hypothesis.evidence.length > 0) {
    lines.push("**Evidence:**");
    for (const e of hypothesis.evidence) {
      lines.push(`- ${e}`);
    }
    lines.push("");
  }

  if (hypothesis.suggestedFix) {
    lines.push(`**Suggested fix:** ${hypothesis.suggestedFix}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function renderReport(packet: DebugPacket): string {
  const sections: string[] = [];

  // ── Header ──
  sections.push("# TraceGen Debug Report");
  sections.push("");
  sections.push(`> Generated: ${packet.timestamp}  `);
  sections.push(`> Project: \`${packet.projectRoot}\`  `);
  sections.push(`> TraceGen v${packet.metadata.tracegenVersion}`);
  sections.push("");

  // ── Test run summary ──
  sections.push("## Test Run Summary");
  sections.push("");
  sections.push(`- **Command**: \`${packet.testRun.command}\``);
  sections.push(`- **Exit code**: ${packet.testRun.exitCode ?? "N/A"}`);
  sections.push(`- **Duration**: ${Math.round(packet.testRun.durationMs)}ms`);

  if (packet.testRun.totalTests !== null) {
    const passed = packet.testRun.passedTests ?? 0;
    const failed = packet.testRun.failedTests ?? 0;
    sections.push(`- **Results**: ${passed} passed, ${failed} failed, ${packet.testRun.totalTests} total`);
  }
  sections.push("");

  // ── Failures ──
  if (packet.testRun.failures.length > 0) {
    sections.push("## Failures");
    sections.push("");
    for (let i = 0; i < packet.testRun.failures.length; i++) {
      sections.push(renderFailure(packet.testRun.failures[i]!, i));
    }
  }

  // ── Root cause analysis ──
  if (packet.rootCauses.length > 0) {
    sections.push("## Root Cause Analysis");
    sections.push("");
    for (let i = 0; i < packet.rootCauses.length; i++) {
      sections.push(renderRootCause(packet.rootCauses[i]!, i));
    }
  }

  // ── Local evidence ──
  if (packet.localContext.snippets.length > 0) {
    sections.push("## Local Evidence");
    sections.push("");
    for (const snippet of packet.localContext.snippets) {
      sections.push(`**\`${snippet.file}\`** (lines ${snippet.startLine}-${snippet.endLine}):`);
      sections.push("");
      sections.push("```" + snippet.language);
      sections.push(snippet.content);
      sections.push("```");
      sections.push("");
    }
  }

  // ── External evidence ──
  sections.push("## External Evidence (Tavily)");
  sections.push("");
  if (packet.externalKnowledge.searchAvailable) {
    sections.push(packet.externalKnowledge.summary || "No relevant external results found.");
  } else {
    sections.push("Web search was not available (Tavily API key not configured or search disabled).");
  }
  sections.push("");

  // ── Git context ──
  sections.push("## Git Context");
  sections.push("");
  if (packet.gitContext.available) {
    if (packet.gitContext.branch) {
      sections.push(`- **Branch**: \`${packet.gitContext.branch}\``);
    }
    if (packet.gitContext.lastCommitHash) {
      sections.push(`- **Last commit**: \`${packet.gitContext.lastCommitHash?.slice(0, 8)}\` ${packet.gitContext.lastCommitMessage ?? ""}`);
    }
    if (packet.gitContext.diff) {
      sections.push("");
      sections.push("**Recent diff:**");
      sections.push("");
      sections.push("```diff");
      sections.push(packet.gitContext.diff);
      sections.push("```");
    } else {
      sections.push("- No uncommitted changes.");
    }
  } else {
    sections.push("Git context not available (not a git repository or git not installed).");
  }
  sections.push("");

  // ── Pipeline diagnostics ──
  sections.push("## Pipeline Diagnostics");
  sections.push("");
  sections.push("| Step | Status | Duration |");
  sections.push("|------|--------|----------|");
  for (const step of packet.metadata.analysisSteps) {
    const status =
      step.status === "success"
        ? "OK"
        : step.status === "skipped"
          ? "SKIP"
          : `FAIL: ${step.error ?? "unknown"}`;
    sections.push(`| ${step.step} | ${status} | ${Math.round(step.durationMs)}ms |`);
  }
  sections.push("");

  // ── Footer ──
  sections.push("---");
  sections.push("*Generated by [TraceGen](https://github.com/tracegen/tracegen) — LLM-native debugging for coding agents*");

  return sections.join("\n");
}
