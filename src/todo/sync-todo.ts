#!/usr/bin/env bun
/**
 * sync-todo — bidirectional sync between TODO.yml and GitHub Issues
 *
 * Modes:
 *   push   TODO.yml → GitHub Issues (create/update issues from TODO.yml)
 *   pull   GitHub Issue event → TODO.yml (sync issue changes back to TODO.yml)
 *   labels labels.yml → GitHub repo labels (sync custom labels)
 *
 * Environment variables:
 *   GITHUB_REPOSITORY  owner/repo  (e.g. owner/dotfiles)
 *   ISSUE_NUMBER       issue number — pull mode only
 *   TODO_PATH          path to TODO.yml   (default: TODO.yml)
 *   LABELS_PATH        path to labels.yml (default: labels.yml)
 *
 * Usage:
 *   bun run src/todo/sync-todo.ts push     # Push TODO.yml changes to GitHub
 *   bun run src/todo/sync-todo.ts pull     # Pull GitHub issue changes to TODO.yml
 *   bun run src/todo/sync-todo.ts labels   # Sync custom labels from labels.yml
 */

import { push, pull } from "./issues";
import { syncLabels } from "./labels";

const mode = process.argv[2];

switch (mode) {
  case "push":
    push().catch((err) => {
      console.error((err as Error).message);
      process.exit(1);
    });
    break;

  case "pull":
    pull().catch((err) => {
      console.error((err as Error).message);
      process.exit(1);
    });
    break;

  case "labels":
    syncLabels().catch((err) => {
      console.error((err as Error).message);
      process.exit(1);
    });
    break;

  default:
    console.error("Usage: bun run src/todo/sync-todo.ts push|pull|labels");
    process.exit(1);
}
