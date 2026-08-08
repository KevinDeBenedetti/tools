// Error classification and retry policy.
//
// Free-tier model catalogues are noisy: a request can fail because the provider
// rate-limited you (transient, and not the model's fault), because the model is
// listed but dead (permanent), or because the request itself was rejected. The
// benchmark reports these very differently, so failures are classified rather
// than collapsed into one error string.

export type ErrorKind =
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "bad_request"
  | "auth"
  | "unknown";

export interface ClassifiedError {
  kind: ErrorKind;
  message: string;
  status?: number;
  /** How long the provider asked us to wait, when it said so */
  retryAfterMs?: number;
}

/** Kinds worth retrying: the model may well answer on the next attempt. */
const RETRYABLE: ReadonlySet<ErrorKind> = new Set<ErrorKind>(["rate_limited", "timeout"]);

export function isRetryable(error: ClassifiedError): boolean {
  // 5xx is transient; a 404 dressed as "unavailable" is not.
  if (error.kind === "unavailable") {
    return error.status !== undefined && error.status >= 500;
  }
  return RETRYABLE.has(error.kind);
}

function statusToKind(status: number): ErrorKind {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth";
  if (status === 408 || status === 504) return "timeout";
  if (status === 404 || status === 502 || status === 503 || status >= 500) return "unavailable";
  if (status >= 400) return "bad_request";
  return "unknown";
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (headers === null || typeof headers !== "object") return undefined;

  // The SDK exposes either a fetch Headers instance or a plain object,
  // depending on version and transport.
  const get = (headers as { get?: unknown }).get;
  if (typeof get === "function") {
    const value = (get as (k: string) => unknown).call(headers, name);
    return typeof value === "string" ? value : undefined;
  }

  const record = headers as Record<string, unknown>;
  const direct = record[name] ?? record[name.toLowerCase()];
  return typeof direct === "string" ? direct : undefined;
}

/** Read the wait hint a provider attaches to a 429, in milliseconds. */
function retryAfterMs(headers: unknown): number | undefined {
  const ms = headerValue(headers, "retry-after-ms");
  if (ms !== undefined) {
    const n = Number(ms);
    if (Number.isFinite(n) && n >= 0) return n;
  }

  const seconds = headerValue(headers, "retry-after");
  if (seconds !== undefined) {
    const n = Number(seconds);
    if (Number.isFinite(n) && n >= 0) return n * 1000;
    // Retry-After may also be an HTTP date.
    const at = Date.parse(seconds);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }

  return undefined;
}

export function classifyError(err: unknown): ClassifiedError {
  const message = err instanceof Error ? err.message : String(err);

  if (err !== null && typeof err === "object") {
    const e = err as { status?: unknown; name?: unknown; headers?: unknown };

    if (e.name === "AbortError" || e.name === "TimeoutError") {
      return { kind: "timeout", message: "Request timed out" };
    }

    if (typeof e.status === "number") {
      const kind = statusToKind(e.status);
      const wait = kind === "rate_limited" ? retryAfterMs(e.headers) : undefined;
      return wait === undefined
        ? { kind, message, status: e.status }
        : { kind, message, retryAfterMs: wait, status: e.status };
    }
  }

  if (/timed? ?out|aborted/i.test(message)) {
    return { kind: "timeout", message };
  }

  return { kind: "unknown", message };
}

export interface RetryOptions {
  /** Extra attempts after the first one */
  retries: number;
  /** Base delay for exponential backoff, doubled per attempt */
  baseDelayMs?: number;
  /** Upper bound on any single backoff wait */
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: ClassifiedError, delayMs: number) => void;
  /** Injectable for tests */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Backoff delay for `attempt` (1-based), honouring a provider's Retry-After. */
export function backoffDelay(
  attempt: number,
  error: ClassifiedError,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  if (error.retryAfterMs !== undefined) {
    return Math.min(error.retryAfterMs, maxDelayMs);
  }
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  // Jitter keeps a batch of models from retrying in lockstep and re-tripping
  // the same per-minute limit.
  const jitter = Math.random() * baseDelayMs;
  return Math.min(exponential + jitter, maxDelayMs);
}

/**
 * Run `fn`, retrying transient failures with exponential backoff. Throws the
 * original error once attempts are exhausted or the failure is permanent.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const classified = classifyError(err);
      if (attempt === options.retries || !isRetryable(classified)) {
        throw err;
      }
      const delay = backoffDelay(attempt + 1, classified, baseDelayMs, maxDelayMs);
      options.onRetry?.(attempt + 1, classified, delay);
      await sleep(delay);
    }
  }

  throw lastError;
}
