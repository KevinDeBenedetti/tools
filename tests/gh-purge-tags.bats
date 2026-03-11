#!/usr/bin/env bats

# Tests for gh-purge-tags.sh
# Uses mocked gh/jq commands — never touches real repos

setup() {
  DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
  REPO_ROOT="$(cd "$DIR/.." && pwd)"
  SCRIPT="${REPO_ROOT}/shell/gh-purge-tags.sh"

  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'

  MOCK_BIN="$(mktemp -d)"
  export PATH="${MOCK_BIN}:${PATH}"
}

teardown() {
  rm -rf "$MOCK_BIN"
}

# ── Usage & help ──────────────────────────────────────────────────────────────

@test "shows usage when no arguments" {
  run "$SCRIPT"
  assert_success
  assert_output --partial "Usage:"
}

@test "shows usage with --help" {
  run "$SCRIPT" --help
  assert_success
  assert_output --partial "--dry-run"
  assert_output --partial "--keep-latest"
  assert_output --partial "--tag-pattern"
}

# ── Argument validation ──────────────────────────────────────────────────────

@test "fails on unknown option" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" ]]; then exit 0; fi
echo ""
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" owner/repo --bogus
  assert_failure
  assert_output --partial "Unknown option"
}

# ── Dry-run with mocked data ─────────────────────────────────────────────────

@test "dry-run lists tags without deleting" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" ]]; then
  printf "v1.2.0\nv1.1.0\nv1.0.0\n"
  exit 0
fi
echo "UNEXPECTED: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" owner/repo --dry-run
  assert_success
  assert_output --partial "[dry-run] Would delete: v1.2.0"
  assert_output --partial "[dry-run] Would delete: v1.1.0"
  assert_output --partial "[dry-run] Would delete: v1.0.0"
  assert_output --partial "3 tag(s) would have been deleted"
}

@test "dry-run with --keep-latest preserves recent tags" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" ]]; then
  printf "v3.0.0\nv2.0.0\nv1.0.0\n"
  exit 0
fi
echo "UNEXPECTED: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" owner/repo --dry-run --keep-latest 2
  assert_success
  refute_output --partial "v3.0.0"
  refute_output --partial "v2.0.0"
  assert_output --partial "[dry-run] Would delete: v1.0.0"
}

@test "dry-run with --tag-pattern filters by glob" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" ]]; then
  printf "v2.0.0\nv1.0.0-rc1\nv0.9.0-rc2\n"
  exit 0
fi
echo "UNEXPECTED: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" owner/repo --dry-run --tag-pattern "*-rc*"
  assert_success
  refute_output --partial "v2.0.0"
  assert_output --partial "v1.0.0-rc1"
  assert_output --partial "v0.9.0-rc2"
}

@test "reports no tags found when empty" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" ]]; then echo ""; exit 0; fi
echo "UNEXPECTED: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" owner/repo --dry-run
  assert_success
  assert_output --partial "No tags found"
}
