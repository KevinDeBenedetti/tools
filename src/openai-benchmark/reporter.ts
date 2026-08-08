import color from "picocolors";
import { type Column, log, table } from "../shared/ui";
import type { ModelBenchmarkResult } from "./benchmark";
import type { EmbeddingBenchmarkResult, InputTypeVariant } from "./embeddings";
import type { ErrorKind } from "./errors";
import type { ProbeResult } from "./probe";
import type { CapabilityResult, QualityResult } from "./quality";
import type { RetrievalResult } from "./retrieval";

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmt(n: number, d = 0): string {
  return n.toFixed(d);
}

export function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;
}

function fmtCost(usd: number): string {
  return usd < 0.0001 ? `$${usd.toFixed(6)}` : `$${usd.toFixed(4)}`;
}

function fmtPct(ratio: number): string {
  return `${fmt(ratio * 100, 0)}%`;
}

const ERROR_LABELS: Record<ErrorKind, string> = {
  auth: "auth rejected",
  bad_request: "request rejected",
  rate_limited: "rate limited",
  timeout: "timed out",
  unavailable: "unavailable",
  unknown: "failed",
};

export function describeErrorKind(kind: ErrorKind): string {
  return ERROR_LABELS[kind];
}

/**
 * The kind alone is enough for a rate limit or a timeout, but a 400 is only
 * actionable with the provider's own words — "do not support base64
 * encoding_format" is the whole diagnosis.
 */
export function describeError(error: { kind: ErrorKind; message: string } | undefined): string {
  if (error === undefined) return "failed";
  const label = describeErrorKind(error.kind);
  if (error.kind === "bad_request" || error.kind === "unknown") {
    const detail = error.message.trim();
    if (detail !== "") return `${label} — ${detail}`;
  }
  return label;
}

// ── Spinner ────────────────────────────────────────────────────────────────────

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function createSpinner(message: string): {
  log: (msg: string) => void;
  update: (msg: string) => void;
  stop: (final: string) => void;
} {
  let frame = 0;
  let stopped = false;
  let current = message;

  const interval = setInterval(() => {
    if (!stopped) {
      process.stdout.write(
        `\r\x1b[K  ${color.cyan(FRAMES[frame++ % FRAMES.length]!)} ${color.dim(current)}`,
      );
    }
  }, 80);

  return {
    log: (msg: string) => {
      process.stdout.write(`\r\x1b[K${msg}\n`);
      if (!stopped) {
        process.stdout.write(
          `  ${color.cyan(FRAMES[frame % FRAMES.length]!)} ${color.dim(current)}`,
        );
      }
    },
    stop: (final: string) => {
      stopped = true;
      clearInterval(interval);
      process.stdout.write(`\r\x1b[K  ${color.green("✓")} ${final}\n`);
    },
    update: (msg: string) => {
      current = msg;
    },
  };
}

// ── Probe report ───────────────────────────────────────────────────────────────

export function printProbeSummary(alive: number, dead: ProbeResult[]): void {
  if (dead.length === 0) {
    log.success(`All ${alive} models responded to the probe`);
    return;
  }

  log.warn(`${dead.length} model(s) dropped — no usable response:`);
  for (const result of dead) {
    log.step(`${result.model.id} — ${describeError(result.error)}`);
  }
  log.info(`${alive} model(s) left to benchmark`);
}

// ── Results table ──────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  const text = fmtPct(score);
  if (score >= 0.8) return color.green(text);
  if (score >= 0.5) return color.yellow(text);
  return color.red(text);
}

function okCell(result: ModelBenchmarkResult): string {
  const { successRate, errorCounts } = result.stats;
  if (successRate === 1) return color.green("100%");

  const text = fmtPct(successRate);
  // Rate limiting says something about the free tier, not about the model.
  if ((errorCounts.rate_limited ?? 0) > 0) {
    return `${color.yellow(text)} ${color.dim("(429)")}`;
  }
  return color.red(text);
}

