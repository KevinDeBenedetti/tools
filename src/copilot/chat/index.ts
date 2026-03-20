import * as p from "@clack/prompts";
import { createInterface } from "node:readline/promises";
import color from "picocolors";
import { CopilotChatSession } from "./chat.session";
import { DEFAULT_MODEL } from "../../shared/constants";

const HELP = `
  ${color.bold("/help")}      Show this message
  ${color.bold("/summary")}   Ask Copilot to summarize the conversation
  ${color.bold("/history")}   Print the full conversation history
  ${color.bold("/clear")}     Start a brand-new session
  ${color.bold("/quit")}      Exit chat
`;

export async function runCopilotChat(token: string, model = DEFAULT_MODEL): Promise<void> {
  p.intro(color.bgCyan(color.black(" 💬 Copilot Chat ")));
  p.log.info(`Model: ${color.bold(model)}  ·  Type ${color.bold("/help")} for commands\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  let chat = new CopilotChatSession(token, model);

  async function startSession() {
    p.log.step("Starting Copilot session…");
    await chat.start();
    p.log.success("Session ready. Start chatting!\n");
  }

  await startSession();

  const onSigint = async () => {
    process.stdout.write("\n");
    p.outro("Goodbye! 👋");
    await chat.stop().catch(() => {});
    rl.close();
    process.exit(0);
  };
  process.on("SIGINT", onSigint);

  try {
    while (true) {
      const raw = await rl.question(color.cyan("You › "));
      const input = raw.trim();
      if (!input) continue;

      // ── Commands ─────────────────────────────────────────────────────────
      if (input === "/quit" || input === "/exit") break;

      if (input === "/help") {
        console.log(HELP);
        continue;
      }

      if (input === "/history") {
        const history = chat.getHistory();
        if (history.length === 0) {
          p.log.warn("No messages yet.");
        } else {
          console.log();
          for (const msg of history) {
            const label =
              msg.role === "user" ? color.cyan("You      │") : color.magenta("Copilot  │");
            const lines = msg.content.split("\n");
            console.log(`${label} ${lines[0]}`);
            for (const line of lines.slice(1)) {
              console.log(`         │ ${line}`);
            }
            console.log();
          }
        }
        continue;
      }

      if (input === "/summary") {
        process.stdout.write(color.magenta("\nCopilot › "));
        await chat.summary();
        continue;
      }

      if (input === "/clear") {
        await chat.stop();
        chat = new CopilotChatSession(token, model);
        await startSession();
        continue;
      }

      // ── Normal prompt ─────────────────────────────────────────────────────
      process.stdout.write(color.magenta("\nCopilot › "));
      await chat.ask(input);
    }
  } finally {
    process.off("SIGINT", onSigint);
    await chat.stop().catch(() => {});
    rl.close();
    p.outro("Session ended. Goodbye! 👋");
  }
}

// ── Direct invocation: bun run src/copilot/chat/index.ts ─────────────────────
if (import.meta.main) {
  const token = process.env["GITHUB_TOKEN"] ?? "";
  if (!token) {
    console.error(
      color.red("✖") + " Set GITHUB_TOKEN first:  export GITHUB_TOKEN=$(gh auth token)",
    );
    process.exit(1);
  }

  const modelFlag = process.argv.find((a) => a.startsWith("--model="));
  const model = modelFlag ? modelFlag.slice(8) : DEFAULT_MODEL;

  await runCopilotChat(token, model);
}
