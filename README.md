# tools

A collection of shell scripts and utilities for development workflows.

## Shell scripts

| Script                      | Description                            |
| --------------------------- | -------------------------------------- |
| `shell/purge-gh-release.sh` | Delete GitHub releases from a repo     |
| `shell/purge-gh-actions.sh` | Delete GitHub Actions runs from a repo |

```bash
./shell/purge-gh-release.sh <owner/repo> [--dry-run] [--keep-latest <n>] [--tag-pattern <glob>]
./shell/purge-gh-actions.sh <owner/repo> [--dry-run] [--keep-latest <n>] [--workflow <name>] [--status <status>]
```

## Requirements

- [gh](https://cli.github.com/) + [jq](https://jqlang.github.io/jq/)