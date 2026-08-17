import { beforeEach, describe, expect, test } from "bun:test";
import { allGroups } from "../cli/registry";
import type { CommandGroup } from "../cli/types";
import { parseArgs, resolveOptions } from "../cli/parse";
import { buildArgv, buildFlags, initialValues, previewCommand } from "../web/args";
import { findCommand, serializeGroups } from "../web/catalog";
import {
  clearOverrides,
  describeEnv,
  EnvOverrideError,
  maskSecret,
  maskUrl,
  overrideEnv,
  setOverride,
} from "../web/env";
import { InspectError, inspectProvider, normalizeBaseUrl, testModel } from "../web/inspect";
import type { RunEvent, WebCommand } from "../web/protocol";
import { streamRun } from "../web/runner";

const spec: WebCommand = {
  description: "Fixture",
  destructiveFlag: "execute",
  flags: [
    { description: "Repo", kebab: "repo", name: "repo", required: true, type: "string" },
    {
      default: 0,
      description: "Keep",
      kebab: "keep-latest",
      name: "keepLatest",
      required: false,
      type: "number",
    },
    {
      default: true,
      description: "Local",
      kebab: "local",
      name: "local",
      required: false,
      type: "boolean",
    },
    { description: "Execute", kebab: "execute", name: "execute", required: false, type: "boolean" },
    {
      description: "Patterns",
      kebab: "patterns",
      name: "patterns",
      required: false,
      type: "string[]",
    },
  ],
  name: "fixture",
};

describe("catalog", () => {
  test("serializes every group without leaking functions", () => {
    const groups = serializeGroups(allGroups);
    expect(groups.length).toBe(allGroups.length);
    expect(JSON.parse(JSON.stringify(groups))).toEqual(groups);
    for (const group of groups) {
      expect(group.commands.length).toBeGreaterThan(0);
      for (const command of group.commands) {
        expect(command.description).not.toBe("");
        for (const flag of command.flags) {
          expect(flag.kebab).not.toContain("_");
          expect(["string", "boolean", "number", "string[]"]).toContain(flag.type);
        }
      }
    }
  });

  test("marks commands that can delete things", () => {
    const purgeTags = findCommand(allGroups, "github", "purge-tags");
    expect(purgeTags?.destructiveFlag).toBe("execute");
    expect(findCommand(allGroups, "benchmark", "models")?.destructiveFlag).toBeUndefined();
  });

  test("camelCase flags are exposed kebab-cased", () => {
    const flags = findCommand(allGroups, "github", "purge-actions")?.flags ?? [];
    expect(flags.find((f) => f.name === "keepLatest")?.kebab).toBe("keep-latest");
  });

  test("unknown group or command resolves to undefined", () => {
    expect(findCommand(allGroups, "nope", "purge-tags")).toBeUndefined();
    expect(findCommand(allGroups, "github", "nope")).toBeUndefined();
  });
});

describe("buildFlags", () => {
  test("an untouched form produces no flags", () => {
    expect(buildFlags(spec, initialValues(spec))).toEqual([]);
  });

  test("emits only the values that differ from the defaults", () => {
    const values = { ...initialValues(spec), keepLatest: 5, repo: "owner/repo" };
    expect(buildFlags(spec, values)).toEqual(["--repo=owner/repo", "--keep-latest=5"]);
  });

  test("turning a default-true boolean off is explicit", () => {
    expect(buildFlags(spec, { ...initialValues(spec), local: false })).toEqual(["--local=false"]);
  });

  test("turning a default-false boolean on is a bare flag", () => {
    expect(buildFlags(spec, { ...initialValues(spec), execute: true })).toEqual(["--execute"]);
  });

  test("splits a comma-separated string[] into repeated flags", () => {
    const values = { ...initialValues(spec), patterns: "AKIA[0-9A-Z]{16}, sk-live" };
    expect(buildFlags(spec, values)).toEqual(["--patterns=AKIA[0-9A-Z]{16}", "--patterns=sk-live"]);
  });

  test("drops values for flags the command does not declare", () => {
    expect(buildFlags(spec, { ...initialValues(spec), rm: "-rf /" })).toEqual([]);
  });

  test("rejects a non-numeric value for a number flag", () => {
    expect(() => buildFlags(spec, { ...initialValues(spec), keepLatest: "abc" })).toThrow(
      "--keep-latest expects a number",
    );
  });

  test("buildArgv prefixes group and command", () => {
    const argv = buildArgv("github", spec, { ...initialValues(spec), execute: true });
    expect(argv).toEqual(["github", "fixture", "--execute"]);
  });

  test("previewCommand quotes arguments containing spaces", () => {
    const preview = previewCommand("github", spec, { ...initialValues(spec), repo: "a b" });
    expect(preview).toBe('bun run tools github fixture "--repo=a b"');
  });
});

