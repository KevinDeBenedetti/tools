// ── CLI framework types ────────────────────────────────────────────────────────
//
// Every CLI surface in this repo (tools, github, todo, benchmark, chat) is built
// from the same primitives: a CommandGroup holds CommandSpecs, each declaring its
// flags. The framework derives parsing, help, previews and interactive wizards
// from these declarations — commands only implement run().

export type FlagType = "string" | "boolean" | "number" | "string[]";

export interface FlagSpec {
  /** camelCase option name; exposed as --kebab-case on the command line */
  name: string;
  description: string;
  type: FlagType;
  default?: unknown;
  required?: boolean;
  /** Environment variable used as fallback when the flag is not passed */
  env?: string;
}

export interface CommandSpec {
  name: string;
  description: string;
  flags: FlagSpec[];
  run(options: Record<string, unknown>): Promise<void> | void;
  /** Custom interactive wizard; defaults to a generic flags-based prompt flow */
  interactive?(): Promise<void>;
}

export interface CommandGroup {
  name: string;
  description: string;
  commands: CommandSpec[];
}

export interface ParsedArgs {
  positionals: string[];
  options: Record<string, unknown>;
  help: boolean;
  interactive: boolean;
}
