import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { log } from "../shared/ui";
import { type ModelDef, MODELS, DEFAULT_MODEL_IDS } from "./models";

// Load .env file
loadEnv();

export interface Config {
  models: ModelDef[];
  apiUrl: string;
  apiKey: string | undefined;
  defaultModelIds: string[];
}

function getConfigPath(): string {
  const cwdConfig = resolve(process.cwd(), "benchmark.config.json");
  if (existsSync(cwdConfig)) return cwdConfig;

  const homeConfig = resolve(process.env["HOME"] ?? "~", ".benchmark.config.json");
  if (existsSync(homeConfig)) return homeConfig;

  return cwdConfig;
}

export function loadConfig(): Config {
  const configPath = getConfigPath();
  const apiUrl = process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1";
  const apiKey = process.env["OPENAI_API_KEY"];

  if (!existsSync(configPath)) {
    return { models: MODELS, apiUrl, apiKey, defaultModelIds: DEFAULT_MODEL_IDS };
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const userConfig = JSON.parse(content) as Partial<Config>;
    return {
      models: (userConfig.models as ModelDef[]) ?? MODELS,
      apiUrl,
      apiKey,
      defaultModelIds: userConfig.defaultModelIds ?? DEFAULT_MODEL_IDS,
    };
  } catch (error) {
    log.error(
      `Failed to load config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { models: MODELS, apiUrl, apiKey, defaultModelIds: DEFAULT_MODEL_IDS };
  }
}

export function getConfigTemplate(): string {
  return JSON.stringify(
    {
      models: [
        { id: "gpt-4o", label: "GPT-4o", inputPricePer1M: 2.5, outputPricePer1M: 10 },
        { id: "gpt-4-turbo", label: "GPT-4 Turbo", inputPricePer1M: 10, outputPricePer1M: 30 },
        {
          id: "your-custom-model",
          label: "My Custom Model",
          inputPricePer1M: 5,
          outputPricePer1M: 15,
        },
      ],
      defaultModelIds: ["gpt-4o", "gpt-4o-mini"],
    },
    null,
    2,
  );
}
