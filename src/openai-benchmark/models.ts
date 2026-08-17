import type OpenAI from "openai";

export interface ModelDef {
  id: string;
  label: string;
  /** USD per 1M input tokens (0 when the provider does not expose pricing) */
  inputPricePer1M: number;
  /** USD per 1M output tokens (0 when the provider does not expose pricing) */
  outputPricePer1M: number;
  /** Whether the provider returned usable pricing for this model */
  pricingKnown: boolean;
  /** Provider charges nothing for this model (OpenRouter ":free" variants) */
  isFree: boolean;
  /** Context window in tokens, when the provider reports one */
  contextLength?: number;
  /** Parameters/features the provider claims to support (may be inaccurate) */
  supportedParameters: string[];
  /**
   * Whether text is the model's *only* output modality. Generation models sit
   * in the same catalogue at zero cost — OpenRouter's Lyria reports
   * `output_modalities: ["text", "audio"]`, so "emits text" is not a strong
   * enough test to keep a music model out of a chat benchmark.
   */
  outputsTextOnly: boolean;
  /** Model advertises reasoning tokens, which eat into the output budget */
  hasReasoning: boolean;
  /** Model returns vectors, not text — driven through /embeddings, not /chat */
  isEmbedding: boolean;
}

/**
 * OpenRouter's /models defaults to `output_modalities=text`, so embedding
 * models are absent from the default catalogue entirely. Discovery has to ask
 * for them by name.
 */
export const EMBEDDING_QUERY: ModelQuery = { output_modalities: "embeddings" };

// OpenRouter (and some other OpenAI-compatible providers) include per-token
// pricing in their /models response. Plain OpenAI does not — pricing is then
// reported as unknown rather than guessed. The extra fields below are all
// optional: anything the provider omits simply degrades to a safe default.
export interface ApiModel {
  id: string;
  name?: string;
  pricing?: { prompt?: string | number; completion?: string | number; embedding?: string | number };
  is_free?: boolean;
  context_length?: number;
  supported_parameters?: string[];
  supported_features?: string[];
  supported_sampling_parameters?: string[];
  output_modalities?: string[];
  architecture?: { modality?: string; output_modalities?: string[] };
}

/** Extra query parameters forwarded verbatim to the provider's /models endpoint. */
export type ModelQuery = Record<string, string | number>;

export interface ModelFilter {
  /** Keep only models the provider does not charge for */
  free?: boolean;
  /** Case-insensitive regex matched against the model id and label */
  match?: string;
  /** Drop models that do not produce text (image/audio/music generators) */
  textOnly?: boolean;
  /** Keep only embedding models */
  embedding?: boolean;
  /** Keep at most this many models (applied last) */
  limit?: number;
}

