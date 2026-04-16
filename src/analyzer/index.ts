import type {
  AnalyzeConfig,
  AnalyzeOutputConfig,
  CondensedAnalysis,
  DebugPacket,
  PipelineContext,
  PipelineStep,
  TestRunResult,
} from "./types.js";

import { runTests } from "./run-tests.js";
import { parseFailures } from "./parse-failure.js";
import { parseErrors } from "./parse-errors.js";
import { collectContext } from "./collect-context.js";
import { getGitContext } from "./git.js";
import { generateSearchQueries } from "./search-queries.js";
import { searchTavily } from "./tavily.js";
import { summarizeExternal } from "./summarize-external.js";
import { inferRootCauses } from "./infer-root-cause.js";
import { generatePacket } from "./generate-packet.js";
import { enhanceWithLLM } from "./llm-enhance.js";
import { renderReport } from "./render-report.js";
import { renderHtmlReport } from "./render-html.js";
import { writeArtifacts } from "./write-artifacts.js";

// Re-export public API surface
export type { AnalyzeConfig, AnalyzeOutputConfig, DebugPacket, CondensedAnalysis };
export { parseFailures } from "./parse-failure.js";
export { inferRootCauses } from "./infer-root-cause.js";
export { collectContext } from "./collect-context.js";
export { getGitContext } from "./git.js";

// ── Step runner ──────────────────────────────────────────────────────

type StepCallback = (step: PipelineStep, status: "start" | "done" | "fail", durationMs?: number) => void;

export interface AnalyzeOptions {
  onStep?: StepCallback;
}

async function runStep<T>(
  ctx: PipelineContext,
  step: PipelineStep,
  fn: () => T | Promise<T>,
  onStep?: StepCallback,
): Promise<T | undefined> {
  const start = performance.now();
  onStep?.(step, "start");

  try {
    const result = await fn();
    const duration = performance.now() - start;

    ctx.steps.push({
      step,
      status: "success",
      durationMs: duration,
      error: null,
    });

    onStep?.(step, "done", duration);
    return result;
  } catch (err) {
    const duration = performance.now() - start;
    const message = err instanceof Error ? err.message : String(err);

    ctx.steps.push({
      step,
      status: "failed",
      durationMs: duration,
      error: message,
    });

    onStep?.(step, "fail", duration);
    return undefined;
  }
}

function skipStep(ctx: PipelineContext, step: PipelineStep, onStep?: StepCallback): void {
  ctx.steps.push({
    step,
    status: "skipped",
    durationMs: 0,
    error: null,
  });
  onStep?.(step, "done", 0);
}

// ── Shared pipeline (steps 2–11) ────────────────────────────────────

async function runPipelineFromFailures(
  ctx: PipelineContext,
  onStep?: StepCallback,
): Promise<DebugPacket> {
  const { config } = ctx;

  // Step 2: Parse failures (skip if already parsed by analyzeOutput)
  if (ctx.failures) {
    // Already parsed (e.g., via universal parseErrors dispatcher)
  } else if (ctx.testRun) {
    ctx.failures = await runStep(ctx, "parse_failures", () =>
      parseFailures(ctx.testRun!, config.projectRoot),
      onStep,
    );
  } else {
    skipStep(ctx, "parse_failures", onStep);
  }

  // Steps 3 & 4: Collect context + git (parallel, git skippable)
  const parallelSteps: [Promise<typeof ctx.localContext>, Promise<typeof ctx.gitContext>] = [
    runStep(ctx, "collect_context", () =>
      collectContext(ctx.failures ?? [], config.projectRoot),
      onStep,
    ),
    config.git
      ? runStep(ctx, "git_context", () => getGitContext(config.projectRoot), onStep)
      : (skipStep(ctx, "git_context", onStep), Promise.resolve(undefined)),
  ];
  const [localCtx, gitCtx] = await Promise.all(parallelSteps);
  ctx.localContext = localCtx;
  ctx.gitContext = gitCtx;

  // Steps 5-7: External search (skippable)
  const shouldSearch =
    config.search &&
    config.tavilyApiKey &&
    ctx.failures &&
    ctx.failures.length > 0;

  if (shouldSearch) {
    ctx.searchQueries = await runStep(ctx, "generate_queries", () =>
      generateSearchQueries(ctx.failures!),
      onStep,
    );

    ctx.externalSources = await runStep(ctx, "tavily_search", () =>
      searchTavily(ctx.searchQueries ?? [], config.tavilyApiKey ?? ""),
      onStep,
    );

    ctx.externalKnowledge = await runStep(ctx, "summarize_external", () =>
      summarizeExternal(ctx.externalSources ?? []),
      onStep,
    );
  } else {
    skipStep(ctx, "generate_queries", onStep);
    skipStep(ctx, "tavily_search", onStep);
    skipStep(ctx, "summarize_external", onStep);
  }

  // Step 8: Root cause inference
  ctx.rootCauses = await runStep(ctx, "infer_root_causes", () =>
    inferRootCauses(
      ctx.failures ?? [],
      ctx.localContext ?? { snippets: [], relatedFiles: [] },
    ),
    onStep,
  );

  // Step 9: Assemble packet
  const packet = await runStep(ctx, "assemble_packet", () =>
    generatePacket(ctx),
    onStep,
  );

  if (!packet) {
    throw new Error("Failed to assemble debug packet");
  }

  // Step 9.5: LLM enhancement (optional)
  const shouldLLM =
    config.llm &&
    config.anthropicApiKey &&
    packet.testRun.failures.length > 0;

  if (shouldLLM) {
    const enhancement = await runStep(ctx, "llm_enhance", () =>
      enhanceWithLLM(packet, config.anthropicApiKey!, config.llmModel),
      onStep,
    );
    if (enhancement) {
      packet.llmEnhancement = enhancement;
    }
  } else {
    skipStep(ctx, "llm_enhance", onStep);
  }

  // Steps 10-11: Render + write (skippable)
  if (config.writeFiles) {
    const reports = await runStep(ctx, "render_report", () => ({
      markdown: renderReport(packet),
      html: renderHtmlReport(packet),
    }), onStep);

    await runStep(ctx, "write_artifacts", () =>
      writeArtifacts(
        packet,
        reports?.markdown ?? "",
        reports?.html ?? "",
        "outputDir" in config ? config.outputDir : "./output",
      ),
      onStep,
    );
  } else {
    skipStep(ctx, "render_report", onStep);
    skipStep(ctx, "write_artifacts", onStep);
  }

  return packet;
}