export function printResults(
  results: ModelBenchmarkResult[],
  quality?: Map<string, QualityResult>,
): void {
  const anySuccess = results.some((r) => r.stats.successRate > 0);

  if (!anySuccess) {
    console.log();
    log.error("All benchmark runs failed. Check your API key and network connection.");
    for (const r of results) {
      const failed = r.runs.find((run) => run.error);
      if (failed?.error !== undefined) {
        const kind =
          failed.errorKind === undefined ? "" : `${describeErrorKind(failed.errorKind)}: `;
        log.step(`${r.label}: ${kind}${failed.error}`);
      }
    }
    console.log();
    return;
  }

  const withQuality = quality !== undefined && quality.size > 0;

  console.log(`\n  ${color.bold("Results")}\n`);

  const columns: Column[] = [
    { label: "Model" },
    ...(withQuality ? [{ align: "right" as const, label: "Score" }] : []),
    { align: "right", label: "TTFT" },
    { align: "right", label: "Latency" },
    { align: "right", label: "p95" },
    { align: "right", label: "Tok/s" },
    { align: "right", label: "Tokens" },
    { align: "right", label: "Cost/run" },
    { align: "right", label: "OK" },
  ];

  const rows = results.map((r) => {
    const s = r.stats;
    const ttft = s.ttfMs ? fmtMs(s.ttfMs.mean) : color.dim("—");
    const latency = s.totalMs.mean > 0 ? color.green(fmtMs(s.totalMs.mean)) : color.dim("—");
    const p95 = s.totalMs.p95 > 0 ? fmtMs(s.totalMs.p95) : color.dim("—");
    const tps = s.tokensPerSec.mean > 0 ? fmt(s.tokensPerSec.mean, 1) : color.dim("—");
    const tokens = fmt(s.outputTokens.mean, 0);
    const cost = r.isFree
      ? color.green("free")
      : r.pricingKnown
        ? fmtCost(s.totalCostUsd / Math.max(r.runs.length, 1))
        : color.dim("—");

    const q = quality?.get(r.modelId);
    const scoreCell =
      q === undefined
        ? color.dim("—")
        : q.emptyOutputs === q.tasks.length && q.tasks.length > 0
          ? color.yellow("no text")
          : scoreColor(q.score);

    return [
      color.bold(r.label),
      ...(withQuality ? [scoreCell] : []),
      ttft,
      latency,
      p95,
      tps,
      tokens,
      cost,
      okCell(r),
    ];
  });

  table(columns, rows);

  if (withQuality) {
    printCapabilities(results, quality);
  }

  printHighlights(results, quality);

  const priced = results.filter((r) => r.pricingKnown && !r.isFree);
  if (priced.length > 0) {
    const totalCost = priced.reduce((s, r) => s + r.stats.totalCostUsd, 0);
    const suffix = priced.length < results.length ? color.dim(" (paid models only)") : "";
    console.log(`\n  ${color.dim("Total cost:")} ${color.bold(fmtCost(totalCost))}${suffix}`);
  }
  console.log();
}

// ── Embedding results ──────────────────────────────────────────────────────────

export function printEmbeddingResults(
  results: EmbeddingBenchmarkResult[],
  retrieval?: Map<string, RetrievalResult>,
  inputTypes?: Map<string, InputTypeVariant>,
): void {
  if (!results.some((r) => r.stats.successRate > 0)) {
    console.log();
    log.error("All embedding runs failed.");
    for (const r of results) {
      const failed = r.runs.find((run) => run.error);
      if (failed?.error !== undefined) {
        const kind =
          failed.errorKind === undefined ? "" : `${describeErrorKind(failed.errorKind)}: `;
        log.step(`${r.label}: ${kind}${failed.error}`);
      }
    }
    console.log();
    return;
  }

  const withRetrieval = retrieval !== undefined && retrieval.size > 0;

  console.log(`\n  ${color.bold("Results")}\n`);

  const columns: Column[] = [
    { label: "Model" },
    ...(withRetrieval
      ? [
          { align: "right" as const, label: "P@1" },
          { align: "right" as const, label: "MRR" },
          { align: "right" as const, label: "Margin" },
        ]
      : []),
    { align: "right", label: "Dims" },
    { align: "right", label: "Latency" },
    { align: "right", label: "p95" },
    { align: "right", label: "Texts/s" },
    { align: "right", label: "Cost/run" },
    { align: "right", label: "OK" },
  ];

  const rows = results.map((r) => {
    const s = r.stats;
    const q = retrieval?.get(r.modelId);
    const dims = q?.dimensions ?? s.dimensions;

    const retrievalCells = withRetrieval
      ? q === undefined || q.error !== undefined
        ? [color.dim("—"), color.dim("—"), color.dim("—")]
        : [
            scoreColor(q.precisionAt1),
            fmt(q.mrr, 2),
            // A margin near zero means the model barely separates the right
            // answer from a plausible wrong one, even when it ranks first.
            q.meanMargin < 0.02 ? color.yellow(fmt(q.meanMargin, 3)) : fmt(q.meanMargin, 3),
          ]
      : [];

    return [
      color.bold(r.label),
      ...retrievalCells,
      dims > 0 ? String(dims) : color.dim("—"),
      s.totalMs.mean > 0 ? color.green(fmtMs(s.totalMs.mean)) : color.dim("—"),
      s.totalMs.p95 > 0 ? fmtMs(s.totalMs.p95) : color.dim("—"),
      s.textsPerSec.mean > 0 ? fmt(s.textsPerSec.mean, 1) : color.dim("—"),
      r.isFree
        ? color.green("free")
        : r.pricingKnown
          ? fmtCost(s.totalCostUsd / Math.max(r.runs.length, 1))
          : color.dim("—"),
      s.successRate === 1
        ? color.green("100%")
        : (s.errorCounts.rate_limited ?? 0) > 0
          ? `${color.yellow(fmtPct(s.successRate))} ${color.dim("(429)")}`
          : color.red(fmtPct(s.successRate)),
    ];
  });

  table(columns, rows);

  if (withRetrieval) {
    printRetrievalDetail(results, retrieval, inputTypes);
    printEmbeddingHighlights(results, retrieval);
  }
  console.log();
}

