import type { ITool, ToolContext, ToolResult } from "../../shared/types/copilot";
import { analyzeInputSchema } from "./analyze.schema";
import { AnalyzeService } from "./analyze.service";

export class AnalyzeTool implements ITool {
  async run(ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.prNumber) {
      return {
        success: false,
        summary: "No pull_request context found. The analyze tool requires a PR number.",
      };
    }

    const opts = analyzeInputSchema.parse(ctx.options);
    const service = new AnalyzeService(ctx.copilot, ctx.github);
    const report = await service.analyzePR(ctx.repo, ctx.prNumber, opts);

    ctx.logger.info(`Analysis complete for PR #${ctx.prNumber}`);

    return {
      outputs: { report },
      success: true,
      summary: `Analysis complete for PR #${ctx.prNumber} (target: ${opts.target})`,
    };
  }
}
