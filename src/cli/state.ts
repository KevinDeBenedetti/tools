import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ── Last-used value persistence ──────────────────────────────────────────────────
//
// Remembers scalar flag values between interactive runs so the wizard can
// prefill them (e.g. the last --repo). Best-effort: a missing or unwritable
// state file never fails a command. Override the location with TOOLS_STATE_PATH.

function statePath(): string {
  return process.env["TOOLS_STATE_PATH"] || join(homedir(), ".config", "tools", "state.json");
}

export function loadState(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(statePath(), "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // missing or corrupt state file → start from an empty slate
  }
  return {};
}

/** The remembered value for a flag, if any non-empty string was stored. */
export function lastValue(flagName: string): string | undefined {
  const value = loadState()[flagName];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Persist scalar (string/number) flag values; arrays and booleans are ignored. */
export function rememberValues(options: Record<string, unknown>): void {
  const state = loadState();
  let changed = false;

  for (const [key, value] of Object.entries(options)) {
    if (typeof value === "string" && value.length > 0) {
      state[key] = value;
      changed = true;
    } else if (typeof value === "number") {
      state[key] = String(value);
      changed = true;
    }
  }

  if (!changed) {
    return;
  }

  try {
    mkdirSync(dirname(statePath()), { recursive: true });
    writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    // persistence is a convenience; never fail a command because of it
  }
}
