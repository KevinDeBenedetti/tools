import * as p from "@clack/prompts";
import color from "picocolors";
import { log } from "../shared/ui";
import { benchmarkModel } from "./benchmark";
import { createClient } from "./config";
import { fetchModels, getModel, type ModelDef } from "./models";
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
  const client = await createClient();
  if (!client) {
    log.error("OPENAI_API_KEY is not set. Export it or add it to a .env file.");
    process.exitCode = 1;
    return;
  }

  if (opts.models.length === 0) {
    log.error("No models selected. Pass --models <id,id> or use the interactive menu.");
    process.exitCode = 1;
    return;
  }

  // Pull pricing/labels from the API; benchmarking still works if this fails.
  let available: ModelDef[] = [];
  try {
    available = await fetchModels(client);
  } catch (err) {
    log.warn(`Could not fetch model metadata: ${err instanceof Error ? err.message : String(err)}`);
  }

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
    // Unknown to /models? Still benchmark it, just without pricing.
    const modelDef: ModelDef = getModel(modelId, available) ?? {
      id: modelId,
      inputPricePer1M: 0,
      label: modelId,
      outputPricePer1M: 0,
      pricingKnown: false,
    };
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

  const modelOptions = available.map((m) => ({
    hint: m.pricingKnown
      ? `$${m.inputPricePer1M.toFixed(2)}/$${m.outputPricePer1M.toFixed(2)} per 1M`
      : "pricing n/a",
    label: m.id,
    value: m.id,
  }));

  const selectedModels = await p.multiselect<string>({
    message: "Select models to benchmark (space to toggle)",
    options: modelOptions,
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

  await runBenchmark({
    maxTokens: 256,
    models: selectedModels,
    prompt: promptInput,
    runs: Number(runsRaw),
    stream: useStream,
  });
}
