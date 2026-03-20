import type { ICopilotClient, IGitHubClient } from "../../shared/types/copilot";
import type { ResumeInput } from "./resume.schema";

export class ResumeService {
  constructor(
    private readonly copilot: ICopilotClient,
    private readonly github: IGitHubClient,
  ) {}

  /**
   * Resumes a Copilot session for a pull request and sends a follow-up prompt.
   * Falls back to creating a new session when the session ID is not found.
   */
  async resumePR(
    repo: { owner: string; repo: string },
    prNumber: number | undefined,
    options: ResumeInput,
  ): Promise<string> {
    const sessionId = options.sessionId ?? (prNumber ? `pr-${prNumber}` : "pr-session");

    const diff = prNumber ? await this.github.getPRDiff(repo.owner, repo.repo, prNumber) : "";

    const systemPrompt = [
      "You are a code reviewer continuing a review of a pull request.",
      options.focus ? `Focus on: ${options.focus}` : "",
      diff ? `Current PR diff for reference:\n\n${diff}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    return this.copilot.resumeAndComplete(sessionId, systemPrompt, options.prompt);
  }
}
