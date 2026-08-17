// ── Provider inspection ────────────────────────────────────────────────────────
//
// "Point this at a base URL and a key, and tell me what I'm actually talking
// to." Answering that from the browser is not possible — providers send no CORS
// headers, so a fetch from the page is blocked before it is even sent — so the
// probing happens here and the browser only ever sees the report.
//
// Two rules carried over from env.ts, for the same reasons:
//
//  1. A key handed to this module is used and dropped. Nothing stores it, and
//     the report carries only the redacted rendering, so a key cannot be read
//     back out of the UI it was typed into.
//  2. The URL is validated to http/https. This server already runs arbitrary
//     commands for whoever can reach it, so this is not the boundary that keeps
//     the machine safe — the loopback bind is — but there is no reason to hand
//     out file:// reads or to make the process fetch a URL shape nothing else
//     in the tool accepts.

import { type ApiModel, toModelDef } from "../openai-benchmark/models";
import { maskSecret, overrideEnv } from "./env";
import type {
  InspectReport,
  ModelTestResult,
  ProbedModel,
  ProbedRoute,
  RouteAccess,
  RouteVerdict,
} from "./protocol";

/** A probe is a diagnostic, not a benchmark: it should fail fast and say so. */
const PROBE_TIMEOUT_MS = 12_000;
const TEST_TIMEOUT_MS = 45_000;

/** Provider error bodies are unbounded; only the opening is worth showing. */
const MESSAGE_LIMIT = 300;

export class InspectError extends Error {}

// ── Route table ────────────────────────────────────────────────────────────────

interface RouteSpec {
  method: "GET" | "POST";
  path: string;
  description: string;
  /**
   * Body for a POST probe, deliberately incomplete.
   *
   * An empty object fails the provider's own request validation, which happens
   * before any model is loaded — so the probe learns that the route is live and
   * that the credentials passed, without spending a token on either.
   */
  body?: unknown;
}

const ROUTES: RouteSpec[] = [
  { description: "Model catalogue", method: "GET", path: "/models" },
  { body: {}, description: "Chat completions", method: "POST", path: "/chat/completions" },
  { body: {}, description: "Responses API", method: "POST", path: "/responses" },
  { body: {}, description: "Embeddings", method: "POST", path: "/embeddings" },
  { body: {}, description: "Legacy text completions", method: "POST", path: "/completions" },
  { description: "Key limits and usage", method: "GET", path: "/key" },
  { description: "Credit balance", method: "GET", path: "/credits" },
];

/**
 * A validation error means the route is there — which is the whole question.
 * Only an explicit "no such thing" counts as missing.
 */
function classify(status: number): RouteVerdict {
  if (status === 404 || status === 405 || status === 501) return "missing";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "error";
  return "available";
}

/**
 * Compare the two attempts. The credential-free one carries the answer: a route
 * that responds the same way without a key does not require one.
 *
 * The authenticated attempt still gets a veto. Providers authenticate before
 * they route, so a route they do not implement answers 401 unauthenticated and
 * 404 with a key — and reading only the first of those would label every absent
 * route "private", which describes the middleware rather than the route. A route
 * that is not there cannot be characterised as guarded or open.
 */
function accessOf(authenticated: number | null, unauthenticated: number | null): RouteAccess {
  if (authenticated === null || unauthenticated === null) return "unknown";
  if (classify(authenticated) === "missing") return "unknown";
  if (unauthenticated === 401 || unauthenticated === 403) return "private";
  if (classify(unauthenticated) === "missing") return "unknown";
  return "public";
}

// ── Plumbing ───────────────────────────────────────────────────────────────────

/**
 * Reject anything that is not an absolute http(s) URL, and drop the trailing
 * slash so `${base}${path}` never produces a double one — some providers route
 * `//models` to a 404 and the report would blame the wrong thing.
 */
export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new InspectError("A base URL is required, e.g. https://api.openai.com/v1");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InspectError("Base URL must be an absolute URL, e.g. https://host/v1");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InspectError("Base URL must use http or https.");
  }

  return trimmed.replace(/\/+$/, "");
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    // Bun reports a blown AbortSignal.timeout as a bare "The operation was
    // aborted", which reads like a bug rather than a slow provider.
    if (err.name === "TimeoutError" || err.name === "AbortError") return "Timed out";
    return err.message;
  }
  return String(err);
}

