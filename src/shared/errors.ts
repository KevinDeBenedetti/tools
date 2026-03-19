/** Base class for all tool-specific errors. */
export class ToolError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

/** Thrown when required inputs are missing or malformed. */
export class ValidationError extends ToolError {
  constructor(message: string, cause?: unknown) {
    super(message, "VALIDATION_ERROR", cause);
    this.name = "ValidationError";
  }
}

/** Thrown when the Copilot API call fails. */
export class CopilotError extends ToolError {
  constructor(message: string, cause?: unknown) {
    super(message, "COPILOT_ERROR", cause);
    this.name = "CopilotError";
  }
}

/** Thrown when a GitHub API call fails. */
export class GitHubError extends ToolError {
  constructor(message: string, cause?: unknown) {
    super(message, "GITHUB_ERROR", cause);
    this.name = "GitHubError";
  }
}

/** Coerce any caught value into a readable message string. */
export function toMessage(err: unknown): string {
  if (err instanceof Error) {return err.message;}
  if (typeof err === "string") {return err;}
  return JSON.stringify(err);
}
