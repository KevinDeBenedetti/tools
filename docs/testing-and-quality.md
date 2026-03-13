---
title: Testing and Quality
---

# Testing and Quality

## Test suite

Shell tools are tested with Bats under `tests/github/`.

Run all tests:

```bash
make test
```

Run a specific script test:

```bash
make test-purge-actions
make test-scan-secrets
```

## Linting

Run ShellCheck for all scripts:

```bash
make lint
```

## Suggested CI baseline

A practical baseline for CI jobs in this repository:

1. `make lint`
2. `make test`

Add project-specific checks (for example, Rust checks in `app/`) as needed.

## Local troubleshooting

- Confirm executable bits on scripts (`chmod +x shell/github/*.sh`)
- Validate `gh auth status` for GitHub-dependent tests
- Run individual Bats files from `tests/github/` when narrowing failures
