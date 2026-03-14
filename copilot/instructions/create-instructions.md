# Generate `.github/copilot-instructions.md` for this repository

You are onboarding this repository to GitHub Copilot. Your goal is to produce a
`.github/copilot-instructions.md` file that lets any coding agent work efficiently
on a first encounter — without needing to re-explore the codebase every time.

---

## Rules

- Only document facts you have **verified** by reading actual files in this repo.
- Do **not** hallucinate commands, paths, or tools that don't exist here.
- Keep the output to **≤ 150 lines** of Markdown.
- Write in natural language. Use Markdown headings and bullet lists.
- Instructions must **not** be task-specific; they describe the repo, not a feature.
- If a section has nothing to say, omit it entirely.

---

## Steps to follow

### 1 — Inventory the repository

Read and reason over each of the following before writing anything:

- `README.md` — project purpose, layout, quick-start
- `Makefile` (root and `app/`) — all targets and what they invoke
- `prek.toml` — pre-commit/pre-push hooks and required tools
- `.github/workflows/*.yml` — CI/CD jobs and reusable workflow calls
- `shell/github/*.sh` — shell script entry points and their `--help` blocks
- `makefiles/*.mk` — reusable Make fragments (Vue, Nuxt, FastAPI)
- `docker/` — available container templates by stack
- `app/` — Rust CLI/TUI source (`main.rs`, `Cargo.toml`)
- `tests/` — Bats test layout and helper structure
- `docs/` — extended documentation index

### 2 — Verify every command before documenting it

Run each command you plan to mention. If it fails, note the error and the fix.
If it requires a precondition (e.g. `gh auth login`, `bats` installed), state it.

### 3 — Write the instructions file

Produce `.github/copilot-instructions.md` structured as follows:

```markdown
# Copilot instructions

## Repository overview
<!-- One short paragraph: what the repo is, who uses it, what it contains. -->

## Prerequisites
<!-- Binaries / tools that must be present (bash, make, gh, jq, bats,
     shellcheck, cargo/rustup, docker, prek). One bullet per tool. -->

## Repository layout
<!-- Mirror the tree in README.md. Keep it short — one line per directory. -->

## Build & run (Rust CLI)
<!-- cd app && cargo build / cargo run -- init / cargo test -->

## Shell tools
<!-- make <target> ARGS="..." pattern. List every make target from the root
     Makefile with its one-line description.
     Remind: always pass --dry-run first for destructive operations. -->

## Reusable Make fragments
<!-- makefiles/vue.mk, nuxt.mk, fastapi.mk: required variables, how to include. -->

## Docker templates
<!-- docker/fastapi/, docker/nuxt/, docker/vue/ — purpose and usage. -->

## Testing
<!-- make test  →  bats tests/github/
     make test-<target>  →  single script test
     prek hook runs bats on pre-push -->

## Linting
<!-- make lint  →  shellcheck --severity=warning on shell/github/
     prek hooks: shellcheck, yamllint, actionlint, trailing-whitespace, etc.
     prek run --all-files to run all hooks manually -->

## CI/CD
<!-- .github/workflows/ci-cd.yml calls reusable workflows from
     KevinDeBenedetti/github-workflows. Jobs: ci → security → dispatch.
     PRs targeting main trigger the full pipeline. -->

## Pre-commit hooks (prek)
<!-- prek install  — run once after cloning
     prek run      — run on staged files
     prek run --all-files — run everything
     Hooks enforce: trailing whitespace, LF endings, shellcheck, yamllint,
     actionlint, detect-private-key, bats (pre-push). -->

## Key conventions
<!-- - Shell scripts use set -euo pipefail and --dry-run guards.
     - All make targets forward flags via ARGS="...".
     - Destructive make targets always support --dry-run; use it first.
     - Bats tests live in tests/github/ and mirror shell/github/ one-to-one.
     - Reusable workflows are imported, not inlined. -->
```

### 4 — Self-verify

Before saving, confirm:

- [ ] Every command in the file runs without error (or the error is documented).
- [ ] No invented paths, targets, or tool flags.
- [ ] File is ≤ 150 lines.
- [ ] No task-specific instructions (no "implement feature X" language).
- [ ] All six make scripts (`purge-actions`, `purge-packages`, `purge-release`,
      `purge-tags`, `backup-repos`, `clean-repo`, `detect-bots`, `maintain-all`,
      `scan-secrets`) are listed with their purpose.
