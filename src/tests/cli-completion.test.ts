import { describe, expect, test } from "bun:test";
import { completionProgramName, generateZshCompletion } from "../cli/completion";
import type { CommandGroup } from "../cli/types";

const groups: CommandGroup[] = [
  {
    commands: [
      {
        description: "Delete things: now",
        flags: [
          { description: "GitHub repo (owner/repo)", name: "repo", required: true, type: "string" },
          { description: "Actually delete", name: "execute", type: "boolean" },
        ],
        name: "purge-tags",
        run: () => {},
      },
    ],
    description: "GitHub maintenance",
    name: "github",
  },
];

describe("completionProgramName", () => {
  test("uses the last word of the bin name", () => {
    expect(completionProgramName("bun run tools")).toBe("tools");
    expect(completionProgramName("tools")).toBe("tools");
    expect(completionProgramName("")).toBe("tools");
  });
});

describe("generateZshCompletion", () => {
  const script = generateZshCompletion(groups, "tools");

  test("emits a compdef header and function bound to the program name", () => {
    expect(script.startsWith("#compdef tools")).toBe(true);
    expect(script).toContain("_tools() {");
    expect(script).toContain('_tools "$@"');
  });

  test("lists groups and commands", () => {
    expect(script).toContain("'github:GitHub maintenance'");
    expect(script).toContain("'purge-tags:Delete things");
  });

  test("emits kebab-case flag specs including --help and --interactive", () => {
    expect(script).toContain("'--repo[GitHub repo (owner/repo)]'");
    expect(script).toContain("'--execute[Actually delete]'");
    expect(script).toContain("'--help[Show help]'");
    expect(script).toContain("'--interactive[Launch interactive TUI]'");
  });

  test("sanitizes colons that would break _describe specs", () => {
    // "Delete things: now" → colon replaced so the value:description split is safe
    expect(script).not.toContain("Delete things: now");
    expect(script).toContain("Delete things - now");
  });
});
