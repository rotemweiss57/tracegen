/**
 * Parser for Python error output.
 * Handles: tracebacks, pytest failures, SyntaxError, pip errors.
 */

import type { StackFrame, TestFailure } from "./types.js";
import { isProjectFile, resolveFilePath } from "./utils.js";

// File "path/to/file.py", line N, in function
const PYTHON_FRAME_RE = /^\s*File\s+"([^"]+)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?$/;

// ErrorType: message (at the end of traceback)
const PYTHON_ERROR_RE = /^(\w+(?:Error|Exception|Warning)):\s*(.+)$/;

// pytest: FAILED tests/test_file.py::test_name - ErrorType
const PYTEST_FAIL_RE = /FAILED\s+([^\s:]+)::(\S+)\s*-\s*(\w+)/;

// pip: ERROR: No matching distribution found for X
const PIP_ERROR_RE = /^ERROR:\s*(.+)$/m;

export function parsePythonErrors(
  rawOutput: string,
  projectRoot: string,
): TestFailure[] {
  const failures: TestFailure[] = [];

  // Check for pytest FAILED markers
  const pytestMatches = [...rawOutput.matchAll(new RegExp(PYTEST_FAIL_RE.source, "gm"))];

  // Parse tracebacks
  const tracebacks = rawOutput.split(/Traceback \(most recent call last\):/);

  if (tracebacks.length > 1) {
    // Process each traceback block
    for (let i = 1; i < tracebacks.length; i++) {
      const block = tracebacks[i]!;
      const frames: StackFrame[] = [];
      let errorType: string | null = null;
      let errorMessage = "";

      for (const line of block.split("\n")) {
        const frameMatch = PYTHON_FRAME_RE.exec(line);
        if (frameMatch) {
          const file = frameMatch[1] ?? "";
          const resolved = resolveFilePath(file, projectRoot);
          frames.push({
            function: frameMatch[3] ?? null,
            file: resolved,
            line: parseInt(frameMatch[2] ?? "0", 10),
            column: null,
            isProjectFile: isProjectFile(file, projectRoot),
          });
        }

        const errMatch = PYTHON_ERROR_RE.exec(line.trim());
        if (errMatch) {
          errorType = errMatch[1] ?? null;
          errorMessage = errMatch[2] ?? "";
        }
      }

      if (errorMessage || frames.length > 0) {
        // Match with pytest test name if available
        const pytestMatch = pytestMatches.shift();

        failures.push({
          testName: pytestMatch?.[2] ?? null,
          testFile: pytestMatch?.[1] ?? null,
          errorMessage: errorMessage || "Python error occurred",
          errorType: errorType ?? "Exception",
          stackTrace: frames,
          rawOutput: `Traceback (most recent call last):${block}`,
        });
      }
    }
  }

  // If no tracebacks found, check for standalone errors
  if (failures.length === 0) {
    // Check for pip errors
    const pipMatch = PIP_ERROR_RE.exec(rawOutput);
    if (pipMatch) {
      failures.push({
        testName: null,
        testFile: null,
        errorMessage: pipMatch[1] ?? "pip error",
        errorType: "PipError",
        stackTrace: [],
        rawOutput,
      });
      return failures;
    }

    // Check for SyntaxError or other standalone errors
    for (const line of rawOutput.split("\n")) {
      const errMatch = PYTHON_ERROR_RE.exec(line.trim());
      if (errMatch) {
        // Look for File line above
        const fileFrame: StackFrame[] = [];
        const lines = rawOutput.split("\n");
        const errIdx = lines.findIndex((l) => l.trim() === line.trim());
        for (let j = Math.max(0, errIdx - 3); j < errIdx; j++) {
          const fMatch = PYTHON_FRAME_RE.exec(lines[j] ?? "");
          if (fMatch) {
            const file = fMatch[1] ?? "";
            fileFrame.push({
              function: fMatch[3] ?? null,
              file: resolveFilePath(file, projectRoot),
              line: parseInt(fMatch[2] ?? "0", 10),
              column: null,
              isProjectFile: isProjectFile(file, projectRoot),
            });
          }
        }

        failures.push({
          testName: null,
          testFile: null,
          errorMessage: errMatch[2] ?? "",
          errorType: errMatch[1] ?? "Error",
          stackTrace: fileFrame,
          rawOutput,
        });
        break;
      }
    }

    // Check for pytest FAILED lines without traceback
    for (const match of pytestMatches) {
      failures.push({
        testName: match[2] ?? null,
        testFile: match[1] ?? null,
        errorMessage: `Test failed: ${match[3] ?? "unknown error"}`,
        errorType: match[3] ?? "AssertionError",
        stackTrace: [],
        rawOutput,
      });
    }
  }

  return failures;
}
