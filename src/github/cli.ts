import * as p from "@clack/prompts";
import color from "picocolors";
import { DetectBotsService } from "./bot/detect";
import { PurgeActionsService } from "./purge/purge-actions";
import { PurgePackagesService } from "./purge/purge-packages";
import { PurgeReleaseService } from "./purge/purge-release";
import { PurgeTagsService } from "./purge/purge-tags";
import { ScanSecretsService } from "./secrets/scan-secrets";
import { formatError } from "./shared";

// ── Types ──────────────────────────────────────────────────────────────────────

type Command =
  | "detect-bots"
  | "purge-actions"
  | "purge-packages"
  | "purge-release"
  | "purge-tags"
  | "scan-secrets";

type ParsedInput = {
  command: Command | undefined;
  help: boolean;
  interactive: boolean;
  options: Record<string, unknown>;
};

type CommandDef = {
  description: string;
  flags: FlagDef[];
};

type FlagDef = {
  name: string;
  description: string;
  type: "string" | "boolean" | "number" | "string[]";
  default?: unknown;
  required?: boolean;
};

// ── Command definitions ────────────────────────────────────────────────────────

const COMMANDS: Record<Command, CommandDef> = {
  "detect-bots": {
    description: "Detect bot commits in a GitHub repository",
    flags: [
      { name: "repo", description: "GitHub repo (owner/repo)", type: "string" },
      {
        name: "local",
        description: "Scan local repository",
        type: "boolean",
        default: true,
      },
      {
        name: "dryRun",
        description: "Show what would be done without doing it",
        type: "boolean",
      },
      {
        name: "purgeBots",
        description: "Remove bot commits from Git history",
        type: "boolean",
      },
      {
        name: "format",
        description: "Output format (text|json)",
        type: "string",
        default: "text",
      },
    ],
  },
  "purge-actions": {
    description: "Delete GitHub Actions workflow runs",
    flags: [
      {
        name: "repo",
        description: "GitHub repo (owner/repo)",
        type: "string",
        required: true,
      },
      {
        name: "workflow",
        description: "Specific workflow name",
        type: "string",
      },
      {
        name: "olderThan",
        description: "Delete runs older than (e.g. 30d, 6m)",
        type: "string",
      },
      {
        name: "keepLatest",
        description: "Number of most recent runs to keep",
        type: "number",
        default: 0,
      },
      {
        name: "status",
        description: "Workflow status or conclusion",
        type: "string",
        default: "all",
      },
      {
        name: "dryRun",
        description: "Preview without deleting",
        type: "boolean",
      },
      {
        name: "batchSize",
        description: "Batch size for deletions",
        type: "number",
        default: 50,
      },
    ],
  },
  "purge-packages": {
    description: "Delete package versions from GitHub Packages",
    flags: [
      {
        name: "repo",
        description: "GitHub repo (owner/repo)",
        type: "string",
        required: true,
      },
      {
        name: "packageType",
        description: "Package type (npm|docker|container|...)",
        type: "string",
        default: "container",
      },
      {
        name: "packageName",
        description: "Name of the package",
        type: "string",
        required: true,
      },
      {
        name: "keepLatest",
        description: "Number of most recent versions to keep",
        type: "number",
        default: 0,
      },
      {
        name: "olderThan",
        description: "Delete versions older than (e.g. 30d)",
        type: "string",
      },
      {
        name: "dryRun",
        description: "Preview without deleting",
        type: "boolean",
      },
    ],
  },
  "purge-release": {
    description: "Delete GitHub Releases by tag or pattern",
    flags: [
      {
        name: "repo",
        description: "GitHub repo (owner/repo)",
        type: "string",
        required: true,
      },
      {
        name: "tag",
        description: "Specific release tag to delete",
        type: "string",
      },
      {
        name: "pattern",
        description: "Glob pattern matching release tags",
        type: "string",
      },
      {
        name: "keepLatest",
        description: "Number of most recent releases to keep",
        type: "number",
        default: 0,
      },
      {
        name: "dryRun",
        description: "Preview without deleting",
        type: "boolean",
      },
    ],
  },
  "purge-tags": {
    description: "Delete Git tags by pattern",
    flags: [
      {
        name: "repo",
        description: "GitHub repo (owner/repo)",
        type: "string",
        required: true,
      },
      {
        name: "pattern",
        description: "Glob pattern matching tag names to delete",
        type: "string",
      },
      {
        name: "exclude",
        description: "Glob pattern for tags to exclude",
        type: "string",
      },
      {
        name: "keepLatest",
        description: "Number of most recent tags to keep",
        type: "number",
        default: 0,
      },
      {
        name: "dryRun",
        description: "Preview without deleting",
        type: "boolean",
      },
    ],
  },
  "scan-secrets": {
    description: "Scan a repository for leaked secrets",
    flags: [
      { name: "repo", description: "GitHub repo (owner/repo)", type: "string" },
      {
        name: "local",
        description: "Scan local repository",
        type: "boolean",
        default: true,
      },
      { name: "history", description: "Scan git history too", type: "boolean" },
      {
        name: "dryRun",
        description: "Preview without scanning",
        type: "boolean",
      },
      {
        name: "patterns",
        description: "Custom regex patterns",
        type: "string[]",
      },
      {
        name: "format",
        description: "Output format (text|json)",
        type: "string",
        default: "text",
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

      if (eqIdx !== -1) {
        key = toCamelCase(arg.slice(2, eqIdx));
        value = arg.slice(eqIdx + 1);
      } else {
        key = toCamelCase(arg.slice(2));
        // peek next arg for value if it doesn't look like a flag
        if (args.length > 0 && !args[0]!.startsWith("-")) {
          value = args.shift()!;
        }
      }

      // resolve type
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

      if (existing !== undefined) {
        options[key] = Array.isArray(existing)
          ? [...existing, parsed]
          : [existing, parsed];
      } else {
        options[key] = parsed;
      }
      continue;
    }

    // positional
    if (!arg.startsWith("-")) {
      if (command !== undefined) {
        throw new Error(`Unexpected positional argument: ${arg}`);
      }
      if (!COMMAND_NAMES.includes(arg as Command)) {
        throw new Error(
          `Unknown command: ${arg}. Use --help to see available commands.`,
        );
      }
      command = arg as Command;
      continue;
    }
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

  lines.push("", `${color.bold("Options:")}`);
  lines.push("  --help, -h         Show help");
  lines.push("  --interactive, -i  Launch interactive TUI");
  lines.push("");
  lines.push(
    `Run ${color.cyan("bun run github [command] --help")} for command-specific help.`,
  );

  return lines.join("\n");
}

export function formatCommandHelp(command: Command | string): string {
  const def = COMMANDS[command as Command];
  if (!def) return `Unknown command: ${command}`;

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
    const def_ =
      flag.default !== undefined ? color.dim(` [${flag.default}]`) : "";
    lines.push(`  ${label.padEnd(20)} ${flag.description}${req}${def_}`);
  }

  return lines.join("\n");
}

// ── Mode detection ─────────────────────────────────────────────────────────────

export function shouldUseInteractive(
  parsed: ParsedInput,
  isTTY: boolean,
): boolean {
  if (parsed.help) return false;
  if (parsed.interactive) return true;
  if (!isTTY) return false;
  if (parsed.command) return false;
  return true;
}

// ── Command preview ────────────────────────────────────────────────────────────

export function buildCommandPreview(
  command: Command | string,
  options: Record<string, unknown>,
): string {
  const flags: string[] = [];

  for (const [key, value] of Object.entries(options)) {
    const flag = `--${toKebabCase(key)}`;

    if (Array.isArray(value)) {
      for (const item of value) {
        flags.push(`${flag} ${String(item)}`);
      }
    } else if (value === true) {
      flags.push(flag);
    } else if (value === false || value === undefined) {
      // omit
    } else {
      const strVal = String(value);
      flags.push(
        strVal.includes(" ") ? `${flag} "${strVal}"` : `${flag} ${strVal}`,
      );
    }
  }

  const base = `bun run github:${command}`;
  if (flags.length === 0) return base;
  return `${base} -- ${flags.join(" ")}`;
}

// ── Interactive TUI ────────────────────────────────────────────────────────────

async function promptString(
  label: string,
  placeholder?: string,
): Promise<string | undefined> {
  const val = await p.text({ message: label, placeholder });
  if (p.isCancel(val)) return undefined;
  return (val as string) || undefined;
}

async function promptBoolean(label: string): Promise<boolean> {
  const val = await p.confirm({ message: label, initialValue: false });
  if (p.isCancel(val)) return false;
  return val as boolean;
}

async function promptNumber(
  label: string,
  defaultValue?: number,
): Promise<number> {
  const val = await p.text({
    message: label,
    placeholder: defaultValue !== undefined ? String(defaultValue) : undefined,
  });
  if (p.isCancel(val) || !val) return defaultValue ?? 0;
  const n = Number(val);
  return Number.isNaN(n) ? (defaultValue ?? 0) : n;
}

async function collectOptions(
  command: Command,
): Promise<Record<string, unknown>> {
  const def = COMMANDS[command];
  const options: Record<string, unknown> = {};

  for (const flag of def.flags) {
    if (flag.type === "boolean") {
      const val = await promptBoolean(flag.description);
      if (val) options[flag.name] = true;
    } else if (flag.type === "number") {
      const val = await promptNumber(
        `${flag.description} (number)`,
        flag.default as number,
      );
      options[flag.name] = val;
    } else if (flag.type === "string" || flag.type === "string[]") {
      const val = await promptString(
        flag.description,
        flag.default ? String(flag.default) : undefined,
      );
      if (val) options[flag.name] = flag.type === "string[]" ? [val] : val;
    }
  }

  return options;
}

async function runInteractive(): Promise<void> {
  p.intro(color.bgBlue(color.white(" GitHub Tools ")));

  const selected = await p.select({
    message: "Which tool do you want to run?",
    options: COMMAND_NAMES.map((name) => ({
      value: name,
      label: name,
      hint: COMMANDS[name].description,
    })),
  });

  if (p.isCancel(selected)) {
    p.cancel("Cancelled.");
    return;
  }

  const command = selected as Command;

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

async function runCommand(
  command: Command,
  options: Record<string, unknown>,
): Promise<void> {
  switch (command) {
    case "detect-bots": {
      const svc = new DetectBotsService(options);
      const result = await svc.detect();
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "purge-actions": {
      const svc = new PurgeActionsService(options);
      const result = await svc.purge();
      console.log(`Deleted ${result.deleted} of ${result.total} runs.`);
      break;
    }
    case "purge-packages": {
      const svc = new PurgePackagesService(options);
      const result = await svc.purge();
      console.log(`Deleted ${result.deleted} package versions.`);
      break;
    }
    case "purge-release": {
      const svc = new PurgeReleaseService(options);
      const result = await svc.purge();
      console.log(`Deleted ${result.deleted} of ${result.total} releases.`);
      break;
    }
    case "purge-tags": {
      const svc = new PurgeTagsService(options);
      const result = await svc.purge();
      console.log(`Deleted ${result.deleted} of ${result.total} tags.`);
      break;
    }
    case "scan-secrets": {
      const svc = new ScanSecretsService(options);
      const result = await svc.scan();
      console.log(JSON.stringify(result, null, 2));
      break;
    }
  }
}

// ── Entry point ────────────────────────────────────────────────────────────────

export async function runGithubCli(
  argv: string[],
  isTTY: boolean,
): Promise<void> {
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
