#!/usr/bin/env node

/**
 * TraceGen MCP Server
 *
 * Exposes TraceGen as an MCP (Model Context Protocol) server so coding agents
 * like Claude Code, Cursor, and Windsurf can call it natively.
 *
 * Register with Claude Code:
 *   claude mcp add tracegen -- npx tsx src/mcp-server.ts
 *
 * Tools exposed:
 *   - tracegen_analyze: Run tests and analyze failures
 *   - tracegen_interpret_error: Interpret raw error output without running tests
 */

import { analyze, analyzeOutput, condense } from "./analyzer/index.js";
import { config as loadEnv } from "dotenv";

loadEnv();
loadEnv({ path: ".env.local", override: true });

// ── JSON-RPC types ───────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

// ── Tool definitions ─────────────────────────────────────────────────

const TOOLS = [
  {
    name: "tracegen_analyze",
    description:
      "Run a test command and analyze failures. Returns structured root cause analysis with confidence levels, suggested fixes, and relevant code context.",
    inputSchema: {
      type: "object" as const,
      properties: {
        command: {
          type: "string",
          description: 'Test command to run (e.g., "npm test", "npx vitest run")',
        },
        projectRoot: {
          type: "string",
          description: "Project root directory (default: current working directory)",
        },
        search: {
          type: "boolean",
          description: "Enable Tavily web search for external context (default: false)",
        },
        llm: {
          type: "boolean",
          description: "Enable LLM-enhanced analysis with Claude for deeper root cause analysis and code fixes (default: false)",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "tracegen_interpret_error",
    description:
      "Interpret raw error/test output without running tests. Use this when you already have the error output and want TraceGen's root cause analysis.",
    inputSchema: {
      type: "object" as const,
      properties: {
        errorOutput: {
          type: "string",
          description: "Raw test or error output to analyze",
        },
        projectRoot: {
          type: "string",
          description: "Project root directory (for code context extraction)",
        },
      },
      required: ["errorOutput"],
    },
  },
];

// ── Tool handlers ────────────────────────────────────────────────────

async function handleAnalyze(params: Record<string, unknown>): Promise<string> {
  const command = String(params["command"] ?? "npm test");
  const projectRoot = String(params["projectRoot"] ?? process.cwd());
  const search = Boolean(params["search"] ?? false);
  const llm = Boolean(params["llm"] ?? false);

  const packet = await analyze({
    command,
    projectRoot,
    outputDir: "./output",
    search,
    git: true,
    writeFiles: false,
    llm,
    verbose: false,
    tavilyApiKey: process.env["TAVILY_API_KEY"],
    anthropicApiKey: process.env["ANTHROPIC_API_KEY"],
  });

  const condensed = condense(packet);
  return JSON.stringify(condensed, null, 2);
}

async function handleInterpretError(params: Record<string, unknown>): Promise<string> {
  const errorOutput = String(params["errorOutput"] ?? "");
  const projectRoot = String(params["projectRoot"] ?? process.cwd());
  const llm = Boolean(params["llm"] ?? false);

  const packet = await analyzeOutput(errorOutput, {
    projectRoot,
    outputDir: "./output",
    search: false,
    git: false,
    writeFiles: false,
    llm,
    verbose: false,
    tavilyApiKey: undefined,
    anthropicApiKey: process.env["ANTHROPIC_API_KEY"],
  });

  const condensed = condense(packet);
  return JSON.stringify(condensed, null, 2);
}

// ── JSON-RPC message handling ────────────────────────────────────────

function respond(id: number | string | null, result: unknown): void {
  const response: JsonRpcResponse = { jsonrpc: "2.0", id, result };
  const msg = JSON.stringify(response);
  process.stdout.write(msg + "\n");
}

function respondError(id: number | string | null, code: number, message: string): void {
  const response: JsonRpcResponse = { jsonrpc: "2.0", id, error: { code, message } };
  const msg = JSON.stringify(response);
  process.stdout.write(msg + "\n");
}

async function handleMessage(raw: string): Promise<void> {
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(raw) as JsonRpcRequest;
  } catch {
    respondError(null, -32700, "Parse error");
    return;
  }

  const { id, method, params } = req;

  switch (method) {
    case "initialize":
      respond(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: {
          name: "tracegen",
          version: "1.0.0",
        },
      });
      break;

    case "tools/list":
      respond(id, { tools: TOOLS });
      break;

    case "tools/call": {
      const toolName = (params as Record<string, unknown>)?.["name"];
      const toolArgs = ((params as Record<string, unknown>)?.["arguments"] ?? {}) as Record<string, unknown>;

      try {
        let content: string;
        if (toolName === "tracegen_analyze") {
          content = await handleAnalyze(toolArgs);
        } else if (toolName === "tracegen_interpret_error") {
          content = await handleInterpretError(toolArgs);
        } else {
          respondError(id, -32601, `Unknown tool: ${String(toolName)}`);
          return;
        }

        respond(id, {
          content: [{ type: "text", text: content }],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        respond(id, {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        });
      }
      break;
    }

    case "notifications/initialized":
      // No response needed for notifications
      break;

    default:
      respondError(id, -32601, `Method not found: ${method}`);
  }
}

// ── Stdin line reader ────────────────────────────────────────────────

async function main(): Promise<void> {
  let buffer = "";

  process.stdin.setEncoding("utf-8");

  for await (const chunk of process.stdin) {
    buffer += chunk as string;

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);

      if (line.length > 0) {
        await handleMessage(line);
      }
    }
  }
}

main().catch((err) => {
  process.stderr.write(`MCP server error: ${err}\n`);
  process.exit(1);
});
