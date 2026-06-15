---
title: Todo Sync
---

# TODO ⇄ GitHub Issues

The `todo` group keeps a `TODO.yml` file and a repository's GitHub Issues in
sync, and syncs label definitions. It is designed to run both locally and
inside GitHub Actions — every flag falls back to the environment variable used
in the workflow, so the same code path works in both contexts.

```bash
bun run todo push     # TODO.yml → Issues
bun run todo pull     # an Issue event → TODO.yml
bun run todo labels   # labels.yml → repo labels
```

## Flag / environment-variable mapping

Flags take precedence; when omitted, the matching environment variable is used.

| Flag             | Env var             | Default      | Used by         |
| ---------------- | ------------------- | ------------ | --------------- |
| `--repo`         | `GITHUB_REPOSITORY` | —            | all (required)  |
| `--todo-path`    | `TODO_PATH`         | `TODO.yml`   | push, pull      |
| `--issue-number` | `ISSUE_NUMBER`      | —            | pull (required) |
| `--labels-path`  | `LABELS_PATH`       | `labels.yml` | labels          |

## `push` — TODO.yml → Issues

Creates or updates GitHub Issues from the entries in `TODO.yml`.

```bash
bun run todo push --repo owner/repo --todo-path TODO.yml
```

## `pull` — Issue event → TODO.yml

Syncs changes from a single GitHub Issue back into `TODO.yml`. Typically driven
by an `issues` workflow event, which provides `ISSUE_NUMBER`.

```bash
bun run todo pull --repo owner/repo --issue-number 42
```

## `labels` — sync label definitions

Applies the label definitions in `labels.yml` to the repository.

```bash
bun run todo labels --repo owner/repo --labels-path labels.yml
```

::: tip Running in GitHub Actions
Because every flag falls back to an environment variable, no flags are needed
when the workflow already exports `GITHUB_REPOSITORY`, `TODO_PATH`,
`ISSUE_NUMBER` and `LABELS_PATH`.
:::
