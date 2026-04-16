#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import chalk from "chalk";
import { Command } from "commander";
import { analyze, analyzeOutput, condense } from "./analyzer/index.js";
import type { PipelineStep } from "./analyzer/types.js";

loadEnv();
loadEnv({ path: ".env.local", override: true });

const STEP_LABELS: Record<PipelineStep, string> = {
  run_tests: "Running tests",
  parse_failures: "Parsing failures",
  collect_context: "Collecting local context",
  git_context: "Reading git context",
  generate_queries: "Generating search queries",
  tavily_search: "Searching with Tavily",
  summarize_external: "Summarizing external sources",
  infer_root_causes: "Inferring root causes",
  assemble_packet: "Assembling debug packet",
  llm_enhance: "Enhancing with LLM",
  render_report: "Rendering report",
  write_artifacts: "Writing artifacts",
};

const STEP_ORDER = Object.keys(STEP_LABELS) as PipelineStep[];
const TOTAL_STEPS = STEP_ORDER.length;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function makeStepCallback(quiet: boolean) {
  if (quiet) return undefined;

  return (step: PipelineStep, status: "start" | "done" | "fail", durationMs?: number) => {
    if (status === "start") return;

    const index = STEP_ORDER.indexOf(step) + 1;
    const label = STEP_LABELS[step];
    const time = durationMs !== undefined ? chalk.dim(` (${formatDuration(durationMs)})`) : "";
    const statusText =
      status === "done"
        ? chalk.green("done")
        : chalk.red("failed");

    console.error(
      chalk.dim(`  [${index}/${TOTAL_STEPS}] `) +
        label +
        " " +
        statusText +
        time,
    );
  };
}

// ── Shared options ───────────────────────────────────────────────────

interface SharedOpts {
  project: string;
  output: string;
  search: boolean;
  git: boolean;
  write: boolean;
  open: boolean;
  json: boolean;
  condensed: boolean;
  quiet: boolean;
  verbose: boolean;
  timeout?: string;
}

const program = new Command();

program
  .name("tracegen")
  .description("LLM-native debugging layer for coding agents")
  .version("1.0.0");

// ── analyze command (default) ────────────────────────────────────────

program
  .command("analyze", { isDefault: true })
  .description("Run tests, analyze failures, generate debug packet")
  .option("-c, --command <cmd>", "test command to run", "npm test")
  .option("-p, --project <dir>", "project root directory", ".")
  .option("-o, --output <dir>", "output directory", "./output")
  .option("--no-search", "skip Tavily web search")
  .option("--no-git", "skip git context collection")
  .option("--no-write", "skip writing output files")
  .option("--open", "open HTML report in browser", false)
  .option("--json", "output debug packet as JSON to stdout", false)
  .option("--condensed", "output condensed analysis (for LLM context)", false)
  .option("--quiet", "suppress progress output", false)
  .option("--llm", "enable LLM-enhanced analysis (requires ANTHROPIC_API_KEY)", false)
  .option("--llm-model <model>", "LLM model to use", "claude-haiku-4-5-20251001")
  .option("--timeout <ms>", "test command timeout in milliseconds")
  .option("-v, --verbose", "verbose output", false)
  .action(async (opts: SharedOpts & { command: string; llm: boolean; llmModel: string }) => {
    const projectRoot = resolve(opts.project);
    const outputDir = resolve(opts.output);
    const tavilyApiKey = process.env["TAVILY_API_KEY"];
    const anthropicApiKey = process.env["ANTHROPIC_API_KEY"];
    const jsonMode = opts.json || opts.condensed;
    const quiet = opts.quiet || jsonMode;
    const writeFiles = opts.write && !jsonMode;

    if (!quiet) {
      console.error("");
      console.error(chalk.bold("  TraceGen") + chalk.dim(" — failure interpretation engine"));
      console.error(chalk.dim(`  project: ${projectRoot}`));
      console.error(chalk.dim(`  command: ${opts.command}`));
      console.error(chalk.dim(`  search:  ${opts.search && tavilyApiKey ? "enabled" : "disabled"}`));
      console.error("");

      if (opts.search && !tavilyApiKey) {
        console.error(chalk.yellow("  ! TAVILY_API_KEY not set — web search disabled"));
        console.error("");
      }
    }

    try {
      const packet = await analyze(
        {
          command: opts.command,
          projectRoot,
          outputDir,
          search: opts.search,
          git: opts.git,
          writeFiles,
          llm: opts.llm,
          llmModel: opts.llmModel,
          verbose: opts.verbose,
          timeout: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
          tavilyApiKey,
          anthropicApiKey,
        },
        { onStep: makeStepCallback(quiet) },
      );

      // JSON output modes
      if (opts.condensed) {
        console.log(JSON.stringify(condense(packet), null, 2));
      } else if (opts.json) {
        console.log(JSON.stringify(packet, null, 2));
      }

      if (!quiet) {
        console.error("");
        console.error(chalk.bold.green("  Analysis complete."));
        console.error("");
        console.error(`  ${chalk.dim("Failures:")}    ${packet.testRun.failures.length}`);
        console.error(`  ${chalk.dim("Root causes:")} ${packet.rootCauses.length}`);

        if (writeFiles) {
          console.error(`  ${chalk.dim("Output:")}      ${outputDir}/`);
          console.error("");
          console.error(chalk.dim("  Files written:"));
          console.error(chalk.dim("    - debug-packet.json"));
          console.error(chalk.dim("    - debug-report.md"));
          console.error(chalk.dim("    - debug-report.html"));
          console.error(chalk.dim("    - agent-prompt.txt"));
        }
        console.error("");
      }

      if (opts.open && writeFiles) {
        const htmlPath = resolve(outputDir, "debug-report.html");
        const openCmd =
          process.platform === "darwin" ? "open" :
          process.platform === "win32" ? "start" :
          "xdg-open";
        const { execa: execaFn } = await import("execa");
        await execaFn(openCmd, [htmlPath]).catch(() => {
          console.error(chalk.yellow(`  Could not open browser. Open manually: ${htmlPath}`));
        });
      }

      // Exit code: 0 = no failures, 1 = failures found
      process.exitCode = packet.testRun.failures.length > 0 ? 1 : 0;
    } catch (err) {
      if (!quiet) {
        console.error("");
        console.error(
          chalk.red("  Error: ") +
            (err instanceof Error ? err.message : String(err)),
        );
      }
      process.exitCode = 2;
    }
  });

