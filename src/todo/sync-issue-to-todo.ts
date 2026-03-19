/**
 * Sync GitHub Issue events to TODO.yml
 * Updates TODO.yml when issues are created, edited, or closed.
 * This is a standalone script for use in GitHub Actions.
 */

import { readTodo, writeTodo } from "./files";
import type { TodoStatus } from "./types";

const DRY_RUN = process.env["DRY_RUN"] === "true";

const issueNumber = parseInt(process.env["ISSUE_NUMBER"] ?? "", 10);
const issueTitle = process.env["ISSUE_TITLE"] ?? "";
const issueState = process.env["ISSUE_STATE"] ?? "open";

if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
  console.error(
    `Error: ISSUE_NUMBER must be a valid positive integer. Got: ${process.env["ISSUE_NUMBER"]}`,
  );
  process.exit(1);
}

function mapStatus(githubState: string): TodoStatus {
  return githubState === "closed" ? "closed" : "open";
}

function syncIssueToTodo(): void {
  const todoFile = readTodo();

  console.log(
    `Syncing GitHub Issue → TODO.yml (${DRY_RUN ? "DRY RUN" : "LIVE"})`,
  );
  console.log(`Issue #${issueNumber}: "${issueTitle}" [${issueState}]\n`);

  const entry = todoFile.issues.find((e) => e.github_id === issueNumber);

  if (entry) {
    const oldStatus = entry.status;
    const newStatus = mapStatus(issueState);

    console.log(`Found existing entry: ${entry.id}`);
    console.log(`  title: "${entry.title}" → "${issueTitle}"`);
    console.log(`  status: ${oldStatus} → ${newStatus}`);

    entry.title = issueTitle;
    entry.status = newStatus;
  } else {
    const newId = `GH-${issueNumber}`;
    const newStatus = mapStatus(issueState);

    console.log(`Creating new entry`);
    console.log(`  id: ${newId}`);
    console.log(`  title: "${issueTitle}"`);
    console.log(`  status: ${newStatus}`);

    todoFile.issues.push({
      assignees: [],
      github_id: issueNumber,
      id: newId,
      priority: "medium",
      status: newStatus,
      title: issueTitle,
      type: "feat",
    });
  }

  if (!DRY_RUN) {
    writeTodo(todoFile);
    console.log(`\n✓ TODO.yml updated`);
  } else {
    console.log(`\n[DRY RUN] No changes written`);
  }
}

syncIssueToTodo();