// ── Public API: analyze (run tests + full pipeline) ──────────────────

export async function analyze(
  config: AnalyzeConfig,
  options?: AnalyzeOptions,
): Promise<DebugPacket> {
  const { onStep } = options ?? {};
  const ctx: PipelineContext = { config, steps: [] };

  // Step 1: Run tests
  ctx.testRun = await runStep(ctx, "run_tests", () =>
    runTests(config.command, config.projectRoot, config.timeout),
    onStep,
  );

  return runPipelineFromFailures(ctx, onStep);
}

// ── Public API: analyzeOutput (parse provided output, skip running tests)

export async function analyzeOutput(
  rawOutput: string,
  config: AnalyzeOutputConfig,
  options?: AnalyzeOptions,
): Promise<DebugPacket> {
  const { onStep } = options ?? {};
  const ctx: PipelineContext = { config, steps: [] };

  // Auto-detect format and parse errors
  const { format, failures } = parseErrors(rawOutput, config.projectRoot);

  // Synthesize a TestRunResult with pre-parsed failures
  const testRun: TestRunResult = {
    command: `(${format} output)`,
    exitCode: 1,
    stdout: rawOutput,
    stderr: "",
    durationMs: 0,
    failures,
    totalTests: null,
    passedTests: null,
    failedTests: null,
  };

  ctx.testRun = testRun;
  ctx.failures = failures;
  skipStep(ctx, "run_tests", onStep);
  skipStep(ctx, "parse_failures", onStep); // already parsed

  return runPipelineFromFailures(ctx, onStep);
}

// ── Public API: condense (extract LLM-friendly summary from packet)

export function condense(packet: DebugPacket): CondensedAnalysis {
  const failure = packet.testRun.failures[0];
  const cause = packet.rootCauses[0];
  const snippet = packet.localContext.snippets[0];

  const projectFrame = failure?.stackTrace.find((f) => f.isProjectFile)
    ?? failure?.stackTrace[0]; // fall back to first frame

  return {
    error: failure?.errorMessage ?? "No failures detected",
    file: projectFrame?.file ? `${projectFrame.file}:${projectFrame.line}` : null,
    testName: failure?.testName ?? null,
    rootCause: cause
      ? {
          category: cause.category,
          confidence: cause.confidence,
          explanation: cause.explanation,
          suggestedFix: cause.suggestedFix,
        }
      : null,
    codeContext: snippet
      ? `// ${snippet.file} (lines ${snippet.startLine}-${snippet.endLine})\n${snippet.content}`
      : null,
    externalHint: packet.externalKnowledge.searchAvailable && packet.externalKnowledge.summary
      ? packet.externalKnowledge.summary.split("\n").find((l) => l.startsWith("-"))?.trim() ?? null
      : null,
    ...(packet.llmEnhancement ? {
      llm: {
        narrative: packet.llmEnhancement.rootCauseNarrative,
        codeFix: packet.llmEnhancement.codeFix,
        fixFile: packet.llmEnhancement.fixFile,
        fixExplanation: packet.llmEnhancement.fixExplanation,
        alternatives: packet.llmEnhancement.fixAlternatives,
      },
    } : {}),
  };
}
