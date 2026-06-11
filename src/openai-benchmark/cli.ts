/**
 * OpenAI benchmark CLI entry point — `bun run benchmark [command] [options]`.
 * Command definitions live in ./commands.ts; the generic engine in src/cli/.
 */
import { runCli } from "../cli/dispatch";
import { parseArgs } from "../cli/parse";
import { benchmarkGroup } from "./commands";

/**
 * Back-compat with the historical flag-only interface: `bun run benchmark
 * --runs 5` maps to the `run` command, and `--no-stream` to `--stream=false`.
 */
function normalizeArgv(argv: string[], isTTY: boolean): string[] {
  const mapped = argv.map((a) => (a === "--no-stream" ? "--stream=false" : a));
  const parsed = parseArgs(mapped);
  if (parsed.positionals.length > 0 || parsed.help || parsed.interactive) {
    return mapped;
  }
  if (mapped.length === 0 && isTTY) {
    return mapped; // interactive menu
  }
  return ["run", ...mapped];
}

if (import.meta.main) {
  const isTTY = process.stdout.isTTY ?? false;
  await runCli(normalizeArgv(process.argv.slice(2), isTTY), {
    binName: "bun run benchmark",
    defaultGroup: "benchmark",
    groups: [benchmarkGroup],
    isTTY,
  });
}
