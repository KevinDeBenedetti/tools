import type OpenAI from "openai";

// One place where a chat completion is actually issued, shared by the
// benchmark, the reachability probe and the quality suite. It owns the timeout
// (via AbortSignal) and the streaming/non-streaming split so callers only deal
// with a single result shape.

export interface CompletionRequest {
  model: string;
  prompt: string;
  maxTokens: number;
  stream: boolean;
  timeoutMs: number;
  /** Ask for a JSON object back — used by the json_mode capability probe */
  json?: boolean;
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  /**
   * Turn reasoning tokens off (OpenRouter's `reasoning.enabled`). Only send
   * this to models that advertise reasoning: it is a provider extension, and
   * strict OpenAI-compatible servers reject unknown body parameters.
   *
   * `exclude: true` is deliberately not used — it only hides reasoning from
   * the response while still spending the output budget on it.
   *
   * Treated as a preference, not an instruction: an endpoint that mandates
   * reasoning says so with a 400, and the request is then re-sent without it.
   */
  disableReasoning?: boolean;
}

export interface CompletionResult {
  text: string;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** Time to first content token; null outside streaming mode */
  ttfMs: number | null;
  totalMs: number;
}

/**
 * Models that answered "reasoning cannot be disabled". Some endpoints advertise
 * reasoning *and* mandate it, and nothing in the model metadata tells the two
 * apart — only a 400 does. Asking once per model per process is the cost of
 * finding out; asking every time is not.
 */
const REASONING_MANDATORY = new Set<string>();

/** Whether the provider rejected the request *because* reasoning was switched off. */
function mandatesReasoning(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const e = err as { status?: unknown; message?: unknown };
  if (e.status !== 400) return false;
  const message = typeof e.message === "string" ? e.message : "";
  return /reasoning/i.test(message) && /mandatory|cannot be disabled|required/i.test(message);
}

/**
 * Issue the completion, falling back to the model's own terms when the provider
 * refuses to run it without reasoning. The retry is deliberately not folded into
 * `withRetry`: this is not a transient failure, it is the provider telling us
 * the request shape is wrong, and the answer is to change the shape once.
 */
export async function complete(client: OpenAI, req: CompletionRequest): Promise<CompletionResult> {
  const disable = req.disableReasoning === true && !REASONING_MANDATORY.has(req.model);
  try {
    return await send(client, req, disable);
  } catch (err) {
    if (!disable || !mandatesReasoning(err)) throw err;
    REASONING_MANDATORY.add(req.model);
    // Measured on its own terms rather than dropped: a model that must think is
    // still a model you can benchmark, just not one you can compare on TTFT.
    return await send(client, req, false);
  }
}

/** Exposed for tests; the cache is process-wide and otherwise write-only. */
export function resetReasoningCache(): void {
  REASONING_MANDATORY.clear();
}

async function send(
  client: OpenAI,
  req: CompletionRequest,
  disableReasoning: boolean,
): Promise<CompletionResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), req.timeoutMs);
  const start = performance.now();

  let text = "";
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let ttfMs: number | null = null;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { content: req.prompt, role: "user" },
  ];
  const shared = {
    max_tokens: req.maxTokens,
    messages,
    model: req.model,
    ...(req.json === true ? { response_format: { type: "json_object" as const } } : {}),
    ...(req.tools === undefined ? {} : { tools: req.tools }),
    // Provider extension, absent from the SDK's types.
    ...(disableReasoning ? { reasoning: { enabled: false } } : {}),
  };

  try {
    if (req.stream) {
      const stream = await client.chat.completions.create(
        { ...shared, stream: true, stream_options: { include_usage: true } },
        { signal: controller.signal },
      );

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        const content = delta?.content;
        if (content !== undefined && content !== null && content !== "") {
          ttfMs ??= performance.now() - start;
          text += content;
        }
        if (delta?.tool_calls !== undefined) {
          toolCalls += delta.tool_calls.length;
        }
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens;
          outputTokens = chunk.usage.completion_tokens;
        }
      }
    } else {
      const resp = await client.chat.completions.create(
        { ...shared, stream: false },
        { signal: controller.signal },
      );
      const message = resp.choices[0]?.message;
      text = message?.content ?? "";
      toolCalls = message?.tool_calls?.length ?? 0;
      inputTokens = resp.usage?.prompt_tokens ?? 0;
      outputTokens = resp.usage?.completion_tokens ?? 0;
    }
  } finally {
    clearTimeout(timeoutId);
  }

  return { inputTokens, outputTokens, text, toolCalls, totalMs: performance.now() - start, ttfMs };
}
