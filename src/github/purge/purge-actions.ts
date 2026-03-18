import {
  PurgeActionsOptionsSchema,
  type WorkflowRun,
} from "../../shared/types/github";
import {
  ensureGhAuth,
  formatError,
  parseDuration,
  runGh,
  runGhJson,
  sleep,
} from "../shared";

type GhRun = {
  conclusion: string | null;
  createdAt: string;
  databaseId: number;
  displayTitle: string;
  status: string;
  workflowName?: string;
};

export class PurgeActionsService {
  private readonly options: ReturnType<typeof PurgeActionsOptionsSchema.parse>;

  constructor(options: unknown) {
    this.options = PurgeActionsOptionsSchema.parse(options);
  }

  async purge(): Promise<{ deleted: number; total: number }> {
    await ensureGhAuth();

    const runs = await this.getWorkflowRuns();
    const filtered = this.filterRuns(runs);

    if (this.options.dryRun) {
      console.log(`[DRY RUN] Would delete ${filtered.length} workflow runs`);
      for (const run of filtered.slice(0, 10)) {
        console.log(
          `  - ${run.name} (${run.id}) - ${run.status}/${run.conclusion ?? "N/A"}`,
        );
      }
      if (filtered.length > 10) {
        console.log(`  ... and ${filtered.length - 10} more`);
      }
      return { deleted: 0, total: filtered.length };
    }

    let deleted = 0;
    const batches = this.chunk(filtered, this.options.batchSize);

    for (const [index, batch] of batches.entries()) {
      await Promise.all(
        batch.map(async (run) => {
          try {
            await runGh([
              "run",
              "delete",
              String(run.id),
              "--repo",
              this.options.repo,
            ]);
            deleted += 1;
            console.log(`✓ Deleted run ${run.id}: ${run.name}`);
          } catch (error) {
            console.error(
              `✗ Failed to delete run ${run.id}: ${formatError(error)}`,
            );
          }
        }),
      );

      if (index < batches.length - 1) {
        await sleep(1000);
      }
    }

    return { deleted, total: filtered.length };
  }

  private async getWorkflowRuns(): Promise<WorkflowRun[]> {
    const args = [
      "run",
      "list",
      "--repo",
      this.options.repo,
      "--limit",
      "1000",
      "--json",
      "databaseId,displayTitle,workflowName,status,conclusion,createdAt",
    ];

    if (this.options.workflow) {
      args.push("--workflow", this.options.workflow);
    }

    if (this.options.status !== "all") {
      args.push("--status", this.options.status);
    }

    const runs = await runGhJson<GhRun[]>(args);

    return runs.map((run) => ({
      conclusion: run.conclusion,
      createdAt: run.createdAt,
      id: run.databaseId,
      name: run.workflowName ?? run.displayTitle,
      status: run.status,
      updatedAt: run.createdAt,
    }));
  }

  private filterRuns(runs: WorkflowRun[]): WorkflowRun[] {
    let filtered = [...runs];

    if (this.options.olderThan) {
      const cutoffDate = parseDuration(this.options.olderThan);
      filtered = filtered.filter((run) => new Date(run.updatedAt) < cutoffDate);
    }

    if (this.options.keepLatest > 0) {
      filtered = filtered.slice(this.options.keepLatest);
    }

    return filtered;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }
}

export async function purgeActions(args: unknown): Promise<void> {
  try {
    const service = new PurgeActionsService(args);
    const result = await service.purge();

    if (result.deleted > 0) {
      console.log(
        `\n✅ Deleted ${result.deleted} of ${result.total} workflow runs`,
      );
    } else {
      console.log("\nℹ️  No workflow runs to delete");
    }

    process.exitCode = 0;
  } catch (error) {
    console.error(`❌ Error: ${formatError(error)}`);
    process.exitCode = 1;
  }
}
