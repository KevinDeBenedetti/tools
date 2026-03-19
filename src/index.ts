import * as core from "@actions/core";
import { registry } from "./registry";
import { buildContext } from "./shared/context";
import { toMessage } from "./shared/errors";

async function main(): Promise<void> {
  const toolName = core.getInput("tool", { required: true });
  const Tool = registry[toolName];

  if (!Tool) {
    core.setFailed(`Unknown tool: "${toolName}". Available: ${Object.keys(registry).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const ctx = await buildContext();
  ctx.logger.info(`Running tool: ${toolName}`);

  const result = await new Tool().run(ctx);

  core.setOutput("summary", result.summary);
  core.setOutput("success", String(result.success));

  for (const [key, value] of Object.entries(result.outputs ?? {})) {
    core.setOutput(key, value);
  }

  if (!result.success) {
    core.setFailed(result.summary);
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error: unknown) {
  core.setFailed(toMessage(error));
  process.exitCode = 1;
}
