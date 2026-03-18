import type {
  ITool,
  ToolContext,
  ToolResult,
  IReviewComment,
} from "../../shared/types/copilot";
import { reviewInputSchema } from "./review.schema";
import { ReviewService } from "./review.service";

export class ReviewTool implements ITool {
  async run(ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.prNumber) {
      return {
        success: false,
        summary:
          "No pull_request context found. The review tool requires a PR number.",
      };
    }

    const opts = reviewInputSchema.parse(ctx.options);
    const service = new ReviewService(ctx.copilot, ctx.github);
    const comments = await service.reviewPR(ctx.repo, ctx.prNumber, opts);

    // Post the review
    await ctx.github.createReview({
      owner: ctx.repo.owner,
      repo: ctx.repo.repo,
      pull_number: ctx.prNumber,
      body: `GitHub Copilot review — ${comments.length} suggestion(s)`,
      comments: comments,
      event: opts.event,
    });

    ctx.logger.info(
      `Posted review with ${comments.length} comment(s) on PR #${ctx.prNumber}`,
    );

    return {
      success: true,
      summary: `Review posted: ${comments.length} suggestion(s)`,
      annotations: comments.map((c: IReviewComment) => ({
        path: c.path,
        line: c.line,
        message: c.body,
      })),
    };
  }
}
