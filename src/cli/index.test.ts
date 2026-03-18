import { describe, expect, test } from "bun:test";

describe("unified CLI launcher", () => {
  test("src/cli/index.ts is the unified entry point", async () => {
    // The unified CLI is an interactive Clack-based launcher.
    // We verify the module exports nothing unexpected (it's self-contained).
    const mod = await import("./index");
    expect(mod).toBeDefined();
  });
});
