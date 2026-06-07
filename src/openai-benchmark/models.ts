import { loadConfig } from "./config";

export interface ModelDef {
  id: string;
  label: string;
  /** USD per 1M input tokens */
  inputPricePer1M: number;
  /** USD per 1M output tokens */
  outputPricePer1M: number;
}

// Load models from config file
const config = loadConfig();
export const MODELS: ModelDef[] = config.models as ModelDef[];
export const DEFAULT_MODEL_IDS = config.defaultModelIds ?? ["gpt-4o", "gpt-4o-mini"];

export function getModel(id: string): ModelDef | undefined {
  return MODELS.find((m) => m.id === id);
}

export function estimateCost(model: ModelDef, inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * model.inputPricePer1M +
    (outputTokens / 1_000_000) * model.outputPricePer1M
  );
}