function printRetrievalDetail(
  results: EmbeddingBenchmarkResult[],
  retrieval: Map<string, RetrievalResult>,
  inputTypes?: Map<string, InputTypeVariant>,
): void {
  const rows = results
    .map((r) => ({ q: retrieval.get(r.modelId), r }))
    .filter((e): e is { q: RetrievalResult; r: EmbeddingBenchmarkResult } => e.q !== undefined)
    .map(({ q, r }) => [
      color.bold(r.label),
      // Asymmetric models are measured the way they are meant to be used;
      // showing which mode was negotiated keeps the score interpretable.
      inputTypes?.get(r.modelId) === undefined
        ? color.dim("symmetric")
        : color.cyan(`${inputTypes.get(r.modelId)!.query}/${inputTypes.get(r.modelId)!.document}`),
      // Unnormalised vectors are usable, but you must normalise before a dot
      // product — a silent source of wrong results in a vector store.
      q.normalized ? color.green("unit") : color.yellow("not unit"),
      q.error !== undefined
        ? color.red(q.error)
        : q.cases
            .filter((c) => !c.passed)
            .map((c) => c.caseId)
            .join(", ") || color.dim("none"),
    ]);

  if (rows.length === 0) return;

  console.log(`\n  ${color.bold("Retrieval")}\n`);
  table(
    [{ label: "Model" }, { label: "Encoding" }, { label: "Vectors" }, { label: "Missed cases" }],
    rows,
  );
}

function printEmbeddingHighlights(
  results: EmbeddingBenchmarkResult[],
  retrieval: Map<string, RetrievalResult>,
): void {
  const scored = results
    .filter((r) => r.stats.successRate > 0)
    .map((r) => ({ q: retrieval.get(r.modelId), r }))
    .filter(
      (e): e is { q: RetrievalResult; r: EmbeddingBenchmarkResult } =>
        e.q !== undefined && e.q.error === undefined,
    );
  if (scored.length < 2) return;

  const LW = 14;
  const line = (label: string, name: string, detail: string): void => {
    console.log(`  ${color.dim(label.padEnd(LW))} ${color.bold(name)}  ${color.dim(detail)}`);
  };

  console.log(`\n  ${color.bold("Highlights")}`);

  const best = scored.reduce((a, b) => (a.q.precisionAt1 >= b.q.precisionAt1 ? a : b), scored[0]!);
  line("Best recall", best.r.label, `P@1 ${fmtPct(best.q.precisionAt1)}`);

  const fastest = scored.reduce(
    (a, b) => (a.r.stats.totalMs.mean < b.r.stats.totalMs.mean ? a : b),
    scored[0]!,
  );
  line("Fastest", fastest.r.label, `${fmtMs(fastest.r.stats.totalMs.mean)} per batch`);

  // Narrow vectors cost less to store and search; among models that retrieve
  // equally well, the smallest one wins.
  const contenders = scored.filter((e) => e.q.precisionAt1 >= best.q.precisionAt1 - 0.1);
  const leanest = contenders.reduce(
    (a, b) => (a.q.dimensions <= b.q.dimensions ? a : b),
    contenders[0]!,
  );
  if (leanest.r.modelId !== best.r.modelId) {
    line(
      "Best value",
      leanest.r.label,
      `P@1 ${fmtPct(leanest.q.precisionAt1)} at ${leanest.q.dimensions} dims`,
    );
  }
}

