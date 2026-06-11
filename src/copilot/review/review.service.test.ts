import { describe, expect, test } from "bun:test";
import type { ICopilotClient, IGitHubClient } from "../../shared/types/copilot";
import { ValidationError } from "../../shared/errors";
import { ReviewService } from "./review.service";

class FakeCopilotClient implements ICopilotClient {
  constructor(private readonly response: string) {}

  async complete(): Promise<string> {
    return this.response;
  }

  async resumeAndComplete(): Promise<string> {
    return this.response;
  }

  async *stream(): AsyncGenerator<string> {
    yield this.response;
  }
}

class FakeGitHubClient implements IGitHubClient {
  async createReview(): Promise<void> {}

  async getFileContent(): Promise<string> {
    return "";
  }

  async getPRDiff(): Promise<string> {
    return "diff --git a/file.ts b/file.ts";
  }

  async getPRFiles() {
    return [];
  }
}

describe("ReviewService", () => {
  test("parses valid review comments", async () => {
    const service = new ReviewService(
      new FakeCopilotClient('[{"path":"src/index.ts","line":12,"body":"Fix this"}]'),
      new FakeGitHubClient(),
    );

    const comments = await service.reviewPR({ owner: "octo", repo: "tools" }, 1, {
      event: "COMMENT",
    });

    expect(comments).toHaveLength(1);
    expect(comments[0]).toEqual({
      body: "Fix this",
      line: 12,
      path: "src/index.ts",
    });
  });

  test("throws when Copilot returns invalid JSON", async () => {
    const service = new ReviewService(new FakeCopilotClient("not-json"), new FakeGitHubClient());

    await expect(
      service.reviewPR({ owner: "octo", repo: "tools" }, 1, { event: "COMMENT" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
