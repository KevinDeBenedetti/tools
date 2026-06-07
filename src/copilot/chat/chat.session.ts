import { CopilotClient as SDKClient, approveAll } from "@github/copilot-sdk";
import type { CopilotSession } from "@github/copilot-sdk";
import { CopilotError } from "../../shared/errors";
import { DEFAULT_MODEL } from "../../shared/constants";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Minimal interface over SDKClient so tests can inject a fake
export interface IChatSDK {
  start(): Promise<void>;
  stop(): Promise<Error[] | void>;
  createSession(config: {
    model: string;
    onPermissionRequest: typeof approveAll;
    sessionId: string;
    streaming: boolean;
  }): Promise<Pick<CopilotSession, "on" | "send" | "disconnect">>;
}

/**
 * Manages a persistent multi-turn Copilot chat session.
 * The SDK session stays alive between prompts — unlike the one-shot CopilotClient.
 */
export class CopilotChatSession {
  private readonly sdk: IChatSDK;
  private session: Pick<CopilotSession, "on" | "send" | "disconnect"> | null = null;
  private readonly history: ChatMessage[] = [];

  constructor(
    token: string,
    private readonly model = DEFAULT_MODEL,
    private readonly sessionId = "chat-local",
    sdk?: IChatSDK,
  ) {
    this.sdk = sdk ?? new SDKClient({ gitHubToken: token, useLoggedInUser: false });
  }

  async start(): Promise<void> {
    await this.sdk.start();
    this.session = await this.sdk.createSession({
      model: this.model,
      onPermissionRequest: approveAll,
      sessionId: this.sessionId,
      streaming: true,
    });
  }

  /**
   * Sends a prompt and streams the response to stdout in real-time.
   * Returns the full response text once complete.
   */
  async ask(prompt: string, onChunk?: (chunk: string) => void): Promise<string> {
    if (!this.session) {
      throw new CopilotError("Session not started. Call start() first.");
    }

    this.history.push({ content: prompt, role: "user" });
    let fullResponse = "";

    const done = new Promise<void>((resolve, reject) => {
      const unsub = this.session!.on((event) => {
        if (event.type === "assistant.message_delta") {
          const chunk = event.data.deltaContent;
          fullResponse += chunk;
          if (onChunk) {
            onChunk(chunk);
          } else {
            process.stdout.write(chunk);
          }
        } else if (event.type === "session.idle") {
          unsub();
          resolve();
        } else if (event.type === "session.error") {
          unsub();
          reject(new CopilotError(`${event.data.errorType}: ${event.data.message}`));
        }
      });
    });

    await this.session.send({ prompt });
    await done;

    if (!onChunk) process.stdout.write("\n");
    this.history.push({ content: fullResponse, role: "assistant" });
    return fullResponse;
  }

  /**
   * Asks Copilot to summarize the conversation so far.
   */
  async summary(onChunk?: (chunk: string) => void): Promise<string> {
    return this.ask(
      "Summarize our conversation so far in concise bullet points, highlighting the key topics and any conclusions reached.",
      onChunk,
    );
  }

  getHistory(): Readonly<ChatMessage[]> {
    return this.history;
  }

  async stop(): Promise<void> {
    if (this.session) {
      await this.session.disconnect();
      this.session = null;
    }
    await this.sdk.stop();
  }
}
