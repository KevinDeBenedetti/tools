import color from "picocolors";
import { toKebabCase } from "./parse";
import type { CommandGroup, CommandSpec } from "./types";

// ── Help formatters ────────────────────────────────────────────────────────────

export function formatGeneralHelp(groups: CommandGroup[], binName = "bun run tools"): string {
  const lines: string[] = [
    color.bold("tools — dev tooling CLI"),
    "",
    `${color.dim("Usage:")} ${binName} [group] [command] [options]`,
    "",
  ];

  for (const group of groups) {
    lines.push(`${color.bold(group.name)} ${color.dim(`— ${group.description}`)}`);
    for (const cmd of group.commands) {
      lines.push(`  ${color.cyan(`${group.name} ${cmd.name}`.padEnd(28))} ${cmd.description}`);
    }
    lines.push("");
  }

  lines.push(
    `${color.bold("Options:")}`,
    "  --help, -h         Show help",
    "  --interactive, -i  Launch interactive TUI",
    "",
    `Run ${color.cyan(`${binName} [group] [command] --help`)} for command-specific help.`,
  );

  return lines.join("\n");
}

/** `cmdPrefix` is everything the user types before the command name. */
export function formatGroupHelp(group: CommandGroup, cmdPrefix = "bun run tools"): string {
  const lines: string[] = [
    `${color.bold(group.name)} — ${group.description}`,
    "",
    `${color.dim("Usage:")} ${cmdPrefix} [command] [options]`,
    "",
    `${color.bold("Commands:")}`,
  ];

  for (const cmd of group.commands) {
    lines.push(`  ${color.cyan(cmd.name.padEnd(18))} ${cmd.description}`);
  }

  lines.push("", `Run ${color.cyan(`${cmdPrefix} [command] --help`)} for command-specific help.`);

  return lines.join("\n");
}

export function formatCommandHelp(cmd: CommandSpec, cmdPrefix = "bun run tools"): string {
  const lines: string[] = [
    `${color.bold(cmd.name)} — ${cmd.description}`,
    "",
    `${color.dim("Usage:")} ${cmdPrefix} ${cmd.name} [options]`,
    "",
    `${color.bold("Options:")}`,
  ];

  for (const flag of cmd.flags) {
    const label = `--${toKebabCase(flag.name)}`;
    const req = flag.required ? color.red(" (required)") : "";
    const env = flag.env === undefined ? "" : color.dim(` [env: ${flag.env}]`);
    const def = flag.default === undefined ? "" : color.dim(` [${JSON.stringify(flag.default)}]`);
    lines.push(`  ${label.padEnd(20)} ${flag.description}${req}${env}${def}`);
  }

  return lines.join("\n");
}

// ── Command preview ────────────────────────────────────────────────────────────

function serializeFlag(flag: string, value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => `${flag} ${String(item)}`);
  }
  if (value === true) return [flag];
  if (value === false || value === undefined) return [];
  let s: string;
  if (typeof value === "string") {
    s = value;
  } else if (typeof value === "number" || typeof value === "boolean") {
    s = String(value);
  } else {
    s = JSON.stringify(value);
  }
  return [s.includes(" ") ? `${flag} "${s}"` : `${flag} ${s}`];
}

export function buildCommandPreview(
  groupName: string,
  commandName: string,
  options: Record<string, unknown>,
  binName = "bun run tools",
): string {
  const flags = Object.entries(options).flatMap(([key, value]) =>
    serializeFlag(`--${toKebabCase(key)}`, value),
  );
  const base = `${binName} ${groupName} ${commandName}`;
  return flags.length === 0 ? base : `${base} ${flags.join(" ")}`;
}
