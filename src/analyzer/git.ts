import { execa } from "execa";
import type { GitContext } from "./types.js";
import { truncate } from "./utils.js";

const MAX_DIFF_LENGTH = 5000;

async function git(
  args: string[],
  cwd: string,
): Promise<string | null> {
  try {
    const result = await execa("git", args, {
      cwd,
      reject: false,
      timeout: 10_000,
    });
    if (result.exitCode !== 0) return null;
    return result.stdout.trim();
  } catch {
    return null;
  }
}

export async function getGitContext(
  projectRoot: string,
): Promise<GitContext> {
  const empty: GitContext = {
    available: false,
    diff: null,
    branch: null,
    lastCommitMessage: null,
    lastCommitHash: null,
  };

  // Check if we're in a git repo
  const isGit = await git(["rev-parse", "--is-inside-work-tree"], projectRoot);
  if (isGit !== "true") return empty;

  // Gather info in parallel
  const [diff, branch, log] = await Promise.all([
    git(["diff", "--stat", "--diff-filter=ACMR"], projectRoot).then(
      async (stat) => {
        if (!stat) return null;
        const full = await git(["diff"], projectRoot);
        return full ? truncate(full, MAX_DIFF_LENGTH) : stat;
      },
    ),
    git(["branch", "--show-current"], projectRoot),
    git(["log", "-1", "--format=%H|||%s"], projectRoot),
  ]);

  const [hash, message] = log?.split("|||") ?? [null, null];

  return {
    available: true,
    diff,
    branch,
    lastCommitMessage: message ?? null,
    lastCommitHash: hash ?? null,
  };
}
