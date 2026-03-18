import {
  PurgePackagesOptionsSchema,
  parseRepoString,
  type PackageVersion,
} from "../../shared/types/github";
import {
  ensureGhAuth,
  formatError,
  parseDuration,
  runGh,
  runGhJson,
} from "../shared";

type GhPackageVersion = {
  created_at: string;
  id: number;
  name: string;
  updated_at: string;
};

export class PurgePackagesService {
  private readonly options: ReturnType<typeof PurgePackagesOptionsSchema.parse>;
  private readonly owner: string;

  constructor(options: unknown) {
    this.options = PurgePackagesOptionsSchema.parse(options);
    this.owner = parseRepoString(this.options.repo).owner;
  }

  async purge(): Promise<{ deleted: number; kept: number }> {
    await ensureGhAuth();

    const versions = await this.getPackageVersions();
    const sorted = this.sortByDate(versions);
    const toDelete = this.selectVersionsToDelete(sorted);

    if (this.options.dryRun) {
      console.log(`[DRY RUN] Would delete ${toDelete.length} package versions`);
      console.log(`Keeping latest ${this.options.keepLatest} versions`);
      return { deleted: 0, kept: sorted.length - toDelete.length };
    }

    let deleted = 0;
    for (const version of toDelete) {
      try {
        await runGh([
          "api",
          "-X",
          "DELETE",
          `orgs/${this.owner}/packages/${this.options.packageType}/${this.options.packageName}/versions/${version.id}`,
        ]);
        deleted += 1;
        console.log(`✓ Deleted ${version.name}@${version.version}`);
      } catch (error) {
        console.error(
          `✗ Failed to delete ${version.version}: ${formatError(error)}`,
        );
      }
    }

    return { deleted, kept: sorted.length - toDelete.length };
  }

  private async getPackageVersions(): Promise<PackageVersion[]> {
    const pages = await runGhJson<GhPackageVersion[][]>([
      "api",
      `orgs/${this.owner}/packages/${this.options.packageType}/${this.options.packageName}/versions`,
      "--paginate",
      "--slurp",
    ]);
    const versions = pages.flat();

    return versions.map((version) => ({
      createdAt: version.created_at,
      id: version.id,
      name: version.name,
      updatedAt: version.updated_at,
      version: version.name,
    }));
  }

  private sortByDate(versions: PackageVersion[]): PackageVersion[] {
    return [...versions].sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    );
  }

  private selectVersionsToDelete(sorted: PackageVersion[]): PackageVersion[] {
    let toDelete = sorted.slice(this.options.keepLatest);

    if (this.options.olderThan) {
      const cutoffDate = parseDuration(this.options.olderThan);
      toDelete = toDelete.filter(
        (version) => new Date(version.createdAt) < cutoffDate,
      );
    }

    return toDelete;
  }
}

export async function purgePackages(args: unknown): Promise<void> {
  try {
    const service = new PurgePackagesService(args);
    const result = await service.purge();
    console.log(`\n✅ Deleted ${result.deleted} versions, kept ${result.kept}`);
    process.exitCode = 0;
  } catch (error) {
    console.error(`❌ Error: ${formatError(error)}`);
    process.exitCode = 1;
  }
}
