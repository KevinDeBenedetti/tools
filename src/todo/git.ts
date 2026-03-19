/**
 * Git operations: branches, commits, and pull requests
 */

import {
  createPR,
  createRef,
  getRefSha,
  resolveRepo,
  searchPRs,
  updateRef,
} from "./github";

// ── Branch operations ──────────────────────────────────────────────────────────

export async function branchExists(name: string): Promise<string | null> {
  try {
    const sha = await getRefSha(name);
    return sha || null;
  } catch {
    return null;
  }
}

export async function createBranch(name: string, sha: string): Promise<void> {
  await createRef(name, sha);
}

export async function resetBranchToMain(name: string): Promise<void> {
  const mainSha = await getRefSha("main");
  await updateRef(name, mainSha);
}

// ── Commit operations ──────────────────────────────────────────────────────────

export async function pushTodoToBranch(branch: string): Promise<void> {
  const { owner, repo } = resolveRepo();
  const todoPath = "TODO.yml";

  // Get the current file SHA via gh api
  const proc = Bun.spawn(
    [
      "gh",
      "api",
      `repos/${owner}/${repo}/contents/${todoPath}?ref=main`,
      "--jq",
      ".sha",
    ],
    { stderr: "pipe", stdout: "pipe" },
  );
  const [shaOut, shaErr, shaCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (shaCode !== 0) {
    throw new Error(`Failed to get file SHA: ${shaErr.trim()}`);
  }
  const baseSha = shaOut.trim();

  const { readFileSync } = await import("node:fs");
  const content = readFileSync(todoPath, "utf8");
  const encoded = Buffer.from(content).toString("base64");

  const proc2 = Bun.spawn(
    [
      "gh",
      "api",
      `repos/${owner}/${repo}/contents/${todoPath}`,
      "-X",
      "PUT",
      "-f",
      `branch=${branch}`,
      "-f",
      "message=chore(sync): update TODO.yml",
      "-f",
      `content=${encoded}`,
      "-f",
      `sha=${baseSha}`,
    ],
    { stderr: "pipe", stdout: "pipe" },
  );
  const [, putErr, putCode] = await Promise.all([
    new Response(proc2.stdout).text(),
    new Response(proc2.stderr).text(),
    proc2.exited,
  ]);
  if (putCode !== 0) {
    throw new Error(`Failed to push TODO.yml: ${putErr.trim()}`);
  }
}

// ── PR operations ──────────────────────────────────────────────────────────────

export async function findOpenSyncPR(): Promise<{
  number: number;
  html_url: string;
} | null> {
  try {
    const prs = await searchPRs("sync/todo-yml-push-main");
    const pr = prs[0];
    if (pr && pr.number && pr.html_url) {
      return { html_url: pr.html_url, number: pr.number };
    }
  } catch {
    // Silently ignore
  }
  return null;
}

export async function createPRWithTodo(
  prTitle: string,
  prBody: string,
): Promise<void> {
  const branchName = "sync/todo-yml-push-main";
  const mainSha = await getRefSha("main");

  const existingPR = await findOpenSyncPR();
  if (existingPR) {
    console.log(`  existing PR #${existingPR.number}`);
    return;
  }

  const exists = await branchExists(branchName);
  if (exists) {
    await resetBranchToMain(branchName);
  } else {
    await createBranch(branchName, mainSha);
  }

  await pushTodoToBranch(branchName);

  try {
    const pr = await createPR(branchName, "main", prTitle, prBody);
    console.log(`  created PR #${pr.number}`);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("already exists"))
      throw error;
    console.log(`  PR already exists`);
  }
}
