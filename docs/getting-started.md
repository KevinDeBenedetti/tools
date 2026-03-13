---
title: Getting Started
---

# Getting Started

## Prerequisites

The following tools are required to use this repository.

| Tool             | Purpose                                        | Install (macOS)             | Install (Debian/Ubuntu)          |
| ---------------- | ---------------------------------------------- | --------------------------- | -------------------------------- |
| `bash`           | Shell runtime for all scripts                  | built-in                    | `apt install bash`               |
| `make`           | Task runner — maps targets to shell scripts    | `xcode-select --install`    | `apt install make`               |
| `gh`             | GitHub CLI — authenticate and call GitHub APIs | `brew install gh`           | see [cli.github.com][gh-install] |
| `jq`             | JSON processing for API responses              | `brew install jq`           | `apt install jq`                 |
| `bats`           | Shell test framework                           | `brew install bats-core`    | `apt install bats`               |
| `shellcheck`     | Static analysis for bash scripts               | `brew install shellcheck`   | `apt install shellcheck`         |
| `docker`         | Required for container workflow templates      | [Docker Desktop][docker-dl] | `apt install docker.io`          |
| `cargo`/`rustup` | Required to build the `devkit` CLI app         | `brew install rustup`       | `curl https://sh.rustup.rs       | sh` |

[gh-install]: https://cli.github.com
[docker-dl]: https://www.docker.com/products/docker-desktop/

## Verify your environment

```bash
command -v bash make gh jq bats shellcheck
```

Check Git submodules (Bats helpers) are initialised:

```bash
git submodule update --init --recursive
```

## Authenticate with GitHub

Log in and request the scopes needed by all scripts:

```bash
gh auth login
```

If you already have a token but need to add package scopes:

```bash
gh auth refresh --scopes read:packages,delete:packages
```

Verify authenticated scopes:

```bash
gh auth status
```

::: warning Required scopes
`purge-packages.sh` requires `read:packages` for dry-runs and additionally `delete:packages` for actual deletion. The script checks both and prints a clear remediation command if scopes are missing.
:::

## Common first commands

```bash
make help      # list all available targets
make test      # run the full Bats test suite
make lint      # run ShellCheck on every script
```

## Makefile target overview

| Target           | Action                                          |
| ---------------- | ----------------------------------------------- |
| `help`           | Print all available targets with descriptions   |
| `purge-actions`  | Delete GitHub Actions workflow runs             |
| `purge-packages` | Delete GitHub package versions                  |
| `purge-release`  | Delete GitHub releases                          |
| `purge-tags`     | Delete Git tags from a remote repo              |
| `detect-bots`    | Find (and optionally purge) bot commits         |
| `scan-secrets`   | Scan working tree / history for secret patterns |
| `test`           | Run all Bats tests under `tests/github/`        |
| `test-<script>`  | Run tests for a single script                   |
| `lint`           | Run ShellCheck with `--severity=warning`        |

## Usage model

All scripts are invoked through the root Makefile, which forwards extra flags through `ARGS`:

```bash
make purge-actions  ARGS="--repo owner/repo --dry-run"
make purge-packages ARGS="--owner your-user --package-type container --dry-run"
make purge-release  ARGS="--repo owner/repo --keep-latest 3"
make purge-tags     ARGS="--repo owner/repo --tag-pattern 'v0.*' --dry-run"
make detect-bots    ARGS="--repo owner/repo --format json"
make scan-secrets   ARGS="--local --history"
```

You can also call scripts directly:

```bash
./shell/github/purge-actions.sh --help
./shell/github/scan-secrets.sh --dry-run
```

## Safety guidance

All destructive scripts support `--dry-run`. **Always preview before deleting.**

```bash
# See what would be deleted — nothing is removed
make purge-packages ARGS="--owner you --package-type container --dry-run"

# Then run without --dry-run once satisfied
make purge-packages ARGS="--owner you --package-type container --keep-latest 2"
```

Use `--keep-latest <n>` to retain a minimum number of recent artifacts:

```bash
make purge-actions ARGS="--repo owner/repo --keep-latest 5"
```

Use pattern flags to narrow the target set before deleting:

```bash
make purge-tags    ARGS="--repo owner/repo --tag-pattern 'v0.*' --dry-run"
make purge-packages ARGS="--owner you --version-pattern '*-rc*' --dry-run"
```

## Testing a single script

```bash
make test-purge-actions
make test-purge-packages
make test-scan-secrets
```

All tests use mocked `gh` and `jq` binaries — no real GitHub calls are made.

## Documentation map

- [Shell Tools](./shell/shell-tools) — full flag reference for every script
- [Makefile Fragments](./makefiles/makefile-fragments) — Vue, Nuxt, FastAPI fragments
- [Docker Templates](./docker/docker-templates) — stack Dockerfiles
- [CLI App](./app/cli) — `devkit` Rust CLI usage
- [Testing and Quality](./tests/testing-and-quality) — Bats setup and CI baseline
- [Repository Reference](./reference) — full annotated repository structure
