import { execFileSync } from "node:child_process";
import { gitEnv } from "../../shared/git-env";

/**
 * Runs git in a test's temporary repository. The environment drops GIT_DIR and
 * the other repository-pinning variables, so a run from a git hook never
 * touches the repository being pushed.
 */
export function git(repoPath: string, args: string[], env?: Record<string, string>): string {
  return execFileSync("git", args, {
    cwd: repoPath,
    encoding: "utf-8",
    env: gitEnv(env),
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
