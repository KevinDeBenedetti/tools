import * as p from "@clack/prompts";
import color from "picocolors";
import { runGithubCli } from "../github/cli";

// ── Tool categories ────────────────────────────────────────────────────────────

type Category = "github" | "copilot" | "todo";

const categoryDescriptions: Record<Category, string> = {
  github:
    "GitHub automation tools (purge runs/releases/tags, detect bots, scan secrets)",
  copilot: "Copilot-powered code review, analysis, generation, and audit",
  todo: "Bidirectional sync between TODO.yml and GitHub Issues",
};

// ── Copilot tool info (CI/CD oriented — show usage guidance) ──────────────────

const copilotTools = ["review", "analyze", "audit", "generate"] as const;
type CopilotTool = (typeof copilotTools)[number];

const copilotDescriptions: Record<CopilotTool, string> = {
  review: "Post an AI code review on a pull request",
  analyze: "Analyze a PR for security, performance, or quality issues",
  audit:
    "Audit a PR for dependency vulnerabilities, secrets, and license issues",
  generate: "Generate tests, docs, changelog, or summary for a PR",
};

const copilotUsage: Record<CopilotTool, string> = {
  review:
    "GITHUB_TOKEN=... bun run src/index.ts  # triggered by GitHub Actions",
  analyze: "Set tool: analyze in your Copilot extension config",
  audit: "Set tool: audit in your Copilot extension config",
  generate: "Set tool: generate in your Copilot extension config",
};

// ── Todo mode info ─────────────────────────────────────────────────────────────

type TodoMode = "push" | "pull" | "labels";

const todoModeDescriptions: Record<TodoMode, string> = {
  push: "TODO.yml → GitHub Issues (create / update issues)",
  pull: "GitHub Issue event → TODO.yml (sync issue changes back)",
  labels: "Sync labels.yml label definitions to the GitHub repo",
};

// ── Clack prompt wrappers ──────────────────────────────────────────────────────

async function promptSelect<T extends string>(
  opts: Parameters<typeof p.select<T>>[0],
): Promise<T | undefined> {
  const value = await p.select<T>(opts);
  if (p.isCancel(value) || typeof value !== "string") return undefined;
  return value as T;
}

async function promptConfirm(
  opts: Parameters<typeof p.confirm>[0],
): Promise<boolean | undefined> {
  const value = await p.confirm(opts);
  if (p.isCancel(value) || typeof value !== "boolean") return undefined;
  return value;
}

// ── Copilot sub-menu ───────────────────────────────────────────────────────────

async function runCopilotMenu(): Promise<void> {
  p.note(
    [
      "Copilot tools run as GitHub Actions extensions via the Copilot SDK.",
      "They cannot be invoked directly from the CLI without a Copilot session.",
      "",
      "Configure them in your GitHub Copilot extension and trigger via PRs.",
    ].join("\n"),
    "Copilot Tools — CI/CD only",
  );

  const tool = await promptSelect<CopilotTool>({
    message: "Which tool would you like to learn about?",
    options: copilotTools.map((t) => ({
      value: t,
      label: t,
      hint: copilotDescriptions[t],
    })),
  });

  if (!tool) {
    p.cancel("Cancelled.");
    return;
  }

  p.note(
    [
      copilotDescriptions[tool],
      "",
      `Usage: ${copilotUsage[tool]}`,
      "",
      `Source: src/copilot/${tool}/`,
    ].join("\n"),
    `${tool} tool`,
  );
}

// ── Todo sub-menu ──────────────────────────────────────────────────────────────

async function runTodoMenu(): Promise<void> {
  const REPO = process.env["GITHUB_REPOSITORY"];
  if (!REPO) {
    p.note(
      "Set GITHUB_REPOSITORY=owner/repo before running todo sync.",
      "⚠️  Missing GITHUB_REPOSITORY",
    );
  } else {
    p.note(`Repository: ${REPO}`, "Todo Sync");
  }

  const mode = await promptSelect<TodoMode>({
    message: "Select sync mode",
    options: [
      { value: "push", label: "push", hint: todoModeDescriptions.push },
      { value: "pull", label: "pull", hint: todoModeDescriptions.pull },
      { value: "labels", label: "labels", hint: todoModeDescriptions.labels },
    ],
  });

  if (!mode) {
    p.cancel("Cancelled.");
    return;
  }

  const confirmed = await promptConfirm({
    message: `Run: bun run src/todo/sync-todo.ts ${mode}?`,
    initialValue: true,
  });

  if (!confirmed) {
    p.cancel("Cancelled.");
    return;
  }

  console.log(`\n→ bun run src/todo/sync-todo.ts ${mode}\n`);

  const proc = Bun.spawn(["bun", "run", "src/todo/sync-todo.ts", mode], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    process.exitCode = code ?? 1;
  }
}

// ── Main unified launcher ──────────────────────────────────────────────────────

async function runMainMenu(): Promise<void> {
  p.intro(color.bgMagenta(color.white(" 🔧 tools ")));

  const category = await promptSelect<Category>({
    message: "Select a tool category",
    options: [
      {
        value: "github",
        label: "GitHub Tools",
        hint: categoryDescriptions.github,
      },
      {
        value: "copilot",
        label: "Copilot Tools",
        hint: categoryDescriptions.copilot,
      },
      { value: "todo", label: "Todo Sync", hint: categoryDescriptions.todo },
    ],
  });

  if (!category) {
    p.cancel("Operation cancelled.");
    return;
  }

  switch (category) {
    case "github":
      p.outro("Launching GitHub Tools…");
      await runGithubCli(["--interactive"], true);
      break;
    case "copilot":
      await runCopilotMenu();
      p.outro("Done.");
      break;
    case "todo":
      await runTodoMenu();
      p.outro("Done.");
      break;
  }
}

if (import.meta.main) {
  try {
    await runMainMenu();
  } catch (error) {
    console.error(
      `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
