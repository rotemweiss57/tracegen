# TraceGen

**The universal error layer for coding agents.**

TraceGen turns cryptic error output — from tests, TypeScript, builds, npm, or linters — into structured debugging intelligence. Your coding agent stops guessing and starts fixing.

```bash
npx tracegen init    # one-time setup
npm test 2>&1 | npx tracegen analyze-output --condensed   # instant analysis
```

## Why

When a coding agent hits an error, it sees raw terminal output. It guesses at a fix. It gets it wrong. It tries again. Three attempts later, the developer cleans up the mess.

TraceGen fixes this. Every error gets:

- **Root cause category** with confidence level (HIGH/MEDIUM/LOW)
- **Exact file and line** of the bug
- **Suggested fix** with specific instructions
- **Code context** around the error
- **External knowledge** from web search (Tavily, optional)
- **LLM-generated code fix** with data flow narrative (Claude API, optional)

No LLMs needed for core analysis — all heuristics are deterministic. LLM mode is optional and enhances the output.

## Quick Start

```bash
git clone https://github.com/rotemweiss57/tracegen.git
cd tracegen && npm install

# Set up your project
npx tracegen init

# Analyze any error
npm test 2>&1 | npx tracegen analyze-output --condensed
```

## What It Parses (Auto-detected)

| Language / Tool | Format | Example Errors |
|-----------------|--------|----------------|
| **TypeScript** (`tsc`) | `file(line,col): error TSXXXX` | Type mismatch, missing property, wrong args |
| **Python** | `Traceback (most recent call last)` | KeyError, ModuleNotFoundError, AttributeError |
| **Go** | `goroutine N [running]` / `panic:` | Nil pointer, index out of range, compiler errors |
| **Rust** | `error[E0308]:` / `thread panicked` | Type mismatch, borrow checker, missing crate |
| **Java** | `at Class.method(File.java:N)` | NullPointerException, ClassNotFound, javac errors |
| **Vitest / Jest** | `FAIL file.test.ts` | Assertion failures, TypeError, null access |
| **ESLint** | `file:line:col error rule` | All rules, auto-fixable detection |
| **npm** | `npm error code EXXXX` | E404, ERESOLVE, EACCES |
| **Node.js** | Stack traces | Runtime crashes, unhandled rejections |
| **Build tools** | `Module not found` / `Transform failed` | Webpack, Vite, esbuild errors |

## Three Ways to Use

### 1. Pipe any error (fastest)

```bash
tsc --noEmit 2>&1 | npx tracegen analyze-output --condensed
npm test 2>&1 | npx tracegen analyze-output --condensed
npm install 2>&1 | npx tracegen analyze-output --condensed
eslint src/ 2>&1 | npx tracegen analyze-output --condensed
```

### 2. Run a command through TraceGen

```bash
npx tracegen analyze --command "npm test" --condensed
npx tracegen analyze --command "tsc --noEmit" --condensed
```

### 3. MCP server (Claude Code / Cursor native)

```bash
claude mcp add tracegen -- npx tsx src/mcp-server.ts
```

## Output Formats

| Flag | Output | Use case |
|------|--------|----------|
| `--condensed` | Compact JSON to stdout | Agent consumption |
| `--json` | Full DebugPacket to stdout | Programmatic use |
| (default) | Files + progress | Human use |
| `--open` | Opens HTML report in browser | Visual debugging |

### Condensed output example

```json
{
  "error": "TS2322: Type 'string' is not assignable to type 'number'.",
  "file": "src/handler.ts:42",
  "rootCause": {
    "category": "compilation_error",
    "confidence": "high",
    "suggestedFix": "Fix the type mismatch — change the value or update the type definition."
  }
}
```

## LLM Mode (Optional)

Add `--llm` to get Claude-powered analysis on top of heuristics:

```bash
npx tracegen analyze --command "npm test" --condensed --llm
```

