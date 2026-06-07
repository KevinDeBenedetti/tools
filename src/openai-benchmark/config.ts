import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { log } from "../shared/ui";

// Load .env file
loadEnv();

export interface Model {
  id: string;
  label: string;
  /** USD per 1M input tokens */
  inputPricePer1M: number;
  /** USD per 1M output tokens */
  outputPricePer1M: number;
}

export interface Config {
  models: Model[];
  apiUrl: string;
  apiKey: string;
  defaultModelIds?: string[];
}

const DEFAULT_MODELS = [
  { id: "gpt-4o", label: "GPT-4o", inputPricePer1M: 2.5, outputPricePer1M: 10 },
  { id: "gpt-4o-mini", label: "GPT-4o mini", inputPricePer1M: 0.15, outputPricePer1M: 0.6 },
  { id: "gpt-4.1", label: "GPT-4.1", inputPricePer1M: 2, outputPricePer1M: 8 },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", inputPricePer1M: 0.4, outputPricePer1M: 1.6 },
  { id: "gpt-4.1-nano", label: "GPT-4.1 nano", inputPricePer1M: 0.1, outputPricePer1M: 0.4 },
  { id: "o4-mini", label: "o4-mini", inputPricePer1M: 1.1, outputPricePer1M: 4.4 },
];
const DEFAULT_MODEL_IDS = ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"];

function getConfigPath(): string {
  // Look for config file in current working directory or home directory
  const cwdConfig = resolve(process.cwd(), "benchmark.config.json");
  if (existsSync(cwdConfig)) {
    return cwdConfig;
  }

  const homeConfig = resolve(process.env["HOME"] ?? "~", ".benchmark.config.json");
  if (existsSync(homeConfig)) {
    return homeConfig;
  }

  return cwdConfig; // Return default path (even if it doesn't exist)
}

export function loadConfig(): Config {
  const configPath = getConfigPath();

  // Get API URL and key from environment variables
  const apiUrl = process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1";
  const apiKey = process.env["OPENAI_API_KEY"];

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Please set it in your .env file or as an environment variable.",
    );
  }

  if (!existsSync(configPath)) {
    log.info(`Config file not found at ${configPath}, using defaults.`);
    return {
      models: DEFAULT_MODELS,
      apiUrl,
      apiKey,
      defaultModelIds: DEFAULT_MODEL_IDS,
    };
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const userConfig = JSON.parse(content) as Partial<Config>;

    // Merge with defaults, using env vars for API settings
    return {
      models: userConfig.models || DEFAULT_MODELS,
      apiUrl,
      apiKey,
      defaultModelIds: userConfig.defaultModelIds || DEFAULT_MODEL_IDS,
    };
  } catch (error) {
    log.error(
      `Failed to load config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      models: DEFAULT_MODELS,
      apiUrl,
      apiKey,
      defaultModelIds: DEFAULT_MODEL_IDS,
    };
  }
}

export function getConfigTemplate(): string {
  return JSON.stringify(
    {
      models: [
        {
          id: "gpt-4o",
          label: "GPT-4o",
          inputPricePer1M: 2.5,
          outputPricePer1M: 10,
        },
        {
          id: "gpt-4-turbo",
          label: "GPT-4 Turbo",
          inputPricePer1M: 10,
          outputPricePer1M: 30,
        },
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
