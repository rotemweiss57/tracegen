/**
 * Auto-detects what tool/language produced the error output.
 * Uses pattern matching on the raw text to identify the format.
 */

export type ErrorFormat =
  | "typescript"
  | "vitest"
  | "jest"
  | "eslint"
  | "npm"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "node"
  | "build"
  | "unknown";

// Patterns ordered by specificity — most specific first
const FORMAT_PATTERNS: Array<{ format: ErrorFormat; test: (text: string) => boolean }> = [
  // TypeScript compiler: "file(line,col): error TSXXXX:"
  {
    format: "typescript",
    test: (t) => /\(\d+,\d+\):\s*error\s+TS\d+:/m.test(t),
  },

  // Rust: "error[E0308]:" or "thread 'x' panicked" or "--> file.rs:line:col"
  {
    format: "rust",
    test: (t) =>
      /error\[E\d{4}\]:/m.test(t) ||
      /thread '.*' panicked at/m.test(t) ||
      /^\s*-->\s+\S+\.rs:\d+:\d+/m.test(t),
  },

  // Go: "goroutine N [state]:" or "panic:" with go-style frames, or go compiler
  {
    format: "go",
    test: (t) =>
      /goroutine\s+\d+\s+\[/m.test(t) ||
      (/^panic:/m.test(t) && /\.go:\d+/m.test(t)) ||
      /---\s+FAIL:\s+Test\w+/m.test(t) ||
      /^\.\/?[^\s:]+\.go:\d+:\d+:/m.test(t),
  },

  // Python: "Traceback" or 'File "path", line N' or pytest markers
  {
    format: "python",
    test: (t) =>
      /Traceback \(most recent call last\):/m.test(t) ||
      /^\s*File\s+"[^"]+",\s+line\s+\d+/m.test(t) ||
      /FAILED\s+\S+\.py::/m.test(t),
  },

  // Java: "at package.Class(File.java:N)" or javac errors or "Exception in thread"
  {
    format: "java",
    test: (t) =>
      /^\s+at\s+[\w.$]+\([^)]+\.java:\d+\)/m.test(t) ||
      /\.java:\d+:\s+error:/m.test(t) ||
      /Exception in thread/m.test(t),
  },

  // Vitest: "RUN v3" or "❯" frames
  {
    format: "vitest",
    test: (t) =>
      /RUN\s+v\d/m.test(t) ||
      (/❯\s+\S+/.test(t) && /Tests?\s+\d+\s+failed/i.test(t)),
  },

  // Jest: "Test Suites:" or jest-style test counts
  {
    format: "jest",
    test: (t) =>
      /Test Suites?:\s+\d+/m.test(t) ||
      (/FAIL\s/.test(t) && /Tests?:\s+\d+\s+failed,\s+\d+\s+passed,\s+\d+\s+total/i.test(t)),
  },

  // ESLint: "X problems (Y errors, Z warnings)"
  {
    format: "eslint",
    test: (t) =>
      /\d+\s+problems?\s+\(\d+\s+errors?,\s+\d+\s+warnings?\)/m.test(t) ||
      /^\s*\S+:\d+:\d+\s+(?:error|warning)\s+.+\s+\S+$/m.test(t),
  },

  // npm: "npm error code" or "npm ERR!"
  {
    format: "npm",
    test: (t) =>
      /npm\s+(?:error|ERR!)\s+code\s+\w+/m.test(t) ||
      /npm\s+(?:error|ERR!)/m.test(t),
  },

  // Build errors: "Module not found" or "Build failed"
  {
    format: "build",
    test: (t) =>
      (/Build failed/i.test(t) && !/test/i.test(t.slice(0, 100))) ||
      (/Module not found|Cannot resolve/i.test(t) && /webpack|vite|esbuild|next/i.test(t)),
  },

  // Generic Node.js: stack traces with "at" frames
  {
    format: "node",
    test: (t) =>
      /^\w*Error:.*\n\s+at\s/m.test(t) ||
      /^\s+at\s+.+\(.+:\d+:\d+\)$/m.test(t),
  },
];

export function detectFormat(rawOutput: string): ErrorFormat {
  for (const { format, test } of FORMAT_PATTERNS) {
    if (test(rawOutput)) return format;
  }
  return "unknown";
}
