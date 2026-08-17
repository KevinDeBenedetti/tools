/**
 * Known OpenAI-compatible endpoints, so switching provider is a click rather
 * than a URL to remember — getting this wrong is the single most common way both
 * a benchmark run and a provider inspection fail.
 *
 * Shared by the environment panel and the API inspector: the two would otherwise
 * drift, and a preset that works in one place and not the other is worse than no
 * preset at all.
 */
export interface ProviderPreset {
  label: string;
  url: string;
}

export const PRESETS: ProviderPreset[] = [
  { label: "OpenAI", url: "https://api.openai.com/v1" },
  { label: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { label: "Ollama", url: "http://localhost:11434/v1" },
  { label: "LM Studio", url: "http://localhost:1234/v1" },
];
