/**
 * Pull request body formatting
 */

import type { SyncAction, SyncLogEntry, TodoEntry } from "./types";

const ACTION_ICONS: Record<SyncAction, string> = {
  closed: "✅",
  created: "✨",
  linked: "🔗",
  recovered: "🔗",
  unchanged: "⏭️",
  updated: "📝",
};

export function formatPushPRBody(log: SyncLogEntry[]): string {
  const lines = ["## Synced TODO items", "", "Changes from `TODO.yml`:"];

  for (const entry of log) {
    const icon = ACTION_ICONS[entry.action] ?? "•";
    lines.push(`\n- ${icon} **#${entry.issueNumber}** ${entry.title}`);

    if (entry.changes) {
      const { changes } = entry;
      if (changes.status) {
        lines.push(`  - status: ${changes.status[0]} → ${changes.status[1]}`);
      }
      if (changes.priority) {
        lines.push(
          `  - priority: ${changes.priority[0]} → ${changes.priority[1]}`,
        );
      }
      if (changes.assignees) {
        lines.push(
          `  - assignees: ${changes.assignees[0]} → ${changes.assignees[1]}`,
        );
      }
    }
  }

  lines.push("\n\n---");
  lines.push("_Automatically synced by TODO.yml ↔ Issues workflow_");

  return lines.join("\n");
}

export function formatPullPRBody(
  issueNumber: number,
  _entry: TodoEntry,
  changes: Record<string, [string, string]>,
): string {
  const lines = [
    `## Synced issue #${issueNumber}`,
    "",
    `Updated \`TODO.yml\` to reflect changes from GitHub issue #${issueNumber}.`,
    "",
    "### Changes",
  ];

  for (const [key, [from, to]] of Object.entries(changes)) {
    lines.push(`- **${key}:** ${from} → ${to}`);
  }

  lines.push("");
  lines.push("---");
  lines.push("_Automatically synced by Issues → TODO.yml workflow_");

  return lines.join("\n");
}
