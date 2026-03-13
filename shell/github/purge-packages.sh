#!/usr/bin/env bash
# purge-packages.sh — Delete package versions from a GitHub user or organisation.
#
# Without --package-name the script discovers every package of the given type
# and processes them all — making it a one-shot "clean my registry" command.
# Without --package-type it iterates over ALL supported types.

set -euo pipefail

ALL_PACKAGE_TYPES="npm maven rubygems docker nuget container"

# ── Helpers ──────────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --owner <user-or-org>      GitHub user or organisation (required)
  --package-type <type>      One of: npm, maven, rubygems, docker, nuget, container
                             Omit to iterate over ALL types
  --package-name <name>      Name of a specific package
                             Omit to iterate over ALL packages of the given type
  --org                      Treat owner as an organisation (default: user)
  --dry-run                  List what would be deleted without deleting
  --keep-latest <n>          Keep the n most recent versions per package (default: 0)
  --version-pattern <glob>   Only delete versions whose name matches the glob
                             (e.g. "0.1.*" or "*-rc*")
  -h, --help                 Show this help

Requirements: gh (GitHub CLI), jq

Examples:
  # Purge every version of every container image (dry-run)
  $(basename "$0") --owner KevinDeBenedetti --package-type container --dry-run

  # Purge ALL packages across ALL types
  $(basename "$0") --owner KevinDeBenedetti --dry-run

  # Purge one specific package, keep 3 latest versions
  $(basename "$0") --owner KevinDeBenedetti --package-type container --package-name myapp --keep-latest 3

  # Purge all rc versions across all container images
  $(basename "$0") --owner KevinDeBenedetti --package-type container --version-pattern "*-rc*" --dry-run
EOF
  exit 0
}

die() { echo "ERROR: $*" >&2; exit 1; }

# ── Argument parsing ──────────────────────────────────────────────────────────

OWNER=""
PACKAGE_TYPE=""
PACKAGE_NAME=""
IS_ORG=false
DRY_RUN=false
KEEP_LATEST=0
VERSION_PATTERN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --owner)            OWNER="${2:?'--owner requires a value'}"; shift ;;
    --package-type)     PACKAGE_TYPE="${2:?'--package-type requires a value'}"; shift ;;
    --package-name)     PACKAGE_NAME="${2:?'--package-name requires a value'}"; shift ;;
    --org)              IS_ORG=true ;;
    --dry-run)          DRY_RUN=true ;;
    --keep-latest)      KEEP_LATEST="${2:?'--keep-latest requires a number'}"; shift ;;
    --version-pattern)  VERSION_PATTERN="${2:?'--version-pattern requires a glob'}"; shift ;;
    -h|--help)          usage ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

[[ -n "$OWNER" ]] || die "--owner <user-or-org> is required"

if [[ -n "$PACKAGE_TYPE" ]]; then
  case "$PACKAGE_TYPE" in
    npm|maven|rubygems|docker|nuget|container) ;;
    *) die "Invalid --package-type '${PACKAGE_TYPE}'. Must be one of: ${ALL_PACKAGE_TYPES}" ;;
  esac
fi

# ── Pre-flight checks ─────────────────────────────────────────────────────────

command -v gh  &>/dev/null || die "'gh' (GitHub CLI) is not installed"
command -v jq  &>/dev/null || die "'jq' is not installed"
gh auth status &>/dev/null 2>&1 || die "Not authenticated — run: gh auth login"

# Check required token scopes
CURRENT_SCOPES=$(gh auth status 2>&1 | grep -i "Token scopes" | head -1 || true)

if ! echo "$CURRENT_SCOPES" | grep -q "read:packages"; then
  cat >&2 <<EOF
ERROR: Your gh token is missing the 'read:packages' scope.

Re-authenticate with the required scopes:
  gh auth login --scopes read:packages,delete:packages

Or refresh your existing token:
  gh auth refresh --scopes read:packages,delete:packages

Current scopes: ${CURRENT_SCOPES:-unknown}
EOF
  exit 1
fi

if ! $DRY_RUN && ! echo "$CURRENT_SCOPES" | grep -q "delete:packages"; then
  cat >&2 <<EOF
ERROR: Your gh token is missing 'delete:packages' scope (required for actual deletion).

Re-authenticate:
  gh auth login --scopes read:packages,delete:packages

Or refresh:
  gh auth refresh --scopes read:packages,delete:packages

Use --dry-run to list packages without deleting (requires only read:packages).
Current scopes: ${CURRENT_SCOPES:-unknown}
EOF
  exit 1
fi

# ── API base paths (set after arg parsing) ───────────────────────────────────
# Non-org: /user/packages (authenticated-user endpoint — works with read:packages)
# Org:     /orgs/{owner}/packages

set_base_paths() {
  if $IS_ORG; then
    BASE_PKG="orgs/${OWNER}/packages"
  else
    BASE_PKG="user/packages"
  fi
}

# ── Core: purge versions of one package ──────────────────────────────────────

