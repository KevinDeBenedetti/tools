import type { CommandGroup, CommandSpec } from "../cli/types";

// The todo modules read configuration from env vars (some at module load), so
// commands write resolved flags back to process.env before lazily importing
// the implementation. This keeps the existing GitHub Actions usage working
// while making the CLI usable with plain flags.

function applyEnv(options: Record<string, unknown>, mapping: Record<string, string>): void {
  for (const [flag, envVar] of Object.entries(mapping)) {
    const value = options[flag];
    if (value !== undefined) {
      process.env[envVar] = String(value);
    }
  }
}

const REPO_FLAG = {
  description: "GitHub repo (owner/repo)",
  env: "GITHUB_REPOSITORY",
  name: "repo",
  required: true,
  type: "string",
} as const;

const TODO_PATH_FLAG = {
  default: "TODO.yml",
  description: "Path to TODO.yml",
  env: "TODO_PATH",
  name: "todoPath",
  type: "string",
} as const;

const push: CommandSpec = {
  description: "TODO.yml → GitHub Issues (create / update issues)",
  flags: [{ ...REPO_FLAG }, { ...TODO_PATH_FLAG }],
  name: "push",
  async run(options) {
    applyEnv(options, { repo: "GITHUB_REPOSITORY", todoPath: "TODO_PATH" });
    const { push: pushTodos } = await import("./issues");
    await pushTodos();
  },
};

const pull: CommandSpec = {
  description: "GitHub Issue event → TODO.yml (sync issue changes back)",
  flags: [
    { ...REPO_FLAG },
    { ...TODO_PATH_FLAG },
    {
      description: "Issue number to sync back",
      env: "ISSUE_NUMBER",
      name: "issueNumber",
      required: true,
      type: "number",
    },
  ],
  name: "pull",
  async run(options) {
    applyEnv(options, {
      issueNumber: "ISSUE_NUMBER",
      repo: "GITHUB_REPOSITORY",
      todoPath: "TODO_PATH",
    });
    const { pull: pullTodos } = await import("./issues");
    await pullTodos();
  },
};

const labels: CommandSpec = {
  description: "Sync labels.yml label definitions to the GitHub repo",
  flags: [
    { ...REPO_FLAG },
    {
      default: "labels.yml",
      description: "Path to labels.yml",
      env: "LABELS_PATH",
      name: "labelsPath",
      type: "string",
    },
  ],
  name: "labels",
  async run(options) {
    applyEnv(options, { labelsPath: "LABELS_PATH", repo: "GITHUB_REPOSITORY" });
    const { syncLabels } = await import("./labels");
    await syncLabels();
  },
};

export const todoGroup: CommandGroup = {
  commands: [push, pull, labels],
  description: "Bidirectional sync between TODO.yml and GitHub Issues",
  name: "todo",
};
