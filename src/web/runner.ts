// ── Command execution ──────────────────────────────────────────────────────────
//
// Commands run as a child process of the real CLI rather than in-process: it
// keeps a long benchmark or a crashing command from taking the server down, and
// it means the browser sees byte-for-byte what a terminal would show. The argv
// is passed as an array — never through a shell — and every element of it comes
// from a declared flag, so there is nothing for a request to inject.

import { join } from "node:path";
import type { RunEvent } from "./protocol";

export const REPO_ROOT = join(import.meta.dir, "..", "..");
const CLI_ENTRY = join(REPO_ROOT, "src", "cli", "index.ts");

function encodeEvent(event: RunEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

async function pump(
  source: ReadableStream<Uint8Array> | undefined,
  type: "out" | "err",
  emit: (event: RunEvent) => void,
): Promise<void> {
  if (!source) return;
  const decoder = new TextDecoder();
  for await (const chunk of source) {
    const data = decoder.decode(chunk, { stream: true });
    if (data !== "") emit({ data, type });
  }
  const rest = decoder.decode();
  if (rest !== "") emit({ data: rest, type });
}

/**
 * Spawns `bun run src/cli/index.ts <argv>` and streams its merged output as
 * NDJSON, one RunEvent per line. Aborting the request (the UI's Stop button, or
 * a closed tab) kills the child.
 */
export function streamRun(argv: string[], signal?: AbortSignal): ReadableStream<Uint8Array> {
  const proc = Bun.spawn({
    // process.execPath, not "bun": the child must run on the same runtime as
    // the server, whatever version resolution put on PATH.
    cmd: [process.execPath, "run", CLI_ENTRY, ...argv],
    cwd: REPO_ROOT,
    // Child is not a TTY: picocolors already degrades to plain text, and
    // NO_COLOR keeps any other library from emitting escape codes.
    env: { ...process.env, NO_COLOR: "1" },
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });

  const kill = (): void => {
    if (proc.exitCode === null) proc.kill();
  };
  signal?.addEventListener("abort", kill, { once: true });

  return new ReadableStream<Uint8Array>({
    cancel: kill,
    async start(controller) {
      // Once the client is gone the controller rejects everything; there is no
      // one left to tell, so the throw is the end of the story either way.
      let open = true;
      const emit = (event: RunEvent): void => {
        if (!open) return;
        try {
          controller.enqueue(encodeEvent(event));
        } catch {
          open = false;
        }
      };

      try {
        await Promise.all([pump(proc.stdout, "out", emit), pump(proc.stderr, "err", emit)]);
        emit({ code: await proc.exited, type: "exit" });
      } catch (error) {
        emit({
          data: `\n${error instanceof Error ? error.message : String(error)}\n`,
          type: "err",
        });
        emit({ code: 1, type: "exit" });
      } finally {
        signal?.removeEventListener("abort", kill);
        if (open) {
          try {
            controller.close();
          } catch {
            // already closed by the cancel path
          }
        }
      }
    },
  });
}
