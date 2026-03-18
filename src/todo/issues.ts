/**
 * Issue sync logic: push mode (TODO.yml → Issues) and pull mode (Issues → TODO.yml)
 */

import { createIssue, updateIssue, getIssue, fetchAllIssues } from "./github";
import { readTodo, writeTodo } from "./files";
import { createPRWithTodo } from "./git";
import { ensureLabels, labelsForEntry } from "./labels";
import {
  addComment,
  createdComment,
  closedComment,
  changesComment,
} from "./comments";
import { formatPushPRBody, formatPullPRBody } from "./formatters";
import type { TodoEntry, GhIssue, IssueChanges, SyncLogEntry } from "./types";

// ── Change detection ──────────────────────────────────────────────────────────

export function detectChanges(entry: TodoEntry, issue: GhIssue): IssueChanges {
  const changes: IssueChanges = {};

  if (entry.title !== issue.title) {
    changes.title = [issue.title, entry.title];
  }

  if ((entry.body ?? "") !== (issue.body ?? "")) {
    changes.body = [issue.body ?? "", entry.body ?? ""];
  }

  const expectedState = entry.status === "done" ? "closed" : "open";
  if (expectedState !== issue.state) {
    changes.state = [
      issue.state as "open" | "closed",
      expectedState as "open" | "closed",
    ];
  }

  const expectedLabels = new Set(labelsForEntry(entry));
  const issueLabels = new Set(issue.labels.map((l) => l.name));

  if (
    expectedLabels.size !== issueLabels.size ||
    ![...expectedLabels].every((l) => issueLabels.has(l))
  ) {
    changes.type = [
      issue.labels.map((l) => l.name).join(", "),
      [...expectedLabels].join(", "),
    ];
  }

  const expectedAssignees = new Set(entry.assignees);
  const issueAssignees = new Set(issue.assignees.map((a) => a.login));

  if (
    expectedAssignees.size !== issueAssignees.size ||
    ![...expectedAssignees].every((a) => issueAssignees.has(a))
  ) {
    changes.assignees = [
      issue.assignees.map((a) => a.login).join(", "),
      entry.assignees.join(", "),
    ];
  }

  return changes;
}

export function resolveIssue(
  entry: TodoEntry,
  byTitle: Map<string, GhIssue>,
  byNumber: Map<number, GhIssue>,
): { issue: GhIssue | null; action: string } {
  if (!entry.github_id) {
    const byTitleMatch = byTitle.get(entry.title);
    if (byTitleMatch) {
      return { issue: byTitleMatch, action: "recovered" };
    }
    return { issue: null, action: "new" };
  }

  const byIdMatch = byNumber.get(entry.github_id);
  if (byIdMatch) {
    return { issue: byIdMatch, action: "found" };
  }

  // github_id not found — try to recover via title
  const byTitleMatch = byTitle.get(entry.title);
  if (byTitleMatch) {
    console.warn(
      `⚠️  github_id=#${entry.github_id} not found; recovering from title match #${byTitleMatch.number}.`,
    );
    return { issue: byTitleMatch, action: "recovered" };
  }

  console.warn(
    `⚠️  github_id=#${entry.github_id} not found and no title match — will recreate.`,
  );
  return { issue: null, action: "recreate" };
}

// ── Push mode: TODO.yml → GitHub Issues ────────────────────────────────────────

export async function push(): Promise<void> {
  const todo = readTodo();
  const { byTitle, byNumber } = await fetchAllIssues();
  const log: SyncLogEntry[] = [];
  let updated = false;

  await ensureLabels();

  for (const entry of todo.issues) {
    const { issue } = resolveIssue(entry, byTitle, byNumber);

    if (!issue) {
      const labels = labelsForEntry(entry);
      const number = await createIssue(
        entry.title,
        entry.body ?? "",
        labels,
        entry.assignees,
      );
      entry.github_id = number;
      await addComment(number, createdComment(entry));
      log.push({ issueNumber: number, title: entry.title, action: "created" });
      updated = true;
    } else if (entry.github_id !== issue.number) {
      entry.github_id = issue.number;
      log.push({
        issueNumber: issue.number,
        title: entry.title,
        action: "linked",
      });
      updated = true;
    } else {
      const changes = detectChanges(entry, issue);

      if (Object.keys(changes).length > 0) {
        const updates: Record<string, unknown> = {};

        if (changes.title) updates["title"] = changes.title[1];
        if (changes.body) updates["body"] = changes.body[1];
        if (changes.state) updates["state"] = changes.state[1];
        if (changes.type) {
          updates["labels"] = labelsForEntry(entry);
        }
        if (changes.assignees) updates["assignees"] = entry.assignees;

        await updateIssue(issue.number, updates);
        await addComment(issue.number, changesComment(entry, changes));

        log.push({
          issueNumber: issue.number,
          title: entry.title,
          action: "updated",
          changes,
        });
        updated = true;
      } else {
        log.push({
          issueNumber: issue.number,
          title: entry.title,
          action: "unchanged",
        });
      }

      if (entry.status === "done" && issue.state === "open") {
        await updateIssue(issue.number, { state: "closed" });
        await addComment(issue.number, closedComment());
        log.push({
          issueNumber: issue.number,
          title: entry.title,
          action: "closed",
        });
        updated = true;
      }
    }
  }

  if (updated) {
    writeTodo(todo);

    const prTitle = "chore(sync): TODO.yml ↔ GitHub Issues";
    const prBody = formatPushPRBody(log);

    await createPRWithTodo(prTitle, prBody);
  } else {
    console.log("No changes to sync.");
  }
}

// ── Pull mode: GitHub Issue event → TODO.yml ───────────────────────────────────

export async function pull(): Promise<void> {
  const issueNumber = parseInt(process.env["ISSUE_NUMBER"] ?? "0", 10);
  if (!issueNumber) {
    console.error("ISSUE_NUMBER env var required for pull mode");
    process.exit(1);
  }

  const todo = readTodo();
  const issue = await getIssue(issueNumber);

  const entry = todo.issues.find((e) => e.github_id === issueNumber);
  if (!entry) {
    console.log(`Issue #${issueNumber} not in TODO.yml — skipping`);
    return;
  }

  const changes: Record<string, [string, string]> = {};

  if (entry.title !== issue.title) {
    changes["title"] = [entry.title, issue.title];
    entry.title = issue.title;
  }

  if (entry.body !== issue.body) {
    changes["body"] = [entry.body ?? "", issue.body ?? ""];
    entry.body = issue.body ?? undefined;
  }

  const expectedState = entry.status === "done" ? "closed" : "open";
  if (expectedState !== issue.state) {
    const newStatus = issue.state === "closed" ? "done" : "backlog";
    changes["status"] = [entry.status, newStatus];
    entry.status = newStatus as TodoEntry["status"];
  }

  const expectedAssignees = entry.assignees.join(",");
  const issueAssignees = issue.assignees.map((a) => a.login).join(",");
  if (expectedAssignees !== issueAssignees) {
    changes["assignees"] = [expectedAssignees, issueAssignees];
    entry.assignees = issue.assignees.map((a) => a.login);
  }

  if (Object.keys(changes).length === 0) {
    console.log(`Issue #${issueNumber}: no changes to TODO.yml — skipping PR`);
    return;
  }

  writeTodo(todo);

  const prTitle = `chore(sync): issue #${issueNumber} → TODO.yml`;
  const prBody = formatPullPRBody(issueNumber, entry, changes);

  await createPRWithTodo(prTitle, prBody);
}
