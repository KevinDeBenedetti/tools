import color from "picocolors";
import { log } from "../shared/ui";
import { createClient, loadConfig } from "./config";
import { DEFAULT_RETRIEVAL_CASES } from "./embed-tasks";
import {
  benchmarkEmbeddingModel,
  type EmbeddingBenchmarkResult,
  type EmbeddingConfig,
  type EmbedProbeResult,
  type InputTypeVariant,
  probeEmbeddingModels,
} from "./embeddings";
import { buildEmbeddingReport, writeReport } from "./export";
import {
  EMBEDDING_QUERY,
  explainFunnel,
  fetchModels,
  filterModelsVerbose,
  getModel,
  type ModelDef,
  parseModelQuery,
  unknownModel,
} from "./models";
import {
  createSpinner,
  describeError,
  describeErrorKind,
  fmtMs,
  printEmbeddingResults,
} from "./reporter";
import { flattenCases, type RetrievalResult, runRetrieval } from "./retrieval";

/**
 * Batch used for the latency measurement. Short, realistic sentences rather
 * than one long blob: throughput per text is what an indexing job actually
 * cares about, and a single huge input would measure something else.
 */
export const DEFAULT_EMBED_BATCH: string[] = [
  "The quarterly report shows a modest increase in recurring revenue.",
  "Preheat the oven to 200 degrees and line a tray with baking paper.",
  "The library closes at eight on weekdays and at five on Saturdays.",
  "Distributed systems fail in ways that are hard to reproduce locally.",
  "She cycled along the canal until the path turned to gravel.",
  "Refunds are processed within ten business days of approval.",
  "The compiler rejects the program because the lifetime is too short.",
  "Migratory birds navigate using a combination of stars and magnetism.",
];

export interface EmbedRunOptions {
  models: string[];
  runs: number;
  free: boolean;
  match?: string;
  limit?: number;
  query: string[];
  probe: boolean;
  quality: boolean;
  /** Negotiate a query/document input_type during the probe */
  inputType: boolean;
  timeoutMs: number;
  retries: number;
  dimensions?: number;
  json?: string;
}

