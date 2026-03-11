#!/usr/bin/env bash
# maintain-all.sh — Full maintenance pipeline for all GitHub repos
# Usage: ./maintain-all.sh [--dry-run] [--config <path>]

set -euo pipefail

# ── Helpers ──────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --dry-run              Show what would be done without modifying repos
  --config <path>        Config file path (default: ~/.config/git-maintain/config.yml)
  -h, --help             Show this help

Requirements: git, gh, jq, git-filter-repo, yq

Config file format (YAML):
  bots:
    - dependabot[bot]
    - renovate[bot]
  remove_files:
    - .DS_Store
    - .env
  max_blob_size: 50M

Examples:
  # Dry-run all repos
  ./maintain-all.sh --dry-run

  # Run with custom config
  ./maintain-all.sh --config ./my-config.yml
EOF
  exit 0
}

die() { echo "ERROR: $*" >&2; exit 1; }

# ── Argument parsing ──────────────────────────────────────────────────────────

DRY_RUN="${DRY_RUN:-false}"
CONFIG="${CONFIG:-${HOME}/.config/git-maintain/config.yml}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)    DRY_RUN=true ;;
    --config)     CONFIG="${2:?'--config requires a path'}"; shift ;;
    -h|--help)    usage ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

# ── Settings ─────────────────────────────────────────────────────────────────

WORKDIR="${HOME}/.cache/github-maintain"
BACKUP_DIR="${WORKDIR}/backup"
LOGFILE="${WORKDIR}/run.log"

mkdir -p "$WORKDIR" "$BACKUP_DIR"

# ── Pre-flight checks ─────────────────────────────────────────────────────────

for cmd in git gh jq git-filter-repo yq; do
  command -v "$cmd" &>/dev/null || die "'${cmd}' is not installed"
done
gh auth status &>/dev/null 2>&1 || die "Not authenticated — run: gh auth login"
[[ -f "$CONFIG" ]] || die "Config not found: ${CONFIG}"

# ── Load config ───────────────────────────────────────────────────────────────

mapfile -t BOTS < <(yq -r '.bots[]' "$CONFIG")
mapfile -t FILES < <(yq -r '.remove_files[]' "$CONFIG")
MAX_BLOB=$(yq -r '.max_blob_size' "$CONFIG")

# ── Detect user ───────────────────────────────────────────────────────────────

USER=$(gh api user --jq '.login')

echo "User: $USER"
echo "Dry run: $DRY_RUN"
echo "Config: $CONFIG"
echo ""

# ── List repos ────────────────────────────────────────────────────────────────

get_repos() {
  gh repo list "$USER" --limit 1000 \
    --json nameWithOwner \
    -q '.[].nameWithOwner'
}

# ── Backup ────────────────────────────────────────────────────────────────────

backup_repo() {
  local repo="$1"
  local name
  name=$(basename "$repo")

  echo "Backing up ${repo}…"
  if [[ -d "${BACKUP_DIR}/${name}.git" ]]; then
    git -C "${BACKUP_DIR}/${name}.git" remote update --prune 2>/dev/null || true
  else
    git clone --mirror "https://github.com/${repo}.git" "${BACKUP_DIR}/${name}.git" 2>/dev/null
  fi
}

# ── Rewrite bot commits ──────────────────────────────────────────────────────

rewrite_bots() {
  local real_name real_email bot_list

  real_name=$(git config user.name)
  real_email=$(git config user.email)

  bot_list=""
  for bot in "${BOTS[@]}"; do
    [[ -n "$bot_list" ]] && bot_list+=","
    bot_list+="b'${bot}'"
  done

  git filter-repo --force --commit-callback "
bots = [${bot_list}]
real_name = b'${real_name}'
real_email = b'${real_email}'

if commit.author_name in bots:
    commit.author_name = real_name
    commit.author_email = real_email
if commit.committer_name in bots:
    commit.committer_name = real_name
    commit.committer_email = real_email
"
}

# ── Remove files ──────────────────────────────────────────────────────────────

remove_files() {
  for file in "${FILES[@]}"; do
    git filter-repo --force --path "$file" --invert-paths || true
  done
}

# ── Remove large blobs ───────────────────────────────────────────────────────

remove_big_files() {
  git filter-repo --force --strip-blobs-bigger-than "$MAX_BLOB"
}

# ── Scan secrets ──────────────────────────────────────────────────────────────

scan_secrets() {
  echo "Scanning for secrets…"
  git grep -I -n -E 'AWS_SECRET|API_KEY|TOKEN|PASSWORD' || true
}

# ── Clean a single repo ──────────────────────────────────────────────────────

clean_repo() {
  local repo="$1"
  local name
  name=$(basename "$repo")

  echo "Cleaning ${repo}…"

  rm -rf "${WORKDIR:?}/${name}"
  git clone "https://github.com/${repo}.git" "${WORKDIR}/${name}" 2>/dev/null
  cd "${WORKDIR}/${name}"

  scan_secrets
  rewrite_bots
  remove_files
  remove_big_files

  git reflog expire --expire=now --all
  git gc --prune=now --aggressive

  if [[ "$DRY_RUN" == false ]]; then
    git push --force --all
    git push --force --tags
  else
    echo "[dry-run] Would push --force --all and --tags for ${repo}"
  fi

  cd "$WORKDIR"
}

# ── Run ───────────────────────────────────────────────────────────────────────

run() {
  local repos
  repos=$(get_repos)

  if [[ -z "$repos" ]]; then
    echo "No repos found."
    exit 0
  fi

  local count
  count=$(echo "$repos" | wc -l | tr -d ' ')
  echo "Found ${count} repo(s)."

  while IFS= read -r repo; do
    backup_repo "$repo"
    clean_repo "$repo"
  done <<< "$repos"
}

# ── Summary ───────────────────────────────────────────────────────────────────

summary() {
  echo ""
  echo "Run finished."
  echo "Backups in: ${BACKUP_DIR}"
  echo "Log: ${LOGFILE}"
}

# ── Main ──────────────────────────────────────────────────────────────────────

run 2>&1 | tee -a "$LOGFILE"
summary