import type OpenAI from "openai";
import { classifyError, withRetry } from "./errors";
import type { ModelDef } from "./models";
import { complete } from "./request";
import { DEFAULT_TASKS } from "./tasks";

// Quality scoring.
//
// On a free catalogue every model costs $0, so latency is the only axis the
// speed benchmark can rank on — and the fastest free model is routinely the
// least useful one. This module adds two orthogonal signals: a deterministic
// task suite (does the model follow instructions?) and capability probes (does
// tool calling / JSON mode actually work, as opposed to being advertised?).

export type Assertion =
  | { type: "equals"; value: string }
  | { type: "includes"; value: string }
  | { type: "regex"; pattern: string; flags?: string }
  | { type: "json"; requiredKeys?: string[] }
  | { type: "wordCount"; min?: number; max?: number }
  | { type: "notEmpty" };

export interface QualityTask {
  id: string;
  description: string;
  prompt: string;
  assertions: Assertion[];
  maxTokens?: number;
}

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  detail?: string;
}

export interface TaskResult {
  taskId: string;
  passed: boolean;
  output: string;
  assertions: AssertionResult[];
  /** Request succeeded but the model returned no text at all */
  empty: boolean;
  error?: string;
}

export type Capability = "json_mode" | "tools";

export interface CapabilityResult {
  capability: Capability;
  /** The provider advertises support in its model metadata */
  claimed: boolean;
  /** The model actually did it when asked */
  actual: boolean;
  error?: string;
}

export interface QualityResult {
  modelId: string;
  tasks: TaskResult[];
  /** Fraction of tasks passed, 0..1 */
  score: number;
  capabilities: CapabilityResult[];
  /** Tasks where the model answered with no text — see REASONING_MIN_TOKENS */
  emptyOutputs: number;
}

export const DEFAULT_TASK_MAX_TOKENS = 64;

/**
 * Floor on the output budget for reasoning models. A reasoning model spends
 * its allowance on thinking before it writes anything, so the small budgets
 * the tasks ask for return `content: null` and score zero across the board —
 * a measurement artefact, not a bad model. Reasoning is switched off where the
 * provider supports it; this floor covers the models that ignore that.
 */
export const REASONING_MIN_TOKENS = 512;

function budgetFor(model: ModelDef, taskMaxTokens: number): number {
  return model.hasReasoning ? Math.max(taskMaxTokens, REASONING_MIN_TOKENS) : taskMaxTokens;
}

// ── Output normalisation ───────────────────────────────────────────────────────

/**
 * Models wrap answers in markdown fences, quotes and trailing punctuation even
 * when told not to. Strip that shell before comparing, so formatting noise is
 * not scored as a wrong answer — the format assertions test structure through
 * regexes on their own terms.
 */
