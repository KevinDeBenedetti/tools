import type OpenAI from "openai";
import { config as loadEnv } from "dotenv";

// Load .env so OPENAI_API_KEY / OPENAI_BASE_URL are available locally.
loadEnv();

export interface Config {
  apiUrl: string;
  apiKey: string | undefined;
}

/** Read API credentials from the environment. Models come from the API itself. */
export function loadConfig(): Config {
  return {
    apiKey: process.env["OPENAI_API_KEY"],
    apiUrl: process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1",
  };
}

/** Build an OpenAI client from env, or null when OPENAI_API_KEY is missing. */
export async function createClient(): Promise<OpenAI | null> {
  const { apiKey, apiUrl } = loadConfig();
  if (!apiKey) {
    return null;
  }
  const { default: OpenAI } = await import("openai");
  return new OpenAI({ apiKey, baseURL: apiUrl });
}
