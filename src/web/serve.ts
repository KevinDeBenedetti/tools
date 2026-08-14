#!/usr/bin/env bun
/**
 * Local web UI — `bun run ui`.
 *
 * A browser front-end over the same command registry the CLI uses, for when
 * remembering the flag names is more work than clicking them. The server binds
 * to loopback only: it can start any command in the registry, so it is a local
 * tool, never something to expose on a network.
 *
 * TOOLS_UI_HOST exists for one case — inside a container, where a process bound
 * to 127.0.0.1 is unreachable even from the host that started it. Setting it
 * does not make exposure safe: the container's published port must still be
 * bound to the host's loopback, which is what the compose file does. Anything else
 * hands whoever can reach the port the ability to run commands on the machine.
 */
import color from "picocolors";
import { allGroups } from "../cli/registry";
import { log } from "../shared/ui";
import type { FormValues } from "./args";
import { buildArgv } from "./args";
import { findCommand, serializeGroups } from "./catalog";
import { clearOverrides, describeEnv, EnvOverrideError, overrideEnv, setOverride } from "./env";
import { streamRun } from "./runner";
import index from "./app/index.html";

const HOST = process.env["TOOLS_UI_HOST"] ?? "127.0.0.1";
const PORT = Number(process.env["TOOLS_UI_PORT"] ?? 3030);

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/** A URL a human can click: 0.0.0.0 is a bind address, not a destination. */
function browsableUrl(url: URL): string {
  return LOOPBACK.has(HOST) ? url.href : `http://127.0.0.1:${PORT}/`;
}

interface RunRequest {
  group?: string;
  command?: string;
  values?: FormValues;
}

function badRequest(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

async function handleRun(req: Request): Promise<Response> {
  let body: RunRequest;
  try {
    body = (await req.json()) as RunRequest;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const { group, command } = body;
  if (typeof group !== "string" || typeof command !== "string") {
    return badRequest("Both 'group' and 'command' are required");
  }

  const spec = findCommand(allGroups, group, command);
  if (!spec) {
    return badRequest(`Unknown command: ${group} ${command}`, 404);
  }

  let argv: string[];
  try {
    argv = buildArgv(group, spec, body.values ?? {});
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : String(error));
  }

  console.log(`  ${color.dim("→")} ${color.dim(["bun run tools", ...argv].join(" "))}`);

  return new Response(streamRun(argv, { env: overrideEnv(), signal: req.signal }), {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/x-ndjson; charset=utf-8",
      // Output arrives as it is produced, so nothing may buffer it on the way.
      "x-content-type-options": "nosniff",
    },
  });
}

interface EnvRequest {
  /** name → value, or null to drop the override and fall back to the process env */
  set?: Record<string, string | null>;
  /** Drop every override at once */
  reset?: boolean;
}

/**
 * Apply session overrides and report the resulting environment.
 *
 * The response is the same redacted view as the GET, so the UI never has to
 * hold a secret to display one — and there is deliberately no endpoint that
 * hands a value back.
 */
async function handleEnv(req: Request): Promise<Response> {
  let body: EnvRequest;
  try {
    body = (await req.json()) as EnvRequest;
  } catch {
    return badRequest("Invalid JSON body");
  }

  try {
    if (body.reset === true) clearOverrides();
    for (const [name, value] of Object.entries(body.set ?? {})) {
      setOverride(name, value);
    }
  } catch (error) {
    if (error instanceof EnvOverrideError) return badRequest(error.message);
    throw error;
  }

  return Response.json(describeEnv());
}

// Return type is inferred: Bun.Server's generic parameter moves between versions.
function start() {
  try {
    return Bun.serve({
      development: process.env["NODE_ENV"] !== "production",
      hostname: HOST,
      // Bun defaults to 10s, which is shorter than a single benchmark request.
      // The runner's heartbeat is what actually keeps a quiet run connected;
      // this is the margin under it, and 255 is Bun's ceiling.
      idleTimeout: 255,
      port: PORT,
      routes: {
        "/": index,
        "/api/commands": () => Response.json(serializeGroups(allGroups)),
        "/api/env": { GET: () => Response.json(describeEnv()), POST: handleEnv },
        "/api/run": { POST: handleRun },
      },
    });
  } catch (error) {
    // Almost always a UI left running in another terminal, and Bun's own
    // message stops at "is port in use?" — say who to ask and how to move.
    if ((error as { code?: string }).code !== "EADDRINUSE") throw error;
    log.error(`Port ${PORT} is already in use.`);
    log.step(`Find it:  lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
    log.step(`Or move:  TOOLS_UI_PORT=${PORT + 1} bun run ui`);
    process.exit(1);
  }
}

const server = start();

console.log(`\n  ${color.green("●")} tools UI  ${color.cyan(browsableUrl(server.url))}`);

// Worth saying out loud every time, not once in a doc: this process starts
// arbitrary commands, so a non-loopback bind that is reachable from a network
// is remote code execution on this machine.
if (!LOOPBACK.has(HOST)) {
  log.warn(`Bound to ${HOST} — only safe if the port is published to loopback.`);
}
console.log();
