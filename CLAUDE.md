# TraceGen

LLM-native debugging layer for coding agents. TypeScript, ESM, strict mode.

## Error Analysis

When **any command fails** (tests, tsc, build, lint, install), analyze before fixing:

```bash
<failed-command> 2>&1 | npx tracegen analyze-output --condensed --no-search --no-git
```

### Workflow

1. Run the failing command, pipe output through TraceGen
2. Read `rootCause.suggestedFix` — if confidence is **HIGH**, apply directly
3. If confidence is **MEDIUM/LOW**, read `codeContext` first
4. After fixing, re-run the original command to verify

### With LLM (deeper analysis)

```bash
<failed-command> 2>&1 | npx tracegen analyze-output --condensed --llm
```

The `llm` field includes an actual code fix, root cause narrative, and alternatives.

### Quick reference

```bash
# TypeScript errors
tsc --noEmit 2>&1 | npx tracegen analyze-output --condensed --no-search --no-git

# Test failures
npm test 2>&1 | npx tracegen analyze-output --condensed --no-search --no-git

# Build errors
npm run build 2>&1 | npx tracegen analyze-output --condensed --no-search --no-git
```

## Project Commands

- `npm test` — run tests (vitest)
- `npm run typecheck` — TypeScript type checking
- `npm run build` — compile TypeScript
- `npm run benchmark` — run 16-scenario accuracy benchmark
