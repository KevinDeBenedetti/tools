import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as p from "@clack/prompts";
import color from "picocolors";
import { DetectBotsService } from "./bot/detect";
import { PurgeActionsService } from "./purge/purge-actions";
import { PurgePackagesService } from "./purge/purge-packages";
import { PurgeReleaseService } from "./purge/purge-release";
import { PurgeTagsService } from "./purge/purge-tags";
import { ScanSecretsService } from "./secrets/scan-secrets";
import {
  scanAuthors,
  executeClean,
  type RewriteRule,
  type CoAuthorTrailer,
} from "./authors/clean-authors";
import { formatError } from "./shared";
import { log, table } from "../shared/ui";

// ── Types ──────────────────────────────────────────────────────────────────────

type Command =
  | "clean-authors"
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
  "clean-authors": {
    description: "Normalize author identities and remove Co-Authored-By trailers",
    flags: [
      {
        description:
          "GitHub repo (owner/repo) to clone fresh and clean (default: current directory)",
        name: "repo",
        type: "string",
      },
      {
        description: "Canonical author email to keep (others mapped to this one)",
        name: "canonical",
        type: "string",
      },
      {
        default: true,
        description: "Remove Co-Authored-By trailers from commit messages",
        name: "removeCoAuthors",
        type: "boolean",
      },
      {
        description: "Actually rewrite history (default is a dry-run preview)",
        name: "execute",
        type: "boolean",
      },
    ],
  },
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
        description: "Actually delete (default is a dry-run preview)",
        name: "execute",
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
        description: "Actually delete (default is a dry-run preview)",
        name: "execute",
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
        description: "Actually delete (default is a dry-run preview)",
        name: "execute",
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
        description: "Actually delete (default is a dry-run preview)",
        name: "execute",
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

// ── clean-authors wizard ───────────────────────────────────────────────────────

async function promptCanonical(
  authors: { name: string; email: string; commitCount: number }[],
): Promise<{ name: string; email: string } | null> {
  const choice = await p.select({
    message: "Select the canonical identity to keep",
    options: authors.map((a) => ({
      hint: `${a.commitCount} commit${a.commitCount === 1 ? "" : "s"}`,
      label: `${a.name} <${a.email}>`,
      value: a.email,
    })),
  });
  if (p.isCancel(choice)) return null;
  return authors.find((a) => a.email.toLowerCase() === choice.toLowerCase()) ?? null;
}

async function promptRemoveCoAuthors(coAuthors: CoAuthorTrailer[]): Promise<boolean | null> {
  const n = coAuthors.length;
  const answer = await p.confirm({
    initialValue: true,
    message: `Remove ${n} Co-Authored-By trailer${n === 1 ? "" : "s"}?`,
  });
  if (p.isCancel(answer)) return null;
  return answer;
}

function printRewritePlan(
  rules: RewriteRule[],
  coAuthors: CoAuthorTrailer[],
  removeCoAuthors: boolean,
): void {
  console.log(`\n  ${color.bold("Rewrite plan")}\n`);
  for (const r of rules) {
    log.step(`${r.fromName} <${r.fromEmail}>  →  ${r.toName} <${r.toEmail}>`);
  }
  if (removeCoAuthors) {
    for (const ca of coAuthors) {
      log.step(`Remove Co-Authored-By: ${ca.name} <${ca.email}>`);
    }
  }
  console.log();
  log.warn("History will be rewritten — force-push required: git push --force-with-lease");
  console.log();
}

async function runCleanAuthorsInteractive(): Promise<void> {
  const repoPath = process.cwd();

  const spinner = p.spinner();
  spinner.start("Scanning repository authors…");
  let scanResult;
  try {
    scanResult = scanAuthors(repoPath);
    spinner.stop("Scan complete");
  } catch (err) {
    spinner.stop("Scan failed");
    log.error(formatError(err));
    return;
  }

  log.blank();
  table(
    [{ label: "Author" }, { label: "Commits", align: "right" }],
    scanResult.authors.map((a) => [`${a.name} <${a.email}>`, String(a.commitCount)]),
  );

  if (scanResult.coAuthors.length > 0) {
    log.blank();
    table(
      [{ label: "Co-Authored-By trailer" }, { label: "Commits", align: "right" }],
      scanResult.coAuthors.map((a) => [`${a.name} <${a.email}>`, String(a.commitCount)]),
    );
  }

  log.blank();

  if (scanResult.authors.length <= 1 && scanResult.coAuthors.length === 0) {
    log.info("All commits already use a single identity. Nothing to clean.");
    return;
  }

  const canonical = await promptCanonical(scanResult.authors);
  if (!canonical) {
    p.cancel("Cancelled.");
    return;
  }

  let removeCoAuthors = false;
  if (scanResult.coAuthors.length > 0) {
    const answer = await promptRemoveCoAuthors(scanResult.coAuthors);
    if (answer === null) {
      p.cancel("Cancelled.");
      return;
    }
    removeCoAuthors = answer;
  }

  const rules: RewriteRule[] = scanResult.authors
    .filter((a) => a.email.toLowerCase() !== canonical.email.toLowerCase())
    .map((a) => ({
      fromEmail: a.email,
      fromName: a.name,
      toEmail: canonical.email,
      toName: canonical.name,
    }));

  if (rules.length === 0 && !removeCoAuthors) {
    log.info("Nothing to rewrite.");
    return;
  }

  printRewritePlan(rules, scanResult.coAuthors, removeCoAuthors);

  const confirmed = await p.confirm({ message: "Proceed?" });
  if (p.isCancel(confirmed) || confirmed === false) {
    p.cancel("Cancelled.");
    return;
  }

  const result = executeClean(repoPath, rules, removeCoAuthors, false);

  log.blank();
  if (result.appliedRules > 0) {
    log.success(
      `Rewrote ${result.appliedRules} author mapping${result.appliedRules === 1 ? "" : "s"} via ${result.method}.`,
    );
  }
  if (result.removedCoAuthors) {
    log.success("Removed Co-Authored-By trailers.");
  }
  log.info("Next step: git push --force-with-lease");
}

