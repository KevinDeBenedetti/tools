import { useCallback, useRef, useState } from "react";

import type { FormValues } from "../../args";
import type { RunEvent } from "../../protocol";

export type RunStatus = "idle" | "running" | "done" | "failed";

export interface OutputChunk {
  type: "out" | "err";
  text: string;
}

/** Appends to the last chunk when the stream is still on the same channel. */
function append(
  chunks: OutputChunk[],
  event: { type: "out" | "err"; data: string },
): OutputChunk[] {
  const last = chunks[chunks.length - 1];
  if (last?.type === event.type) {
    return [...chunks.slice(0, -1), { text: last.text + event.data, type: last.type }];
  }
  return [...chunks, { text: event.data, type: event.type }];
}

export interface Run {
  status: RunStatus;
  exitCode: number | null;
  output: OutputChunk[];
  start: (group: string, command: string, values: FormValues) => Promise<void>;
  stop: () => void;
  clear: () => void;
}

/**
 * Runs one command at a time against /api/run and exposes its output as it
 * streams in. Starting a new run, or calling stop(), aborts the previous one —
 * which kills the child process server-side.
 */
export function useRun(): Run {
  const [status, setStatus] = useState<RunStatus>("idle");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [output, setOutput] = useState<OutputChunk[]>([]);
  const controller = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  const clear = useCallback(() => {
    setOutput([]);
    setExitCode(null);
    setStatus("idle");
  }, []);

  const start = useCallback(async (group: string, command: string, values: FormValues) => {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;

    setOutput([]);
    setExitCode(null);
    setStatus("running");

    try {
      const res = await fetch("/api/run", {
        body: JSON.stringify({ command, group, values }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        setOutput([{ text: detail.error ?? `Request failed (${res.status})`, type: "err" }]);
        setStatus("failed");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // The last piece is a partial line until the next chunk arrives.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line === "") continue;
          const event = JSON.parse(line) as RunEvent;
          if (event.type === "exit") {
            setExitCode(event.code);
            setStatus(event.code === 0 ? "done" : "failed");
          } else if (event.type === "out" || event.type === "err") {
            setOutput((prev) => append(prev, event));
          }
          // Anything else — a keepalive ping, a type added later — is silence
          // by design: appending an event with no `data` would print
          // "undefined" into the run's output.
        }
      }
    } catch (error) {
      if (ctrl.signal.aborted) {
        setOutput((prev) => append(prev, { data: "\n^C stopped\n", type: "err" }));
        setStatus("failed");
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setOutput((prev) => append(prev, { data: `\n${message}\n`, type: "err" }));
      setStatus("failed");
    } finally {
      if (controller.current === ctrl) controller.current = null;
    }
  }, []);

  return { clear, exitCode, output, start, status, stop };
}
