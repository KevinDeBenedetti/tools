import type { CommandSpec, FlagSpec, ParsedArgs } from "./types";

// ── Case helpers ───────────────────────────────────────────────────────────────

export function toCamelCase(flag: string): string {
  return flag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function toKebabCase(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

// ── Argument parsing ───────────────────────────────────────────────────────────

/**
 * Parses argv into positionals and options without knowledge of any command.
 * Supports `--flag value`, `--flag=value`, bare boolean flags, repeated flags
 * (collected into arrays) and `true`/`false`/numeric literal coercion.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, unknown> = {};
  let help = false;
  let interactive = false;

  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift()!;

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--interactive" || arg === "-i") {
      interactive = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      let key: string;
      let value: string | undefined;

      if (eqIdx === -1) {
        key = toCamelCase(arg.slice(2));
        // Peek next arg for value if it doesn't look like a flag
        if (args.length > 0 && !args[0]!.startsWith("-")) {
          value = args.shift()!;
        }
      } else {
        key = toCamelCase(arg.slice(2, eqIdx));
        value = arg.slice(eqIdx + 1);
      }

      let parsed: unknown;
      if (value === undefined) {
        parsed = true;
      } else if (value === "true") {
        parsed = true;
      } else if (value === "false") {
        parsed = false;
      } else if (/^\d+$/.test(value)) {
        parsed = Number(value);
      } else {
        parsed = value;
      }

      const existing = options[key];
      if (existing === undefined) {
        options[key] = parsed;
      } else {
        options[key] = Array.isArray(existing) ? [...existing, parsed] : [existing, parsed];
      }
      continue;
    }

    // Other dash-prefixed args are ignored (e.g. stray short flags)
    if (arg.startsWith("-")) {
      continue;
    }

    positionals.push(arg);
  }

  return { help, interactive, options, positionals };
}

// ── Option resolution ──────────────────────────────────────────────────────────

function coerce(value: unknown, type: FlagSpec["type"]): unknown {
  if (type === "string[]") {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === "string") return value.split(",").filter(Boolean);
    return [String(value)];
  }
  if (type === "number" && typeof value === "string") {
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  return value;
}

/**
 * Applies a command's flag declarations to raw parsed options: env-var
 * fallbacks, declared defaults, type coercion and required-flag validation.
 * Throws with an actionable message when a required flag is missing.
 */
export function resolveOptions(
  spec: CommandSpec,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...raw };

  for (const flag of spec.flags) {
    if (resolved[flag.name] !== undefined) {
      resolved[flag.name] = coerce(resolved[flag.name], flag.type);
      continue;
    }

    const envValue = flag.env === undefined ? undefined : process.env[flag.env];
    if (envValue !== undefined && envValue !== "") {
      resolved[flag.name] = coerce(envValue, flag.type);
      continue;
    }

    if (flag.default !== undefined) {
      resolved[flag.name] = flag.default;
      continue;
    }

    if (flag.required) {
      const envHint = flag.env === undefined ? "" : ` (or set ${flag.env})`;
      throw new Error(`Missing required flag --${toKebabCase(flag.name)}${envHint}`);
    }
  }

  return resolved;
}
