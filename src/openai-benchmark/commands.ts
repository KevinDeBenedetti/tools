import type { CommandGroup, CommandSpec } from "../cli/types";
import { log, table } from "../shared/ui";

// OpenAI client and config load lazily inside run() so listing commands or
// printing help never requires an API key or a .env file. Models (and pricing,
// when the provider exposes it) come from the API's /models endpoint.

const run: CommandSpec = {
  description: "Benchmark models on latency, TTFT, throughput, and cost",
  flags: [
    {
      description: "Comma-separated model IDs (omit to pick interactively)",
      name: "models",
      type: "string[]",
    },
    { default: 3, description: "Runs per model", name: "runs", type: "number" },
    { default: 256, description: "Max output tokens", name: "maxTokens", type: "number" },
    { description: "Prompt to benchmark with", name: "prompt", type: "string" },
    {
      default: true,
      description: "Streaming mode (measures TTFT); --stream=false to disable",
      name: "stream",
      type: "boolean",
    },
  ],
  async interactive() {
    const { runInteractive } = await import("./run");
    await runInteractive();
  },
  name: "run",
  async run(options) {
    const { DEFAULT_PROMPT, runBenchmark } = await import("./run");
    await runBenchmark({
      maxTokens: options["maxTokens"] as number,
      models: (options["models"] as string[] | undefined) ?? [],
      prompt: (options["prompt"] as string | undefined) ?? DEFAULT_PROMPT,
      runs: options["runs"] as number,
      stream: options["stream"] !== false,
    });
  },
};

const models: CommandSpec = {
  description: "List available models from the API (with pricing when exposed)",
  flags: [],
  name: "models",
  async run() {
    const { createClient } = await import("./config");
    const client = await createClient();
    if (!client) {
      log.error("OPENAI_API_KEY is not set. Export it or add it to a .env file.");
      process.exitCode = 1;
      return;
    }

    const { fetchModels } = await import("./models");
    const all = await fetchModels(client);
    if (all.length === 0) {
      log.info("The API returned no models.");
      return;
    }

    table(
      [
        { label: "Model" },
        { label: "Label" },
        { align: "right", label: "$/1M in" },
        { align: "right", label: "$/1M out" },
      ],
      all.map((m) => [
        m.id,
        m.label,
        m.pricingKnown ? m.inputPricePer1M.toFixed(2) : "—",
        m.pricingKnown ? m.outputPricePer1M.toFixed(2) : "—",
      ]),
    );
    log.blank();
    log.info(`${all.length} models. Benchmark with: bun run benchmark --models <id,id>`);
  },
};

export const benchmarkGroup: CommandGroup = {
  commands: [run, models],
  description: "Benchmark OpenAI-compatible models — latency, TTFT, throughput, cost",
  name: "benchmark",
};
