import { ReviewTool } from "./copilot/review";
import { AnalyzeTool } from "./copilot/analyze";
import { GenerateTool } from "./copilot/generate";
import { AuditTool } from "./copilot/audit";
import { ResumeTool } from "./copilot/resume";
import type { ITool } from "./shared/types/copilot";

export const registry: Record<string, new () => ITool> = {
  analyze: AnalyzeTool,
  audit: AuditTool,
  generate: GenerateTool,
  resume: ResumeTool,
  review: ReviewTool,
};
