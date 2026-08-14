// Wire format shared by the server and the browser. Kept free of Bun and DOM
// APIs — and of anything that reaches for `process` — so both halves can import
// it under their own tsconfig.

import type { FlagType } from "../cli/types";

export interface WebFlag {
  name: string;
  /** How the flag is spelled on the command line */
  kebab: string;
  description: string;
  type: FlagType;
  default?: unknown;
  required: boolean;
  env?: string;
}

export interface WebCommand {
  name: string;
  description: string;
  flags: WebFlag[];
  /** Command mutates something irreversible unless left in its dry-run default */
  destructiveFlag?: string;
}

export interface WebGroup {
  name: string;
  description: string;
  commands: WebCommand[];
}

/**
 * One environment variable as the browser is allowed to see it.
 *
 * `masked` is a redacted rendering produced on the server — a secret's real
 * value has no route to the client, by design. `null` means unset.
 */
export interface EnvVarState {
  name: string;
  description: string;
  masked: string | null;
  secret: boolean;
  /** Where the value in effect comes from */
  source: "override" | "environment" | "unset";
  /** Whether the UI may set this one for the session */
  editable: boolean;
  /** Commands that read it, so an unset variable says what it breaks */
  usedBy: string[];
}

/**
 * One NDJSON line of a streamed run.
 *
 * `ping` carries nothing and is never displayed: it exists so a command that
 * stays quiet for a long time — a benchmark waiting on a slow model — keeps the
 * connection alive rather than being cut short as idle.
 */
export type RunEvent =
  | { type: "out"; data: string }
  | { type: "err"; data: string }
  | { type: "ping" }
  | { type: "exit"; code: number };
