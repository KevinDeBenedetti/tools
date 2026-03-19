import { describe, expect, test } from "bun:test";
import { detectChanges } from "../todo/issues";
import { formatPushPRBody, formatPullPRBody } from "../todo/formatters";
import { labelsForEntry } from "../todo/labels";
import { createdComment, closedComment, changesComment } from "../todo/comments";
import type { TodoEntry, GhIssue, SyncLogEntry } from "../todo/types";

function makeEntry(overrides: Partial<TodoEntry> = {}): TodoEntry {
  return {
    id: "FEAT-01",
    title: "Test feature",
    github_id: null,
    status: "open",
    priority: "medium",
    type: "feat",
    assignees: [],
    ...overrides,
  };
}

function makeIssue(overrides: Partial<GhIssue> = {}): GhIssue {
  return {
    number: 1,
    title: "Test feature",
    body: null,
    state: "open",
    // Default labels match the default makeEntry (type:feat, status:open, priority:medium)
    labels: [{ name: "type: feat" }, { name: "status: open" }, { name: "priority: medium" }],
    assignees: [],
    ...overrides,
  };
}

describe("detectChanges", () => {
  test("returns empty object when entry and issue match", () => {
    const entry = makeEntry({ title: "Same title" });
    const issue = makeIssue({ title: "Same title" });
    const changes = detectChanges(entry, issue);
    expect(Object.keys(changes).length).toBe(0);
  });

  test("detects title change", () => {
    const entry = makeEntry({ title: "New title" });
    const issue = makeIssue({ title: "Old title" });
    const changes = detectChanges(entry, issue);
    expect(changes.title).toEqual(["Old title", "New title"]);
  });

  test("detects body change", () => {
    const entry = makeEntry({ body: "new body" });
    const issue = makeIssue({ body: "old body" });
    const changes = detectChanges(entry, issue);
    expect(changes.body).toEqual(["old body", "new body"]);
  });

  test("detects state change when status is done", () => {
    const entry = makeEntry({ status: "done" });
    const issue = makeIssue({ state: "open" });
    const changes = detectChanges(entry, issue);
    expect(changes.state).toEqual(["open", "closed"]);
  });

  test("detects assignee change", () => {
    const entry = makeEntry({ assignees: ["alice"] });
    const issue = makeIssue({ assignees: [{ login: "bob" }] });
    const changes = detectChanges(entry, issue);
    expect(changes.assignees).toBeDefined();
  });
});

describe("labelsForEntry", () => {
  test("returns type and status and priority labels", () => {
    const entry = makeEntry({
      type: "fix",
      status: "in_progress",
      priority: "high",
    });
    const labels = labelsForEntry(entry);
    expect(labels).toContain("type: fix");
    expect(labels).toContain("status: in-progress");
    expect(labels).toContain("priority: high");
  });
});

describe("formatPushPRBody", () => {
  test("renders sync log entries", () => {
    const log: SyncLogEntry[] = [
      { issueNumber: 1, title: "My feature", action: "created" },
      {
        issueNumber: 2,
        title: "My fix",
        action: "updated",
        changes: { status: ["open", "done"] },
      },
    ];
    const body = formatPushPRBody(log);
    expect(body).toContain("#1");
    expect(body).toContain("My feature");
    expect(body).toContain("✨");
    expect(body).toContain("#2");
    expect(body).toContain("open → done");
  });
});

describe("formatPullPRBody", () => {
  test("renders changes for a pull", () => {
    const entry = makeEntry({ title: "Updated title" });
    const body = formatPullPRBody(42, entry, {
      title: ["Old title", "Updated title"],
    });
    expect(body).toContain("#42");
    expect(body).toContain("Old title → Updated title");
  });
});

describe("comment formatters", () => {
  test("createdComment includes body", () => {
    const entry = makeEntry({ body: "Some description" });
    const comment = createdComment(entry);
    expect(comment).toContain("Synced from TODO.yml");
    expect(comment).toContain("Some description");
  });

  test("createdComment fallback when no body", () => {
    const entry = makeEntry({ body: undefined });
    const comment = createdComment(entry);
    expect(comment).toContain("(no description)");
  });

  test("closedComment is correct", () => {
    expect(closedComment()).toContain("Closed by TODO.yml");
  });

  test("changesComment renders changed fields", () => {
    const entry = makeEntry();
    const comment = changesComment(entry, {
      status: ["open", "done"],
      priority: ["low", "high"],
    });
    expect(comment).toContain("Status");
    expect(comment).toContain("Priority");
  });
});
