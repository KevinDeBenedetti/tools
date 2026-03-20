#!/usr/bin/env bun
/**
 * Local test script for the resume tool.
 *
 * Usage:
 *   GITHUB_TOKEN=$(gh auth token) bun run src/copilot/resume/test-local.ts \
 *     --owner <owner> --repo <repo> --pr <number> --prompt "Any new issues?"
 *
 * Optional flags:
 *   --session-id <id>   Override session ID (default: pr-<prNumber>)
 *   --focus <area>      Focus area, e.g. "security"
 *   --model <name>      Model to use (default: gpt-5-mini)
 */

import { CopilotClient } from "../../shared/copilot.client";
import { GitHubClient } from "../../shared/github.client";
import { ResumeService } from "./resume.service";
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
  console.error("Set GITHUB_TOKEN=... or prefix with: GITHUB_TOKEN=$(gh auth token)");
  process.exit(1);
}

const owner = required("--owner");
const repo = required("--repo");
const prNumber = Number(required("--pr"));
const prompt = required("--prompt");
const sessionId = arg("--session-id");
const focus = arg("--focus");
const model = arg("--model") ?? DEFAULT_MODEL;

if (isNaN(prNumber) || prNumber <= 0) {
  console.error("--pr must be a positive integer");
  process.exit(1);
}

console.log(`\n🔄  Resuming session for PR #${prNumber} on ${owner}/${repo}`);
console.log(`    Session ID : ${sessionId ?? `pr-${prNumber} (default)`}`);
console.log(`    Model      : ${model}`);
if (focus) console.log(`    Focus      : ${focus}`);
console.log(`    Prompt     : ${prompt}\n`);

const copilot = new CopilotClient(token, model);
const github = new GitHubClient(token);
const service = new ResumeService(copilot, github);

try {
  const response = await service.resumePR({ owner, repo }, prNumber, {
    ...(focus ? { focus } : {}),
    ...(sessionId ? { sessionId } : {}),
    prompt,
  });

  console.log("─".repeat(60));
  console.log(response);
  console.log("─".repeat(60));
  console.log("\n✅  Done.");
} catch (err) {
  console.error("\n❌  Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