**What the LLM adds:**
- **Root cause narrative** — traces data flow across the call chain
- **Actual code fix** — a real patch, not just instructions
- **Fix alternatives** — ranked options (upstream vs downstream fix)
- **External synthesis** — one paragraph from web search results

Requires `ANTHROPIC_API_KEY` in `.env`. Uses Haiku by default (~$0.003/analysis). Switch models with `--llm-model`.

### LLM output example

```json
{
  "llm": {
    "narrative": "getSession() returns null for expired tokens. requireAuth() passes it unchecked to getUserFromSession(), which crashes on .userId access.",
    "codeFix": "if (!session) {\n  return { authenticated: false, error: 'Session expired' };\n}",
    "fixFile": "src/auth.ts",
    "fixExplanation": "Adds a null guard after getSession(), catching expired tokens before they reach getUserFromSession().",
    "alternatives": ["Make getUserFromSession() handle null", "Change getSession() to throw"]
  }
}
```

## Project Context (`tracegen init`)

```bash
npx tracegen init          # static context (free)
npx tracegen init --deep   # LLM-enriched context (one-time ~$0.003)
```

Generates `.tracegen/context.md` — a project briefing that the LLM reads during every analysis. Contains: dependencies, TypeScript config, file structure, environment variables, and (with `--deep`) code patterns and conventions.

This turns the LLM from a generic debugger into a project-specific expert.

## Architecture

```
tracegen init               →  .tracegen/context.md
                                  CLAUDE.md + skill

tracegen analyze --llm      →  run tests → parse errors → collect context
                                  → infer root causes → LLM enhance
                                  → render report → write artifacts

  Output:
  ├─ debug-packet.json         Structured analysis
  ├─ debug-report.md           Human-readable report
  ├─ debug-report.html         Browser-based report
  └─ agent-prompt.txt          Ready for coding agents
```

### Key modules

| Module | Purpose |
|--------|---------|
| `detect-format.ts` | Auto-detects error format (tsc, vitest, eslint, npm, node) |
| `parse-typescript.ts` | TypeScript compiler error parser |
| `parse-eslint.ts` | ESLint error parser with auto-fix detection |
| `parse-npm.ts` | npm error code parser |
| `infer-root-cause.ts` | 50+ heuristic rules across 22 categories |
| `llm-enhance.ts` | Claude API integration for deeper analysis |
| `gather-context.ts` | Project metadata collection |
| `deep-context.ts` | LLM-powered codebase analysis |

## CLI Reference

```bash
# Core commands
tracegen analyze [options]          # Run command + analyze
tracegen analyze-output [options]   # Analyze piped/file input
tracegen init [--deep]              # Set up project

# Key flags
-c, --command <cmd>     # Test command (default: "npm test")
--condensed             # Compact JSON output
--json                  # Full DebugPacket output
--llm                   # Enable LLM enhancement
--llm-model <model>     # LLM model (default: claude-haiku-4-5-20251001)
--no-search             # Skip Tavily web search
--no-git                # Skip git context
--open                  # Open HTML report in browser
```

## Environment Variables

```bash
TAVILY_API_KEY=...      # Optional: enables web search
ANTHROPIC_API_KEY=...   # Optional: enables LLM mode
```

## Agent Integration

### For Claude Code / Cursor

```bash
npx tracegen init    # adds CLAUDE.md section + skill
```

### For any agent (via shell)

```bash
<failed-command> 2>&1 | npx tracegen analyze-output --condensed
```

### Programmatic (Node.js)

```typescript
import { analyze, analyzeOutput, condense } from 'tracegen';
import type { DebugPacket } from 'tracegen/types';

const packet = await analyzeOutput(errorOutput, {
  projectRoot: '.',
  outputDir: './output',
  search: false,
  git: false,
  writeFiles: false,
  llm: true,
  verbose: false,
  tavilyApiKey: undefined,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

console.log(condense(packet));
```

## License

MIT
