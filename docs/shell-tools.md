---
title: Shell Tools
---

# Shell Tools

Scripts are located in `shell/github/` and exposed via root `make` targets.

## Script catalog

| Script              | Purpose                                 | Notable flags                                                                                             |
| ------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `purge-actions.sh`  | Delete workflow runs                    | `--repo`, `--keep-latest`, `--workflow`, `--status`, `--dry-run`                                          |
| `purge-packages.sh` | Delete package versions                 | `--owner`, `--org`, `--package-type`, `--package-name`, `--keep-latest`, `--version-pattern`, `--dry-run` |
| `purge-release.sh`  | Delete releases and tags                | `--repo`, `--keep-latest`, `--tag-pattern`, `--dry-run`                                                   |
| `purge-tags.sh`     | Delete tags                             | `--repo`, `--keep-latest`, `--tag-pattern`, `--dry-run`                                                   |
| `detect-bots.sh`    | Detect bot commits (and optional purge) | `--repo`, `--local`, `--format`, `--purge-bots`, `--dry-run`                                              |
| `scan-secrets.sh`   | Detect potential secret leaks           | `--repo`, `--local`, `--history`, `--dry-run`                                                             |

## Run scripts directly

```bash
./shell/github/purge-actions.sh --repo owner/repo --dry-run
./shell/github/purge-packages.sh --owner your-user --package-type container --dry-run
```

## Run scripts through make

```bash
make purge-actions ARGS="--repo owner/repo --dry-run"
make purge-packages ARGS="--owner your-user --package-type container --dry-run"
make purge-release ARGS="--repo owner/repo --keep-latest 3"
make purge-tags ARGS="--repo owner/repo --tag-pattern 'v0.*'"
make detect-bots ARGS="--repo owner/repo --format json"
make scan-secrets ARGS="--local --history"
```

## Required permissions and scopes

- `gh auth status` must succeed
- package deletion requires `read:packages` and `delete:packages`
- release and tag deletion requires repository write permissions

## Operational safety

- Use `--dry-run` before destructive commands
- Keep latest N artifacts with `--keep-latest`
- Narrow target sets with pattern flags (`--tag-pattern`, `--version-pattern`)
