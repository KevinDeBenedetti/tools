import { describe, expect, test } from "bun:test";
import { allGroups } from "../cli/registry";
import type { CommandGroup } from "../cli/types";
import { parseArgs, resolveOptions } from "../cli/parse";
import { buildArgv, buildFlags, initialValues, previewCommand } from "../web/args";
import { findCommand, serializeGroups } from "../web/catalog";
import type { WebCommand } from "../web/protocol";

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