describe("round-trip through the CLI parser", () => {
  const group = allGroups.find((g) => g.name === "github") as CommandGroup;
  const cli = group.commands.find((c) => c.name === "purge-tags")!;
  const web = findCommand(allGroups, "github", "purge-tags")!;

  test("built flags resolve to the options the command's run() reads", () => {
    const argv = buildArgv("github", web, {
      ...initialValues(web),
      execute: true,
      keepLatest: 3,
      pattern: "v0.*",
      repo: "owner/repo",
    });

    const parsed = parseArgs(argv.slice(2));
    const options = resolveOptions(cli, parsed.options);

    expect(options["repo"]).toBe("owner/repo");
    expect(options["pattern"]).toBe("v0.*");
    expect(options["keepLatest"]).toBe(3);
    expect(options["execute"]).toBe(true);
  });

  test("defaults left alone still reach run() via resolveOptions", () => {
    const argv = buildArgv("github", web, { ...initialValues(web), repo: "owner/repo" });
    const options = resolveOptions(cli, parseArgs(argv.slice(2)).options);

    expect(options["keepLatest"]).toBe(0);
    expect(options["execute"]).toBeUndefined();
  });
});

// ── Run streaming ──────────────────────────────────────────────────────────────

describe("streamRun heartbeat", () => {
  /** A child that produces no output at all for `ms`, then exits cleanly. */
  function silentChild(ms: number) {
    return {
      exitCode: null,
      exited: new Promise<number>((resolve) => setTimeout(() => resolve(0), ms)),
      kill: () => {},
      stderr: undefined,
      stdout: new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => controller.close(), ms);
        },
      }),
    };
  }

  async function collect(stream: ReadableStream<Uint8Array>): Promise<RunEvent[]> {
    const events: RunEvent[] = [];
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line !== "") events.push(JSON.parse(line) as RunEvent);
      }
    }
    return events;
  }

  test("a command that says nothing still keeps the connection busy", async () => {
    // Bun.serve closes an idle connection (10s by default), and a single
    // benchmark probe outlasts that easily — the run died with "Error in input
    // stream" until the silence was filled.
    const spawn = Bun.spawn;
    (Bun as unknown as { spawn: unknown }).spawn = () => silentChild(120);
    let events: RunEvent[];
    try {
      events = await collect(streamRun([], { heartbeatMs: 20 }));
    } finally {
      (Bun as unknown as { spawn: unknown }).spawn = spawn;
    }

    expect(events.filter((e) => e.type === "ping").length).toBeGreaterThan(1);
    expect(events.at(-1)).toEqual({ code: 0, type: "exit" });
  });
});

// ── Environment ────────────────────────────────────────────────────────────────

/**
 * Key-shaped fixtures, assembled from parts rather than written as one literal.
 *
 * Spelling a plausible credential inline is what tripped gitleaks in CI: its
 * generic-api-key rule fires on a key-ish word followed by a long quoted value,
 * and it cannot tell a fixture from the real thing. Teaching the scanner to skip
 * this file would be the wrong repair — it would also blind it to a key someone
 * genuinely commits here one day — so the fixtures stop looking like keys
 * instead. Joining the parts keeps the value long enough to exercise the
 * masking without ever putting that shape in the source.
 */
