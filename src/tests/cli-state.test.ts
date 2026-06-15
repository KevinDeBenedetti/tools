import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lastValue, loadState, rememberValues } from "../cli/state";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tools-state-"));
  process.env["TOOLS_STATE_PATH"] = join(dir, "state.json");
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
  delete process.env["TOOLS_STATE_PATH"];
});

describe("state persistence", () => {
  test("loadState returns an empty object when no file exists", () => {
    expect(loadState()).toEqual({});
    expect(lastValue("repo")).toBeUndefined();
  });

  test("rememberValues persists scalars and round-trips via lastValue", () => {
    rememberValues({ keepLatest: 5, repo: "octo/tools" });
    expect(lastValue("repo")).toBe("octo/tools");
    expect(lastValue("keepLatest")).toBe("5");
    expect(loadState()).toEqual({ keepLatest: "5", repo: "octo/tools" });
  });

  test("ignores booleans, arrays and empty strings", () => {
    rememberValues({ blank: "", execute: true, patterns: ["a", "b"], repo: "octo/tools" });
    expect(loadState()).toEqual({ repo: "octo/tools" });
  });

  test("merges across calls, newest value winning", () => {
    rememberValues({ repo: "octo/one" });
    rememberValues({ canonical: "me@x.dev", repo: "octo/two" });
    expect(loadState()).toEqual({ canonical: "me@x.dev", repo: "octo/two" });
  });

  test("a corrupt state file is treated as empty", () => {
    process.env["TOOLS_STATE_PATH"] = join(dir, "missing", "deep", "state.json");
    expect(loadState()).toEqual({});
    rememberValues({ repo: "octo/tools" }); // creates parent dirs
    expect(lastValue("repo")).toBe("octo/tools");
  });
});
