import { z } from "zod";

// ── Source locations & code ──────────────────────────────────────────

export const SourceLocationSchema = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive().nullable(),
});
export type SourceLocation = z.infer<typeof SourceLocationSchema>;

export const CodeSnippetSchema = z.object({
  file: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  content: z.string(),
  language: z.string(),
});
export type CodeSnippet = z.infer<typeof CodeSnippetSchema>;

// ── Stack traces ─────────────────────────────────────────────────────

export const StackFrameSchema = z.object({
  function: z.string().nullable(),
  file: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  column: z.number().int().positive().nullable(),
  isProjectFile: z.boolean(),
});
export type StackFrame = z.infer<typeof StackFrameSchema>;

// ── Test failure ─────────────────────────────────────────────────────

export const TestFailureSchema = z.object({
  testName: z.string().nullable(),
  testFile: z.string().nullable(),
  errorMessage: z.string(),
  errorType: z.string().nullable(),
  stackTrace: z.array(StackFrameSchema),
  rawOutput: z.string(),
});
export type TestFailure = z.infer<typeof TestFailureSchema>;

// ── Test run result ──────────────────────────────────────────────────

export const TestRunResultSchema = z.object({
  command: z.string(),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number(),
  failures: z.array(TestFailureSchema),
  totalTests: z.number().int().nullable(),
  passedTests: z.number().int().nullable(),
  failedTests: z.number().int().nullable(),
});
export type TestRunResult = z.infer<typeof TestRunResultSchema>;

// ── Local context ────────────────────────────────────────────────────

export const LocalContextSchema = z.object({
  snippets: z.array(CodeSnippetSchema),
  relatedFiles: z.array(z.string()),
});
export type LocalContext = z.infer<typeof LocalContextSchema>;

// ── Git context ──────────────────────────────────────────────────────

export const GitContextSchema = z.object({
  available: z.boolean(),
  diff: z.string().nullable(),
  branch: z.string().nullable(),
  lastCommitMessage: z.string().nullable(),
  lastCommitHash: z.string().nullable(),
});
export type GitContext = z.infer<typeof GitContextSchema>;

// ── Tavily / external knowledge ──────────────────────────────────────

export const TavilySearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string(),
  score: z.number(),
});
export type TavilySearchResult = z.infer<typeof TavilySearchResultSchema>;

export const ExternalSourceSchema = z.object({
  query: z.string(),
  results: z.array(TavilySearchResultSchema),
});
export type ExternalSource = z.infer<typeof ExternalSourceSchema>;

export const ExternalKnowledgeSchema = z.object({
  sources: z.array(ExternalSourceSchema),
  summary: z.string(),
  searchAvailable: z.boolean(),
});
export type ExternalKnowledge = z.infer<typeof ExternalKnowledgeSchema>;

// ── Root cause inference ─────────────────────────────────────────────

export const RootCauseCategorySchema = z.enum([
  "undefined_or_null",
  "type_mismatch",
  "assertion_failure",
  "missing_property",
  "import_or_module",
  "async_or_promise",
  "timeout",
  "network_or_io",
  "shape_mismatch",
  "index_out_of_bounds",
  "syntax_error",
  "infinite_recursion",
  "module_interop",
  "permission_error",
  "database_error",
  "test_setup_error",
  "environment_error",
  "compilation_error",
  "dependency_conflict",
  "lint_error",
  "resource_limit",
  "unknown",
]);
export type RootCauseCategory = z.infer<typeof RootCauseCategorySchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const RootCauseHypothesisSchema = z.object({
  category: RootCauseCategorySchema,
  confidence: ConfidenceSchema,
  explanation: z.string(),
  evidence: z.array(z.string()),
  suggestedFix: z.string().nullable(),
});
export type RootCauseHypothesis = z.infer<typeof RootCauseHypothesisSchema>;

// ── Pipeline tracking ────────────────────────────────────────────────

export const PipelineStepSchema = z.enum([
  "run_tests",
  "parse_failures",
  "collect_context",
  "git_context",
  "generate_queries",
  "tavily_search",
  "summarize_external",
  "infer_root_causes",
  "assemble_packet",
  "llm_enhance",
  "render_report",
  "write_artifacts",
]);
export type PipelineStep = z.infer<typeof PipelineStepSchema>;

export const StepStatusSchema = z.enum(["success", "skipped", "failed"]);

export const PipelineStepResultSchema = z.object({
  step: PipelineStepSchema,
  status: StepStatusSchema,
  durationMs: z.number(),
  error: z.string().nullable(),
});
export type PipelineStepResult = z.infer<typeof PipelineStepResultSchema>;

// ── The debug packet ─────────────────────────────────────────────────

// ── LLM enhancement (optional) ───────────────────────────────────────

export const LLMEnhancementSchema = z.object({
  rootCauseNarrative: z.string(),
  codeFix: z.string(),
  fixFile: z.string(),
  fixExplanation: z.string(),
  fixAlternatives: z.array(z.string()),
  externalSynthesis: z.string().nullable(),
  model: z.string(),
});
export type LLMEnhancement = z.infer<typeof LLMEnhancementSchema>;

export const DebugPacketSchema = z.object({
  version: z.literal("1.0.0"),
  timestamp: z.string(),
  projectRoot: z.string(),
  testRun: TestRunResultSchema,
  localContext: LocalContextSchema,
  gitContext: GitContextSchema,
  externalKnowledge: ExternalKnowledgeSchema,
  rootCauses: z.array(RootCauseHypothesisSchema),
  llmEnhancement: LLMEnhancementSchema.optional(),
  metadata: z.object({
    tracegenVersion: z.string(),
    analysisSteps: z.array(PipelineStepResultSchema),
  }),
});
export type DebugPacket = z.infer<typeof DebugPacketSchema>;

// ── CLI config ───────────────────────────────────────────────────────

export interface AnalyzeConfig {
  command: string;
  projectRoot: string;
  outputDir: string;
  search: boolean;
  git: boolean;
  writeFiles: boolean;
  llm: boolean;
  llmModel?: string;
  verbose: boolean;
  timeout?: number;
  tavilyApiKey: string | undefined;
  anthropicApiKey: string | undefined;
}

export interface AnalyzeOutputConfig {
  projectRoot: string;
  outputDir: string;
  search: boolean;
  git: boolean;
  writeFiles: boolean;
  llm: boolean;
  llmModel?: string;
  verbose: boolean;
  tavilyApiKey: string | undefined;
  anthropicApiKey: string | undefined;
}

// ── Condensed analysis (for MCP / LLM context) ──────────────────────

export interface CondensedAnalysis {
  error: string;
  file: string | null;
  testName: string | null;
  rootCause: {
    category: string;
    confidence: string;
    explanation: string;
    suggestedFix: string | null;
  } | null;
  codeContext: string | null;
  externalHint: string | null;
  llm?: {
    narrative: string;
    codeFix: string;
    fixFile: string;
    fixExplanation: string;
    alternatives: string[];
  };
}

// ── Pipeline context (mutable, grows through pipeline) ───────────────

export interface PipelineContext {
  config: AnalyzeConfig | AnalyzeOutputConfig;
  testRun?: TestRunResult;
  failures?: TestFailure[];
  localContext?: LocalContext;
  gitContext?: GitContext;
  searchQueries?: string[];
  externalSources?: ExternalSource[];
  externalKnowledge?: ExternalKnowledge;
  rootCauses?: RootCauseHypothesis[];
  steps: PipelineStepResult[];
}
