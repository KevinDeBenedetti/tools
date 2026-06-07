import * as p from "@clack/prompts";
import color from "picocolors";
import { DetectBotsService } from "./bot/detect";
import { PurgeActionsService } from "./purge/purge-actions";
import { PurgePackagesService } from "./purge/purge-packages";
import { PurgeReleaseService } from "./purge/purge-release";
import { PurgeTagsService } from "./purge/purge-tags";
import { ScanSecretsService } from "./secrets/scan-secrets";
import { formatError } from "./shared";
import { log } from "../shared/ui";

// ── Types ──────────────────────────────────────────────────────────────────────

type Command =
  | "detect-bots"
  | "purge-actions"
  | "purge-packages"
  | "purge-release"
  | "purge-tags"
  | "scan-secrets";

interface ParsedInput {
  command: Command | undefined;
  help: boolean;
  interactive: boolean;
  options: Record<string, unknown>;
}

interface CommandDef {
  description: string;
  flags: FlagDef[];
}

interface FlagDef {
  name: string;
  description: string;
  type: "string" | "boolean" | "number" | "string[]";
  default?: unknown;
  required?: boolean;
}

// ── Command definitions ────────────────────────────────────────────────────────

const COMMANDS: Record<Command, CommandDef> = {
  "detect-bots": {
    description: "Detect bot commits in a GitHub repository",
    flags: [
      { description: "GitHub repo (owner/repo)", name: "repo", type: "string" },
      {
        default: true,
        description: "Scan local repository",
        name: "local",
        type: "boolean",
      },
      {
        description: "Show what would be done without doing it",
        name: "dryRun",
        type: "boolean",
      },
      {
        description: "Remove bot commits from Git history",
        name: "purgeBots",
        type: "boolean",
      },
      {
        default: "text",
        description: "Output format (text|json)",
        name: "format",
        type: "string",
      },
    ],
  },
  "purge-actions": {
    description: "Delete GitHub Actions workflow runs",
    flags: [
      {
        description: "GitHub repo (owner/repo)",
        name: "repo",
        required: true,
        type: "string",
      },
      {
        description: "Specific workflow name",
        name: "workflow",
        type: "string",
      },
      {
        description: "Delete runs older than (e.g. 30d, 6m)",
        name: "olderThan",
        type: "string",
      },
      {
        default: 0,
        description: "Number of most recent runs to keep",
        name: "keepLatest",
        type: "number",
      },
      {
        default: "all",
        description: "Workflow status or conclusion",
        name: "status",
        type: "string",
      },
      {
        description: "Preview without deleting",
        name: "dryRun",
        type: "boolean",
      },
      {
        default: 50,
        description: "Batch size for deletions",
        name: "batchSize",
        type: "number",
      },
    ],
  },
  "purge-packages": {
    description: "Delete package versions from GitHub Packages",
    flags: [
      {
        description: "GitHub repo (owner/repo)",
        name: "repo",
        required: true,
        type: "string",
      },
      {
        default: "container",
        description: "Package type (npm|docker|container|...)",
        name: "packageType",
        type: "string",
      },
      {
        description: "Name of the package",
        name: "packageName",
        required: true,
        type: "string",
      },
      {
        default: 0,
        description: "Number of most recent versions to keep",
        name: "keepLatest",
        type: "number",
      },
      {
        description: "Delete versions older than (e.g. 30d)",
        name: "olderThan",
        type: "string",
      },
      {
        description: "Preview without deleting",
        name: "dryRun",
        type: "boolean",
      },
    ],
  },
  "purge-release": {
    description: "Delete GitHub Releases by tag or pattern",
    flags: [
      {
        description: "GitHub repo (owner/repo)",
        name: "repo",
        required: true,
        type: "string",
      },
      {
        description: "Specific release tag to delete",
        name: "tag",
        type: "string",
      },
      {
        description: "Glob pattern matching release tags",
        name: "pattern",
        type: "string",
      },
      {
        default: 0,
        description: "Number of most recent releases to keep",
        name: "keepLatest",
        type: "number",
      },
      {
        description: "Preview without deleting",
        name: "dryRun",
        type: "boolean",
      },
    ],
  },
  "purge-tags": {
    description: "Delete Git tags by pattern",
    flags: [
      {
        description: "GitHub repo (owner/repo)",
        name: "repo",
        required: true,
        type: "string",
      },
      {
        description: "Glob pattern matching tag names to delete",
        name: "pattern",
        type: "string",
      },
      {
        description: "Glob pattern for tags to exclude",
        name: "exclude",
        type: "string",
      },
      {
        default: 0,
        description: "Number of most recent tags to keep",
        name: "keepLatest",
        type: "number",
      },
      {
        description: "Preview without deleting",
        name: "dryRun",
        type: "boolean",
      },
    ],
  },
  "scan-secrets": {
    description: "Scan a repository for leaked secrets",
    flags: [
      { description: "GitHub repo (owner/repo)", name: "repo", type: "string" },
      {
        default: true,
        description: "Scan local repository",
        name: "local",
        type: "boolean",
      },
      { description: "Scan git history too", name: "history", type: "boolean" },
      {
        description: "Preview without scanning",
        name: "dryRun",
        type: "boolean",
      },
      {
        description: "Custom regex patterns",
        name: "patterns",
        type: "string[]",
      },
      {
        default: "text",
        description: "Output format (text|json)",
        name: "format",
        type: "string",
      },
    ],
  },
};

