# tools

[![CI/CD](https://img.shields.io/github/actions/workflow/status/KevinDeBenedetti/tools/ci-cd.yml?style=for-the-badge&label=CI%2FCD)](https://github.com/KevinDeBenedetti/tools/actions/workflows/ci-cd.yml)

> Reusable tooling for GitHub maintenance, project bootstrapping, and stack-specific developer workflows.

## Features

- Shell scripts for GitHub automation: cleanup, hygiene, and security scanning
- Reusable Makefile fragments for Vue, Nuxt, and FastAPI projects
- Docker templates organized by stack
- `devkit` — Rust CLI/TUI to apply stack templates interactively
- Destructive commands support `--dry-run` to preview before executing
- Bats test suite and ShellCheck for all shell scripts

## Prerequisites

- `bash`, `make`, `gh`, `jq`
- See the [Getting Started guide](https://kevindebenedetti.github.io/tools/getting-started) for full setup

## Usage

```bash
make help    # list all available targets
make test    # run the Bats test suite
make lint    # run ShellCheck
```

Always preview destructive operations with `--dry-run`:

```bash
make purge-actions ARGS="--repo owner/repo --dry-run"
make purge-release ARGS="--repo owner/repo --keep-latest 3 --dry-run"
```

→ Full usage guide: [docs](https://kevindebenedetti.github.io/tools/getting-started)

## Documentation

Full documentation is available at **https://kevindebenedetti.github.io/tools/**.
It is generated from the `docs/` directory and published automatically on push.