/** Pull the human-readable part out of a provider's error body. */
function providerMessage(body: string): string | undefined {
  const text = body.trim();
  if (text === "") return undefined;

  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed !== null && typeof parsed === "object") {
      const root = parsed as Record<string, unknown>;
      const error = root["error"];
      if (typeof error === "string") return error.slice(0, MESSAGE_LIMIT);
      if (error !== null && typeof error === "object") {
        const message = (error as Record<string, unknown>)["message"];
        if (typeof message === "string") return message.slice(0, MESSAGE_LIMIT);
      }
      const message = root["message"];
      if (typeof message === "string") return message.slice(0, MESSAGE_LIMIT);
    }
  } catch {
    // Not JSON — an HTML error page from a proxy in front of the provider.
  }
  return text.slice(0, MESSAGE_LIMIT);
}

interface Attempt {
  status: number | null;
  body: string;
  latencyMs: number;
  failure?: string;
}

async function attempt(
  url: string,
  spec: Pick<RouteSpec, "method" | "body">,
  apiKey: string | null,
  timeoutMs: number,
): Promise<Attempt> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey !== null) headers["authorization"] = `Bearer ${apiKey}`;
  if (spec.body !== undefined) headers["content-type"] = "application/json";

  const start = performance.now();
  try {
    const res = await fetch(url, {
      headers,
      method: spec.method,
      signal: AbortSignal.timeout(timeoutMs),
      ...(spec.body === undefined ? {} : { body: JSON.stringify(spec.body) }),
    });
    return { body: await res.text(), latencyMs: performance.now() - start, status: res.status };
  } catch (err) {
    return {
      body: "",
      failure: errorText(err),
      latencyMs: performance.now() - start,
      status: null,
    };
  }
}

// ── Catalogue ──────────────────────────────────────────────────────────────────

/**
 * The descriptive fields the inspector shows and the benchmark has no use for.
 * Kept here rather than pushed onto `ApiModel` so the benchmark's model type
 * stays about benchmarking.
 */
interface CatalogueExtras {
  created?: number;
  owned_by?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  input_modalities?: string[];
  output_modalities?: string[];
  top_provider?: { is_moderated?: boolean; max_completion_tokens?: number | null };
}

function toProbedModel(raw: ApiModel & CatalogueExtras): ProbedModel {
  const def = toModelDef(raw);
  const inputModalities = raw.input_modalities ?? raw.architecture?.input_modalities ?? [];
  const outputModalities = raw.output_modalities ?? raw.architecture?.output_modalities ?? [];
  const maxCompletion = raw.top_provider?.max_completion_tokens;

  return {
    contextLength: def.contextLength,
    created: raw.created,
    hasReasoning: def.hasReasoning,
    id: def.id,
    inputModalities,
    inputPricePer1M: def.inputPricePer1M,
    isEmbedding: def.isEmbedding,
    isFree: def.isFree,
    label: def.label,
    ...(maxCompletion === null || maxCompletion === undefined
      ? {}
      : { maxCompletionTokens: maxCompletion }),
    moderated: raw.top_provider?.is_moderated,
    outputModalities,
    outputPricePer1M: def.outputPricePer1M,
    outputsTextOnly: def.outputsTextOnly,
    ownedBy: raw.owned_by,
    pricingKnown: def.pricingKnown,
    supportedParameters: def.supportedParameters,
  };
}

interface Catalogue {
  models: ProbedModel[];
  totalCount?: number;
  error?: string;
  attempt: Attempt;
}

/**
 * A 404 on /models is the single most common way this goes wrong, and it is
 * almost always a base URL missing its version segment — so say that, rather
 * than reporting a bare status and letting it be rediscovered.
 */
function catalogueError(status: number, baseUrl: string, body: string): string {
  const message = providerMessage(body);
  const detail = message === undefined ? "" : ` — ${message}`;

  if (status === 401 || status === 403) {
    return `Provider rejected the credentials (${status})${detail}`;
  }
  if (status === 404 && !/\/v\d+$/.test(baseUrl)) {
    return `No /models at ${baseUrl} (404). Most OpenAI-compatible URLs end in a version segment — try ${baseUrl}/v1`;
  }
  return `Could not list models (${status})${detail}`;
}

async function fetchCatalogue(baseUrl: string, apiKey: string | null): Promise<Catalogue> {
  const result = await attempt(`${baseUrl}/models`, { method: "GET" }, apiKey, PROBE_TIMEOUT_MS);

  if (result.status === null) {
    return { attempt: result, error: `Could not reach ${baseUrl} — ${result.failure}`, models: [] };
  }
  if (result.status < 200 || result.status >= 300) {
    return {
      attempt: result,
      error: catalogueError(result.status, baseUrl, result.body),
      models: [],
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(result.body);
  } catch {
    return {
      attempt: result,
      error: "The provider answered /models with something that is not JSON.",
      models: [],
    };
  }

  const root = payload as { data?: unknown; total_count?: unknown };
  // Most providers wrap the list in `data`; a few answer with a bare array.
  const list = Array.isArray(root.data) ? root.data : Array.isArray(payload) ? payload : null;
  if (list === null) {
    return {
      attempt: result,
      error: "The provider's /models response has no model list in it.",
      models: [],
    };
  }

  const models = (list as (ApiModel & CatalogueExtras)[])
    .filter((m) => typeof m?.id === "string")
    .map(toProbedModel)
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    attempt: result,
    models,
    ...(typeof root.total_count === "number" ? { totalCount: root.total_count } : {}),
  };
}

