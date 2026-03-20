import { describe, expect, test, mock } from "bun:test";
import { ReviewService } from "../copilot/review/review.service";
import { AuditService } from "../copilot/audit/audit.service";
import { ResumeService } from "../copilot/resume/resume.service";
import type { ICopilotClient, IGitHubClient } from "../shared/types/copilot";

async function* fakeStream(response: string): AsyncGenerator<string> {
  yield response;
}

function mockCopilot(response: string): ICopilotClient {
  return {
    complete: mock(async () => response),
    resumeAndComplete: mock(async () => response),
    stream: mock(() => fakeStream(response)),
  };
}

function mockGitHub(diff = "diff --git a/file.ts b/file.ts"): IGitHubClient {
  return {
    createReview: mock(async () => {}),
    getFileContent: mock(async () => "// file content"),
    getPRDiff: mock(async () => diff),
    getPRFiles: mock(async () => []),
  };
}

const VALID_REVIEW_JSON = JSON.stringify([
  { path: "src/index.ts", line: 10, body: "Consider using const here." },
]);

const VALID_AUDIT_JSON = JSON.stringify({
  findings: [
    {
      severity: "high",
      category: "dependency",
      description: "Known CVE",
      recommendation: "Update package",
    },
  ],
  summary: "Found 1 issue.",
});

describe("ReviewService", () => {
  test("parses valid review JSON", async () => {
    const service = new ReviewService(mockCopilot(VALID_REVIEW_JSON), mockGitHub());
    const comments = await service.reviewPR({ owner: "o", repo: "r" }, 1, {
      event: "COMMENT",
    });
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ path: "src/index.ts", line: 10 });
  });

  test("throws ValidationError on invalid JSON", async () => {
    const service = new ReviewService(mockCopilot("not json"), mockGitHub());
    expect(service.reviewPR({ owner: "o", repo: "r" }, 1, { event: "COMMENT" })).rejects.toThrow();
  });

  test("throws ValidationError on wrong schema", async () => {
    const service = new ReviewService(
      mockCopilot(JSON.stringify([{ wrong: "shape" }])),
      mockGitHub(),
    );
    expect(service.reviewPR({ owner: "o", repo: "r" }, 1, { event: "COMMENT" })).rejects.toThrow();
  });

  test("strips markdown fences before parsing", async () => {
    const fenced = `\`\`\`json\n${VALID_REVIEW_JSON}\n\`\`\``;
    const service = new ReviewService(mockCopilot(fenced), mockGitHub());
    const comments = await service.reviewPR({ owner: "o", repo: "r" }, 1, {
      event: "COMMENT",
    });
    expect(comments).toHaveLength(1);
  });
});

describe("AuditService", () => {
  test("parses valid audit JSON", async () => {
    const service = new AuditService(mockCopilot(VALID_AUDIT_JSON), mockGitHub());
    const report = await service.audit({ owner: "o", repo: "r" }, 1, {
      scope: "all",
      failOn: "high",
    });
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.severity).toBe("high");
    expect(report.passed).toBe(false);
  });

  test("returns passed=true when no critical/high findings below threshold", async () => {
    const lowAudit = JSON.stringify({
      findings: [
        {
          severity: "low",
          category: "style",
          description: "Minor",
          recommendation: "Fix",
        },
      ],
      summary: "Low issue.",
    });
    const service = new AuditService(mockCopilot(lowAudit), mockGitHub());
    const report = await service.audit({ owner: "o", repo: "r" }, undefined, {
      scope: "all",
      failOn: "high",
    });
    expect(report.passed).toBe(true);
  });

  test("throws ValidationError on invalid JSON", async () => {
    const service = new AuditService(mockCopilot("bad response"), mockGitHub());
    expect(
      service.audit({ owner: "o", repo: "r" }, 1, {
        scope: "all",
        failOn: "high",
      }),
    ).rejects.toThrow();
  });
});

describe("ResumeService", () => {
  test("calls resumeAndComplete with pr-{prNumber} session ID by default", async () => {
    const copilot = mockCopilot("Looks good from last review too.");
    const service = new ResumeService(copilot, mockGitHub());
    const result = await service.resumePR({ owner: "o", repo: "r" }, 42, {
      prompt: "Any new issues?",
    });
    expect(result).toBe("Looks good from last review too.");
    expect(copilot.resumeAndComplete).toHaveBeenCalledWith(
      "pr-42",
      expect.any(String),
      "Any new issues?",
    );
  });

  test("uses explicit sessionId when provided", async () => {
    const copilot = mockCopilot("Session response.");
    const service = new ResumeService(copilot, mockGitHub());
    await service.resumePR({ owner: "o", repo: "r" }, 1, {
      prompt: "Follow up.",
      sessionId: "my-custom-session",
    });
    expect(copilot.resumeAndComplete).toHaveBeenCalledWith(
      "my-custom-session",
      expect.any(String),
      "Follow up.",
    );
  });

  test("falls back to 'pr-session' when prNumber is undefined", async () => {
    const copilot = mockCopilot("No PR context.");
    const service = new ResumeService(copilot, mockGitHub());
    await service.resumePR({ owner: "o", repo: "r" }, undefined, {
      prompt: "General question.",
    });
    expect(copilot.resumeAndComplete).toHaveBeenCalledWith(
      "pr-session",
      expect.any(String),
      "General question.",
    );
  });

  test("includes focus in system prompt when provided", async () => {
    const copilot = mockCopilot("Focus response.");
    const service = new ResumeService(copilot, mockGitHub());
    await service.resumePR({ owner: "o", repo: "r" }, 5, {
      focus: "security",
      prompt: "Check auth.",
    });
    expect(copilot.resumeAndComplete).toHaveBeenCalledWith(
      "pr-5",
      expect.stringContaining("security"),
      "Check auth.",
    );
  });

  test("does not fetch diff when prNumber is undefined", async () => {
    const github = mockGitHub();
    const service = new ResumeService(mockCopilot("ok"), github);
    await service.resumePR({ owner: "o", repo: "r" }, undefined, { prompt: "Hi." });
    expect(github.getPRDiff).not.toHaveBeenCalled();
  });
});
