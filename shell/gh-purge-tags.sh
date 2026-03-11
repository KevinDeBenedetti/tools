#!/usr/bin/env bash
# purge-gh-tags.sh — Delete all (or filtered) tags from a GitHub repo
# Usage: ./purge-gh-tags.sh <owner/repo> [--dry-run] [--keep-latest <n>] [--tag-pattern <glob>]

set -euo pipefail

# ── Helpers ──────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") <owner/repo> [options]

Options:
  --dry-run              List what would be deleted without deleting
  --keep-latest <n>      Keep the n most recent tags (default: 0)
  --tag-pattern <glob>   Only delete tags whose name matches the glob
                         (e.g. "v0.*" or "*-beta*")
  -h, --help             Show this help

Requirements: gh (GitHub CLI), jq

Examples:
  # Delete every tag in a repo
  ./purge-gh-tags.sh owner/repo

  # Dry-run: see what would be deleted
  ./purge-gh-tags.sh owner/repo --dry-run

  # Keep the 3 most recent tags
  ./purge-gh-tags.sh owner/repo --keep-latest 3

  # Only delete tags matching "v0.*"
  ./purge-gh-tags.sh owner/repo --tag-pattern "v0.*"
EOF
  exit 0
}

die() { echo "ERROR: $*" >&2; exit 1; }

# ── Argument parsing ──────────────────────────────────────────────────────────

[[ $# -lt 1 ]] && usage
[[ "$1" == "-h" || "$1" == "--help" ]] && usage
REPO="$1"; shift

DRY_RUN=false
KEEP_LATEST=0
TAG_PATTERN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)          DRY_RUN=true ;;
    --keep-latest)      KEEP_LATEST="${2:?'--keep-latest requires a number'}"; shift ;;
    --tag-pattern)      TAG_PATTERN="${2:?'--tag-pattern requires a glob'}"; shift ;;
    -h|--help)          usage ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

# ── Pre-flight checks ─────────────────────────────────────────────────────────

command -v gh  &>/dev/null || die "'gh' (GitHub CLI) is not installed"
command -v jq  &>/dev/null || die "'jq' is not installed"
gh auth status &>/dev/null 2>&1 || die "Not authenticated — run: gh auth login"

# ── Fetch tags (newest first) ────────────────────────────────────────────────

echo "Fetching tags for ${REPO} …"

TAGS=$(gh api "repos/${REPO}/tags" \
  --paginate \
  --jq '.[].name')

if [[ -z "$TAGS" ]]; then
  echo "No tags found in ${REPO}."
  exit 0
fi

IFS=$'\n' read -r -d '' -a ALL_TAGS <<< "$TAGS" || true
TOTAL=${#ALL_TAGS[@]}
echo "Found ${TOTAL} tag(s)."

# ── Apply --keep-latest ───────────────────────────────────────────────────────

if (( KEEP_LATEST > 0 )); then
  TARGETS=("${ALL_TAGS[@]:$KEEP_LATEST}")
  echo "Keeping ${KEEP_LATEST} latest — ${#TARGETS[@]} tag(s) targeted for deletion."
else
  TARGETS=("${ALL_TAGS[@]}")
fi

# ── Apply --tag-pattern ───────────────────────────────────────────────────────

if [[ -n "$TAG_PATTERN" ]]; then
  FILTERED=()
  for tag in "${TARGETS[@]}"; do
    # shellcheck disable=SC2053
    [[ "$tag" == $TAG_PATTERN ]] && FILTERED+=("$tag")
  done
  TARGETS=("${FILTERED[@]}")
  echo "Tag pattern '${TAG_PATTERN}' matched ${#TARGETS[@]} tag(s)."
fi

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  echo "Nothing to delete."
  exit 0
fi

# ── Delete ────────────────────────────────────────────────────────────────────

echo ""
for tag in "${TARGETS[@]}"; do
  if $DRY_RUN; then
    echo "[dry-run] Would delete: ${tag}"
  else
    echo "Deleting tag: ${tag}"
    gh api -X DELETE "repos/${REPO}/git/refs/tags/${tag}" --silent
  fi
done

echo ""
if $DRY_RUN; then
  echo "Dry-run complete — ${#TARGETS[@]} tag(s) would have been deleted."
else
  echo "Done — ${#TARGETS[@]} tag(s) deleted."
fi
