---
title: Tools Documentation
---

# Tools Documentation

Reusable tooling for GitHub maintenance, project scaffolding, and stack-specific developer workflows.

## What this repository provides

- GitHub automation scripts for cleanup, hygiene, and security checks
- Makefile fragments for Vue, Nuxt, and FastAPI projects
- Docker templates for each supported stack
- A Rust CLI/TUI to apply stack templates quickly

## Start here

- [Getting Started](./getting-started.md)
- [Shell Tools](./shell/shell-tools.md)
- [Makefile Fragments](./makefiles/makefile-fragments.md)
- [Docker Templates](./docker/docker-templates.md)
- [CLI App](./app/cli.md)
- [Testing and Quality](./tests/testing-and-quality.md)

## Intended audience

This documentation is for developers and maintainers who want reusable, script-first workflows across multiple repositories.

## Safety guidance

Some commands can delete resources (workflow runs, packages, releases, tags). Always begin with `--dry-run` when available.
