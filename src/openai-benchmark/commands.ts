import type { CommandGroup, CommandSpec, FlagSpec } from "../cli/types";
import { log, table } from "../shared/ui";

// OpenAI client and config load lazily inside run() so listing commands or
// printing help never requires an API key or a .env file. Models (and pricing,
// when the provider exposes it) come from the API's /models endpoint.

// Shared by `run` and `models`: how a subset of the catalogue is picked.
const discoveryFlags: FlagSpec[] = [
  {
    default: false,
    description: "Only models the provider charges nothing for",
    name: "free",
    type: "boolean",
  },
  {
    description: "Filter model id/label by regex (case-insensitive)",
    name: "match",
    type: "string",
  },
  { description: "Keep at most N models", name: "limit", type: "number" },
  {
    description: "Keep only text-only models (excludes image/audio generators)",
    name: "textOnly",
    type: "boolean",
  },
  {
    description: "Extra key=value passed to /models (e.g. sort=latency-low-to-high)",
    name: "query",
    type: "string[]",
  },
];

const run: CommandSpec = {
  description: "Benchmark models on latency, TTFT, throughput, quality, and cost",
  flags: [
    {
      description: "Comma-separated model IDs (omit to select via --free/--match)",
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
    ...discoveryFlags,
    {
      default: true,
      description: "Drop unreachable models with one tiny request first; --probe=false to skip",
      name: "probe",
      type: "boolean",
    },
    {
      default: false,
      description: "Score instruction-following and probe tool/JSON support",
      name: "quality",
      type: "boolean",
    },
    { default: 60000, description: "Per-request timeout in ms", name: "timeout", type: "number" },
    {
      default: 2,
      description: "Retries on rate limits and transient errors",
      name: "retries",
      type: "number",
    },
    { description: "Write a JSON snapshot of the run to this path", name: "json", type: "string" },
  ],
  async interactive() {
    const { runInteractive } = await import("./run");
    await runInteractive();
  },
  name: "run",
  async run(options) {
    const { DEFAULT_PROMPT, runBenchmark } = await import("./run");
    const match = options["match"] as string | undefined;
    const limit = options["limit"] as number | undefined;
    const json = options["json"] as string | undefined;

    await runBenchmark({
      free: options["free"] === true,
      ...(json === undefined ? {} : { json }),
      ...(limit === undefined ? {} : { limit }),
      ...(match === undefined ? {} : { match }),
      // Benchmarking an image or music model through chat completions is
      // meaningless, so discovery excludes them unless asked otherwise.
      textOnly: options["textOnly"] !== false,
      maxTokens: options["maxTokens"] as number,
      models: (options["models"] as string[] | undefined) ?? [],
      probe: options["probe"] !== false,
      prompt: (options["prompt"] as string | undefined) ?? DEFAULT_PROMPT,
      quality: options["quality"] === true,
      query: (options["query"] as string[] | undefined) ?? [],
      retries: options["retries"] as number,
      runs: options["runs"] as number,
      stream: options["stream"] !== false,
      timeoutMs: options["timeout"] as number,
    });
  },
};

const models: CommandSpec = {
  description: "List available models from the API (with pricing when exposed)",
  flags: [
    ...discoveryFlags,
    {
      default: false,
      description: "List embedding models instead of text models",
      name: "embedding",
      type: "boolean",
    },
  ],
  name: "models",
  async run(options) {
    const { createClient } = await import("./config");
    const client = await createClient();
    if (!client) {
      log.error("OPENAI_API_KEY is not set. Export it or add it to a .env file.");
      process.exitCode = 1;
      return;
    }

    const { EMBEDDING_QUERY, explainFunnel, fetchModels, filterModelsVerbose, parseModelQuery } =
      await import("./models");
    const match = options["match"] as string | undefined;
    const limit = options["limit"] as number | undefined;
    const embedding = options["embedding"] === true;

    // Listing shows the catalogue as-is; only `run` defaults to text-only.
    const filter = {
      embedding,
      free: options["free"] === true,
      textOnly: options["textOnly"] === true,
      ...(match === undefined ? {} : { match }),
      ...(limit === undefined ? {} : { limit }),
    };

    let all: Awaited<ReturnType<typeof fetchModels>>;
    let shown: typeof all;
    let funnel: ReturnType<typeof filterModelsVerbose>["funnel"];
    try {
      // /models defaults to text-output models, so embedding models have to be
      // asked for explicitly before any client-side filter can see them.
      const query = {
        ...(embedding ? EMBEDDING_QUERY : {}),
        ...parseModelQuery((options["query"] as string[]) ?? []),
      };
      all = await fetchModels(client, query);
      ({ funnel, models: shown } = filterModelsVerbose(all, filter));
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
      return;
    }

    if (all.length === 0) {
      log.info("The API returned no models.");
      return;
    }
    if (shown.length === 0) {
      log.info(`No model matched: ${explainFunnel(funnel, filter)}`);
      return;
    }

    table(
      [
        { label: "Model" },
        { label: "Label" },
        { align: "right", label: "Context" },
        { align: "right", label: "$/1M in" },
        { align: "right", label: "$/1M out" },
      ],
      shown.map((m) => [
        m.id,
        m.label,
        m.contextLength === undefined ? "—" : m.contextLength.toLocaleString("en-US"),
        m.isFree ? "free" : m.pricingKnown ? m.inputPricePer1M.toFixed(2) : "—",
        m.isFree ? "free" : m.pricingKnown ? m.outputPricePer1M.toFixed(2) : "—",
      ]),
    );
    log.blank();
    const scope =
      shown.length === all.length ? `${all.length} models` : `${shown.length}/${all.length} models`;
    log.info(`${scope}. Benchmark with: bun run benchmark --models <id,id>`);
  },
};

const embed: CommandSpec = {
  description: "Benchmark embedding models on retrieval quality, latency, and dimensions",
  flags: [
    {
      description: "Comma-separated model IDs (omit to select via --free/--match)",
      name: "models",
      type: "string[]",
    },
    { default: 3, description: "Runs per model", name: "runs", type: "number" },
    {
      default: false,
      description: "Only models the provider charges nothing for",
      name: "free",
      type: "boolean",
    },
    {
      description: "Filter model id/label by regex (case-insensitive)",
      name: "match",
      type: "string",
    },
    { description: "Keep at most N models", name: "limit", type: "number" },
    {
      description: "Extra key=value passed to /models (overrides output_modalities)",
      name: "query",
      type: "string[]",
    },
    {
      default: true,
      description: "Drop unreachable models with one tiny request first; --probe=false to skip",
      name: "probe",
      type: "boolean",
    },
    {
      default: true,
      description: "Score retrieval on a hard-negative suite; --quality=false to skip",
      name: "quality",
      type: "boolean",
    },
    {
      description: "Request a specific vector width, when the model supports it",
      name: "dimensions",
      type: "number",
    },
    {
      default: true,
      description:
        "Detect a query/passage input_type and encode asymmetrically; --input-type=false to skip",
      name: "inputType",
      type: "boolean",
    },
    { default: 60000, description: "Per-request timeout in ms", name: "timeout", type: "number" },
    {
      default: 2,
      description: "Retries on rate limits and transient errors",
      name: "retries",
      type: "number",
    },
    { description: "Write a JSON snapshot of the run to this path", name: "json", type: "string" },
  ],
  name: "embed",
  async run(options) {
    const { runEmbedBenchmark } = await import("./run-embed");
    const match = options["match"] as string | undefined;
    const limit = options["limit"] as number | undefined;
    const json = options["json"] as string | undefined;
    const dimensions = options["dimensions"] as number | undefined;

    await runEmbedBenchmark({
      ...(dimensions === undefined ? {} : { dimensions }),
      free: options["free"] === true,
      ...(json === undefined ? {} : { json }),
      ...(limit === undefined ? {} : { limit }),
      ...(match === undefined ? {} : { match }),
      inputType: options["inputType"] !== false,
      models: (options["models"] as string[] | undefined) ?? [],
      probe: options["probe"] !== false,
      quality: options["quality"] !== false,
      query: (options["query"] as string[] | undefined) ?? [],
      retries: options["retries"] as number,
      runs: options["runs"] as number,
      timeoutMs: options["timeout"] as number,
    });
  },
};

export const benchmarkGroup: CommandGroup = {
  commands: [run, embed, models],
  description: "Benchmark OpenAI-compatible models — latency, TTFT, throughput, quality, cost",
  name: "benchmark",
};
