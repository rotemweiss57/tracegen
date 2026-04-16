import { execa } from "execa";
import type { TestRunResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "");
}

export async function runTests(
  command: string,
  projectRoot: string,
  timeout?: number,
): Promise<TestRunResult> {
  const start = performance.now();

  try {
    const result = await execa(command, {
      shell: true,
      cwd: projectRoot,
      reject: false,
      timeout: timeout ?? DEFAULT_TIMEOUT_MS,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    return {
      command,
      exitCode: result.exitCode ?? null,
      stdout: stripAnsi(result.stdout),
      stderr: stripAnsi(result.stderr),
      durationMs: performance.now() - start,
      failures: [], // populated by parse-failure
      totalTests: null,
      passedTests: null,
      failedTests: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      command,
      exitCode: null,
      stdout: "",
      stderr: `Failed to execute command: ${message}`,
      durationMs: performance.now() - start,
      failures: [],
      totalTests: null,
      passedTests: null,
      failedTests: null,
    };
  }
}
