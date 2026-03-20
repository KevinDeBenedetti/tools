#!/usr/bin/env bun
/**
 * Local integration test — PR Summary via Copilot SDK (generate tool).
 *
 * Usage:
 *   GITHUB_TOKEN=$(gh auth token) bun run src/copilot/generate/test-local.ts \
 *     --owner <owner> --repo <repo> --pr <number>
 *
 * Optional flags:
 *   --type summary|docs|changelog|tests   (default: summary)
 *   --model <name>                        (default: gpt-5-mini)
 */

import { CopilotClient } from "../../shared/copilot.client";
import { GitHubClient } from "../../shared/github.client";
import { GenerateService } from "./generate.service";
import { DEFAULT_MODEL } from "../../shared/constants";

function arg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

function required(flag: string): string {
  const val = arg(flag);
  if (!val) {
    console.error(`Missing required flag: ${flag}`);
    process.exit(1);
  }
  return val;
}

const token = process.env["GITHUB_TOKEN"];
if (!token) {
  console.error("Set GITHUB_TOKEN=... or: GITHUB_TOKEN=$(gh auth token)");
  process.exit(1);
}

const owner = required("--owner");
const repo = required("--repo");
const prNumber = Number(required("--pr"));
const type = (arg("--type") ?? "summary") as "summary" | "docs" | "changelog" | "tests";
const model = arg("--model") ?? DEFAULT_MODEL;

if (isNaN(prNumber) || prNumber <= 0) {
  console.error("--pr must be a positive integer");
  process.exit(1);
}

console.log(`\n🤖  Generating ${type} for PR #${prNumber} on ${owner}/${repo}`);
console.log(`    Model: ${model}\n`);

const copilot = new CopilotClient(token, model);
const github = new GitHubClient(token);
const service = new GenerateService(copilot, github);

try {
  const result = await service.generate({ owner, repo }, prNumber, {
    format: "markdown",
    type,
  });

  console.log("─".repeat(60));
  console.log(result);
  console.log("─".repeat(60));
  console.log("\n✅  Done.");
} catch (err) {
  console.error("\n❌  Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
