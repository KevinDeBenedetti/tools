import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import { DEFAULT_RETRIEVAL_CASES } from "../openai-benchmark/embed-tasks";
import { detectInputType, embed, summarizeEmbedding } from "../openai-benchmark/embeddings";
import { fetchModels, filterModels } from "../openai-benchmark/models";
import {
  cosine,
  documentTexts,
  flattenCases,
  isNormalized,
  norm,
  queryTexts,
  type RetrievalCase,
  scoreCase,
  summarizeRetrieval,
} from "../openai-benchmark/retrieval";

function fakeClient(data: unknown[]): OpenAI {
  return { models: { list: async () => ({ data }) } } as unknown as OpenAI;
}

// ── Catalogue ──────────────────────────────────────────────────────────────────

describe("embedding model detection", () => {
  test("recognises the embeddings output modality", async () => {
    const [embedding, chat] = await fetchModels(
      fakeClient([
        {
          architecture: { modality: "text->embeddings", output_modalities: ["embeddings"] },
          id: "a/embed",
        },
        { architecture: { output_modalities: ["text"] }, id: "b/chat" },
      ]),
    );

    expect(embedding?.isEmbedding).toBe(true);
    expect(chat?.isEmbedding).toBe(false);
  });

  test("treats a missing completion price as zero for embedding models", async () => {
    // Embedding models bill input only. Without this, pricingKnown would be
    // false and no free embedding model would ever be detected.
    const [m] = await fetchModels(
      fakeClient([
        {
          architecture: { output_modalities: ["embeddings"] },
          id: "a/embed:free",
          pricing: { prompt: "0" },
        },
      ]),
    );

    expect(m?.pricingKnown).toBe(true);
    expect(m?.isFree).toBe(true);
  });

  test("reads the embedding price when the provider uses that key", async () => {
    const [m] = await fetchModels(
      fakeClient([
        {
          architecture: { output_modalities: ["embeddings"] },
          id: "a/embed",
          pricing: { embedding: "0.00000002" },
        },
      ]),
    );

    expect(m?.inputPricePer1M).toBeCloseTo(0.02, 6);
    expect(m?.isFree).toBe(false);
  });

  test("a chat model is not kept by the embedding filter", async () => {
    const models = await fetchModels(
      fakeClient([
        { architecture: { output_modalities: ["embeddings"] }, id: "a/embed" },
        { architecture: { output_modalities: ["text"] }, id: "b/chat" },
      ]),
    );

    expect(filterModels(models, { embedding: true }).map((m) => m.id)).toEqual(["a/embed"]);
  });
});

// ── Vector maths ───────────────────────────────────────────────────────────────

describe("cosine / norm", () => {
  test("norm computes vector length", () => {
    expect(norm([3, 4])).toBe(5);
    expect(norm([0, 0])).toBe(0);
  });

  test("cosine is 1 for identical directions and 0 for orthogonal ones", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 9);
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1, 9); // magnitude-independent
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 9);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 9);
  });

  test("a degenerate vector yields 0 rather than NaN", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  test("isNormalized detects unit vectors within tolerance", () => {
    expect(
      isNormalized([
        [1, 0],
        [0, 1],
      ]),
    ).toBe(true);
    expect(isNormalized([[3, 4]])).toBe(false);
    expect(isNormalized([[0.7071, 0.7071]])).toBe(true);
  });
});

// ── Scoring ────────────────────────────────────────────────────────────────────

describe("scoreCase", () => {
  const testCase: RetrievalCase = {
    id: "c1",
    negatives: ["n1", "n2"],
    positive: "p",
    query: "q",
  };

  test("passes when the positive is closest to the query", () => {
    const result = scoreCase(
      testCase,
      [1, 0],
      [0.9, 0.1],
      [
        [0, 1],
        [-1, 0],
      ],
    );
    expect(result.passed).toBe(true);
    expect(result.rank).toBe(1);
    expect(result.margin).toBeGreaterThan(0);
  });

  test("fails and ranks below when a negative wins", () => {
    const result = scoreCase(
      testCase,
      [1, 0],
      [0, 1],
      [
        [1, 0],
        [0.5, 0.5],
      ],
    );
    expect(result.passed).toBe(false);
    expect(result.rank).toBe(3); // both negatives beat the positive
    expect(result.margin).toBeLessThan(0);
  });

  test("a tie counts against the model", () => {
    // An embedding that cannot separate the two is not one you would deploy.
    const result = scoreCase(testCase, [1, 0], [1, 0], [[1, 0]]);
    expect(result.passed).toBe(false);
    expect(result.rank).toBe(2);
    expect(result.margin).toBeCloseTo(0, 9);
  });
});

describe("summarizeRetrieval", () => {
  test("computes precision@1, MRR and mean margin", () => {
    const summary = summarizeRetrieval([
      { caseId: "a", margin: 0.2, passed: true, rank: 1 },
      { caseId: "b", margin: -0.1, passed: false, rank: 2 },
      { caseId: "c", margin: -0.3, passed: false, rank: 4 },
    ]);

    expect(summary.precisionAt1).toBeCloseTo(1 / 3, 6);
    expect(summary.mrr).toBeCloseTo((1 + 1 / 2 + 1 / 4) / 3, 6);
    expect(summary.meanMargin).toBeCloseTo((0.2 - 0.1 - 0.3) / 3, 6);
  });

  test("an empty suite scores zero rather than NaN", () => {
    expect(summarizeRetrieval([])).toEqual({ meanMargin: 0, mrr: 0, precisionAt1: 0 });
  });
});

// ── Suite integrity ────────────────────────────────────────────────────────────

