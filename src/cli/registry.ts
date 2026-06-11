import { copilotGroup } from "../copilot/commands";
import { githubGroup } from "../github/commands";
import { benchmarkGroup } from "../openai-benchmark/commands";
import { todoGroup } from "../todo/commands";
import type { CommandGroup } from "./types";

/**
 * Every CLI-invocable command in the repo. Group entry points (bun run
 * github/todo/benchmark) pin their group; `bun run tools` exposes them all.
 */
export const allGroups: CommandGroup[] = [githubGroup, todoGroup, benchmarkGroup, copilotGroup];
