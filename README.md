# tools

Reusable tooling for GitHub maintenance, project bootstrapping, and stack-specific developer workflows.

This repository groups four kinds of assets:

- GitHub automation scripts for cleanup, hygiene, and security checks
- reusable `make` fragments for Vue, Nuxt, and FastAPI projects
- Docker templates for supported stacks
- a Rust CLI/TUI (`devkit`) to apply stack templates quickly

## What this repo is for

Use this repository when you want to:

- clean up GitHub Actions runs, packages, releases, or tags
- scan repositories for potential secrets
- detect bot-generated commits before cleaning history
- standardize project commands across Vue, Nuxt, or FastAPI repos
- start from opinionated Docker baselines
- apply stack configuration through the `devkit` CLI

## How to use it

### 1. Run maintenance scripts

Most day-to-day usage starts from the root `Makefile`, which forwards flags through `ARGS`:

```bash
make help
make purge-actions ARGS="--repo owner/repo --dry-run"
make purge-packages ARGS="--owner your-user --package-type container --dry-run"
make scan-secrets ARGS="--repo owner/repo --history"
```

The backing scripts live in `shell/github/` and can also be called directly with `--help`.

### 2. Reuse the Makefile fragments

The `makefiles/` directory contains reusable fragments for:

- `vue.mk`
- `nuxt.mk`
- `fastapi.mk`

Typical integration:

```makefile
JS_PKG_MANAGER := pnpm
VUE_DIR := .
DOCKER := false

include path/to/tools/makefiles/vue.mk
```

### 3. Start from Docker templates

Use `docker/fastapi/`, `docker/nuxt/`, and `docker/vue/` as baseline container templates for supported stacks.

### 4. Use the Rust app

The `app/` directory contains `devkit`, a Rust CLI/TUI that supports:

- `init` for the interactive TUI flow
- `config` to apply one or more stack configs directly
- `list` to print available stacks

## Repository layout

```text
tools/
├── app/          # Rust CLI/TUI
├── docker/       # Docker templates by stack
├── docs/         # Extended documentation
├── makefiles/    # Reusable make fragments
├── shell/        # Shell automation
└── tests/        # Bats test suite
```

## Quick start

Prerequisites:

- `bash`
- `make`
- `gh`
- `jq`
- `docker` when using container workflows
- `bats` and `shellcheck` when running tests and linting
- `cargo`/`rustup` when building `app/`

Common commands:

```bash
make help
make test
make lint
```

## Documentation

Start with [`docs/index.md`](docs/index.md), then use the section that matches your workflow:

- [`docs/getting-started.md`](docs/getting-started.md) — prerequisites, GitHub auth, first commands
- [`docs/shell/shell-tools.md`](docs/shell/shell-tools.md) — full shell script reference
- [`docs/makefiles/makefile-fragments.md`](docs/makefiles/makefile-fragments.md) — Vue, Nuxt, and FastAPI fragments
- [`docs/docker/docker-templates.md`](docs/docker/docker-templates.md) — Docker template usage
- [`docs/app/cli.md`](docs/app/cli.md) — `devkit` CLI/TUI reference
- [`docs/tests/testing-and-quality.md`](docs/tests/testing-and-quality.md) — Bats, ShellCheck, and CI notes

## Safety

Several maintenance commands delete remote resources. Start with `--dry-run` whenever available, then rerun without it only after reviewing the target set.

Examples:

```bash
make purge-release ARGS="--repo owner/repo --keep-latest 3 --dry-run"
make purge-tags ARGS="--repo owner/repo --tag-pattern 'v0.*' --dry-run"
```
