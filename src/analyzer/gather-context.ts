/**
 * Project Context Gatherer
 *
 * Reads project metadata (package.json, tsconfig, file tree, git history,
 * env vars) to build a structured understanding of the codebase.
 * Used during `tracegen init` to generate .tracegen/context.md.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";

export interface ProjectContext {
  name: string;
  description: string;
  type: string;
  language: string;
  runtime: string;
  dependencies: string[];
  devDependencies: string[];
  scripts: Record<string, string>;
  typescript: {
    strict: boolean;
    target: string;
    module: string;
    noUncheckedIndexedAccess: boolean;
    paths: Record<string, string[]> | null;
  } | null;
  structure: string;
  envVars: string[];
  gitInfo: {
    branch: string | null;
    recentCommits: string[];
    hotFiles: string[];
  } | null;
  testFramework: string | null;
  readme: string | null;
}

function safeReadJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function safeReadText(path: string, maxChars?: number): string | null {
  try {
    const content = readFileSync(path, "utf-8");
    return maxChars ? content.slice(0, maxChars) : content;
  } catch {
    return null;
  }
}

function buildFileTree(dir: string, root: string, depth = 0, maxDepth = 3): string {
  if (depth > maxDepth) return "";
  const lines: string[] = [];
  const indent = "  ".repeat(depth);

  try {
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) =>
        !e.name.startsWith(".") &&
        e.name !== "node_modules" &&
        e.name !== "dist" &&
        e.name !== "output" &&
        e.name !== "coverage",
      )
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        lines.push(`${indent}${entry.name}/`);
        lines.push(buildFileTree(fullPath, root, depth + 1, maxDepth));
      } else {
        lines.push(`${indent}${entry.name}`);
      }
    }
  } catch {
    // Directory unreadable
  }

  return lines.filter(Boolean).join("\n");
}

async function getGitInfo(projectRoot: string): Promise<ProjectContext["gitInfo"]> {
  try {
    const isGit = await execa("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: projectRoot, reject: false, timeout: 5000,
    });
    if (isGit.exitCode !== 0) return null;

    const [branchResult, logResult, hotResult] = await Promise.all([
      execa("git", ["branch", "--show-current"], { cwd: projectRoot, reject: false, timeout: 5000 }),
      execa("git", ["log", "--oneline", "-10"], { cwd: projectRoot, reject: false, timeout: 5000 }),
      execa("git", ["log", "--format=", "--name-only", "-30"], { cwd: projectRoot, reject: false, timeout: 5000 }),
    ]);

    const branch = branchResult.stdout.trim() || null;
    const recentCommits = logResult.stdout.trim().split("\n").filter(Boolean);

    // Count file frequency from recent commits
    const fileCounts = new Map<string, number>();
    for (const file of hotResult.stdout.trim().split("\n").filter(Boolean)) {
      fileCounts.set(file, (fileCounts.get(file) ?? 0) + 1);
    }
    const hotFiles = [...fileCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([file, count]) => `${file} (${count} changes)`);

    return { branch, recentCommits, hotFiles };
  } catch {
    return null;
  }
}

function detectTestFramework(devDeps: string[]): string | null {
  if (devDeps.includes("vitest")) return "vitest";
  if (devDeps.includes("jest")) return "jest";
  if (devDeps.includes("mocha")) return "mocha";
  if (devDeps.includes("ava")) return "ava";
  return null;
}

function detectLanguage(projectRoot: string): string {
  if (existsSync(join(projectRoot, "tsconfig.json"))) return "TypeScript";
  return "JavaScript";
}

export async function gatherProjectContext(projectRoot: string): Promise<ProjectContext> {
  // 1. package.json
  const pkg = safeReadJson(join(projectRoot, "package.json")) ?? {};
  const deps = Object.keys((pkg["dependencies"] as Record<string, string>) ?? {});
  const devDeps = Object.keys((pkg["devDependencies"] as Record<string, string>) ?? {});
  const scripts = (pkg["scripts"] as Record<string, string>) ?? {};
  const engines = (pkg["engines"] as Record<string, string>) ?? {};

  // 2. tsconfig.json
  const tsconfigRaw = safeReadJson(join(projectRoot, "tsconfig.json"));
  const compilerOptions = (tsconfigRaw?.["compilerOptions"] as Record<string, unknown>) ?? null;
  const typescript = compilerOptions
    ? {
        strict: Boolean(compilerOptions["strict"]),
        target: String(compilerOptions["target"] ?? "unknown"),
        module: String(compilerOptions["module"] ?? "unknown"),
        noUncheckedIndexedAccess: Boolean(compilerOptions["noUncheckedIndexedAccess"]),
        paths: (compilerOptions["paths"] as Record<string, string[]>) ?? null,
      }
    : null;

  // 3. File tree
  const srcDir = existsSync(join(projectRoot, "src")) ? "src" : ".";
  const structure = buildFileTree(join(projectRoot, srcDir), projectRoot);

  // 4. .env.example
  const envText = safeReadText(join(projectRoot, ".env.example"));
  const envVars = envText
    ? envText.split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => l.split("=")[0] ?? "")
        .filter(Boolean)
    : [];

  // 5. Git info
  const gitInfo = await getGitInfo(projectRoot);

  // 6. README
  const readme = safeReadText(join(projectRoot, "README.md"), 500)
    ?? safeReadText(join(projectRoot, "readme.md"), 500);

  // 7. Test framework
  const testFramework = detectTestFramework(devDeps);

  return {
    name: String(pkg["name"] ?? "unknown"),
    description: String(pkg["description"] ?? ""),
    type: String(pkg["type"] ?? "commonjs"),
    language: detectLanguage(projectRoot),
    runtime: engines["node"] ? `Node.js ${engines["node"]}` : "Node.js",
    dependencies: deps,
    devDependencies: devDeps,
    scripts,
    typescript,
    structure,
    envVars,
    gitInfo,
    testFramework,
    readme,
  };
}

export function formatContext(ctx: ProjectContext): string {
  const sections: string[] = [];

  sections.push(`# Project Context`);
  sections.push(`Generated by TraceGen on ${new Date().toISOString().split("T")[0]}`);
  sections.push("");

  // Overview
  sections.push("## Overview");
  sections.push(`- **Name**: ${ctx.name}`);
  if (ctx.description) sections.push(`- **Description**: ${ctx.description}`);
  sections.push(`- **Language**: ${ctx.language}`);
  sections.push(`- **Module system**: ${ctx.type === "module" ? "ESM" : "CommonJS"}`);
  sections.push(`- **Runtime**: ${ctx.runtime}`);
  if (ctx.testFramework) sections.push(`- **Test framework**: ${ctx.testFramework}`);
  sections.push("");

  // Stack
  if (ctx.dependencies.length > 0) {
    sections.push("## Dependencies");
    for (const dep of ctx.dependencies.slice(0, 20)) {
      sections.push(`- ${dep}`);
    }
    sections.push("");
  }

  // TypeScript
  if (ctx.typescript) {
    sections.push("## TypeScript Configuration");
    sections.push(`- strict: ${ctx.typescript.strict}`);
    sections.push(`- target: ${ctx.typescript.target}`);
    sections.push(`- module: ${ctx.typescript.module}`);
    sections.push(`- noUncheckedIndexedAccess: ${ctx.typescript.noUncheckedIndexedAccess}`);
    if (ctx.typescript.paths) {
      sections.push(`- paths: ${JSON.stringify(ctx.typescript.paths)}`);
    }
    sections.push("");
  }

  // Structure
  if (ctx.structure) {
    sections.push("## Project Structure");
    sections.push("```");
    sections.push(ctx.structure);
    sections.push("```");
    sections.push("");
  }

  // Environment
  if (ctx.envVars.length > 0) {
    sections.push("## Environment Variables");
    for (const v of ctx.envVars) {
      sections.push(`- ${v}`);
    }
    sections.push("");
  }

  // Git
  if (ctx.gitInfo) {
    sections.push("## Recent Git Activity");
    if (ctx.gitInfo.branch) {
      sections.push(`Branch: ${ctx.gitInfo.branch}`);
    }
    if (ctx.gitInfo.recentCommits.length > 0) {
      sections.push("");
      sections.push("Recent commits:");
      for (const commit of ctx.gitInfo.recentCommits.slice(0, 5)) {
        sections.push(`- ${commit}`);
      }
    }
    if (ctx.gitInfo.hotFiles.length > 0) {
      sections.push("");
      sections.push("Most active files:");
      for (const file of ctx.gitInfo.hotFiles.slice(0, 5)) {
        sections.push(`- ${file}`);
      }
    }
    sections.push("");
  }

  // Scripts
  const scriptKeys = Object.keys(ctx.scripts);
  if (scriptKeys.length > 0) {
    sections.push("## Available Scripts");
    for (const key of scriptKeys.slice(0, 10)) {
      sections.push(`- \`npm run ${key}\`: ${ctx.scripts[key]}`);
    }
    sections.push("");
  }

  return sections.join("\n");
}
