/**
 * Variables that pin git to one repository instead of discovering it from the
 * working directory. Git exports them to its hooks, so anything a hook starts
 * (prek's pre-push runs `bun test`) inherits the pushing repository's GIT_DIR:
 * a `git init` in a temporary folder then rewrites that repository's config
 * (setting `core.bare = true`), and every other command acts on it.
 */
export const REPO_PINNING_GIT_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
  "GIT_COMMON_DIR",
] as const;

/**
 * Environment for a git child process that must act on the repository at its
 * `cwd` (or `-C` path): the current environment without the repository-pinning
 * variables, plus `extra`.
 *
 * Always pass it explicitly: under Bun, a child spawned without `env` gets the
 * environment the process started with, whatever was deleted from `process.env`.
 */
export function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of REPO_PINNING_GIT_VARS) delete env[name];
  return { ...env, ...extra };
}
