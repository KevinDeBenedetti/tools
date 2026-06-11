import type { CommandGroup, CommandSpec } from "../cli/types";
import { DEFAULT_MODEL } from "../shared/constants";

// The Copilot SDK loads lazily inside run() so listing commands or printing
// help never requires a token or network access.

const chat: CommandSpec = {
  description: "Interactive Copilot chat in the terminal",
  flags: [
    {
      description: "GitHub token from an account with a Copilot subscription",
      env: "GITHUB_TOKEN",
      name: "token",
      required: true,
      type: "string",
    },
    {
      default: DEFAULT_MODEL,
      description: "Copilot model to chat with",
      name: "model",
      type: "string",
    },
  ],
  name: "chat",
  async run(options) {
    const { runCopilotChat } = await import("./chat/index");
    await runCopilotChat(options["token"] as string, options["model"] as string);
  },
};

export const copilotGroup: CommandGroup = {
  commands: [chat],
  description: "Copilot chat (review/analyze/audit/generate run via GitHub Actions)",
  name: "copilot",
};
