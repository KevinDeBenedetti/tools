import { describe, expect, mock, test } from "bun:test";
import type { ICopilotClient, IGitHubClient } from "../../shared/types/copilot";
import { GenerateService } from "./generate.service";

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

function fakeGitHub(
  diff = "diff --git a/src/index.ts b/src/index.ts\n+added",
  fileContent = "file content here",
): IGitHubClient {
  return {
    createReview: mock(async () => {}),
    getPRFiles: mock(async () => []),
    getPRDiff: mock(async () => diff),
    getFileContent: mock(async () => fileContent),
  };
}

const REPO = { owner: "octo", repo: "tools" };
const VALID_TEMPLATE_JSON = JSON.stringify({
  description: "Adds streaming",
  changeType: "feature",
  testingApproach: "Run tests",
  impactAreas: [],
  breakingChanges: [],
});

// ── Type routing ───────────────────────────────────────────────────────────────

describe("GenerateService — type routing", () => {
  test("summary: calls copilot.complete with summary system prompt", async () => {
    const copilot = fakeCopilot("The summary");
    const service = new GenerateService(copilot, fakeGitHub());

    const result = await service.generate(REPO, 1, { type: "summary", format: "markdown" });

    expect(result).toBe("The summary");
    expect(copilot.complete).toHaveBeenCalledTimes(1);
    const [systemPrompt] = (copilot.complete as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      string,
    ];
    expect(systemPrompt).toContain("Summarize the changes");
  });

  test("changelog: system prompt contains Keep a Changelog", async () => {
    const copilot = fakeCopilot("## [1.0.0]");
    const service = new GenerateService(copilot, fakeGitHub());

    await service.generate(REPO, 1, { type: "changelog", format: "markdown" });

    const [systemPrompt] = (copilot.complete as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      string,
    ];
    expect(systemPrompt).toContain("Keep a Changelog");
  });

  test("docs: system prompt contains documentation", async () => {
    const copilot = fakeCopilot("# Docs");
    const service = new GenerateService(copilot, fakeGitHub());

    await service.generate(REPO, 1, { type: "docs", format: "markdown" });

    const [systemPrompt] = (copilot.complete as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      string,
    ];
    expect(systemPrompt.toLowerCase()).toContain("documentation");
  });

  test("tests: system prompt mentions unit tests", async () => {
    const copilot = fakeCopilot("describe('x', ...)");
    const service = new GenerateService(copilot, fakeGitHub());

    await service.generate(REPO, 1, { type: "tests", format: "markdown" });

    const [systemPrompt] = (copilot.complete as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      string,
    ];
    expect(systemPrompt.toLowerCase()).toContain("test");
  });

  test("template: routes to TemplateService and returns auto-fill comment", async () => {
    const copilot = fakeCopilot(VALID_TEMPLATE_JSON); // structured fields response
    const service = new GenerateService(copilot, fakeGitHub());

    const result = await service.generate(
      REPO,
      5,
      { type: "template", format: "markdown" },
      "feat: streaming",
    );

    expect(result).toContain("## 🤖 Copilot PR Auto-fill");
  });

  test("template without prTitle: returns explicit warning message", async () => {
    const service = new GenerateService(fakeCopilot(), fakeGitHub());

    const result = await service.generate(
      REPO,
      5,
      { type: "template", format: "markdown" },
      undefined,
    );

    expect(result).toContain("⚠️");
    expect(result).toContain("pull request context");
  });

  test("template without prNumber: returns explicit warning message", async () => {
    const service = new GenerateService(fakeCopilot(), fakeGitHub());

    const result = await service.generate(
      REPO,
      undefined,
      { type: "template", format: "markdown" },
      "feat: x",
    );

    expect(result).toContain("⚠️");
    expect(result).toContain("pull request context");
  });

  test("template without both prNumber and prTitle: returns explicit warning", async () => {
    const service = new GenerateService(fakeCopilot(), fakeGitHub());

    const result = await service.generate(REPO, undefined, {
      type: "template",
      format: "markdown",
    });

    expect(result).toContain("⚠️");
  });
});

// ── Context sources ────────────────────────────────────────────────────────────

