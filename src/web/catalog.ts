// ── Command catalog serialization ──────────────────────────────────────────────
//
// The web UI is generated from the same CommandGroup declarations the CLI uses,
// so a new command shows up in the browser without any UI work. CommandSpec
// carries functions (run, interactive, validate) that can't cross the wire —
// this module strips them down to the plain data a form needs.

import { toKebabCase } from "../cli/parse";
import type { CommandGroup } from "../cli/types";
import type { WebCommand, WebGroup } from "./protocol";

/**
 * Flags that switch a command out of its preview/dry-run mode. The UI puts a
 * confirmation gate in front of them, because the CLI's own gate
 * (confirmDestructive) only fires on a TTY — and a spawned run has none.
 */
const DESTRUCTIVE_FLAGS = new Set(["execute", "purgeBots"]);

function serializeCommand(group: CommandGroup, name: string): WebCommand {
  const spec = group.commands.find((c) => c.name === name)!;
  const destructive = spec.flags.find((f) => DESTRUCTIVE_FLAGS.has(f.name));

  return {
    description: spec.description,
    ...(destructive === undefined ? {} : { destructiveFlag: destructive.name }),
    flags: spec.flags.map((flag) => ({
      description: flag.description,
      ...(flag.default === undefined ? {} : { default: flag.default }),
      ...(flag.env === undefined ? {} : { env: flag.env }),
      kebab: toKebabCase(flag.name),
      name: flag.name,
      required: flag.required === true,
      type: flag.type,
    })),
    name: spec.name,
  };
}

export function serializeGroups(groups: CommandGroup[]): WebGroup[] {
  return groups.map((group) => ({
    commands: group.commands.map((c) => serializeCommand(group, c.name)),
    description: group.description,
    name: group.name,
  }));
}

export function findCommand(
  groups: CommandGroup[],
  groupName: string,
  commandName: string,
): WebCommand | undefined {
  const group = groups.find((g) => g.name === groupName);
  const command = group?.commands.find((c) => c.name === commandName);
  return group && command ? serializeCommand(group, command.name) : undefined;
}
