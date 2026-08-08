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

export async function complete(client: OpenAI, req: CompletionRequest): Promise<CompletionResult> {
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
    ...(req.disableReasoning === true ? { reasoning: { enabled: false } } : {}),
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
