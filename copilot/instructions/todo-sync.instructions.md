# Set up `TODO.yml` ↔ GitHub Issues sync in this repository

You are configuring the reusable `todo-sync` workflow from
`KevinDeBenedetti/github-workflows`. Your goal is to produce the two required files
(`TODO.yml` and `.github/workflows/todo-sync.yml`) so that issues are managed
entirely through `TODO.yml`.

---

## Rules

- `TODO.yml` is the **single source of truth** — never create or edit issues directly on GitHub.
- Set `github_id: ~` for every new entry. The sync writes the real ID back automatically. **Never edit it manually.**
- `title` must start with a verb (e.g. "Add …", "Fix …", "Refactor …").
- `status: done` is the **only** way to close and remove an entry.
- `assignees` must be a YAML list; use `[]` when unassigned.
- Use only the exact `type`, `status`, and `priority` values listed in the reference below.
- If a section has nothing to say, omit it entirely.

---

## Steps to follow

### 1 — Inventory the repository

Read and reason over each of the following before writing anything:

- `TODO.yml` (if present) — existing issues, current `github_id` values, used field values
- `.github/workflows/` — whether `todo-sync.yml` or `label-sync.yml` already exist
- `labels.yml` (if present) — whether label sync is already configured
- `README.md` — project owner (for `assignees` default)

### 2 — Confirm prerequisites

Before generating files, verify:

- A fine-grained PAT secret named `PAT_TOKEN` exists in the repository or organisation
  with `contents`, `issues`, and `pull-requests` set to **Read & Write**.
- If `PAT_TOKEN` is missing, stop and instruct the user to create it before continuing.

### 3 — Write the files

#### `TODO.yml` (repo root)

Create or extend the file. Preserve all existing entries; never overwrite a set `github_id`.

```yaml
issues:
  - github_id: ~
    type: feat
    title: "Verb + context"
    status: backlog
    priority: medium
    assignees:
      - <owner>
    body: |
      ## Goal
      …

      ## Acceptance criteria
      - [ ] …
```

**`type` values** — `feat` · `fix` · `refactor` · `chore` · `doc` · `security`  
**`status` values** — `backlog` · `in-progress` · `to-review` · `done`  
**`priority` values** — `high` · `medium` · `low`

#### `.github/workflows/todo-sync.yml`

```yaml
on:
  push:
    branches: [main]
    paths: ['TODO.yml']
  issues:
    types: [labeled, unlabeled, closed, reopened, edited, assigned, unassigned]
  workflow_dispatch:

jobs:
  sync:
    uses: KevinDeBenedetti/github-workflows/.github/workflows/todo-sync.yml@main
    with:
      issue-number: ${{ github.event.issue.number || 0 }}
    secrets: inherit
```

#### `.github/workflows/label-sync.yml` (optional — only if `labels.yml` exists)

```yaml
on:
  push:
    branches: [main]
    paths: ['labels.yml']
  workflow_dispatch:

jobs:
  sync-labels:
    permissions:
      issues: write
    uses: KevinDeBenedetti/github-workflows/.github/workflows/label-sync.yml@main
    secrets:
      token: ${{ secrets.PAT_TOKEN }}
```

### 4 — Self-verify

Before saving, confirm:

- `github_id: ~` on all new entries; no existing `github_id` values were altered.
- Every `type`, `status`, and `priority` value matches the allowed set exactly.
- `PAT_TOKEN` requirement is documented (or the user has been warned it is missing).
- `todo-sync.yml` covers both `push` (push mode) and `issues` (pull mode) triggers.
- `label-sync.yml` is only created when `labels.yml` is present in the repo.
- No task-specific instructions were added (files describe config, not features).
- Conventional Commits type for the resulting commit: `chore: add todo-sync config`.
