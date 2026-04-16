/**
 * Parser for Rust error output.
 * Handles: compiler errors (error[EXXXX]), panics, cargo test failures.
 */

import type { StackFrame, TestFailure } from "./types.js";
import { isProjectFile, resolveFilePath } from "./utils.js";

// error[E0308]: mismatched types
const RUST_ERROR_RE = /^error(?:\[E(\d{4})\])?:\s*(.+)$/;

// Location: --> src/file.rs:line:col
const RUST_LOC_RE = /^\s*-->\s+([^:]+):(\d+):(\d+)$/;

// thread 'name' panicked at 'message', file:line:col
// OR: thread 'name' panicked at file:line:col:\nmessage
const RUST_PANIC_RE = /thread '([^']+)' panicked at (?:'([^']*)',\s*)?([^:]+):(\d+):(\d+)/;

// cargo test: test name ... FAILED
const RUST_TEST_RE = /^test\s+([\w:]+)\s+\.\.\.\s+FAILED$/m;

// Assertion: left == right failed
const RUST_ASSERT_RE = /assertion.*failed/i;

export function parseRustErrors(
  rawOutput: string,
  projectRoot: string,
): TestFailure[] {
  const failures: TestFailure[] = [];
  const lines = rawOutput.split("\n");

  // Check for compiler errors (error[EXXXX])
  for (let i = 0; i < lines.length; i++) {
    const errMatch = RUST_ERROR_RE.exec(lines[i]?.trim() ?? "");
    if (!errMatch) continue;

    const errorCode = errMatch[1] ? `E${errMatch[1]}` : null;
    const errorMessage = errMatch[2] ?? "";

    // Look for location on next few lines
    let file: string | null = null;
    let line: number | null = null;
    let column: number | null = null;

    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const locMatch = RUST_LOC_RE.exec(lines[j] ?? "");
      if (locMatch) {
        file = locMatch[1] ?? null;
        line = parseInt(locMatch[2] ?? "0", 10);
        column = parseInt(locMatch[3] ?? "0", 10);
        break;
      }
    }

    const frames: StackFrame[] = [];
    if (file && line) {
      frames.push({
        function: null,
        file: resolveFilePath(file, projectRoot),
        line,
        column,
        isProjectFile: isProjectFile(file, projectRoot),
      });
    }

    const codePrefix = errorCode ? `${errorCode}: ` : "";

    failures.push({
      testName: null,
      testFile: null,
      errorMessage: `${codePrefix}${errorMessage}`,
      errorType: errorCode ? `RustError[${errorCode}]` : "RustError",
      stackTrace: frames,
      rawOutput: lines.slice(i, Math.min(i + 10, lines.length)).join("\n"),
    });
  }

  if (failures.length > 0) return failures;

  // Check for panics
  const panicMatch = RUST_PANIC_RE.exec(rawOutput);
  if (panicMatch) {
    const threadName = panicMatch[1] ?? "main";
    const panicMsg = panicMatch[2] ?? "";
    const file = panicMatch[3] ?? "";
    const line = parseInt(panicMatch[4] ?? "0", 10);
    const col = parseInt(panicMatch[5] ?? "0", 10);

    // Check for assertion details
    let fullMessage = panicMsg;
    if (!fullMessage || RUST_ASSERT_RE.test(rawOutput)) {
      const assertLines = lines
        .filter((l) => /assertion|left:|right:|expected|actual/i.test(l))
        .map((l) => l.trim());
      if (assertLines.length > 0) {
        fullMessage = assertLines.join("; ");
      }
    }

    // Find associated test name
    const testMatch = RUST_TEST_RE.exec(rawOutput);

    failures.push({
      testName: testMatch?.[1] ?? null,
      testFile: null,
      errorMessage: fullMessage || `panic in thread '${threadName}'`,
      errorType: "panic",
      stackTrace: [{
        function: threadName !== "main" ? threadName : null,
        file: resolveFilePath(file, projectRoot),
        line,
        column: col,
        isProjectFile: isProjectFile(file, projectRoot),
      }],
      rawOutput,
    });
  }

  return failures;
}
