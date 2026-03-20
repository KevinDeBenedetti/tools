import type { ITool, ToolContext, ToolResult } from "../../shared/types/copilot";
import { resumeInputSchema } from "./resume.schema";
import { ResumeService } from "./resume.service";

export class ResumeTool implements ITool {
  async run(ctx: ToolContext): Promise<ToolResult> {
    const opts = resumeInputSchema.parse(ctx.options);
    const service = new ResumeService(ctx.copilot, ctx.github);
    const response = await service.resumePR(ctx.repo, ctx.prNumber, opts);

    const sessionId = opts.sessionId ?? (ctx.prNumber ? `pr-${ctx.prNumber}` : "pr-session");
    ctx.logger.info(`Resumed Copilot session "${sessionId}" for PR #${ctx.prNumber ?? "N/A"}`);

    return {
      outputs: { response, sessionId },
      success: true,
      summary: `Session "${sessionId}" resumed. Copilot responded with ${response.length} characters.`,
    };
  }
}
