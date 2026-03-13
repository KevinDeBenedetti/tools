# tools

Reusable development tooling for GitHub maintenance, project scaffolding, and containerized application workflows.

This repository contains:

- GitHub-oriented shell automation scripts
- stack-specific Makefile fragments for Vue, Nuxt, and FastAPI projects
- production-ready Docker templates
- a Rust CLI/TUI generator for applying stack configuration files

## Table of contents

- [tools](#tools)
  - [Table of contents](#table-of-contents)
  - [Overview](#overview)
  - [Repository structure](#repository-structure)
  - [Quick start](#quick-start)
  - [Shell tools](#shell-tools)
  - [Makefile fragments](#makefile-fragments)
  - [Docker templates](#docker-templates)
  - [Rust CLI app](#rust-cli-app)
  - [Testing and quality](#testing-and-quality)
  - [Git hooks (prek)](#git-hooks-prek)
  - [CI/CD](#cicd)
  - [Documentation](#documentation)

## Overview

The goal of this project is to make common DevEx and repository maintenance tasks consistent, scriptable, and easy to reuse across repositories.

Primary use cases:

- cleaning old GitHub Actions runs, releases, tags, and package versions
- scanning repositories for potential secrets
- detecting bot-generated commits (with optional history rewrite)
- bootstrapping stack-specific build and Docker workflows

## Repository structure

```text
tools/
	app/                  # Rust CLI/TUI (devkit)
	docker/               # Docker templates by stack
	docs/                 # Extended documentation
	makefiles/            # Reusable make fragments
	shell/github/         # GitHub automation scripts
	tests/github/         # Bats tests for shell scripts
```

## Quick start

Prerequisites:

- `bash`
- `make`
- `gh` (GitHub CLI)
- `jq`
- `bats` (for tests)
- `shellcheck` (for linting)
- `docker` (when using Docker-based workflows)

Run help and tests:

```bash
make help
make test
make lint
```

Example script usage through make:

```bash
make purge-actions ARGS="--repo owner/repo --dry-run"
make purge-packages ARGS="--owner your-user --package-type container --dry-run"
make scan-secrets ARGS="--repo owner/repo --history"
```

## Shell tools

Location: `shell/github/`

| Script              | Purpose                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `purge-actions.sh`  | Delete GitHub Actions workflow runs with optional filters        |
| `purge-packages.sh` | Delete package versions for user/org packages                    |
| `purge-release.sh`  | Delete releases (and tags) with keep/pattern options             |
| `purge-tags.sh`     | Delete tags with keep/pattern options                            |
| `detect-bots.sh`    | Detect bot commits, optionally purge them with `git-filter-repo` |
| `scan-secrets.sh`   | Scan working tree and optional history for secret-like patterns  |

Every script supports `--help`. Most destructive workflows support `--dry-run` and should be previewed before execution.

## Makefile fragments

Location: `makefiles/`

| Fragment     | Focus                           |
| ------------ | ------------------------------- |
| `vue.mk`     | Vue project lifecycle tasks     |
| `nuxt.mk`    | Nuxt project lifecycle tasks    |
| `fastapi.mk` | FastAPI project lifecycle tasks |

Each fragment maps the standard target set:

- `validate`
- `dev`
- `build`
- `lint`
- `clean`
- `upgrade`

Example:

```makefile
JS_PKG_MANAGER := pnpm
VUE_DIR := .
DOCKER := false

include path/to/tools/makefiles/vue.mk
```

## Docker templates

Location: `docker/`

- `docker/fastapi/`
- `docker/nuxt/`
- `docker/vue/`

These templates provide stack-focused Dockerfiles and `.dockerignore` defaults intended as baseline production-ready images.

## Rust CLI app

Location: `app/`

The Rust app (`devkit`) supports:

- `init`: interactive TUI flow to select path and stack
- `config`: apply one or more stack configs directly
- `list`: print available stacks

App make targets are in `app/Makefile` (build, run, check, fmt, clippy, test, release).

## Testing and quality

- shell tests: `make test`
- single script test: `make test-purge-actions` (replace suffix as needed)
- shell lint: `make lint`

Tests use Bats and supporting assertion helpers vendored under `tests/test_helper/`.

All Bats tests mock `gh` and `jq` binaries — no real GitHub calls are made during the test suite.

## Git hooks (prek)

Quality gates are enforced with [prek](https://prek.j178.dev), configured in `prek.toml`.

Install hooks once after cloning:

```bash
brew install j178/tap/prek
prek install
```

Pre-commit checks: trailing whitespace, end-of-file, YAML validation, shellcheck (`--severity=warning`), yamllint.

Run all checks manually:

```bash
prek run --all-files
```

## CI/CD

Push and PR events trigger the reusable pipeline from `KevinDeBenedetti/github-workflows`:

| Job        | Steps                                                 |
| ---------- | ----------------------------------------------------- |
| `ci`       | ShellCheck, actionlint, Bats tests                    |
| `security` | Secret scanning (gitleaks/trufflehog)                 |
| `dispatch` | Triggers docs rebuild on `kevindebenedetti.github.io` |

## Documentation

Detailed docs are available in `docs/`:

- `docs/index.md` — overview and navigation hub
- `docs/getting-started.md` — prerequisites, auth setup, first commands
- `docs/reference.md` — full annotated repository structure
- `docs/shell/shell-tools.md` — complete flag reference for every script
- `docs/makefiles/makefile-fragments.md` — how to use Vue, Nuxt, and FastAPI fragments
- `docs/docker/docker-templates.md` — stack Dockerfile usage and recommendations
- `docs/app/cli.md` — `devkit` Rust CLI reference
- `docs/tests/testing-and-quality.md` — Bats test suite and CI baseline