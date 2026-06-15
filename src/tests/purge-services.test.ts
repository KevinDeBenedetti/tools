import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  formatError,
  globToRegExp,
  matchesPattern,
  parseDuration,
  runCommand,
} from "../shared/cli";

// Intercept the gh layer so purge services run against canned responses.
// State is reset in beforeEach; handler maps a gh invocation to its stdout.
let ghInvocations: string[][] = [];
let ghHandler: (args: string[]) => string = () => "";

mock.module("../github/shared", () => ({
  ensureGhAuth: async () => {},
  formatError,
  globToRegExp,
  matchesPattern,
  parseDuration,
  runCommand,
  runGh: async (args: string[]) => {
    ghInvocations.push(args);
    return { exitCode: 0, stderr: "", stdout: ghHandler(args) };
  },
  runGhJson: async (args: string[]) => {
    ghInvocations.push(args);
    return JSON.parse(ghHandler(args));
  },
  sleep: async () => {},
}));

const { PurgeActionsService } = await import("../github/purge/purge-actions");
const { PurgePackagesService } = await import("../github/purge/purge-packages");
const { PurgeReleaseService } = await import("../github/purge/purge-release");
const { PurgeTagsService } = await import("../github/purge/purge-tags");

function deleteCalls(): string[][] {
  return ghInvocations.filter((args) => args.includes("DELETE") || args.includes("delete"));
}

beforeEach(() => {
  ghInvocations = [];
  ghHandler = () => "";
});

describe("PurgeTagsService", () => {
  function withTags(tags: string[]): void {
    ghHandler = (args) => (args.includes("--paginate") ? tags.join("\n") : "");
  }

  test("defaults to dry-run when dryRun is not provided", async () => {
    withTags(["v0.1.0", "v0.2.0"]);

    const result = await new PurgeTagsService({ pattern: "v0.*", repo: "octo/tools" }).purge();

    expect(result).toEqual({ deleted: 0, total: 2 });
    expect(deleteCalls()).toHaveLength(0);
  });

  test("deletes matching tags when dryRun is false", async () => {
    withTags(["v0.1.0", "v0.2.0", "v1.0.0"]);

    const result = await new PurgeTagsService({
      dryRun: false,
      pattern: "v0.*",
      repo: "octo/tools",
    }).purge();

    expect(result).toEqual({ deleted: 2, total: 2 });
    const deletions = deleteCalls();
    expect(deletions).toHaveLength(2);
    expect(deletions[0]).toContain("repos/octo/tools/git/refs/tags/v0.1.0");
  });

  test("honours exclude pattern and keepLatest", async () => {
    withTags(["v0.5.0", "v0.4.0", "v0.3.0", "v0.3.0-rc1"]);

    const result = await new PurgeTagsService({
      dryRun: false,
      exclude: "*-rc*",
      keepLatest: 1,
      pattern: "v0.*",
      repo: "octo/tools",
    }).purge();

    expect(result).toEqual({ deleted: 2, total: 2 });
    expect(deleteCalls().flat().join(" ")).not.toContain("rc1");
  });

  test("plan() lists candidates without deleting", async () => {
    withTags(["v0.1.0", "v0.2.0", "v1.0.0"]);

    const items = await new PurgeTagsService({ pattern: "v0.*", repo: "octo/tools" }).plan();

    expect(items).toEqual(["v0.1.0", "v0.2.0"]);
    expect(deleteCalls()).toHaveLength(0);
  });
});

describe("PurgeReleaseService", () => {
  function withReleases(releases: { tagName: string; name?: string }[]): void {
    ghHandler = (args) => (args.includes("list") ? JSON.stringify(releases) : "");
  }

  test("defaults to dry-run and reports matching releases", async () => {
    withReleases([{ tagName: "v1.0.0" }, { tagName: "v1.1.0" }]);

    const result = await new PurgeReleaseService({ pattern: "v1.*", repo: "octo/tools" }).purge();

    expect(result).toEqual({ deleted: 0, total: 2 });
    expect(deleteCalls()).toHaveLength(0);
  });

  test("deletes a single release by exact tag", async () => {
    withReleases([{ tagName: "v1.0.0" }, { tagName: "v1.1.0" }]);

    const result = await new PurgeReleaseService({
      dryRun: false,
      repo: "octo/tools",
      tag: "v1.0.0",
    }).purge();

    expect(result).toEqual({ deleted: 1, total: 1 });
    const [deletion] = deleteCalls();
    expect(deletion).toContain("v1.0.0");
    expect(deletion).toContain("--cleanup-tag");
  });

  test("keepLatest skips the most recent matching releases", async () => {
    withReleases([{ tagName: "v1.2.0" }, { tagName: "v1.1.0" }, { tagName: "v1.0.0" }]);

    const result = await new PurgeReleaseService({
      dryRun: false,
      keepLatest: 2,
      pattern: "v1.*",
      repo: "octo/tools",
    }).purge();

    expect(result).toEqual({ deleted: 1, total: 1 });
    expect(deleteCalls()[0]).toContain("v1.0.0");
  });

  test("plan() lists candidates without deleting", async () => {
    withReleases([{ name: "First", tagName: "v1.0.0" }, { tagName: "v1.1.0" }]);

    const items = await new PurgeReleaseService({ pattern: "v1.*", repo: "octo/tools" }).plan();

    expect(items).toEqual(["v1.0.0 — First", "v1.1.0"]);
    expect(deleteCalls()).toHaveLength(0);
  });
});