export function normalize(text: string): string {
  let out = text.trim();
  out = out.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
  out = out.trim();
  out = out.replace(/^["'`]+/, "").replace(/["'`]+$/, "");
  return out.replace(/\s+/g, " ").trim();
}

function forEquality(text: string): string {
  return normalize(text)
    .toLowerCase()
    .replace(/[.!?]+$/, "")
    .trim();
}

export function countWords(text: string): number {
  const cleaned = normalize(text)
    .replace(/[.,!?;:()"']/g, " ")
    .trim();
  return cleaned === "" ? 0 : cleaned.split(/\s+/).length;
}

/** Pull the first JSON object out of a response, fenced or not. */
export function extractJson(text: string): unknown {
  const candidate = normalize(text);
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

// ── Assertions ─────────────────────────────────────────────────────────────────

export function evaluate(assertion: Assertion, output: string): AssertionResult {
  switch (assertion.type) {
    case "equals": {
      const actual = forEquality(output);
      const expected = forEquality(assertion.value);
      return actual === expected
        ? { assertion, passed: true }
        : { assertion, detail: `expected "${expected}", got "${actual}"`, passed: false };
    }
    case "includes": {
      const passed = normalize(output).toLowerCase().includes(assertion.value.toLowerCase());
      return passed
        ? { assertion, passed: true }
        : { assertion, detail: `missing "${assertion.value}"`, passed: false };
    }
    case "regex": {
      let re: RegExp;
      try {
        re = new RegExp(assertion.pattern, assertion.flags ?? "i");
      } catch {
        return { assertion, detail: `invalid pattern ${assertion.pattern}`, passed: false };
      }
      const passed = re.test(normalize(output));
      return passed
        ? { assertion, passed: true }
        : { assertion, detail: `no match for /${assertion.pattern}/`, passed: false };
    }
    case "json": {
      const parsed = extractJson(output);
      if (parsed === undefined || parsed === null || typeof parsed !== "object") {
        return { assertion, detail: "not valid JSON", passed: false };
      }
      const missing = (assertion.requiredKeys ?? []).filter(
        (key) => !Object.hasOwn(parsed as Record<string, unknown>, key),
      );
      return missing.length === 0
        ? { assertion, passed: true }
        : { assertion, detail: `missing keys: ${missing.join(", ")}`, passed: false };
    }
    case "wordCount": {
      const count = countWords(output);
      const tooFew = assertion.min !== undefined && count < assertion.min;
      const tooMany = assertion.max !== undefined && count > assertion.max;
      return tooFew || tooMany
        ? { assertion, detail: `${count} words`, passed: false }
        : { assertion, passed: true };
    }
    case "notEmpty": {
      const passed = normalize(output) !== "";
      return passed ? { assertion, passed: true } : { assertion, detail: "empty", passed: false };
    }
  }
}

export function scoreTask(task: QualityTask, output: string): TaskResult {
  const assertions = task.assertions.map((a) => evaluate(a, output));
  return {
    assertions,
    empty: normalize(output) === "",
    output,
    passed: assertions.every((a) => a.passed),
    taskId: task.id,
  };
}

// ── Capability probes ──────────────────────────────────────────────────────────

const CAPABILITY_CLAIMS: Record<Capability, string[]> = {
  json_mode: ["response_format", "structured_outputs", "json_mode"],
  tools: ["tools", "tool_choice", "tool_calls"],
};

export function claimsCapability(model: ModelDef, capability: Capability): boolean {
  const claims = CAPABILITY_CLAIMS[capability];
  return model.supportedParameters.some((p) => claims.includes(p));
}

const WEATHER_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  function: {
    description: "Get the current temperature for a city",
    name: "get_weather",
    parameters: {
      properties: { city: { type: "string" } },
      required: ["city"],
      type: "object",
    },
  },
  type: "function",
};

async function probeCapability(
  client: OpenAI,
  model: ModelDef,
  capability: Capability,
  timeoutMs: number,
  retries: number,
): Promise<CapabilityResult> {
  const claimed = claimsCapability(model, capability);

  try {
    const result = await withRetry(
      () =>
        capability === "json_mode"
          ? complete(client, {
              disableReasoning: model.hasReasoning,
              json: true,
              maxTokens: budgetFor(model, 64),
              model: model.id,
              prompt: 'Return a JSON object with a single key "ok" set to true.',
              stream: false,
              timeoutMs,
            })
          : complete(client, {
              disableReasoning: model.hasReasoning,
              maxTokens: budgetFor(model, 64),
              model: model.id,
              prompt: "What is the temperature in Paris right now? Use the available tool.",
              stream: false,
              timeoutMs,
              tools: [WEATHER_TOOL],
            }),
      { retries },
    );

    const actual =
      capability === "json_mode" ? extractJson(result.text) !== undefined : result.toolCalls > 0;
    return { actual, capability, claimed };
  } catch (err) {
    // A provider that rejects the request outright (400 "tools not supported")
    // is a clear negative, not a measurement failure.
    return { actual: false, capability, claimed, error: classifyError(err).message };
  }
}

// ── Runner ─────────────────────────────────────────────────────────────────────

export interface QualityOptions {
  tasks?: QualityTask[];
  capabilities?: Capability[];
  timeoutMs: number;
  retries: number;
}

export async function runQuality(
  client: OpenAI,
  model: ModelDef,
  options: QualityOptions,
  onTaskComplete?: (result: TaskResult, index: number, total: number) => void,
): Promise<QualityResult> {
  const tasks = options.tasks ?? DEFAULT_TASKS;
  const results: TaskResult[] = [];

  for (const [index, task] of tasks.entries()) {
    let result: TaskResult;
    try {
      const completion = await withRetry(
        () =>
          complete(client, {
            disableReasoning: model.hasReasoning,
            maxTokens: budgetFor(model, task.maxTokens ?? DEFAULT_TASK_MAX_TOKENS),
            model: model.id,
            prompt: task.prompt,
            stream: false,
            timeoutMs: options.timeoutMs,
          }),
        { retries: options.retries },
      );
      result = scoreTask(task, completion.text);
    } catch (err) {
      // A task we could not run counts as a failure: an unreachable model is
      // not a model that scores well.
      result = {
        assertions: [],
        empty: true,
        error: classifyError(err).message,
        output: "",
        passed: false,
        taskId: task.id,
      };
    }
    results.push(result);
    onTaskComplete?.(result, index + 1, tasks.length);
  }

  const capabilities: CapabilityResult[] = [];
  for (const capability of options.capabilities ?? ["json_mode", "tools"]) {
    capabilities.push(
      await probeCapability(client, model, capability, options.timeoutMs, options.retries),
    );
  }

  return {
    capabilities,
    emptyOutputs: results.filter((r) => r.empty && r.error === undefined).length,
    modelId: model.id,
    score: results.length === 0 ? 0 : results.filter((r) => r.passed).length / results.length,
    tasks: results,
  };
}
