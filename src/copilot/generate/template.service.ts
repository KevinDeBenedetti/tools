import type { ICopilotClient, IGitHubClient } from "../../shared/types/copilot";

export interface TemplateFieldsOutput {
  description: string;
  changeType: "bug" | "feature" | "refactor" | "docs" | "perf" | "breaking";
  testingApproach: string;
  impactAreas: string[];
  breakingChanges: string[];
  /** Set when a PR template was found and filled by Copilot. */
  filledTemplate?: string;
}

/** Paths to look for a PR template, in priority order. */
const TEMPLATE_PATHS = [
  ".github/PULL_REQUEST_TEMPLATE.md",
  "PULL_REQUEST_TEMPLATE.md",
  "docs/PULL_REQUEST_TEMPLATE.md",
];

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
    const [diff, prTemplate] = await Promise.all([
      this.github.getPRDiff(repo.owner, repo.repo, prNumber),
      this.fetchPRTemplate(repo),
    ]);

    const context = `PR Title: ${prTitle}\n\nChanges:\n${diff}`;

    if (prTemplate) {
      try {
        const filledTemplate = await this.fillTemplate(prTemplate, context);
        // formatAsMarkdown uses filledTemplate exclusively — no Copilot call needed for base fields
        return { ...this.getFallbackFields(prTitle), filledTemplate };
      } catch {
        // Fall through to structured analysis
      }
    }

    return this.generateStructuredFields(context, prTitle);
  }

  /** Tries known template paths in priority order, returns content or null. */
  private async fetchPRTemplate(repo: { owner: string; repo: string }): Promise<string | null> {
    for (const path of TEMPLATE_PATHS) {
      try {
        return await this.github.getFileContent(repo.owner, repo.repo, path);
      } catch {
        // Try next path
      }
    }
    return null;
  }

  /** Asks Copilot to fill in the PR template based on the PR context. */
  private async fillTemplate(template: string, context: string): Promise<string> {
    const systemPrompt =
      "You are an expert code reviewer filling in a pull request template. " +
      "Fill in the template using only information from the provided PR diff. " +
      "Preserve the template structure exactly — headings, checkboxes, and all sections. " +
      "For checkboxes: use [x] to check relevant items, [ ] for the rest. " +
      "Return ONLY the filled template, with no extra text or commentary outside it.";

    const userPrompt =
      `Fill in this PR template based on the changes below.\n\n` +
      `## Template\n${template}\n\n## PR Information\n${context}`;

    return this.copilot.complete(systemPrompt, userPrompt);
  }

  /** Generates structured fields via JSON analysis — used as fallback when no template exists. */
  private async generateStructuredFields(
    context: string,
    prTitle: string,
  ): Promise<Omit<TemplateFieldsOutput, "filledTemplate">> {
    const analysisPrompt =
      `Analyze this PR and extract structured information.\n\n` +
      `Return a JSON object with exactly these fields (no markdown, valid JSON only):\n` +
      `{\n` +
      `  "description": "1-2 sentence summary of what changed and why",\n` +
      `  "changeType": "one of: bug, feature, refactor, docs, perf, breaking",\n` +
      `  "testingApproach": "Concrete testing steps for these specific changes",\n` +
      `  "impactAreas": ["affected_area_1", "affected_area_2"],\n` +
      `  "breakingChanges": ["breaking_change_1"] or []\n` +
      `}`;

    const systemPrompt =
      "You are an expert code reviewer. Analyze the PR and return ONLY valid JSON, no other text.";

    try {
      const response = await this.copilot.complete(systemPrompt, `${analysisPrompt}\n\n${context}`);

      const parsed = this.parseJsonResponse(response);

      return {
        description: (parsed["description"] as string | undefined) || "PR description",
        changeType: this.normalizeChangeType(parsed["changeType"]),
        testingApproach:
          (parsed["testingApproach"] as string | undefined) ||
          "Add unit tests to verify the changes and prevent regressions.",
        impactAreas: Array.isArray(parsed["impactAreas"])
          ? (parsed["impactAreas"] as string[])
          : [],
        breakingChanges: Array.isArray(parsed["breakingChanges"])
          ? (parsed["breakingChanges"] as string[])
          : [],
      };
    } catch {
      return this.getFallbackFields(prTitle);
    }
  }

  private parseJsonResponse(response: string): Record<string, unknown> {
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
    const titleLower = title.toLowerCase();
    let changeType: TemplateFieldsOutput["changeType"] = "feature";

    if (titleLower.includes("fix")) changeType = "bug";
    else if (titleLower.includes("refactor")) changeType = "refactor";
    else if (titleLower.includes("docs")) changeType = "docs";
    else if (titleLower.includes("perf")) changeType = "perf";
    else if (titleLower.includes("breaking")) changeType = "breaking";

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
   * When `filledTemplate` is present (PR template found), renders the pre-filled template.
   * Otherwise falls back to a structured suggestions block.
   */
  formatAsMarkdown(fields: TemplateFieldsOutput): string {
    if (fields.filledTemplate) {
      return [
        "## 🤖 Copilot PR Auto-fill",
        "",
        "Based on your changes, here is a pre-filled PR description.",
        "Copy the content below into your PR description:",
        "",
        "---",
        "",
        fields.filledTemplate.trim(),
        "",
        "---",
        "",
        "*Generated by [Copilot Tools] &nbsp;·&nbsp; Copy the content above into your PR description.*",
      ].join("\n");
    }

    const changeTypeLabel = `${this.changeTypeEmoji(fields.changeType)} \`${fields.changeType}\``;

    const lines: string[] = [
      "## 🤖 Copilot PR Auto-fill",
      "",
      "> No PR template was found. Use the suggested values below to fill in your PR description.",
      "",
      "**Description**",
      fields.description,
      "",
      `**Change Type:** ${changeTypeLabel}`,
      "",
      "**Testing Approach**",
      fields.testingApproach,
    ];

    if (fields.impactAreas.length > 0) {
      lines.push("", "**📌 Potential Impact Areas**", ...fields.impactAreas.map((a) => `- ${a}`));
    }

    if (fields.breakingChanges.length > 0) {
      lines.push("", "**⚠️ Breaking Changes**", ...fields.breakingChanges.map((bc) => `- ${bc}`));
    }

    lines.push(
      "",
      "---",
      "*Generated by [Copilot Tools] &nbsp;·&nbsp; Copy the values above into your PR description.*",
    );

    return lines.join("\n");
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
