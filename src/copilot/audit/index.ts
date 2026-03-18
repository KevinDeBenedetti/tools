import type {
  ITool,
  ToolContext,
  ToolResult,
} from "../../shared/types/copilot";
import { auditInputSchema } from "./audit.schema";
import { AuditService } from "./audit.service";

export class AuditTool implements ITool {
  async run(ctx: ToolContext): Promise<ToolResult> {
    const opts = auditInputSchema.parse(ctx.options);
    const service = new AuditService(ctx.copilot, ctx.github);

    const report = await service.audit(ctx.repo, ctx.prNumber, opts);

    ctx.logger.info(
      `Audit complete — found ${report.findings.length} finding(s)`,
    );

    const annotations = report.findings.map((f) => ({
      path: "audit",
      line: 1,
      message: `[${f.severity.toUpperCase()}] ${f.category}: ${f.description}`,
    }));

    return {
      success: report.passed,
      summary: report.summary,
      annotations,
      outputs: {
        findings: String(report.findings.length),
        passed: String(report.passed),
        report: JSON.stringify(report, null, 2),
      },
    };
  }
}
