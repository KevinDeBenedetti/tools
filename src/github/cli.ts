/**
 * GitHub maintenance CLI entry point — `bun run github [command] [options]`.
 * Command definitions live in ./commands.ts; the generic engine in src/cli/.
 */
import { runCli } from "../cli/dispatch";
import { githubGroup } from "./commands";

export async function runGithubCli(argv: string[], isTTY: boolean): Promise<void> {
  await runCli(argv, {
    binName: "bun run github --",
    defaultGroup: "github",
    groups: [githubGroup],
    isTTY,
  });
}

if (import.meta.main) {
  await runGithubCli(process.argv.slice(2), process.stdout.isTTY ?? false);
}
