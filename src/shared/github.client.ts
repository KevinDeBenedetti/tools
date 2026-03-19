import * as githubActions from "@actions/github";
import type { IGitHubClient, IPRFile, IReviewComment } from "./types/copilot";
import { GitHubError } from "./errors";

type OctokitInstance = ReturnType<typeof githubActions.getOctokit>;

/**
 * Thin wrapper around @actions/github Octokit that implements IGitHubClient.
 */
export class GitHubClient implements IGitHubClient {
  private readonly octokit: OctokitInstance;

  constructor(token: string) {
    this.octokit = githubActions.getOctokit(token);
  }

  async getPRFiles(owner: string, repo: string, prNumber: number): Promise<IPRFile[]> {
    try {
      const { data } = await this.octokit.rest.pulls.listFiles({
        owner,
        per_page: 100,
        pull_number: prNumber,
        repo,
      });
      return data.map((f) => ({
        additions: f.additions,
        deletions: f.deletions,
        filename: f.filename,
        patch: f.patch,
        status: f.status,
      }));
    } catch (error) {
      throw new GitHubError(`Failed to list PR files: ${String(error)}`, error);
    }
  }

  async getPRDiff(owner: string, repo: string, prNumber: number): Promise<string> {
    try {
      const files = await this.getPRFiles(owner, repo, prNumber);
      return files
        .filter((f) => f.patch)
        .map((f) => `--- ${f.filename} ---\n${f.patch}`)
        .join("\n\n");
    } catch (error) {
      throw new GitHubError(`Failed to get PR diff: ${String(error)}`, error);
    }
  }

  async createReview(params: {
    owner: string;
    repo: string;
    pull_number: number;
    body: string;
    comments: IReviewComment[];
    event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
  }): Promise<void> {
    try {
      await this.octokit.rest.pulls.createReview({
        body: params.body,
        comments: params.comments.map((c) => ({
          path: c.path,
          line: c.line,
          body: c.body,
          side: "RIGHT" as const,
        })),
        event: params.event,
        owner: params.owner,
        pull_number: params.pull_number,
        repo: params.repo,
      });
    } catch (error) {
      throw new GitHubError(`Failed to create review: ${String(error)}`, error);
    }
  }

  async getFileContent(owner: string, repo: string, path: string, ref?: string): Promise<string> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner,
        path,
        repo,
        ...(ref ? { ref } : {}),
      });
      if (Array.isArray(data) || data.type !== "file") {
        throw new GitHubError(`Path "${path}" is not a file`);
      }
      return Buffer.from(data.content, "base64").toString("utf8");
    } catch (error) {
      if (error instanceof GitHubError) throw error;
      throw new GitHubError(`Failed to get file content: ${String(error)}`, error);
    }
  }
}
