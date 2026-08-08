import { describe, expect, test } from "bun:test";
import type { ModelDef } from "../openai-benchmark/models";
import {
  type Assertion,
  claimsCapability,
  countWords,
  evaluate,
  extractJson,
  normalize,
  scoreTask,
} from "../openai-benchmark/quality";
import { DEFAULT_TASKS } from "../openai-benchmark/tasks";

function model(supportedParameters: string[]): ModelDef {
  return {
    hasReasoning: false,
    isEmbedding: false,
    id: "x",
    inputPricePer1M: 0,
    isFree: true,
    label: "x",
    outputPricePer1M: 0,
    outputsTextOnly: true,
    pricingKnown: true,
    supportedParameters,
  };
}

describe("normalize", () => {
  test("strips markdown fences, wrapping quotes and collapses whitespace", () => {
    expect(normalize('```json\n{ "a": 1 }\n```')).toBe('{ "a": 1 }');
    expect(normalize('  "OK"  ')).toBe("OK");
    expect(normalize("a\n\n  b")).toBe("a b");
  });
});

describe("countWords", () => {
  test("ignores punctuation and surrounding whitespace", () => {
    expect(countWords("  Vast, deep, blue, salty, alive.  ")).toBe(5);
    expect(countWords("")).toBe(0);
  });
});

describe("extractJson", () => {
  test("finds an object inside prose or fences", () => {
    expect(extractJson('Here you go: {"city":"Tokyo"} — enjoy!')).toEqual({ city: "Tokyo" });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test("returns undefined when there is no parseable object", () => {
    expect(extractJson("no json here")).toBeUndefined();
    expect(extractJson("{ broken: ")).toBeUndefined();
  });
});

describe("evaluate", () => {
  const check = (assertion: Assertion, output: string) => evaluate(assertion, output).passed;

  test("equals ignores case, wrapping and trailing punctuation", () => {
    expect(check({ type: "equals", value: "ok" }, "OK.")).toBe(true);
    expect(check({ type: "equals", value: "ok" }, '"ok"')).toBe(true);
    expect(check({ type: "equals", value: "ok" }, "Sure — OK")).toBe(false);
  });

  test("includes is case-insensitive", () => {
    expect(check({ type: "includes", value: "A-4471" }, "the order is a-4471")).toBe(true);
    expect(check({ type: "includes", value: "A-4471" }, "B-22")).toBe(false);
  });

  test("regex defaults to case-insensitive matching", () => {
    expect(check({ pattern: "\\b391\\b", type: "regex" }, "391")).toBe(true);
    expect(check({ pattern: "sum\\(\\s*xs\\s*\\)", type: "regex" }, "return sum( xs )")).toBe(true);
    expect(check({ pattern: "\\b391\\b", type: "regex" }, "The answer is 392")).toBe(false);
  });

  test("an invalid regex fails the assertion instead of throwing", () => {
    const result = evaluate({ pattern: "([", type: "regex" }, "anything");
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/invalid pattern/);
  });

  test("json checks parseability and required keys", () => {
    const assertion: Assertion = { requiredKeys: ["city", "population"], type: "json" };
    expect(check(assertion, '{"city":"Tokyo","population":37000000}')).toBe(true);
    expect(evaluate(assertion, '{"city":"Tokyo"}').detail).toMatch(/missing keys: population/);
    expect(check(assertion, "Tokyo has 37 million people")).toBe(false);
  });

  test("wordCount enforces both bounds", () => {
    const exactlyFive: Assertion = { max: 5, min: 5, type: "wordCount" };
    expect(check(exactlyFive, "Vast deep blue salty alive")).toBe(true);
    expect(check(exactlyFive, "Vast deep blue salty")).toBe(false);
    expect(check(exactlyFive, "Vast deep blue salty alive and cold")).toBe(false);
  });

  test("notEmpty rejects whitespace-only output", () => {
    expect(check({ type: "notEmpty" }, "  \n ")).toBe(false);
    expect(check({ type: "notEmpty" }, "x")).toBe(true);
  });
});

describe("scoreTask", () => {
  const task = {
    assertions: [
      { pattern: "chat", type: "regex" as const },
      { pattern: "noir", type: "regex" as const },
    ],
    description: "translation",
    id: "translation",
    prompt: "…",
  };

  test("passes only when every assertion passes", () => {
    expect(scoreTask(task, "Le chat est noir.").passed).toBe(true);
    expect(scoreTask(task, "Le chat est blanc.").passed).toBe(false);
  });

  test("records each assertion result for reporting", () => {
    const result = scoreTask(task, "Le chat est blanc.");
    expect(result.assertions.map((a) => a.passed)).toEqual([true, false]);
    expect(result.taskId).toBe("translation");
  });

  // A reasoning model whose whole budget went to thinking returns "" — that is
  // a measurement artefact, not a wrong answer, and must stay distinguishable.
  test("flags an empty answer separately from a wrong one", () => {
    expect(scoreTask(task, "").empty).toBe(true);
    expect(scoreTask(task, "   \n ").empty).toBe(true);
    expect(scoreTask(task, "Le chat est blanc.").empty).toBe(false);
  });
});

describe("claimsCapability", () => {
  test("maps provider parameter names onto capabilities", () => {
    expect(claimsCapability(model(["tools", "temperature"]), "tools")).toBe(true);
    expect(claimsCapability(model(["response_format"]), "json_mode")).toBe(true);
    expect(claimsCapability(model(["structured_outputs"]), "json_mode")).toBe(true);
    expect(claimsCapability(model(["temperature"]), "tools")).toBe(false);
    expect(claimsCapability(model([]), "json_mode")).toBe(false);
  });
});

describe("DEFAULT_TASKS", () => {
  test("task ids are unique", () => {
    const ids = DEFAULT_TASKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every task carries at least one assertion", () => {
    for (const task of DEFAULT_TASKS) {
      expect(task.assertions.length).toBeGreaterThan(0);
    }
  });

  test("assertions accept a model answering exactly as instructed", () => {
    const ideal: Record<string, string> = {
      arithmetic: "391",
      "code-oneliner": "return sum(xs)",
      "csv-format": "red, blue, yellow",
      extraction: "A-4471",
      "json-object": '{"city": "Tokyo", "population": 37000000}',
      "single-word": "OK",
      sorting: "3, 7, 19, 42",
      translation: "Le chat est noir.",
      "word-limit": "Vast deep blue salty alive",
    };

    for (const task of DEFAULT_TASKS) {
      const answer = ideal[task.id];
      expect(answer).toBeDefined();
      expect(scoreTask(task, answer!).passed).toBe(true);
    }
  });

  test("assertions reject a model that ignores the format", () => {
    // The failure mode the suite exists to catch: a correct answer buried in prose.
    expect(
      scoreTask(
        DEFAULT_TASKS.find((t) => t.id === "single-word")!,
        "Sure! OK",
      ).passed,
    ).toBe(false);
    expect(
      scoreTask(
        DEFAULT_TASKS.find((t) => t.id === "csv-format")!,
        "The three primary colors are red, blue and yellow.",
      ).passed,
    ).toBe(false);
  });
});
