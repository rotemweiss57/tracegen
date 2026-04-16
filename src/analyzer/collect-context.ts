import type { CodeSnippet, LocalContext, TestFailure } from "./types.js";
import {
  extractLines,
  languageFromExtension,
  resolveFilePath,
  safeReadFile,
} from "./utils.js";

const SNIPPET_RADIUS = 15; // lines above and below
const MAX_SNIPPETS = 10;

interface FileLocation {
  file: string;
  line: number;
}

function getFailureLocations(
  failures: TestFailure[],
  projectRoot: string,
): FileLocation[] {
  const locations: FileLocation[] = [];
  const seen = new Set<string>();

  for (const failure of failures) {
    // First: check project-level stack frames
    for (const frame of failure.stackTrace) {
      if (frame.isProjectFile && frame.file && frame.line) {
        const resolved = resolveFilePath(frame.file, projectRoot);
        const key = `${resolved}:${frame.line}`;
        if (!seen.has(key)) {
          seen.add(key);
          locations.push({ file: resolved, line: frame.line });
        }
      }
    }

    // Also include the test file itself if known
    if (failure.testFile) {
      const resolved = resolveFilePath(failure.testFile, projectRoot);
      const key = `${resolved}:1`;
      if (!seen.has(key)) {
        seen.add(key);
        locations.push({ file: resolved, line: 1 });
      }
    }
  }

  return locations;
}

function getRelatedFiles(
  failures: TestFailure[],
  projectRoot: string,
): string[] {
  const files = new Set<string>();

  for (const failure of failures) {
    for (const frame of failure.stackTrace) {
      if (frame.isProjectFile && frame.file) {
        files.add(resolveFilePath(frame.file, projectRoot));
      }
    }
    if (failure.testFile) {
      files.add(resolveFilePath(failure.testFile, projectRoot));
    }
  }

  return [...files];
}

export async function collectContext(
  failures: TestFailure[],
  projectRoot: string,
): Promise<LocalContext> {
  const locations = getFailureLocations(failures, projectRoot);
  const snippets: CodeSnippet[] = [];

  for (const loc of locations) {
    if (snippets.length >= MAX_SNIPPETS) break;

    const content = await safeReadFile(loc.file);
    if (!content) continue;

    const extracted = extractLines(content, loc.line, SNIPPET_RADIUS);

    snippets.push({
      file: loc.file,
      startLine: extracted.startLine,
      endLine: extracted.endLine,
      content: extracted.text,
      language: languageFromExtension(loc.file),
    });
  }

  return {
    snippets,
    relatedFiles: getRelatedFiles(failures, projectRoot),
  };
}