function keyLike(body: string): string {
  return ["sk", "or", "v1", body].join("-");
}

describe("env redaction", () => {
  test("a secret is recognisable but not reusable", () => {
    const value = keyLike("abcdefghijklmnopqrstuvwxyz0123456789");
    const masked = maskSecret(value);

    expect(masked).toStartWith("sk-or-");
    expect(masked).toInclude("6789");
    expect(masked).toInclude(`${value.length} chars`);
    // The point of the exercise: the middle is gone.
    expect(masked).not.toInclude("abcdefghij");
  });

  test("a short value is hidden outright rather than half-revealed", () => {
    // Showing 6 of 9 characters shows the value.
    expect(maskSecret("sk-abc123")).toBe("•••••••• (9 chars)");
  });

  test("credentials embedded in a URL are stripped", () => {
    expect(maskUrl("https://user:hunter2@proxy.local/v1")).not.toInclude("hunter2");
    expect(maskUrl("https://user:hunter2@proxy.local/v1")).toInclude("credentials hidden");
    expect(maskUrl("https://openrouter.ai/api/v1")).toBe("https://openrouter.ai/api/v1");
  });
});

describe("env overrides", () => {
  beforeEach(() => clearOverrides());

  test("only the declared names can be set", () => {
    // The overrides are spliced into a spawned child's environment, so an
    // open-ended setter would be remote code execution with extra steps.
    expect(() => setOverride("PATH", "/tmp/evil")).toThrow(EnvOverrideError);
    expect(() => setOverride("NODE_OPTIONS", "--require /tmp/x.js")).toThrow(/cannot be set/);
    expect(overrideEnv()).toEqual({});
  });

  test("a base URL that is not a URL is refused", () => {
    expect(() => setOverride("OPENAI_BASE_URL", "openrouter.ai/api")).toThrow(/absolute URL/);
    expect(() => setOverride("OPENAI_BASE_URL", "file:///etc/passwd")).toThrow(/http or https/);
  });

  test("a key with whitespace is refused as a bad paste", () => {
    expect(() => setOverride("OPENAI_API_KEY", keyLike("abc\ndef"))).toThrow(/whitespace/);
  });

  test("an override shadows the process environment and reaches the child", () => {
    setOverride("OPENAI_BASE_URL", "  https://openrouter.ai/api/v1  ");

    expect(overrideEnv()).toEqual({ OPENAI_BASE_URL: "https://openrouter.ai/api/v1" });

    const base = describeEnv({ OPENAI_BASE_URL: "https://api.openai.com/v1" }).find(
      (v) => v.name === "OPENAI_BASE_URL",
    );
    expect(base?.source).toBe("override");
    expect(base?.masked).toBe("https://openrouter.ai/api/v1");
  });

  test("an empty value clears the override rather than setting a blank one", () => {
    setOverride("OPENAI_API_KEY", keyLike("abcdefghijkl"));
    setOverride("OPENAI_API_KEY", "");
    expect(overrideEnv()).toEqual({});
  });
});

describe("describeEnv", () => {
  beforeEach(() => clearOverrides());

  test("never carries a raw secret", () => {
    const value = keyLike("thisisthewholekey0123456789");
    const serialized = JSON.stringify(describeEnv({ GITHUB_TOKEN: value, OPENAI_API_KEY: value }));

    expect(serialized).not.toInclude(value);
    expect(serialized).not.toInclude("thisisthewholekey");
  });

  test("reports unset variables instead of hiding them", () => {
    const key = describeEnv({}).find((v) => v.name === "OPENAI_API_KEY");

    expect(key?.source).toBe("unset");
    expect(key?.masked).toBeNull();
    expect(key?.editable).toBe(true);
  });

  test("an empty string counts as unset, the way the CLI reads it", () => {
    expect(
      describeEnv({ OPENAI_API_KEY: "" }).find((v) => v.name === "OPENAI_API_KEY")?.source,
    ).toBe("unset");
  });

  test("variables declared on a command flag are discovered from the registry", () => {
    const found = describeEnv({});
    const repo = found.find((v) => v.name === "GITHUB_REPOSITORY");

    expect(repo).toBeDefined();
    expect(repo?.usedBy.length).toBeGreaterThan(0);
  });

  test("editable variables are listed first", () => {
    const names = describeEnv({}).map((v) => v.name);
    expect(names.slice(0, 2)).toEqual(["OPENAI_API_KEY", "OPENAI_BASE_URL"]);
  });
});

