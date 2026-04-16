/**
 * Parser for Java error output.
 * Handles: exception stack traces, javac compiler errors, JUnit failures.
 */

import type { StackFrame, TestFailure } from "./types.js";
import { isProjectFile, resolveFilePath } from "./utils.js";

// Exception in thread "main" java.lang.NullPointerException: message
const JAVA_HEADER_RE = /(?:Exception in thread "[^"]+"\s+)?([\w.]+(?:Exception|Error)):\s*(.+)/;

// Stack frame: at package.Class.method(File.java:123)
const JAVA_STACK_RE = /^\s+at\s+([\w.$]+)\(([^:)]+\.java):(\d+)\)$/;

// Caused by: exception
const JAVA_CAUSED_RE = /^Caused by:\s+([\w.]+(?:Exception|Error)):\s*(.+)$/;

// javac: File.java:10: error: message
const JAVAC_RE = /^([^\s:]+\.java):(\d+):\s+error:\s+(.+)$/;

// Maven: [ERROR] File.java:[10,5] error: message
const MAVEN_RE = /^\[ERROR\]\s+([^\s:]+\.java):\[(\d+),(\d+)\]\s+(.+)$/;

export function parseJavaErrors(
  rawOutput: string,
  projectRoot: string,
): TestFailure[] {
  const failures: TestFailure[] = [];
  const lines = rawOutput.split("\n");

  // Check for javac compiler errors first
  const compilerErrors: TestFailure[] = [];
  for (const line of lines) {
    const javacMatch = JAVAC_RE.exec(line);
    if (javacMatch) {
      const file = javacMatch[1] ?? "";
      compilerErrors.push({
        testName: null,
        testFile: null,
        errorMessage: javacMatch[3] ?? "",
        errorType: "CompilerError",
        stackTrace: [{
          function: null,
          file: resolveFilePath(file, projectRoot),
          line: parseInt(javacMatch[2] ?? "0", 10),
          column: null,
          isProjectFile: isProjectFile(file, projectRoot),
        }],
        rawOutput: line,
      });
    }

    // Maven compiler errors
    const mavenMatch = MAVEN_RE.exec(line);
    if (mavenMatch) {
      const file = mavenMatch[1] ?? "";
      compilerErrors.push({
        testName: null,
        testFile: null,
        errorMessage: mavenMatch[4] ?? "",
        errorType: "CompilerError",
        stackTrace: [{
          function: null,
          file: resolveFilePath(file, projectRoot),
          line: parseInt(mavenMatch[2] ?? "0", 10),
          column: parseInt(mavenMatch[3] ?? "0", 10),
          isProjectFile: isProjectFile(file, projectRoot),
        }],
        rawOutput: line,
      });
    }
  }
  if (compilerErrors.length > 0) return compilerErrors;

  // Parse exception stack traces
  let currentException: {
    type: string;
    message: string;
    frames: StackFrame[];
    raw: string[];
  } | null = null;

  for (const line of lines) {
    // Check for exception header
    const headerMatch = JAVA_HEADER_RE.exec(line);
    if (headerMatch && !line.startsWith(" ")) {
      // Save previous exception if exists
      if (currentException) {
        failures.push({
          testName: null,
          testFile: null,
          errorMessage: currentException.message,
          errorType: currentException.type,
          stackTrace: currentException.frames,
          rawOutput: currentException.raw.join("\n"),
        });
      }

      currentException = {
        type: headerMatch[1] ?? "Exception",
        message: headerMatch[2] ?? "",
        frames: [],
        raw: [line],
      };
      continue;
    }

    // Check for "Caused by:" (replace current exception with root cause)
    const causedMatch = JAVA_CAUSED_RE.exec(line);
    if (causedMatch && currentException) {
      currentException.type = causedMatch[1] ?? currentException.type;
      currentException.message = causedMatch[2] ?? currentException.message;
      currentException.frames = []; // Reset frames for the root cause
      currentException.raw.push(line);
      continue;
    }

    // Check for stack frame
    const stackMatch = JAVA_STACK_RE.exec(line);
    if (stackMatch && currentException) {
      const file = stackMatch[2] ?? "";
      currentException.frames.push({
        function: stackMatch[1] ?? null,
        file: resolveFilePath(file, projectRoot),
        line: parseInt(stackMatch[3] ?? "0", 10),
        column: null,
        isProjectFile: isProjectFile(file, projectRoot),
      });
      currentException.raw.push(line);
    }
  }

  // Don't forget the last exception
  if (currentException) {
    failures.push({
      testName: null,
      testFile: null,
      errorMessage: currentException.message,
      errorType: currentException.type,
      stackTrace: currentException.frames,
      rawOutput: currentException.raw.join("\n"),
    });
  }

  return failures;
}
