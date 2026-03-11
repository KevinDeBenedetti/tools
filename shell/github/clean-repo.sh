#!/usr/bin/env bash
# clean-repo.sh — Remove unwanted files from a Git repo and rewrite history
# Usage: ./clean-repo.sh [--dry-run] [--paths <file>...] [--aggressive]

set -euo pipefail

# ── Default paths to remove ──────────────────────────────────────────────────

DEFAULT_PATHS=(.DS_Store .env .env.local .env.production Thumbs.db)

# ── Helpers ──────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --dry-run              Show what would be removed without modifying
  --paths <file>...      Additional file paths to remove (space-separated, end with --)
  --aggressive           Run aggressive gc (slower, smaller repo)
  -h, --help             Show this help

Requirements: git, git-filter-repo

Examples:
  # Clean default files (.DS_Store, .env, etc.)
  ./clean-repo.sh

  # Dry-run first
  ./clean-repo.sh --dry-run

  # Remove specific files
  ./clean-repo.sh --paths secret.txt debug.log --

  # Aggressive cleanup
  ./clean-repo.sh --aggressive
EOF
  exit 0
}

die() { echo "ERROR: $*" >&2; exit 1; }

# ── Argument parsing ──────────────────────────────────────────────────────────

DRY_RUN=false
AGGRESSIVE=false
EXTRA_PATHS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)      DRY_RUN=true ;;
    --aggressive)   AGGRESSIVE=true ;;
    --paths)
      shift
      while [[ $# -gt 0 && "$1" != "--" ]]; do
        EXTRA_PATHS+=("$1")
        shift
      done
      [[ "${1:-}" == "--" ]] || true
      ;;
    -h|--help) usage ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

# ── Pre-flight checks ─────────────────────────────────────────────────────────

command -v git &>/dev/null || die "'git' is not installed"
git rev-parse --is-inside-work-tree &>/dev/null 2>&1 || die "Not inside a git repository"

ALL_PATHS=("${DEFAULT_PATHS[@]}")
[[ ${#EXTRA_PATHS[@]} -gt 0 ]] && ALL_PATHS+=("${EXTRA_PATHS[@]}")
REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")

echo "Cleaning repo: ${REPO_NAME}"
echo "Paths to remove: ${ALL_PATHS[*]}"

# ── Dry-run ───────────────────────────────────────────────────────────────────

if $DRY_RUN; then
  echo ""
  echo "[dry-run] Would remove from history:"
  for path in "${ALL_PATHS[@]}"; do
    COUNT=$(git log --all --diff-filter=A -- "$path" 2>/dev/null | grep -c "^commit" || true)
    echo "  ${path} (found in ${COUNT} commit(s))"
  done
  echo "[dry-run] Would expire reflog and run gc"
  exit 0
fi

# ── Remove files from history ─────────────────────────────────────────────────

command -v git-filter-repo &>/dev/null || die "'git-filter-repo' is not installed"

FILTER_ARGS=(--force)
for path in "${ALL_PATHS[@]}"; do
  FILTER_ARGS+=(--path "$path")
done
FILTER_ARGS+=(--invert-paths)

echo ""
echo "Rewriting history…"
git filter-repo "${FILTER_ARGS[@]}" || true

# ── Cleanup ───────────────────────────────────────────────────────────────────

echo "Expiring reflog…"
git reflog expire --expire=now --all

if $AGGRESSIVE; then
  echo "Running aggressive gc…"
  git gc --prune=now --aggressive
else
  echo "Running gc…"
  git gc --prune=now
fi

echo ""
echo "Repo cleaned."