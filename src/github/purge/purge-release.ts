import { PurgeReleaseOptionsSchema, type Release } from "../../shared/types/github";
import { ensureGhAuth, formatError, matchesPattern, runGh, runGhJson } from "../shared";

interface GhRelease {
  createdAt?: string;
  isDraft?: boolean;
  isPrerelease?: boolean;
  name?: string;
  publishedAt?: string | null;
  tagName: string;
}

export class PurgeReleaseService {
  private readonly options: ReturnType<typeof PurgeReleaseOptionsSchema.parse>;

  constructor(options: unknown) {
    this.options = PurgeReleaseOptionsSchema.parse(options);
  }

  async purge(): Promise<{ deleted: number; total: number }> {
    await ensureGhAuth();

    const releases = await this.getAllReleases();
    const toDelete = this.filterReleases(releases);

    if (this.options.dryRun) {
      console.log(`[DRY RUN] Would delete ${toDelete.length} releases:`);
      for (const release of toDelete) {
        console.log(`  - ${release.tagName}: ${release.name}`);
      }
      return { deleted: 0, total: toDelete.length };
    }

    let deleted = 0;
    for (const release of toDelete) {
      try {
        await runGh([
          "release",
          "delete",
          release.tagName,
          "--repo",
          this.options.repo,
          "--cleanup-tag",
          "--yes",
        ]);
        deleted += 1;
        console.log(`✓ Deleted release ${release.tagName}`);
      } catch (error) {
        console.error(`✗ Failed to delete ${release.tagName}: ${formatError(error)}`);
      }
    }

    return { deleted, total: toDelete.length };
  }

  private async getAllReleases(): Promise<Release[]> {
    const releases = await runGhJson<GhRelease[]>([
      "release",
      "list",
      "--repo",
      this.options.repo,
      "--limit",
      "1000",
      "--json",
      "tagName,name,isDraft,isPrerelease,createdAt,publishedAt",
    ]);

    return releases.map((release) => ({
      createdAt: release.createdAt ?? "",
      draft: release.isDraft ?? false,
      id: 0,
      name: release.name ?? release.tagName,
      prerelease: release.isPrerelease ?? false,
      publishedAt: release.publishedAt ?? null,
      tagName: release.tagName,
    }));
  }

  private filterReleases(releases: Release[]): Release[] {
    let filtered = [...releases];

    if (this.options.tag) {
      return filtered.filter((release) => release.tagName === this.options.tag);
    }

    filtered = filtered.filter((release) => matchesPattern(release.tagName, this.options.pattern));

    if (this.options.keepLatest > 0) {
      filtered = filtered.slice(this.options.keepLatest);
    }

    return filtered;
  }
}

export async function purgeRelease(args: unknown): Promise<void> {
  try {
    const service = new PurgeReleaseService(args);
    const result = await service.purge();
    console.log(`\n✅ Deleted ${result.deleted} of ${result.total} releases`);
    process.exitCode = 0;
  } catch (error) {
    console.error(`❌ Error: ${formatError(error)}`);
    process.exitCode = 1;
  }
}
