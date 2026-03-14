# tools

Reusable tooling for GitHub maintenance, project bootstrapping, and stack-specific developer workflows.

<div align="center">

[![Documentation](https://img.shields.io/badge/Documentation-online-blue?style=for-the-badge&logo=gitbook)](https://kevindebenedetti.github.io/tools/)
[![Getting Started](https://img.shields.io/badge/Getting%20Started-guide-green?style=for-the-badge)](https://kevindebenedetti.github.io/tools/getting-started)

</div>

## What's inside

| Directory | Purpose |
|-----------|---------|
| `shell/` | GitHub automation scripts — cleanup, hygiene, and security scans |
| `makefiles/` | Reusable `make` fragments for Vue, Nuxt, and FastAPI |
| `docker/` | Docker templates by stack |
| `app/` | `devkit` — Rust CLI/TUI to apply stack templates |

## Quick start

```bash
make help    # list all available targets
make test    # run the Bats test suite
make lint    # run ShellCheck
```

Prerequisites: `bash`, `make`, `gh`, `jq` — see the [Getting Started guide](https://kevindebenedetti.github.io/tools/getting-started) for full setup.

## Documentation

Full reference is available at **[kevindebenedetti.github.io/tools](https://kevindebenedetti.github.io/tools/)**.

| Section | Topic |
|---------|-------|
| [Getting Started](https://kevindebenedetti.github.io/tools/getting-started) | Prerequisites, GitHub auth, first commands |
| [Shell Tools](https://kevindebenedetti.github.io/tools/shell/shell-tools) | Full shell script reference |
| [Makefile Fragments](https://kevindebenedetti.github.io/tools/makefiles/makefile-fragments) | Vue, Nuxt, and FastAPI fragments |
| [Docker Templates](https://kevindebenedetti.github.io/tools/docker/docker-templates) | Docker template usage |
| [devkit CLI](https://kevindebenedetti.github.io/tools/app/cli) | `devkit` CLI/TUI reference |
| [Testing & Quality](https://kevindebenedetti.github.io/tools/tests/testing-and-quality) | Bats, ShellCheck, and CI notes |

## Safety

Commands that delete remote resources support `--dry-run`. Always run it first:

```bash
make purge-actions ARGS="--repo owner/repo --dry-run"
make purge-release ARGS="--repo owner/repo --keep-latest 3 --dry-run"
```
