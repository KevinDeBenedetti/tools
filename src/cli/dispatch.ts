import color from "picocolors";
import { formatCommandHelp, formatGeneralHelp, formatGroupHelp } from "./help";
import { runGroupInteractive, runRootInteractive } from "./interactive";
import { parseArgs, resolveOptions } from "./parse";
import type { CommandGroup, CommandSpec } from "./types";

export interface RunCliOptions {
  groups: CommandGroup[];
  /** Pin the CLI to one group: positionals are commands, not group names */
  defaultGroup?: string;
  isTTY?: boolean;
  binName?: string;
}

interface Resolution {
  group: CommandGroup | undefined;
  command: CommandSpec | undefined;
  unknown: string | undefined;
}

function resolve(groups: CommandGroup[], positionals: string[], defaultGroup?: string): Resolution {
  let group: CommandGroup | undefined;
  const names = [...positionals];

  if (defaultGroup !== undefined) {
    group = groups.find((g) => g.name === defaultGroup);
  } else if (names.length > 0) {
    group = groups.find((g) => g.name === names[0]);
    if (!group) {
      return { command: undefined, group: undefined, unknown: names[0] };
    }
    names.shift();
  }

  if (!group) {
    return { command: undefined, group: undefined, unknown: undefined };
  }

  if (names.length === 0) {
    // Single-command groups don't need the command spelled out
    const command = group.commands.length === 1 ? group.commands[0] : undefined;
    return { command, group, unknown: undefined };
  }

  const command = group.commands.find((c) => c.name === names[0]);
  if (!command) {
    return { command: undefined, group, unknown: names[0] };
  }
  if (names.length > 1) {
    return { command, group, unknown: names[1] };
  }
  return { command, group, unknown: undefined };
}

export async function runCli(argv: string[], opts: RunCliOptions): Promise<void> {
  const { groups, defaultGroup } = opts;
  const isTTY = opts.isTTY ?? process.stdout.isTTY ?? false;
  const binName = opts.binName ?? "bun run tools";

  const parsed = parseArgs(argv);
  const { group, command, unknown } = resolve(groups, parsed.positionals, defaultGroup);

  // Everything the user types before a command name
  const cmdPrefix =
    defaultGroup !== undefined ? binName : group ? `${binName} ${group.name}` : binName;

  if (unknown !== undefined) {
    console.error(color.red(`Error: unknown command: ${unknown}`));
    console.log(group ? formatGroupHelp(group, cmdPrefix) : formatGeneralHelp(groups, binName));
    process.exitCode = 1;
    return;
  }

  if (parsed.help) {
    if (group && command) {
      console.log(formatCommandHelp(command, cmdPrefix));
    } else if (group) {
      console.log(formatGroupHelp(group, cmdPrefix));
    } else {
      console.log(formatGeneralHelp(groups, binName));
    }
    return;
  }

  // Interactive routing: explicit -i, or a TTY with nothing to run
  const wantsInteractive =
    parsed.interactive || (isTTY && !command && Object.keys(parsed.options).length === 0);

  if (wantsInteractive) {
    if (group && command?.interactive) {
      await command.interactive();
      return;
    }
    if (group) {
      await runGroupInteractive(group);
      return;
    }
    await runRootInteractive(groups);
    return;
  }

  if (!group || !command) {
    console.log(group ? formatGroupHelp(group, cmdPrefix) : formatGeneralHelp(groups, binName));
    return;
  }

  try {
    await command.run(resolveOptions(command, parsed.options));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(color.red(`Error: ${message}`));
    process.exitCode = 1;
  }
}
