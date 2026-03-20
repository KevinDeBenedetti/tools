import { describe, expect, mock, test } from "bun:test";
import type { ICopilotClient, IGitHubClient } from "../../shared/types/copilot";
import { TemplateService } from "./template.service";

// ── Fake factories ─────────────────────────────────────────────────────────────

function fakeCopilot(response = "Copilot response"): ICopilotClient {
  return {
    complete: mock(async () => response),
    resumeAndComplete: mock(async () => response),
    stream: mock(async function* () {
      yield response;
    }),
  };
}

/**
 * Builds a fake GitHub client.
 * `templateContent`: map of path → content string (throws if path not in map).
 */
function fakeGitHub(
  diff = "diff --git a/src/index.ts b/src/index.ts\n+added line",
  templateContent: Record<string, string> = {},
): IGitHubClient {
  return {
    createReview: mock(async () => {}),
    getPRFiles: mock(async () => []),
    getPRDiff: mock(async () => diff),
    getFileContent: mock(async (_owner, _repo, path) => {
      if (path in templateContent) return templateContent[path];
      throw new Error(`Not found: ${path}`);
    }),
  };
}

const REPO = { owner: "octo", repo: "tools" };
const PR_TITLE = "feat: add streaming chat";
const PR_NUMBER = 42;

const VALID_JSON_RESPONSE = JSON.stringify({
  description: "Adds streaming chat feature",
  changeType: "feature",
  testingApproach: "Run bun test",
  impactAreas: ["src/chat/"],
  breakingChanges: [],
});

// ── generateTemplateFields ─────────────────────────────────────────────────────

