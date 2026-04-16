import { readFile } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

const EXTENSION_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".sh": "bash",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".md": "markdown",
  ".sql": "sql",
};

export function languageFromExtension(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return EXTENSION_MAP[ext] ?? "text";
}

export function isProjectFile(
  filePath: string,
  projectRoot: string,
): boolean {
  if (!filePath) return false;
  const resolved = isAbsolute(filePath)
    ? filePath
    : resolve(projectRoot, filePath);
  return resolved.startsWith(projectRoot) && !resolved.includes("node_modules");
}

export function resolveFilePath(
  filePath: string,
  projectRoot: string,
): string {
  if (isAbsolute(filePath)) return filePath;
  return resolve(projectRoot, filePath);
}

export async function safeReadFile(
  filePath: string,
): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function extractLines(
  content: string,
  centerLine: number,
  radius: number,
): { startLine: number; endLine: number; text: string } {
  const lines = content.split("\n");
  const start = Math.max(0, centerLine - 1 - radius);
  const end = Math.min(lines.length, centerLine + radius);
  return {
    startLine: start + 1,
    endLine: end,
    text: lines.slice(start, end).join("\n"),
  };
}