async function selectEmbeddingModels(
  client: Parameters<typeof fetchModels>[0],
  opts: EmbedRunOptions,
): Promise<ModelDef[] | null> {
  // Merge the caller's query over the embedding one so an explicit --query can
  // still override the modality (e.g. output_modalities=all).
  const query = { ...EMBEDDING_QUERY, ...parseModelQuery(opts.query) };

  let available: ModelDef[] = [];
  try {
    available = await fetchModels(client, query);
  } catch (err) {
    log.warn(`Could not fetch model metadata: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (opts.models.length > 0) {
    return opts.models.map((id) => getModel(id, available) ?? unknownModel(id));
  }

  const filter = {
    embedding: true,
    free: opts.free,
    ...(opts.match === undefined ? {} : { match: opts.match }),
    ...(opts.limit === undefined ? {} : { limit: opts.limit }),
  };
  const { funnel, models } = filterModelsVerbose(available, filter);

  if (models.length === 0) {
    if (available.length === 0) {
      log.error(
        "The provider returned no embedding models. Pass --models <id,id>, or check that it exposes /embeddings.",
      );
    } else {
      log.error(`No model matched: ${explainFunnel(funnel, filter)}`);
      log.step(
        "List what is on offer with: bun run benchmark models --query output_modalities=embeddings",
      );
    }
    return null;
  }

  return models;
}

export async function runEmbedBenchmark(opts: EmbedRunOptions): Promise<void> {
  const client = await createClient();
  if (!client) {
    log.error("OPENAI_API_KEY is not set. Export it or add it to a .env file.");
    process.exitCode = 1;
    return;
  }

  let selection: ModelDef[] | null;
  try {
    selection = await selectEmbeddingModels(client, opts);
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  if (selection === null) {
    process.exitCode = 1;
    return;
  }

  let models = selection;

  const config: EmbeddingConfig = {
    retries: opts.retries,
    runs: opts.runs,
    texts: DEFAULT_EMBED_BATCH,
    timeoutMs: opts.timeoutMs,
    ...(opts.dimensions === undefined ? {} : { dimensions: opts.dimensions }),
  };

  // The retrieval suite is one batched request per model, whatever its size.
  const suiteTexts = flattenCases(DEFAULT_RETRIEVAL_CASES).length;
  const perModel = (opts.probe ? 1 : 0) + opts.runs + (opts.quality ? 1 : 0);

  console.log(`\n  ${color.dim("Batch:")}     ${DEFAULT_EMBED_BATCH.length} texts per run`);
  console.log(`  ${color.dim("Runs:")}      ${opts.runs} per model`);
  console.log(
    `  ${color.dim("Models:")}    ${models.length}${opts.free ? color.green(" (free only)") : ""}`,
  );
  console.log(
    `  ${color.dim("Requests:")}  ~${models.length * perModel} total` +
      (opts.quality
        ? color.dim(
            ` (retrieval suite: ${DEFAULT_RETRIEVAL_CASES.length} cases, ${suiteTexts} texts)`,
          )
        : ""),
  );
  console.log();

  let dropped: EmbedProbeResult[] = [];
  let inputTypes = new Map<string, InputTypeVariant>();
  if (opts.probe) {
    const spinner = createSpinner(`Probing ${models.length} models…`);
    const summary = await probeEmbeddingModels(
      client,
      models,
      {
        negotiateInputType: opts.inputType,
        retries: opts.retries,
        timeoutMs: Math.min(opts.timeoutMs, 20_000),
      },
      (result, index, total) => spinner.update(`Probing ${index}/${total} — ${result.model.id}`),
    );
    spinner.stop(`Probe complete (${summary.alive.length}/${models.length} reachable)`);

    if (summary.dead.length > 0) {
      log.warn(`${summary.dead.length} model(s) dropped — no usable response:`);
      for (const result of summary.dead) {
        log.step(`${result.model.id} — ${describeError(result.error)}`);
      }
    }
    for (const [modelId, variant] of summary.inputTypes) {
      log.info(`${modelId} — asymmetric, encoding as ${variant.query}/${variant.document}`);
    }
    models = summary.alive;
    dropped = summary.dead;
    inputTypes = summary.inputTypes;
  }

  if (models.length === 0) {
    log.error("No reachable embedding models left to benchmark.");
    process.exitCode = 1;
    return;
  }

  console.log();
  const results: EmbeddingBenchmarkResult[] = [];
  for (const modelDef of models) {
    const spinner = createSpinner(`Embedding with ${color.bold(modelDef.label)}`);
    let successCount = 0;

    const result = await benchmarkEmbeddingModel(client, modelDef, config, (run, r) => {
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
    });
    results.push(result);
  }

  const retrieval = new Map<string, RetrievalResult>();
  if (opts.quality) {
    console.log();
    for (const modelDef of models) {
      const spinner = createSpinner(`Scoring retrieval for ${color.bold(modelDef.label)}`);
      const variant = inputTypes.get(modelDef.id);
      const result = await runRetrieval(client, modelDef, {
        retries: opts.retries,
        timeoutMs: opts.timeoutMs,
        ...(opts.dimensions === undefined ? {} : { dimensions: opts.dimensions }),
        ...(variant === undefined ? {} : { inputType: variant }),
      });
      retrieval.set(modelDef.id, result);
      spinner.stop(
        result.error === undefined
          ? `${color.bold(modelDef.label)} ranked ${result.cases.filter((c) => c.passed).length}/${result.cases.length} correctly`
          : `${color.bold(modelDef.label)} — retrieval failed`,
      );
    }
  }

  printEmbeddingResults(results, retrieval, inputTypes);

  if (opts.json !== undefined && opts.json !== "") {
    const report = buildEmbeddingReport(loadConfig().apiUrl, config, results, retrieval, dropped);
    try {
      const path = await writeReport(opts.json, report);
      log.success(`Report written to ${path}`);
    } catch (err) {
      log.error(`Could not write report: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log();
  }
}
