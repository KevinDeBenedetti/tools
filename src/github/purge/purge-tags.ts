import { type GitTag, PurgeTagsOptionsSchema } from "../../shared/types/github";
import { ensureGhAuth, formatError, matchesPattern, runGh } from "../shared";

export class PurgeTagsService {
  private readonly options: ReturnType<typeof PurgeTagsOptionsSchema.parse>;

  constructor(options: unknown) {
    this.options = PurgeTagsOptionsSchema.parse(options);
  }

  async purge(): Promise<{ deleted: number; total: number }> {
    await ensureGhAuth();

    const tags = await this.getAllTags();
    const toDelete = this.filterTags(tags);

    if (this.options.dryRun) {
      console.log(`[DRY RUN] Would delete ${toDelete.length} tags:`);
      for (const tag of toDelete) {
        console.log(`  - ${tag.name}`);
      }
      return { deleted: 0, total: toDelete.length };
    }

    let deleted = 0;
    for (const tag of toDelete) {
      try {
        await runGh([
          "api",
          "-X",
          "DELETE",
          `repos/${this.options.repo}/git/refs/tags/${tag.name}`,
          "--silent",
        ]);
        deleted += 1;
        console.log(`✓ Deleted tag ${tag.name}`);
      } catch (error) {
        console.error(`✗ Failed to delete ${tag.name}: ${formatError(error)}`);
      }
    }

    return { deleted, total: toDelete.length };
  }

  private async getAllTags(): Promise<GitTag[]> {
    const result = await runGh(
      ["api", `repos/${this.options.repo}/tags`, "--paginate", "--jq", ".[].name"],
      { allowFailure: false },
    );

    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((name) => ({
        commit: {
          sha: "",
          url: "",
        },
        name,
      }));
  }

  private filterTags(tags: GitTag[]): GitTag[] {
    let filtered = [...tags];

    if (this.options.keepLatest > 0) {
      filtered = filtered.slice(this.options.keepLatest);
    }

    return filtered.filter(
      (tag) =>
        matchesPattern(tag.name, this.options.pattern) &&
        !matchesPattern(tag.name, this.options.exclude),
    );
  }
}

export async function purgeTags(args: unknown): Promise<void> {
  try {
    const service = new PurgeTagsService(args);
    const result = await service.purge();
    console.log(`\n✅ Deleted ${result.deleted} of ${result.total} tags`);
    process.exitCode = 0;
  } catch (error) {
    console.error(`❌ Error: ${formatError(error)}`);
    process.exitCode = 1;
  }
}