// ── Interactive TUI ────────────────────────────────────────────────────────────

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

  if (command === "clean-authors") {
    await runCleanAuthorsInteractive();
    p.outro(color.green("Done!"));
    return;
  }

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

// Destructive commands preview by default; --execute turns the preview off.
function withExecuteSemantics(options: Record<string, unknown>): Record<string, unknown> {
  const dryRun = options["execute"] !== true;
  if (dryRun) {
    log.info("Dry run — pass --execute to actually delete.");
  }
  return { ...options, dryRun };
}

function resolveCleanAuthorsRepoPath(options: Record<string, unknown>): string {
  const repo = options["repo"] as string | undefined;
  if (!repo) {
    return process.cwd();
  }
  const repoPath = join(mkdtempSync(join(tmpdir(), "clean-authors-")), "repo");
  log.info(`Cloning ${repo} into ${repoPath}…`);
  execFileSync("gh", ["repo", "clone", repo, repoPath], { stdio: "inherit" });
  return repoPath;
}

function runCleanAuthors(options: Record<string, unknown>): void {
  const repoPath = resolveCleanAuthorsRepoPath(options);
  const scanResult = scanAuthors(repoPath);
  const canonicalEmail = options["canonical"] as string | undefined;

  if (!canonicalEmail) {
    log.blank();
    table(
      [{ label: "Author" }, { label: "Commits", align: "right" }],
      scanResult.authors.map((a) => [`${a.name} <${a.email}>`, String(a.commitCount)]),
    );
    if (scanResult.coAuthors.length > 0) {
      log.blank();
      table(
        [{ label: "Co-Authored-By trailer" }, { label: "Commits", align: "right" }],
        scanResult.coAuthors.map((a) => [`${a.name} <${a.email}>`, String(a.commitCount)]),
      );
    }
    log.blank();
    log.info("Specify --canonical <email> to select the identity to keep.");
    return;
  }

  const canonical = scanResult.authors.find(
    (a) => a.email.toLowerCase() === canonicalEmail.toLowerCase(),
  );
  if (!canonical) {
    throw new Error(`No author with email '${canonicalEmail}' found in git history.`);
  }

  const removeCoAuthors = options["removeCoAuthors"] !== false;
  const dryRun = options["execute"] !== true;
  const rules: RewriteRule[] = scanResult.authors
    .filter((a) => a.email.toLowerCase() !== canonical.email.toLowerCase())
    .map((a) => ({
      fromEmail: a.email,
      fromName: a.name,
      toEmail: canonical.email,
      toName: canonical.name,
    }));

  if (dryRun) {
    printRewritePlan(rules, scanResult.coAuthors, removeCoAuthors);
    log.info("Dry run — no changes made. Pass --execute to rewrite history.");
    return;
  }

  const result = executeClean(repoPath, rules, removeCoAuthors, false);
  if (result.appliedRules > 0) {
    log.success(
      `Rewrote ${result.appliedRules} author mapping${result.appliedRules === 1 ? "" : "s"} via ${result.method}.`,
    );
  }
  if (result.removedCoAuthors) {
    log.success("Removed Co-Authored-By trailers.");
  }
  if (result.appliedRules > 0 || result.removedCoAuthors) {
    if (options["repo"]) {
      log.info(`Rewritten clone: ${repoPath}`);
      log.warn(
        "Verify the result, then re-add the remote (git filter-repo removes it) and force-push:",
      );
      log.step(`git remote add origin https://github.com/${String(options["repo"])}.git`);
      log.step("git push --force-with-lease origin HEAD");
    } else {
      log.warn("Force-push required: git push --force-with-lease");
    }
  } else {
    log.info("Nothing to rewrite.");
  }
}

async function runCommand(command: Command, options: Record<string, unknown>): Promise<void> {
  switch (command) {
    case "clean-authors": {
      runCleanAuthors(options);
      break;
    }
    case "detect-bots": {
      const svc = new DetectBotsService(options);
      const result = await svc.detect();
      log.blank();
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      break;
    }
    case "purge-actions": {
      const result = await new PurgeActionsService(withExecuteSemantics(options)).purge();
      logPurgeResult(result.deleted, result.total, "workflow runs");
      break;
    }
    case "purge-packages": {
      const result = await new PurgePackagesService(withExecuteSemantics(options)).purge();
      logPurgeResult(result.deleted, result.deleted, "package versions");
      break;
    }
    case "purge-release": {
      const result = await new PurgeReleaseService(withExecuteSemantics(options)).purge();
      logPurgeResult(result.deleted, result.total, "releases");
      break;
    }
    case "purge-tags": {
      const result = await new PurgeTagsService(withExecuteSemantics(options)).purge();
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
