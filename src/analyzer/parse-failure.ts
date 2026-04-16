import type { StackFrame, TestFailure, TestRunResult } from "./types.js";
import { isProjectFile } from "./utils.js";

// ── Stack frame parsing ──────────────────────────────────────────────

// Matches: "    at FunctionName (/path/to/file.ts:10:5)"
// and:     "    at /path/to/file.ts:10:5"
const STACK_FRAME_RE =
  /^\s+at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/;

// Vitest format: " ❯ functionName file.ts:10:5"
// Also handles:  " ❯ file.ts:10:5"
const VITEST_FRAME_RE =
  /^\s*❯\s+(?:(\S+)\s+)?(.+?):(\d+):(\d+)$/;

function parseStackFrame(
  line: string,
  projectRoot: string,
): StackFrame | null {
  const match = STACK_FRAME_RE.exec(line) ?? VITEST_FRAME_RE.exec(line);
  if (!match) return null;

  const [, fn, file, lineStr, colStr] = match;
  const lineNum = parseInt(lineStr ?? "", 10);
  const colNum = parseInt(colStr ?? "", 10);

  return {
    function: fn ?? null,
    file: file ?? null,
    line: Number.isNaN(lineNum) ? null : lineNum,
    column: Number.isNaN(colNum) ? null : colNum,
    isProjectFile: isProjectFile(file ?? "", projectRoot),
  };
}

// Vite/esbuild "File: path:line:col" metadata
const FILE_META_RE = /^\s*File:\s*(.+?):(\d+):(\d+)/;

function parseStackTrace(
  lines: string[],
  projectRoot: string,
): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const line of lines) {
    const frame = parseStackFrame(line, projectRoot);
    if (frame) {
      frames.push(frame);
      continue;
    }
    // Also check for "File:" metadata lines (vite/esbuild errors)
    const fileMeta = FILE_META_RE.exec(line);
    if (fileMeta) {
      const [, file, lineStr, colStr] = fileMeta;
      const lineNum = parseInt(lineStr ?? "", 10);
      const colNum = parseInt(colStr ?? "", 10);
      frames.push({
        function: null,
        file: file ?? null,
        line: Number.isNaN(lineNum) ? null : lineNum,
        column: Number.isNaN(colNum) ? null : colNum,
        isProjectFile: isProjectFile(file ?? "", projectRoot),
      });
    }
  }
  return frames;
}

// ── Error type + message extraction ──────────────────────────────────

const ERROR_LINE_RE = /^(\w*Error):\s*(.+)$/;
const ASSERTION_RE = /^(AssertionError)(?:\s*\[.*?\])?:\s*(.+)$/;

interface ErrorInfo {
  errorType: string | null;
  errorMessage: string;
}

function extractErrorInfo(text: string): ErrorInfo {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    const assertMatch = ASSERTION_RE.exec(trimmed);
    if (assertMatch) {
      return {
        errorType: assertMatch[1] ?? null,
        errorMessage: assertMatch[2] ?? trimmed,
      };
    }

    const errMatch = ERROR_LINE_RE.exec(trimmed);
    if (errMatch) {
      return {
        errorType: errMatch[1] ?? null,
        errorMessage: errMatch[2] ?? trimmed,
      };
    }
  }

  // Fallback: first non-empty line
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return { errorType: null, errorMessage: firstLine ?? "Unknown error" };
}

// ── Test name / file extraction ──────────────────────────────────────

// Vitest/Jest: "FAIL src/foo.test.ts > suite > test name"
const VITEST_FAIL_RE = /(?:FAIL|✕|×|✗)\s+(.+\.(?:test|spec)\.\w+)/i;
// Vitest/Jest test name: "  ✕ test name (10 ms)"
const TEST_NAME_RE = /(?:✕|×|✗|FAIL)\s+(.+?)(?:\s+\(\d+\s*m?s\))?$/m;

