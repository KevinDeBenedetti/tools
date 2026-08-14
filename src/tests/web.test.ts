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

describe("env redaction", () => {
  test("a secret is recognisable but not reusable", () => {
    const key = "sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789";
    const masked = maskSecret(key);

    expect(masked).toStartWith("sk-or-");
    expect(masked).toInclude("6789");
    expect(masked).toInclude(`${key.length} chars`);
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
    expect(() => setOverride("OPENAI_API_KEY", "sk-or-v1-abc\ndef")).toThrow(/whitespace/);
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
    setOverride("OPENAI_API_KEY", "sk-or-v1-abcdefghijkl");
    setOverride("OPENAI_API_KEY", "");
    expect(overrideEnv()).toEqual({});
  });
});

describe("describeEnv", () => {
  beforeEach(() => clearOverrides());

  test("never carries a raw secret", () => {
    const secret = "sk-or-v1-thisisthewholekey0123456789";
    const serialized = JSON.stringify(
      describeEnv({ GITHUB_TOKEN: secret, OPENAI_API_KEY: secret }),
    );

    expect(serialized).not.toInclude(secret);
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
