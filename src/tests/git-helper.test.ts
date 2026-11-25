import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitEnv } from "../shared/git-env";
import { git } from "./helpers/git";

// A git hook (prek's pre-push runs `bun test`) exports GIT_DIR and friends.
// These tests export them on purpose and check that the helpers keep every
// git command inside its temporary repository.
const HOOK_VARS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR"];

let scratch: string;
let outerConfig: string;
let hookGitDir: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(HOOK_VARS.map((name) => [name, process.env[name]]));
  for (const name of HOOK_VARS) delete process.env[name];

  scratch = realpathSync(mkdtempSync(join(tmpdir(), "git-helper-test-")));
  const outer = join(scratch, "outer");
  // The owner's incident: a push from a worktree, so the hook's GIT_DIR is
  // the worktree's git dir and `git init` rewrote the shared config.
  git(scratch, ["init", "-q", "-b", "main", outer]);
  git(outer, [
    "-c",
    "user.name=Outer",
    "-c",
    "user.email=outer@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-q",
    "-m",
    "outer",
  ]);
  git(outer, ["worktree", "add", "-q", join(scratch, "outer-wt")]);
  outerConfig = join(outer, ".git", "config");
  hookGitDir = join(outer, ".git", "worktrees", "outer-wt");
});

afterEach(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(scratch, { recursive: true, force: true });
});

describe("git test helper", () => {
  test("git init with GIT_DIR exported creates the temp repo and leaves the outer repo untouched", () => {
    const configBefore = readFileSync(outerConfig, "utf-8");
    process.env["GIT_DIR"] = hookGitDir;
    process.env["GIT_PREFIX"] = "";

    const repoPath = mkdtempSync(join(scratch, "inner-"));
    git(repoPath, ["init", "-q", "-b", "main"]);

    expect(existsSync(join(repoPath, ".git"))).toBe(true);
    expect(readFileSync(outerConfig, "utf-8")).toBe(configBefore);
    expect(git(scratch, ["config", "--file", outerConfig, "core.bare"])).toBe("false");
  });

  test("gitEnv drops the repository-pinning variables and keeps the rest", () => {
    for (const name of HOOK_VARS) process.env[name] = join(hookGitDir, name);

    const env = gitEnv({ GIT_AUTHOR_NAME: "Kevin" });

    for (const name of HOOK_VARS) expect(env[name]).toBeUndefined();
    expect(env["GIT_AUTHOR_NAME"]).toBe("Kevin");
    expect(env["PATH"]).toBe(process.env["PATH"]);
  });
});
