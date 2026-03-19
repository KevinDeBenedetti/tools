import { ReviewTool } from "./copilot/review";
import { AnalyzeTool } from "./copilot/analyze";
import { GenerateTool } from "./copilot/generate";
import { AuditTool } from "./copilot/audit";
import type { ITool } from "./shared/types/copilot";

export const registry: Record<string, new () => ITool> = {
  analyze: AnalyzeTool,
  audit: AuditTool,
  generate: GenerateTool,
  review: ReviewTool,
};