// ── Report ─────────────────────────────────────────────────────────────────────

export interface InspectInput {
  baseUrl?: string;
  apiKey?: string;
  /**
   * Fall back to the credentials the server already holds, so the provider the
   * commands will use can be checked without retyping its key.
   */
  useSession?: boolean;
}

interface Credentials {
  apiKey: string | null;
  source: InspectReport["keySource"];
}

function resolveKey(input: InspectInput): Credentials {
  const provided = input.apiKey?.trim();
  if (provided !== undefined && provided !== "") {
    if (/\s/.test(provided)) {
      // The same paste accident env.ts guards against: a key carrying a newline
      // becomes an unsendable header, and the 401 that follows looks like a
      // credentials problem rather than a clipboard one.
      throw new InspectError("API key cannot contain whitespace — check the paste.");
    }
    return { apiKey: provided, source: "request" };
  }

  if (input.useSession === true) {
    const session = overrideEnv()["OPENAI_API_KEY"] ?? process.env["OPENAI_API_KEY"];
    if (session !== undefined && session !== "") {
      return { apiKey: session, source: "session" };
    }
  }

  return { apiKey: null, source: "none" };
}

function resolveBaseUrl(input: InspectInput): string {
  const provided = input.baseUrl?.trim();
  if (provided !== undefined && provided !== "") return normalizeBaseUrl(provided);

  if (input.useSession === true) {
    const session = overrideEnv()["OPENAI_BASE_URL"] ?? process.env["OPENAI_BASE_URL"];
    if (session !== undefined && session !== "") return normalizeBaseUrl(session);
    return "https://api.openai.com/v1";
  }

  throw new InspectError("A base URL is required, e.g. https://api.openai.com/v1");
}

/**
 * Probe one route twice — with credentials and without — so the report can say
 * both whether it works and whether it is guarded.
 *
 * The unauthenticated pass is skipped when there is no key to contrast it with:
 * the two attempts would be identical, and access is then read off the single
 * result instead.
 */
async function probeRoute(
  baseUrl: string,
  spec: RouteSpec,
  apiKey: string | null,
  authenticated?: Attempt,
): Promise<ProbedRoute> {
  const url = `${baseUrl}${spec.path}`;
  const authed = authenticated ?? (await attempt(url, spec, apiKey, PROBE_TIMEOUT_MS));
  const unauthed = apiKey === null ? authed : await attempt(url, spec, null, PROBE_TIMEOUT_MS);

  const verdict: RouteVerdict = authed.status === null ? "unreachable" : classify(authed.status);
  const message = authed.status === null ? authed.failure : providerMessage(authed.body);

  return {
    access: accessOf(authed.status, unauthed.status),
    description: spec.description,
    latencyMs: Math.round(authed.latencyMs),
    method: spec.method,
    path: spec.path,
    status: authed.status,
    unauthenticatedStatus: unauthed.status,
    verdict,
    ...(message === undefined || message === "" ? {} : { message }),
  };
}

/**
 * Probe a provider and report what it exposes.
 *
 * The catalogue is fetched first because its response is needed in full, and
 * its status is then reused as the /models row rather than asking twice.
 */
export async function inspectProvider(input: InspectInput): Promise<InspectReport> {
  const baseUrl = resolveBaseUrl(input);
  const { apiKey, source } = resolveKey(input);
  const start = performance.now();

  const catalogue = await fetchCatalogue(baseUrl, apiKey);

  const routes = await Promise.all(
    ROUTES.map((spec) =>
      probeRoute(baseUrl, spec, apiKey, spec.path === "/models" ? catalogue.attempt : undefined),
    ),
  );

  const models = routes.find((r) => r.path === "/models");
  // Only the catalogue answers this: an open /models is what "no key needed"
  // actually looks like, and an unreachable one teaches nothing either way.
  const authRequired =
    models === undefined || models.access === "unknown" ? null : models.access === "private";

  return {
    authRequired,
    baseUrl,
    elapsedMs: Math.round(performance.now() - start),
    keySource: source,
    keyUsed: apiKey === null ? null : maskSecret(apiKey),
    models: catalogue.models,
    probedAt: new Date().toISOString(),
    routes,
    ...(catalogue.error === undefined ? {} : { modelsError: catalogue.error }),
    ...(catalogue.totalCount === undefined ? {} : { totalCount: catalogue.totalCount }),
  };
}

