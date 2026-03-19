/**
 * GitHub operations for TODO sync — uses the `gh` CLI subprocess instead of
 * direct API calls.  Requires `gh auth login` before running.
 */

import type { GhIssue, GhLabelFull, GhPR, GhRef } from "./types";

// ── subprocess helpers ─────────────────────────────────────────────────────────

async function runGh(args: string[]): Promise<string> {
  const proc = Bun.spawn(["gh", ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`gh ${args[0]} failed (exit ${code}): ${err.trim()}`);
  }
  return out.trim();
}

async function runGhJson<T>(args: string[]): Promise<T> {
  const out = await runGh(args);
  return JSON.parse(out) as T;
}

// ── repo resolution ────────────────────────────────────────────────────────────

export function resolveRepo(): { owner: string; repo: string } {
  const raw = process.env["GITHUB_REPOSITORY"] ?? "";
  const [owner = "", repo = ""] = raw.split("/");
  if (!owner || !repo) {
    throw new Error("GITHUB_REPOSITORY env var must be set as owner/repo");
  }
  return { owner, repo };
}

export function repoSlug(): string {
  const { owner, repo } = resolveRepo();
  return `${owner}/${repo}`;
}

// ── Issue CRUD ────────────────────────────────────────────────────────────────

export async function createIssue(
  title: string,
  body: string,
  labels: string[] = [],
  assignees: string[] = [],
): Promise<number> {
  const args = ["issue", "create", "--title", title, "--body", body || " "];
  for (const l of labels) {
    args.push("--label", l);
  }
  for (const a of assignees) {
    args.push("--assignee", a);
  }
  args.push("--json", "number");

  const result = await runGhJson<{ number: number }>(args);
  return result.number;
}

export async function updateIssue(
  number: number,
  updates: Partial<{
    title: string;
    body: string;
    state: string;
    labels: string[];
    assignees: string[];
  }>,
): Promise<void> {
  const args = ["issue", "edit", String(number)];

  if (updates.title) {
    args.push("--title", updates.title);
  }
  if (updates.body !== undefined) {
    args.push("--body", updates.body || " ");
  }
  if (updates.state === "closed") {
    await runGh(["issue", "close", String(number)]);
    return;
  }
  if (updates.state === "open") {
    await runGh(["issue", "reopen", String(number)]);
    return;
  }
  if (updates.labels) {
    args.push("--add-label", updates.labels.join(","));
  }
  if (updates.assignees) {
    args.push("--add-assignee", updates.assignees.join(","));
  }

  if (args.length > 3) {
    await runGh(args);
  }
}

export async function addComment(
  number: number,
  body: string,
  owner: string,
  repo: string,
): Promise<void> {
  await runGh([
    "api",
    `repos/${owner}/${repo}/issues/${number}/comments`,
    "-X",
    "POST",
    "-f",
    `body=${body}`,
  ]);
}

export async function getIssue(number: number): Promise<GhIssue> {
  return runGhJson<GhIssue>([
    "issue",
    "view",
    String(number),
    "--json",
    "number,title,body,state,labels,assignees",
  ]);
}

export async function fetchAllIssues(): Promise<{
  byTitle: Map<string, GhIssue>;
  byNumber: Map<number, GhIssue>;
}> {
  const issues = await runGhJson<GhIssue[]>([
    "issue",
    "list",
    "--state",
    "all",
    "--limit",
    "1000",
    "--json",
    "number,title,body,state,labels,assignees",
  ]);

  const byTitle = new Map<string, GhIssue>();
  const byNumber = new Map<number, GhIssue>();
  for (const issue of issues) {
    byTitle.set(issue.title, issue);
    byNumber.set(issue.number, issue);
  }

  return { byNumber, byTitle };
}

// ── Labels ────────────────────────────────────────────────────────────────────

export async function createLabel(
  name: string,
  color: string,
  description: string,
): Promise<GhLabelFull> {
  await runGh([
    "label",
    "create",
    name,
    "--color",
    color.replace("#", ""),
    "--description",
    description,
    "--force",
  ]);
  return { color, description, name };
}

export async function updateLabel(
  oldName: string,
  newName: string,
  color: string,
  description: string,
): Promise<GhLabelFull> {
  await runGh([
    "label",
    "edit",
    oldName,
    "--name",
    newName,
    "--color",
    color.replace("#", ""),
    "--description",
    description,
  ]);
  return { color, description, name: newName };
}

// ── Git refs ───────────────────────────────────────────────────────────────────

export async function getRefSha(ref: string): Promise<string> {
  try {
    const { owner, repo } = resolveRepo();
    const result = await runGhJson<GhRef>(["api", `repos/${owner}/${repo}/git/refs/heads/${ref}`]);
    return result.object.sha;
  } catch {
    return "";
  }
}

export async function createRef(ref: string, sha: string): Promise<void> {
  const { owner, repo } = resolveRepo();
  await runGh([
    "api",
    `repos/${owner}/${repo}/git/refs`,
    "-X",
    "POST",
    "-f",
    `ref=refs/heads/${ref}`,
    "-f",
    `sha=${sha}`,
  ]);
}

export async function updateRef(ref: string, sha: string): Promise<void> {
  const { owner, repo } = resolveRepo();
  await runGh([
    "api",
    `repos/${owner}/${repo}/git/refs/heads/${ref}`,
    "-X",
    "PATCH",
    "-f",
    `sha=${sha}`,
    "-f",
    "force=true",
  ]);
}

// ── PR ─────────────────────────────────────────────────────────────────────────

export async function createPR(
  head: string,
  base: string,
  title: string,
  body: string,
): Promise<GhPR> {
  return runGhJson<GhPR>([
    "pr",
    "create",
    "--head",
    head,
    "--base",
    base,
    "--title",
    title,
    "--body",
    body,
    "--json",
    "number,url,state",
  ]);
}

export async function searchPRs(head: string): Promise<GhPR[]> {
  try {
    return await runGhJson<GhPR[]>([
      "pr",
      "list",
      "--head",
      head,
      "--state",
      "open",
      "--json",
      "number,url,state",
    ]);
  } catch {
    return [];
  }
}
