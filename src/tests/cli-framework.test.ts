import { afterEach, describe, expect, test } from "bun:test";
import { runCli } from "../cli/dispatch";
import {
  buildCommandPreview,
  formatCommandHelp,
  formatGeneralHelp,
  formatGroupHelp,
} from "../cli/help";
import { parseArgs, resolveOptions, toCamelCase, toKebabCase } from "../cli/parse";
import { levenshtein, nearest } from "../cli/suggest";
import type { CommandGroup, CommandSpec } from "../cli/types";

describe("parseArgs", () => {
  test("parses positionals, flags, and values", () => {
    expect(parseArgs(["detect-bots", "--local", "--dry-run", "--format", "json"])).toEqual({
      help: false,
      interactive: false,
      options: { dryRun: true, format: "json", local: true },
      positionals: ["detect-bots"],
    });
  });

  test("parses repeated flags into arrays", () => {
    expect(parseArgs(["--pattern", "a", "--pattern=b"]).options).toEqual({ pattern: ["a", "b"] });
  });

  test("parses key=value syntax and boolean literals", () => {
    expect(parseArgs(["--repo=owner/repo", "--local=false"]).options).toEqual({
      local: false,
      repo: "owner/repo",
    });
  });

  test("coerces numeric literals", () => {
    expect(parseArgs(["--keep-latest", "5"]).options).toEqual({ keepLatest: 5 });
  });

  test("marks help and interactive flags", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-i"]).interactive).toBe(true);
  });

  test("collects multiple positionals", () => {
    expect(parseArgs(["github", "purge-tags", "--repo", "o/r"]).positionals).toEqual([
      "github",
      "purge-tags",
    ]);
  });
});

describe("case helpers", () => {
  test("kebab and camel round-trip", () => {
    expect(toCamelCase("keep-latest")).toBe("keepLatest");
    expect(toKebabCase("keepLatest")).toBe("keep-latest");
  });
});

