import { z } from "zod";

export interface GitHubRepo {
  owner: string;
  repo: string;
}

export const OutputFormatSchema = z.enum(["text", "json"]);
export type OutputFormat = z.infer<typeof OutputFormatSchema>;

export function parseRepoString(repo: string): GitHubRepo {
  const parts = repo.split("/");
  if (parts.length !== 2) {
    throw new Error(`Invalid repo format: ${repo}. Expected owner/repo`);
  }
  return { owner: parts[0]!, repo: parts[1]! };
}

export const DetectBotsOptionsSchema = z.object({
  dryRun: z
    .boolean()
    .default(false)
    .describe("Show what would be done without doing it"),
  format: OutputFormatSchema.default("text").describe("Output format"),
  local: z.boolean().default(true).describe("Scan local repository"),
  purgeBots: z
    .boolean()
    .default(false)
    .describe("Remove bot commits from Git history"),
  repo: z
    .string()
    .optional()
    .describe("GitHub repository in owner/repo format"),
});

export type DetectBotsOptions = z.infer<typeof DetectBotsOptionsSchema>;

export interface BotCommit {
  sha: string;
  author: string;
  email: string;
  message: string;
  date: string;
  pattern: string;
}

export interface BotDetectionResult {
  totalCommits: number;
  botCommits: BotCommit[];
  percentage: number;
}

export const PurgeActionsOptionsSchema = z.object({
  batchSize: z.coerce.number().int().min(1).max(100).default(50),
  dryRun: z.boolean().default(false),
  keepLatest: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of most recent runs to keep"),
  olderThan: z
    .string()
    .optional()
    .describe('Delete runs older than this (e.g., "30d", "6m")'),
  repo: z.string().describe("GitHub repository in owner/repo format"),
  status: z
    .string()
    .default("all")
    .describe("Workflow status or conclusion to target"),
  workflow: z.string().optional().describe("Specific workflow name to purge"),
});

export type PurgeActionsOptions = z.infer<typeof PurgeActionsOptionsSchema>;

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PurgePackagesOptionsSchema = z.object({
  dryRun: z.boolean().default(false),
  keepLatest: z.coerce.number().int().min(0).default(0),
  olderThan: z.string().optional(),
  packageName: z.string().describe("Name of the package to purge"),
  packageType: z
    .enum(["npm", "maven", "docker", "nuget", "rubygems", "container"])
    .default("container"),
  repo: z.string().describe("GitHub repository in owner/repo format"),
});

export type PurgePackagesOptions = z.infer<typeof PurgePackagesOptionsSchema>;

export interface PackageVersion {
  id: number;
  name: string;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export const PurgeReleaseOptionsSchema = z.object({
  dryRun: z.boolean().default(false),
  keepLatest: z.coerce.number().int().min(0).default(0),
  pattern: z
    .string()
    .optional()
    .describe("Delete releases matching this glob pattern"),
  repo: z.string().describe("GitHub repository in owner/repo format"),
  tag: z.string().optional(),
});

export type PurgeReleaseOptions = z.infer<typeof PurgeReleaseOptionsSchema>;

export interface Release {
  id: number;
  tagName: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  createdAt: string;
  publishedAt: string | null;
}

export const PurgeTagsOptionsSchema = z.object({
  dryRun: z.boolean().default(false),
  exclude: z
    .string()
    .optional()
    .describe("Exclude tags matching this glob pattern"),
  keepLatest: z.coerce.number().int().min(0).default(0),
  pattern: z
    .string()
    .optional()
    .describe("Delete tags matching this glob pattern"),
  repo: z.string().describe("GitHub repository in owner/repo format"),
});

export type PurgeTagsOptions = z.infer<typeof PurgeTagsOptionsSchema>;

export interface GitTag {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
}

export const ScanSecretsOptionsSchema = z.object({
  dryRun: z
    .boolean()
    .default(false)
    .describe("Show what would be scanned without scanning"),
  format: OutputFormatSchema.default("text"),
  history: z
    .boolean()
    .default(false)
    .describe("Scan git history in addition to the working tree"),
  local: z.boolean().default(true).describe("Scan local repository"),
  patterns: z
    .array(z.string())
    .optional()
    .describe("Custom regex patterns to search for"),
  repo: z
    .string()
    .optional()
    .describe("GitHub repository in owner/repo format"),
});

export type ScanSecretsOptions = z.infer<typeof ScanSecretsOptionsSchema>;

export interface SecretMatch {
  file: string;
  line: number;
  pattern: string;
  match: string;
  commit?: string;
}

export interface SecretScanResult {
  totalFiles: number;
  matchedFiles: number;
  secrets: SecretMatch[];
}