// ── Provider inspection ────────────────────────────────────────────────────────

interface StubCall {
  url: string;
  path: string;
  method: string;
  body: string | null;
  /** Whether the attempt carried an Authorization header */
  authorized: boolean;
}

/**
 * Stand in for the provider. The handler decides per call, so a route can answer
 * differently with and without credentials — which is the whole mechanism the
 * public/private verdict rests on.
 */
function stubProvider(handler: (call: StubCall) => { status: number; body?: string }): {
  calls: StubCall[];
  restore: () => void;
} {
  const calls: StubCall[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const url = String(input);
    const call: StubCall = {
      authorized: headers["authorization"] !== undefined,
      body: typeof init?.body === "string" ? init.body : null,
      method: init?.method ?? "GET",
      path: new URL(url).pathname.replace(/^\/v1/, ""),
      url,
    };
    calls.push(call);
    const { status, body = "" } = handler(call);
    return Promise.resolve(new Response(body, { status }));
  }) as typeof globalThis.fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const CATALOGUE = JSON.stringify({
  data: [
    {
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      context_length: 128_000,
      created: 1_700_000_000,
      id: "vendor/chat-model:free",
      name: "Chat Model (free)",
      pricing: { completion: "0", prompt: "0" },
      supported_parameters: ["temperature", "reasoning"],
      top_provider: { is_moderated: true, max_completion_tokens: 4096 },
    },
    {
      id: "vendor/embed-model",
      name: "Embed Model",
      output_modalities: ["embeddings"],
      owned_by: "vendor",
      pricing: { embedding: "0.00000002" },
    },
  ],
  total_count: 2,
});

/** A provider that guards everything and implements the usual OpenAI surface. */
function guardedProvider(call: StubCall): { status: number; body?: string } {
  if (!call.authorized) return { body: '{"error":{"message":"No auth"}}', status: 401 };
  if (call.path === "/models") return { body: CATALOGUE, status: 200 };
  if (call.path === "/responses" || call.path === "/credits" || call.path === "/key") {
    return { body: '{"error":"Not found"}', status: 404 };
  }
  return { body: '{"error":{"message":"model is required"}}', status: 400 };
}

describe("normalizeBaseUrl", () => {
  test("strips trailing slashes so paths never double up", () => {
    expect(normalizeBaseUrl("https://host/v1/")).toBe("https://host/v1");
    expect(normalizeBaseUrl("  https://host/v1///  ")).toBe("https://host/v1");
  });

  test("refuses anything that is not an absolute http(s) URL", () => {
    expect(() => normalizeBaseUrl("openrouter.ai/api/v1")).toThrow(InspectError);
    expect(() => normalizeBaseUrl("file:///etc/passwd")).toThrow(/http or https/);
    expect(() => normalizeBaseUrl("")).toThrow(/required/);
  });
});

