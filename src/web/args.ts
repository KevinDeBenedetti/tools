// ── Form values → argv ─────────────────────────────────────────────────────────
//
// The UI edits a form whose initial state is the command's declared defaults, so
// only the fields the user actually changed become flags. That keeps both the
// preview line and the spawned argv as short as what someone would have typed.

import type { WebCommand, WebFlag } from "./protocol";

export type FormValue = string | number | boolean | string[] | undefined;
export type FormValues = Record<string, FormValue>;

function toItems(value: FormValue): string[] {
  if (Array.isArray(value)) return value.map((v) => v.trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return value === undefined ? [] : [String(value)];
}

function flagArgs(flag: WebFlag, value: FormValue): string[] {
  if (flag.type === "boolean") {
    const on = value === true || value === "true";
    if (on === (flag.default === true)) return [];
    return on ? [`--${flag.kebab}`] : [`--${flag.kebab}=false`];
  }

  if (flag.type === "string[]") {
    const items = toItems(value);
    return items.map((item) => `--${flag.kebab}=${item}`);
  }

  if (value === undefined || value === "") return [];

  if (flag.type === "number") {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isNaN(n)) {
      throw new Error(`--${flag.kebab} expects a number, got '${String(value)}'`);
    }
    return n === flag.default ? [] : [`--${flag.kebab}=${n}`];
  }

  const text = String(value);
  return text === flag.default ? [] : [`--${flag.kebab}=${text}`];
}

/**
 * Builds the flag portion of the command line. Values for flags the command
 * doesn't declare are dropped rather than forwarded — the browser never gets to
 * invent arguments.
 */
export function buildFlags(command: WebCommand, values: FormValues): string[] {
  return command.flags.flatMap((flag) => flagArgs(flag, values[flag.name]));
}

export function buildArgv(group: string, command: WebCommand, values: FormValues): string[] {
  return [group, command.name, ...buildFlags(command, values)];
}

/** The line shown in the UI, and the one to paste into a terminal. */
export function previewCommand(group: string, command: WebCommand, values: FormValues): string {
  const flags = buildFlags(command, values).map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a));
  return ["bun run tools", group, command.name, ...flags].join(" ");
}

/** Defaults-as-form-state, so an untouched form produces an empty flag list. */
export function initialValues(command: WebCommand): FormValues {
  const values: FormValues = {};
  for (const flag of command.flags) {
    if (flag.type === "boolean") {
      values[flag.name] = flag.default === true;
    } else if (flag.default !== undefined) {
      values[flag.name] = flag.default as FormValue;
    } else {
      values[flag.name] = flag.type === "string[]" ? [] : "";
    }
  }
  return values;
}
