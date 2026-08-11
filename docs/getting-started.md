---
title: Getting Started
---

# Getting Started

## Prerequisites

The following tools are required to use this repository.

| Tool             | Purpose                                          | Install (macOS)             | Install (Debian/Ubuntu)          |
| ---------------- | ------------------------------------------------ | --------------------------- | -------------------------------- |
| `bun`            | Runtime, package manager and test runner         | `brew install oven-sh/bun/bun` | see [bun.sh][bun-install]     |
| `gh`             | GitHub CLI — authenticate and call GitHub APIs   | `brew install gh`           | see [cli.github.com][gh-install] |
| `git filter-repo`| Fast history rewriting (clean-authors, bot purge)| `brew install git-filter-repo` | `apt install git-filter-repo` |
| `docker`         | Required for container workflow templates        | [Docker Desktop][docker-dl] | `apt install docker.io`          |

[bun-install]: https://bun.sh
[gh-install]: https://cli.github.com
[docker-dl]: https://www.docker.com/products/docker-desktop/

`git filter-repo` is optional — `clean-authors` falls back to `git filter-branch` when it is missing, but `filter-repo` is much faster and safer.

## Install

```bash
bun install
bunx prek install   # set up pre-commit/pre-push hooks
```

## Authenticate with GitHub

Log in and request the scopes needed by the maintenance commands:

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
`purge-packages` requires `read:packages` for previews and additionally `delete:packages` for actual deletion.
:::

## Common first commands

```bash
bun run tools          # unified CLI — interactive menu on a TTY
bun run tools --help   # list every group and command
bun run tools completion zsh > ~/.zfunc/_tools  # generate zsh completion
bun run github         # github group (interactive when no command given)
bun run test           # run the full test suite
bun run typecheck      # strict TypeScript check
bun run lint           # oxlint
```

The unified CLI exposes four groups — `github`, `todo`, `benchmark` and `copilot` — and every command can be invoked either through `bun run tools <group> <command>` or its pinned alias (`bun run github`, `bun run todo`, `bun run benchmark`, `bun run chat`).

## GitHub CLI command overview

| Command          | Action                                            |
| ---------------- | ------------------------------------------------- |
| `clean-authors`  | Normalize author identities, strip Co-Authored-By |
| `detect-bots`    | Find (and optionally purge) bot commits           |
| `purge-actions`  | Delete GitHub Actions workflow runs               |
| `purge-packages` | Delete GitHub package versions                    |
| `purge-release`  | Delete GitHub releases                            |
| `purge-tags`     | Delete Git tags from a remote repo                |
| `scan-secrets`   | Scan working tree / history for secret patterns   |

## Usage model

Each command can be invoked through `bun run github` or its dedicated script:

```bash
bun run github -- purge-actions --repo owner/repo
bun run github:purge-tags -- --repo owner/repo --pattern 'v0.*'
bun run github:clean-authors -- --canonical you@example.com
bun run github:detect-bots -- --format json
bun run github:scan-secrets -- --local --history
```

Run `bun run github -- <command> --help` for command-specific flags, or `bun run github:menu` for the interactive TUI.

## Safety guidance

Destructive commands (`purge-*`, `clean-authors`) **default to a dry-run preview**. Nothing is deleted or rewritten until you pass `--execute`. The dry run lists exactly what would be affected, and in an interactive terminal `--execute` adds a final red confirmation before deleting (see [Interactive CLI — Destructive previews](./cli/interactive.md#destructive-previews)).

```bash
# See what would be deleted — nothing is removed
bun run github:purge-packages -- --repo owner/repo --package-name app

# Then add --execute once satisfied
bun run github:purge-packages -- --repo owner/repo --package-name app --keep-latest 2 --execute
```

Use `--keep-latest <n>` to retain a minimum number of recent artifacts, and pattern flags to narrow the target set:

```bash
bun run github:purge-actions -- --repo owner/repo --keep-latest 5 --execute
bun run github:purge-tags -- --repo owner/repo --pattern 'v0.*' --exclude '*-rc*'
```

`clean-authors` rewrites history; prefer running it against a fresh clone with `--repo`:

```bash
# Scan identities and Co-Authored-By trailers (read-only)
bun run github:clean-authors -- --repo owner/repo

# Preview the rewrite plan, then execute and force-push
bun run github:clean-authors -- --repo owner/repo --canonical you@example.com
bun run github:clean-authors -- --repo owner/repo --canonical you@example.com --execute
```

## Tests

```bash
bun run test                        # full suite with coverage
bun test src/tests/todo.test.ts     # single file
bun run typecheck:tests             # typecheck including test files
```

Service tests use fakes and temporary git repositories — no real GitHub calls are made.

## Documentation map

- [Interactive CLI](./cli/interactive.md) — menu, guided wizard, shell completion, remembered values
- [Web UI](./cli/web-ui.md) — `bun run ui`, the same commands as a local browser form
- [Makefile Fragments](./makefiles/makefile-fragments.md) — Vue, Nuxt, FastAPI fragments
- [Docker Templates](./docker/docker-templates.md) — stack Dockerfiles
- [GitHub — Purge](./github/purge.md) — purge actions, packages, releases, tags
- [GitHub — Bot Detection](./github/bot.md) — detect and remove bot commits
- [GitHub — Secrets](./github/secrets.md) — scan for secrets in history
- [Benchmark](./benchmark/benchmark.md) — benchmark OpenAI-compatible models (latency, TTFT, throughput, cost)
- [Todo Sync](./todo/todo.md) — bidirectional sync between TODO.yml and GitHub Issues
- [Copilot SDK](./copilot/copilot-sdk.md) — Copilot extension SDK usage
- [Copilot Instructions](./copilot/instructions.md) — writing Copilot instructions
- **[Copilot Chat & Sessions](./copilot/chat-and-sessions.md)** — interactive chat, persistent sessions, session resumption
