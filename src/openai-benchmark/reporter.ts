import color from "picocolors";
import { table, log, type Column } from "../shared/ui";
import type { ModelBenchmarkResult } from "./benchmark";

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

// ── Spinner ────────────────────────────────────────────────────────────────────

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function createSpinner(message: string): {
  log: (msg: string) => void;
  stop: (final: string) => void;
} {
  let frame = 0;
  let stopped = false;

  const interval = setInterval(() => {
    if (!stopped) {
      process.stdout.write(
        `\r\x1b[K  ${color.cyan(FRAMES[frame++ % FRAMES.length]!)} ${color.dim(message)}`,
      );
    }
  }, 80);

  return {
    log: (msg: string) => {
      process.stdout.write(`\r\x1b[K${msg}\n`);
      if (!stopped) {
        process.stdout.write(
          `  ${color.cyan(FRAMES[frame % FRAMES.length]!)} ${color.dim(message)}`,
        );
      }
    },
    stop: (final: string) => {
      stopped = true;
      clearInterval(interval);
      process.stdout.write(`\r\x1b[K  ${color.green("✓")} ${final}\n`);
    },
  };
}

// ── Results table ──────────────────────────────────────────────────────────────

export function printResults(results: ModelBenchmarkResult[]): void {
  const anySuccess = results.some((r) => r.stats.successRate > 0);

  if (!anySuccess) {
    console.log();
    log.error("All benchmark runs failed. Check your API key and network connection.");
    for (const r of results) {
      const err = r.runs.find((run) => run.error)?.error;
      if (err) log.step(`${r.label}: ${err}`);
    }
    console.log();
    return;
  }

  console.log(`\n  ${color.bold("Results")}\n`);

  const columns: Column[] = [
    { label: "Model" },
    { label: "TTFT", align: "right" },
    { label: "Latency", align: "right" },
    { label: "p95", align: "right" },
    { label: "Tok/s", align: "right" },
    { label: "Tokens", align: "right" },
    { label: "Cost/run", align: "right" },
    { label: "OK", align: "right" },
  ];

  const rows = results.map((r) => {
    const s = r.stats;
    const ttft = s.ttfMs ? fmtMs(s.ttfMs.mean) : color.dim("—");
    const latency = s.totalMs.mean > 0 ? color.green(fmtMs(s.totalMs.mean)) : color.dim("—");
    const p95 = s.totalMs.p95 > 0 ? fmtMs(s.totalMs.p95) : color.dim("—");
    const tps = s.tokensPerSec.mean > 0 ? fmt(s.tokensPerSec.mean, 1) : color.dim("—");
    const tokens = fmt(s.outputTokens.mean, 0);
    const cost = fmtCost(s.totalCostUsd / Math.max(r.runs.length, 1));
    const ok =
      s.successRate === 1 ? color.green("100%") : color.red(`${fmt(s.successRate * 100, 0)}%`);

    return [color.bold(r.label), ttft, latency, p95, tps, tokens, cost, ok];
  });

  table(columns, rows);

  // ── Highlights ────────────────────────────────────────────────────────────

  const successful = results.filter((r) => r.stats.successRate > 0);
  if (successful.length >= 2) {
    const fastest = successful.reduce(
      (a, b) => (a.stats.totalMs.mean < b.stats.totalMs.mean ? a : b),
      successful[0]!,
    );
    const cheapest = successful.reduce(
      (a, b) =>
        a.stats.totalCostUsd / a.runs.length < b.stats.totalCostUsd / b.runs.length ? a : b,
      successful[0]!,
    );
    const highestTps = successful.reduce(
      (a, b) => (a.stats.tokensPerSec.mean > b.stats.tokensPerSec.mean ? a : b),
      successful[0]!,
    );

    const LW = 12;
    console.log(`\n  ${color.bold("Highlights")}`);
    console.log(
      `  ${color.dim("Fastest".padEnd(LW))} ${color.bold(fastest.label)}  ` +
        color.dim(fmtMs(fastest.stats.totalMs.mean) + " avg"),
    );
    console.log(
      `  ${color.dim("Cheapest".padEnd(LW))} ${color.bold(cheapest.label)}  ` +
        color.dim(fmtCost(cheapest.stats.totalCostUsd / cheapest.runs.length) + "/run"),
    );
    console.log(
      `  ${color.dim("Throughput".padEnd(LW))} ${color.bold(highestTps.label)}  ` +
        color.dim(fmt(highestTps.stats.tokensPerSec.mean, 1) + " tok/s"),
    );
  }

  const totalCost = results.reduce((s, r) => s + r.stats.totalCostUsd, 0);
  console.log(`\n  ${color.dim("Total cost:")} ${color.bold(fmtCost(totalCost))}`);
  console.log();
}
