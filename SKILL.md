# TraceGen — Agent Error Analysis

Analyze **any error** from any command. Auto-detects format (TypeScript, tests, npm, ESLint, Node.js crashes).

## Setup

```bash
npx tracegen init          # adds CLAUDE.md + skill + project context
npx tracegen init --deep   # also runs LLM analysis of codebase patterns
```

## Usage

### After any failed command — pipe the output:

```bash
<failed-command> 2>&1 | npx tracegen analyze-output --condensed --no-search --no-git
```

### With LLM enhancement (deeper analysis + code fix):

```bash
<failed-command> 2>&1 | npx tracegen analyze-output --condensed --llm
```

### Common examples:

```bash
tsc --noEmit 2>&1 | npx tracegen analyze-output --condensed --no-search --no-git
npm test 2>&1 | npx tracegen analyze-output --condensed --no-search --no-git
npm install 2>&1 | npx tracegen analyze-output --condensed --no-search --no-git
npm run build 2>&1 | npx tracegen analyze-output --condensed --no-search --no-git
eslint src/ 2>&1 | npx tracegen analyze-output --condensed --no-search --no-git
```

## Reading the output

```json
{
  "error": "TS2322: Type 'string' is not assignable to type 'number'.",
  "file": "src/handler.ts:42",
  "rootCause": {
    "category": "compilation_error",
    "confidence": "high",
    "suggestedFix": "Fix the type mismatch at src/handler.ts:42."
  },
  "llm": {
    "narrative": "The port config expects number but receives string '3000'...",
    "codeFix": "port: 3000,  // remove quotes",
    "fixFile": "src/handler.ts"
  }
}
```

## Acting on results

| Confidence | Action |
|------------|--------|
| **HIGH** | Apply `suggestedFix` directly |
| **MEDIUM** | Read `codeContext` first, then apply |
| **LOW** | Use as starting point, investigate further |

If `llm` field is present, prefer `llm.codeFix` — it's an actual code patch.

## Supported error formats

| Source | Auto-detected | Key errors |
|--------|--------------|------------|
| TypeScript (`tsc`) | Yes | TS2322, TS2345, TS2307, TS2339, TS2554 |
| Vitest / Jest | Yes | Assertions, TypeError, null access, timeout |
| npm | Yes | E404, ERESOLVE, EACCES, ENOENT |
| ESLint | Yes | All rules, auto-fixable detection |
| Node.js | Yes | Stack traces, unhandled rejections |
| Build tools | Yes | Module not found, transform failed |

## Flags

| Flag | Effect |
|------|--------|
| `--condensed` | Compact JSON, no file writes |
| `--llm` | LLM-enhanced analysis (needs ANTHROPIC_API_KEY) |
| `--no-git` | Skip git context (~70ms saved) |
| `--no-search` | Skip web search (~1-5s saved) |

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | No errors found |
| 1 | Errors found and analyzed |
| 2 | Analysis itself failed |
