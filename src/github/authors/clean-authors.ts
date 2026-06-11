import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AuthorIdentity {
  name: string;
  email: string;
  commitCount: number;
}

export interface CoAuthorTrailer {
  name: string;
  email: string;
  commitCount: number;
}

export interface ScanResult {
  authors: AuthorIdentity[];
  coAuthors: CoAuthorTrailer[];
}

export interface RewriteRule {
  fromName: string;
  fromEmail: string;
  toName: string;
  toEmail: string;
}

export interface CleanResult {
  appliedRules: number;
  removedCoAuthors: boolean;
  method: "filter-repo" | "filter-branch" | "dry-run";
}

// ── Git helpers ────────────────────────────────────────────────────────────────

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

// ── Scan ───────────────────────────────────────────────────────────────────────

export function scanAuthors(repoPath: string): ScanResult {
  const authorLog = git(["log", "--format=%aN||%aE", "--all"], repoPath);
  const authorMap = new Map<string, AuthorIdentity>();

  for (const line of authorLog.split("\n")) {
    const sep = line.indexOf("||");
    if (sep === -1) continue;
    const name = line.slice(0, sep).trim();
    const email = line.slice(sep + 2).trim();
    if (!name || !email) continue;
    const key = email.toLowerCase();
    const entry = authorMap.get(key);
    if (entry) {
      entry.commitCount++;
    } else {
      authorMap.set(key, { name, email, commitCount: 1 });
    }
  }

  const bodyLog = git(["log", "--format=%B", "--all"], repoPath);
  const coAuthorMap = new Map<string, CoAuthorTrailer>();
  const re = /^Co-[Aa]uthored-[Bb]y:\s*([^<]+?)\s*<([^>]+)>/gm;

  for (const m of bodyLog.matchAll(re)) {
    const name = m[1]!.trim();
    const email = m[2]!.trim();
    const key = email.toLowerCase();
    const entry = coAuthorMap.get(key);
    if (entry) {
      entry.commitCount++;
    } else {
      coAuthorMap.set(key, { name, email, commitCount: 1 });
    }
  }

  return {
    authors: [...authorMap.values()].sort((a, b) => b.commitCount - a.commitCount),
    coAuthors: [...coAuthorMap.values()].sort((a, b) => b.commitCount - a.commitCount),
  };
}

// ── Execution ──────────────────────────────────────────────────────────────────

function hasFilterRepo(): boolean {
  try {
    execFileSync("git", ["filter-repo", "--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function runFilterRepo(repoPath: string, rules: RewriteRule[], removeCoAuthors: boolean): void {
  // Build a single commit-callback that handles both author rewrites and message cleanup
  const lines: string[] = [];

  if (rules.length > 0) {
    const entries = rules
      .map((r) => `  "${r.fromEmail.toLowerCase()}": ("${r.toName}", "${r.toEmail}"),`)
      .join("\n");
    lines.push(`AUTHOR_MAP = {\n${entries}\n}`);
    lines.push(
      "ae = commit.author_email.decode('utf-8', 'replace').lower()",
      "if ae in AUTHOR_MAP:",
      "    n, e = AUTHOR_MAP[ae]",
      "    commit.author_name = n.encode()",
      "    commit.author_email = e.encode()",
      "ce = commit.committer_email.decode('utf-8', 'replace').lower()",
      "if ce in AUTHOR_MAP:",
      "    n, e = AUTHOR_MAP[ce]",
      "    commit.committer_name = n.encode()",
      "    commit.committer_email = e.encode()",
    );
  }

  if (removeCoAuthors) {
    lines.push(
      "import re as _re",
      "commit.message = _re.sub(",
      "    rb'(?m)^Co-[Aa]uthored-[Bb]y:[^\\n]*\\n?',",
      "    b'',",
      "    commit.message,",
      ")",
      "commit.message = commit.message.rstrip(b'\\n') + b'\\n'",
    );
  }

  if (lines.length === 0) return;

  const result = spawnSync(
    "git",
    ["filter-repo", "--commit-callback", lines.join("\n"), "--force"],
    {
      cwd: repoPath,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    throw new Error("git filter-repo failed");
  }
}

function runFilterBranch(repoPath: string, rules: RewriteRule[], removeCoAuthors: boolean): void {
  if (rules.length > 0) {
    const conditions = rules
      .map(
        (r) =>
          `if [ "$GIT_AUTHOR_EMAIL" = "${r.fromEmail}" ]; then\n` +
          `  GIT_AUTHOR_NAME="${r.toName}"; GIT_AUTHOR_EMAIL="${r.toEmail}"\n` +
          `  GIT_COMMITTER_NAME="${r.toName}"; GIT_COMMITTER_EMAIL="${r.toEmail}"\n` +
          `fi`,
      )
      .join("\n");

    const result = spawnSync(
      "git",
      [
        "filter-branch",
        "--env-filter",
        conditions,
        "--tag-name-filter",
        "cat",
        "-f",
        "--",
        "--all",
      ],
      { cwd: repoPath, stdio: "inherit" },
    );

    if (result.status !== 0) {
      throw new Error("git filter-branch --env-filter failed");
    }
  }

  if (removeCoAuthors) {
    // Write the msg-filter script to a temp file to avoid shell quoting issues
    const scriptPath = join(tmpdir(), `tools-msg-filter-${Date.now()}.sh`);
    writeFileSync(scriptPath, `#!/bin/sh\ngrep -v '^Co-[Aa]uthored-[Bb]y:' || true\n`, {
      mode: 0o755,
    });

    const result = spawnSync(
      "git",
      [
        "filter-branch",
        "--msg-filter",
        scriptPath,
        "--tag-name-filter",
        "cat",
        "-f",
        "--",
        "--all",
      ],
      { cwd: repoPath, stdio: "inherit" },
    );

    try {
      unlinkSync(scriptPath);
    } catch {
      /* ignore */
    }

    if (result.status !== 0) {
      throw new Error("git filter-branch --msg-filter failed");
    }
  }

  // filter-branch keeps pre-rewrite backups under refs/original/, which would
  // make the old identities reappear in any --all scan — drop them
  const backupRefs = git(["for-each-ref", "--format=%(refname)", "refs/original/"], repoPath);
  for (const ref of backupRefs.split("\n").filter(Boolean)) {
    git(["update-ref", "-d", ref], repoPath);
  }
}

export function executeClean(
  repoPath: string,
  rules: RewriteRule[],
  removeCoAuthors: boolean,
  dryRun: boolean,
): CleanResult {
  if (dryRun) {
    return { appliedRules: rules.length, removedCoAuthors: removeCoAuthors, method: "dry-run" };
  }

  if (rules.length === 0 && !removeCoAuthors) {
    return { appliedRules: 0, removedCoAuthors: false, method: "dry-run" };
  }

  if (hasFilterRepo()) {
    runFilterRepo(repoPath, rules, removeCoAuthors);
    return { appliedRules: rules.length, removedCoAuthors: removeCoAuthors, method: "filter-repo" };
  }

  runFilterBranch(repoPath, rules, removeCoAuthors);
  return { appliedRules: rules.length, removedCoAuthors: removeCoAuthors, method: "filter-branch" };
}
