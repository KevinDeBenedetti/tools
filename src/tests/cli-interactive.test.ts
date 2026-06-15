import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { CommandGroup, CommandSpec } from "../cli/types";

// ── @clack/prompts mock ─────────────────────────────────────────────────────────
//
// select() resolves to the value of the option whose label matches the next
// entry in `selectQueue`, so tests drive the menus by label. confirm()/text()
// pull from their own queues with sensible defaults.

const selectQueue: string[] = [];
const confirmQueue: boolean[] = [];
const textQueue: string[] = [];
let introCount = 0;
let outroCount = 0;

mock.module("@clack/prompts", () => ({
  cancel: () => {},
  confirm: async () => (confirmQueue.length ? confirmQueue.shift() : true),
  intro: () => {
    introCount++;
  },
  isCancel: (v: unknown) => typeof v === "symbol",
  note: () => {},
  outro: () => {
    outroCount++;
  },
  select: async ({ options }: { options: { label: string; value: unknown }[] }) => {
    const label = selectQueue.shift();
    if (label === "__CANCEL__") {
      return Symbol("cancel");
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
  text: async () => (textQueue.length ? textQueue.shift() : ""),
}));

const { runRootInteractive, runGroupInteractive } = await import("../cli/interactive");

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

afterEach(() => {
  calls.length = 0;
  selectQueue.length = 0;
  confirmQueue.length = 0;
  textQueue.length = 0;
});

beforeEach(() => {
  introCount = 0;
  outroCount = 0;
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
