import type { ICopilotClient, IGitHubClient } from "../../shared/types/copilot";
import type { AnalyzeInput } from "./analyze.schema";

const TARGET_DESCRIPTIONS: Record<string, string> = {
  security:
    "Identify OWASP Top-10 vulnerabilities, secret leaks, and insecure patterns.",
  performance:
    "Identify algorithmic inefficiencies, N+1 queries, and memory footprint issues.",
  quality:
    "Evaluate code readability, test coverage gaps, and adherence to best practices.",
  all: "Perform a comprehensive analysis covering security, performance, and quality.",
};

const SYSTEM_PROMPT = `
You are a senior software engineer performing a code analysis.
Return a Markdown report with the following sections:
## Summary
## Findings (severity: critical | high | medium | low)
## Recommendations
Be concise and actionable.
`.trim();

export class AnalyzeService {
  constructor(
    private readonly copilot: ICopilotClient,
    private readonly github: IGitHubClient,
  ) {}

  async analyzePR(
    repo: { owner: string; repo: string },
    prNumber: number,
    opts: AnalyzeInput,
  ): Promise<string> {
    const diff = await this.github.getPRDiff(repo.owner, repo.repo, prNumber);

    const focus =
      TARGET_DESCRIPTIONS[opts.target] ??
      TARGET_DESCRIPTIONS["all"] ??
      "Analyze thoroughly.";
    const extra = opts.instructions
      ? `\n\nAdditional instructions: ${opts.instructions}`
      : "";
    const ctx = opts.context ? `\n\nProject context: ${opts.context}` : "";
    const systemPrompt = `${SYSTEM_PROMPT}\n\nFocus: ${focus}${extra}${ctx}`;

    return this.copilot.complete(systemPrompt, diff);
  }
}