function extractTestInfo(text: string): {
  testName: string | null;
  testFile: string | null;
} {
  const fileMatch = VITEST_FAIL_RE.exec(text);
  const nameMatch = TEST_NAME_RE.exec(text);

  return {
    testFile: fileMatch?.[1] ?? null,
    testName: nameMatch?.[1] ?? null,
  };
}

// ── Test count extraction ────────────────────────────────────────────

// Jest/generic: "Tests:  2 failed, 3 passed, 5 total"
const TEST_COUNTS_JEST_RE =
  /Tests?(?:\s+Files)?:\s+(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+passed,?\s*)?(\d+)\s+total/i;

// Vitest: "Tests  1 failed | 2 passed (3)"
const TEST_COUNTS_VITEST_RE =
  /Tests\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed\s*\((\d+)\)/i;

interface TestCounts {
  total: number | null;
  passed: number | null;
  failed: number | null;
}

function extractTestCounts(text: string): TestCounts {
  // Try Vitest format first (more specific)
  const vitestMatch = TEST_COUNTS_VITEST_RE.exec(text);
  if (vitestMatch) {
    return {
      failed: vitestMatch[1] ? parseInt(vitestMatch[1], 10) : null,
      passed: vitestMatch[2] ? parseInt(vitestMatch[2], 10) : null,
      total: vitestMatch[3] ? parseInt(vitestMatch[3], 10) : null,
    };
  }

  // Fall back to Jest/generic format
  const match = TEST_COUNTS_JEST_RE.exec(text);
  if (!match) return { total: null, passed: null, failed: null };

  return {
    failed: match[1] ? parseInt(match[1], 10) : null,
    passed: match[2] ? parseInt(match[2], 10) : null,
    total: match[3] ? parseInt(match[3], 10) : null,
  };
}

// ── Main parser: split output into failure blocks ────────────────────

function splitFailureBlocks(output: string): string[] {
  const blocks: string[] = [];

  // Strategy 1: Split on "FAIL" block markers (vitest/jest detailed output)
  // Prefer FAIL blocks over × markers since they contain full error details
  const failSections = output.split(/(?=\bFAIL\b\s)/);
  if (failSections.length > 1) {
    for (const section of failSections) {
      if (/\bFAIL\b\s/.test(section)) {
        blocks.push(section);
      }
    }
    if (blocks.length > 0) return blocks;
  }

  // Strategy 2: Split on error type lines
  const errorSections = output.split(/(?=^\w*Error:)/m);
  if (errorSections.length > 1) {
    for (const section of errorSections) {
      if (/^\w*Error:/m.test(section)) {
        blocks.push(section);
      }
    }
    if (blocks.length > 0) return blocks;
  }

  // Strategy 3: Split on × / ✕ markers (summary lines)
  const crossSections = output.split(/(?=(?:✕|×|✗)\s)/);
  if (crossSections.length > 1) {
    for (const section of crossSections) {
      if (/(?:✕|×|✗)\s/.test(section)) {
        blocks.push(section);
      }
    }
    if (blocks.length > 0) return blocks;
  }

  // Strategy 4: Treat entire output as one block
  if (output.trim().length > 0) {
    blocks.push(output);
  }

  return blocks;
}

// ── Public API ───────────────────────────────────────────────────────

export function parseFailures(
  testRun: TestRunResult,
  projectRoot: string,
): TestFailure[] {
  const combinedOutput = [testRun.stdout, testRun.stderr]
    .filter(Boolean)
    .join("\n");

  if (!combinedOutput.trim()) return [];

  const blocks = splitFailureBlocks(combinedOutput);
  const failures: TestFailure[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const { errorType, errorMessage } = extractErrorInfo(block);
    const { testName, testFile } = extractTestInfo(block);
    const stackTrace = parseStackTrace(lines, projectRoot);

    failures.push({
      testName,
      testFile,
      errorMessage,
      errorType,
      stackTrace,
      rawOutput: block,
    });
  }

  // Update test run counts
  const counts = extractTestCounts(combinedOutput);
  testRun.totalTests = counts.total;
  testRun.passedTests = counts.passed;
  testRun.failedTests = counts.failed;
  testRun.failures = failures;

  return failures;
}
