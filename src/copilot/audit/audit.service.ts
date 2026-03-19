import type { ICopilotClient, IGitHubClient } from "../../shared/types/copilot";
import { ValidationError } from "../../shared/errors";
import type { AuditInput } from "./audit.schema";
import { z } from "zod";

export interface AuditFinding {
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  description: string;
  recommendation: string;
}

export interface AuditReport {
  findings: AuditFinding[];
  passed: boolean;
  summary: string;
}

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  all: "Perform a comprehensive audit covering dependencies, secrets, and licenses.",
  dependencies:
    "Check for known vulnerabilities in dependencies (CVEs, outdated packages, supply-chain risks).",
  licenses:
    "Identify license compatibility issues and GPL/copyleft contamination.",
  secrets:
    "Scan for accidentally committed secrets, tokens, API keys, or credentials.",
};

const SYSTEM_PROMPT = `
You are a security auditor reviewing code changes.
Return a JSON object with this shape:
{
  "findings": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "category": string,
      "description": string,
      "recommendation": string
    }
  ],
  "summary": string
}
Return ONLY valid JSON — no prose, no markdown fences.
`.trim();

const SEVERITY_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  low: 1,
  medium: 2,
  none: 0,
};

const auditFindingSchema = z.object({
  category: z.string().min(1),
  description: z.string().min(1),
  recommendation: z.string().min(1),
  severity: z.enum(["critical", "high", "medium", "low"]),
});

const auditResponseSchema = z.object({
  findings: z.array(auditFindingSchema).default([]),
  summary: z.string().min(1).optional(),
});

export class AuditService {
  constructor(
    private readonly copilot: ICopilotClient,
    private readonly github: IGitHubClient,
  ) {}

  async audit(
    repo: { owner: string; repo: string },
    prNumber: number | undefined,
    opts: AuditInput,
  ): Promise<AuditReport> {
    const diff = prNumber
      ? await this.github.getPRDiff(repo.owner, repo.repo, prNumber)
      : "No PR diff available — auditing repository configuration only.";

    const scopeDesc =
      SCOPE_DESCRIPTIONS[opts.scope] ?? SCOPE_DESCRIPTIONS["all"] ?? "";
    const extra = opts.instructions
      ? `\n\nAdditional instructions: ${opts.instructions}`
      : "";
    const systemPrompt = `${SYSTEM_PROMPT}\n\nScope: ${scopeDesc}${extra}`;

    const raw = await this.copilot.complete(systemPrompt, diff);
    return this.parse(raw, opts.failOn);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private parse(raw: string, failOn: string): AuditReport {
    try {
      const cleaned = raw
        .replace(/^```\w*\n?/, "")
        .replace(/\n?```$/, "")
        .trim();
      const parsed = auditResponseSchema.parse(JSON.parse(cleaned));
      const {findings} = parsed;
      const failThreshold = SEVERITY_ORDER[failOn] ?? 0;
      const passed =
        failThreshold === 0 ||
        findings.every(
          (f) => (SEVERITY_ORDER[f.severity] ?? 0) < failThreshold,
        );
      return {
        findings,
        passed,
        summary: parsed.summary ?? `Found ${findings.length} findings.`,
      };
    } catch (error) {
      throw new ValidationError(
        "Copilot audit response was not valid audit JSON.",
        error,
      );
    }
  }
}
