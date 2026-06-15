---
title: GitHub — Purge
---

# Purge artifacts

The `purge-*` commands delete GitHub artifacts — workflow runs, package
versions, releases and tags. They share one safety model: every command
**defaults to a dry-run preview** and only deletes once you pass `--execute`.

```bash
bun run github purge-actions  --repo owner/repo
bun run github purge-packages --repo owner/repo --package-name app
bun run github purge-release  --repo owner/repo --pattern 'nightly-*'
bun run github purge-tags     --repo owner/repo --pattern 'v0.*'
```

`--repo` falls back to the `GITHUB_REPOSITORY` environment variable, so it can be
omitted inside GitHub Actions.

## How a purge runs

1. The command resolves the candidate list (a side-effect-free `plan()`) and
   prints it as a table.
2. Without `--execute` it stops there — **a dry run that deletes nothing**.
3. With `--execute` on a TTY it asks for a final red confirmation (defaulting to
   *no*) showing the count and repository, then deletes.
4. With `--execute` in CI (non-TTY) it deletes without prompting, so existing
   automation is unaffected.

See [Interactive CLI — Destructive previews](../cli/interactive.md#destructive-previews)
for the confirmation flow.

## `purge-actions` — workflow runs

Delete GitHub Actions workflow runs.

| Flag           | Default | Description                                  |
| -------------- | ------- | -------------------------------------------- |
| `--repo`       | env     | GitHub repo (`owner/repo`), required         |
| `--workflow`   | —       | Limit to a specific workflow name            |
| `--older-than` | —       | Delete runs older than (e.g. `30d`, `6m`)    |
| `--keep-latest`| `0`     | Number of most recent runs to keep           |
| `--status`     | `all`   | Filter by workflow status or conclusion      |
| `--batch-size` | `50`    | Batch size for deletions                     |
| `--execute`    | off     | Actually delete (otherwise dry-run preview)  |

```bash
# Keep the 5 newest runs, delete the rest
bun run github purge-actions --repo owner/repo --keep-latest 5 --execute

# Only failed runs from a single workflow, older than 30 days
bun run github purge-actions --repo owner/repo --workflow ci.yml \
  --status failure --older-than 30d --execute
```

## `purge-packages` — package versions

Delete versions from GitHub Packages.

| Flag             | Default     | Description                                |
| ---------------- | ----------- | ------------------------------------------ |
| `--repo`         | env         | GitHub repo (`owner/repo`), required       |
| `--package-name` | —           | Name of the package, required              |
| `--package-type` | `container` | Package type (`npm`, `docker`, `container`, …) |
| `--keep-latest`  | `0`         | Number of most recent versions to keep     |
| `--older-than`   | —           | Delete versions older than (e.g. `30d`)    |
| `--execute`      | off         | Actually delete (otherwise dry-run preview)|

```bash
bun run github purge-packages --repo owner/repo --package-name app \
  --keep-latest 2 --execute
```

::: warning Required scopes
`purge-packages` needs `read:packages` for previews and additionally
`delete:packages` to delete. Add them with
`gh auth refresh --scopes read:packages,delete:packages`.
:::

## `purge-release` — releases

Delete GitHub Releases by tag or glob pattern.

| Flag           | Default | Description                                  |
| -------------- | ------- | -------------------------------------------- |
| `--repo`       | env     | GitHub repo (`owner/repo`), required         |
| `--tag`        | —       | A specific release tag to delete             |
| `--pattern`    | —       | Glob pattern matching release tags           |
| `--keep-latest`| `0`     | Number of most recent releases to keep       |
| `--execute`    | off     | Actually delete (otherwise dry-run preview)  |

```bash
bun run github purge-release --repo owner/repo --pattern 'nightly-*' \
  --keep-latest 3 --execute
```

## `purge-tags` — git tags

Delete Git tags from a remote repository by glob pattern.

| Flag           | Default | Description                                  |
| -------------- | ------- | -------------------------------------------- |
| `--repo`       | env     | GitHub repo (`owner/repo`), required         |
| `--pattern`    | —       | Glob pattern matching tag names to delete    |
| `--exclude`    | —       | Glob pattern for tags to exclude             |
| `--keep-latest`| `0`     | Number of most recent tags to keep           |
| `--execute`    | off     | Actually delete (otherwise dry-run preview)  |

```bash
# Delete every v0.* tag except release candidates, keep the 2 most recent
bun run github purge-tags --repo owner/repo --pattern 'v0.*' \
  --exclude '*-rc*' --keep-latest 2 --execute
```
