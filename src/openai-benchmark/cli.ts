import * as p from "@clack/prompts";
import color from "picocolors";
import OpenAI from "openai";
import { benchmarkModel } from "./benchmark";
import { loadConfig } from "./config";
import { DEFAULT_MODEL_IDS, MODELS } from "./models";
import { printResults, createSpinner, fmtMs } from "./reporter";
import { log } from "../shared/ui";

const DEFAULT_PROMPT = "Explain the difference between concurrency and parallelism in 3 sentences.";

// ── Arg parsing ────────────────────────────────────────────────────────────────

interface CliArgs {
  models: string[];
  runs: number;
  maxTokens: number;
  prompt: string;
  stream: boolean;
  noStream: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    help: false,
    maxTokens: 256,
    models: [],
    noStream: false,
    prompt: DEFAULT_PROMPT,
    runs: 3,
    stream: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--stream") {
      args.stream = true;
    } else if (arg === "--no-stream") {
      args.noStream = true;
    } else if (arg === "--runs" || arg === "-n") {
      args.runs = Number(argv[++i]) || 3;
    } else if (arg === "--max-tokens") {
      args.maxTokens = Number(argv[++i]) || 256;
    } else if (arg === "--prompt" || arg === "-p") {
      args.prompt = argv[++i] ?? DEFAULT_PROMPT;
    } else if (arg === "--models" || arg === "-m") {
      args.models = (argv[++i] ?? "").split(",").filter(Boolean);
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
${color.bold("openai-benchmark")} — Compare OpenAI models on latency, throughput, and cost

${color.bold("Usage:")}
  bun run benchmark [options]

${color.bold("Options:")}
  -m, --models <ids>       Comma-separated model IDs (default: ${DEFAULT_MODEL_IDS.join(",")})
  -n, --runs <n>           Runs per model (default: 3)
  -p, --prompt <text>      Prompt to use for benchmarking
      --max-tokens <n>     Max output tokens (default: 256)
      --stream             Force streaming mode (measures TTFT)
      --no-stream          Force non-streaming mode
  -h, --help               Show this help

${color.bold("Available models:")}
${MODELS.map((m) => `  ${m.id.padEnd(18)} ${m.label}`).join("\n")}

${color.bold("Configuration:")}
  1. Create a .env file with:
     - OPENAI_API_KEY (required)
     - OPENAI_BASE_URL (optional, defaults to https://api.openai.com/v1)

  2. Create a benchmark.config.json file to customize models:
     - models: Array of model definitions
     - defaultModelIds: Default models to benchmark

${color.bold("Environment:")}
  OPENAI_API_KEY           Required. Your API key.
  OPENAI_BASE_URL          Optional. Custom API endpoint.

${color.bold("Config file example:")}
  {
    "models": [
      { "id": "gpt-4o", "label": "GPT-4o", "inputPricePer1M": 2.5, "outputPricePer1M": 10 },
      { "id": "my-model", "label": "My Model", "inputPricePer1M": 1, "outputPricePer1M": 3 }
    ],
    "defaultModelIds": ["gpt-4o", "my-model"]
  }
`);
}

// ── Interactive mode ───────────────────────────────────────────────────────────

async function runInteractive(): Promise<void> {
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
    models: selectedModels,
    maxTokens: 256,
    prompt: promptInput,
    runs: Number(runsRaw),
    stream: useStream,
  });
}

// ── Core runner ────────────────────────────────────────────────────────────────

async function runBenchmark(opts: {
  models: string[];
  runs: number;
  prompt: string;
  maxTokens: number;
  stream: boolean;
}): Promise<void> {
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

// ── Entry point ────────────────────────────────────────────────────────────────

export async function runOpenAIBenchmarkCli(
  argv: string[] = [],
  interactive = false,
): Promise<void> {
  if (interactive) {
    await runInteractive();
    return;
  }

  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    return;
  }

  const models = args.models.length > 0 ? args.models : DEFAULT_MODEL_IDS;
  const stream = !args.noStream;

  await runBenchmark({
    maxTokens: args.maxTokens,
    models,
    prompt: args.prompt,
    runs: args.runs,
    stream,
  });
}

if (import.meta.main) {
  try {
    await runOpenAIBenchmarkCli(process.argv.slice(2));
  } catch (err) {
    console.error(color.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}
