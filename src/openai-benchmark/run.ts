import * as p from "@clack/prompts";
import color from "picocolors";
import { log } from "../shared/ui";
import {
  type BenchmarkConfig,
  benchmarkModel,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_MS,
  type ModelBenchmarkResult,
} from "./benchmark";
import { createClient, loadConfig } from "./config";
import { buildReport, writeReport } from "./export";
import {
  explainFunnel,
  fetchModels,
  filterModels,
  filterModelsVerbose,
  getModel,
  type ModelDef,
  parseModelQuery,
  unknownModel,
} from "./models";
import { probeModels, type ProbeResult } from "./probe";
import { type QualityResult, runQuality } from "./quality";
import {
  createSpinner,
  describeErrorKind,
  fmtMs,
  printProbeSummary,
  printResults,
} from "./reporter";
import { DEFAULT_TASKS } from "./tasks";

export const DEFAULT_PROMPT =
  "Explain the difference between concurrency and parallelism in 3 sentences.";

export interface BenchmarkRunOptions {
  models: string[];
  runs: number;
  prompt: string;
  maxTokens: number;
  stream: boolean;
  /** Discovery: keep only models the provider does not charge for */
  free: boolean;
  /** Discovery: case-insensitive regex on model id/label */
  match?: string;
  /** Discovery: cap the number of models selected */
  limit?: number;
  /** Discovery: drop models that cannot produce text */
  textOnly: boolean;
  /** Extra key=value parameters forwarded to the provider's /models endpoint */
  query: string[];
  /** Drop unreachable models with one tiny request before benchmarking */
  probe: boolean;
  /** Run the deterministic task suite and capability probes */
  quality: boolean;
  timeoutMs: number;
  retries: number;
  /** Write a JSON snapshot of the run to this path */
  json?: string;
}

const CAPABILITY_COUNT = 2;

/** Requests this run will issue, so a free-tier daily budget is not a surprise. */
function estimateRequests(models: number, opts: BenchmarkRunOptions): number {
  const perModel =
    (opts.probe ? 1 : 0) + opts.runs + (opts.quality ? DEFAULT_TASKS.length + CAPABILITY_COUNT : 0);
  return models * perModel;
}

// ── Model selection ────────────────────────────────────────────────────────────

interface Selection {
  models: ModelDef[];
  /** One-line account of how the catalogue narrowed, when filters were used */
  funnel?: string;
}

