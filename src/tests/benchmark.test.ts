import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import { summarize } from "../openai-benchmark/benchmark";
import { backoffDelay, classifyError, isRetryable, withRetry } from "../openai-benchmark/errors";
import {
  estimateCost,
  explainFunnel,
  fetchModels,
  filterModels,
  filterModelsVerbose,
  getModel,
  type ModelDef,
  parseModelQuery,
  unknownModel,
} from "../openai-benchmark/models";

// Minimal fake of the bits of the OpenAI client that fetchModels touches.
function fakeClient(data: unknown[], onList?: (options?: unknown) => void): OpenAI {
  return {
    models: {
      list: async (options?: unknown) => {
        onList?.(options);
        return { data };
      },
    },
  } as unknown as OpenAI;
}

function model(overrides: Partial<ModelDef> & { id: string }): ModelDef {
  return {
    hasReasoning: false,
    isEmbedding: false,
    inputPricePer1M: 0,
    isFree: false,
    label: overrides.id,
    outputPricePer1M: 0,
    outputsTextOnly: true,
    pricingKnown: false,
    supportedParameters: [],
    ...overrides,
  };
}

describe("fetchModels", () => {
  test("parses OpenRouter-style per-token pricing into per-1M figures", async () => {
    const models = await fetchModels(
      fakeClient([
        {
          context_length: 128000,
          id: "openai/gpt-4o",
          name: "OpenAI: GPT-4o",
          pricing: { completion: "0.00001", prompt: "0.0000025" },
          supported_parameters: ["tools", "response_format"],
        },
      ]),
    );

    expect(models).toEqual([
      {
        contextLength: 128000,
        hasReasoning: false,
        isEmbedding: false,
        id: "openai/gpt-4o",
        inputPricePer1M: 2.5,
        isFree: false,
        label: "OpenAI: GPT-4o",
        outputPricePer1M: 10,
        outputsTextOnly: true,
        pricingKnown: true,
        supportedParameters: ["tools", "response_format"],
      },
    ]);
  });

  test("marks pricing unknown when the provider omits it", async () => {
    const [m] = await fetchModels(fakeClient([{ id: "gpt-4o", object: "model" }]));

    expect(m).toEqual({
      contextLength: undefined,
      hasReasoning: false,
      isEmbedding: false,
      id: "gpt-4o",
      inputPricePer1M: 0,
      isFree: false,
      label: "gpt-4o", // falls back to id when no name
      outputPricePer1M: 0,
      outputsTextOnly: true, // a provider that reports no modality is a chat provider
      pricingKnown: false,
      supportedParameters: [],
    });
  });

  test("treats malformed pricing strings as unknown", async () => {
    const [m] = await fetchModels(
      fakeClient([{ id: "x", pricing: { completion: "", prompt: "n/a" } }]),
    );
    expect(m?.pricingKnown).toBe(false);
  });

  test("sorts models by id", async () => {
    const models = await fetchModels(fakeClient([{ id: "zeta" }, { id: "alpha" }, { id: "mid" }]));
    expect(models.map((m) => m.id)).toEqual(["alpha", "mid", "zeta"]);
  });

  test("forwards a provider query only when one is given", async () => {
    const seen: unknown[] = [];
    const client = fakeClient([{ id: "a" }], (o) => seen.push(o));

    await fetchModels(client);
    await fetchModels(client, {});
    await fetchModels(client, { max_price: 0 });

    expect(seen).toEqual([undefined, undefined, { query: { max_price: 0 } }]);
  });
});

describe("free detection", () => {
  test("the :free suffix marks a model free", async () => {
    const [m] = await fetchModels(
      fakeClient([{ id: "meta/llama:free", pricing: { completion: "0", prompt: "0" } }]),
    );
    expect(m?.isFree).toBe(true);
  });

  test("the :free suffix is enough when pricing is absent", async () => {
    const [m] = await fetchModels(fakeClient([{ id: "meta/llama-3.1-8b-instruct:free" }]));
    expect(m?.isFree).toBe(true);
  });

  test("an explicit is_free flag marks a model free on its own", async () => {
    const [m] = await fetchModels(
      fakeClient([{ id: "x", is_free: true, pricing: { completion: "0.001", prompt: "0.001" } }]),
    );
    expect(m?.isFree).toBe(true);
  });

  test("a false is_free does not veto the :free suffix", async () => {
    // OpenRouter's public /models carries no is_free field, so a missing or
    // stale flag must not override the id the provider itself published.
    const [m] = await fetchModels(
      fakeClient([{ id: "x:free", is_free: false, pricing: { completion: "0", prompt: "0" } }]),
    );
    expect(m?.isFree).toBe(true);
  });

  test("zero pricing alone is not free — that is also how 'no published price' looks", async () => {
    // BYOK, self-hosted and routed entries are priced at zero without being
    // free. Reading them as free is what let --free benchmark paid models.
    const [m] = await fetchModels(
      fakeClient([{ id: "some/byok-model", pricing: { completion: "0", prompt: "0" } }]),
    );
    expect(m?.isFree).toBe(false);
  });

  test("a model with no pricing at all is not free", async () => {
    const [m] = await fetchModels(fakeClient([{ id: "openai/gpt-4o" }]));
    expect(m?.isFree).toBe(false);
  });

  test("a priced model is not free", async () => {
    const [m] = await fetchModels(
      fakeClient([{ id: "openai/gpt-4o", pricing: { completion: "0.00001", prompt: "0" } }]),
    );
    expect(m?.isFree).toBe(false);
  });
});

