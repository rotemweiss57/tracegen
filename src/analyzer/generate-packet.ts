import { DebugPacketSchema, type DebugPacket, type PipelineContext } from "./types.js";

const TRACEGEN_VERSION = "1.0.0";

export function generatePacket(ctx: PipelineContext): DebugPacket {
  const command = "command" in ctx.config ? ctx.config.command : "(provided output)";
  const packet: DebugPacket = {
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    projectRoot: ctx.config.projectRoot,
    testRun: ctx.testRun ?? {
      command,
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: 0,
      failures: [],
      totalTests: null,
      passedTests: null,
      failedTests: null,
    },
    localContext: ctx.localContext ?? { snippets: [], relatedFiles: [] },
    gitContext: ctx.gitContext ?? {
      available: false,
      diff: null,
      branch: null,
      lastCommitMessage: null,
      lastCommitHash: null,
    },
    externalKnowledge: ctx.externalKnowledge ?? {
      sources: [],
      summary: "",
      searchAvailable: false,
    },
    rootCauses: ctx.rootCauses ?? [],
    metadata: {
      tracegenVersion: TRACEGEN_VERSION,
      analysisSteps: ctx.steps,
    },
  };

  // Validate the final packet — defense in depth
  return DebugPacketSchema.parse(packet);
}