// ── analyze-output command ───────────────────────────────────────────

program
  .command("analyze-output")
  .description("Analyze raw test output (from stdin or file) without running tests")
  .option("-i, --input <file>", "read test output from file (default: stdin)")
  .option("-p, --project <dir>", "project root directory", ".")
  .option("-o, --output <dir>", "output directory", "./output")
  .option("--no-search", "skip Tavily web search")
  .option("--no-git", "skip git context collection")
  .option("--no-write", "skip writing output files")
  .option("--json", "output debug packet as JSON to stdout", false)
  .option("--condensed", "output condensed analysis (for LLM context)", false)
  .option("--quiet", "suppress progress output", false)
  .option("--llm", "enable LLM-enhanced analysis", false)
  .option("--llm-model <model>", "LLM model to use", "claude-haiku-4-5-20251001")
  .option("-v, --verbose", "verbose output", false)
  .action(async (opts: SharedOpts & { input?: string; llm: boolean; llmModel: string }) => {
    const projectRoot = resolve(opts.project);
    const outputDir = resolve(opts.output);
    const tavilyApiKey = process.env["TAVILY_API_KEY"];
    const anthropicApiKey = process.env["ANTHROPIC_API_KEY"];
    const jsonMode = opts.json || opts.condensed;
    const quiet = opts.quiet || jsonMode;
    const writeFiles = opts.write && !jsonMode;

    // Read input from file or stdin
    let rawOutput: string;
    if (opts.input) {
      rawOutput = readFileSync(resolve(opts.input), "utf-8");
    } else {
      // Read from stdin
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      rawOutput = Buffer.concat(chunks).toString("utf-8");
    }

    if (!quiet) {
      console.error("");
      console.error(chalk.bold("  TraceGen") + chalk.dim(" — analyzing provided output"));
      console.error(chalk.dim(`  input: ${opts.input ?? "stdin"} (${rawOutput.length} chars)`));
      console.error("");
    }

    try {
      const packet = await analyzeOutput(
        rawOutput,
        {
          projectRoot,
          outputDir,
          search: opts.search,
          git: opts.git,
          writeFiles,
          llm: opts.llm,
          llmModel: opts.llmModel,
          verbose: opts.verbose,
          tavilyApiKey,
          anthropicApiKey,
        },
        { onStep: makeStepCallback(quiet) },
      );

      if (opts.condensed) {
        console.log(JSON.stringify(condense(packet), null, 2));
      } else if (opts.json) {
        console.log(JSON.stringify(packet, null, 2));
      }

      if (!quiet) {
        console.error("");
        console.error(chalk.bold.green("  Analysis complete."));
        console.error(`  ${chalk.dim("Failures:")}    ${packet.testRun.failures.length}`);
        console.error(`  ${chalk.dim("Root causes:")} ${packet.rootCauses.length}`);
        console.error("");
      }

      process.exitCode = packet.testRun.failures.length > 0 ? 1 : 0;
    } catch (err) {
      if (!quiet) {
        console.error("");
        console.error(
          chalk.red("  Error: ") +
            (err instanceof Error ? err.message : String(err)),
        );
      }
      process.exitCode = 2;
    }
  });

// ── init command ─────────────────────────────────────────────────────

