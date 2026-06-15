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
}

// OpenRouter (and some other OpenAI-compatible providers) include per-token
// pricing in their /models response. Plain OpenAI does not — pricing is then
// reported as unknown rather than guessed.
interface ApiModel {
  id: string;
  name?: string;
  pricing?: { prompt?: string | number; completion?: string | number };
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

function toModelDef(model: ApiModel): ModelDef {
  const prompt = toNumber(model.pricing?.prompt);
  const completion = toNumber(model.pricing?.completion);
  const pricingKnown = prompt !== undefined && completion !== undefined;
  return {
    id: model.id,
    inputPricePer1M: (prompt ?? 0) * 1_000_000,
    label: model.name ?? model.id,
    outputPricePer1M: (completion ?? 0) * 1_000_000,
    pricingKnown,
  };
}

/** Fetch the provider's available models from the API, sorted by id. */
export async function fetchModels(client: OpenAI): Promise<ModelDef[]> {
  const page = await client.models.list();
  const models = (page.data as unknown as ApiModel[]).map(toModelDef);
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

export function getModel(id: string, from: ModelDef[]): ModelDef | undefined {
  return from.find((m) => m.id === id);
}

export function estimateCost(model: ModelDef, inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * model.inputPricePer1M +
    (outputTokens / 1_000_000) * model.outputPricePer1M
  );
}
