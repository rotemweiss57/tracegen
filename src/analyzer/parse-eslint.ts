/**
 * Parser for ESLint error output.
 * Format: file:line:col  error|warning  message  rule-name
 */

import type { StackFrame, TestFailure } from "./types.js";
import { isProjectFile } from "./utils.js";

// "  5:12  error  'x' is not defined  no-undef"
const ESLINT_LINE_RE = /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}(\S+)\s*$/;

// "X problems (Y errors, Z warnings)"
const ESLINT_SUMMARY_RE = /(\d+)\s+problems?\s+\((\d+)\s+errors?,\s+(\d+)\s+warnings?\)/;

// Auto-fixable rules (common ones)
const AUTO_FIXABLE_RULES = new Set([
  "semi", "quotes", "indent", "no-var", "prefer-const", "comma-dangle",
  "eol-last", "no-trailing-spaces", "no-multiple-empty-lines",
  "object-curly-spacing", "array-bracket-spacing", "arrow-parens",
  "space-before-function-paren", "keyword-spacing", "space-infix-ops",
  "no-extra-semi", "no-extra-parens", "prefer-arrow-callback",
  "arrow-body-style", "object-shorthand",
  "@typescript-eslint/semi", "@typescript-eslint/quotes",
  "@typescript-eslint/indent", "@typescript-eslint/comma-dangle",
]);

interface EslintError {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
  rule: string;
  autoFixable: boolean;
}

export function parseEslintErrors(
  rawOutput: string,
  projectRoot: string,
): TestFailure[] {
  const lines = rawOutput.split("\n");
  const errors: EslintError[] = [];
  let currentFile = "";

  for (const line of lines) {
    const trimmed = line.trim();

    // File header: a line that's just a file path (no numbers/errors)
    if (trimmed && !ESLINT_LINE_RE.test(trimmed) && !ESLINT_SUMMARY_RE.test(trimmed)) {
      // Check if it looks like a file path
      if (/^[\w./\\]/.test(trimmed) && !trimmed.includes("  ") && !trimmed.startsWith("✖")) {
        currentFile = trimmed;
        continue;
      }
    }

    const match = ESLINT_LINE_RE.exec(line);
    if (match && currentFile) {
      const [, lineStr, colStr, severity, message, rule] = match;
      errors.push({
        file: currentFile,
        line: parseInt(lineStr ?? "0", 10),
        column: parseInt(colStr ?? "0", 10),
        severity: severity === "warning" ? "warning" : "error",
        message: message ?? "",
        rule: rule ?? "",
        autoFixable: AUTO_FIXABLE_RULES.has(rule ?? ""),
      });
    }
  }

  // Only include errors (not warnings) as failures
  const errorOnly = errors.filter((e) => e.severity === "error");
  if (errorOnly.length === 0 && errors.length > 0) {
    // If only warnings, still report them
    return errors.slice(0, 5).map((err) => toFailure(err, projectRoot));
  }

  return errorOnly.map((err) => toFailure(err, projectRoot));
}

function toFailure(err: EslintError, projectRoot: string): TestFailure {
  const frame: StackFrame = {
    function: null,
    file: err.file,
    line: err.line,
    column: err.column,
    isProjectFile: isProjectFile(err.file, projectRoot),
  };

  const fixHint = err.autoFixable ? " (auto-fixable with eslint --fix)" : "";

  return {
    testName: null,
    testFile: null,
    errorMessage: `[${err.rule}] ${err.message}${fixHint}`,
    errorType: err.severity === "error" ? "ESLintError" : "ESLintWarning",
    stackTrace: [frame],
    rawOutput: `${err.file}:${err.line}:${err.column} ${err.severity} ${err.message} ${err.rule}`,
  };
}
