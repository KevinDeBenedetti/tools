import * as p from "@clack/prompts";
import OpenAI from "openai";
import color from "picocolors";
import { log } from "../shared/ui";
import { benchmarkModel } from "./benchmark";
import { loadConfig } from "./config";
import { DEFAULT_MODEL_IDS, MODELS } from "./models";
import { createSpinner, fmtMs, printResults } from "./reporter";

export const DEFAULT_PROMPT =
  "Explain the difference between concurrency and parallelism in 3 sentences.";

export interface BenchmarkRunOptions {
  models: string[];
  runs: number;
  prompt: string;
  maxTokens: number;
  stream: boolean;
}

// ── Core runner ────────────────────────────────────────────────────────────────

export async function runBenchmark(opts: BenchmarkRunOptions): Promise<void> {
  const benchmarkConfig = loadConfig();

  if (!benchmarkConfig.apiKey) {
    log.error("OPENAI_API_KEY is not set. Export it or add it to a .env file.");
    process.exitCode = 1;
    return;
  }

  const client = new OpenAI({
    apiKey: benchmarkConfig.apiKey,
    baseURL: benchmarkConfig.apiUrl,
  });
  const config = {
    maxTokens: opts.maxTokens,
    prompt: opts.prompt,
    runs: opts.runs,
    stream: opts.stream,
  };

  console.log(`\n  ${color.dim("Prompt:")} ${opts.prompt}`);
  console.log(
    `  ${color.dim("Mode:")}   ${opts.stream ? "streaming (TTFT enabled)" : "non-streaming"}`,
  );
  console.log(`  ${color.dim("Runs:")}   ${opts.runs} per model\n`);

  const startSpinner = createSpinner("Initializing benchmark...");
  setTimeout(() => startSpinner.stop("Benchmark initialized"), 200);

  const results = [];
  for (const modelId of opts.models) {
    const modelDef =
      benchmarkConfig.models.find((m) => m.id === modelId) ?? MODELS.find((m) => m.id === modelId);
    if (!modelDef) {
      log.error(`Unknown model: ${modelId}. Check your benchmark.config.json.`);
      continue;
    }
    const modelSpinner = createSpinner(`Running benchmark for ${color.bold(modelDef.label)}`);
    let successCount = 0;

    const result = await benchmarkModel(client, modelDef, config, (run, r) => {
      if (!r.error) successCount++;
      const statusMsg = r.error
        ? `Run ${run}/${opts.runs} — ${color.red("Error")}`
        : `Run ${run}/${opts.runs} — ${fmtMs(r.totalMs)}`;

      if (run === opts.runs) {
        modelSpinner.stop(
          `${color.bold(modelDef.label)} completed (${successCount}/${opts.runs} successful)`,
        );
      } else {
        modelSpinner.log(`  ${color.dim(modelDef.label)} ${statusMsg}`);
      }
    });
    results.push(result);
  }

  printResults(results);
}

// ── Interactive wizard ─────────────────────────────────────────────────────────

export async function runInteractive(): Promise<void> {
  p.intro(color.bgBlue(color.white(" OpenAI Benchmark ")));

  const modelOptions = MODELS.map((m) => ({
    hint: `$${m.inputPricePer1M}/$${m.outputPricePer1M} per 1M tokens`,
    label: m.label,
    value: m.id,
  }));

  const selectedModels = await p.multiselect<string>({
    initialValues: DEFAULT_MODEL_IDS,
    message: "Select models to benchmark",
    options: modelOptions,
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

  await runBenchmark({
    maxTokens: 256,
    models: selectedModels,
    prompt: promptInput,
    runs: Number(runsRaw),
    stream: useStream,
  });
}
