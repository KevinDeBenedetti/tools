import { describe, expect, test, mock } from "bun:test";
import { CopilotChatSession } from "./chat.session";
import { CopilotError } from "../../shared/errors";
import { DEFAULT_MODEL } from "../../shared/constants";

// ── Fake SDK helpers ──────────────────────────────────────────────────────────

type EventCallback = (event: Record<string, unknown>) => void;

function makeFakeSession(chunks = ["Hello ", "from ", "Copilot"]) {
  let listener: EventCallback | null = null;

  const session = {
    disconnect: mock(async () => {}),
    on: mock((cb: EventCallback) => {
      listener = cb;
      return () => {
        listener = null;
      };
    }),
    send: mock(async (_opts: { prompt: string }) => {
      // Simulate streaming: emit deltas then idle
      for (const chunk of chunks) {
        listener?.({ type: "assistant.message_delta", data: { deltaContent: chunk } });
      }
      listener?.({ type: "session.idle", data: {} });
    }),
    // Expose for test assertions
    _emit: (event: Record<string, unknown>) => listener?.(event),
  };

  return session;
}

function makeFakeSDK(session = makeFakeSession()) {
  return {
    createSession: mock(async () => session),
    start: mock(async () => {}),
    stop: mock(async () => {}),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CopilotChatSession", () => {
  test("start() calls sdk.start() and createSession()", async () => {
    const session = makeFakeSession();
    const sdk = makeFakeSDK(session);
    const chat = new CopilotChatSession("token", DEFAULT_MODEL, "test-session", sdk);

    await chat.start();

    expect(sdk.start).toHaveBeenCalledTimes(1);
    expect(sdk.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: DEFAULT_MODEL, sessionId: "test-session", streaming: true }),
    );
  });

  test("ask() streams chunks via onChunk callback", async () => {
    const sdk = makeFakeSDK(makeFakeSession(["Hello ", "world"]));
    const chat = new CopilotChatSession("token", DEFAULT_MODEL, "s", sdk);
    await chat.start();

    const received: string[] = [];
    const result = await chat.ask("Hi!", (chunk) => received.push(chunk));

    expect(received).toEqual(["Hello ", "world"]);
    expect(result).toBe("Hello world");
  });

  test("ask() records conversation history", async () => {
    const sdk = makeFakeSDK(makeFakeSession(["Reply"]));
    const chat = new CopilotChatSession("token", DEFAULT_MODEL, "s", sdk);
    await chat.start();

    await chat.ask("Question?", () => {});
    const history = chat.getHistory();

    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ content: "Question?", role: "user" });
    expect(history[1]).toEqual({ content: "Reply", role: "assistant" });
  });

  test("ask() sends the prompt to the SDK session", async () => {
    const session = makeFakeSession(["ok"]);
    const sdk = makeFakeSDK(session);
    const chat = new CopilotChatSession("token", DEFAULT_MODEL, "s", sdk);
    await chat.start();

    await chat.ask("What is 2+2?", () => {});

    expect(session.send).toHaveBeenCalledWith({ prompt: "What is 2+2?" });
  });

  test("ask() rejects when session.error event fires", async () => {
    let listener: EventCallback | null = null;
    const session = {
      disconnect: mock(async () => {}),
      on: mock((cb: EventCallback) => {
        listener = cb;
        return () => {};
      }),
      send: mock(async () => {
        listener?.({
          type: "session.error",
          data: { errorType: "RuntimeError", message: "boom" },
        });
      }),
    };
    const sdk = makeFakeSDK(session);
    const chat = new CopilotChatSession("token", DEFAULT_MODEL, "s", sdk);
    await chat.start();

    await expect(chat.ask("Hi", () => {})).rejects.toBeInstanceOf(CopilotError);
  });

  test("ask() throws CopilotError when called before start()", async () => {
    const chat = new CopilotChatSession("token", DEFAULT_MODEL, "s", makeFakeSDK());

    await expect(chat.ask("Hi", () => {})).rejects.toBeInstanceOf(CopilotError);
  });

  test("summary() sends a summarize prompt", async () => {
    const session = makeFakeSession(["• Topic 1\n• Topic 2"]);
    const sdk = makeFakeSDK(session);
    const chat = new CopilotChatSession("token", DEFAULT_MODEL, "s", sdk);
    await chat.start();

    const result = await chat.summary(() => {});

    expect(result).toBe("• Topic 1\n• Topic 2");
    expect(session.send).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining("Summarize") }),
    );
  });

  test("stop() disconnects session and stops sdk", async () => {
    const session = makeFakeSession();
    const sdk = makeFakeSDK(session);
    const chat = new CopilotChatSession("token", DEFAULT_MODEL, "s", sdk);
    await chat.start();
    await chat.stop();

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(sdk.stop).toHaveBeenCalledTimes(1);
  });

  test("multiple ask() calls accumulate history", async () => {
    let sendCall = 0;
    const responses = [["First reply"], ["Second reply"]];
    let sessionListener: EventCallback | null = null;

    const persistentSession = {
      disconnect: mock(async () => {}),
      on: mock((cb: EventCallback) => {
        sessionListener = cb;
        return () => {};
      }),
      send: mock(async () => {
        const chunks = responses[sendCall++] ?? ["default"];
        for (const chunk of chunks) {
          sessionListener?.({ type: "assistant.message_delta", data: { deltaContent: chunk } });
        }
        sessionListener?.({ type: "session.idle", data: {} });
      }),
    };

    const persistentSDK = {
      start: mock(async () => {}),
      stop: mock(async () => {}),
      createSession: mock(async () => persistentSession),
    };

    const chat = new CopilotChatSession("token", DEFAULT_MODEL, "s", persistentSDK);
    await chat.start();

    await chat.ask("Q1", () => {});
    await chat.ask("Q2", () => {});

    const history = chat.getHistory();
    expect(history).toHaveLength(4);
    expect(history[0]?.content).toBe("Q1");
    expect(history[1]?.content).toBe("First reply");
    expect(history[2]?.content).toBe("Q2");
    expect(history[3]?.content).toBe("Second reply");
  });
});