describe("TemplateService.generateTemplateFields", () => {
  test("fetches diff and template path in parallel (both API calls made)", async () => {
    const github = fakeGitHub("diff content", {
      ".github/PULL_REQUEST_TEMPLATE.md": "## Description\n\n## Type",
    });
    const copilot = fakeCopilot("filled template content");
    const service = new TemplateService(copilot, github);

    await service.generateTemplateFields(REPO, PR_NUMBER, PR_TITLE);

    expect(github.getPRDiff).toHaveBeenCalledWith("octo", "tools", PR_NUMBER);
    expect(github.getFileContent).toHaveBeenCalledWith(
      "octo",
      "tools",
      ".github/PULL_REQUEST_TEMPLATE.md",
    );
  });

  test("returns filledTemplate when PR template found and Copilot fills it", async () => {
    const github = fakeGitHub("diff", {
      ".github/PULL_REQUEST_TEMPLATE.md": "## Description\n",
    });
    const copilot = fakeCopilot("## Description\nAdds streaming.");
    const service = new TemplateService(copilot, github);

    const result = await service.generateTemplateFields(REPO, PR_NUMBER, PR_TITLE);

    expect(result.filledTemplate).toBe("## Description\nAdds streaming.");
  });

  test("does NOT call generateStructuredFields (no extra Copilot call) when template is filled", async () => {
    const github = fakeGitHub("diff", {
      ".github/PULL_REQUEST_TEMPLATE.md": "## Description\n",
    });
    const copilot = fakeCopilot("filled content");
    const service = new TemplateService(copilot, github);

    await service.generateTemplateFields(REPO, PR_NUMBER, PR_TITLE);

    // fillTemplate calls copilot.complete exactly once — no extra call for structured fields
    expect(copilot.complete).toHaveBeenCalledTimes(1);
  });

  test("falls back to generateStructuredFields when fillTemplate throws", async () => {
    const github = fakeGitHub("diff", {
      ".github/PULL_REQUEST_TEMPLATE.md": "## Description\n",
    });
    let callCount = 0;
    const copilot: ICopilotClient = {
      complete: mock(async () => {
        callCount++;
        if (callCount === 1) throw new Error("Copilot API error");
        return VALID_JSON_RESPONSE;
      }),
      resumeAndComplete: mock(async () => ""),
      stream: mock(async function* () {}),
    };
    const service = new TemplateService(copilot, github);

    const result = await service.generateTemplateFields(REPO, PR_NUMBER, PR_TITLE);

    expect(result.filledTemplate).toBeUndefined();
    expect(result.description).toBe("Adds streaming chat feature");
  });

  test("returns structured fields (no filledTemplate) when no template found in repo", async () => {
    const github = fakeGitHub("diff"); // no template paths configured
    const copilot = fakeCopilot(VALID_JSON_RESPONSE);
    const service = new TemplateService(copilot, github);

    const result = await service.generateTemplateFields(REPO, PR_NUMBER, PR_TITLE);

    expect(result.filledTemplate).toBeUndefined();
    expect(result.description).toBe("Adds streaming chat feature");
    expect(result.changeType).toBe("feature");
  });

  test("tries all 3 template paths before returning null (no template)", async () => {
    const github = fakeGitHub("diff"); // no templates
    const copilot = fakeCopilot(VALID_JSON_RESPONSE);
    const service = new TemplateService(copilot, github);

    await service.generateTemplateFields(REPO, PR_NUMBER, PR_TITLE);

    expect(github.getFileContent).toHaveBeenCalledTimes(3);
    expect(github.getFileContent).toHaveBeenCalledWith(
      "octo",
      "tools",
      ".github/PULL_REQUEST_TEMPLATE.md",
    );
    expect(github.getFileContent).toHaveBeenCalledWith("octo", "tools", "PULL_REQUEST_TEMPLATE.md");
    expect(github.getFileContent).toHaveBeenCalledWith(
      "octo",
      "tools",
      "docs/PULL_REQUEST_TEMPLATE.md",
    );
  });

  test("stops at the first found template path (does not try subsequent paths)", async () => {
    const github = fakeGitHub("diff", {
      ".github/PULL_REQUEST_TEMPLATE.md": "## First template",
    });
    const copilot = fakeCopilot("filled content");
    const service = new TemplateService(copilot, github);

    await service.generateTemplateFields(REPO, PR_NUMBER, PR_TITLE);

    // Should stop after finding first path
    expect(github.getFileContent).toHaveBeenCalledTimes(1);
  });

  test("uses root-level template when .github/ path not found", async () => {
    const github = fakeGitHub("diff", {
      "PULL_REQUEST_TEMPLATE.md": "## Root template",
    });
    const copilot = fakeCopilot("## Root template filled");
    const service = new TemplateService(copilot, github);

    const result = await service.generateTemplateFields(REPO, PR_NUMBER, PR_TITLE);

    expect(result.filledTemplate).toBe("## Root template filled");
    expect(github.getFileContent).toHaveBeenCalledTimes(2); // tried .github/ first, then root
  });

  test("passes PR title and diff in context to fillTemplate", async () => {
    const github = fakeGitHub("my diff content", {
      ".github/PULL_REQUEST_TEMPLATE.md": "## Template",
    });
    const copilot = fakeCopilot("filled");
    const service = new TemplateService(copilot, github);

    await service.generateTemplateFields(REPO, PR_NUMBER, "my pr title");

    const [, userPrompt] = (copilot.complete as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      string,
    ];
    expect(userPrompt).toContain("my pr title");
    expect(userPrompt).toContain("my diff content");
    expect(userPrompt).toContain("## Template");
  });

  test("falls back to heuristic fields when Copilot JSON is invalid (no template)", async () => {
    const github = fakeGitHub("diff");
    const copilot = fakeCopilot("not valid json at all");
    const service = new TemplateService(copilot, github);

    const result = await service.generateTemplateFields(REPO, PR_NUMBER, "fix: crash bug");

    expect(result.changeType).toBe("bug");
    expect(result.description).toContain("fix: crash bug");
    expect(result.filledTemplate).toBeUndefined();
  });
});

// ── formatAsMarkdown ───────────────────────────────────────────────────────────

