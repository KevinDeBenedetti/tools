import type { ITool, ToolContext, ToolResult } from "../../shared/types/copilot";
import { generateInputSchema } from "./generate.schema";
import { GenerateService } from "./generate.service";

export class GenerateTool implements ITool {
  async run(ctx: ToolContext): Promise<ToolResult> {
    const opts = generateInputSchema.parse(ctx.options);
    const service = new GenerateService(ctx.copilot, ctx.github);

    const output = await service.generate(ctx.repo, ctx.prNumber, opts);

    ctx.logger.info(`Generation complete (type: ${opts.type})`);

    return {
      outputs: { generated: output },
      success: true,
      summary: `Generated ${opts.type} successfully`,
    };
  }
}
