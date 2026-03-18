import { describe, expect, test } from "bun:test";
import {
  buildCommandPreview,
  formatCommandHelp,
  formatGeneralHelp,
  parseCliInput,
  shouldUseInteractive,
} from "../github/cli";

describe("parseCliInput", () => {
  test("parses command, flags, and values", () => {
    expect(
      parseCliInput([
        "detect-bots",
        "--local",
        "--dry-run",
        "--format",
        "json",
      ]),
    ).toEqual({
      command: "detect-bots",
      help: false,
      interactive: false,
      options: { dryRun: true, format: "json", local: true },
    });
  });

  test("parses repeated flags into arrays", () => {
    expect(
      parseCliInput(["scan-secrets", "--pattern", "a", "--pattern=b"]),
    ).toEqual({
      command: "scan-secrets",
      help: false,
      interactive: false,
      options: { pattern: ["a", "b"] },
    });
  });

  test("parses key=value syntax", () => {
    expect(parseCliInput(["purge-actions", "--repo=owner/repo"])).toEqual({
      command: "purge-actions",
      help: false,
      interactive: false,
      options: { repo: "owner/repo" },
    });
  });

  test("marks help flag", () => {
    expect(parseCliInput(["purge-tags", "--help"])).toEqual({
      command: "purge-tags",
      help: true,
      interactive: false,
      options: {},
    });
  });

  test("marks -h shorthand as help", () => {
    expect(parseCliInput(["-h"])).toEqual({
      command: undefined,
      help: true,
      interactive: false,
      options: {},
    });
  });

  test("marks interactive flag", () => {
    expect(parseCliInput(["--interactive"])).toEqual({
      command: undefined,
      help: false,
      interactive: true,
      options: {},
    });
  });

  test("parses boolean false values", () => {
    expect(parseCliInput(["detect-bots", "--dry-run=false"])).toEqual({
      command: "detect-bots",
      help: false,
      interactive: false,
      options: { dryRun: false },
    });
  });

  test("throws on unexpected positional after command", () => {
    expect(() => parseCliInput(["detect-bots", "extra"])).toThrow();
  });
});

describe("formatGeneralHelp", () => {
  test("contains all command names", () => {
    const help = formatGeneralHelp();
    expect(help).toContain("GitHub TypeScript CLI");
    expect(help).toContain("detect-bots");
    expect(help).toContain("purge-actions");
    expect(help).toContain("purge-packages");
    expect(help).toContain("purge-release");
    expect(help).toContain("purge-tags");
    expect(help).toContain("scan-secrets");
  });
});

describe("formatCommandHelp", () => {
  test("contains command description and usage", () => {
    const help = formatCommandHelp("purge-actions");
    expect(help).toContain("Delete GitHub Actions workflow runs");
    expect(help).toContain("bun run github:purge-actions");
  });
});

describe("shouldUseInteractive", () => {
  test("returns true when TTY and no command", () => {
    expect(shouldUseInteractive(parseCliInput([]), true)).toBe(true);
  });

  test("returns false when help flag is set", () => {
    expect(shouldUseInteractive(parseCliInput(["--help"]), true)).toBe(false);
  });

  test("returns true when --interactive is set", () => {
    expect(shouldUseInteractive(parseCliInput(["--interactive"]), true)).toBe(
      true,
    );
  });

  test("returns false when not a TTY", () => {
    expect(shouldUseInteractive(parseCliInput([]), false)).toBe(false);
  });

  test("returns false when command is provided", () => {
    expect(shouldUseInteractive(parseCliInput(["detect-bots"]), true)).toBe(
      false,
    );
  });
});

describe("buildCommandPreview", () => {
  test("renders boolean flags", () => {
    expect(
      buildCommandPreview("detect-bots", { dryRun: true, local: true }),
    ).toBe("bun run github:detect-bots -- --dry-run --local");
  });

  test("quotes values with spaces", () => {
    expect(
      buildCommandPreview("purge-actions", {
        repo: "owner/repo",
        workflow: "ci main",
      }),
    ).toBe(
      'bun run github:purge-actions -- --repo owner/repo --workflow "ci main"',
    );
  });

  test("renders no args when options empty", () => {
    expect(buildCommandPreview("scan-secrets", {})).toBe(
      "bun run github:scan-secrets",
    );
  });

  test("omits false boolean flags", () => {
    expect(buildCommandPreview("detect-bots", { dryRun: false })).toBe(
      "bun run github:detect-bots",
    );
  });

  test("renders array values", () => {
    const preview = buildCommandPreview("scan-secrets", {
      patterns: ["ghp_", "sk-"],
    });
    expect(preview).toContain("--patterns ghp_");
    expect(preview).toContain("--patterns sk-");
  });
});
