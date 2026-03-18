import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DetectBotsOptionsSchema,
  type BotCommit,
  type BotDetectionResult,
} from "../../shared/types/github";
import { formatError } from "../shared";

const DEFAULT_BOT_PATTERNS = [
  "dependabot",
  "renovate",
  "github-actions",
  "greenkeeper",
  "snyk-bot",
  "imgbot",
  "codecov",
  "netlify",
  "vercel",
  "semantic-release-bot",
  "release-please",
  "[bot]",
];

type CommitRecord = {
  author: string;
  body: string;
  date: string;
  email: string;
  message: string;
  sha: string;
};

type DetectionTarget = {
  cleanupPath?: string;
  repoPath: string;
};

export class DetectBotsService {
  private readonly options: ReturnType<typeof DetectBotsOptionsSchema.parse>;

  constructor(options: unknown) {
    this.options = DetectBotsOptionsSchema.parse(options);
  }

  async detect(): Promise<BotDetectionResult> {
    const target = this.resolveTarget();

    try {
      if (this.options.dryRun) {
        console.log("[DRY RUN] Would scan repository:", target.repoPath);
        return { totalCommits: 0, botCommits: [], percentage: 0 };
      }

      const commits = this.getAllCommits(target.repoPath);
      const botCommits = this.filterBotCommits(commits);

      if (this.options.purgeBots && botCommits.length > 0) {
        this.purgeBots(target.repoPath, botCommits);
      }

      return {
        totalCommits: commits.length,
        botCommits,
        percentage:
          commits.length > 0 ? (botCommits.length / commits.length) * 100 : 0,
      };
    } finally {
      if (target.cleanupPath && !this.options.purgeBots) {
        rmSync(target.cleanupPath, { force: true, recursive: true });
      }
    }
  }

  formatOutput(result: BotDetectionResult): string {
    if (this.options.format === "json") {
      return JSON.stringify(result, null, 2);
    }

    let output = "\nBot detection results\n";
    output += `${"=".repeat(50)}\n\n`;
    output += `Total commits: ${result.totalCommits}\n`;
    output += `Bot commits: ${result.botCommits.length}\n`;
    output += `Percentage: ${result.percentage.toFixed(2)}%\n`;

    if (result.botCommits.length > 0) {
      output += "\nRecent bot commits:\n";
      for (const commit of result.botCommits.slice(0, 20)) {
        output += `- ${commit.sha.slice(0, 8)} ${commit.author} (${commit.pattern}) ${commit.message}\n`;
      }
    }

    return output;
  }

  private resolveTarget(): DetectionTarget {
    if (this.options.repo && !this.options.local) {
      const cleanupPath = mkdtempSync(join(tmpdir(), "detect-bots-"));
      const repoPath = join(
        cleanupPath,
        this.options.repo.split("/")[1] ?? "repo",
      );

      execFileSync("gh", ["repo", "clone", this.options.repo, repoPath], {
        encoding: "utf-8",
        stdio: "pipe",
      });

      return { cleanupPath, repoPath };
    }

    const repoPath = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();

    return { repoPath };
  }

  private getAllCommits(repoPath: string): CommitRecord[] {
    const output = execFileSync(
      "git",
      [
        "-C",
        repoPath,
        "log",
        "--all",
        "--format=%H%x1f%an%x1f%ae%x1f%s%x1f%b%x1f%aI%x1e",
      ],
      {
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
        stdio: "pipe",
      },
    );

    return output
      .split("\x1e")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [sha, author, email, message, body, date] = entry.split("\x1f");
        return {
          sha: sha ?? "",
          author: author ?? "",
          email: email ?? "",
          message: message ?? "",
          body: body ?? "",
          date: date ?? "",
        };
      });
  }

  private filterBotCommits(commits: CommitRecord[]): BotCommit[] {
    const botCommits: BotCommit[] = [];

    for (const commit of commits) {
      const authorText = `${commit.author} ${commit.email}`.toLowerCase();
      const coauthorText = commit.body.toLowerCase();

      for (const pattern of DEFAULT_BOT_PATTERNS) {
        if (authorText.includes(pattern.toLowerCase())) {
          botCommits.push({ ...commit, pattern });
          break;
        }

        if (
          coauthorText.includes(`co-authored-by:`) &&
          coauthorText.includes(pattern.toLowerCase())
        ) {
          botCommits.push({ ...commit, pattern: `${pattern} (co-author)` });
          break;
        }
      }
    }

    return botCommits;
  }

  private purgeBots(repoPath: string, botCommits: BotCommit[]): void {
    const mailmapFile = join(repoPath, ".mailmap-bots");
    const mailmap = botCommits
      .map((commit) => `<${commit.email}> <${commit.email}>`)
      .join("\n");

    writeFileSync(mailmapFile, mailmap, "utf-8");

    try {
      execFileSync(
        "git",
        ["-C", repoPath, "filter-repo", "--mailmap", mailmapFile, "--force"],
        { stdio: "pipe" },
      );
      console.log(`✅ Successfully purged ${botCommits.length} bot commits`);
    } finally {
      rmSync(mailmapFile, { force: true });
    }
  }
}

export async function detectBots(args: unknown): Promise<void> {
  try {
    const service = new DetectBotsService(args);
    const result = await service.detect();
    console.log(service.formatOutput(result));
    process.exitCode = 0;
  } catch (error) {
    console.error(`❌ Error: ${formatError(error)}`);
    process.exitCode = 1;
  }
}
