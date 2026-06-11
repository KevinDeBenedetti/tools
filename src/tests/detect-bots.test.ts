import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DetectBotsService } from "../github/bot/detect";

function git(repoPath: string, args: string[], env?: Record<string, string>): void {
  execFileSync("git", args, {
    cwd: repoPath,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function commit(repoPath: string, name: string, email: string, message: string): void {
  git(
    repoPath,
    [
      "-c",
      `user.name=${name}`,
      "-c",
      `user.email=${email}`,
      "commit",
      "--allow-empty",
      "-m",
      message,
    ],
    {
      GIT_COMMITTER_NAME: name,
      GIT_COMMITTER_EMAIL: email,
    },
  );
}

let repoPath: string;
let previousCwd: string;

beforeEach(() => {
  repoPath = mkdtempSync(join(tmpdir(), "detect-bots-test-"));
  git(repoPath, ["init", "-q", "-b", "main"]);
  previousCwd = process.cwd();
  process.chdir(repoPath);
});

afterEach(() => {
  process.chdir(previousCwd);
  rmSync(repoPath, { recursive: true, force: true });
});

describe("DetectBotsService", () => {
  test("detects bot authors, including AI assistants", async () => {
    commit(repoPath, "Kevin", "kevin@example.com", "feat: human work");
    commit(
      repoPath,
      "dependabot[bot]",
      "49699333+dependabot[bot]@users.noreply.github.com",
      "chore: bump",
    );
    commit(repoPath, "Claude", "noreply@anthropic.com", "feat: ai work");
    commit(repoPath, "Copilot", "175728472+Copilot@users.noreply.github.com", "fix: suggested");

    const result = await new DetectBotsService({ local: true }).detect();

    expect(result.totalCommits).toBe(4);
    expect(result.botCommits).toHaveLength(3);
    const patterns = result.botCommits.map((c) => c.pattern);
    expect(patterns).toContain("dependabot");
    expect(patterns).toContain("claude");
    expect(patterns).toContain("copilot");
    expect(result.percentage).toBe(75);
  });

  test("detects bots referenced only as Co-Authored-By trailers", async () => {
    commit(
      repoPath,
      "Kevin",
      "kevin@example.com",
      "feat: pair\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>",
    );

    const result = await new DetectBotsService({ local: true }).detect();

    expect(result.botCommits).toHaveLength(1);
    expect(result.botCommits[0]?.pattern).toBe("claude (co-author)");
  });

  test("returns zero counts for a bot-free repository", async () => {
    commit(repoPath, "Kevin", "kevin@example.com", "feat: clean");

    const result = await new DetectBotsService({ local: true }).detect();

    expect(result).toEqual({ botCommits: [], percentage: 0, totalCommits: 1 });
  });

  test("dry run scans nothing", async () => {
    commit(repoPath, "dependabot[bot]", "bot@example.com", "chore: bump");

    const result = await new DetectBotsService({ dryRun: true, local: true }).detect();

    expect(result).toEqual({ botCommits: [], percentage: 0, totalCommits: 0 });
  });

  test("formatOutput renders json and text", async () => {
    commit(repoPath, "Claude", "noreply@anthropic.com", "feat: ai work");

    const service = new DetectBotsService({ format: "json", local: true });
    const result = await service.detect();

    const parsed = JSON.parse(service.formatOutput(result));
    expect(parsed.totalCommits).toBe(1);

    const textService = new DetectBotsService({ format: "text", local: true });
    const text = textService.formatOutput(result);
    expect(text).toContain("Bot commits: 1");
    expect(text).toContain("claude");
  });
});
