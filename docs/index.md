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

- [Getting Started](./getting-started)
- [Shell Tools](./shell/shell-tools)
- [Makefile Fragments](./makefiles/makefile-fragments)
- [Docker Templates](./docker/docker-templates)
- [CLI App](./app/cli)
- [Testing and Quality](./tests/testing-and-quality)

## Intended audience

This documentation is for developers and maintainers who want reusable, script-first workflows across multiple repositories.

## Safety guidance

Some commands can delete resources (workflow runs, packages, releases, tags). Always begin with `--dry-run` when available.
