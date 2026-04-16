/**
 * Parser for Go error output.
 * Handles: panics, go test failures, compiler errors, go mod errors.
 */

import type { StackFrame, TestFailure } from "./types.js";
import { isProjectFile, resolveFilePath } from "./utils.js";

// panic: message
const GO_PANIC_RE = /^panic:\s*(.+)$/m;

// goroutine N [state]:
const GO_GOROUTINE_RE = /^goroutine\s+\d+\s+\[/m;

// Stack frame: \tpath/file.go:line +0xNN (tab-indented)
const GO_STACK_RE = /^\t([^\s:]+\.go):(\d+)\s+\+0x[0-9a-f]+$/;

// Function name line before stack frame
const GO_FUNC_RE = /^([\w./]+(?:\.\(?\*?[\w]+\)?)?\.[\w]+)\(.*\)$/;

// Compiler error: ./file.go:line:col: message
const GO_COMPILER_RE = /^\.?\/?([^\s:]+\.go):(\d+):(\d+):\s+(.+)$/;

// go test: --- FAIL: TestName (0.00s)
const GO_TEST_FAIL_RE = /^---\s+FAIL:\s+(\w+)\s+\(([\d.]+)s\)$/m;

// go test file:line: message
const GO_TEST_ERR_RE = /^\s+([\w_]+\.go):(\d+):\s+(.+)$/;



export function parseGoErrors(
  rawOutput: string,
  projectRoot: string,
): TestFailure[] {
  const failures: TestFailure[] = [];
  const lines = rawOutput.split("\n");

  // Check for compiler errors first (most specific)
  const compilerErrors: TestFailure[] = [];
  for (const line of lines) {
    const match = GO_COMPILER_RE.exec(line);
    if (match) {
      const file = match[1] ?? "";
      compilerErrors.push({
        testName: null,
        testFile: null,
        errorMessage: match[4] ?? "",
        errorType: "CompilerError",
        stackTrace: [{
          function: null,
          file: resolveFilePath(file, projectRoot),
          line: parseInt(match[2] ?? "0", 10),
          column: parseInt(match[3] ?? "0", 10),
          isProjectFile: isProjectFile(file, projectRoot),
        }],
        rawOutput: line,
      });
    }
  }
  if (compilerErrors.length > 0) return compilerErrors;

  // Check for panic
  const panicMatch = GO_PANIC_RE.exec(rawOutput);
  if (panicMatch && GO_GOROUTINE_RE.test(rawOutput)) {
    const frames: StackFrame[] = [];
    let currentFunc: string | null = null;

    for (const line of lines) {
      const funcMatch = GO_FUNC_RE.exec(line);
      if (funcMatch) {
        currentFunc = funcMatch[1] ?? null;
        continue;
      }

      const stackMatch = GO_STACK_RE.exec(line);
      if (stackMatch) {
        const file = stackMatch[1] ?? "";
        frames.push({
          function: currentFunc,
          file: resolveFilePath(file, projectRoot),
          line: parseInt(stackMatch[2] ?? "0", 10),
          column: null,
          isProjectFile: isProjectFile(file, projectRoot),
        });
        currentFunc = null;
      }
    }

    failures.push({
      testName: null,
      testFile: null,
      errorMessage: panicMatch[1] ?? "panic",
      errorType: "panic",
      stackTrace: frames,
      rawOutput,
    });
    return failures;
  }

  // Check for go test failures
  const testFailRegex = new RegExp(GO_TEST_FAIL_RE.source, "gm");
  let testMatch;
  while ((testMatch = testFailRegex.exec(rawOutput)) !== null) {
    const testName = testMatch[1] ?? "";
    let errorMessage = "";
    const frames: StackFrame[] = [];

    // Find the error details after the FAIL line
    const failIdx = lines.findIndex((l) => l.includes(`--- FAIL: ${testName}`));
    if (failIdx !== -1) {
      for (let j = failIdx + 1; j < lines.length && j < failIdx + 10; j++) {
        const errMatch = GO_TEST_ERR_RE.exec(lines[j] ?? "");
        if (errMatch) {
          const file = errMatch[1] ?? "";
          if (!errorMessage) errorMessage = errMatch[3] ?? "";
          frames.push({
            function: testName,
            file: resolveFilePath(file, projectRoot),
            line: parseInt(errMatch[2] ?? "0", 10),
            column: null,
            isProjectFile: isProjectFile(file, projectRoot),
          });
        }
      }
    }

    failures.push({
      testName,
      testFile: null,
      errorMessage: errorMessage || `Test ${testName} failed`,
      errorType: "TestFailure",
      stackTrace: frames,
      rawOutput,
    });
  }

  return failures;
}