const COMMAND_NAMES = Object.keys(COMMANDS) as Command[];

// ── Arg parsing ────────────────────────────────────────────────────────────────

function toCamelCase(flag: string): string {
  return flag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function toKebabCase(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export function parseCliInput(argv: string[]): ParsedInput {
  let command: Command | undefined;
  let help = false;
  let interactive = false;
  const options: Record<string, unknown> = {};

  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift()!;

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--interactive" || arg === "-i") {
      interactive = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      let key: string;
      let value: string | undefined;

      if (eqIdx === -1) {
        key = toCamelCase(arg.slice(2));
        // Peek next arg for value if it doesn't look like a flag
        if (args.length > 0 && !args[0]!.startsWith("-")) {
          value = args.shift()!;
        }
      } else {
        key = toCamelCase(arg.slice(2, eqIdx));
        value = arg.slice(eqIdx + 1);
      }

      // Resolve type
      const existing = options[key];
      let parsed: unknown;

      if (value === undefined) {
        parsed = true;
      } else if (value === "true") {
        parsed = true;
      } else if (value === "false") {
        parsed = false;
      } else if (/^\d+$/.test(value)) {
        parsed = Number(value);
      } else {
        parsed = value;
      }

      if (existing === undefined) {
        options[key] = parsed;
      } else {
        options[key] = Array.isArray(existing) ? [...existing, parsed] : [existing, parsed];
      }
      continue;
    }

    // Positional
    if (arg.startsWith("-")) {
      continue;
    }
    if (command !== undefined) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
    if (!COMMAND_NAMES.includes(arg as Command)) {
      throw new Error(`Unknown command: ${arg}. Use --help to see available commands.`);
    }
    command = arg as Command;
  }

  return { command, help, interactive, options };
}

// ── Help formatters ────────────────────────────────────────────────────────────

export function formatGeneralHelp(): string {
  const lines: string[] = [
    `${color.bold("GitHub TypeScript CLI")}`,
    "",
    `${color.dim("Usage:")} bun run github [command] [options]`,
    "",
    `${color.bold("Commands:")}`,
  ];

  for (const [name, def] of Object.entries(COMMANDS)) {
    lines.push(`  ${color.cyan(name.padEnd(18))} ${def.description}`);
  }

  lines.push(
    "",
    `${color.bold("Options:")}`,
    "  --help, -h         Show help",
    "  --interactive, -i  Launch interactive TUI",
    "",
    `Run ${color.cyan("bun run github [command] --help")} for command-specific help.`,
  );

  return lines.join("\n");
}

export function formatCommandHelp(command: string): string {
  const def = COMMANDS[command as Command];
  if (!def) {
    return `Unknown command: ${command}`;
  }

  const lines: string[] = [
    `${color.bold(command)} — ${def.description}`,
    "",
    `${color.dim("Usage:")} bun run github:${command} -- [options]`,
    "",
    `${color.bold("Options:")}`,
  ];

  for (const flag of def.flags) {
    const label = `--${toKebabCase(flag.name)}`;
    const req = flag.required ? color.red(" (required)") : "";
    const def_ = flag.default === undefined ? "" : color.dim(` [${JSON.stringify(flag.default)}]`);
    lines.push(`  ${label.padEnd(20)} ${flag.description}${req}${def_}`);
  }

  return lines.join("\n");
}

// ── Mode detection ─────────────────────────────────────────────────────────────

export function shouldUseInteractive(parsed: ParsedInput, isTTY: boolean): boolean {
  if (parsed.help) {
    return false;
  }
  if (parsed.interactive) {
    return true;
  }
  if (!isTTY) {
    return false;
  }
  if (parsed.command) {
    return false;
  }
  return true;
}

// ── Command preview ────────────────────────────────────────────────────────────

function serializeFlag(flag: string, value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => `${flag} ${String(item)}`);
  }
  if (value === true) return [flag];
  if (value === false || value === undefined) return [];
  let s: string;
  if (typeof value === "string") {
    s = value;
  } else if (typeof value === "number" || typeof value === "boolean") {
    s = String(value);
  } else {
    s = JSON.stringify(value);
  }
  return [s.includes(" ") ? `${flag} "${s}"` : `${flag} ${s}`];
}

export function buildCommandPreview(command: string, options: Record<string, unknown>): string {
  const flags = Object.entries(options).flatMap(([key, value]) =>
    serializeFlag(`--${toKebabCase(key)}`, value),
  );
  const base = `bun run github:${command}`;
  return flags.length === 0 ? base : `${base} -- ${flags.join(" ")}`;
}

// ── Interactive TUI ────────────────────────────────────────────────────────────

