import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

// The compose file publishes a port to a server that spawns arbitrary CLI
// commands. Binding it anywhere but loopback turns "can reach the port" into
// "can run commands on this machine", so the pin is a security boundary rather
// than a preference — and boundaries that nothing checks are the ones that get
// relaxed by a well-meaning edit.
//
// The YAML is parsed directly instead of shelling out to `docker compose
// config`: the property holds in the file, the check should not need a daemon,
// and CI should not have to install one to run the suite.
//
// The Dockerfile's own guards live next door, in dockerfile.test.ts.

const REPO_ROOT = join(import.meta.dir, "..", "..");

/**
 * The names Compose looks for, in its own order of preference: the first that
 * exists is the one `docker compose` reads, and therefore the one worth
 * checking. `docker-compose.*` are the backward-compatible spellings.
 *
 * This list is the single place the compose file is named. Spelling it anywhere
 * else — a comment, a doc, a second constant — is what left dead references
 * behind the last time it was renamed, so those all say "the compose file" now.
 *
 * https://docs.docker.com/compose/intro/compose-application-model/
 */
const COMPOSE_FILENAMES = [
  "compose.yaml",
  "compose.yml",
  "docker-compose.yaml",
  "docker-compose.yml",
] as const;

/** The name Compose would resolve to, given which candidates exist. */
export function resolveComposeName(exists: (name: string) => boolean): string | undefined {
  return COMPOSE_FILENAMES.find(exists);
}

const composeName = resolveComposeName((name) => existsSync(join(REPO_ROOT, name)));
if (composeName === undefined) {
  throw new Error(`No compose file in ${REPO_ROOT} — looked for ${COMPOSE_FILENAMES.join(", ")}`);
}

// js-yaml 5 dropped the default export from its ESM build — named only.
const compose = load(readFileSync(join(REPO_ROOT, composeName), "utf8")) as ComposeFile;

interface ComposeFile {
  services: Record<
    string,
    { ports?: (string | LongPort)[]; environment?: Record<string, unknown> }
  >;
}

interface LongPort {
  host_ip?: string;
  published?: string | number;
  target?: number;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/** `${VAR:-default}` carries a colon of its own; mask it before splitting fields. */
const INTERPOLATION = /\$\{[^}]*\}/g;

/**
 * The host interface a short-form mapping pins, or undefined when it pins none.
 *
 * Compose reads `[HOST_IP:][HOST_PORT:]CONTAINER_PORT[/PROTO]`, so only the
 * three-field form names an interface at all — `3030:3030` and a bare `3030`
 * both land on every interface, which is exactly what must not happen here.
 */
export function hostInterface(spec: string): string | undefined {
  const masked = spec.replace(INTERPOLATION, " ").split("/")[0] ?? "";

  // IPv6 literals are bracketed: [::1]:3030:3030
  const bracketed = /^\[([^\]]+)\]:/.exec(masked);
  if (bracketed !== null) return bracketed[1];

  const fields = masked.split(":");
  return fields.length >= 3 ? fields[0] : undefined;
}

function publishedInterfaces(): { service: string; spec: string; hostIp: string | undefined }[] {
  return Object.entries(compose.services).flatMap(([service, definition]) =>
    (definition.ports ?? []).map((port) =>
      typeof port === "string"
        ? { hostIp: hostInterface(port), service, spec: port }
        : { hostIp: port.host_ip, service, spec: JSON.stringify(port) },
    ),
  );
}

describe("compose file", () => {
  test("was found and parses", () => {
    // Renaming it to any spelling Compose accepts keeps this suite running; the
    // failure mode to avoid is a rename that silently stops the checks below.
    expect(composeName).toBeDefined();
    expect(compose.services).toBeDefined();
  });

  test("every published port is pinned to loopback", () => {
    const published = publishedInterfaces();
    expect(published.length).toBeGreaterThan(0);

    for (const { service, spec, hostIp } of published) {
      expect(
        hostIp !== undefined && LOOPBACK.has(hostIp),
        `service "${service}" publishes ${spec} — a port reachable off this host runs commands on it`,
      ).toBe(true);
    }
  });

  test("the container binds every interface, which is what makes the pin load-bearing", () => {
    // These two belong together: 0.0.0.0 inside the container is required for
    // the host to reach it at all, and is only safe because of the pin above.
    expect(compose.services["ui"]?.environment?.["TOOLS_UI_HOST"]).toBe("0.0.0.0");
  });
});

describe("resolveComposeName", () => {
  test("prefers compose.yaml when several spellings exist", () => {
    // Docker's documented order. Reading a file Compose would ignore would make
    // every assertion above check the wrong thing.
    expect(resolveComposeName(() => true)).toBe("compose.yaml");
  });

  test("falls back through the backward-compatible names", () => {
    expect(resolveComposeName((n) => n === "docker-compose.yaml")).toBe("docker-compose.yaml");
    expect(resolveComposeName((n) => n === "docker-compose.yml")).toBe("docker-compose.yml");
    expect(resolveComposeName((n) => n === "compose.yml")).toBe("compose.yml");
  });

  test("reports nothing when no compose file exists", () => {
    expect(resolveComposeName(() => false)).toBeUndefined();
  });
});

describe("hostInterface", () => {
  // A guard that cannot fail is decoration. These are the shapes a future edit
  // would plausibly introduce, each of which must be rejected.
  test("accepts the pinned forms", () => {
    expect(hostInterface("127.0.0.1:3030:3030")).toBe("127.0.0.1");
    expect(hostInterface("127.0.0.1:${TOOLS_UI_PORT:-3030}:3030")).toBe("127.0.0.1");
    expect(hostInterface("[::1]:3030:3030")).toBe("::1");
    expect(hostInterface("127.0.0.1:3030:3030/tcp")).toBe("127.0.0.1");
  });

  test("reports no interface for the forms that publish to the world", () => {
    expect(hostInterface("3030:3030")).toBeUndefined();
    expect(hostInterface("3030")).toBeUndefined();
    expect(hostInterface("${TOOLS_UI_PORT:-3030}:3030")).toBeUndefined();
  });

  test("a non-loopback pin is reported as itself, and so fails the membership check", () => {
    expect(LOOPBACK.has(hostInterface("0.0.0.0:3030:3030") ?? "")).toBe(false);
    expect(LOOPBACK.has(hostInterface("192.168.1.10:3030:3030") ?? "")).toBe(false);
  });
});
