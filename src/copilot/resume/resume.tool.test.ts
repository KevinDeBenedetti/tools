import { describe, expect, test, mock } from "bun:test";
import type {
  ICopilotClient,
  IGitHubClient,
  ILogger,
  ToolContext,
} from "../../shared/types/copilot";
import { ResumeTool } from "./index";

// ── Fakes ──────────────────────────────────────────────────────────────────────

async function* fakeStream(): AsyncGenerator<string> {
  yield "streamed";
}

function fakeCopilot(response = "Copilot reply"): ICopilotClient {
  return {
    complete: mock(async () => response),
    resumeAndComplete: mock(async () => response),
    stream: mock(() => fakeStream()),
  };
}

function fakeGitHub(diff = "diff --git a/src/index.ts b/src/index.ts"): IGitHubClient {
  return {
    createReview: mock(async () => {}),
    getFileContent: mock(async () => ""),
    getPRDiff: mock(async () => diff),
    getPRFiles: mock(async () => []),
  };
}

const fakeLogger: ILogger = {
  debug: mock(() => {}),
  error: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
};

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    copilot: fakeCopilot(),
    github: fakeGitHub(),
    logger: fakeLogger,
    options: { prompt: "Any issues?" },
    prNumber: 7,
    repo: { owner: "octo", repo: "tools" },
    token: "fake-token",
    ...overrides,
  };
}

// ── ResumeTool tests ───────────────────────────────────────────────────────────

describe("ResumeTool", () => {
  test("returns success with response and sessionId in outputs", async () => {
    const copilot = fakeCopilot("All good.");
    const result = await new ResumeTool().run(makeCtx({ copilot }));

    expect(result.success).toBe(true);
    expect(result.outputs?.sessionId).toBe("pr-7");
    expect(result.outputs?.response).toBe("All good.");
    expect(result.summary).toContain("pr-7");
  });

  test("uses explicit sessionId from options when provided", async () => {
    const copilot = fakeCopilot("Custom session reply.");
    const result = await new ResumeTool().run(
      makeCtx({ copilot, options: { prompt: "Follow up.", sessionId: "my-session" } }),
    );

    expect(result.outputs?.sessionId).toBe("my-session");
    expect(copilot.resumeAndComplete).toHaveBeenCalledWith(
      "my-session",
      expect.any(String),
      "Follow up.",
    );
  });

  test("defaults sessionId to 'pr-session' when no prNumber", async () => {
    const copilot = fakeCopilot("No PR.");
    const result = await new ResumeTool().run(
      makeCtx({ copilot, options: { prompt: "Hi." }, prNumber: undefined }),
    );

    expect(result.outputs?.sessionId).toBe("pr-session");
  });

  test("passes focus through to resumeAndComplete system prompt", async () => {
    const copilot = fakeCopilot("Security focused reply.");
    await new ResumeTool().run(
      makeCtx({ copilot, options: { focus: "security", prompt: "Check auth." } }),
    );

    expect(copilot.resumeAndComplete).toHaveBeenCalledWith(
      "pr-7",
      expect.stringContaining("security"),
      "Check auth.",
    );
  });

  test("fetches PR diff and includes it in system prompt", async () => {
    const github = fakeGitHub("- removed line\n+ added line");
    const copilot = fakeCopilot("Diff seen.");
    await new ResumeTool().run(makeCtx({ copilot, github }));

    expect(github.getPRDiff).toHaveBeenCalledWith("octo", "tools", 7);
    expect(copilot.resumeAndComplete).toHaveBeenCalledWith(
      "pr-7",
      expect.stringContaining("- removed line"),
      "Any issues?",
    );
  });

  test("summary includes response character count", async () => {
    const copilot = fakeCopilot("Hello!");
    const result = await new ResumeTool().run(makeCtx({ copilot }));

    expect(result.summary).toContain("6 characters");
  });

  test("throws when prompt option is missing", async () => {
    await expect(new ResumeTool().run(makeCtx({ options: {} }))).rejects.toThrow();
  });
});
