import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import { estimateCost, fetchModels, getModel } from "../openai-benchmark/models";

// Minimal fake of the bits of the OpenAI client that fetchModels touches.
function fakeClient(data: unknown[]): OpenAI {
  return { models: { list: async () => ({ data }) } } as unknown as OpenAI;
}

describe("fetchModels", () => {
  test("parses OpenRouter-style per-token pricing into per-1M figures", async () => {
    const models = await fetchModels(
      fakeClient([
        {
          id: "openai/gpt-4o",
          name: "OpenAI: GPT-4o",
          pricing: { completion: "0.00001", prompt: "0.0000025" },
        },
      ]),
    );

    expect(models).toEqual([
      {
        id: "openai/gpt-4o",
        inputPricePer1M: 2.5,
        label: "OpenAI: GPT-4o",
        outputPricePer1M: 10,
        pricingKnown: true,
      },
    ]);
  });

  test("marks pricing unknown when the provider omits it", async () => {
    const [model] = await fetchModels(fakeClient([{ id: "gpt-4o", object: "model" }]));

    expect(model).toEqual({
      id: "gpt-4o",
      inputPricePer1M: 0,
      label: "gpt-4o", // falls back to id when no name
      outputPricePer1M: 0,
      pricingKnown: false,
    });
  });

  test("treats malformed pricing strings as unknown", async () => {
    const [model] = await fetchModels(
      fakeClient([{ id: "x", pricing: { completion: "", prompt: "n/a" } }]),
    );
    expect(model?.pricingKnown).toBe(false);
  });

  test("sorts models by id", async () => {
    const models = await fetchModels(fakeClient([{ id: "zeta" }, { id: "alpha" }, { id: "mid" }]));
    expect(models.map((m) => m.id)).toEqual(["alpha", "mid", "zeta"]);
  });
});

describe("getModel / estimateCost", () => {
  const list = [
    {
      id: "m1",
      inputPricePer1M: 2,
      label: "M1",
      outputPricePer1M: 8,
      pricingKnown: true,
    },
  ];

  test("getModel finds by id", () => {
    expect(getModel("m1", list)?.label).toBe("M1");
    expect(getModel("nope", list)).toBeUndefined();
  });

  test("estimateCost uses per-1M pricing", () => {
    // 1M input @ $2 + 0.5M output @ $8 = 2 + 4 = 6
    expect(estimateCost(list[0]!, 1_000_000, 500_000)).toBeCloseTo(6, 6);
  });
});