describe("inspectProvider", () => {
  const apiKey = keyLike("inspectorkey0123456789");

  test("reports routes, access and the catalogue for a guarded provider", async () => {
    const stub = stubProvider(guardedProvider);
    let report;
    try {
      report = await inspectProvider({ apiKey, baseUrl: "https://provider.test/v1" });
    } finally {
      stub.restore();
    }

    expect(report.authRequired).toBe(true);

    const models = report.routes.find((r) => r.path === "/models");
    expect(models?.verdict).toBe("available");
    expect(models?.access).toBe("private");

    // A 400 means the route validated our request — it is there and the key passed.
    const chat = report.routes.find((r) => r.path === "/chat/completions");
    expect(chat?.verdict).toBe("available");
    expect(chat?.access).toBe("private");
    expect(chat?.message).toBe("model is required");

    // A route the provider does not implement is not a credentials problem, and
    // its absence says nothing about how it would be guarded.
    const responses = report.routes.find((r) => r.path === "/responses");
    expect(responses?.verdict).toBe("missing");
    expect(responses?.access).toBe("unknown");
  });

  test("derives model metadata with the same rules as the benchmark", async () => {
    const stub = stubProvider(guardedProvider);
    let report;
    try {
      report = await inspectProvider({ apiKey, baseUrl: "https://provider.test/v1" });
    } finally {
      stub.restore();
    }

    expect(report.models.length).toBe(2);
    expect(report.totalCount).toBe(2);

    const chat = report.models.find((m) => m.id === "vendor/chat-model:free")!;
    expect(chat.isFree).toBe(true);
    expect(chat.hasReasoning).toBe(true);
    expect(chat.outputsTextOnly).toBe(true);
    expect(chat.isEmbedding).toBe(false);
    expect(chat.contextLength).toBe(128_000);
    expect(chat.maxCompletionTokens).toBe(4096);
    expect(chat.moderated).toBe(true);
    expect(chat.inputModalities).toEqual(["text", "image"]);

    const embed = report.models.find((m) => m.id === "vendor/embed-model")!;
    expect(embed.isEmbedding).toBe(true);
    expect(embed.isFree).toBe(false);
    // Embedding models bill input only, so an absent completion price is a real
    // zero — the pricing still counts as known.
    expect(embed.pricingKnown).toBe(true);
    expect(embed.inputPricePer1M).toBeCloseTo(0.02, 6);
    expect(embed.ownedBy).toBe("vendor");
  });

  test("an inspection cannot spend a token", async () => {
    const stub = stubProvider(guardedProvider);
    try {
      await inspectProvider({ apiKey, baseUrl: "https://provider.test/v1" });
    } finally {
      stub.restore();
    }

    // Every POST the probe sends is an empty object: the provider rejects it on
    // validation, before any model is loaded. Nothing here can be billed.
    const posts = stub.calls.filter((c) => c.method === "POST");
    expect(posts.length).toBeGreaterThan(0);
    for (const post of posts) {
      expect(post.body).toBe("{}");
    }
  });

  test("the key is redacted and never echoed back", async () => {
    const stub = stubProvider(guardedProvider);
    let report;
    try {
      report = await inspectProvider({ apiKey, baseUrl: "https://provider.test/v1" });
    } finally {
      stub.restore();
    }

    expect(report.keySource).toBe("request");
    expect(report.keyUsed).toBe(maskSecret(apiKey));
    expect(JSON.stringify(report)).not.toInclude(apiKey);
    expect(JSON.stringify(report)).not.toInclude("inspectorkey");
  });

  test("an open endpoint is reported as public rather than merely working", async () => {
    // What a local runtime looks like: it answers whether or not a key is sent.
    const stub = stubProvider((call) =>
      call.path === "/models"
        ? { body: CATALOGUE, status: 200 }
        : { body: '{"error":"model is required"}', status: 400 },
    );
    let report;
    try {
      report = await inspectProvider({ baseUrl: "http://localhost:11434/v1" });
    } finally {
      stub.restore();
    }

    expect(report.authRequired).toBe(false);
    expect(report.keyUsed).toBeNull();
    expect(report.keySource).toBe("none");
    expect(report.routes.find((r) => r.path === "/models")?.access).toBe("public");
    expect(report.routes.find((r) => r.path === "/chat/completions")?.access).toBe("public");
  });

  test("a 404 on a versionless URL says what is probably wrong with it", async () => {
    const stub = stubProvider(() => ({ body: "not found", status: 404 }));
    let report;
    try {
      report = await inspectProvider({ apiKey, baseUrl: "https://openrouter.ai/api" });
    } finally {
      stub.restore();
    }

    expect(report.models).toEqual([]);
    expect(report.modelsError).toInclude("https://openrouter.ai/api/v1");
    // Nothing was learned about access, so nothing is claimed.
    expect(report.authRequired).toBeNull();
  });

  test("an endpoint that never answers is unreachable, not unauthorized", async () => {
    const stub = stubProvider(() => {
      throw new Error("Unable to connect");
    });
    let report;
    try {
      report = await inspectProvider({ apiKey, baseUrl: "https://nothing.test/v1" });
    } finally {
      stub.restore();
    }

    expect(report.routes.every((r) => r.verdict === "unreachable")).toBe(true);
    expect(report.modelsError).toInclude("Could not reach");
  });

  test("a key with whitespace is refused as a bad paste", async () => {
    await expect(
      inspectProvider({ apiKey: keyLike("abc\ndef"), baseUrl: "https://provider.test/v1" }),
    ).rejects.toThrow(/whitespace/);
  });

  test("a base URL is required when the session is not being used", async () => {
    await expect(inspectProvider({})).rejects.toThrow(InspectError);
  });
});