// ── Capabilities ───────────────────────────────────────────────────────────────

function capabilityCell(result: CapabilityResult | undefined): string {
  if (result === undefined) return color.dim("—");
  if (result.actual) {
    return result.claimed ? color.green("✓") : `${color.green("✓")} ${color.dim("(undeclared)")}`;
  }
  // Advertised but non-functional is the case worth shouting about: it is what
  // breaks an integration after the model has already been picked.
  return result.claimed ? `${color.red("✗")} ${color.yellow("(claimed)")}` : color.dim("✗");
}

function printCapabilities(
  results: ModelBenchmarkResult[],
  quality: Map<string, QualityResult>,
): void {
  const rows = results
    .map((r) => ({ q: quality.get(r.modelId), r }))
    .filter(
      (entry): entry is { q: QualityResult; r: ModelBenchmarkResult } => entry.q !== undefined,
    )
    .map(({ q, r }) => [
      color.bold(r.label),
      capabilityCell(q.capabilities.find((c) => c.capability === "json_mode")),
      capabilityCell(q.capabilities.find((c) => c.capability === "tools")),
      q.emptyOutputs > 0
        ? color.yellow(`${q.emptyOutputs} empty (reasoning budget?)`)
        : q.tasks
            .filter((t) => !t.passed)
            .map((t) => t.taskId)
            .join(", ") || color.dim("none"),
    ]);

  if (rows.length === 0) return;

  console.log(`\n  ${color.bold("Capabilities")}\n`);
  table(
    [{ label: "Model" }, { label: "JSON mode" }, { label: "Tools" }, { label: "Failed tasks" }],
    rows,
  );
}

// ── Highlights ─────────────────────────────────────────────────────────────────

function printHighlights(
  results: ModelBenchmarkResult[],
  quality?: Map<string, QualityResult>,
): void {
  const successful = results.filter((r) => r.stats.successRate > 0);
  if (successful.length < 2) return;

  const LW = 14;
  const line = (label: string, name: string, detail: string): void => {
    console.log(`  ${color.dim(label.padEnd(LW))} ${color.bold(name)}  ${color.dim(detail)}`);
  };

  console.log(`\n  ${color.bold("Highlights")}`);

  const fastest = successful.reduce(
    (a, b) => (a.stats.totalMs.mean < b.stats.totalMs.mean ? a : b),
    successful[0]!,
  );
  line("Fastest", fastest.label, `${fmtMs(fastest.stats.totalMs.mean)} avg`);

  const highestTps = successful.reduce(
    (a, b) => (a.stats.tokensPerSec.mean > b.stats.tokensPerSec.mean ? a : b),
    successful[0]!,
  );
  line("Throughput", highestTps.label, `${fmt(highestTps.stats.tokensPerSec.mean, 1)} tok/s`);

  const priced = successful.filter((r) => r.pricingKnown && !r.isFree);
  if (priced.length > 0) {
    const cheapest = priced.reduce(
      (a, b) =>
        a.stats.totalCostUsd / a.runs.length < b.stats.totalCostUsd / b.runs.length ? a : b,
      priced[0]!,
    );
    line(
      "Cheapest",
      cheapest.label,
      `${fmtCost(cheapest.stats.totalCostUsd / cheapest.runs.length)}/run`,
    );
  }

  if (quality === undefined || quality.size === 0) return;

  const scored = successful
    .map((r) => ({ q: quality.get(r.modelId), r }))
    .filter((e): e is { q: QualityResult; r: ModelBenchmarkResult } => e.q !== undefined);
  if (scored.length === 0) return;

  const best = scored.reduce((a, b) => (a.q.score >= b.q.score ? a : b), scored[0]!);
  line("Best score", best.r.label, `${fmtPct(best.q.score)} of tasks passed`);

  // Among models within 10 points of the best score, prefer the fastest: past
  // a quality threshold, latency is what you actually feel.
  const threshold = best.q.score - 0.1;
  const contenders = scored.filter((e) => e.q.score >= threshold);
  const bestValue = contenders.reduce(
    (a, b) => (a.r.stats.totalMs.mean <= b.r.stats.totalMs.mean ? a : b),
    contenders[0]!,
  );
  if (bestValue.r.modelId !== best.r.modelId) {
    line(
      "Best value",
      bestValue.r.label,
      `${fmtPct(bestValue.q.score)} at ${fmtMs(bestValue.r.stats.totalMs.mean)}`,
    );
  }
}
