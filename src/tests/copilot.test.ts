import { describe, expect, test, mock } from "bun:test";
import { ReviewService } from "../copilot/review/review.service";
import { AuditService } from "../copilot/audit/audit.service";
import type { ICopilotClient, IGitHubClient } from "../shared/types/copilot";

function mockCopilot(response: string): ICopilotClient {
  return {
    complete: mock(async () => response),
  };
}

function mockGitHub(diff = "diff --git a/file.ts b/file.ts"): IGitHubClient {
  return {
    getPRDiff: mock(async () => diff),
    getFileContent: mock(async () => "// file content"),
    createReview: mock(async () => {}),
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
    const service = new ReviewService(
      mockCopilot(VALID_REVIEW_JSON),
      mockGitHub(),
    );
    const comments = await service.reviewPR({ owner: "o", repo: "r" }, 1, {
      event: "COMMENT",
    });
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ path: "src/index.ts", line: 10 });
  });

  test("throws ValidationError on invalid JSON", async () => {
    const service = new ReviewService(mockCopilot("not json"), mockGitHub());
    expect(
      service.reviewPR({ owner: "o", repo: "r" }, 1, { event: "COMMENT" }),
    ).rejects.toThrow();
  });

  test("throws ValidationError on wrong schema", async () => {
    const service = new ReviewService(
      mockCopilot(JSON.stringify([{ wrong: "shape" }])),
      mockGitHub(),
    );
    expect(
      service.reviewPR({ owner: "o", repo: "r" }, 1, { event: "COMMENT" }),
    ).rejects.toThrow();
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
    const service = new AuditService(
      mockCopilot(VALID_AUDIT_JSON),
      mockGitHub(),
    );
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
