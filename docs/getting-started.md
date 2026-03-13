---
title: Getting Started
---

# Getting Started

## Prerequisites

Install the following tools before using this repository:

- `bash`
- `make`
- `gh` (GitHub CLI)
- `jq`
- `bats` (for tests)
- `shellcheck` (for linting)
- `docker` (for container workflows)

## Verify your environment

```bash
command -v gh jq bats shellcheck make
```

For GitHub scripts, ensure you are authenticated:

```bash
gh auth status
```

## Common first commands

```bash
make help
make test
make lint
```

## Usage model

The root Makefile maps script names to shell scripts and passes custom flags through `ARGS`.

```bash
make purge-actions ARGS="--repo owner/repo --dry-run"
make purge-packages ARGS="--owner your-user --package-type container --dry-run"
make scan-secrets ARGS="--repo owner/repo --history"
```

## Documentation map

- [Shell Tools](./shell/shell-tools)
- [Makefile Fragments](./makefiles/makefile-fragments)
- [Docker Templates](./docker/docker-templates)
- [CLI App](./cli)
- [Testing and Quality](./tests/testing-and-quality)
