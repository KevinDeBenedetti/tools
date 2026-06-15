import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as p from "@clack/prompts";
import type { CommandGroup, CommandSpec } from "../cli/types";
import { confirmDestructive, log, table } from "../shared/ui";
import {
  type CoAuthorTrailer,
  type RewriteRule,
  executeClean,
  scanAuthors,
} from "./authors/clean-authors";
import { DetectBotsService } from "./bot/detect";
import { PurgeActionsService } from "./purge/purge-actions";
import { PurgePackagesService } from "./purge/purge-packages";
import { PurgeReleaseService } from "./purge/purge-release";
import { PurgeTagsService } from "./purge/purge-tags";
import { ScanSecretsService } from "./secrets/scan-secrets";
import { formatError } from "./shared";

// ── Shared helpers ─────────────────────────────────────────────────────────────

function logPurgeResult(deleted: number, total: number, noun: string): void {
  if (deleted > 0) {
    log.success(`Deleted ${deleted} of ${total} ${noun}.`);
  } else {
    log.info(`No ${noun} deleted (${total} found).`);
  }
}

interface Purgeable<R> {
  plan(): Promise<string[]>;
  purge(): Promise<R>;
}

/**
 * Shared flow for destructive purge commands: resolve the candidate list, show
 * it as a table, then either stop (dry-run, the default) or — once confirmed in
 * an interactive terminal — execute. In a non-TTY context (CI) `--execute`
 * deletes without prompting, matching the previous behaviour.
 */
async function runPurge<R>(
  options: Record<string, unknown>,
  noun: string,
  makeService: (opts: Record<string, unknown>) => Purgeable<R>,
  report: (result: R) => void,
): Promise<void> {
  const execute = options["execute"] === true;
  const items = await makeService({ ...options, dryRun: true }).plan();

  if (items.length === 0) {
    log.info(`No ${noun} match — nothing to delete.`);
    return;
  }

  log.blank();
  table(
    [{ label: `${noun} to delete (${items.length})` }],
    items.map((item) => [item]),
  );
  log.blank();

  if (!execute) {
    log.info(`Dry run — pass --execute to delete these ${items.length} ${noun}.`);
    return;
  }

  if (process.stdout.isTTY) {
    const repo = String(options["repo"] ?? "");
    const ok = await confirmDestructive(
      `Permanently delete ${items.length} ${noun} in ${repo}? This cannot be undone.`,
    );
    if (!ok) {
      log.info("Aborted — nothing deleted.");
      return;
    }
  }

  report(await makeService({ ...options, dryRun: false }).purge());
}

const REPO_FLAG = {
  description: "GitHub repo (owner/repo)",
  env: "GITHUB_REPOSITORY",
  name: "repo",
  required: true,
  type: "string",
} as const;

const EXECUTE_FLAG = {
  description: "Actually delete (default is a dry-run preview)",
  name: "execute",
  type: "boolean",
} as const;

// ── clean-authors ──────────────────────────────────────────────────────────────

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

