import type { TestFailure } from "./types.js";
import { truncate } from "./utils.js";

const MAX_QUERIES = 5;
const MAX_QUERY_LENGTH = 120;

const KNOWN_LIBRARIES = [
  "react",
  "next",
  "express",
  "prisma",
  "mongoose",
  "sequelize",
  "typeorm",
  "jest",
  "vitest",
  "mocha",
  "webpack",
  "vite",
  "rollup",
  "axios",
  "node-fetch",
  "zod",
  "yup",
  "fastify",
  "nestjs",
  "angular",
  "vue",
  "svelte",
  "drizzle",
  "trpc",
];

function detectLibrary(text: string): string | null {
  const lower = text.toLowerCase();
  return KNOWN_LIBRARIES.find((lib) => lower.includes(lib)) ?? null;
}

function cleanErrorMessage(msg: string): string {
  // Remove file paths and line numbers for cleaner queries
  return msg
    .replace(/\/[\w/.:-]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function generateSearchQueries(
  failures: TestFailure[],
): string[] {
  if (failures.length === 0) return [];

  const queries = new Set<string>();

  for (const failure of failures) {
    const { errorMessage, errorType, stackTrace } = failure;
    const cleanMsg = cleanErrorMessage(errorMessage);

    // Query 1: Error type + message
    if (errorType && cleanMsg) {
      queries.add(
        truncate(`${errorType}: ${cleanMsg} fix`, MAX_QUERY_LENGTH),
      );
    } else if (cleanMsg) {
      queries.add(truncate(`${cleanMsg} fix`, MAX_QUERY_LENGTH));
    }

    // Query 2: Stack context — use top project-level function
    const topProjectFrame = stackTrace.find((f) => f.isProjectFile);
    if (topProjectFrame?.function && errorType) {
      queries.add(
        truncate(
          `"${errorType}" in "${topProjectFrame.function}" typescript`,
          MAX_QUERY_LENGTH,
        ),
      );
    }

    // Query 3: Library-specific query
    const library = detectLibrary(errorMessage) ?? detectLibrary(failure.rawOutput);
    if (library) {
      const msgFragment = truncate(cleanMsg, 60);
      queries.add(
        truncate(`${library} "${msgFragment}"`, MAX_QUERY_LENGTH),
      );
    }

    // Query 4: Pattern-specific queries
    if (/cannot read properties of (undefined|null)/i.test(errorMessage)) {
      queries.add(
        "TypeError cannot read properties of undefined common causes javascript",
      );
    } else if (/is not a function/i.test(errorMessage)) {
      queries.add("TypeError is not a function common causes javascript");
    } else if (/cannot find module/i.test(errorMessage)) {
      queries.add("Cannot find module node.js resolve error fix");
    } else if (/assertion/i.test(errorMessage) || errorType === "AssertionError") {
      queries.add("AssertionError expected received mismatch troubleshooting");
    }

    // Query 5: Test framework query
    if (failure.testFile) {
      const framework = /\.spec\./.test(failure.testFile)
        ? "testing framework"
        : /vitest|jest|mocha/.exec(failure.rawOutput.toLowerCase())?.[0] ?? "testing";
      if (errorType) {
        queries.add(
          truncate(`${errorType} ${framework} troubleshooting`, MAX_QUERY_LENGTH),
        );
      }
    }
  }

  return [...queries].slice(0, MAX_QUERIES);
}
