#!/usr/bin/env bash
# purge-release.sh — Delete all (or filtered) releases from a GitHub repo
# Usage: ./purge-release.sh --repo <owner/repo> [--dry-run] [--keep-latest <n>] [--tag-pattern <glob>]

set -euo pipefail

# ── Helpers ──────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --repo <owner/repo>    Target GitHub repository (required)
  --dry-run              List what would be deleted without deleting
  --keep-latest <n>      Keep the n most recent releases (default: 0)
  --tag-pattern <glob>   Only delete releases whose tag matches the glob
                         (e.g. "v0.*" or "*-beta*")
  -h, --help             Show this help

Requirements: gh (GitHub CLI), jq

Examples:
  # Delete every release in a repo
  ./purge-release.sh --repo owner/repo

  # Dry-run: see what would be deleted
  ./purge-release.sh --repo owner/repo --dry-run

  # Keep the 3 most recent releases
  ./purge-release.sh --repo owner/repo --keep-latest 3

  # Only delete pre-release tags matching "v0.*"
  ./purge-release.sh --repo owner/repo --tag-pattern "v0.*"
EOF
  exit 0
}

die() { echo "ERROR: $*" >&2; exit 1; }

# ── Argument parsing ──────────────────────────────────────────────────────────

REPO=""
DRY_RUN=false
KEEP_LATEST=0
TAG_PATTERN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)             REPO="${2:?'--repo requires owner/repo'}"; shift ;;
    --dry-run)          DRY_RUN=true ;;
    --keep-latest)      KEEP_LATEST="${2:?'--keep-latest requires a number'}"; shift ;;
    --tag-pattern)      TAG_PATTERN="${2:?'--tag-pattern requires a glob'}"; shift ;;
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

# ── Fetch releases (newest first) ────────────────────────────────────────────

echo "Fetching releases for ${REPO} …"

TAGS=$(gh release list \
  --repo "$REPO" \
  --limit 1000 \
  --order desc \
  --json tagName \
  --jq '.[].tagName')

if [[ -z "$TAGS" ]]; then
  echo "No releases found in ${REPO}."
  exit 0
fi

IFS=$'\n' read -r -d '' -a ALL_TAGS <<< "$TAGS" || true
TOTAL=${#ALL_TAGS[@]}
echo "Found ${TOTAL} release(s)."

# ── Apply --keep-latest ───────────────────────────────────────────────────────

if (( KEEP_LATEST > 0 )); then
  TARGETS=("${ALL_TAGS[@]:$KEEP_LATEST}")
  echo "Keeping ${KEEP_LATEST} latest — ${#TARGETS[@]} release(s) targeted for deletion."
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
  echo "Tag pattern '${TAG_PATTERN}' matched ${#TARGETS[@]} release(s)."
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
    echo "Deleting release and tag: ${tag}"
    gh release delete "$tag" \
      --repo "$REPO" \
      --cleanup-tag \
      --yes
  fi
done

echo ""
if $DRY_RUN; then
  echo "Dry-run complete — ${#TARGETS[@]} release(s) would have been deleted."
else
  echo "Done — ${#TARGETS[@]} release(s) deleted."
fi
