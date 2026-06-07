import { CopilotClient as SDKClient, approveAll } from "@github/copilot-sdk";
import type { ICopilotClient } from "./types/copilot";
import { CopilotError } from "./errors";
import { DEFAULT_MODEL } from "./constants";

export { defineTool } from "@github/copilot-sdk";

/**
 * Wraps the @github/copilot-sdk CopilotClient behind ICopilotClient so every
 * tool can be tested without hitting the real API.
 *
 * The SDK communicates with the GitHub Copilot CLI via JSON-RPC and
 * automatically manages the CLI process lifecycle.
 */
export class CopilotClient implements ICopilotClient {
  private readonly sdk: SDKClient;
  private readonly model: string;

  constructor(token: string, model = DEFAULT_MODEL) {
    this.sdk = new SDKClient({
      gitHubToken: token,
      useLoggedInUser: false,
    });
    this.model = model;
  }

  private async createSession(streaming = false) {
    await this.sdk.start();
    return this.sdk.createSession({
      model: this.model,
      onPermissionRequest: approveAll,
      streaming,
    });
  }

  /**
   * Sends a prompt and waits for the complete response.
   * System instructions are prepended as context to the user prompt.
   */
  async complete(systemPrompt: string, userPrompt: string): Promise<string> {
    const combined = systemPrompt ? `${systemPrompt}\n\n---\n\n${userPrompt}` : userPrompt;

    const session = await this.createSession();
    try {
      const response = await session.sendAndWait({ prompt: combined });
      return response?.data.content ?? "";
    } catch (error) {
      throw new CopilotError(`Copilot API call failed: ${String(error)}`, error);
    } finally {
      await session.disconnect();
      await this.sdk.stop();
    }
  }

  /**
   * Streams the response, yielding delta chunks as they arrive.
   * Uses session events to receive incremental content.
   */
  async *stream(systemPrompt: string, userPrompt: string): AsyncGenerator<string> {
    const combined = systemPrompt ? `${systemPrompt}\n\n---\n\n${userPrompt}` : userPrompt;

    const session = await this.createSession(true);
    const queue: string[] = [];
    let settled = false;
    let streamError: unknown;

    const unsubscribe = session.on((event) => {
      if (event.type === "assistant.message_delta") {
        queue.push(event.data.deltaContent);
      } else if (event.type === "session.idle") {
        settled = true;
      } else if (event.type === "session.error") {
        streamError = new CopilotError(`${event.data.errorType}: ${event.data.message}`);
        settled = true;
      }
    });

    try {
      await session.send({ prompt: combined });

      while (!settled || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 10));
        }
      }

      if (streamError) {
        throw streamError;
      }
    } finally {
      unsubscribe();
      await session.disconnect();
      await this.sdk.stop();
    }
  }

  /**
   * Resumes a previously persisted session by ID (create-or-resume pattern).
   * Falls back to a fresh named session if the session cannot be found.
   */
  async resumeAndComplete(
    sessionId: string,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    const combined = systemPrompt ? `${systemPrompt}\n\n---\n\n${userPrompt}` : userPrompt;

    await this.sdk.start();
    let session;
    try {
      session = await this.sdk.resumeSession(sessionId, { onPermissionRequest: approveAll });
    } catch {
      session = await this.sdk.createSession({
        model: this.model,
        onPermissionRequest: approveAll,
        sessionId,
      });
    }

    try {
      const response = await session.sendAndWait({ prompt: combined });
      return response?.data.content ?? "";
    } catch (error) {
      throw new CopilotError(`Copilot resume session call failed: ${String(error)}`, error);
    } finally {
      await session.disconnect();
      await this.sdk.stop();
    }
  }

  async stop(): Promise<void> {
    await this.sdk.stop();
  }
}
