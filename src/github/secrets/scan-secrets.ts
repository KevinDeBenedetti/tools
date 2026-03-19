import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScanSecretsOptionsSchema, type SecretMatch, type SecretScanResult } from "../types";
import { formatError } from "../shared";

const DEFAULT_SECRET_PATTERNS = [
  { expression: "sk-[A-Za-z0-9_-]{16,}", name: "OpenAI-style key" },
  {
    expression: "AWS_SECRET_ACCESS_KEY\\s*=\\s*[\"']?[A-Za-z0-9/+=]{40}",
    name: "AWS secret access key",
  },
  { expression: "gh[pousr]_[A-Za-z0-9]{20,}", name: "GitHub token" },
  {
    expression: "-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
    name: "Private key",
  },
];

interface ScanTarget {
  cleanupPath?: string;
  repoPath: string;
}

export class ScanSecretsService {
  private readonly options: ReturnType<typeof ScanSecretsOptionsSchema.parse>;

  constructor(options: unknown) {
    this.options = ScanSecretsOptionsSchema.parse(options);
  }

  async scan(): Promise<SecretScanResult> {
    const target = this.resolveTarget();

    try {
      const secrets = [
        ...this.scanWorkingTree(target.repoPath),
        ...(this.options.history ? this.scanHistory(target.repoPath) : []),
      ];
      const matchedFiles = new Set(secrets.map((secret) => secret.file)).size;

      return {
        matchedFiles,
        secrets,
        totalFiles: matchedFiles,
      };
    } finally {
      if (target.cleanupPath) {
        rmSync(target.cleanupPath, { force: true, recursive: true });
      }
    }
  }

  isDryRun(): boolean {
    return this.options.dryRun;
  }

  describeDryRun(): string {
    const lines =
      this.options.repo && !this.options.local
        ? [`[dry-run] Would clone ${this.options.repo} and scan for secrets`]
        : ["[dry-run] Would scan the current repository for secrets"];

    lines.push(`History scan: ${String(this.options.history)}`);
    lines.push(`Using ${this.getPatterns().length} rules`);
    return lines.join("\n");
  }

  formatOutput(result: SecretScanResult): string {
    if (this.options.format === "json") {
      return JSON.stringify(result, null, 2);
    }

    if (result.secrets.length === 0) {
      return "No secrets detected.";
    }

    const lines = [
      `WARNING: Found ${result.secrets.length} potential secret(s) across ${result.matchedFiles} file(s).`,
      "",
      ...result.secrets
        .slice(0, 20)
        .map((secret) => `${secret.file}:${secret.line} [${secret.pattern}] ${secret.match}`),
    ];

    if (result.secrets.length > 20) {
      lines.push("", `... and ${result.secrets.length - 20} more`);
    }

    return lines.join("\n");
  }

  private resolveTarget(): ScanTarget {
    if (this.options.repo && !this.options.local) {
      const cleanupPath = mkdtempSync(join(tmpdir(), "scan-secrets-"));
      const repoPath = join(cleanupPath, this.options.repo.split("/")[1] ?? "repo");

      execFileSync("gh", ["repo", "clone", this.options.repo, repoPath], {
        encoding: "utf8",
        stdio: "pipe",
      });

      return { cleanupPath, repoPath };
    }

    const repoPath = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: "pipe",
    }).trim();

    return { repoPath };
  }

  private getPatterns(): { expression: string; name: string }[] {
    if (!this.options.patterns || this.options.patterns.length === 0) {
      return DEFAULT_SECRET_PATTERNS;
    }

    return this.options.patterns.map((pattern, index) => ({
      expression: pattern,
      name: `custom-${index + 1}`,
    }));
  }

  private scanWorkingTree(repoPath: string): SecretMatch[] {
    const matches: SecretMatch[] = [];

    for (const pattern of this.getPatterns()) {
      const output = this.runGitSearch(repoPath, ["grep", "-nE", pattern.expression, "--", "."]);
      matches.push(...this.parseMatches(output, pattern.name));
    }

    return matches;
  }

  private scanHistory(repoPath: string): SecretMatch[] {
    const matches: SecretMatch[] = [];

    for (const pattern of this.getPatterns()) {
      const output = this.runGitSearch(repoPath, [
        "log",
        "--all",
        "--pickaxe-regex",
        `-G${pattern.expression}`,
        "--format=%H",
      ]);

      for (const commit of output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)) {
        matches.push({
          commit,
          file: "<history>",
          line: 1,
          match: `Matched in commit ${commit}`,
          pattern: pattern.name,
        });
      }
    }

    return matches;
  }

  private runGitSearch(repoPath: string, args: string[]): string {
    try {
      return execFileSync("git", ["-C", repoPath, ...args], {
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? (error as { status?: number }).status
          : undefined;

      if (status === 1) {
        return "";
      }

      throw error;
    }
  }

  private parseMatches(output: string, patternName: string): SecretMatch[] {
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [file, lineNumber, ...matchParts] = line.split(":");
        return {
          file: file ?? "<unknown>",
          line: Number.parseInt(lineNumber ?? "1", 10) || 1,
          match: matchParts.join(":").trim(),
          pattern: patternName,
        };
      });
  }
}

export async function scanSecrets(args: unknown): Promise<void> {
  try {
    const service = new ScanSecretsService(args);

    if (service.isDryRun()) {
      console.log(service.describeDryRun());
      process.exitCode = 0;
      return;
    }

    const result = await service.scan();
    console.log(service.formatOutput(result));
    process.exitCode = result.secrets.length > 0 ? 1 : 0;
  } catch (error) {
    console.error(`❌ Error: ${formatError(error)}`);
    process.exitCode = 1;
  }
}