function printRewritePlan(
  rules: RewriteRule[],
  coAuthors: CoAuthorTrailer[],
  removeCoAuthors: boolean,
): void {
  console.log(`\n  Rewrite plan\n`);
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

function printScanTables(scanResult: ReturnType<typeof scanAuthors>): void {
  log.blank();
  table(
    [{ label: "Author" }, { align: "right", label: "Commits" }],
    scanResult.authors.map((a) => [`${a.name} <${a.email}>`, String(a.commitCount)]),
  );
  if (scanResult.coAuthors.length > 0) {
    log.blank();
    table(
      [{ label: "Co-Authored-By trailer" }, { align: "right", label: "Commits" }],
      scanResult.coAuthors.map((a) => [`${a.name} <${a.email}>`, String(a.commitCount)]),
    );
  }
  log.blank();
}

function runCleanAuthors(options: Record<string, unknown>): void {
  const repoPath = resolveCleanAuthorsRepoPath(options);
  const scanResult = scanAuthors(repoPath);
  const canonicalEmail = options["canonical"] as string | undefined;

  if (!canonicalEmail) {
    printScanTables(scanResult);
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

  printScanTables(scanResult);

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
    const n = scanResult.coAuthors.length;
    const answer = await p.confirm({
      initialValue: true,
      message: `Remove ${n} Co-Authored-By trailer${n === 1 ? "" : "s"}?`,
    });
    if (p.isCancel(answer)) {
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

// ── Command specs ──────────────────────────────────────────────────────────────

const cleanAuthors: CommandSpec = {
  description: "Normalize author identities and remove Co-Authored-By trailers",
  flags: [
    {
      description: "GitHub repo (owner/repo) to clone fresh and clean (default: current directory)",
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
  interactive: runCleanAuthorsInteractive,
  name: "clean-authors",
  run: runCleanAuthors,
};

const detectBots: CommandSpec = {
  description: "Detect bot commits (dependabot, renovate, copilot, claude, …)",
  flags: [
    { description: "GitHub repo (owner/repo)", name: "repo", type: "string" },
    {
      default: true,
      description: "Scan local repository (set false to clone --repo)",
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
  name: "detect-bots",
  async run(options) {
    const svc = new DetectBotsService(options);
    const result = await svc.detect();
    console.log(svc.formatOutput(result));
  },
};

const purgeActions: CommandSpec = {
  description: "Delete GitHub Actions workflow runs",
  flags: [
    { ...REPO_FLAG },
    { description: "Specific workflow name", name: "workflow", type: "string" },
    { description: "Delete runs older than (e.g. 30d, 6m)", name: "olderThan", type: "string" },
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
    { ...EXECUTE_FLAG },
    { default: 50, description: "Batch size for deletions", name: "batchSize", type: "number" },
  ],
  name: "purge-actions",
  async run(options) {
    await runPurge(
      options,
      "workflow runs",
      (opts) => new PurgeActionsService(opts),
      (result) => logPurgeResult(result.deleted, result.total, "workflow runs"),
    );
  },
};

const purgePackages: CommandSpec = {
  description: "Delete package versions from GitHub Packages",
  flags: [
    { ...REPO_FLAG },
    {
      default: "container",
      description: "Package type (npm|docker|container|...)",
      name: "packageType",
      type: "string",
    },
    { description: "Name of the package", name: "packageName", required: true, type: "string" },
    {
      default: 0,
      description: "Number of most recent versions to keep",
      name: "keepLatest",
      type: "number",
    },
    { description: "Delete versions older than (e.g. 30d)", name: "olderThan", type: "string" },
    { ...EXECUTE_FLAG },
  ],
  name: "purge-packages",
  async run(options) {
    await runPurge(
      options,
      "package versions",
      (opts) => new PurgePackagesService(opts),
      (result) => logPurgeResult(result.deleted, result.deleted + result.kept, "package versions"),
    );
  },
};

const purgeRelease: CommandSpec = {
  description: "Delete GitHub Releases by tag or pattern",
  flags: [
    { ...REPO_FLAG },
    { description: "Specific release tag to delete", name: "tag", type: "string" },
    { description: "Glob pattern matching release tags", name: "pattern", type: "string" },
    {
      default: 0,
      description: "Number of most recent releases to keep",
      name: "keepLatest",
      type: "number",
    },
    { ...EXECUTE_FLAG },
  ],
  name: "purge-release",
  async run(options) {
    await runPurge(
      options,
      "releases",
      (opts) => new PurgeReleaseService(opts),
      (result) => logPurgeResult(result.deleted, result.total, "releases"),
    );
  },
};

const purgeTags: CommandSpec = {
  description: "Delete Git tags by pattern",
  flags: [
    { ...REPO_FLAG },
    { description: "Glob pattern matching tag names to delete", name: "pattern", type: "string" },
    { description: "Glob pattern for tags to exclude", name: "exclude", type: "string" },
    {
      default: 0,
      description: "Number of most recent tags to keep",
      name: "keepLatest",
      type: "number",
    },
    { ...EXECUTE_FLAG },
  ],
  name: "purge-tags",
  async run(options) {
    await runPurge(
      options,
      "tags",
      (opts) => new PurgeTagsService(opts),
      (result) => logPurgeResult(result.deleted, result.total, "tags"),
    );
  },
};

const scanSecrets: CommandSpec = {
  description: "Scan a repository for leaked secrets",
  flags: [
    { description: "GitHub repo (owner/repo)", name: "repo", type: "string" },
    {
      default: true,
      description: "Scan local repository (set false to clone --repo)",
      name: "local",
      type: "boolean",
    },
    { description: "Scan git history too", name: "history", type: "boolean" },
    { description: "Preview without scanning", name: "dryRun", type: "boolean" },
    { description: "Custom regex patterns", name: "patterns", type: "string[]" },
    {
      default: "text",
      description: "Output format (text|json)",
      name: "format",
      type: "string",
    },
  ],
  name: "scan-secrets",
  async run(options) {
    const svc = new ScanSecretsService(options);
    if (svc.isDryRun()) {
      console.log(svc.describeDryRun());
      return;
    }
    const result = await svc.scan();
    console.log(svc.formatOutput(result));
  },
};

export const githubGroup: CommandGroup = {
  commands: [
    cleanAuthors,
    detectBots,
    purgeActions,
    purgePackages,
    purgeRelease,
    purgeTags,
    scanSecrets,
  ],
  description: "GitHub maintenance (clean authors, detect bots, purge artifacts, scan secrets)",
  name: "github",
};
