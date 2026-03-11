#!/usr/bin/env bash
# purge-actions.sh — Delete all (or filtered) workflow runs from a GitHub repo
# Usage: ./purge-actions.sh --repo <owner/repo> [--dry-run] [--keep-latest <n>] [--workflow <name>] [--status <status>]

set -euo pipefail

# ── Helpers ──────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --repo <owner/repo>    Target GitHub repository (required)
  --dry-run              List what would be deleted without deleting
  --keep-latest <n>      Keep the n most recent runs (default: 0)
  --workflow <name>      Only delete runs of a specific workflow (file name or name)
  --status <status>      Only delete runs with a specific status
                         (completed, action_required, cancelled, failure,
                          neutral, skipped, stale, success, timed_out,
                          in_progress, queued, requested, waiting,
                          pending, startup_failure)
  -h, --help             Show this help

Requirements: gh (GitHub CLI), jq

Examples:
  # Delete every workflow run in a repo
  ./purge-actions.sh --repo owner/repo

  # Dry-run: see what would be deleted
  ./purge-actions.sh --repo owner/repo --dry-run

  # Keep the 5 most recent runs
  ./purge-actions.sh --repo owner/repo --keep-latest 5

  # Only delete runs from a specific workflow
  ./purge-actions.sh --repo owner/repo --workflow "CI"

  # Only delete failed runs
  ./purge-actions.sh --repo owner/repo --status failure
EOF
  exit 0
}

die() { echo "ERROR: $*" >&2; exit 1; }

# ── Argument parsing ──────────────────────────────────────────────────────────

REPO=""
DRY_RUN=false
KEEP_LATEST=0
WORKFLOW=""
STATUS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)             REPO="${2:?'--repo requires owner/repo'}"; shift ;;
    --dry-run)          DRY_RUN=true ;;
    --keep-latest)      KEEP_LATEST="${2:?'--keep-latest requires a number'}"; shift ;;
    --workflow)         WORKFLOW="${2:?'--workflow requires a name'}"; shift ;;
    --status)           STATUS="${2:?'--status requires a value'}"; shift ;;
    -h|--help)          usage ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

[[ -n "$REPO" ]] || die "--repo <owner/repo> is required"

# ── Pre-flight checks ─────────────────────────────────────────────────────────

command -v gh  &>/dev/null || die "'gh' (GitHub CLI) is not installed"
command -v jq  &>/dev/null || die "'jq' is not installed"
gh auth status &>/dev/null 2>&1 || die "Not authenticated — run: gh auth login"

# ── Fetch workflow runs (newest first) ───────────────────────────────────────

echo "Fetching workflow runs for ${REPO} …"

LIST_ARGS=(--repo "$REPO" --limit 1000 --json "databaseId,displayTitle,workflowName,status,conclusion,createdAt")

[[ -n "$WORKFLOW" ]] && LIST_ARGS+=(--workflow "$WORKFLOW")
[[ -n "$STATUS" ]]   && LIST_ARGS+=(--status "$STATUS")

RUNS=$(gh run list "${LIST_ARGS[@]}")

TOTAL=$(echo "$RUNS" | jq 'length')

if [[ "$TOTAL" -eq 0 ]]; then
  echo "No workflow runs found in ${REPO}."
  exit 0
fi

echo "Found ${TOTAL} run(s)."

# ── Apply --keep-latest ───────────────────────────────────────────────────────

if (( KEEP_LATEST > 0 )); then
  RUNS=$(echo "$RUNS" | jq ".[$KEEP_LATEST:]")
  FILTERED=$(echo "$RUNS" | jq 'length')
  echo "Keeping ${KEEP_LATEST} latest — ${FILTERED} run(s) targeted for deletion."
fi

COUNT=$(echo "$RUNS" | jq 'length')

if [[ "$COUNT" -eq 0 ]]; then
  echo "Nothing to delete."
  exit 0
fi

# ── Delete ────────────────────────────────────────────────────────────────────

echo ""
DELETED=0

for row in $(echo "$RUNS" | jq -r '.[] | @base64'); do
  _jq() { echo "$row" | base64 --decode | jq -r "$1"; }

  RUN_ID=$(_jq '.databaseId')
  TITLE=$(_jq '.displayTitle')
  WF_NAME=$(_jq '.workflowName')
  CONCLUSION=$(_jq '.conclusion')

  if $DRY_RUN; then
    echo "[dry-run] Would delete: #${RUN_ID} — ${WF_NAME} / ${TITLE} (${CONCLUSION})"
  else
    echo "Deleting: #${RUN_ID} — ${WF_NAME} / ${TITLE} (${CONCLUSION})"
    gh run delete "$RUN_ID" --repo "$REPO"
  fi
  (( DELETED++ ))
done

echo ""
if $DRY_RUN; then
  echo "Dry-run complete — ${DELETED} run(s) would have been deleted."
else
  echo "Done — ${DELETED} run(s) deleted."
fi
