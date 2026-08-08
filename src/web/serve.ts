#!/usr/bin/env bun
/**
 * Local web UI — `bun run ui`.
 *
 * A browser front-end over the same command registry the CLI uses, for when
 * remembering the flag names is more work than clicking them. The server binds
 * to loopback only: it can start any command in the registry, so it is a local
 * tool, never something to expose on a network.
 */
import color from "picocolors";
import { allGroups } from "../cli/registry";
import { log } from "../shared/ui";
import type { FormValues } from "./args";
import { buildArgv } from "./args";
import { findCommand, serializeGroups } from "./catalog";
import { streamRun } from "./runner";
import index from "./app/index.html";

const HOST = "127.0.0.1";
const PORT = Number(process.env["TOOLS_UI_PORT"] ?? 3030);

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

  return new Response(streamRun(argv, req.signal), {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/x-ndjson; charset=utf-8",
      // Output arrives as it is produced, so nothing may buffer it on the way.
      "x-content-type-options": "nosniff",
    },
  });
}

// Return type is inferred: Bun.Server's generic parameter moves between versions.
function start() {
  try {
    return Bun.serve({
      development: process.env["NODE_ENV"] !== "production",
      hostname: HOST,
      port: PORT,
      routes: {
        "/": index,
        "/api/commands": () => Response.json(serializeGroups(allGroups)),
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

console.log(`\n  ${color.green("●")} tools UI  ${color.cyan(server.url.href)}\n`);
