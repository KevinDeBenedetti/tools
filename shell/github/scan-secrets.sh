#!/usr/bin/env bash
# scan-secrets.sh — Scan a Git repo for accidentally committed secrets
# Usage: ./scan-secrets.sh [--repo <owner/repo>] [--local] [--dry-run] [--history]

set -euo pipefail

# ── Secret patterns ──────────────────────────────────────────────────────────

SECRET_PATTERNS=(
  'AKIA[0-9A-Z]{16}'                          # AWS Access Key
  'AWS_SECRET_ACCESS_KEY'                      # AWS Secret
  'sk-[a-zA-Z0-9]{20,}'                       # OpenAI / Stripe secret key
  'ghp_[a-zA-Z0-9]{36}'                       # GitHub personal access token
  'gho_[a-zA-Z0-9]{36}'                       # GitHub OAuth token
  'github_pat_[a-zA-Z0-9_]{82}'               # GitHub fine-grained PAT
  'glpat-[a-zA-Z0-9\-]{20,}'                  # GitLab PAT
  'xoxb-[0-9]{10,}-[0-9]{10,}-[a-zA-Z0-9]+'   # Slack bot token
  'xoxp-[0-9]{10,}-[0-9]{10,}-[a-zA-Z0-9]+'   # Slack user token
  'SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}'  # SendGrid API key
  'sk_live_[a-zA-Z0-9]{24,}'                  # Stripe live key
  'rk_live_[a-zA-Z0-9]{24,}'                  # Stripe restricted key
  'sq0atp-[a-zA-Z0-9_-]{22}'                  # Square access token
  'eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}' # JWT token
  'PASSWORD\s*=\s*["\x27][^"\x27]{8,}'        # PASSWORD= assignments
  'API_KEY\s*=\s*["\x27][^"\x27]{8,}'         # API_KEY= assignments
  'SECRET\s*=\s*["\x27][^"\x27]{8,}'          # SECRET= assignments
  'TOKEN\s*=\s*["\x27][^"\x27]{8,}'           # TOKEN= assignments
)

# ── Helpers ──────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --repo <owner/repo>    Scan a remote GitHub repo (clones temporarily)
  --local                Scan the current local Git repo (default)
  --dry-run              Show what would be scanned without scanning
  --history              Also scan full Git history (slower)
  -h, --help             Show this help

Requirements: git, grep

Examples:
  # Scan current repo working tree
  ./scan-secrets.sh

  # Scan including full history
  ./scan-secrets.sh --history

  # Scan a remote repo
  ./scan-secrets.sh --repo owner/repo

  # Dry-run to see patterns
  ./scan-secrets.sh --dry-run
EOF
  exit 0
}

die() { echo "ERROR: $*" >&2; exit 1; }

# ── Argument parsing ──────────────────────────────────────────────────────────

REPO=""
LOCAL=true
DRY_RUN=false
SCAN_HISTORY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)       REPO="${2:?'--repo requires owner/repo'}"; LOCAL=false; shift ;;
    --local)      LOCAL=true ;;
    --dry-run)    DRY_RUN=true ;;
    --history)    SCAN_HISTORY=true ;;
    -h|--help)    usage ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

# ── Pre-flight checks ─────────────────────────────────────────────────────────

command -v git  &>/dev/null || die "'git' is not installed"
command -v grep &>/dev/null || die "'grep' is not installed"

# ── Build combined pattern ────────────────────────────────────────────────────

COMBINED_PATTERN=$(IFS='|'; echo "${SECRET_PATTERNS[*]}")

# ── Target repo ───────────────────────────────────────────────────────────────

CLEANUP_DIR=""

if [[ "$LOCAL" == true ]]; then
  git rev-parse --is-inside-work-tree &>/dev/null 2>&1 || die "Not inside a git repository"
  SCAN_DIR="."
  REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")
else
  command -v gh &>/dev/null || die "'gh' (GitHub CLI) is required for remote repos"
  REPO_NAME=$(basename "$REPO")
  SCAN_DIR=$(mktemp -d)
  CLEANUP_DIR="$SCAN_DIR"

  if $DRY_RUN; then
    echo "[dry-run] Would clone ${REPO} and scan for secrets"
    echo "[dry-run] Patterns: ${#SECRET_PATTERNS[@]} rules"
    echo "[dry-run] History scan: ${SCAN_HISTORY}"
    exit 0
  fi

  echo "Cloning ${REPO} …"
  git clone --quiet "https://github.com/${REPO}.git" "${SCAN_DIR}/${REPO_NAME}" 2>/dev/null
  SCAN_DIR="${SCAN_DIR}/${REPO_NAME}"
fi

# shellcheck disable=SC2064
[[ -n "$CLEANUP_DIR" ]] && trap "rm -rf '$CLEANUP_DIR'" EXIT

if $DRY_RUN; then
  echo "[dry-run] Would scan ${REPO_NAME} for secrets"
  echo "[dry-run] Patterns: ${#SECRET_PATTERNS[@]} rules"
  echo "[dry-run] History scan: ${SCAN_HISTORY}"
  exit 0
fi

# ── Scan working tree ─────────────────────────────────────────────────────────

echo "Scanning ${REPO_NAME} for secrets…"
echo ""

FINDINGS=0

echo "── Working tree ──"
TREE_HITS=$(git -C "$SCAN_DIR" grep -rInE "$COMBINED_PATTERN" -- ':(exclude)*.lock' ':(exclude)node_modules' ':(exclude).git' 2>/dev/null || true)

if [[ -n "$TREE_HITS" ]]; then
  TREE_COUNT=$(echo "$TREE_HITS" | wc -l | tr -d ' ')
  FINDINGS=$((FINDINGS + TREE_COUNT))
  echo "Found ${TREE_COUNT} potential secret(s) in working tree:"
  echo ""
  echo "$TREE_HITS" | head -50 | while IFS= read -r line; do
    echo "  ${line}"
  done
  if (( TREE_COUNT > 50 )); then
    echo "  … and $((TREE_COUNT - 50)) more"
  fi
else
  echo "No secrets in working tree."
fi

# ── Scan history ──────────────────────────────────────────────────────────────

if $SCAN_HISTORY; then
  echo ""
  echo "── Git history ──"
  HISTORY_HITS=$(git -C "$SCAN_DIR" log --all -p --diff-filter=A \
    --format='COMMIT:%H %an %s' \
    | grep -nE "$COMBINED_PATTERN" \
    | grep -v '^COMMIT:' 2>/dev/null || true)

  if [[ -n "$HISTORY_HITS" ]]; then
    HIST_COUNT=$(echo "$HISTORY_HITS" | wc -l | tr -d ' ')
    FINDINGS=$((FINDINGS + HIST_COUNT))
    echo "Found ${HIST_COUNT} potential secret(s) in history:"
    echo ""
    echo "$HISTORY_HITS" | head -30 | while IFS= read -r line; do
      echo "  ${line}"
    done
    if (( HIST_COUNT > 30 )); then
      echo "  … and $((HIST_COUNT - 30)) more"
    fi
  else
    echo "No secrets in history."
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
if (( FINDINGS > 0 )); then
  echo "WARNING: ${FINDINGS} potential secret(s) found!"
  echo "Review each match — some may be false positives (tests, docs, examples)."
  exit 1
else
  echo "No secrets detected."
  exit 0
fi
