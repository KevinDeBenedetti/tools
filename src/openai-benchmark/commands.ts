import type { CommandGroup, CommandSpec } from "../cli/types";
import { table } from "../shared/ui";
import { DEFAULT_MODEL_IDS, MODELS } from "./models";

// OpenAI client and config load lazily inside run() so listing commands or
// printing help never requires an API key or a .env file.

const run: CommandSpec = {
  description: "Benchmark models on latency, TTFT, throughput, and cost",
  flags: [
    {
      default: DEFAULT_MODEL_IDS,
      description: "Comma-separated model IDs",
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
      models: options["models"] as string[],
      prompt: (options["prompt"] as string | undefined) ?? DEFAULT_PROMPT,
      runs: options["runs"] as number,
      stream: options["stream"] !== false,
    });
  },
};

const models: CommandSpec = {
  description: "List available models with pricing (built-in + benchmark.config.json)",
  flags: [],
  name: "models",
  async run() {
    const { loadConfig } = await import("./config");
    let configured: typeof MODELS = [];
    try {
      configured = loadConfig().models;
    } catch {
      // No .env / config file — built-in models only
    }
    const all = [...configured, ...MODELS.filter((m) => !configured.some((c) => c.id === m.id))];
    table(
      [
        { label: "Model" },
        { label: "Label" },
        { align: "right", label: "$/1M in" },
        { align: "right", label: "$/1M out" },
        { label: "Default" },
      ],
      all.map((m) => [
        m.id,
        m.label,
        String(m.inputPricePer1M),
        String(m.outputPricePer1M),
        DEFAULT_MODEL_IDS.includes(m.id) ? "✓" : "",
      ]),
    );
  },
};

export const benchmarkGroup: CommandGroup = {
  commands: [run, models],
  description: "Benchmark OpenAI-compatible models — latency, TTFT, throughput, cost",
  name: "benchmark",
};
