import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { BenchmarkConfig, ModelBenchmarkResult } from "./benchmark";
import type { EmbeddingBenchmarkResult, EmbeddingConfig, EmbedProbeResult } from "./embeddings";
import type { ProbeResult } from "./probe";
import type { QualityResult } from "./quality";
import type { RetrievalResult } from "./retrieval";

// JSON snapshot of a run. Free catalogues churn week to week — models appear,
// get retired, or quietly change backing hardware — so a single run has a short
// shelf life. Writing a structured snapshot makes runs comparable after the
// fact instead of forcing a re-benchmark.

export const REPORT_VERSION = 1;

export interface BenchmarkReport {
  version: number;
  generatedAt: string;
  baseUrl: string;
  kind: "chat";
  config: Omit<BenchmarkConfig, "prompt"> & { prompt: string };
  models: ModelReport[];
  dropped: DroppedReport[];
}

export interface ModelReport {
  modelId: string;
  label: string;
  isFree: boolean;
  pricingKnown: boolean;
  latencyMs: { mean: number; p50: number; p95: number };
  ttfMs: { mean: number; p50: number; p95: number } | null;
  tokensPerSec: { mean: number; p50: number; p95: number };
  outputTokensMean: number;
  costPerRunUsd: number | null;
  successRate: number;
  errorCounts: Record<string, number>;
  quality: {
    score: number;
    failedTasks: string[];
    emptyOutputs: number;
    capabilities: { capability: string; claimed: boolean; actual: boolean }[];
  } | null;
}

export interface DroppedReport {
  modelId: string;
  reason: string;
}

export function buildReport(
  baseUrl: string,
  config: BenchmarkConfig,
  results: ModelBenchmarkResult[],
  quality: Map<string, QualityResult>,
  dropped: ProbeResult[],
): BenchmarkReport {
  return {
    baseUrl,
    config,
    dropped: dropped.map((d) => ({
      modelId: d.model.id,
      reason: d.error?.kind ?? "unknown",
    })),
    generatedAt: new Date().toISOString(),
    kind: "chat",
    models: results.map((r) => {
      const q = quality.get(r.modelId);
      return {
        costPerRunUsd:
          r.pricingKnown && r.runs.length > 0 ? r.stats.totalCostUsd / r.runs.length : null,
        errorCounts: r.stats.errorCounts as Record<string, number>,
        isFree: r.isFree,
        label: r.label,
        latencyMs: r.stats.totalMs,
        modelId: r.modelId,
        outputTokensMean: r.stats.outputTokens.mean,
        pricingKnown: r.pricingKnown,
        quality:
          q === undefined
            ? null
            : {
                capabilities: q.capabilities.map((c) => ({
                  actual: c.actual,
                  capability: c.capability,
                  claimed: c.claimed,
                })),
                emptyOutputs: q.emptyOutputs,
                failedTasks: q.tasks.filter((t) => !t.passed).map((t) => t.taskId),
                score: q.score,
              },
        successRate: r.stats.successRate,
        tokensPerSec: r.stats.tokensPerSec,
        ttfMs: r.stats.ttfMs,
      };
    }),
    version: REPORT_VERSION,
  };
}

// ── Embedding report ───────────────────────────────────────────────────────────

export interface EmbeddingReport {
  version: number;
  generatedAt: string;
  baseUrl: string;
  kind: "embeddings";
  config: EmbeddingConfig;
  models: EmbeddingModelReport[];
  dropped: DroppedReport[];
}

export interface EmbeddingModelReport {
  modelId: string;
  label: string;
  isFree: boolean;
  pricingKnown: boolean;
  dimensions: number;
  latencyMs: { mean: number; p50: number; p95: number };
  textsPerSec: { mean: number; p50: number; p95: number };
  costPerRunUsd: number | null;
  successRate: number;
  errorCounts: Record<string, number>;
  retrieval: {
    precisionAt1: number;
    mrr: number;
    meanMargin: number;
    normalized: boolean;
    missedCases: string[];
    error?: string;
  } | null;
}

export function buildEmbeddingReport(
  baseUrl: string,
  config: EmbeddingConfig,
  results: EmbeddingBenchmarkResult[],
  retrieval: Map<string, RetrievalResult>,
  dropped: EmbedProbeResult[],
): EmbeddingReport {
  return {
    baseUrl,
    config,
    dropped: dropped.map((d) => ({ modelId: d.model.id, reason: d.error?.kind ?? "unknown" })),
    generatedAt: new Date().toISOString(),
    kind: "embeddings",
    models: results.map((r) => {
      const q = retrieval.get(r.modelId);
      return {
        costPerRunUsd:
          r.pricingKnown && r.runs.length > 0 ? r.stats.totalCostUsd / r.runs.length : null,
        dimensions: q?.dimensions ?? r.stats.dimensions,
        errorCounts: r.stats.errorCounts as Record<string, number>,
        isFree: r.isFree,
        label: r.label,
        latencyMs: r.stats.totalMs,
        modelId: r.modelId,
        pricingKnown: r.pricingKnown,
        retrieval:
          q === undefined
            ? null
            : {
                meanMargin: q.meanMargin,
                missedCases: q.cases.filter((c) => !c.passed).map((c) => c.caseId),
                mrr: q.mrr,
                normalized: q.normalized,
                precisionAt1: q.precisionAt1,
                ...(q.error === undefined ? {} : { error: q.error }),
              },
        successRate: r.stats.successRate,
        textsPerSec: r.stats.textsPerSec,
      };
    }),
    version: REPORT_VERSION,
  };
}

/** Write the report, creating parent directories as needed. Returns the path. */
export async function writeReport(
  path: string,
  report: BenchmarkReport | EmbeddingReport,
): Promise<string> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return target;
}
