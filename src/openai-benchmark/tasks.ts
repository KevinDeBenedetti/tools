import type { QualityTask } from "./quality";

// Default quality suite.
//
// Every task is scored by a deterministic assertion — no judge model, no
// network beyond the model under test, same verdict on every run. That rules
// out open-ended prose, so the suite measures instruction following, format
// compliance and basic extraction rather than writing quality. Prompts state
// the output format explicitly, because a model that ignores the format is
// exactly what the suite is meant to catch.

export const DEFAULT_TASKS: QualityTask[] = [
  {
    assertions: [{ pattern: "\\b391\\b", type: "regex" }],
    description: "Arithmetic with a bare answer",
    id: "arithmetic",
    maxTokens: 32,
    prompt: "What is 17 * 23? Reply with only the number, no words, no punctuation.",
  },
  {
    assertions: [{ type: "equals", value: "ok" }],
    description: "No preamble around a one-word answer",
    id: "single-word",
    maxTokens: 16,
    prompt: "Reply with exactly one word: OK",
  },
  {
    assertions: [{ pattern: "^[a-z]+, ?[a-z]+, ?[a-z]+$", type: "regex" }],
    description: "Comma-separated list, no surrounding prose",
    id: "csv-format",
    maxTokens: 32,
    prompt:
      "List exactly three primary colors as a lowercase comma-separated list. Output nothing else.",
  },
  {
    assertions: [{ requiredKeys: ["city", "population"], type: "json" }],
    description: "Valid JSON object with the requested keys",
    id: "json-object",
    maxTokens: 96,
    prompt:
      'Return only a JSON object describing Tokyo with keys "city" (string) and "population" (number). No markdown, no explanation.',
  },
  {
    assertions: [{ type: "includes", value: "A-4471" }],
    description: "Extraction from a short document",
    id: "extraction",
    maxTokens: 32,
    prompt:
      "Text: 'Order A-4471 shipped on 3 March via courier B-22, invoice INV-9013.'\n" +
      "Output only the order number.",
  },
  {
    assertions: [{ max: 5, min: 5, type: "wordCount" }],
    description: "Exact length constraint",
    id: "word-limit",
    maxTokens: 48,
    prompt: "Describe the ocean in exactly five words. Output only those five words.",
  },
  {
    assertions: [{ pattern: "sum\\(\\s*xs\\s*\\)", type: "regex" }],
    description: "Code output without commentary",
    id: "code-oneliner",
    maxTokens: 64,
    prompt:
      "Write a single line of Python that returns the sum of a list named xs. Output only the code.",
  },
  {
    assertions: [{ pattern: "3\\D+7\\D+19\\D+42", type: "regex" }],
    description: "Ordering with a strict output format",
    id: "sorting",
    maxTokens: 32,
    prompt:
      "Sort these numbers in ascending order and output only them, comma-separated: 42, 7, 19, 3",
  },
  {
    assertions: [
      { pattern: "chat", type: "regex" },
      { pattern: "noir", type: "regex" },
    ],
    description: "Translation without commentary",
    id: "translation",
    maxTokens: 48,
    prompt: "Translate to French. Output only the translation: 'The cat is black.'",
  },
];
