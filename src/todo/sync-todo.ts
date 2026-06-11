#!/usr/bin/env bun
/**
 * Todo sync CLI entry point — `bun run todo push|pull|labels [options]`.
 * Command definitions live in ./commands.ts; the generic engine in src/cli/.
 *
 * Flags fall back to the env vars used by GitHub Actions workflows:
 * GITHUB_REPOSITORY, ISSUE_NUMBER, TODO_PATH, LABELS_PATH.
 */
import { runCli } from "../cli/dispatch";
import { todoGroup } from "./commands";

if (import.meta.main) {
  await runCli(process.argv.slice(2), {
    binName: "bun run todo",
    defaultGroup: "todo",
    groups: [todoGroup],
    isTTY: process.stdout.isTTY ?? false,
  });
}
