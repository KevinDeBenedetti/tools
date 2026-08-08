import type OpenAI from "openai";
import { classifyError, type ErrorKind, withRetry } from "./errors";
import { type ModelDef, estimateCost } from "./models";

// Embedding benchmark.
//
// The metrics differ from chat: there is no streaming, so no TTFT, and a single
// request carries a whole batch. What matters is how fast a batch comes back,
// how wide the vectors are, and — above all — whether the vectors actually
// separate relevant text from irrelevant text (see retrieval.ts).

export interface EmbeddingConfig {
  /** Batch embedded on each run, sized to be representative rather than trivial */
  texts: string[];
  runs: number;
  timeoutMs: number;
  retries: number;
  /** Request a specific output width, when the model supports it */
  dimensions?: number;
}

export interface EmbedResult {
  vectors: number[][];
  inputTokens: number;
  totalMs: number;
}

/**
 * How a model wants queries and documents distinguished. Asymmetric retrieval
 * models embed the two differently, and the accepted vocabulary is provider
 * specific — NVIDIA takes query/passage and rejects the search_* spelling that
 * OpenRouter documents, so the value is negotiated per model rather than
 * assumed.
 */
export interface InputTypeVariant {
  query: string;
  document: string;
}

export const INPUT_TYPE_VARIANTS: InputTypeVariant[] = [
  { document: "passage", query: "query" },
  { document: "search_document", query: "search_query" },
];

export interface EmbedOptions {
  timeoutMs: number;
  dimensions?: number;
  inputType?: string;
}

