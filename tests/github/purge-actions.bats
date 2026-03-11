#!/usr/bin/env bats

# Tests for purge-actions.sh
# Uses mocked gh/jq commands — never touches real repos

setup() {
  DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
  REPO_ROOT="$(cd "$DIR/../.." && pwd)"
  SCRIPT="${REPO_ROOT}/shell/github/purge-actions.sh"

  load '../test_helper/bats-support/load'
  load '../test_helper/bats-assert/load'

  # Create a temp bin dir for mocks
  MOCK_BIN="$(mktemp -d)"
  export PATH="${MOCK_BIN}:${PATH}"
}

teardown() {
  rm -rf "$MOCK_BIN"
}

# ── Usage & help ──────────────────────────────────────────────────────────────

@test "fails when --repo is missing" {
  run "$SCRIPT"
  assert_failure
  assert_output --partial "--repo"
}

@test "shows usage with --help" {
  run "$SCRIPT" --help
  assert_success
  assert_output --partial "Usage:"
  assert_output --partial "--dry-run"
  assert_output --partial "--keep-latest"
  assert_output --partial "--workflow"
  assert_output --partial "--status"
}

@test "shows usage with -h" {
  run "$SCRIPT" -h
  assert_success
  assert_output --partial "Usage:"
}

# ── Argument validation ──────────────────────────────────────────────────────

@test "fails on unknown option" {
  # Mock gh auth
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" ]]; then exit 0; fi
echo '[]'
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --repo owner/repo --bogus
  assert_failure
  assert_output --partial "Unknown option"
}

# ── Dry-run with mocked data ─────────────────────────────────────────────────

@test "dry-run lists runs without deleting" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "run" && "$2" == "list" ]]; then
  cat <<'JSON'
[
  {"databaseId":1001,"displayTitle":"Fix CI","workflowName":"CI","status":"completed","conclusion":"success","createdAt":"2025-01-01T00:00:00Z"},
  {"databaseId":1002,"displayTitle":"Deploy","workflowName":"CD","status":"completed","conclusion":"failure","createdAt":"2025-01-02T00:00:00Z"}
]
JSON
  exit 0
fi
echo "UNEXPECTED: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --repo owner/repo --dry-run
  assert_success
  assert_output --partial "[dry-run] Would delete"
  assert_output --partial "#1001"
  assert_output --partial "#1002"
  assert_output --partial "2 run(s) would have been deleted"
}

@test "dry-run with --keep-latest skips recent runs" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "run" && "$2" == "list" ]]; then
  cat <<'JSON'
[
  {"databaseId":1001,"displayTitle":"Run 1","workflowName":"CI","status":"completed","conclusion":"success","createdAt":"2025-01-03T00:00:00Z"},
  {"databaseId":1002,"displayTitle":"Run 2","workflowName":"CI","status":"completed","conclusion":"success","createdAt":"2025-01-02T00:00:00Z"},
  {"databaseId":1003,"displayTitle":"Run 3","workflowName":"CI","status":"completed","conclusion":"failure","createdAt":"2025-01-01T00:00:00Z"}
]
JSON
  exit 0
fi
echo "UNEXPECTED: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --repo owner/repo --dry-run --keep-latest 2
  assert_success
  assert_output --partial "[dry-run] Would delete"
  assert_output --partial "#1003"
  refute_output --partial "#1001"
  refute_output --partial "#1002"
}

@test "reports no runs found when empty" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "run" && "$2" == "list" ]]; then echo '[]'; exit 0; fi
echo "UNEXPECTED: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --repo owner/repo --dry-run
  assert_success
  assert_output --partial "No workflow runs found"
}

# ── Pre-flight checks ────────────────────────────────────────────────────────

@test "fails when gh is not installed" {
  # Remove gh from mock bin if present, and override PATH to exclude real gh
  rm -f "${MOCK_BIN}/gh"
  export PATH="${MOCK_BIN}:/usr/bin:/bin"

  run "$SCRIPT" --repo owner/repo
  assert_failure
  assert_output --partial "gh"
}
