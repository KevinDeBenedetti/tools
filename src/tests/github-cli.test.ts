import { describe, expect, test } from "bun:test";
import { allGroups } from "../cli/registry";
import { githubGroup } from "../github/commands";

const commandNames = githubGroup.commands.map((c) => c.name);

describe("githubGroup", () => {
  test("exposes all maintenance commands", () => {
    expect(commandNames).toEqual([
      "clean-authors",
      "detect-bots",
      "purge-actions",
      "purge-packages",
      "purge-release",
      "purge-tags",
      "scan-secrets",
    ]);
  });

  test("destructive commands require --execute instead of defaulting to deletion", () => {
    for (const name of ["purge-actions", "purge-packages", "purge-release", "purge-tags"]) {
      const cmd = githubGroup.commands.find((c) => c.name === name)!;
      const execute = cmd.flags.find((f) => f.name === "execute");
      expect(execute, `${name} must declare --execute`).toBeDefined();
      expect(execute?.type).toBe("boolean");
      expect(execute?.default).toBeUndefined();
    }
  });

  test("purge commands require a repo with GITHUB_REPOSITORY fallback", () => {
    for (const name of ["purge-actions", "purge-packages", "purge-release", "purge-tags"]) {
      const cmd = githubGroup.commands.find((c) => c.name === name)!;
      const repo = cmd.flags.find((f) => f.name === "repo");
      expect(repo?.required).toBe(true);
      expect(repo?.env).toBe("GITHUB_REPOSITORY");
    }
  });

  test("clean-authors keeps repo optional (defaults to cwd) and has a custom wizard", () => {
    const cmd = githubGroup.commands.find((c) => c.name === "clean-authors")!;
    const repo = cmd.flags.find((f) => f.name === "repo");
    expect(repo?.required).toBeUndefined();
    expect(cmd.interactive).toBeDefined();
  });
});

describe("registry", () => {
  test("includes all command groups with unique names", () => {
    const names = allGroups.map((g) => g.name);
    expect(names).toEqual(["github", "todo", "benchmark", "copilot"]);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every command declares a description and flags", () => {
    for (const group of allGroups) {
      for (const cmd of group.commands) {
        expect(cmd.description.length, `${group.name} ${cmd.name}`).toBeGreaterThan(0);
        expect(Array.isArray(cmd.flags), `${group.name} ${cmd.name}`).toBe(true);
      }
    }
  });

  test("flag names are camelCase and unique per command", () => {
    for (const group of allGroups) {
      for (const cmd of group.commands) {
        const names = cmd.flags.map((f) => f.name);
        expect(new Set(names).size, `${group.name} ${cmd.name}`).toBe(names.length);
        for (const name of names) {
          expect(name, `${group.name} ${cmd.name} --${name}`).not.toContain("-");
        }
      }
    }
  });
});
