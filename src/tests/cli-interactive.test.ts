import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandGroup, CommandSpec } from "../cli/types";

// ── @clack/prompts mock ─────────────────────────────────────────────────────────
//
// select() resolves to the value of the option whose label matches the next
// entry in `selectQueue`, so tests drive the menus by label. confirm()/text()
// pull from their own queues with sensible defaults.

const selectQueue: string[] = [];
const confirmQueue: boolean[] = [];
const textQueue: (string | typeof CANCEL)[] = [];
const multiselectQueue: (string[] | typeof CANCEL)[] = [];
let introCount = 0;
let outroCount = 0;

const CANCEL = Symbol("cancel");

mock.module("@clack/prompts", () => ({
  cancel: () => {},
  confirm: async () => (confirmQueue.length ? confirmQueue.shift() : true),
  intro: () => {
    introCount++;
  },
  isCancel: (v: unknown) => typeof v === "symbol",
  multiselect: async () => (multiselectQueue.length ? multiselectQueue.shift() : []),
  note: () => {},
  outro: () => {
    outroCount++;
  },
  select: async ({ options }: { options: { label: string; value: unknown }[] }) => {
    const label = selectQueue.shift();
    if (label === "__CANCEL__") {
      return CANCEL;
    }
    const opt = options.find((o) => o.label === label);
    if (!opt) {
      throw new Error(
        `test select: no option labeled "${label}" in [${options.map((o) => o.label)}]`,
      );
    }
    return opt.value;
  },
  spinner: () => ({ start: () => {}, stop: () => {} }),
  // Pulls the next queued value; falls back to the prompt's initialValue (the
  // remembered last value) when the queue is empty, and re-prompts (pulls again)
  // if validate rejects it, mirroring clack's real re-prompt loop.
  text: async ({
    validate,
    initialValue,
  }: {
    validate?: (v: unknown) => string | undefined;
    initialValue?: string;
  }) => {
    while (true) {
      const v = textQueue.length ? textQueue.shift()! : (initialValue ?? "");
      if (typeof v === "symbol") {
        return v;
      }
      const err = validate?.(v);
      if (!err) {
        return v;
      }
      if (!textQueue.length) {
        throw new Error(`test text: validation rejected "${v}": ${err}`);
      }
    }
  },
}));

const { runRootInteractive, runGroupInteractive, collectOptions } =
  await import("../cli/interactive");

// ── Fixtures ─────────────────────────────────────────────────────────────────────

const calls: string[] = [];

function makeGroups(): CommandGroup[] {
  const cmd = (name: string, extra: Partial<CommandSpec> = {}): CommandSpec => ({
    description: `${name} desc`,
    flags: [],
    name,
    run: () => {
      calls.push(name);
    },
    ...extra,
  });
  return [
    { commands: [cmd("do"), cmd("redo")], description: "alpha group", name: "alpha" },
    { commands: [cmd("solo")], description: "single group", name: "beta" },
  ];
}

let stateDir: string;

afterEach(() => {
  calls.length = 0;
  selectQueue.length = 0;
  confirmQueue.length = 0;
  textQueue.length = 0;
  multiselectQueue.length = 0;
  rmSync(stateDir, { force: true, recursive: true });
  delete process.env["TOOLS_STATE_PATH"];
});

