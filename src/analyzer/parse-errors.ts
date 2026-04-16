/**
 * Unified error parser dispatcher.
 * Auto-detects the error format and routes to the appropriate parser.
 */

import type { TestFailure, TestRunResult } from "./types.js";
import { detectFormat, type ErrorFormat } from "./detect-format.js";
import { parseFailures } from "./parse-failure.js";
import { parseTypeScriptErrors } from "./parse-typescript.js";
import { parseEslintErrors } from "./parse-eslint.js";
import { parseNpmErrors } from "./parse-npm.js";
import { parsePythonErrors } from "./parse-python.js";
import { parseGoErrors } from "./parse-go.js";
import { parseRustErrors } from "./parse-rust.js";
import { parseJavaErrors } from "./parse-java.js";

export { type ErrorFormat };

function testRunFromRaw(rawOutput: string): TestRunResult {
  return {
    command: "(provided output)",
    exitCode: 1,
    stdout: rawOutput,
    stderr: "",
    durationMs: 0,
    failures: [],
    totalTests: null,
    passedTests: null,
    failedTests: null,
  };
}

export function parseErrors(
  rawOutput: string,
  projectRoot: string,
): { format: ErrorFormat; failures: TestFailure[] } {
  const format = detectFormat(rawOutput);

  let failures: TestFailure[];

  switch (format) {
    case "typescript":
      failures = parseTypeScriptErrors(rawOutput, projectRoot);
      break;

    case "eslint":
      failures = parseEslintErrors(rawOutput, projectRoot);
      break;

    case "npm":
      failures = parseNpmErrors(rawOutput);
      break;

    case "python":
      failures = parsePythonErrors(rawOutput, projectRoot);
      break;

    case "go":
      failures = parseGoErrors(rawOutput, projectRoot);
      break;

    case "rust":
      failures = parseRustErrors(rawOutput, projectRoot);
      break;

    case "java":
      failures = parseJavaErrors(rawOutput, projectRoot);
      break;

    case "vitest":
    case "jest": {
      const testRun = testRunFromRaw(rawOutput);
      failures = parseFailures(testRun, projectRoot);
      break;
    }

    case "node":
    case "build":
    case "unknown":
    default: {
      const testRun = testRunFromRaw(rawOutput);
      failures = parseFailures(testRun, projectRoot);
      break;
    }
  }

  return { format, failures };
}
