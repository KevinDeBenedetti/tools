---
title: GitHub — Bot Detection
---

# Detect (and remove) bot commits

`detect-bots` scans a repository's git history for commits authored by bots
(Dependabot, Renovate, GitHub Actions, Copilot, Claude, …) and can optionally
rewrite history to remove them.

```bash
# Scan the current repository
bun run github detect-bots

# Scan a remote repo (cloned into a temp dir)
bun run github detect-bots --repo owner/repo --local=false

# Machine-readable output
bun run github detect-bots --format json
```

## Flags

| Flag           | Default | Description                                          |
| -------------- | ------- | ---------------------------------------------------- |
| `--repo`       | —       | GitHub repo (`owner/repo`) to clone and scan         |
| `--local`      | `true`  | Scan the local repository (set `false` to clone `--repo`) |
| `--dry-run`    | off     | Show what would be done without doing it             |
| `--purge-bots` | off     | Remove bot commits from git history                  |
| `--format`     | `text`  | Output format (`text` or `json`)                     |

## What counts as a bot

Detection matches author name/email against a built-in pattern list:
`dependabot`, `renovate`, `github-actions`, `greenkeeper`, `snyk-bot`,
`imgbot`, `codecov`, `netlify`, `vercel`, `semantic-release-bot`,
`release-please`, `copilot`, `claude`, `anthropic`, and the `[bot]` suffix.

The output reports the matched commits, the total commit count, and the
percentage of history attributed to bots.

## Removing bot commits

```bash
# Preview the rewrite first
bun run github detect-bots --purge-bots --dry-run

# Then rewrite history
bun run github detect-bots --purge-bots
```

::: warning History rewrite
`--purge-bots` rewrites git history, which changes commit SHAs and requires a
force-push (`git push --force-with-lease`). Prefer running it against a fresh
clone (`--repo owner/repo --local=false`). For normalizing human author
identities (rather than removing bots), see
[`clean-authors`](../getting-started.md#safety-guidance).
:::