describe("filterModels", () => {
  const catalogue = [
    model({ id: "meta/llama:free", isFree: true }),
    model({ id: "qwen/qwen-2.5:free", isFree: true, label: "Qwen 2.5" }),
    model({ id: "openai/gpt-4o", pricingKnown: true }),
  ];

  test("free keeps only free models", () => {
    expect(filterModels(catalogue, { free: true }).map((m) => m.id)).toEqual([
      "meta/llama:free",
      "qwen/qwen-2.5:free",
    ]);
  });

  test("match is case-insensitive over id and label", () => {
    expect(filterModels(catalogue, { match: "QWEN" }).map((m) => m.id)).toEqual([
      "qwen/qwen-2.5:free",
    ]);
    expect(filterModels(catalogue, { match: "Qwen 2" }).map((m) => m.id)).toEqual([
      "qwen/qwen-2.5:free",
    ]);
  });

  test("limit is applied after the other filters", () => {
    expect(filterModels(catalogue, { free: true, limit: 1 }).map((m) => m.id)).toEqual([
      "meta/llama:free",
    ]);
  });

  test("no filter returns everything", () => {
    expect(filterModels(catalogue, {})).toHaveLength(3);
  });

  test("an invalid regex is reported, not thrown raw", () => {
    expect(() => filterModels(catalogue, { match: "([" })).toThrow(/Invalid --match/);
  });
});

// Regression: OpenRouter lists Lyria (music generation) at zero cost alongside
// chat models. Its real metadata is output_modalities ["text", "audio"], so
// "emits text" keeps it — the model must be judged on text being its ONLY
// output.
describe("text-only output detection", () => {
  test("rejects a model that also emits audio", async () => {
    const [chat, music] = await fetchModels(
      fakeClient([
        {
          architecture: { modality: "text->text", output_modalities: ["text"] },
          id: "a/chat",
        },
        {
          architecture: {
            modality: "text+image->text+audio",
            output_modalities: ["text", "audio"],
          },
          id: "google/lyria-3-pro-preview",
        },
      ]),
    );

    expect(chat?.outputsTextOnly).toBe(true);
    expect(music?.outputsTextOnly).toBe(false);
  });

  test("falls back to the modality arrow when the arrays are absent", async () => {
    const [image] = await fetchModels(
      fakeClient([{ architecture: { modality: "text->image" }, id: "x" }]),
    );
    expect(image?.outputsTextOnly).toBe(false);

    const [mixed] = await fetchModels(
      fakeClient([{ architecture: { modality: "text+image->text+audio" }, id: "y" }]),
    );
    expect(mixed?.outputsTextOnly).toBe(false);

    const [chat] = await fetchModels(
      fakeClient([{ architecture: { modality: "text+image->text" }, id: "z" }]),
    );
    expect(chat?.outputsTextOnly).toBe(true);
  });

  test("assumes text-only when the provider says nothing", async () => {
    const [m] = await fetchModels(fakeClient([{ id: "gpt-4o" }]));
    expect(m?.outputsTextOnly).toBe(true);
  });

  test("textOnly drops multi-modal output models", () => {
    const catalogue = [
      model({ id: "a/chat", isFree: true }),
      model({ id: "b/lyria", isFree: true, outputsTextOnly: false }),
    ];
    expect(filterModels(catalogue, { free: true, textOnly: true }).map((m) => m.id)).toEqual([
      "a/chat",
    ]);
    expect(filterModels(catalogue, { free: true })).toHaveLength(2);
  });
});

describe("reasoning detection", () => {
  test("flags models advertising reasoning parameters", async () => {
    const [ling, plain] = await fetchModels(
      fakeClient([
        {
          id: "a/ling",
          supported_parameters: ["max_tokens", "include_reasoning", "reasoning"],
        },
        { id: "b/plain", supported_parameters: ["max_tokens", "temperature"] },
      ]),
    );

    expect(ling?.hasReasoning).toBe(true);
    expect(plain?.hasReasoning).toBe(false);
  });
});

