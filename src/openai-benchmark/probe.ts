import type OpenAI from "openai";
import { type ClassifiedError, classifyError, withRetry } from "./errors";
import type { ModelDef } from "./models";
import { complete } from "./request";

// Reachability probe.
//
// Free catalogues list plenty of models that answer nothing: retired endpoints,
// upstream outages, models gated behind a paid tier. Sending one tiny request
// up front is far cheaper than discovering it three benchmark runs at a time,
// and it keeps dead models out of the results table.

export const PROBE_PROMPT = "Say OK.";
export const PROBE_MAX_TOKENS = 8;
export const PROBE_TIMEOUT_MS = 20_000;

export interface ProbeResult {
  model: ModelDef;
  ok: boolean;
  latencyMs: number;
  error?: ClassifiedError;
}

export interface ProbeOptions {
  timeoutMs?: number;
  /** Retries on transient failures; a rate-limited model is not a dead model */
  retries?: number;
}

export async function probeModel(
  client: OpenAI,
  model: ModelDef,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const start = performance.now();

  try {
    await withRetry(
      () =>
        complete(client, {
          maxTokens: PROBE_MAX_TOKENS,
          model: model.id,
          prompt: PROBE_PROMPT,
          stream: false,
          timeoutMs,
        }),
      { retries: options.retries ?? 1 },
    );
    return { latencyMs: performance.now() - start, model, ok: true };
  } catch (err) {
    return {
      error: classifyError(err),
      latencyMs: performance.now() - start,
      model,
      ok: false,
    };
  }
}

export interface ProbeSummary {
  alive: ModelDef[];
  dead: ProbeResult[];
}

/** Probe every candidate sequentially, keeping the ones that answered. */
export async function probeModels(
  client: OpenAI,
  models: ModelDef[],
  options: ProbeOptions = {},
  onResult?: (result: ProbeResult, index: number, total: number) => void,
): Promise<ProbeSummary> {
  const alive: ModelDef[] = [];
  const dead: ProbeResult[] = [];

  for (const [index, model] of models.entries()) {
    const result = await probeModel(client, model, options);
    if (result.ok) {
      alive.push(model);
    } else {
      dead.push(result);
    }
    onResult?.(result, index + 1, models.length);
  }

  return { alive, dead };
}
