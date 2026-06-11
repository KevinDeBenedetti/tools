#!/usr/bin/env bun
/**
 * Unified tools CLI — `bun run tools [group] [command] [options]`.
 * With no arguments on a TTY, opens the interactive menu.
 */
import { runCli } from "./dispatch";
import { allGroups } from "./registry";

if (import.meta.main) {
  await runCli(process.argv.slice(2), {
    binName: "bun run tools",
    groups: allGroups,
    isTTY: process.stdout.isTTY ?? false,
  });
}
