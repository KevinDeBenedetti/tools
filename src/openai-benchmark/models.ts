export interface ModelDef {
  id: string;
  label: string;
  /** USD per 1M input tokens */
  inputPricePer1M: number;
  /** USD per 1M output tokens */
  outputPricePer1M: number;
}

export const MODELS: ModelDef[] = [
  { id: "gpt-4o", label: "GPT-4o", inputPricePer1M: 2.5, outputPricePer1M: 10.0 },
  { id: "gpt-4o-mini", label: "GPT-4o mini", inputPricePer1M: 0.15, outputPricePer1M: 0.6 },
  { id: "gpt-4.1", label: "GPT-4.1", inputPricePer1M: 2.0, outputPricePer1M: 8.0 },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", inputPricePer1M: 0.4, outputPricePer1M: 1.6 },
  { id: "gpt-4.1-nano", label: "GPT-4.1 nano", inputPricePer1M: 0.1, outputPricePer1M: 0.4 },
  { id: "o4-mini", label: "o4-mini", inputPricePer1M: 1.1, outputPricePer1M: 4.4 },
];

export const DEFAULT_MODEL_IDS = ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"];

export function getModel(id: string, from: ModelDef[] = MODELS): ModelDef | undefined {
  return from.find((m) => m.id === id);
}

export function estimateCost(model: ModelDef, inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * model.inputPricePer1M +
    (outputTokens / 1_000_000) * model.outputPricePer1M
  );
}
