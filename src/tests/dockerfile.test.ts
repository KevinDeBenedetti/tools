import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// What the image must keep true regardless of who edits it next: the shipped
// stage runs unprivileged, a bare `docker build .` produces that stage and not
// the development one, and no credential is baked into a layer.
//
// Checked by reading the Dockerfile rather than building it — the properties are
// textual, and CI should not need a daemon to run the suite. The build itself is
// exercised by the `docker` job in .github/workflows/ci-cd.yml.
//
// The compose file's own guards live next door, in compose.test.ts.

const DOCKERFILE_PATH = join(import.meta.dir, "..", "..", "Dockerfile");

interface Stage {
  name: string;
  instructions: { verb: string; args: string }[];
}

/**
 * Split a Dockerfile into its named build stages.
 *
 * Enough of the grammar to reason about stages and not a byte more: comments
 * dropped, backslash continuations joined, instruction verbs upper-cased. It is
 * not a Dockerfile parser and should not grow into one — the moment a question
 * needs more than this, it wants `docker build` and a daemon.
 */
export function parseStages(source: string): Stage[] {
  const joined = source.replace(/\\\r?\n\s*/g, " ");
  const stages: Stage[] = [];

  for (const line of joined.split("\n")) {
    const text = line.trim();
    if (text === "" || text.startsWith("#")) continue;

    const [rawVerb = "", ...rest] = text.split(/\s+/);
    const verb = rawVerb.toUpperCase();
    const args = rest.join(" ");

    if (verb === "FROM") {
      const named = /\sAS\s+(\S+)\s*$/i.exec(` ${args}`);
      stages.push({ instructions: [], name: named?.[1] ?? args.split(/\s+/)[0] ?? "" });
      continue;
    }
    stages.at(-1)?.instructions.push({ args, verb });
  }

  return stages;
}

/** The USER in effect at the end of a stage — the last one wins. */
export function finalUser(stage: Stage): string | undefined {
  return stage.instructions
    .filter((i) => i.verb === "USER")
    .at(-1)
    ?.args.trim();
}

const ROOT = new Set(["root", "0", "root:root", "0:0"]);

const stages = parseStages(readFileSync(DOCKERFILE_PATH, "utf8"));

describe("Dockerfile", () => {
  test("the runtime stage drops root", () => {
    // The runtime image is the one that would ever be shipped or left running;
    // a container that keeps root there gives anything that escapes the process
    // a much better starting position. The dev stage stays root on purpose —
    // see the note on it about bind-mount ownership.
    const runtime = stages.find((s) => s.name === "runtime");

    expect(runtime, "no stage named 'runtime'").toBeDefined();
    expect(finalUser(runtime!)).toBe("bun");
  });

  test("runtime is the last stage, so a bare `docker build .` is the hardened one", () => {
    // Without --target, Docker builds the final stage. If dev ever drifts to the
    // bottom, the default build silently becomes the root, hot-reloading image.
    expect(stages.at(-1)?.name).toBe("runtime");
  });

  test("no credential is baked into any stage", () => {
    // Secrets belong to run time; an ENV here would be readable in the image
    // history forever, by anyone who pulls it.
    const secretish = /(_KEY|_TOKEN|_SECRET|PASSWORD)\s*=\s*\S/i;
    for (const stage of stages) {
      for (const { verb, args } of stage.instructions) {
        if (verb !== "ENV" && verb !== "ARG") continue;
        expect(secretish.test(args), `${stage.name}: ${verb} ${args}`).toBe(false);
      }
    }
  });
});

describe("parseStages", () => {
  const fixture = [
    "# a comment",
    "FROM base AS one",
    "USER root",
    "USER app",
    "FROM scratch AS two",
    "ENV A=1 \\",
    "    B=2",
  ].join("\n");

  test("names stages and keeps their instructions in order", () => {
    const parsed = parseStages(fixture);
    expect(parsed.map((s) => s.name)).toEqual(["one", "two"]);
    expect(parsed[1]?.instructions).toEqual([{ args: "A=1 B=2", verb: "ENV" }]);
  });

  test("the last USER wins, which is the one the container actually runs as", () => {
    expect(finalUser(parseStages(fixture)[0]!)).toBe("app");
  });

  test("a stage that never drops root reports root", () => {
    // The shape the guard above exists to catch.
    const rooted = parseStages("FROM base AS runtime\nRUN true");
    expect(finalUser(rooted[0]!)).toBeUndefined();
    expect(ROOT.has(finalUser(parseStages("FROM b AS r\nUSER root")[0]!) ?? "")).toBe(true);
  });
});