describe("PurgeActionsService", () => {
  function withRuns(runs: object[]): void {
    ghHandler = (args) => (args.includes("list") ? JSON.stringify(runs) : "");
  }

  const oldRun = {
    conclusion: "success",
    createdAt: "2020-01-01T00:00:00Z",
    databaseId: 1,
    displayTitle: "old run",
    status: "completed",
    workflowName: "ci",
  };
  const recentRun = {
    conclusion: "success",
    createdAt: new Date().toISOString(),
    databaseId: 2,
    displayTitle: "recent run",
    status: "completed",
    workflowName: "ci",
  };

  test("defaults to dry-run and counts targeted runs", async () => {
    withRuns([oldRun, recentRun]);

    const result = await new PurgeActionsService({ repo: "octo/tools" }).purge();

    expect(result).toEqual({ deleted: 0, total: 2 });
    expect(deleteCalls()).toHaveLength(0);
  });

  test("olderThan only targets runs before the cutoff", async () => {
    withRuns([oldRun, recentRun]);

    const result = await new PurgeActionsService({
      dryRun: false,
      olderThan: "30d",
      repo: "octo/tools",
    }).purge();

    expect(result).toEqual({ deleted: 1, total: 1 });
    expect(deleteCalls()[0]).toContain("1");
  });

  test("keepLatest preserves the most recent runs", async () => {
    withRuns([recentRun, oldRun]);

    const result = await new PurgeActionsService({
      dryRun: false,
      keepLatest: 1,
      repo: "octo/tools",
    }).purge();

    expect(result).toEqual({ deleted: 1, total: 1 });
  });

  test("plan() lists candidates without deleting", async () => {
    withRuns([oldRun, recentRun]);

    const items = await new PurgeActionsService({ olderThan: "30d", repo: "octo/tools" }).plan();

    expect(items).toEqual(["ci (1) — completed/success"]);
    expect(deleteCalls()).toHaveLength(0);
  });
});

describe("PurgePackagesService", () => {
  function withVersions(versions: object[]): void {
    // --slurp wraps pages in an outer array
    ghHandler = (args) => (args.includes("--slurp") ? JSON.stringify([versions]) : "");
  }

  const versions = [
    {
      created_at: "2024-03-01T00:00:00Z",
      id: 30,
      name: "1.2.0",
      updated_at: "2024-03-01T00:00:00Z",
    },
    {
      created_at: "2024-02-01T00:00:00Z",
      id: 20,
      name: "1.1.0",
      updated_at: "2024-02-01T00:00:00Z",
    },
    {
      created_at: "2024-01-01T00:00:00Z",
      id: 10,
      name: "1.0.0",
      updated_at: "2024-01-01T00:00:00Z",
    },
  ];

  test("defaults to dry-run and keeps everything", async () => {
    withVersions(versions);

    const result = await new PurgePackagesService({
      keepLatest: 1,
      packageName: "tools",
      repo: "octo/tools",
    }).purge();

    expect(result).toEqual({ deleted: 0, kept: 1 });
    expect(deleteCalls()).toHaveLength(0);
  });

  test("deletes versions beyond keepLatest, newest first kept", async () => {
    withVersions(versions);

    const result = await new PurgePackagesService({
      dryRun: false,
      keepLatest: 1,
      packageName: "tools",
      repo: "octo/tools",
    }).purge();

    expect(result).toEqual({ deleted: 2, kept: 1 });
    const deletedUrls = deleteCalls().flat().join(" ");
    expect(deletedUrls).toContain("/versions/20");
    expect(deletedUrls).toContain("/versions/10");
    expect(deletedUrls).not.toContain("/versions/30");
  });

  test("plan() lists candidates without deleting", async () => {
    withVersions(versions);

    const items = await new PurgePackagesService({
      keepLatest: 1,
      packageName: "tools",
      repo: "octo/tools",
    }).plan();

    expect(items).toEqual(["1.1.0 (id 20)", "1.0.0 (id 10)"]);
    expect(deleteCalls()).toHaveLength(0);
  });
});
