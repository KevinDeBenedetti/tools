import type { ICopilotClient, IGitHubClient } from "../../shared/types/copilot";
import type { GenerateInput } from "./generate.schema";

export interface TemplateFieldsOutput {
  description: string;
  changeType: "bug" | "feature" | "refactor" | "docs" | "perf" | "breaking";
  testingApproach: string;
  impactAreas: string[];
  breakingChanges: string[];
}

/**
 * Generates structured PR template fields by analyzing PR diff and commits.
 * Used to auto-fill PR description sections when a PR is created.
 */
export class TemplateService {
  constructor(
    private readonly copilot: ICopilotClient,
    private readonly github: IGitHubClient,
  ) {}

  async generateTemplateFields(
    repo: { owner: string; repo: string },
    prNumber: number,
    prTitle: string,
  ): Promise<TemplateFieldsOutput> {
    const diff = await this.github.getPRDiff(repo.owner, repo.repo, prNumber);

    // Build context for analysis
    const context = `PR Title: ${prTitle}

Changes:
${diff}`;

    // Generate structured analysis from Copilot
    const analysisPrompt = `Analyze this PR and extract structured information.

Return a JSON object with exactly these fields (no markdown, valid JSON only):
{
  "description": "1-2 sentence summary of changes for PR description",
  "changeType": "one of: bug, feature, refactor, docs, perf, breaking",
  "testingApproach": "Suggested testing approach for these changes",
  "impactAreas": ["affected_area_1", "affected_area_2"],
  "breakingChanges": ["breaking_change_1" or empty array]
}`;

    const systemPrompt =
      "You are an expert code reviewer. Analyze the PR and return ONLY valid JSON, no other text.";

    try {
      const response = await this.copilot.complete(systemPrompt, `${analysisPrompt}\n\n${context}`);

      // Parse and validate JSON response
      const parsed = this.parseJsonResponse(response);

      return {
        description: parsed.description || "PR description",
        changeType: this.normalizeChangeType(parsed.changeType),
        testingApproach:
          parsed.testingApproach || "Add unit tests to verify the changes and prevent regressions.",
        impactAreas: Array.isArray(parsed.impactAreas) ? parsed.impactAreas : [],
        breakingChanges: Array.isArray(parsed.breakingChanges) ? parsed.breakingChanges : [],
      };
    } catch (error) {
      // Fallback if Copilot analysis fails
      return this.getFallbackFields(prTitle);
    }
  }

  private parseJsonResponse(response: string): Record<string, unknown> {
    // Try to extract JSON from response (might have markdown or extra text)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  }

  private normalizeChangeType(
    type: unknown,
  ): "bug" | "feature" | "refactor" | "docs" | "perf" | "breaking" {
    const typeStr = String(type).toLowerCase();
    const validTypes: Array<"bug" | "feature" | "refactor" | "docs" | "perf" | "breaking"> = [
      "bug",
      "feature",
      "refactor",
      "docs",
      "perf",
      "breaking",
    ];

    return validTypes.includes(typeStr as any) ? (typeStr as any) : ("feature" as const);
  }

  private getFallbackFields(title: string): TemplateFieldsOutput {
    // Simple heuristic-based fallback if Copilot fails
    const titleLower = title.toLowerCase();
    let changeType: TemplateFieldsOutput["changeType"] = "feature";

    if (titleLower.includes("fix")) changeType = "bug";
    if (titleLower.includes("refactor")) changeType = "refactor";
    if (titleLower.includes("docs")) changeType = "docs";
    if (titleLower.includes("perf")) changeType = "perf";
    if (titleLower.includes("breaking")) changeType = "breaking";

    return {
      description: `This PR: ${title}`,
      changeType,
      testingApproach: "Add unit tests to verify the changes and prevent regressions.",
      impactAreas: [],
      breakingChanges: [],
    };
  }

  /**
   * Formats template fields as a markdown comment for PR.
   * Useful for posting suggestions as a PR comment.
   */
  formatAsMarkdown(fields: TemplateFieldsOutput): string {
    const breakingSection =
      fields.breakingChanges.length > 0
        ? `\n**⚠️ Breaking Changes:**\n${fields.breakingChanges.map((bc) => `- ${bc}`).join("\n")}`
        : "";

    const impactSection =
      fields.impactAreas.length > 0
        ? `\n**Potential Impact Areas:**\n${fields.impactAreas.map((area) => `- ${area}`).join("\n")}`
        : "";

    return `## 🤖 Copilot PR Template Suggestions

**Description:**
${fields.description}

**Change Type:** ${this.changeTypeEmoji(fields.changeType)} ${fields.changeType}

**Testing Approach:**
${fields.testingApproach}${impactSection}${breakingSection}

---
*Copy the above information into your PR description to complete the template.*`;
  }

  private changeTypeEmoji(changeType: TemplateFieldsOutput["changeType"]): string {
    const emojis: Record<typeof changeType, string> = {
      bug: "🐛",
      feature: "✨",
      refactor: "🔄",
      docs: "📚",
      perf: "⚡",
      breaking: "🚨",
    };
    return emojis[changeType] || "✨";
  }
}