/** Issue one embedding request. Owns the timeout, like request.ts does for chat. */
export async function embed(
  client: OpenAI,
  modelId: string,
  input: string[],
  options: EmbedOptions,
): Promise<EmbedResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);
  const start = performance.now();

  try {
    const resp = await client.embeddings.create(
      {
        // The SDK defaults to base64 and decodes it client-side. Several
        // providers reject that format outright (NVIDIA: "do not support
        // base64 encoding_format"), so ask for floats explicitly.
        encoding_format: "float",
        input,
        model: modelId,
        ...(options.dimensions === undefined ? {} : { dimensions: options.dimensions }),
        ...(options.inputType === undefined ? {} : { input_type: options.inputType }),
      },
      { signal: controller.signal },
    );

    // The API does not promise input order, so index the vectors explicitly.
    const vectors: number[][] = new Array(input.length).fill(null);
    for (const item of resp.data) {
      vectors[item.index] = item.embedding as unknown as number[];
    }

    return {
      inputTokens: resp.usage?.prompt_tokens ?? 0,
      totalMs: performance.now() - start,
      vectors: vectors.filter((v): v is number[] => Array.isArray(v)),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Embed an arbitrary number of texts, chunked. Providers cap how many inputs a
 * single request accepts, and the cap is not advertised — chunking keeps the
 * retrieval suite to a handful of requests regardless of how many cases it has.
 */
export const MAX_BATCH = 64;

export async function embedAll(
  client: OpenAI,
  modelId: string,
  texts: string[],
  options: EmbedOptions & { retries: number },
): Promise<EmbedResult> {
  const vectors: number[][] = [];
  let inputTokens = 0;
  let totalMs = 0;

  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const chunk = texts.slice(i, i + MAX_BATCH);
    const result = await withRetry(
      () =>
        embed(client, modelId, chunk, {
          timeoutMs: options.timeoutMs,
          ...(options.dimensions === undefined ? {} : { dimensions: options.dimensions }),
          ...(options.inputType === undefined ? {} : { inputType: options.inputType }),
        }),
      { retries: options.retries },
    );
    vectors.push(...result.vectors);
    inputTokens += result.inputTokens;
    totalMs += result.totalMs;
  }

  return { inputTokens, totalMs, vectors };
}

// ── Per-run benchmark ──────────────────────────────────────────────────────────

export interface EmbedRunResult {
  totalMs: number;
  inputTokens: number;
  vectors: number;
  dimensions: number;
  textsPerSec: number;
  tokensPerSec: number;
  costUsd: number;
  error?: string;
  errorKind?: ErrorKind;
}

export interface EmbeddingStats {
  totalMs: { mean: number; p50: number; p95: number };
  textsPerSec: { mean: number; p50: number; p95: number };
  tokensPerSec: { mean: number; p50: number; p95: number };
  dimensions: number;
  inputTokens: number;
  totalCostUsd: number;
  successRate: number;
  errorCounts: Partial<Record<ErrorKind, number>>;
}

export interface EmbeddingBenchmarkResult {
  modelId: string;
  label: string;
  isFree: boolean;
  pricingKnown: boolean;
  runs: EmbedRunResult[];
  stats: EmbeddingStats;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

function stats(values: number[]): { mean: number; p50: number; p95: number } {
  if (values.length === 0) return { mean: 0, p50: 0, p95: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: values.reduce((s, v) => s + v, 0) / values.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

async function runOnce(
  client: OpenAI,
  model: ModelDef,
  config: EmbeddingConfig,
): Promise<EmbedRunResult> {
  const start = performance.now();
  try {
    const result = await withRetry(
      () =>
        embed(client, model.id, config.texts, {
          timeoutMs: config.timeoutMs,
          ...(config.dimensions === undefined ? {} : { dimensions: config.dimensions }),
        }),
      { retries: config.retries },
    );

    return {
      costUsd: estimateCost(model, result.inputTokens, 0),
      dimensions: result.vectors[0]?.length ?? 0,
      inputTokens: result.inputTokens,
      textsPerSec: (result.vectors.length / result.totalMs) * 1000,
      tokensPerSec: (result.inputTokens / result.totalMs) * 1000,
      totalMs: result.totalMs,
      vectors: result.vectors.length,
    };
  } catch (err) {
    const classified = classifyError(err);
    return {
      costUsd: 0,
      dimensions: 0,
      error: classified.message,
      errorKind: classified.kind,
      inputTokens: 0,
      textsPerSec: 0,
      tokensPerSec: 0,
      totalMs: performance.now() - start,
      vectors: 0,
    };
  }
}

export function summarizeEmbedding(runs: EmbedRunResult[]): EmbeddingStats {
  const ok = runs.filter((r) => !r.error);
  const errorCounts: Partial<Record<ErrorKind, number>> = {};
  for (const run of runs) {
    if (run.errorKind !== undefined) {
      errorCounts[run.errorKind] = (errorCounts[run.errorKind] ?? 0) + 1;
    }
  }

  return {
    dimensions: ok[0]?.dimensions ?? 0,
    errorCounts,
    inputTokens: ok[0]?.inputTokens ?? 0,
    successRate: runs.length === 0 ? 0 : ok.length / runs.length,
    textsPerSec: stats(ok.map((r) => r.textsPerSec)),
    tokensPerSec: stats(ok.map((r) => r.tokensPerSec)),
    totalCostUsd: runs.reduce((s, r) => s + r.costUsd, 0),
    totalMs: stats(ok.map((r) => r.totalMs)),
  };
}

export async function benchmarkEmbeddingModel(
  client: OpenAI,
  model: ModelDef,
  config: EmbeddingConfig,
  onRunComplete?: (run: number, result: EmbedRunResult) => void,
): Promise<EmbeddingBenchmarkResult> {
  const runs: EmbedRunResult[] = [];
  for (let i = 0; i < config.runs; i++) {
    const result = await runOnce(client, model, config);
    runs.push(result);
    onRunComplete?.(i + 1, result);
  }

  return {
    isFree: model.isFree,
    label: model.label,
    modelId: model.id,
    pricingKnown: model.pricingKnown,
    runs,
    stats: summarizeEmbedding(runs),
  };
}

// ── Probe ──────────────────────────────────────────────────────────────────────

export interface EmbedProbeResult {
  model: ModelDef;
  ok: boolean;
  latencyMs: number;
  /** The input_type vocabulary this model accepted, if any */
  inputType?: InputTypeVariant;
  error?: ReturnType<typeof classifyError>;
}

/**
 * Find which input_type vocabulary a model accepts, by trying each and keeping
 * the first that is not rejected. Metadata does not carry this, and guessing
 * wrong is a 400 — so it is measured, like the chat capability probes.
 * Returns undefined for models that take no input_type at all.
 */
export async function detectInputType(
  client: OpenAI,
  modelId: string,
  timeoutMs: number,
): Promise<InputTypeVariant | undefined> {
  for (const variant of INPUT_TYPE_VARIANTS) {
    try {
      await embed(client, modelId, ["ping"], { inputType: variant.query, timeoutMs });
      return variant;
    } catch (err) {
      // A rejected vocabulary just means "try the next one"; anything else
      // (rate limit, outage) means the answer is unknowable right now.
      if (classifyError(err).kind !== "bad_request") return undefined;
    }
  }
  return undefined;
}

export async function probeEmbeddingModels(
  client: OpenAI,
  models: ModelDef[],
  options: { timeoutMs: number; retries: number; negotiateInputType: boolean },
  onResult?: (result: EmbedProbeResult, index: number, total: number) => void,
): Promise<{
  alive: ModelDef[];
  dead: EmbedProbeResult[];
  inputTypes: Map<string, InputTypeVariant>;
}> {
  const alive: ModelDef[] = [];
  const dead: EmbedProbeResult[] = [];
  const inputTypes = new Map<string, InputTypeVariant>();

  for (const [index, model] of models.entries()) {
    const start = performance.now();
    let result: EmbedProbeResult;
    try {
      const probe = await withRetry(
        () => embed(client, model.id, ["ping"], { timeoutMs: options.timeoutMs }),
        { retries: options.retries },
      );

      // A model that answers with no vector is as unusable as one that errors.
      if (probe.vectors[0] === undefined || probe.vectors[0].length === 0) {
        result = {
          error: { kind: "unknown", message: "returned no vector" },
          latencyMs: performance.now() - start,
          model,
          ok: false,
        };
      } else {
        const variant = options.negotiateInputType
          ? await detectInputType(client, model.id, options.timeoutMs)
          : undefined;
        if (variant !== undefined) inputTypes.set(model.id, variant);
        result = {
          latencyMs: performance.now() - start,
          model,
          ok: true,
          ...(variant === undefined ? {} : { inputType: variant }),
        };
      }
    } catch (err) {
      result = {
        error: classifyError(err),
        latencyMs: performance.now() - start,
        model,
        ok: false,
      };
    }

    if (result.ok) alive.push(model);
    else dead.push(result);
    onResult?.(result, index + 1, models.length);
  }

  return { alive, dead, inputTypes };
}