/** Resolve the models to benchmark, or null when the selection is empty. */
async function selectModels(
  client: Parameters<typeof fetchModels>[0],
  opts: BenchmarkRunOptions,
): Promise<Selection | null> {
  let available: ModelDef[] = [];
  try {
    available = await fetchModels(client, parseModelQuery(opts.query));
  } catch (err) {
    // Explicit ids can still be benchmarked without the catalogue; discovery cannot.
    log.warn(`Could not fetch model metadata: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (opts.models.length > 0) {
    if (opts.free || opts.match !== undefined || opts.limit !== undefined) {
      log.warn("--free/--match/--limit are discovery filters and are ignored alongside --models.");
    }
    return { models: opts.models.map((id) => getModel(id, available) ?? unknownModel(id)) };
  }

  const filter = {
    free: opts.free,
    textOnly: opts.textOnly,
    ...(opts.match === undefined ? {} : { match: opts.match }),
    ...(opts.limit === undefined ? {} : { limit: opts.limit }),
  };
  const { funnel, models } = filterModelsVerbose(available, filter);

  if (models.length === 0) {
    if (available.length === 0) {
      log.error("No models available. Pass --models <id,id> or check your credentials.");
    } else {
      log.error(`No model matched: ${explainFunnel(funnel, filter)}`);
      log.step("Relax the filters, or list what is on offer: bun run benchmark models --free");
    }
    return null;
  }

  return { funnel: explainFunnel(funnel, filter), models };
}

// ── Core runner ────────────────────────────────────────────────────────────────

export async function runBenchmark(opts: BenchmarkRunOptions): Promise<void> {
  const client = await createClient();
  if (!client) {
    log.error("OPENAI_API_KEY is not set. Export it or add it to a .env file.");
    process.exitCode = 1;
    return;
  }

  let selection: Selection | null;
  try {
    selection = await selectModels(client, opts);
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  if (selection === null) {
    process.exitCode = 1;
    return;
  }

  let models = selection.models;

  const config: BenchmarkConfig = {
    maxTokens: opts.maxTokens,
    prompt: opts.prompt,
    retries: opts.retries,
    runs: opts.runs,
    stream: opts.stream,
    timeoutMs: opts.timeoutMs,
  };

  console.log(`\n  ${color.dim("Prompt:")}   ${opts.prompt}`);
  console.log(
    `  ${color.dim("Mode:")}     ${opts.stream ? "streaming (TTFT enabled)" : "non-streaming"}`,
  );
  console.log(`  ${color.dim("Runs:")}     ${opts.runs} per model`);
  console.log(
    `  ${color.dim("Models:")}   ${models.length}${opts.free ? color.green(" (free only)") : ""}`,
  );
  // Spell out how the catalogue narrowed: "340 available → 12 free" is the only
  // way to tell "the filter is wrong" from "that is genuinely what is on offer".
  if (selection.funnel !== undefined) {
    console.log(`  ${color.dim("Selected:")} ${color.dim(selection.funnel)}`);
  }
  console.log(
    `  ${color.dim("Requests:")} ~${estimateRequests(models.length, opts)} total` +
      (opts.quality ? color.dim(` (incl. ${DEFAULT_TASKS.length}-task quality suite)`) : ""),
  );
  console.log();

  // ── Probe ────────────────────────────────────────────────────────────────────

  let dropped: ProbeResult[] = [];
  if (opts.probe) {
    const spinner = createSpinner(`Probing ${models.length} models…`);
    const summary = await probeModels(
      client,
      models,
      { retries: opts.retries, timeoutMs: Math.min(opts.timeoutMs, 20_000) },
      (result, index, total) => {
        spinner.update(`Probing ${index}/${total} — ${result.model.id}`);
      },
    );
    spinner.stop(`Probe complete (${summary.alive.length}/${models.length} reachable)`);
    printProbeSummary(summary.alive.length, summary.dead);
    models = summary.alive;
    dropped = summary.dead;
  }

  if (models.length === 0) {
    log.error("No reachable models left to benchmark.");
    process.exitCode = 1;
    return;
  }

  // ── Benchmark ────────────────────────────────────────────────────────────────

  console.log();
  const results: ModelBenchmarkResult[] = [];
  for (const modelDef of models) {
    const spinner = createSpinner(`Running benchmark for ${color.bold(modelDef.label)}`);
    let successCount = 0;

    const result = await benchmarkModel(
      client,
      modelDef,
      config,
      (run, r) => {
        if (!r.error) successCount++;
        const status =
          r.errorKind === undefined ? fmtMs(r.totalMs) : color.red(describeErrorKind(r.errorKind));

        if (run === opts.runs) {
          spinner.stop(
            `${color.bold(modelDef.label)} completed (${successCount}/${opts.runs} successful)`,
          );
        } else {
          spinner.log(`  ${color.dim(modelDef.label)} Run ${run}/${opts.runs} — ${status}`);
        }
      },
      (attempt, kind, delayMs) => {
        spinner.update(
          `${modelDef.label} — ${describeErrorKind(kind)}, retry ${attempt} in ${fmtMs(delayMs)}`,
        );
      },
    );
    results.push(result);
  }

  // ── Quality ──────────────────────────────────────────────────────────────────

  const quality = new Map<string, QualityResult>();
  if (opts.quality) {
    console.log();
    for (const modelDef of models) {
      const spinner = createSpinner(`Scoring ${color.bold(modelDef.label)}`);
      const result = await runQuality(
        client,
        modelDef,
        { retries: opts.retries, timeoutMs: opts.timeoutMs },
        (task, index, total) => {
          spinner.update(
            `${modelDef.label} — task ${index}/${total} ${task.passed ? "✓" : "✗"} ${task.taskId}`,
          );
        },
      );
      quality.set(modelDef.id, result);
      const passed = result.tasks.filter((t) => t.passed).length;
      spinner.stop(`${color.bold(modelDef.label)} scored ${passed}/${result.tasks.length} tasks`);
    }
  }

  printResults(results, quality);

  // ── Export ───────────────────────────────────────────────────────────────────

  if (opts.json !== undefined && opts.json !== "") {
    const report = buildReport(loadConfig().apiUrl, config, results, quality, dropped);
    try {
      const path = await writeReport(opts.json, report);
      log.success(`Report written to ${path}`);
    } catch (err) {
      log.error(`Could not write report: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log();
  }
}

// ── Interactive wizard ─────────────────────────────────────────────────────────

export async function runInteractive(): Promise<void> {
  p.intro(color.bgBlue(color.white(" OpenAI Benchmark ")));

  const client = await createClient();
  if (!client) {
    p.cancel("OPENAI_API_KEY is not set. Export it or add it to a .env file.");
    return;
  }

  const spinner = p.spinner();
  spinner.start("Fetching models from the API…");
  let available: ModelDef[];
  try {
    available = await fetchModels(client);
    spinner.stop(`Found ${available.length} models`);
  } catch (err) {
    spinner.stop("Failed to fetch models");
    p.cancel(`Could not list models: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (available.length === 0) {
    p.cancel("The API returned no models.");
    return;
  }

  const freeCount = available.filter((m) => m.isFree).length;
  const onlyFree = await p.confirm({
    initialValue: freeCount > 0,
    message: `Show only free models? (${freeCount} of ${available.length})`,
  });
  if (p.isCancel(onlyFree)) {
    p.cancel("Cancelled.");
    return;
  }

  const matchInput = await p.text({
    message: "Filter by name (regex, empty for all)",
    placeholder: "qwen|llama",
  });
  if (p.isCancel(matchInput)) {
    p.cancel("Cancelled.");
    return;
  }

  let candidates: ModelDef[];
  try {
    candidates = filterModels(available, { free: onlyFree, match: matchInput, textOnly: true });
  } catch (err) {
    p.cancel(err instanceof Error ? err.message : String(err));
    return;
  }

  if (candidates.length === 0) {
    p.cancel("No model matched that filter.");
    return;
  }

  const selectedModels = await p.multiselect<string>({
    message: `Select models to benchmark (${candidates.length} available, space to toggle)`,
    options: candidates.map((m) => ({
      hint: m.isFree
        ? "free"
        : m.pricingKnown
          ? `$${m.inputPricePer1M.toFixed(2)}/$${m.outputPricePer1M.toFixed(2)} per 1M`
          : "pricing n/a",
      label: m.id,
      value: m.id,
    })),
    required: true,
  });
  if (p.isCancel(selectedModels)) {
    p.cancel("Cancelled.");
    return;
  }

  const runsRaw = await p.text({
    initialValue: "3",
    message: "Number of runs per model",
    validate: (v) => (Number(v) > 0 ? undefined : "Must be > 0"),
  });
  if (p.isCancel(runsRaw)) {
    p.cancel("Cancelled.");
    return;
  }

  const promptInput = await p.text({
    initialValue: DEFAULT_PROMPT,
    message: "Prompt to benchmark",
  });
  if (p.isCancel(promptInput)) {
    p.cancel("Cancelled.");
    return;
  }

  const useStream = await p.confirm({
    initialValue: true,
    message: "Use streaming mode? (enables TTFT measurement)",
  });
  if (p.isCancel(useStream)) {
    p.cancel("Cancelled.");
    return;
  }

  const useQuality = await p.confirm({
    initialValue: onlyFree,
    message: `Run the quality suite? (${DEFAULT_TASKS.length} extra requests per model)`,
  });
  if (p.isCancel(useQuality)) {
    p.cancel("Cancelled.");
    return;
  }

  await runBenchmark({
    free: false,
    maxTokens: 256,
    models: selectedModels,
    probe: true,
    prompt: promptInput,
    quality: useQuality,
    query: [],
    retries: DEFAULT_RETRIES,
    runs: Number(runsRaw),
    stream: useStream,
    textOnly: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
}