describe("GenerateService — context sources", () => {
  test("uses getPRDiff when prNumber is provided", async () => {
    const github = fakeGitHub("my diff content");
    const copilot = fakeCopilot("summary");
    const service = new GenerateService(copilot, github);

    await service.generate(REPO, 7, { type: "summary", format: "markdown" });

    expect(github.getPRDiff).toHaveBeenCalledWith("octo", "tools", 7);
    const [, userPrompt] = (copilot.complete as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      string,
    ];
    expect(userPrompt).toContain("my diff content");
  });

  test("uses getFileContent when filePath provided and no prNumber", async () => {
    const github = fakeGitHub("diff", "file source code here");
    const copilot = fakeCopilot("docs");
    const service = new GenerateService(copilot, github);

    await service.generate(REPO, undefined, {
      type: "docs",
      format: "markdown",
      filePath: "src/auth.ts",
    });

    expect(github.getFileContent).toHaveBeenCalledWith("octo", "tools", "src/auth.ts");
    const [, userPrompt] = (copilot.complete as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      string,
    ];
    expect(userPrompt).toContain("file source code here");
  });

  test("prefers prNumber over filePath when both are provided", async () => {
    const github = fakeGitHub("pr diff");
    const copilot = fakeCopilot("summary");
    const service = new GenerateService(copilot, github);

    await service.generate(REPO, 3, {
      type: "summary",
      format: "markdown",
      filePath: "src/auth.ts",
    });

    expect(github.getPRDiff).toHaveBeenCalled();
    expect(github.getFileContent).not.toHaveBeenCalled();
  });

  test("uses 'No code context provided' when no prNumber and no filePath", async () => {
    const copilot = fakeCopilot("fallback summary");
    const service = new GenerateService(copilot, fakeGitHub());

    await service.generate(REPO, undefined, { type: "summary", format: "markdown" });

    const [, userPrompt] = (copilot.complete as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      string,
    ];
    expect(userPrompt).toBe("No code context provided.");
  });
});

// ── Prompt construction ────────────────────────────────────────────────────────

describe("GenerateService — prompt construction", () => {
  test("includes custom instructions in system prompt when provided", async () => {
    const copilot = fakeCopilot("output");
    const service = new GenerateService(copilot, fakeGitHub());

    await service.generate(REPO, 1, {
      type: "summary",
      format: "markdown",
      instructions: "Focus on security implications",
    });

    const [systemPrompt] = (copilot.complete as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      string,
    ];
    expect(systemPrompt).toContain("Focus on security implications");
  });

  test("does NOT add format hint for markdown output", async () => {
    const copilot = fakeCopilot("md output");
    const service = new GenerateService(copilot, fakeGitHub());

    await service.generate(REPO, 1, { type: "summary", format: "markdown" });

    const [systemPrompt] = (copilot.complete as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      string,
    ];
    expect(systemPrompt).not.toContain("Output format");
  });

  test("adds format hint for non-markdown output", async () => {
    const copilot = fakeCopilot("ts output");
    const service = new GenerateService(copilot, fakeGitHub());

    await service.generate(REPO, 1, { type: "tests", format: "typescript" });

    const [systemPrompt] = (copilot.complete as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      string,
    ];
    expect(systemPrompt).toContain("Output format: typescript");
  });

  test("adds format hint for json output", async () => {
    const copilot = fakeCopilot("{}");
    const service = new GenerateService(copilot, fakeGitHub());

    await service.generate(REPO, 1, { type: "summary", format: "json" });

    const [systemPrompt] = (copilot.complete as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      string,
    ];
    expect(systemPrompt).toContain("Output format: json");
  });

  test("system prompt always starts with base expert engineer context", async () => {
    const copilot = fakeCopilot("output");
    const service = new GenerateService(copilot, fakeGitHub());

    await service.generate(REPO, 1, { type: "summary", format: "markdown" });

    const [systemPrompt] = (copilot.complete as ReturnType<typeof mock>).mock.calls[0] as [
      string,
      string,
    ];
    expect(systemPrompt).toContain("expert software engineer");
  });
});
