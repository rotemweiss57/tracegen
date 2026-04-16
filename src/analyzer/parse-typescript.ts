/**
 * Parser for TypeScript compiler (tsc) error output.
 * Format: file(line,col): error TSXXXX: message
 */

import type { StackFrame, TestFailure } from "./types.js";
import { isProjectFile, resolveFilePath } from "./utils.js";

// file(line,col): error TSXXXX: message
const TSC_ERROR_RE = /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/;

// "Found N error(s) in M file(s)."
const TSC_SUMMARY_RE = /Found\s+(\d+)\s+errors?\s+in\s+(\d+)\s+files?/i;

interface TscError {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

function parseTscErrors(rawOutput: string): TscError[] {
  const errors: TscError[] = [];

  for (const line of rawOutput.split("\n")) {
    const match = TSC_ERROR_RE.exec(line.trim());
    if (!match) continue;

    const [, file, lineStr, colStr, code, message] = match;
    errors.push({
      file: file ?? "",
      line: parseInt(lineStr ?? "0", 10),
      column: parseInt(colStr ?? "0", 10),
      code: code ?? "",
      message: message ?? "",
    });
  }

  return errors;
}

export function parseTypeScriptErrors(
  rawOutput: string,
  projectRoot: string,
): TestFailure[] {
  const tscErrors = parseTscErrors(rawOutput);
  if (tscErrors.length === 0) return [];

  // Group by file for better context
  const failures: TestFailure[] = [];

  for (const err of tscErrors) {
    const resolvedFile = resolveFilePath(err.file, projectRoot);
    const frame: StackFrame = {
      function: null,
      file: resolvedFile,
      line: err.line,
      column: err.column,
      isProjectFile: isProjectFile(resolvedFile, projectRoot),
    };

    failures.push({
      testName: null,
      testFile: null,
      errorMessage: `${err.code}: ${err.message}`,
      errorType: "TypeError",
      stackTrace: [frame],
      rawOutput: `${err.file}(${err.line},${err.column}): error ${err.code}: ${err.message}`,
    });
  }

  return failures;
}

export function parseTscSummary(rawOutput: string): {
  totalErrors: number | null;
  totalFiles: number | null;
} {
  const match = TSC_SUMMARY_RE.exec(rawOutput);
  if (!match) return { totalErrors: null, totalFiles: null };
  return {
    totalErrors: parseInt(match[1] ?? "0", 10),
    totalFiles: parseInt(match[2] ?? "0", 10),
  };
}
