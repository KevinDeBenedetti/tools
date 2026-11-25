# CLAUDE.md

## Agent skills

The engineering skills' per-repo config lives in `.agents/` (not `docs/agents/`, which would publish it to the docs hub). Read the files there wherever a skill refers to `docs/agents/`.

### Issue tracker

Issues are tracked in GitHub Issues for `KevinDeBenedetti/tools`, via the `gh` CLI. See `.agents/issue-tracker.md`.

### Triage labels

The five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `.agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `.agents/domain.md`.
