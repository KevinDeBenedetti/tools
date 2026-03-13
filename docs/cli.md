---
title: CLI App
---

# CLI App

The Rust application in `app/` provides an interactive and scripted way to apply stack configurations.

## Commands

- `devkit init --path <target>`: start the TUI flow
- `devkit config <stack...> [--path <target>]`: apply one or more stacks directly
- `devkit list`: list available stacks

Current supported stacks:

- `vue`
- `nuxt`
- `fastapi`

## Build and run with make

From `app/`:

```bash
make build
make run
make run-list
make check
make test
make ci
```

## Direct cargo usage

```bash
cargo run -- init
cargo run -- list
cargo run -- config vue --path ./example-project
```

## What the CLI generates

For each selected stack, the app creates stack-specific template files (for example a Makefile fragment and Docker files), then reports next steps.