describe("TemplateService.formatAsMarkdown", () => {
  const baseFields = {
    description: "Some description",
    changeType: "feature" as const,
    testingApproach: "Run tests",
    impactAreas: [],
    breakingChanges: [],
  };

  test("renders filled-template mode when filledTemplate is set", () => {
    const service = new TemplateService(fakeCopilot(), fakeGitHub());
    const output = service.formatAsMarkdown({
      ...baseFields,
      filledTemplate: "## Description\nMy filled content",
    });

    expect(output).toContain("## 🤖 Copilot PR Auto-fill");
    expect(output).toContain("## Description\nMy filled content");
    expect(output).toContain("Copy the content below into your PR description");
  });

  test("trims whitespace from filledTemplate", () => {
    const service = new TemplateService(fakeCopilot(), fakeGitHub());
    const output = service.formatAsMarkdown({ ...baseFields, filledTemplate: "  \n\ncontent\n  " });
    expect(output).toContain("\ncontent\n");
    expect(output).not.toMatch(/^\s+content/);
  });

  test("renders structured mode when no filledTemplate", () => {
    const service = new TemplateService(fakeCopilot(), fakeGitHub());
    const output = service.formatAsMarkdown(baseFields);

    expect(output).toContain("## 🤖 Copilot PR Auto-fill");
    expect(output).toContain("No PR template was found");
    expect(output).toContain("Some description");
    expect(output).toContain("✨ `feature`");
    expect(output).toContain("Run tests");
  });

  test("includes impact areas section when present — no triple newline", () => {
    const service = new TemplateService(fakeCopilot(), fakeGitHub());
    const output = service.formatAsMarkdown({
      ...baseFields,
      impactAreas: ["src/auth/", "src/api/"],
    });

    expect(output).toContain("**📌 Potential Impact Areas**");
    expect(output).toContain("- src/auth/");
    expect(output).toContain("- src/api/");
    expect(output).not.toContain("\n\n\n"); // no triple newline
  });

  test("includes breaking changes section when present — no triple newline", () => {
    const service = new TemplateService(fakeCopilot(), fakeGitHub());
    const output = service.formatAsMarkdown({
      ...baseFields,
      breakingChanges: ["Removed X", "Renamed Y"],
    });

    expect(output).toContain("**⚠️ Breaking Changes**");
    expect(output).toContain("- Removed X");
    expect(output).toContain("- Renamed Y");
    expect(output).not.toContain("\n\n\n");
  });

  test("omits impact areas section when array is empty", () => {
    const service = new TemplateService(fakeCopilot(), fakeGitHub());
    const output = service.formatAsMarkdown({ ...baseFields, impactAreas: [] });
    expect(output).not.toContain("Potential Impact Areas");
  });

  test("omits breaking changes section when array is empty", () => {
    const service = new TemplateService(fakeCopilot(), fakeGitHub());
    const output = service.formatAsMarkdown({ ...baseFields, breakingChanges: [] });
    expect(output).not.toContain("Breaking Changes");
  });

  test("renders correct emoji for each changeType", () => {
    const service = new TemplateService(fakeCopilot(), fakeGitHub());
    const cases: [string, string][] = [
      ["bug", "🐛"],
      ["feature", "✨"],
      ["refactor", "🔄"],
      ["docs", "📚"],
      ["perf", "⚡"],
      ["breaking", "🚨"],
    ];
    for (const [type, emoji] of cases) {
      const output = service.formatAsMarkdown({
        ...baseFields,
        changeType: type as typeof baseFields.changeType,
      });
      expect(output).toContain(emoji);
    }
  });
});

// ── normalizeChangeType ────────────────────────────────────────────────────────

describe("TemplateService — normalizeChangeType (via generateStructuredFields)", () => {
  const validTypes = ["bug", "feature", "refactor", "docs", "perf", "breaking"] as const;

  for (const type of validTypes) {
    test(`passes "${type}" through unchanged`, async () => {
      const github = fakeGitHub("diff");
      const copilot = fakeCopilot(
        JSON.stringify({ ...JSON.parse(VALID_JSON_RESPONSE), changeType: type }),
      );
      const service = new TemplateService(copilot, github);
      const result = await service.generateTemplateFields(REPO, PR_NUMBER, "feat: something");
      expect(result.changeType).toBe(type);
    });
  }

  test("defaults to feature for unknown type", async () => {
    const github = fakeGitHub("diff");
    const copilot = fakeCopilot(
      JSON.stringify({ ...JSON.parse(VALID_JSON_RESPONSE), changeType: "unknown-type" }),
    );
    const service = new TemplateService(copilot, github);
    const result = await service.generateTemplateFields(REPO, PR_NUMBER, "something");
    expect(result.changeType).toBe("feature");
  });

  test("is case-insensitive (BUG → bug)", async () => {
    const github = fakeGitHub("diff");
    const copilot = fakeCopilot(
      JSON.stringify({ ...JSON.parse(VALID_JSON_RESPONSE), changeType: "BUG" }),
    );
    const service = new TemplateService(copilot, github);
    const result = await service.generateTemplateFields(REPO, PR_NUMBER, "something");
    expect(result.changeType).toBe("bug");
  });
});

