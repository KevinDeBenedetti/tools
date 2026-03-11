#!/usr/bin/env bash
# backup-repos.sh — Clone bare mirrors of all your GitHub repos
# Usage: ./backup-repos.sh [--dry-run] [--user <login>] [--output <dir>] [--type <type>]

set -euo pipefail

# ── Helpers ──────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --dry-run              List repos without cloning
  --user <login>         GitHub user/org to back up (default: authenticated user)
  --output <dir>         Backup directory (default: ~/github-backups)
  --type <type>          Repo type filter: all, owner, member (default: owner)
  -h, --help             Show this help

Requirements: gh (GitHub CLI), git

Examples:
  # Back up all your repos
  ./backup-repos.sh

  # Dry-run: list repos that would be backed up
  ./backup-repos.sh --dry-run

  # Back up to a specific directory
  ./backup-repos.sh --output /mnt/backups/github

  # Back up repos of a specific user
  ./backup-repos.sh --user octocat
EOF
  exit 0
}

die() { echo "ERROR: $*" >&2; exit 1; }

# ── Argument parsing ──────────────────────────────────────────────────────────

DRY_RUN=false
USER=""
OUTPUT_DIR="${HOME}/github-backups"
REPO_TYPE="owner"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)    DRY_RUN=true ;;
    --user)       USER="${2:?'--user requires a login'}"; shift ;;
    --output)     OUTPUT_DIR="${2:?'--output requires a directory'}"; shift ;;
    --type)       REPO_TYPE="${2:?'--type requires a value'}"; shift ;;
    -h|--help)    usage ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

# ── Pre-flight checks ─────────────────────────────────────────────────────────

command -v gh  &>/dev/null || die "'gh' (GitHub CLI) is not installed"
command -v git &>/dev/null || die "'git' is not installed"
gh auth status &>/dev/null 2>&1 || die "Not authenticated — run: gh auth login"

# ── Resolve user ──────────────────────────────────────────────────────────────

if [[ -z "$USER" ]]; then
  USER=$(gh api user --jq '.login')
fi

echo "Backing up repos for: ${USER}"

# ── Fetch repos ───────────────────────────────────────────────────────────────

LIST_ARGS=(--limit 1000 --json "nameWithOwner,isPrivate" --jq '.[].nameWithOwner' --no-archived)
[[ "$REPO_TYPE" == "owner" ]] && LIST_ARGS+=(--source)

REPOS=$(gh repo list "$USER" "${LIST_ARGS[@]}")

if [[ -z "$REPOS" ]]; then
  echo "No repos found for ${USER}."
  exit 0
fi

IFS=$'\n' read -r -d '' -a REPO_LIST <<< "$REPOS" || true
TOTAL=${#REPO_LIST[@]}
echo "Found ${TOTAL} repo(s)."

# ── Backup ────────────────────────────────────────────────────────────────────

if ! $DRY_RUN; then
  mkdir -p "$OUTPUT_DIR"
fi

BACKED=0
SKIPPED=0

for repo in "${REPO_LIST[@]}"; do
  name=$(basename "$repo")
  dest="${OUTPUT_DIR}/${name}.git"

  if $DRY_RUN; then
    echo "[dry-run] Would back up: ${repo} → ${dest}"
    (( BACKED++ ))
    continue
  fi

  if [[ -d "$dest" ]]; then
    echo "Updating mirror: ${repo}"
    git -C "$dest" remote update --prune 2>/dev/null || {
      echo "  WARN: failed to update ${repo}, skipping"
      (( SKIPPED++ ))
      continue
    }
  else
    echo "Cloning mirror: ${repo}"
    git clone --mirror "https://github.com/${repo}.git" "$dest" 2>/dev/null || {
      echo "  WARN: failed to clone ${repo}, skipping"
      (( SKIPPED++ ))
      continue
    }
  fi
  (( BACKED++ ))
done

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
if $DRY_RUN; then
  echo "Dry-run complete — ${BACKED} repo(s) would be backed up."
else
  echo "Done — ${BACKED} repo(s) backed up, ${SKIPPED} skipped."
  echo "Backups in: ${OUTPUT_DIR}"
fi