program
  .command("init")
  .description("Set up TraceGen for your project (CLAUDE.md + skill + context)")
  .option("--deep", "use LLM to analyze codebase patterns (requires ANTHROPIC_API_KEY)", false)
  .action(async (opts: { deep: boolean }) => {
    const { existsSync, mkdirSync, copyFileSync, readFileSync: readFs, writeFileSync: writeFs, readdirSync: readDir } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const cliDir = dirname(fileURLToPath(import.meta.url));
    const projectRoot = process.cwd();

    console.log("");
    console.log(chalk.bold("  TraceGen Init"));
    console.log("");

    // 1. Add CLAUDE.md section
    const claudeMdPath = join(projectRoot, "CLAUDE.md");
    const claudeSection = `
## Error Analysis (TraceGen)

When any command fails (tests, tsc, build, lint, install):
1. Pipe the error output through: \`<failed-command> 2>&1 | npx tracegen analyze-output --condensed --no-search --no-git\`
2. Read the rootCause.suggestedFix before attempting any fix
3. If confidence is HIGH, apply the fix directly
4. If confidence is MEDIUM/LOW, read the codeContext first
5. After fixing, re-run the original command to verify
`;

    if (existsSync(claudeMdPath)) {
      const existing = readFs(claudeMdPath, "utf-8");
      if (existing.includes("TraceGen")) {
        console.log(chalk.dim("  CLAUDE.md already has TraceGen section — skipping"));
      } else {
        writeFs(claudeMdPath, existing + "\n" + claudeSection);
        console.log(chalk.green("  ✓") + " Added TraceGen section to CLAUDE.md");
      }
    } else {
      writeFs(claudeMdPath, "# Project\n" + claudeSection);
      console.log(chalk.green("  ✓") + " Created CLAUDE.md with TraceGen section");
    }

    // 2. Install skill
    const skillDir = join(projectRoot, ".claude", "skills", "trace-errors");
    const skillSource = join(cliDir, "..", "skill", "trace-errors");
    // When running from source (tsx), skill is at repo root
    const altSkillSource = join(cliDir, "..", "..", "skill", "trace-errors");
    const sourceDir = existsSync(skillSource) ? skillSource : existsSync(altSkillSource) ? altSkillSource : null;

    if (sourceDir) {
      mkdirSync(skillDir, { recursive: true });
      const files = readDir(sourceDir);
      for (const file of files) {
        copyFileSync(join(sourceDir, file.toString()), join(skillDir, file.toString()));
      }
      console.log(chalk.green("  ✓") + " Installed trace-errors skill to .claude/skills/");
    } else {
      // Fallback: write the skill directly
      mkdirSync(skillDir, { recursive: true });
      const skillContent = `---
name: trace-errors
description: Analyze errors from failed commands. Use when any bash command fails.
allowed-tools: Bash Read
---

When a command fails, analyze the error:
\`\`\`bash
<failed-command> 2>&1 | npx tracegen analyze-output --condensed --no-search --no-git
\`\`\`
Read rootCause.suggestedFix and apply it. Re-run the command to verify.
`;
      writeFs(join(skillDir, "SKILL.md"), skillContent);
      console.log(chalk.green("  ✓") + " Created trace-errors skill in .claude/skills/");
    }

    // 3. Generate project context
    const { gatherProjectContext, formatContext } = await import("./analyzer/gather-context.js");

    process.stdout.write("  Gathering project context...");
    const ctx = await gatherProjectContext(projectRoot);
    const contextMd = formatContext(ctx);

    // Deep mode: enrich with LLM analysis
    let deepSection = "";
    const anthropicKey = process.env["ANTHROPIC_API_KEY"];
    if (opts.deep && anthropicKey) {
      process.stdout.write(" LLM analysis...");
      try {
        const { generateDeepContext } = await import("./analyzer/deep-context.js");
        deepSection = await generateDeepContext(ctx, projectRoot, anthropicKey);
      } catch (err) {
        deepSection = "\n## Conventions & Patterns\n\nDeep analysis failed: " +
          (err instanceof Error ? err.message : String(err));
      }
    } else if (opts.deep && !anthropicKey) {
      console.log("");
      console.log(chalk.yellow("  ! ANTHROPIC_API_KEY not set — skipping deep analysis"));
    }

    const fullContext = deepSection ? contextMd + "\n" + deepSection : contextMd;

    const { mkdirSync: mkCtxDir, writeFileSync: writeCtx } = await import("node:fs");
    const tracegenDir = join(projectRoot, ".tracegen");
    mkCtxDir(tracegenDir, { recursive: true });
    writeCtx(join(tracegenDir, "context.md"), fullContext);
    console.log(` ${chalk.green("done")}`);
    console.log(chalk.green("  ✓") + ` Generated .tracegen/context.md${opts.deep ? " (with deep analysis)" : ""}`);

    // 4. Add .tracegen/ to .gitignore
    const gitignorePath = join(projectRoot, ".gitignore");
    if (existsSync(gitignorePath)) {
      const gitignore = readFs(gitignorePath, "utf-8");
      if (!gitignore.includes(".tracegen")) {
        writeFs(gitignorePath, gitignore.trimEnd() + "\n.tracegen/\n");
        console.log(chalk.green("  ✓") + " Added .tracegen/ to .gitignore");
      }
    }

    console.log("");
    console.log(chalk.bold.green("  TraceGen is ready."));
    console.log(chalk.dim("  Your agent will now analyze errors automatically."));
    if (!opts.deep) {
      console.log(chalk.dim("  Run 'tracegen init --deep' for LLM-enriched project analysis."));
    }
    console.log("");
  });

program.parse();
