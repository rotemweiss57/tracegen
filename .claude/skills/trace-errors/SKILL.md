---
name: trace-errors
description: Analyze errors from failed commands (tests, TypeScript, builds, npm, lint). Use when any bash command fails to understand root cause and get fix suggestions before attempting a fix.
allowed-tools: Bash Read
---

# TraceLayer Error Analysis

When a command fails (non-zero exit code), analyze the error before attempting a fix.

## When to Use

- After `npm test` / `vitest` / `jest` fails
- After `tsc --noEmit` reports type errors
- After `npm run build` fails
- After `npm install` fails
- After `eslint` reports errors
- After any script crashes with a stack trace

## How to Use

Pipe the failed command's output through TraceLayer:

```bash
<failed-command> 2>&1 | npx tracelayer analyze-output --condensed --no-search --no-git
```

Or re-run the failing command through TraceLayer directly:

```bash
npx tracelayer analyze --command '<failed-command>' --condensed --no-search --no-git
```

## Reading the Output

The condensed JSON contains:

```json
{
  "error": "The error message",
  "file": "src/file.ts:42",
  "rootCause": {
    "category": "compilation_error",
    "confidence": "high",
    "explanation": "What went wrong and why",
    "suggestedFix": "Specific actionable fix"
  }
}
```

## Acting on Results

1. **HIGH confidence**: Apply the `suggestedFix` directly
2. **MEDIUM confidence**: Read the `codeContext` first, then apply the fix
3. **LOW confidence**: Use the analysis as a starting point, investigate further

## After Fixing

Always re-run the original command to verify the fix worked.

## Supported Error Types

| Source | Error Types |
|--------|-------------|
| TypeScript (`tsc`) | TS2322 type mismatch, TS2345 argument mismatch, TS2307 module not found, TS2339 missing property, TS2554 wrong argument count |
| Tests (vitest/jest) | Assertion failures, TypeError, ReferenceError, null/undefined access, timeout, async errors |
| npm | E404 package not found, ERESOLVE dependency conflicts, EACCES permissions |
| ESLint | All rules, with auto-fixable detection |
| Build tools | Module not found, transform failed, syntax errors |
| Node.js | Stack traces, unhandled rejections, runtime crashes |
