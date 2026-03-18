/**
 * Type definitions for bidirectional TODO.yml ↔ GitHub Issues sync
 */

// ── Entry types ────────────────────────────────────────────────────────────────

export type TodoStatus = "backlog" | "open" | "in_progress" | "done" | "closed";
export type TodoPriority = "low" | "medium" | "high" | "critical";
export type TodoType = "feat" | "fix" | "chore" | "docs" | "refactor" | "test";

export interface TodoEntry {
  id: string;
  title: string;
  github_id: number | null;
  status: TodoStatus;
  priority: TodoPriority;
  type: TodoType;
  body?: string;
  assignees: string[];
}

export interface TodoFile {
  issues: TodoEntry[];
}

// ── GitHub API response types (from gh CLI JSON output) ───────────────────────

export interface GhLabel {
  name: string;
}

export interface GhAssignee {
  login: string;
}

export interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: GhLabel[];
  assignees: GhAssignee[];
}

export interface GhPR {
  number: number;
  html_url: string;
  state: string;
}

export interface GhRef {
  object: { sha: string };
}

export interface GhFetchOptions {
  method?: string;
  body?: unknown;
}

export interface GhLabelFull {
  name: string;
  color: string;
  description: string;
}

// ── Label definitions ──────────────────────────────────────────────────────────

export interface LabelDef {
  name: string;
  color: string;
  description: string;
}

export interface LabelsFile {
  labels: LabelDef[];
}

export const typeLabels: Record<TodoType, LabelDef> = {
  feat: { name: "type: feat", color: "#0075ca", description: "New feature" },
  fix: { name: "type: fix", color: "#d73a4a", description: "Bug fix" },
  chore: { name: "type: chore", color: "#e4e669", description: "Maintenance" },
  docs: { name: "type: docs", color: "#0075ca", description: "Documentation" },
  refactor: {
    name: "type: refactor",
    color: "#cfd3d7",
    description: "Refactoring",
  },
  test: { name: "type: test", color: "#bfd4f2", description: "Tests" },
};

export const statusLabels: Record<TodoStatus, LabelDef> = {
  backlog: {
    name: "status: backlog",
    color: "#cfd3d7",
    description: "Not yet started",
  },
  open: {
    name: "status: open",
    color: "#0075ca",
    description: "Open and ready",
  },
  in_progress: {
    name: "status: in-progress",
    color: "#e4e669",
    description: "In progress",
  },
  done: { name: "status: done", color: "#0e8a16", description: "Completed" },
  closed: {
    name: "status: closed",
    color: "#cfd3d7",
    description: "Closed without completion",
  },
};

export const priorityLabels: Record<TodoPriority, LabelDef> = {
  low: { name: "priority: low", color: "#cfd3d7", description: "Low priority" },
  medium: {
    name: "priority: medium",
    color: "#fbca04",
    description: "Medium priority",
  },
  high: {
    name: "priority: high",
    color: "#e4e669",
    description: "High priority",
  },
  critical: {
    name: "priority: critical",
    color: "#d73a4a",
    description: "Critical priority",
  },
};

// ── Sync log ───────────────────────────────────────────────────────────────────

export type SyncAction =
  | "created"
  | "recovered"
  | "linked"
  | "updated"
  | "unchanged"
  | "closed";

export interface IssueChanges {
  title?: [string, string];
  body?: [string, string];
  state?: ["open" | "closed", "open" | "closed"];
  status?: [string, string];
  priority?: [string, string];
  type?: [string, string];
  assignees?: [string, string];
}

export interface SyncLogEntry {
  issueNumber: number;
  title: string;
  action: SyncAction;
  changes?: IssueChanges;
}