async function promptString(label: string, placeholder?: string): Promise<string | undefined> {
  const val = await p.text({ message: label, placeholder });
  if (p.isCancel(val)) {
    return undefined;
  }
  return val || undefined;
}

async function promptBoolean(label: string): Promise<boolean> {
  const val = await p.confirm({ initialValue: false, message: label });
  if (p.isCancel(val)) {
    return false;
  }
  return val;
}

async function promptNumber(label: string, defaultValue?: number): Promise<number> {
  const val = await p.text({
    message: label,
    placeholder: defaultValue !== undefined ? String(defaultValue) : undefined,
  });
  if (val && !p.isCancel(val)) {
    const n = Number(val);
    return Number.isNaN(n) ? (defaultValue ?? 0) : n;
  }
  return defaultValue ?? 0;
}

async function collectOptions(command: Command): Promise<Record<string, unknown>> {
  const def = COMMANDS[command];
  const options: Record<string, unknown> = {};

  for (const flag of def.flags) {
    if (flag.type === "boolean") {
      const val = await promptBoolean(flag.description);
      if (val) {
        options[flag.name] = true;
      }
    } else if (flag.type === "number") {
      const val = await promptNumber(`${flag.description} (number)`, flag.default as number);
      options[flag.name] = val;
    } else if (flag.type === "string" || flag.type === "string[]") {
      const defaultStr =
        typeof flag.default === "string" ||
        typeof flag.default === "number" ||
        typeof flag.default === "boolean"
          ? String(flag.default)
          : undefined;
      const val = await promptString(flag.description, defaultStr);
      if (val) {
        options[flag.name] = flag.type === "string[]" ? [val] : val;
      }
    }
  }

  return options;
}

async function runInteractive(): Promise<void> {
  p.intro(color.bold(" GitHub Tools ") + color.dim("— automation CLI"));

  const selected = await p.select({
    message: "Which tool do you want to run?",
    options: COMMAND_NAMES.map((name) => ({
      hint: COMMANDS[name].description,
      label: name,
      value: name,
    })),
  });

  if (p.isCancel(selected)) {
    p.cancel("Cancelled.");
    return;
  }

  const command = selected;

  p.note(COMMANDS[command].description, command);

  const options = await collectOptions(command);
  const preview = buildCommandPreview(command, options);

  p.note(preview, "Command preview");

  const confirmed = await p.confirm({ message: "Run this command?" });
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Cancelled.");
    return;
  }

  await runCommand(command, options);
  p.outro(color.green("Done!"));
}

// ── Command runners ────────────────────────────────────────────────────────────

function logPurgeResult(deleted: number, total: number, noun: string): void {
  if (deleted > 0) {
    log.success(`Deleted ${deleted} of ${total} ${noun}.`);
  } else {
    log.info(`No ${noun} deleted (${total} found).`);
  }
}

async function runCommand(command: Command, options: Record<string, unknown>): Promise<void> {
  switch (command) {
    case "detect-bots": {
      const svc = new DetectBotsService(options);
      const result = await svc.detect();
      log.blank();
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      break;
    }
    case "purge-actions": {
      const result = await new PurgeActionsService(options).purge();
      logPurgeResult(result.deleted, result.total, "workflow runs");
      break;
    }
    case "purge-packages": {
      const result = await new PurgePackagesService(options).purge();
      logPurgeResult(result.deleted, result.deleted, "package versions");
      break;
    }
    case "purge-release": {
      const result = await new PurgeReleaseService(options).purge();
      logPurgeResult(result.deleted, result.total, "releases");
      break;
    }
    case "purge-tags": {
      const result = await new PurgeTagsService(options).purge();
      logPurgeResult(result.deleted, result.total, "tags");
      break;
    }
    case "scan-secrets": {
      const svc = new ScanSecretsService(options);
      const result = await svc.scan();
      log.blank();
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      break;
    }
  }
}

// ── Entry point ────────────────────────────────────────────────────────────────

export async function runGithubCli(argv: string[], isTTY: boolean): Promise<void> {
  let parsed: ParsedInput;

  try {
    parsed = parseCliInput(argv);
  } catch (error) {
    console.error(color.red(`Error: ${formatError(error)}`));
    console.log(formatGeneralHelp());
    process.exit(1);
  }

  if (shouldUseInteractive(parsed, isTTY)) {
    await runInteractive();
    return;
  }

  if (parsed.help && !parsed.command) {
    console.log(formatGeneralHelp());
    return;
  }

  if (parsed.command && parsed.help) {
    console.log(formatCommandHelp(parsed.command));
    return;
  }

  if (!parsed.command) {
    console.log(formatGeneralHelp());
    return;
  }

  try {
    await runCommand(parsed.command, parsed.options);
  } catch (error) {
    console.error(color.red(`Error: ${formatError(error)}`));
    process.exit(1);
  }
}

// ── Direct invocation ──────────────────────────────────────────────────────────

if (import.meta.main) {
  await runGithubCli(process.argv.slice(2), process.stdout.isTTY);
}
