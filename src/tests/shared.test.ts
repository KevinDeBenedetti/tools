import { describe, expect, test } from "bun:test";
import { matchesPattern, parseDuration } from "../shared/cli";

describe("parseDuration", () => {
  test("parses day-based durations", () => {
    const before = Date.now();
    const parsed = parseDuration("2d");
    const elapsed = before - parsed.getTime();

    expect(elapsed).toBeGreaterThan(47 * 60 * 60 * 1000);
    expect(elapsed).toBeLessThan(49 * 60 * 60 * 1000);
  });

  test("throws for invalid durations", () => {
    expect(() => parseDuration("soon")).toThrow();
  });
});

describe("matchesPattern", () => {
  test("matches simple glob patterns", () => {
    expect(matchesPattern("v1.2.3", "v*")).toBe(true);
    expect(matchesPattern("release-candidate", "*candidate")).toBe(true);
    expect(matchesPattern("main", "release-*")).toBe(false);
  });

  test("accepts undefined patterns as match-all", () => {
    expect(matchesPattern("anything", undefined)).toBe(true);
  });
});
