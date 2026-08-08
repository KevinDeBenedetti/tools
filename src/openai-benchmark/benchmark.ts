import type OpenAI from "openai";
import { classifyError, type ErrorKind, withRetry } from "./errors";
import { estimateCost, type ModelDef } from "./models";
import { complete } from "./request";

export interface BenchmarkConfig {
  prompt: string;
  runs: number;
  maxTokens: number;
  /** Stream mode measures TTFT accurately */
  stream: boolean;
  /** Abort a single request after this long */
  timeoutMs: number;
  /** Retries per run on transient failures (429, 5xx, timeout) */
  retries: number;
}

export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_RETRIES = 2;

export interface RunResult {
  ttfms: number | null;
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  tokensPerSec: number;
  error?: string;
  errorKind?: ErrorKind;
}

export interface ModelBenchmarkResult {
  modelId: string;
  label: string;
  /** Whether cost figures are based on real provider pricing */
  pricingKnown: boolean;
  isFree: boolean;
  runs: RunResult[];
  stats: BenchmarkStats;
}

export interface BenchmarkStats {
  ttfMs: { mean: number; p50: number; p95: number } | null;
  totalMs: { mean: number; p50: number; p95: number };
  tokensPerSec: { mean: number; p50: number; p95: number };
  inputTokens: number;
  outputTokens: { mean: number };
  totalCostUsd: number;
  successRate: number;
  /** Failure counts per kind, so rate limiting reads differently from a dead model */
  errorCounts: Partial<Record<ErrorKind, number>>;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

function stats(values: number[]): { mean: number; p50: number; p95: number } {
  if (values.length === 0) {
    return { mean: 0, p50: 0, p95: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return { mean, p50: percentile(sorted, 50), p95: percentile(sorted, 95) };
}

async function runOnce(
  client: OpenAI,
  model: ModelDef,
  config: BenchmarkConfig,
  onRetry?: (attempt: number, kind: ErrorKind, delayMs: number) => void,
): Promise<RunResult> {
  const start = performance.now();

  try {
    // Retries are excluded from the reported timings: withRetry returns the
    // timing of the attempt that actually succeeded.
    const result = await withRetry(
      () =>
        complete(client, {
          maxTokens: config.maxTokens,
          model: model.id,
          prompt: config.prompt,
          stream: config.stream,
          timeoutMs: config.timeoutMs,
        }),
      {
        onRetry: (attempt, error, delayMs) => onRetry?.(attempt, error.kind, delayMs),
        retries: config.retries,
      },
    );

    const tokensPerSec =
      result.outputTokens > 0 ? (result.outputTokens / result.totalMs) * 1000 : 0;

    return {
      costUsd: estimateCost(model, result.inputTokens, result.outputTokens),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      tokensPerSec,
      totalMs: result.totalMs,
      ttfms: result.ttfMs,
    };
  } catch (err) {
    const classified = classifyError(err);
    return {
      costUsd: 0,
      error: classified.message,
      errorKind: classified.kind,
      inputTokens: 0,
      outputTokens: 0,
      tokensPerSec: 0,
      totalMs: performance.now() - start,
      ttfms: null,
    };
  }
}

export function summarize(runs: RunResult[]): BenchmarkStats {
  const successful = runs.filter((r) => !r.error);
  const successRate = runs.length === 0 ? 0 : successful.length / runs.length;

  const errorCounts: Partial<Record<ErrorKind, number>> = {};
  for (const run of runs) {
    if (run.errorKind !== undefined) {
      errorCounts[run.errorKind] = (errorCounts[run.errorKind] ?? 0) + 1;
    }
  }

  const ttfValues = successful.map((r) => r.ttfms).filter((v): v is number => v !== null);

  return {
    errorCounts,
    inputTokens: successful[0]?.inputTokens ?? 0,
    outputTokens: {
      mean: successful.reduce((s, r) => s + r.outputTokens, 0) / (successful.length || 1),
    },
    successRate,
    tokensPerSec: stats(successful.map((r) => r.tokensPerSec)),
    totalCostUsd: runs.reduce((s, r) => s + r.costUsd, 0),
    totalMs: stats(successful.map((r) => r.totalMs)),
    ttfMs: ttfValues.length > 0 ? stats(ttfValues) : null,
  };
}

export async function benchmarkModel(
  client: OpenAI,
  model: ModelDef,
  config: BenchmarkConfig,
  onRunComplete?: (run: number, result: RunResult) => void,
  onRetry?: (attempt: number, kind: ErrorKind, delayMs: number) => void,
): Promise<ModelBenchmarkResult> {
  const runs: RunResult[] = [];
  for (let i = 0; i < config.runs; i++) {
    const result = await runOnce(client, model, config, onRetry);
    runs.push(result);
    onRunComplete?.(i + 1, result);
  }

  return {
    isFree: model.isFree,
    label: model.label,
    modelId: model.id,
    pricingKnown: model.pricingKnown,
    runs,
    stats: summarize(runs),
  };
}
