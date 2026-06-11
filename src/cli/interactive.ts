import * as p from "@clack/prompts";
import color from "picocolors";
import { buildCommandPreview } from "./help";
import { resolveOptions } from "./parse";
import type { CommandGroup, CommandSpec } from "./types";

// ── Generic prompt helpers ─────────────────────────────────────────────────────

async function promptString(label: string, placeholder?: string): Promise<string | undefined> {
  const val = await p.text({ message: label, placeholder });
  if (p.isCancel(val)) {
    return undefined;
  }
  return val || undefined;
}

async function promptBoolean(label: string, initial = false): Promise<boolean> {
  const val = await p.confirm({ initialValue: initial, message: label });
  if (p.isCancel(val)) {
    return false;
  }
  return val;
}

async function promptNumber(label: string, defaultValue?: number): Promise<number> {
  const val = await p.text({
    message: label,
    placeholder: defaultValue !== undefined ? String(defaultValue) : undefined,
  });
  if (val && !p.isCancel(val)) {
    const n = Number(val);
    return Number.isNaN(n) ? (defaultValue ?? 0) : n;
  }
  return defaultValue ?? 0;
}

// ── Flag-driven option collection ──────────────────────────────────────────────

export async function collectOptions(spec: CommandSpec): Promise<Record<string, unknown>> {
  const options: Record<string, unknown> = {};

  for (const flag of spec.flags) {
    if (flag.type === "boolean") {
      const val = await promptBoolean(flag.description, flag.default === true);
      if (val !== (flag.default === true)) {
        options[flag.name] = val;
      }
    } else if (flag.type === "number") {
      const val = await promptNumber(`${flag.description} (number)`, flag.default as number);
      options[flag.name] = val;
    } else if (flag.type === "string" || flag.type === "string[]") {
      const defaultStr =
        typeof flag.default === "string" ||
        typeof flag.default === "number" ||
        typeof flag.default === "boolean"
          ? String(flag.default)
          : undefined;
      const val = await promptString(flag.description, defaultStr);
      if (val) {
        options[flag.name] = flag.type === "string[]" ? val.split(",").filter(Boolean) : val;
      }
    }
  }

  return options;
}

// ── Command wizard ─────────────────────────────────────────────────────────────

export async function runCommandInteractive(group: CommandGroup, cmd: CommandSpec): Promise<void> {
  if (cmd.interactive) {
    await cmd.interactive();
    return;
  }

  p.note(cmd.description, `${group.name} ${cmd.name}`);

  const options = await collectOptions(cmd);
  const preview = buildCommandPreview(group.name, cmd.name, options);

  p.note(preview, "Command preview");

  const confirmed = await p.confirm({ message: "Run this command?" });
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Cancelled.");
    return;
  }

  await cmd.run(resolveOptions(cmd, options));
}

// ── Group and root menus ───────────────────────────────────────────────────────

export async function runGroupInteractive(group: CommandGroup): Promise<void> {
  if (group.commands.length === 1) {
    await runCommandInteractive(group, group.commands[0]!);
    return;
  }

  const selected = await p.select({
    message: `${group.description} — pick a command`,
    options: group.commands.map((cmd) => ({
      hint: cmd.description,
      label: cmd.name,
      value: cmd.name,
    })),
  });

  if (p.isCancel(selected)) {
    p.cancel("Cancelled.");
    return;
  }

  const cmd = group.commands.find((c) => c.name === selected)!;
  await runCommandInteractive(group, cmd);
}

export async function runRootInteractive(groups: CommandGroup[]): Promise<void> {
  p.intro(color.bold(" tools ") + color.dim("— dev tooling CLI"));

  const selected = await p.select({
    message: "Select a category",
    options: groups.map((group) => ({
      hint: group.description,
      label: group.name,
      value: group.name,
    })),
  });

  if (p.isCancel(selected)) {
    p.cancel("Cancelled.");
    return;
  }

  const group = groups.find((g) => g.name === selected)!;
  await runGroupInteractive(group);
  p.outro(color.green("Done!"));
}