describe("suggest", () => {
  test("levenshtein measures edit distance", () => {
    expect(levenshtein("purge-tag", "purge-tags")).toBe(1);
    expect(levenshtein("same", "same")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
  });

  test("nearest returns the closest candidate within the threshold", () => {
    expect(nearest("purge-tag", ["purge-tags", "purge-release"])).toBe("purge-tags");
    expect(nearest("xyzzy", ["purge-tags", "detect-bots"])).toBeUndefined();
  });
});

function makeSpec(overrides: Partial<CommandSpec> = {}): CommandSpec {
  return {
    description: "test command",
    flags: [],
    name: "cmd",
    run: () => {},
    ...overrides,
  };
}

describe("resolveOptions", () => {
  afterEach(() => {
    delete process.env["CLI_TEST_REPO"];
  });

  test("applies declared defaults", () => {
    const spec = makeSpec({
      flags: [{ default: 3, description: "runs", name: "runs", type: "number" }],
    });
    expect(resolveOptions(spec, {})).toEqual({ runs: 3 });
  });

  test("falls back to env vars before defaults", () => {
    process.env["CLI_TEST_REPO"] = "octo/env";
    const spec = makeSpec({
      flags: [
        { description: "repo", env: "CLI_TEST_REPO", name: "repo", required: true, type: "string" },
      ],
    });
    expect(resolveOptions(spec, {})).toEqual({ repo: "octo/env" });
    expect(resolveOptions(spec, { repo: "octo/flag" })).toEqual({ repo: "octo/flag" });
  });

  test("throws an actionable error for missing required flags", () => {
    const spec = makeSpec({
      flags: [
        { description: "repo", env: "CLI_TEST_REPO", name: "repo", required: true, type: "string" },
      ],
    });
    expect(() => resolveOptions(spec, {})).toThrow("--repo (or set CLI_TEST_REPO)");
  });

  test("coerces string[] from comma-separated values and numbers from strings", () => {
    const spec = makeSpec({
      flags: [
        { description: "models", name: "models", type: "string[]" },
        { description: "runs", name: "runs", type: "number" },
      ],
    });
    expect(resolveOptions(spec, { models: "a,b", runs: "4" })).toEqual({
      models: ["a", "b"],
      runs: 4,
    });
  });
});

describe("help formatters", () => {
  const group: CommandGroup = {
    commands: [
      makeSpec({
        flags: [
          { description: "the repo", env: "REPO", name: "repo", required: true, type: "string" },
          { default: 0, description: "keep n", name: "keepLatest", type: "number" },
        ],
        name: "purge",
      }),
    ],
    description: "test group",
    name: "grp",
  };

  test("general help lists groups and commands", () => {
    const help = formatGeneralHelp([group]);
    expect(help).toContain("grp purge");
    expect(help).toContain("test group");
  });

  test("group help lists commands with prefix", () => {
    const help = formatGroupHelp(group, "bun run grp");
    expect(help).toContain("bun run grp [command]");
    expect(help).toContain("purge");
  });

  test("command help shows kebab-case flags, required marker, env and default", () => {
    const help = formatCommandHelp(group.commands[0]!, "bun run grp");
    expect(help).toContain("--repo");
    expect(help).toContain("(required)");
    expect(help).toContain("[env: REPO]");
    expect(help).toContain("--keep-latest");
    expect(help).toContain("[0]");
  });
});

describe("buildCommandPreview", () => {
  test("serializes flags back to kebab-case", () => {
    expect(buildCommandPreview("github", "detect-bots", { dryRun: true, local: true })).toBe(
      "bun run tools github detect-bots --dry-run --local",
    );
  });

  test("omits false and undefined, quotes spaces, expands arrays", () => {
    expect(
      buildCommandPreview("g", "c", { msg: "hello world", off: false, pattern: ["a", "b"] }),
    ).toBe('bun run tools g c --msg "hello world" --pattern a --pattern b');
  });
});

describe("runCli", () => {
  const calls: Record<string, unknown>[] = [];

  function makeGroups(): CommandGroup[] {
    return [
      {
        commands: [
          makeSpec({
            flags: [{ default: "x", description: "value", name: "value", type: "string" }],
            name: "do",
            run: (options) => {
              calls.push(options);
            },
          }),
        ],
        description: "alpha group",
        name: "alpha",
      },
      {
        commands: [
          makeSpec({
            name: "solo",
            run: (options) => {
              calls.push({ solo: true, ...options });
            },
          }),
        ],
        description: "single-command group",
        name: "beta",
      },
    ];
  }

  afterEach(() => {
    calls.length = 0;
    process.exitCode = 0;
  });

  test("dispatches group + command with resolved options", async () => {
    await runCli(["alpha", "do", "--value", "y"], { groups: makeGroups(), isTTY: false });
    expect(calls).toEqual([{ value: "y" }]);
  });

  test("applies flag defaults when omitted", async () => {
    await runCli(["alpha", "do"], { groups: makeGroups(), isTTY: false });
    expect(calls).toEqual([{ value: "x" }]);
  });

  test("defaultGroup pins positionals to commands", async () => {
    await runCli(["do"], { defaultGroup: "alpha", groups: makeGroups(), isTTY: false });
    expect(calls).toEqual([{ value: "x" }]);
  });

  test("single-command groups run without naming the command", async () => {
    await runCli(["beta"], { groups: makeGroups(), isTTY: false });
    expect(calls).toEqual([{ solo: true }]);
  });

  test("unknown command sets a failure exit code", async () => {
    await runCli(["alpha", "nope"], { groups: makeGroups(), isTTY: false });
    expect(process.exitCode).toBe(1);
    expect(calls).toEqual([]);
  });

  test("suggests the nearest command on a typo", async () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (msg?: unknown) => {
      errors.push(String(msg));
    };
    try {
      await runCli(["beta", "sol"], { groups: makeGroups(), isTTY: false });
    } finally {
      console.error = original;
    }
    expect(errors.join("\n")).toContain("Did you mean 'solo'?");
    expect(process.exitCode).toBe(1);
  });

  test("completion zsh prints a compdef script for the root CLI", async () => {
    const out: string[] = [];
    const original = console.log;
    console.log = (msg?: unknown) => {
      out.push(String(msg));
    };
    try {
      await runCli(["completion", "zsh"], { groups: makeGroups(), isTTY: false });
    } finally {
      console.log = original;
    }
    const script = out.join("\n");
    expect(script).toContain("#compdef tools");
    expect(script).toContain("'alpha:alpha group'");
  });

  test("run() errors are reported as a failure exit code", async () => {
    const groups: CommandGroup[] = [
      {
        commands: [
          makeSpec({
            name: "boom",
            run: () => {
              throw new Error("kaboom");
            },
          }),
        ],
        description: "g",
        name: "g",
      },
    ];
    await runCli(["g", "boom"], { groups, isTTY: false });
    expect(process.exitCode).toBe(1);
  });
});