describe("filterModelsVerbose / explainFunnel", () => {
  const catalogue = [
    model({ id: "qwen/qwen3-max" }),
    model({ id: "cohere/north:free", isFree: true }),
    model({ id: "google/lyria:free", isFree: true, outputsTextOnly: false }),
  ];

  test("records the count surviving each stage", () => {
    const { funnel } = filterModelsVerbose(catalogue, {
      free: true,
      match: "qwen",
      textOnly: true,
    });

    expect(funnel).toEqual({
      afterEmbedding: 1,
      afterFree: 2,
      afterMatch: 0,
      afterTextOnly: 1,
      final: 0,
      total: 3,
    });
  });

  test("explains which filter emptied the result", () => {
    // The real case: free models exist, qwen models exist, the intersection does not.
    const filter = { free: true, match: "qwen" };
    const { funnel } = filterModelsVerbose(catalogue, filter);
    expect(explainFunnel(funnel, filter)).toBe("3 available → 2 free → 0 matching /qwen/i");
  });

  test("omits stages that were not requested", () => {
    const filter = { match: "qwen" };
    const { funnel } = filterModelsVerbose(catalogue, filter);
    expect(explainFunnel(funnel, filter)).toBe("3 available → 1 matching /qwen/i");
  });
});

describe("parseModelQuery", () => {
  test("coerces numeric values and keeps strings", () => {
    expect(parseModelQuery(["max_price=0", "sort=latency-low-to-high"])).toEqual({
      max_price: 0,
      sort: "latency-low-to-high",
    });
  });

  test("rejects entries without a key=value shape", () => {
    expect(() => parseModelQuery(["oops"])).toThrow(/expected key=value/);
    expect(() => parseModelQuery(["=1"])).toThrow(/expected key=value/);
  });
});

describe("getModel / unknownModel / estimateCost", () => {
  const list = [model({ id: "m1", inputPricePer1M: 2, label: "M1", outputPricePer1M: 8 })];

  test("getModel finds by id", () => {
    expect(getModel("m1", list)?.label).toBe("M1");
    expect(getModel("nope", list)).toBeUndefined();
  });

  test("unknownModel infers free from the id suffix", () => {
    expect(unknownModel("x/y:free").isFree).toBe(true);
    expect(unknownModel("x/y").isFree).toBe(false);
  });

  test("estimateCost uses per-1M pricing", () => {
    // 1M input @ $2 + 0.5M output @ $8 = 2 + 4 = 6
    expect(estimateCost(list[0]!, 1_000_000, 500_000)).toBeCloseTo(6, 6);
  });
});

// ── Error classification ───────────────────────────────────────────────────────

describe("classifyError", () => {
  const apiError = (status: number, headers?: Record<string, string>) =>
    Object.assign(new Error(`HTTP ${status}`), { headers, status });

  test("maps HTTP status to a kind", () => {
    expect(classifyError(apiError(429)).kind).toBe("rate_limited");
    expect(classifyError(apiError(401)).kind).toBe("auth");
    expect(classifyError(apiError(404)).kind).toBe("unavailable");
    expect(classifyError(apiError(503)).kind).toBe("unavailable");
    expect(classifyError(apiError(400)).kind).toBe("bad_request");
    expect(classifyError(apiError(408)).kind).toBe("timeout");
  });

  test("reads Retry-After seconds from a 429", () => {
    expect(classifyError(apiError(429, { "retry-after": "2" })).retryAfterMs).toBe(2000);
  });

  test("prefers the millisecond header when both are present", () => {
    const err = apiError(429, { "retry-after": "9", "retry-after-ms": "250" });
    expect(classifyError(err).retryAfterMs).toBe(250);
  });

  test("reads Retry-After from a fetch Headers instance", () => {
    const err = Object.assign(new Error("429"), {
      headers: new Headers({ "retry-after": "3" }),
      status: 429,
    });
    expect(classifyError(err).retryAfterMs).toBe(3000);
  });

  test("recognises aborts as timeouts", () => {
    expect(classifyError(Object.assign(new Error("x"), { name: "AbortError" })).kind).toBe(
      "timeout",
    );
    expect(classifyError(new Error("The operation timed out")).kind).toBe("timeout");
  });

  test("falls back to unknown", () => {
    expect(classifyError(new Error("boom")).kind).toBe("unknown");
    expect(classifyError("boom").message).toBe("boom");
  });
});