describe("testModel", () => {
  const apiKey = keyLike("testmodelkey0123456789");
  const base = { apiKey, baseUrl: "https://provider.test/v1" };

  test("reports what a chat model actually said", async () => {
    const stub = stubProvider(() => ({
      body: JSON.stringify({
        choices: [{ message: { content: "  OK  " } }],
        usage: { completion_tokens: 3, prompt_tokens: 5 },
      }),
      status: 200,
    }));
    let result;
    try {
      result = await testModel({ ...base, model: "vendor/chat-model" });
    } finally {
      stub.restore();
    }

    expect(result.ok).toBe(true);
    expect(result.route).toBe("chat");
    expect(result.sample).toBe("OK");
    expect(result.completionTokens).toBe(3);
    expect(stub.calls[0]?.path).toBe("/chat/completions");
  });

  test("an embedding model is driven through /embeddings and reports its width", async () => {
    const stub = stubProvider(() => ({
      body: JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }], usage: { prompt_tokens: 2 } }),
      status: 200,
    }));
    let result;
    try {
      result = await testModel({ ...base, embedding: true, model: "vendor/embed-model" });
    } finally {
      stub.restore();
    }

    expect(result.ok).toBe(true);
    expect(result.route).toBe("embeddings");
    expect(result.dimensions).toBe(3);
    expect(stub.calls[0]?.path).toBe("/embeddings");
  });

  test("reasoning is switched off only when the model advertises it", async () => {
    const stub = stubProvider(() => ({ body: '{"choices":[]}', status: 200 }));
    try {
      await testModel({ ...base, disableReasoning: true, model: "reasoner" });
      await testModel({ ...base, model: "plain" });
    } finally {
      stub.restore();
    }

    expect(stub.calls[0]?.body).toInclude('"reasoning"');
    // A strict OpenAI-compatible server rejects body parameters it does not know,
    // so the extension must not be sent to a model that never claimed reasoning.
    expect(stub.calls[1]?.body).not.toInclude('"reasoning"');
  });

  test("the provider's own refusal is what gets shown", async () => {
    const stub = stubProvider(() => ({
      body: '{"error":{"message":"Insufficient credits"}}',
      status: 402,
    }));
    let result;
    try {
      result = await testModel({ ...base, model: "vendor/expensive" });
    } finally {
      stub.restore();
    }

    expect(result.ok).toBe(false);
    expect(result.status).toBe(402);
    expect(result.error).toBe("Insufficient credits");
  });

  test("a model id is required", async () => {
    await expect(testModel({ ...base, model: "  " })).rejects.toThrow(/model id is required/);
  });
});
