import type {
  ICopilotClient,
  IGitHubClient,
  IReviewComment,
} from "../../shared/types/copilot";
import { ValidationError } from "../../shared/errors";
import type { ReviewInput } from "./review.schema";
import { z } from "zod";

const reviewCommentSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  body: z.string().min(1),
});

const reviewCommentsSchema = z.array(reviewCommentSchema);

export class ReviewService {
  constructor(
    private readonly copilot: ICopilotClient,
    private readonly github: IGitHubClient,
  ) {}

  async reviewPR(
    repo: { owner: string; repo: string },
    prNumber: number,
    options: ReviewInput,
  ): Promise<IReviewComment[]> {
    const diff = await this.github.getPRDiff(repo.owner, repo.repo, prNumber);

    const systemPrompt = `You are a code reviewer. Analyze the following PR diff and provide constructive feedback.
${options.focus ? `Focus on: ${options.focus}` : ""}

Rules:
- Only comment on significant issues (bugs, security, performance, maintainability)
- Be specific and actionable
- Suggest improvements with code examples when possible
- Return comments as JSON array: [{"path": "file.ts", "line": 10, "body": "comment"}]`;

    const userPrompt = `Review this PR diff:\n\n${diff}`;

    const response = await this.copilot.complete(systemPrompt, userPrompt);

    return this.parseComments(response);
  }

  private parseComments(response: string): IReviewComment[] {
    try {
      const cleaned = response
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, "")
        .trim();
      return reviewCommentsSchema.parse(JSON.parse(cleaned));
    } catch (error) {
      throw new ValidationError(
        "Copilot review response was not valid review JSON.",
        error,
      );
    }
  }
}