describe("DEFAULT_RETRIEVAL_CASES", () => {
  test("case ids are unique", () => {
    const ids = DEFAULT_RETRIEVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every case has hard negatives", () => {
    for (const c of DEFAULT_RETRIEVAL_CASES) {
      expect(c.negatives.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("queryTexts and documentTexts split the suite consistently", () => {
    const cases: RetrievalCase[] = [
      { id: "a", negatives: ["a-n1", "a-n2"], positive: "a-pos", query: "a-q" },
      { id: "b", negatives: ["b-n1"], positive: "b-pos", query: "b-q" },
    ];

    expect(queryTexts(cases)).toEqual(["a-q", "b-q"]);
    expect(documentTexts(cases)).toEqual(["a-pos", "a-n1", "a-n2", "b-pos", "b-n1"]);
    // The scorer walks documents as 1 positive + N negatives per case.
    expect(documentTexts(cases)).toHaveLength(
      cases.reduce((s, c) => s + 1 + c.negatives.length, 0),
    );
  });

  test("flattenCases emits query, positive, then negatives in order", () => {
    const cases: RetrievalCase[] = [
      { id: "a", negatives: ["a-n1", "a-n2"], positive: "a-pos", query: "a-q" },
      { id: "b", negatives: ["b-n1"], positive: "b-pos", query: "b-q" },
    ];

    expect(flattenCases(cases)).toEqual(["a-q", "a-pos", "a-n1", "a-n2", "b-q", "b-pos", "b-n1"]);
  });

  test("the flattened suite length matches what the scorer walks", () => {
    const expected = DEFAULT_RETRIEVAL_CASES.reduce((s, c) => s + 2 + c.negatives.length, 0);
    expect(flattenCases(DEFAULT_RETRIEVAL_CASES)).toHaveLength(expected);
  });
});

// ── input_type negotiation ─────────────────────────────────────────────────────

describe("detectInputType", () => {
  // NVIDIA accepts query/passage and rejects the search_* spelling OpenRouter
  // documents, so the vocabulary is measured rather than assumed.
  function fakeEmbedClient(accepted: string[], failWith = 400): OpenAI {
    return {
      embeddings: {
        create: async (body: { input_type?: string }) => {
          if (body.input_type !== undefined && !accepted.includes(body.input_type)) {
            throw Object.assign(new Error(`Unsupported input_type "${body.input_type}"`), {
              status: failWith,
            });
          }
          return { data: [{ embedding: [1, 0], index: 0 }], usage: { prompt_tokens: 1 } };
        },
      },
    } as unknown as OpenAI;
  }

  test("picks the vocabulary the model accepts", async () => {
    expect(await detectInputType(fakeEmbedClient(["query"]), "m", 1000)).toEqual({
      document: "passage",
      query: "query",
    });
    expect(await detectInputType(fakeEmbedClient(["search_query"]), "m", 1000)).toEqual({
      document: "search_document",
      query: "search_query",
    });
  });

  test("returns undefined when no vocabulary is accepted", async () => {
    expect(await detectInputType(fakeEmbedClient([]), "m", 1000)).toBeUndefined();
  });

  test("gives up on a non-400 rather than misreading an outage as unsupported", async () => {
    // A rate limit says nothing about input_type support.
    expect(await detectInputType(fakeEmbedClient([], 429), "m", 1000)).toBeUndefined();
  });
});

describe("embed", () => {
  test("always asks for float encoding", async () => {
    // The SDK defaults to base64, which NVIDIA rejects outright.
    let seen: Record<string, unknown> = {};
    const client = {
      embeddings: {
        create: async (body: Record<string, unknown>) => {
          seen = body;
          return { data: [{ embedding: [1, 0], index: 0 }], usage: { prompt_tokens: 1 } };
        },
      },
    } as unknown as OpenAI;

    await embed(client, "m", ["ping"], { timeoutMs: 1000 });
    expect(seen["encoding_format"]).toBe("float");
    expect(seen["input_type"]).toBeUndefined();

    await embed(client, "m", ["ping"], { inputType: "query", timeoutMs: 1000 });
    expect(seen["input_type"]).toBe("query");
  });

  test("reorders vectors by the index the API returns", async () => {
    const client = {
      embeddings: {
        create: async () => ({
          data: [
            { embedding: [0, 1], index: 1 },
            { embedding: [1, 0], index: 0 },
          ],
          usage: { prompt_tokens: 2 },
        }),
      },
    } as unknown as OpenAI;

    const result = await embed(client, "m", ["a", "b"], { timeoutMs: 1000 });
    expect(result.vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });
});

// ── Stats ──────────────────────────────────────────────────────────────────────

describe("summarizeEmbedding", () => {
  const ok = (totalMs: number) => ({
    costUsd: 0,
    dimensions: 768,
    inputTokens: 80,
    textsPerSec: (8 / totalMs) * 1000,
    tokensPerSec: (80 / totalMs) * 1000,
    totalMs,
    vectors: 8,
  });

  test("aggregates successful runs and reports dimensions", () => {
    const stats = summarizeEmbedding([ok(100), ok(300)]);
    expect(stats.totalMs.mean).toBe(200);
    expect(stats.totalMs.p95).toBe(300);
    expect(stats.dimensions).toBe(768);
    expect(stats.successRate).toBe(1);
  });

  test("counts failures by kind", () => {
    const stats = summarizeEmbedding([
      ok(100),
      {
        costUsd: 0,
        dimensions: 0,
        error: "429",
        errorKind: "rate_limited" as const,
        inputTokens: 0,
        textsPerSec: 0,
        tokensPerSec: 0,
        totalMs: 5,
        vectors: 0,
      },
    ]);

    expect(stats.successRate).toBe(0.5);
    expect(stats.errorCounts).toEqual({ rate_limited: 1 });
  });
});
