import * as core from "@actions/core";
import * as github from "@actions/github";
import { CopilotClient } from "./copilot.client";
import { GitHubClient } from "./github.client";
import { ActionsLogger } from "./logger";
import type { ToolContext } from "./types/copilot";
import { ValidationError } from "./errors";
import { DEFAULT_MODEL } from "./constants";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Builds a ToolContext from GitHub Actions inputs and the current event context.
 * Called once at the start of the action run.
 */
export async function buildContext(): Promise<ToolContext> {
  const token = core.getInput("token", { required: true });
  const model = core.getInput("model") || DEFAULT_MODEL;
  const optionsRaw = core.getInput("options") || "{}";

  let options: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(optionsRaw);
    if (!isRecord(parsed)) {
      throw new ValidationError("options must be a JSON object");
    }
    options = parsed;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(`Invalid JSON in "options" input: ${optionsRaw}`, error);
  }

  const { owner, repo } = github.context.repo;
  const pullRequest = github.context.payload.pull_request;
  const prNumber = typeof pullRequest?.number === "number" ? pullRequest.number : undefined;
  const prTitle =
    typeof (pullRequest as Record<string, unknown>)?.["title"] === "string"
      ? ((pullRequest as Record<string, unknown>)["title"] as string)
      : undefined;

  return {
    copilot: new CopilotClient(token, model),
    github: new GitHubClient(token),
    logger: new ActionsLogger(),
    options,
    prNumber,
    prTitle,
    repo: { owner, repo },
    token,
  };
}
