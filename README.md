# tools

[![CI/CD](https://img.shields.io/github/actions/workflow/status/KevinDeBenedetti/tools/ci-cd.yml?style=for-the-badge&label=CI%2FCD)](https://github.com/KevinDeBenedetti/tools/actions/workflows/ci-cd.yml)

> Reusable tooling for GitHub maintenance, project bootstrapping, and stack-specific developer workflows.

## Features

- Shell scripts for GitHub automation: cleanup, hygiene, and security scanning
- Reusable Makefile fragments for Vue, Nuxt, and FastAPI projects
- Docker templates organized by stack
- `devkit` — Rust CLI/TUI to apply stack templates interactively
- Local web UI (`bun run ui`) — the same commands as a browser form, generated from the command registry (React + shadcn/ui)
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

## Running in Docker

Brings up the web UI with the source bind-mounted, so a save in your editor
restarts the server:

```bash
bun run docker:up      # build + start, waits for the healthcheck
bun run docker:logs    # follow the server output
bun run docker:down    # stop
```

Handy while it runs:

```bash
bun run docker:sh                          # shell inside the container
bun run docker:cli -- benchmark models      # run the CLI in the container
```

The host port comes from `TOOLS_UI_PORT` (default `3030`); the container side is
fixed, so `TOOLS_UI_PORT=3035 bun run docker:up` moves only the published port.
`TOOLS_TARGET=runtime` builds the self-contained image — no mounts, no hot
reload, unprivileged user — instead of the development one.

Credentials are never baked into the image. Provide them through `.env`, the
environment, or the UI's own **Environment** page.

> **The published port is bound to `127.0.0.1` on purpose.** This server starts
> any command in the registry, so reaching the port is equivalent to running
> commands on the host. Keep it on loopback.

## Documentation

Full documentation is available at **https://kevindebenedetti.github.io/tools/**.
It is generated from the `docs/` directory and published automatically on push.
