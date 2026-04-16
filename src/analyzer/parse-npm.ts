/**
 * Parser for npm error output.
 * Formats: "npm error code EXXXX" / "npm ERR! code EXXXX"
 */

import type { TestFailure } from "./types.js";

// "npm error code E404" or "npm ERR! code ERESOLVE"
const NPM_CODE_RE = /npm\s+(?:error|ERR!)\s+code\s+(\w+)/i;

// "404 Not Found - GET https://registry..."
const NPM_404_RE = /404\s+Not Found.*?-\s*GET\s+(https?:\/\/\S+)/i;

// Package name from 404
const NPM_PKG_RE = /'([^']+)@[^']*'\s+is not in this registry/i;

// ERESOLVE details
const NPM_RESOLVE_RE = /Could not resolve dependency.*?\n.*?peer\s+(\S+)\s+"([^"]+)"/is;

// npm script error
const NPM_SCRIPT_RE = /Missing script:\s*"([^"]+)"/i;

interface NpmError {
  code: string;
  message: string;
  details: string;
}

function parseNpmError(rawOutput: string): NpmError | null {
  const codeMatch = NPM_CODE_RE.exec(rawOutput);
  if (!codeMatch) return null;

  const code = codeMatch[1] ?? "UNKNOWN";
  let message = "";
  let details = "";

  switch (code) {
    case "E404": {
      const pkgMatch = NPM_PKG_RE.exec(rawOutput);
      const urlMatch = NPM_404_RE.exec(rawOutput);
      const pkg = pkgMatch?.[1] ?? "unknown package";
      message = `Package '${pkg}' not found in the npm registry`;
      details = urlMatch?.[1] ?? "";
      break;
    }
    case "ERESOLVE": {
      const resolveMatch = NPM_RESOLVE_RE.exec(rawOutput);
      if (resolveMatch) {
        message = `Peer dependency conflict: ${resolveMatch[1]} requires "${resolveMatch[2]}"`;
      } else {
        message = "Unable to resolve dependency tree — peer dependency conflict";
      }
      details = "Try: npm install --legacy-peer-deps";
      break;
    }
    case "EACCES":
      message = "Permission denied during npm operation";
      details = "Fix permissions or use a different global prefix";
      break;
    case "ENOENT": {
      const scriptMatch = NPM_SCRIPT_RE.exec(rawOutput);
      if (scriptMatch) {
        message = `npm script '${scriptMatch[1]}' not found in package.json`;
      } else {
        message = "File or directory not found during npm operation";
      }
      break;
    }
    case "EINTEGRITY":
      message = "Package integrity check failed — corrupted cache";
      details = "Try: npm cache clean --force && npm install";
      break;
    case "ETARGET":
      message = "Requested package version does not exist";
      details = "Check available versions: npm view <package> versions";
      break;
    default:
      // Extract first meaningful error line
      const errLines = rawOutput.split("\n")
        .filter((l) => /npm\s+(?:error|ERR!)/i.test(l))
        .map((l) => l.replace(/npm\s+(?:error|ERR!)\s*/i, "").trim())
        .filter((l) => l.length > 0 && !l.startsWith("code"));
      message = errLines[0] ?? `npm error ${code}`;
  }

  return { code, message, details };
}

export function parseNpmErrors(rawOutput: string): TestFailure[] {
  const err = parseNpmError(rawOutput);
  if (!err) return [];

  return [{
    testName: null,
    testFile: null,
    errorMessage: `${err.code}: ${err.message}${err.details ? ` — ${err.details}` : ""}`,
    errorType: "NpmError",
    stackTrace: [],
    rawOutput,
  }];
}
