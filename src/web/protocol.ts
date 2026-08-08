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

/** One NDJSON line of a streamed run. */
export type RunEvent =
  | { type: "out"; data: string }
  | { type: "err"; data: string }
  | { type: "exit"; code: number };
