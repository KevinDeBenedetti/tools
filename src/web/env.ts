// ── Environment inspection and session overrides ───────────────────────────────
//
// Commands fail for boring reasons — an unset OPENAI_API_KEY, a base URL still
// pointing at OpenAI when the key is an OpenRouter one — and the CLI only says
// so once a run is already underway. This module lets the UI show what the
// child process will actually inherit, and lets a couple of values be set for
// the session without touching the user's .env.
//
// Two rules hold everywhere below:
//
//  1. A secret's value never leaves this process. The wire carries a redacted
//     rendering of it and nothing else — there is no endpoint that returns one.
//  2. Only names on OVERRIDABLE can be set from a request. The overrides are
//     spliced into a spawned child's environment, so an open-ended setter would
//     hand any caller PATH or NODE_OPTIONS, and with them the child itself.

import { allGroups } from "../cli/registry";
import type { EnvVarState } from "./protocol";

/** The only variables a request may set. Anything else is refused by name. */
export const OVERRIDABLE = ["OPENAI_API_KEY", "OPENAI_BASE_URL"] as const;
export type Overridable = (typeof OVERRIDABLE)[number];

function isOverridable(name: string): name is Overridable {
  return (OVERRIDABLE as readonly string[]).includes(name);
}

interface CoreVar {
  name: string;
  description: string;
  secret: boolean;
  /** Commands that read it directly, rather than through a declared flag */
  usedBy: string[];
}

/**
 * Variables read straight from `process.env` rather than declared on a flag.
 * Flag-declared ones are discovered from the registry below, so a new command
 * shows up here for free; these have no flag to be discovered through.
 */
const CORE: CoreVar[] = [
  {
    description: "Credentials for the benchmark's OpenAI-compatible provider.",
    name: "OPENAI_API_KEY",
    secret: true,
    usedBy: ["benchmark run", "benchmark embed", "benchmark models"],
  },
  {
    description:
      "Provider endpoint. Defaults to https://api.openai.com/v1 — point it at https://openrouter.ai/api/v1 for OpenRouter.",
    name: "OPENAI_BASE_URL",
    secret: false,
    usedBy: ["benchmark run", "benchmark embed", "benchmark models"],
  },
  {
    description: "Token used by the Copilot commands.",
    name: "GITHUB_TOKEN",
    secret: true,
    usedBy: ["copilot chat"],
  },
  {
    description: "Where the CLI keeps its state file.",
    name: "TOOLS_STATE_PATH",
    secret: false,
    usedBy: ["cli"],
  },
  {
    description: "Port this UI listens on.",
    name: "TOOLS_UI_PORT",
    secret: false,
    usedBy: ["ui"],
  },
  { description: "Turns on verbose logging.", name: "DEBUG", secret: false, usedBy: ["cli"] },
];

/** Names that are secret by convention, for variables discovered from the registry. */
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/;

// ── Redaction ──────────────────────────────────────────────────────────────────

/**
 * Render a secret so it can be recognised but not reused: enough of the prefix
 * to tell an OpenRouter key from an OpenAI one, four trailing characters to tell
 * two keys apart, and the length so a truncated paste is obvious. Short values
 * are hidden outright — revealing six of nine characters reveals the value.
 */
export function maskSecret(value: string): string {
  const size = `${value.length} chars`;
  if (value.length < 12) return `${"•".repeat(8)} (${size})`;
  return `${value.slice(0, 6)}${"•".repeat(6)}${value.slice(-4)} (${size})`;
}

/**
 * Show a URL as it is — seeing the endpoint is the whole point of listing it —
 * but drop any inline credentials, which are a password in a query string's
 * clothing.
 */
export function maskUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (url.username === "" && url.password === "") return value;
  url.username = "";
  url.password = "";
  return `${url.toString()} (credentials hidden)`;
}

function render(name: string, value: string, secret: boolean): string {
  if (secret) return maskSecret(value);
  return /URL|URI/.test(name) ? maskUrl(value) : value;
}

// ── Session overrides ──────────────────────────────────────────────────────────

const overrides = new Map<Overridable, string>();

/** The overlay to splice into a spawned command's environment. */
export function overrideEnv(): Record<string, string> {
  return Object.fromEntries(overrides);
}

export class EnvOverrideError extends Error {}

/**
 * Validate and store one override for the session, or clear it when `value` is
 * null. Rejects rather than coerces: a base URL that is not a URL fails every
 * run afterwards with an error that points at the model instead of at this.
 */
export function setOverride(name: string, value: string | null): void {
  if (!isOverridable(name)) {
    throw new EnvOverrideError(`${name} cannot be set from the UI.`);
  }

  if (value === null || value.trim() === "") {
    overrides.delete(name);
    return;
  }

  const trimmed = value.trim();

  if (name === "OPENAI_BASE_URL") {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new EnvOverrideError("Base URL must be an absolute URL, e.g. https://host/v1");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new EnvOverrideError("Base URL must use http or https.");
    }
  }

  if (name === "OPENAI_API_KEY" && /\s/.test(trimmed)) {
    // A key with a stray newline becomes an unsendable header, and the failure
    // that follows looks like an auth problem rather than a paste problem.
    throw new EnvOverrideError("API key cannot contain whitespace — check the paste.");
  }

  overrides.set(name, trimmed);
}

/** Drop every override, restoring whatever the server itself was started with. */
export function clearOverrides(): void {
  overrides.clear();
}

// ── Reporting ──────────────────────────────────────────────────────────────────

/** Every variable any command declares a fallback to, mapped to its readers. */
function fromRegistry(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const group of allGroups) {
    for (const command of group.commands) {
      for (const flag of command.flags) {
        if (flag.env === undefined) continue;
        const readers = found.get(flag.env) ?? [];
        readers.push(`${group.name} ${command.name}`);
        found.set(flag.env, readers);
      }
    }
  }
  return found;
}

/**
 * What the next spawned command will see, redacted. An override shadows the
 * process environment, which is exactly what the child gets, so the reported
 * source is the one that will actually be used.
 */
export function describeEnv(env: NodeJS.ProcessEnv = process.env): EnvVarState[] {
  const registry = fromRegistry();
  const seen = new Set(CORE.map((v) => v.name));

  const discovered: CoreVar[] = [...registry.entries()]
    .filter(([name]) => !seen.has(name))
    .map(([name, usedBy]) => ({
      description: "Fallback for a command flag.",
      name,
      secret: SECRET_NAME.test(name),
      usedBy,
    }));

  return [...CORE, ...discovered]
    .map((spec) => {
      const override = isOverridable(spec.name) ? overrides.get(spec.name) : undefined;
      const raw = override ?? env[spec.name];
      // An empty variable is unset as far as every consumer is concerned —
      // `if (!apiKey)` is how the CLI reads it — so it is reported that way
      // rather than as a value that happens to render to nothing.
      const value = raw === undefined || raw === "" ? undefined : raw;
      const usedBy = [...new Set([...spec.usedBy, ...(registry.get(spec.name) ?? [])])];

      return {
        description: spec.description,
        editable: isOverridable(spec.name),
        masked: value === undefined ? null : render(spec.name, value, spec.secret),
        name: spec.name,
        secret: spec.secret,
        source: value === undefined ? "unset" : override !== undefined ? "override" : "environment",
        usedBy,
      } satisfies EnvVarState;
    })
    .sort((a, b) => Number(b.editable) - Number(a.editable) || a.name.localeCompare(b.name));
}