describe("isRetryable", () => {
  test("retries rate limits, timeouts and 5xx but not 404 or 400", () => {
    expect(isRetryable({ kind: "rate_limited", message: "" })).toBe(true);
    expect(isRetryable({ kind: "timeout", message: "" })).toBe(true);
    expect(isRetryable({ kind: "unavailable", message: "", status: 503 })).toBe(true);
    expect(isRetryable({ kind: "unavailable", message: "", status: 404 })).toBe(false);
    expect(isRetryable({ kind: "bad_request", message: "", status: 400 })).toBe(false);
    expect(isRetryable({ kind: "auth", message: "", status: 401 })).toBe(false);
  });
});

describe("backoffDelay", () => {
  test("honours Retry-After, capped at maxDelay", () => {
    const err = { kind: "rate_limited" as const, message: "", retryAfterMs: 5000 };
    expect(backoffDelay(1, err, 1000, 30_000)).toBe(5000);
    expect(backoffDelay(1, err, 1000, 2000)).toBe(2000);
  });

  test("grows exponentially with jitter inside a known band", () => {
    const err = { kind: "rate_limited" as const, message: "" };
    // attempt n → base * 2^(n-1) plus up to one base of jitter
    expect(backoffDelay(1, err, 1000, 30_000)).toBeGreaterThanOrEqual(1000);
    expect(backoffDelay(1, err, 1000, 30_000)).toBeLessThan(2000);
    expect(backoffDelay(3, err, 1000, 30_000)).toBeGreaterThanOrEqual(4000);
    expect(backoffDelay(3, err, 1000, 30_000)).toBeLessThan(5000);
  });
});

describe("withRetry", () => {
  const noSleep = async () => {};

  test("retries a rate limit and returns the eventual success", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw Object.assign(new Error("429"), { status: 429 });
        return "ok";
      },
      { retries: 3, sleep: noSleep },
    );

    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  test("does not retry a permanent failure", async () => {
    let calls = 0;
    const attempt = withRetry(
      async () => {
        calls++;
        throw Object.assign(new Error("bad"), { status: 400 });
      },
      { retries: 3, sleep: noSleep },
    );

    await expect(attempt).rejects.toThrow("bad");
    expect(calls).toBe(1);
  });

  test("gives up after the configured number of retries", async () => {
    let calls = 0;
    const attempt = withRetry(
      async () => {
        calls++;
        throw Object.assign(new Error("429"), { status: 429 });
      },
      { retries: 2, sleep: noSleep },
    );

    await expect(attempt).rejects.toThrow("429");
    expect(calls).toBe(3); // first attempt + 2 retries
  });

  test("reports each retry with its delay", async () => {
    const seen: number[] = [];
    await withRetry(
      (() => {
        let calls = 0;
        return async () => {
          calls++;
          if (calls === 1) {
            throw Object.assign(new Error("429"), {
              headers: { "retry-after-ms": "500" },
              status: 429,
            });
          }
          return "ok";
        };
      })(),
      { onRetry: (_a, _e, delay) => seen.push(delay), retries: 2, sleep: noSleep },
    );

    expect(seen).toEqual([500]);
  });
});

// ── Stats ──────────────────────────────────────────────────────────────────────

describe("summarize", () => {
  const ok = (totalMs: number, outputTokens = 100) => ({
    costUsd: 0,
    inputTokens: 10,
    outputTokens,
    tokensPerSec: (outputTokens / totalMs) * 1000,
    totalMs,
    ttfms: totalMs / 2,
  });

  test("computes percentiles over successful runs only", () => {
    const stats = summarize([
      ok(100),
      ok(200),
      {
        costUsd: 0,
        error: "nope",
        errorKind: "unavailable" as const,
        inputTokens: 0,
        outputTokens: 0,
        tokensPerSec: 0,
        totalMs: 5,
        ttfms: null,
      },
    ]);

    expect(stats.successRate).toBeCloseTo(2 / 3, 6);
    expect(stats.totalMs.mean).toBe(150);
    expect(stats.totalMs.p95).toBe(200);
    expect(stats.ttfMs?.mean).toBe(75);
    expect(stats.inputTokens).toBe(10);
  });

  test("counts failures by kind so rate limits stay distinguishable", () => {
    const fail = (kind: "rate_limited" | "unavailable") => ({
      costUsd: 0,
      error: kind,
      errorKind: kind,
      inputTokens: 0,
      outputTokens: 0,
      tokensPerSec: 0,
      totalMs: 1,
      ttfms: null,
    });

    const stats = summarize([fail("rate_limited"), fail("rate_limited"), fail("unavailable")]);

    expect(stats.errorCounts).toEqual({ rate_limited: 2, unavailable: 1 });
    expect(stats.successRate).toBe(0);
    expect(stats.ttfMs).toBeNull();
  });
});
