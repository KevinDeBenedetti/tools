import type { ICopilotClient, IGitHubClient } from "../../shared/types/copilot";
import type { GenerateInput } from "./generate.schema";
import { TemplateService } from "./template.service";

const TYPE_PROMPTS: Record<string, string> = {
  changelog:
    "Generate a human-friendly changelog entry from the PR diff following Keep a Changelog format. Return Markdown.",
  docs: "Generate clear documentation including: purpose, parameters, return values, and usage examples. Return Markdown.",
  summary:
    "Summarize the changes in this pull request in a concise, non-technical way suitable for a release note. Return Markdown.",
  tests:
    "Generate comprehensive unit tests for the code. Follow testing best practices: AAA pattern, edge cases, mocks for external deps. Return only the test code.",
};

const SYSTEM_PROMPT =
  "You are an expert software engineer assisting with code generation tasks. Follow the exact instructions and return only the requested output.";

export class GenerateService {
  constructor(
    private readonly copilot: ICopilotClient,
    private readonly github: IGitHubClient,
  ) {}

  async generate(
    repo: { owner: string; repo: string },
    prNumber: number | undefined,
    opts: GenerateInput,
    prTitle?: string,
  ): Promise<string> {
    // Special handling for template type
    if (opts.type === "template" && prNumber && prTitle) {
      const templateService = new TemplateService(this.copilot, this.github);
      const fields = await templateService.generateTemplateFields(repo, prNumber, prTitle);
      return templateService.formatAsMarkdown(fields);
    }

    let context = "";

    if (prNumber) {
      context = await this.github.getPRDiff(repo.owner, repo.repo, prNumber);
    } else if (opts.filePath) {
      context = await this.github.getFileContent(repo.owner, repo.repo, opts.filePath);
    }

    const typePrompt =
      TYPE_PROMPTS[opts.type] ?? TYPE_PROMPTS["summary"] ?? "Summarize the changes.";
    const extra = opts.instructions ? `\n\nAdditional instructions: ${opts.instructions}` : "";
    const formatHint = opts.format === "markdown" ? "" : `\n\nOutput format: ${opts.format}`;

    const systemPrompt = `${SYSTEM_PROMPT}\n\nTask: ${typePrompt}${extra}${formatHint}`;

    return this.copilot.complete(systemPrompt, context || "No code context provided.");
  }
}
