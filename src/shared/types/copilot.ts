import type { GitHubRepo } from "./github";

// ─── Annotation ──────────────────────────────────────────────────────────────

export interface Annotation {
  path: string;
  line: number;
  message: string;
}

// ─── Client interfaces (for DI / testability) ────────────────────────────────

export interface ICopilotClient {
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
  stream(systemPrompt: string, userPrompt: string): AsyncGenerator<string>;
}

export interface IPRFile {
  filename: string;
  patch?: string | null;
  status: string;
  additions: number;
  deletions: number;
}

export interface IReviewComment {
  path: string;
  line: number;
  body: string;
}

export interface IGitHubClient {
  getPRFiles(owner: string, repo: string, prNumber: number): Promise<IPRFile[]>;
  getPRDiff(owner: string, repo: string, prNumber: number): Promise<string>;
  createReview(params: {
    owner: string;
    repo: string;
    pull_number: number;
    body: string;
    comments: IReviewComment[];
    event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
  }): Promise<void>;
  getFileContent(owner: string, repo: string, path: string, ref?: string): Promise<string>;
}

export interface ILogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

// ─── Tool contract ────────────────────────────────────────────────────────────

export interface ToolContext {
  token: string;
  repo: GitHubRepo;
  prNumber?: number;
  options: Record<string, unknown>;
  copilot: ICopilotClient;
  github: IGitHubClient;
  logger: ILogger;
}

export interface ToolResult {
  success: boolean;
  summary: string;
  /** Inline annotations for PR checks */
  annotations?: Annotation[];
  /** Extra key/value pairs surfaced as action outputs */
  outputs?: Record<string, string>;
}

export interface ITool {
  run(ctx: ToolContext): Promise<ToolResult>;
}
