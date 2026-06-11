import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScanSecretsService } from "../github/secrets/scan-secrets";

// Secrets are assembled at runtime so this test file never contains
// anything that looks like a real credential to scanners.
const FAKE_GITHUB_TOKEN = ["ghp", `${"a".repeat(12)}${"1".repeat(12)}`].join("_");
const FAKE_OPENAI_KEY = ["sk", `${"b".repeat(10)}${"2".repeat(10)}`].join("-");

function git(repoPath: string, args: string[]): void {
  execFileSync("git", args, {
    cwd: repoPath,
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "kevin@example.com",
      GIT_AUTHOR_NAME: "Kevin",
      GIT_COMMITTER_EMAIL: "kevin@example.com",
      GIT_COMMITTER_NAME: "Kevin",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

let repoPath: string;
let previousCwd: string;

beforeEach(() => {
  repoPath = mkdtempSync(join(tmpdir(), "scan-secrets-test-"));
  git(repoPath, ["init", "-q", "-b", "main"]);
  previousCwd = process.cwd();
  process.chdir(repoPath);
});

afterEach(() => {
  process.chdir(previousCwd);
  rmSync(repoPath, { recursive: true, force: true });
});

function addFile(name: string, content: string): void {
  writeFileSync(join(repoPath, name), content);
  git(repoPath, ["add", name]);
}

describe("ScanSecretsService", () => {
  test("finds tracked secrets in the working tree", async () => {
    addFile("config.ts", `const token = "${FAKE_GITHUB_TOKEN}";\n`);
    git(repoPath, ["commit", "-m", "feat: config"]);

    const result = await new ScanSecretsService({ local: true }).scan();

    expect(result.secrets).toHaveLength(1);
    expect(result.secrets[0]?.pattern).toBe("GitHub token");
    expect(result.secrets[0]?.file).toBe("config.ts");
    expect(result.matchedFiles).toBe(1);
  });

  test("reports a clean repository as empty", async () => {
    addFile("readme.md", "nothing to see\n");
    git(repoPath, ["commit", "-m", "docs: readme"]);

    const result = await new ScanSecretsService({ local: true }).scan();

    expect(result.secrets).toEqual([]);
  });

  test("finds secrets removed from the tree but still in history", async () => {
    addFile("leak.env", `${FAKE_OPENAI_KEY}\n`);
    git(repoPath, ["commit", "-m", "feat: oops"]);
    git(repoPath, ["rm", "-q", "leak.env"]);
    git(repoPath, ["commit", "-m", "fix: remove leak"]);

    const noHistory = await new ScanSecretsService({ local: true }).scan();
    expect(noHistory.secrets).toEqual([]);

    const withHistory = await new ScanSecretsService({ history: true, local: true }).scan();
    expect(withHistory.secrets.length).toBeGreaterThan(0);
    expect(withHistory.secrets[0]?.file).toBe("<history>");
  });

  test("supports custom patterns", async () => {
    addFile("notes.txt", "MY_INTERNAL_KEY=topsecret123\n");
    git(repoPath, ["commit", "-m", "docs: notes"]);

    const result = await new ScanSecretsService({
      local: true,
      patterns: ["MY_INTERNAL_KEY[[:space:]]*=[[:space:]]*[a-z0-9]+"],
    }).scan();

    expect(result.secrets).toHaveLength(1);
    expect(result.secrets[0]?.pattern).toBe("custom-1");
  });

  test("formatOutput renders text and json", async () => {
    addFile("config.ts", `const token = "${FAKE_GITHUB_TOKEN}";\n`);

    const service = new ScanSecretsService({ local: true });
    const result = await service.scan();
    expect(service.formatOutput(result)).toContain("WARNING");

    const jsonService = new ScanSecretsService({ format: "json", local: true });
    const parsed = JSON.parse(jsonService.formatOutput(result));
    expect(parsed.secrets).toHaveLength(1);
  });

  test("dry run describes the scan without running it", () => {
    const service = new ScanSecretsService({ dryRun: true, local: true });

    expect(service.isDryRun()).toBe(true);
    expect(service.describeDryRun()).toContain("[dry-run]");
  });
});
