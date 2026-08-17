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

// ── Provider inspection ────────────────────────────────────────────────────────

/**
 * What a probe learned about one route.
 *
 * A validation error counts as `available`: the route answered, which is the
 * question being asked. Only 404/405/501 mean the provider does not implement
 * it — and `unreachable` is reserved for the case where nothing answered at
 * all, which is a base URL or network problem rather than a route problem.
 */
export type RouteVerdict =
  | "available"
  | "unauthorized"
  | "missing"
  | "rate-limited"
  | "error"
  | "unreachable";

/**
 * Whether the route can be called without credentials.
 *
 * Decided by asking twice — once with the key, once without — and comparing.
 * `public` is the normal answer for a local runtime (Ollama, LM Studio, vLLM)
 * and a red flag for anything reachable off the machine. `unknown` means the
 * comparison could not be made: the route is absent, or the second attempt
 * never landed.
 */
export type RouteAccess = "public" | "private" | "unknown";

export interface ProbedRoute {
  method: "GET" | "POST";
  /** Path relative to the base URL, as it was probed */
  path: string;
  description: string;
  verdict: RouteVerdict;
  /** Status of the authenticated attempt; null when nothing answered */
  status: number | null;
  access: RouteAccess;
  /** Status of the credential-free attempt, for the access verdict above */
  unauthenticatedStatus: number | null;
  latencyMs: number;
  /** The provider's own error text, when it sent one worth repeating */
  message?: string;
}

/**
 * One catalogue entry as the browser is given it.
 *
 * A superset of the benchmark's `ModelDef` — the pricing, free and modality
 * fields are derived by the same code, so the inspector and the benchmark can
 * never disagree about whether a model is free — plus the descriptive fields
 * only a human reading a table cares about.
 */
export interface ProbedModel {
  id: string;
  label: string;
  isFree: boolean;
  /** Whether the provider published usable pricing (OpenAI itself does not) */
  pricingKnown: boolean;
  inputPricePer1M: number;
  outputPricePer1M: number;
  contextLength?: number;
  maxCompletionTokens?: number;
  supportedParameters: string[];
  hasReasoning: boolean;
  isEmbedding: boolean;
  outputsTextOnly: boolean;
  inputModalities: string[];
  outputModalities: string[];
  /** Who the provider says owns the model ("openai", "system", an org id…) */
  ownedBy?: string;
  /** Provider applies its own moderation pass to this model */
  moderated?: boolean;
  /** Unix seconds, as the provider reports it */
  created?: number;
}

export interface InspectReport {
  /** The normalized base URL that was actually probed */
  baseUrl: string;
  /** Redacted rendering of the key used, or null when none was sent */
  keyUsed: string | null;
  /** Where that key came from */
  keySource: "request" | "session" | "none";
  /**
   * Whether the provider demanded credentials for its catalogue. `null` when
   * the catalogue could not be reached, so nothing was learned either way.
   */
  authRequired: boolean | null;
  routes: ProbedRoute[];
  models: ProbedModel[];
  /** `total_count`, for providers that paginate and report one */
  totalCount?: number;
  /** Why the catalogue is empty, when it is */
  modelsError?: string;
  probedAt: string;
  elapsedMs: number;
}

/** The outcome of sending one real request to one model. */
export interface ModelTestResult {
  model: string;
  ok: boolean;
  /** Which route was exercised — embeddings models cannot be chatted with */
  route: "chat" | "embeddings";
  latencyMs: number;
  status: number | null;
  /** The opening of what the model actually said */
  sample?: string;
  /**
   * The opening of the model's thinking, when it published any.
   *
   * Kept apart from `sample` rather than folded into it: a reasoning model
   * routinely spends a small budget entirely on thinking and answers with an
   * empty string, and showing that text is the difference between a useful
   * result and a blank one — but it is not the model's answer and must not be
   * presented as one.
   */
  reasoningSample?: string;
  /** Why the model stopped — "length" means the test budget cut it off */
  finishReason?: string;
  /** Vector width, for an embeddings model */
  dimensions?: number;
  promptTokens?: number;
  completionTokens?: number;
  error?: string;
}
