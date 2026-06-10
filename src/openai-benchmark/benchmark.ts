import OpenAI from "openai";
import { estimateCost, type ModelDef } from "./models";

export interface BenchmarkConfig {
  prompt: string;
  runs: number;
  maxTokens: number;
  /** Stream mode measures TTFT accurately */
  stream: boolean;
}

export interface RunResult {
  ttfms: number | null;
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  tokensPerSec: number;
  error?: string;
}

export interface ModelBenchmarkResult {
  modelId: string;
  label: string;
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
): Promise<RunResult> {
  const start = performance.now();
  let ttfms: number | null = null;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    // Create an AbortController with a 60-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      if (config.stream) {
        const stream = await client.chat.completions.create({
          max_tokens: config.maxTokens,
          messages: [{ content: config.prompt, role: "user" }],
          model: model.id,
          stream: true,
          stream_options: { include_usage: true },
        });

        for await (const chunk of stream) {
          if (ttfms === null && chunk.choices[0]?.delta?.content) {
            ttfms = performance.now() - start;
          }
          const usage = chunk.usage;
          if (usage) {
            inputTokens = usage.prompt_tokens;
            outputTokens = usage.completion_tokens;
          }
        }
      } else {
        const resp = await client.chat.completions.create({
          max_tokens: config.maxTokens,
          messages: [{ content: config.prompt, role: "user" }],
          model: model.id,
          stream: false,
        });
        inputTokens = resp.usage?.prompt_tokens ?? 0;
        outputTokens = resp.usage?.completion_tokens ?? 0;
      }
    } finally {
      clearTimeout(timeoutId);
    }

    const totalMs = performance.now() - start;
    const tokensPerSec = outputTokens > 0 ? (outputTokens / totalMs) * 1000 : 0;
    const costUsd = estimateCost(model, inputTokens, outputTokens);

    return { costUsd, inputTokens, outputTokens, tokensPerSec, totalMs, ttfms };
  } catch (err) {
    const totalMs = performance.now() - start;
    return {
      costUsd: 0,
      error: err instanceof Error ? err.message : String(err),
      inputTokens: 0,
      outputTokens: 0,
      tokensPerSec: 0,
      totalMs,
      ttfms: null,
    };
  }
}

export async function benchmarkModel(
  client: OpenAI,
  model: ModelDef,
  config: BenchmarkConfig,
  onRunComplete?: (run: number, result: RunResult) => void,
): Promise<ModelBenchmarkResult> {
  const runs: RunResult[] = [];
  for (let i = 0; i < config.runs; i++) {
    const result = await runOnce(client, model, config);
    runs.push(result);
    onRunComplete?.(i + 1, result);
  }

  const successful = runs.filter((r) => !r.error);
  const successRate = successful.length / runs.length;

  const totalStats = stats(successful.map((r) => r.totalMs));
  const tpsStats = stats(successful.map((r) => r.tokensPerSec));
  const outputTokensMean =
    successful.reduce((s, r) => s + r.outputTokens, 0) / (successful.length || 1);
  const inputTokens = successful[0]?.inputTokens ?? 0;
  const totalCostUsd = runs.reduce((s, r) => s + r.costUsd, 0);

  const ttfValues = successful.map((r) => r.ttfms).filter((v): v is number => v !== null);
  const ttfMs = ttfValues.length > 0 ? stats(ttfValues) : null;

  return {
    label: model.label,
    modelId: model.id,
    runs,
    stats: {
      inputTokens,
      outputTokens: { mean: outputTokensMean },
      successRate,
      totalCostUsd,
      tokensPerSec: tpsStats,
      totalMs: totalStats,
      ttfMs,
    },
  };
}