/** Model counts surviving each filter stage, in the order they are applied. */
export interface FilterFunnel {
  total: number;
  afterFree: number;
  afterTextOnly: number;
  afterEmbedding: number;
  afterMatch: number;
  final: number;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Free detection trusts *declarations*, not zeros: an explicit `is_free` flag,
 * or the ":free" id suffix OpenRouter gives every free variant.
 *
 * A price of zero deliberately does not count. Catalogues use zero for two
 * different things — "this costs nothing" and "we publish no price for this"
 * (BYOK, self-hosted and routed entries) — and they are indistinguishable per
 * model. Reading zero as free let paid models through `--free`, which spends
 * real credit; missing a genuinely free model only shows fewer rows, and the
 * selection funnel says why.
 */
function detectFree(model: ApiModel): boolean {
  return model.is_free === true || model.id.endsWith(":free");
}

/**
 * Text-only output is the default assumption: a provider that reports no
 * modality at all (plain OpenAI) is a chat provider. Any declared output
 * modality besides text disqualifies the model — `["text", "audio"]` is a
 * music generator that happens to narrate, not a chat model.
 */
function detectTextOnlyOutput(model: ApiModel): boolean {
  const modalities = model.output_modalities ?? model.architecture?.output_modalities;
  if (modalities !== undefined && modalities.length > 0) {
    return modalities.every((m) => m === "text");
  }
  const modality = model.architecture?.modality;
  const output = modality?.split("->")[1];
  if (output !== undefined && output !== "") {
    return output.split("+").every((m) => m.trim() === "text");
  }
  return true;
}

const REASONING_PARAMS = ["reasoning", "include_reasoning", "reasoning_effort"];

function detectEmbedding(model: ApiModel): boolean {
  const modalities = model.output_modalities ?? model.architecture?.output_modalities;
  if (modalities !== undefined && modalities.includes("embeddings")) return true;
  const output = model.architecture?.modality?.split("->")[1];
  return output === undefined ? false : output.includes("embedding");
}

/**
 * Read one raw catalogue entry into the shape the rest of the code uses.
 *
 * Exported because the web UI's provider inspector shows the same facts in a
 * table: sharing the derivation is what keeps "is this model free" from having
 * two answers depending on which half of the tool you asked.
 */
export function toModelDef(model: ApiModel): ModelDef {
  const isEmbedding = detectEmbedding(model);
  const prompt = toNumber(model.pricing?.prompt ?? model.pricing?.embedding);
  // Embedding models bill input only, so an absent completion price is a real
  // zero rather than a gap. Reading it as unknown would leave every one of them
  // with pricingKnown false, and so no cost figure at all.
  const completion = isEmbedding
    ? (toNumber(model.pricing?.completion) ?? 0)
    : toNumber(model.pricing?.completion);
  const pricingKnown = prompt !== undefined && completion !== undefined;
  const supportedParameters = [
    ...(model.supported_parameters ?? []),
    ...(model.supported_features ?? []),
    ...(model.supported_sampling_parameters ?? []),
  ];
  return {
    contextLength: model.context_length,
    hasReasoning: supportedParameters.some((p) => REASONING_PARAMS.includes(p)),
    id: model.id,
    inputPricePer1M: (prompt ?? 0) * 1_000_000,
    isEmbedding,
    isFree: detectFree(model),
    label: model.name ?? model.id,
    outputPricePer1M: (completion ?? 0) * 1_000_000,
    outputsTextOnly: detectTextOnlyOutput(model),
    pricingKnown,
    supportedParameters,
  };
}

/**
 * Fetch the provider's available models from the API, sorted by id.
 *
 * `query` is passed straight through to the endpoint, which lets provider
 * specific filters be used without teaching this module about them — e.g.
 * OpenRouter's `max_price=0` or `sort=latency-low-to-high`. Providers that do
 * not understand a parameter ignore it, so the client-side filters below stay
 * the portable path.
 */
export async function fetchModels(client: OpenAI, query?: ModelQuery): Promise<ModelDef[]> {
  const hasQuery = query !== undefined && Object.keys(query).length > 0;
  const page = await client.models.list(hasQuery ? { query } : undefined);
  const models = (page.data as unknown as ApiModel[]).map(toModelDef);
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

/** Parse `key=value` CLI entries into a query object, coercing numeric values. */
export function parseModelQuery(entries: string[]): ModelQuery {
  const query: ModelQuery = {};
  for (const entry of entries) {
    const idx = entry.indexOf("=");
    if (idx <= 0) {
      throw new Error(`Invalid --query entry "${entry}" — expected key=value`);
    }
    const key = entry.slice(0, idx).trim();
    const raw = entry.slice(idx + 1).trim();
    const n = Number(raw);
    query[key] = raw !== "" && Number.isFinite(n) ? n : raw;
  }
  return query;
}

/**
 * Filter the catalogue, reporting how many models survived each stage. An
 * empty result is otherwise indistinguishable between "nothing is free" and
 * "nothing matched the name" — which is exactly what you need to know when
 * combining filters.
 */
export function filterModelsVerbose(
  models: ModelDef[],
  filter: ModelFilter,
): { models: ModelDef[]; funnel: FilterFunnel } {
  let out = models;

  if (filter.free === true) {
    out = out.filter((m) => m.isFree);
  }
  const afterFree = out.length;

  if (filter.textOnly === true) {
    out = out.filter((m) => m.outputsTextOnly);
  }
  const afterTextOnly = out.length;

  if (filter.embedding === true) {
    out = out.filter((m) => m.isEmbedding);
  }
  const afterEmbedding = out.length;

  if (filter.match !== undefined && filter.match !== "") {
    let re: RegExp;
    try {
      re = new RegExp(filter.match, "i");
    } catch {
      throw new Error(`Invalid --match pattern: ${filter.match}`);
    }
    out = out.filter((m) => re.test(m.id) || re.test(m.label));
  }
  const afterMatch = out.length;

  if (filter.limit !== undefined && filter.limit > 0) {
    out = out.slice(0, filter.limit);
  }

  return {
    funnel: {
      afterEmbedding,
      afterFree,
      afterMatch,
      afterTextOnly,
      final: out.length,
      total: models.length,
    },
    models: out,
  };
}

export function filterModels(models: ModelDef[], filter: ModelFilter): ModelDef[] {
  return filterModelsVerbose(models, filter).models;
}

/** Explain an empty (or narrowed) filter result in one line. */
export function explainFunnel(funnel: FilterFunnel, filter: ModelFilter): string {
  const stages: string[] = [`${funnel.total} available`];
  if (filter.free === true) stages.push(`${funnel.afterFree} free`);
  if (filter.textOnly === true) stages.push(`${funnel.afterTextOnly} text-only`);
  if (filter.embedding === true) stages.push(`${funnel.afterEmbedding} embedding`);
  if (filter.match !== undefined && filter.match !== "") {
    stages.push(`${funnel.afterMatch} matching /${filter.match}/i`);
  }
  return stages.join(" → ");
}

export function getModel(id: string, from: ModelDef[]): ModelDef | undefined {
  return from.find((m) => m.id === id);
}

/** A model id we were handed but the provider never listed — benchmark it blind. */
export function unknownModel(id: string): ModelDef {
  return {
    hasReasoning: false,
    id,
    inputPricePer1M: 0,
    isEmbedding: false,
    isFree: id.endsWith(":free"),
    label: id,
    outputPricePer1M: 0,
    outputsTextOnly: true,
    pricingKnown: false,
    supportedParameters: [],
  };
}

export function estimateCost(model: ModelDef, inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * model.inputPricePer1M +
    (outputTokens / 1_000_000) * model.outputPricePer1M
  );
}