beforeEach(() => {
  introCount = 0;
  outroCount = 0;
  // Isolate persisted state so prompts never read the real ~/.config file.
  stateDir = mkdtempSync(join(tmpdir(), "tools-itest-"));
  process.env["TOOLS_STATE_PATH"] = join(stateDir, "state.json");
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("runRootInteractive", () => {
  test("loops: runs a command then returns to the menu until Quit", async () => {
    // alpha → do, ← Back to categories, alpha → redo, ← Back, Quit
    selectQueue.push("alpha", "do", "← Back", "alpha", "redo", "← Back", "Quit");
    await runRootInteractive(makeGroups());
    expect(calls).toEqual(["do", "redo"]);
    expect(introCount).toBe(1);
    expect(outroCount).toBe(1);
  });

  test("Quit at the top level runs nothing", async () => {
    selectQueue.push("Quit");
    await runRootInteractive(makeGroups());
    expect(calls).toEqual([]);
    expect(outroCount).toBe(1);
  });

  test("cancelling the category menu (Ctrl+C) exits the loop", async () => {
    selectQueue.push("__CANCEL__");
    await runRootInteractive(makeGroups());
    expect(calls).toEqual([]);
    expect(outroCount).toBe(1);
  });
});

describe("runGroupInteractive", () => {
  test("single-command group runs the command once then exits", async () => {
    const beta = makeGroups()[1]!;
    await runGroupInteractive(beta);
    expect(calls).toEqual(["solo"]);
    expect(introCount).toBe(1);
    expect(outroCount).toBe(1);
  });

  test("multi-command group loops until Quit (top level)", async () => {
    const alpha = makeGroups()[0]!;
    selectQueue.push("do", "Quit");
    await runGroupInteractive(alpha);
    expect(calls).toEqual(["do"]);
  });
});

describe("custom interactive handler", () => {
  test("is invoked instead of the generic wizard and the loop continues", async () => {
    const groups: CommandGroup[] = [
      {
        commands: [
          {
            description: "custom cmd",
            flags: [],
            interactive: async () => {
              calls.push("custom-interactive");
            },
            name: "custom",
            run: () => {
              calls.push("custom-run");
            },
          },
          {
            description: "other",
            flags: [],
            name: "other",
            run: () => {
              calls.push("other");
            },
          },
        ],
        description: "g",
        name: "g",
      },
    ];
    selectQueue.push("g", "custom", "← Back", "Quit");
    await runRootInteractive(groups);
    expect(calls).toEqual(["custom-interactive"]);
  });
});

describe("collectOptions", () => {
  const spec = (flags: CommandSpec["flags"]): CommandSpec => ({
    description: "c",
    flags,
    name: "c",
    run: () => {},
  });

  test("always prompts required flags", async () => {
    textQueue.push("octo/repo");
    const opts = await collectOptions(
      spec([{ description: "repo", name: "repo", required: true, type: "string" }]),
    );
    expect(opts).toEqual({ repo: "octo/repo" });
  });

  test("re-prompts when a required flag is left empty", async () => {
    textQueue.push("", "octo/repo"); // empty rejected, then accepted
    const opts = await collectOptions(
      spec([{ description: "repo", name: "repo", required: true, type: "string" }]),
    );
    expect(opts).toEqual({ repo: "octo/repo" });
  });

  test("honours a custom validate before accepting", async () => {
    textQueue.push("bad", "good");
    const opts = await collectOptions(
      spec([
        {
          description: "name",
          name: "name",
          required: true,
          type: "string",
          validate: (v) => (v === "good" ? undefined : "nope"),
        },
      ]),
    );
    expect(opts).toEqual({ name: "good" });
  });

  test("only prompts optional flags the user picks", async () => {
    multiselectQueue.push(["limit"]); // pick --limit, skip --tag
    textQueue.push("5");
    const opts = await collectOptions(
      spec([
        { description: "limit", name: "limit", type: "number" },
        { description: "tag", name: "tag", type: "string" },
      ]),
    );
    expect(opts).toEqual({ limit: 5 });
  });

  test("builds string[] values until an empty entry", async () => {
    multiselectQueue.push(["pattern"]);
    textQueue.push("a", "b", ""); // two values then finish
    const opts = await collectOptions(
      spec([{ description: "pattern", name: "pattern", type: "string[]" }]),
    );
    expect(opts).toEqual({ pattern: ["a", "b"] });
  });

  test("returns null when a required prompt is cancelled", async () => {
    textQueue.push(CANCEL);
    const opts = await collectOptions(
      spec([{ description: "repo", name: "repo", required: true, type: "string" }]),
    );
    expect(opts).toBeNull();
  });

  test("no flags means no prompts and an empty object", async () => {
    expect(await collectOptions(spec([]))).toEqual({});
  });

  test("prefills a flag from the remembered last value", async () => {
    writeFileSync(process.env["TOOLS_STATE_PATH"]!, JSON.stringify({ repo: "octo/remembered" }));
    // Empty queue → the mock falls back to the prompt's initialValue (remembered).
    const opts = await collectOptions(
      spec([{ description: "repo", name: "repo", required: true, type: "string" }]),
    );
    expect(opts).toEqual({ repo: "octo/remembered" });
  });
});