// ── Single-model test ──────────────────────────────────────────────────────────

export interface ModelTestInput extends InspectInput {
  model?: string;
  /** Drive the model through /embeddings instead of /chat/completions */
  embedding?: boolean;
  /**
   * Ask the provider to switch reasoning off (OpenRouter's `reasoning.enabled`).
   * Only send it to models that advertise reasoning — strict OpenAI-compatible
   * servers reject body parameters they do not know.
   */
  disableReasoning?: boolean;
}

/**
 * A budget big enough for a greeting and too small to cost anything.
 *
 * Sized against reasoning models rather than the greeting: they spend the budget
 * thinking before they emit a character, and at 24 tokens every one of them came
 * back with an empty sample — technically a pass, but not one that showed you
 * anything. Even on the priciest model this is a fraction of a cent.
 */
const TEST_MAX_TOKENS = 96;
const TEST_PROMPT = "Say OK.";

interface ChatResponse {
  choices?: {
    finish_reason?: string | null;
    // Providers disagree on the field name for published thinking: Ollama sends
    // `reasoning`, DeepSeek and others send `reasoning_content`.
    message?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface EmbeddingResponse {
  data?: { embedding?: number[] }[];
  usage?: { prompt_tokens?: number };
}

/**
 * Send one real request to one model.
 *
 * This is the only part of the page that spends money, which is why it is a
 * per-model action rather than something the inspection does across a whole
 * catalogue: 300 models is 300 billable requests, and nobody means to do that
 * by loading a page.
 */
export async function testModel(input: ModelTestInput): Promise<ModelTestResult> {
  const model = input.model?.trim();
  if (model === undefined || model === "") {
    throw new InspectError("A model id is required.");
  }

  const baseUrl = resolveBaseUrl(input);
  const { apiKey } = resolveKey(input);
  const embedding = input.embedding === true;
  const route = embedding ? "embeddings" : "chat";

  const body = embedding
    ? { input: TEST_PROMPT, model }
    : {
        max_tokens: TEST_MAX_TOKENS,
        messages: [{ content: TEST_PROMPT, role: "user" }],
        model,
        ...(input.disableReasoning === true ? { reasoning: { enabled: false } } : {}),
      };

  const result = await attempt(
    `${baseUrl}/${embedding ? "embeddings" : "chat/completions"}`,
    { body, method: "POST" },
    apiKey,
    TEST_TIMEOUT_MS,
  );

  const latencyMs = Math.round(result.latencyMs);

  if (result.status === null) {
    return { error: result.failure, latencyMs, model, ok: false, route, status: null };
  }
  if (result.status < 200 || result.status >= 300) {
    return {
      error: providerMessage(result.body) ?? `Request failed (${result.status})`,
      latencyMs,
      model,
      ok: false,
      route,
      status: result.status,
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(result.body);
  } catch {
    return {
      error: "The provider answered with something that is not JSON.",
      latencyMs,
      model,
      ok: false,
      route,
      status: result.status,
    };
  }

  if (embedding) {
    const parsed = payload as EmbeddingResponse;
    const vector = parsed.data?.[0]?.embedding;
    if (vector === undefined) {
      return {
        error: "The response carried no embedding.",
        latencyMs,
        model,
        ok: false,
        route,
        status: result.status,
      };
    }
    return {
      dimensions: vector.length,
      latencyMs,
      model,
      ok: true,
      promptTokens: parsed.usage?.prompt_tokens,
      route,
      status: result.status,
    };
  }

  const parsed = payload as ChatResponse;
  const choice = parsed.choices?.[0];
  const text = choice?.message?.content ?? "";
  const thinking = choice?.message?.reasoning ?? choice?.message?.reasoning_content ?? "";
  const finishReason = choice?.finish_reason;

  return {
    completionTokens: parsed.usage?.completion_tokens,
    ...(finishReason === undefined || finishReason === null ? {} : { finishReason }),
    latencyMs,
    model,
    ok: true,
    promptTokens: parsed.usage?.prompt_tokens,
    ...(thinking === "" ? {} : { reasoningSample: thinking.trim().slice(0, 300) }),
    route,
    // A reasoning model can spend the whole budget thinking and answer with an
    // empty string; that is still a model that answered, so it is a pass with an
    // empty sample rather than a failure. Its thinking is reported separately.
    sample: text.trim().slice(0, 200),
    status: result.status,
  };
}
