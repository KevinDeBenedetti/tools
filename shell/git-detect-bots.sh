#!/usr/bin/env bash
# git-detect-bots.sh — Detect bot commits in a Git repository
# Usage: ./git-detect-bots.sh [--repo <owner/repo>] [--local] [--dry-run] [--format <text|json>]

set -euo pipefail

# ── Known bot patterns ────────────────────────────────────────────────────────

DEFAULT_BOT_PATTERNS=(
  "dependabot"
  "renovate"
  "github-actions"
  "greenkeeper"
  "snyk-bot"
  "imgbot"
  "codecov"
  "netlify"
  "vercel"
  "semantic-release-bot"
  "release-please"
  "\\[bot\\]"
  "noreply@github.com"
)

# ── Helpers ──────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --repo <owner/repo>    Scan a remote GitHub repo (clones temporarily)
  --local                Scan the current local Git repo (default)
  --dry-run              Show what would be scanned without scanning
  --format <text|json>   Output format (default: text)
  -h, --help             Show this help

Requirements: git, (gh for remote repos)

Examples:
  # Scan current repo
  ./git-detect-bots.sh

  # Scan a remote repo
  ./git-detect-bots.sh --repo owner/repo

  # Output as JSON
  ./git-detect-bots.sh --format json
EOF
  exit 0
}

die() { echo "ERROR: $*" >&2; exit 1; }

# ── Argument parsing ──────────────────────────────────────────────────────────

REPO=""
LOCAL=true
DRY_RUN=false
FORMAT="text"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)       REPO="${2:?'--repo requires owner/repo'}"; LOCAL=false; shift ;;
    --local)      LOCAL=true ;;
    --dry-run)    DRY_RUN=true ;;
    --format)     FORMAT="${2:?'--format requires text or json'}"; shift ;;
    -h|--help)    usage ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

# ── Pre-flight checks ─────────────────────────────────────────────────────────

command -v git &>/dev/null || die "'git' is not installed"
if [[ "$LOCAL" == false ]]; then
  command -v gh &>/dev/null || die "'gh' (GitHub CLI) is required for remote repos"
fi

# ── Build regex pattern ───────────────────────────────────────────────────────

PATTERN=$(IFS='|'; echo "${DEFAULT_BOT_PATTERNS[*]}")

# ── Target repo ───────────────────────────────────────────────────────────────

CLEANUP_DIR=""

if [[ "$LOCAL" == true ]]; then
  git rev-parse --is-inside-work-tree &>/dev/null 2>&1 || die "Not inside a git repository"
  SCAN_DIR="."
  REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")
else
  REPO_NAME=$(basename "$REPO")
  SCAN_DIR=$(mktemp -d)
  CLEANUP_DIR="$SCAN_DIR"

  if $DRY_RUN; then
    echo "[dry-run] Would clone ${REPO} and scan for bot commits"
    echo "[dry-run] Bot patterns: ${PATTERN}"
    exit 0
  fi

  echo "Cloning ${REPO} …"
  git clone --quiet "https://github.com/${REPO}.git" "${SCAN_DIR}/${REPO_NAME}" 2>/dev/null
  SCAN_DIR="${SCAN_DIR}/${REPO_NAME}"
fi

# shellcheck disable=SC2064
[[ -n "$CLEANUP_DIR" ]] && trap "rm -rf '$CLEANUP_DIR'" EXIT

if $DRY_RUN; then
  echo "[dry-run] Would scan ${REPO_NAME} for bot commits"
  echo "[dry-run] Bot patterns: ${PATTERN}"
  exit 0
fi

# ── Scan for bot commits ─────────────────────────────────────────────────────

echo "Scanning ${REPO_NAME} for bot commits…"

BOT_LOG=$(git -C "$SCAN_DIR" log --all \
  --format='%H|%an|%ae|%s' \
  | grep -iE "$PATTERN" || true)

if [[ -z "$BOT_LOG" ]]; then
  echo "No bot commits found."
  exit 0
fi

BOT_COUNT=$(echo "$BOT_LOG" | wc -l | tr -d ' ')
TOTAL_COMMITS=$(git -C "$SCAN_DIR" rev-list --all --count)

# ── Output ────────────────────────────────────────────────────────────────────

if [[ "$FORMAT" == "json" ]]; then
  echo "$BOT_LOG" | awk -F'|' '{
    printf "{\"hash\":\"%s\",\"author\":\"%s\",\"email\":\"%s\",\"subject\":\"%s\"}\n", $1, $2, $3, $4
  }' | jq -s --arg total "$TOTAL_COMMITS" --arg bots "$BOT_COUNT" '{
    total_commits: ($total | tonumber),
    bot_commits: ($bots | tonumber),
    percentage: (($bots | tonumber) / ($total | tonumber) * 100 | round),
    commits: .
  }'
else
  echo ""
  echo "Found ${BOT_COUNT} bot commit(s) out of ${TOTAL_COMMITS} total."
  echo ""

  # Group by author
  echo "Bot authors:"
  echo "$BOT_LOG" | awk -F'|' '{print $2}' | sort | uniq -c | sort -rn | while read -r count name; do
    printf "  %-6s %s\n" "${count}" "${name}"
  done

  echo ""
  echo "Recent bot commits:"
  echo "$BOT_LOG" | head -10 | awk -F'|' '{
    printf "  %.8s  %-30s  %s\n", $1, $2, $4
  }'

  if (( BOT_COUNT > 10 )); then
    echo "  … and $((BOT_COUNT - 10)) more"
  fi
fi