purge_one_package() {
  local pkg_type="$1"
  local pkg_name="$2"
  local versions_path="${BASE_PKG}/${pkg_type}/${pkg_name}/versions"

  echo "  Fetching versions of '${pkg_name}' (${pkg_type}) …"

  local versions_json
  versions_json=$(gh api "${versions_path}" \
    --paginate \
    --jq '[.[] | {id: .id, name: .name}]' \
    2>/dev/null | jq -s 'add // []')

  local version_count
  version_count=$(echo "$versions_json" | jq 'length')

  if [[ "$version_count" -eq 0 ]]; then
    echo "  No versions found — skipping."
    return 0
  fi

  echo "  Found ${version_count} version(s)."

  # Build parallel arrays (newest first as returned by the API)
  local version_ids=()
  while IFS= read -r line; do version_ids+=("$line"); done \
    < <(echo "$versions_json" | jq -r '.[].id')

  local version_names=()
  while IFS= read -r line; do version_names+=("$line"); done \
    < <(echo "$versions_json" | jq -r '.[].name')

  local total=${#version_ids[@]}

  # Apply --keep-latest
  local start_index=0
  if (( KEEP_LATEST > 0 )); then
    start_index=$KEEP_LATEST
    echo "  Keeping ${KEEP_LATEST} latest — $((total - start_index)) version(s) targeted."
  fi

  local target_ids=()
  local target_names=()
  for (( i=start_index; i<total; i++ )); do
    target_ids+=("${version_ids[$i]}")
    target_names+=("${version_names[$i]}")
  done

  # Apply --version-pattern
  if [[ -n "$VERSION_PATTERN" ]]; then
    local filtered_ids=()
    local filtered_names=()
    for (( i=0; i<${#target_ids[@]}; i++ )); do
      # shellcheck disable=SC2053
      if [[ "${target_names[$i]}" == $VERSION_PATTERN ]]; then
        filtered_ids+=("${target_ids[$i]}")
        filtered_names+=("${target_names[$i]}")
      fi
    done
    target_ids=("${filtered_ids[@]+"${filtered_ids[@]}"}")
    target_names=("${filtered_names[@]+"${filtered_names[@]}"}")
    echo "  Pattern '${VERSION_PATTERN}' matched ${#target_ids[@]} version(s)."
  fi

  if [[ ${#target_ids[@]} -eq 0 ]]; then
    echo "  Nothing to delete."
    return 0
  fi

  local pkg_deleted=false
  for (( i=0; i<${#target_ids[@]}; i++ )); do
    local id="${target_ids[$i]}"
    local name="${target_names[$i]}"
    if $DRY_RUN; then
      echo "  [dry-run] Would delete: ${name} (id=${id})"
    else
      echo "  Deleting: ${name} (id=${id})"
      local del_err
      if ! del_err=$(gh api -X DELETE "${versions_path%/versions}/versions/${id}" 2>&1); then
        if echo "$del_err" | grep -q "last tagged version"; then
          echo "  Last tagged version — deleting entire package '${pkg_name}' …"
          if ! gh api -X DELETE "${versions_path%/versions}" 2>/dev/null; then
            echo "  WARNING: Could not delete package '${pkg_name}'." >&2
          fi
          pkg_deleted=true
          break
        else
          echo "  WARNING: Failed to delete version ${id} (${name}): ${del_err}" >&2
        fi
      fi
    fi
  done

  if $DRY_RUN; then
    echo "  → ${#target_ids[@]} version(s) would be deleted."
  elif $pkg_deleted; then
    echo "  → Package '${pkg_name}' deleted entirely."
  else
    echo "  → ${#target_ids[@]} version(s) deleted."
  fi
}

# ── Discover packages of one type ────────────────────────────────────────────

process_package_type() {
  local pkg_type="$1"

  if [[ -n "$PACKAGE_NAME" ]]; then
    # Single named package
    echo ""
    echo "── ${pkg_type} / ${PACKAGE_NAME}"
    purge_one_package "$pkg_type" "$PACKAGE_NAME"
    return 0
  fi

  # Discover all packages of this type
  local list_path="${BASE_PKG}?package_type=${pkg_type}"

  local names
  # Guard against API error-objects ({"message":"..."}) by only extracting
  # names when the response is a JSON array.
  names=$(gh api "${list_path}" --paginate 2>/dev/null \
    | jq -r 'if type == "array" then .[].name else empty end' 2>/dev/null || true)

  if [[ -z "$names" ]]; then
    echo "  No '${pkg_type}' packages found."
    return 0
  fi

  while IFS= read -r pkg_name; do
    echo ""
    echo "── ${pkg_type} / ${pkg_name}"
    purge_one_package "$pkg_type" "$pkg_name"
  done <<< "$names"
}

# ── Main ──────────────────────────────────────────────────────────────────────

set_base_paths

if [[ -n "$PACKAGE_TYPE" ]]; then
  TYPES="$PACKAGE_TYPE"
else
  echo "No --package-type given — scanning all supported types for ${OWNER} …"
  TYPES="$ALL_PACKAGE_TYPES"
fi

for type in $TYPES; do
  echo ""
  echo "Package type: ${type}"
  process_package_type "$type"
done

echo ""
if $DRY_RUN; then
  echo "Dry-run complete."
else
  echo "Done."
fi
