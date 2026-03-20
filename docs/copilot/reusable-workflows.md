# Reusable Workflows

The Copilot PR workflows can be called from **any repository** using GitHub's [`workflow_call`](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) trigger. This lets you centralize the workflow logic in this `tools` repo and consume it across your organization without copying files.

## Available Reusable Workflows

| File | Trigger | What it does |
|------|---------|--------------|
| `copilot-pr-summary.reusable.yml` | `workflow_call` | Posts a Copilot-generated PR summary comment |
| `copilot-pr-autofill.reusable.yml` | `workflow_call` | Pre-fills the PR description from your template |

## Inputs & Secrets

Both reusable workflows accept the same interface:

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `inputs.model` | `string` | No | `gpt-5-mini` | Copilot model to use |
| `secrets.COPILOT_TOKEN` | secret | **Yes** | — | OAuth token (`gho_`) with active Copilot subscription |

## Calling from Another Repository

In the **caller** repo, create a workflow file that references the reusable workflow:

### PR Summary

```yaml
# .github/workflows/copilot-pr-summary.yml  (in your other repo)
name: Copilot PR Summary

on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main]

jobs:
  summary:
    uses: YOUR_ORG/tools/.github/workflows/copilot-pr-summary.reusable.yml@main
    secrets:
      COPILOT_TOKEN: ${{ secrets.COPILOT_TOKEN }}
    # with:
    #   model: gpt-5-mini   # optional override
```

### PR Template Auto-fill

```yaml
# .github/workflows/copilot-pr-autofill.yml  (in your other repo)
name: Copilot PR Template Auto-fill

on:
  pull_request:
    types: [opened]
    branches: [main]

jobs:
  autofill:
    uses: YOUR_ORG/tools/.github/workflows/copilot-pr-autofill.reusable.yml@main
    secrets:
      COPILOT_TOKEN: ${{ secrets.COPILOT_TOKEN }}
```

> Replace `YOUR_ORG/tools` with your actual repository path (e.g. `kevindebenedetti/tools`).

## Prerequisites

### 1. `COPILOT_TOKEN` secret in every caller repo

The token must be an OAuth user access token (`gho_` prefix) from an account with an active Copilot Individual or Business subscription.

```bash
# Generate a valid token
gh auth login
gh auth token   # copy the gho_... value
```

Then add it to the **caller repo**:

> Repo → **Settings → Secrets and variables → Actions → New repository secret**
> - Name: `COPILOT_TOKEN`
> - Value: the `gho_` token

### 2. `tools` repo must be public (or same organization)

GitHub allows calling reusable workflows from:

- **Public** repositories (any caller)
- **Private** repositories within the **same organization** (with Actions settings that permit it)

If `tools` is private and the caller is in a different organization, the call will fail with a permission error.

### 3. Add your PR template to each caller repo

Place a `PULL_REQUEST_TEMPLATE.md` in the caller repo at one of these paths for the auto-fill to use it:

```
.github/PULL_REQUEST_TEMPLATE.md   ← recommended
PULL_REQUEST_TEMPLATE.md
docs/PULL_REQUEST_TEMPLATE.md
```

The workflow looks for the template in the **caller's** repository, not in `tools`.

## Centralized Workflows Repository Pattern

If you want to fully centralize workflows for your organization, the standard GitHub pattern is a dedicated repository — conventionally named `.github` or `github-workflows`:

```
your-org/
├── tools/              ← this repo (action source)
├── github-workflows/   ← centralized reusable workflows
│   └── .github/
│       └── workflows/
│           ├── copilot-pr-summary.reusable.yml
│           └── copilot-pr-autofill.reusable.yml
├── service-a/          ← calls from github-workflows
└── service-b/          ← calls from github-workflows
```

To migrate:

1. Copy the `.reusable.yml` files from `tools/.github/workflows/` into `github-workflows/.github/workflows/`
2. Update the `uses:` reference in the reusable workflows from `YOUR_ORG/tools/.github/actions/copilot@main` to the correct path
3. Update all caller workflows to point to `your-org/github-workflows/.github/workflows/...`

> The `tools` repo still needs to be accessible for its composite action (`.github/actions/copilot`) which is referenced by the reusable workflows.

## Pinning to a Specific Version

For production use, pin to a commit SHA instead of a branch name for maximum stability:

```yaml
# Pinned to a specific commit (most secure)
uses: YOUR_ORG/tools/.github/workflows/copilot-pr-summary.reusable.yml@abc1234

# Pinned to a release tag
uses: YOUR_ORG/tools/.github/workflows/copilot-pr-summary.reusable.yml@v1.2.0

# Latest from branch (convenient for dev, less stable)
uses: YOUR_ORG/tools/.github/workflows/copilot-pr-summary.reusable.yml@main
```

## Limitations

| Limitation | Detail |
|------------|--------|
| **Local action path** | The reusable workflow references `YOUR_ORG/tools/.github/actions/copilot@main`. The composite action runs `bun install` from that repo, so the `tools` repo must be reachable. |
| **No `push` context in called workflow** | The called workflow inherits the caller's `github.event` — no extra configuration needed. |
| **Secrets are not inherited automatically** | Each secret must be explicitly passed via `secrets:` in the caller job. Use `secrets: inherit` to forward all secrets: |

```yaml
jobs:
  summary:
    uses: YOUR_ORG/tools/.github/workflows/copilot-pr-summary.reusable.yml@main
    secrets: inherit   # passes all caller secrets, including COPILOT_TOKEN
```

## See Also

- [PR Template Auto-fill](./pr-template-autofill.md)
- [PR Summary Workflow](./pr-summary-workflow.md)
- [GitHub Docs — Reusing workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
- [GitHub Docs — `workflow_call` syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_call)