// ── getFallbackFields (keyword detection) ─────────────────────────────────────

describe("TemplateService — getFallbackFields keyword detection", () => {
  async function getFallback(title: string) {
    // Trigger fallback by returning invalid JSON
    const github = fakeGitHub("diff");
    const copilot = fakeCopilot("not json");
    const service = new TemplateService(copilot, github);
    return service.generateTemplateFields(REPO, PR_NUMBER, title);
  }

  test("detects bug from 'fix' keyword", async () => {
    const result = await getFallback("fix: crash on startup");
    expect(result.changeType).toBe("bug");
  });

  test("detects refactor from 'refactor' keyword", async () => {
    const result = await getFallback("refactor: clean up auth module");
    expect(result.changeType).toBe("refactor");
  });

  test("detects docs from 'docs' keyword", async () => {
    const result = await getFallback("docs: update README");
    expect(result.changeType).toBe("docs");
  });

  test("detects perf from 'perf' keyword", async () => {
    const result = await getFallback("perf: reduce bundle size");
    expect(result.changeType).toBe("perf");
  });

  test("detects breaking from 'breaking' keyword", async () => {
    const result = await getFallback("breaking: remove deprecated API");
    expect(result.changeType).toBe("breaking");
  });

  test("defaults to feature when no keyword matches", async () => {
    const result = await getFallback("add new streaming capability");
    expect(result.changeType).toBe("feature");
  });

  test("first keyword wins — 'fix' before 'refactor' in else-if chain", async () => {
    // 'fix' appears first in the else-if chain so 'fix-refactor' → bug
    const result = await getFallback("fix-refactor: restructure auth");
    expect(result.changeType).toBe("bug");
  });

  test("includes PR title in description", async () => {
    const result = await getFallback("my special PR title");
    expect(result.description).toContain("my special PR title");
  });
});

// ── parseJsonResponse (via generateStructuredFields) ──────────────────────────

describe("TemplateService — JSON parsing", () => {
  test("extracts JSON from markdown code block in Copilot response", async () => {
    const jsonWithMarkdown = `\`\`\`json\n${VALID_JSON_RESPONSE}\n\`\`\``;
    const github = fakeGitHub("diff");
    const copilot = fakeCopilot(jsonWithMarkdown);
    const service = new TemplateService(copilot, github);

    const result = await service.generateTemplateFields(REPO, PR_NUMBER, PR_TITLE);
    expect(result.description).toBe("Adds streaming chat feature");
  });

  test("falls back gracefully when Copilot returns no JSON at all", async () => {
    const github = fakeGitHub("diff");
    const copilot = fakeCopilot("Sorry, I cannot help with that.");
    const service = new TemplateService(copilot, github);

    const result = await service.generateTemplateFields(REPO, PR_NUMBER, PR_TITLE);
    // getFallbackFields used — description contains title
    expect(result.description).toContain(PR_TITLE);
  });

  test("defaults missing impactAreas to empty array", async () => {
    const partial = JSON.stringify({ description: "d", changeType: "bug", testingApproach: "t" });
    const github = fakeGitHub("diff");
    const copilot = fakeCopilot(partial);
    const service = new TemplateService(copilot, github);

    const result = await service.generateTemplateFields(REPO, PR_NUMBER, PR_TITLE);
    expect(result.impactAreas).toEqual([]);
    expect(result.breakingChanges).toEqual([]);
  });

  test("defaults missing description to placeholder", async () => {
    const partial = JSON.stringify({
      changeType: "bug",
      testingApproach: "t",
      impactAreas: [],
      breakingChanges: [],
    });
    const github = fakeGitHub("diff");
    const copilot = fakeCopilot(partial);
    const service = new TemplateService(copilot, github);

    const result = await service.generateTemplateFields(REPO, PR_NUMBER, PR_TITLE);
    expect(result.description).toBe("PR description");
  });
});
