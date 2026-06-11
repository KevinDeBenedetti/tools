import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeClean, scanAuthors, type RewriteRule } from "../github/authors/clean-authors";

function git(repoPath: string, args: string[], env?: Record<string, string>): string {
  return execFileSync("git", args, {
    cwd: repoPath,
    encoding: "utf-8",
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
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

beforeEach(() => {
  repoPath = mkdtempSync(join(tmpdir(), "clean-authors-test-"));
  git(repoPath, ["init", "-q", "-b", "main"]);
});

afterEach(() => {
  rmSync(repoPath, { recursive: true, force: true });
});

describe("scanAuthors", () => {
  test("aggregates author identities by email with commit counts", () => {
    commit(repoPath, "Kevin", "kevin@example.com", "feat: one");
    commit(repoPath, "Kevin", "kevin@example.com", "feat: two");
    commit(repoPath, "dependabot[bot]", "dependabot@github.com", "chore: bump");

    const result = scanAuthors(repoPath);

    expect(result.authors).toEqual([
      { commitCount: 2, email: "kevin@example.com", name: "Kevin" },
      { commitCount: 1, email: "dependabot@github.com", name: "dependabot[bot]" },
    ]);
  });

  test("merges identities differing only by email case", () => {
    commit(repoPath, "Kevin", "Kevin@Example.com", "feat: one");
    commit(repoPath, "Kevin", "kevin@example.com", "feat: two");

    const result = scanAuthors(repoPath);

    expect(result.authors).toHaveLength(1);
    expect(result.authors[0]?.commitCount).toBe(2);
  });

  test("collects Co-Authored-By trailers", () => {
    commit(repoPath, "Kevin", "kevin@example.com", "feat: solo");
    commit(
      repoPath,
      "Kevin",
      "kevin@example.com",
      "fix: pair\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
    );
    commit(
      repoPath,
      "Kevin",
      "kevin@example.com",
      "fix: again\n\nCo-authored-by: Claude <noreply@anthropic.com>",
    );

    const result = scanAuthors(repoPath);

    expect(result.coAuthors).toEqual([
      { commitCount: 2, email: "noreply@anthropic.com", name: "Claude" },
    ]);
  });

  test("returns empty results for a repo without matching data", () => {
    commit(repoPath, "Kevin", "kevin@example.com", "feat: one");

    const result = scanAuthors(repoPath);

    expect(result.authors).toHaveLength(1);
    expect(result.coAuthors).toEqual([]);
  });
});

describe("executeClean", () => {
  const rule: RewriteRule = {
    fromEmail: "dependabot@github.com",
    fromName: "dependabot[bot]",
    toEmail: "kevin@example.com",
    toName: "Kevin",
  };

  test("dry run reports the plan without rewriting history", () => {
    commit(repoPath, "dependabot[bot]", "dependabot@github.com", "chore: bump");
    const before = git(repoPath, ["rev-parse", "HEAD"]);

    const result = executeClean(repoPath, [rule], true, true);

    expect(result).toEqual({ appliedRules: 1, method: "dry-run", removedCoAuthors: true });
    expect(git(repoPath, ["rev-parse", "HEAD"])).toBe(before);
  });

  test("no rules and no co-author removal is a no-op", () => {
    commit(repoPath, "Kevin", "kevin@example.com", "feat: one");

    const result = executeClean(repoPath, [], false, false);

    expect(result).toEqual({ appliedRules: 0, method: "dry-run", removedCoAuthors: false });
  });

  // 60s timeout: without git-filter-repo installed (e.g. CI), executeClean
  // falls back to the much slower two-pass git filter-branch
  test("rewrites author identities and strips Co-Authored-By trailers", () => {
    commit(repoPath, "Kevin", "kevin@example.com", "feat: initial");
    commit(repoPath, "dependabot[bot]", "dependabot@github.com", "chore: bump");
    commit(
      repoPath,
      "Kevin",
      "kevin@example.com",
      "fix: pair\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
    );

    const result = executeClean(repoPath, [rule], true, false);

    expect(["filter-repo", "filter-branch"]).toContain(result.method);
    const after = scanAuthors(repoPath);
    expect(after.authors).toEqual([{ commitCount: 3, email: "kevin@example.com", name: "Kevin" }]);
    expect(after.coAuthors).toEqual([]);
    expect(git(repoPath, ["log", "--format=%s"])).toContain("chore: bump");
  }, 60_000);
});
