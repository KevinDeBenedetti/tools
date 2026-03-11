#!/usr/bin/env bats

# Tests for maintain-all.sh
# Uses mocked commands — never touches real repos

setup() {
  DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
  REPO_ROOT="$(cd "$DIR/../.." && pwd)"
  SCRIPT="${REPO_ROOT}/shell/github/maintain-all.sh"

  load '../test_helper/bats-support/load'
  load '../test_helper/bats-assert/load'
  load '../test_helper/bats-file/load'

  MOCK_BIN="$(mktemp -d)"
  export PATH="${MOCK_BIN}:${PATH}"
}

teardown() {
  rm -rf "$MOCK_BIN"
  rm -rf "$MOCK_CONFIG"
}

# ── Usage & help ──────────────────────────────────────────────────────────────

@test "shows usage with --help" {
  run "$SCRIPT" --help
  assert_success
  assert_output --partial "Usage:"
  assert_output --partial "--dry-run"
  assert_output --partial "--config"
}

@test "shows usage with -h" {
  run "$SCRIPT" -h
  assert_success
  assert_output --partial "Usage:"
}

# ── Argument validation ──────────────────────────────────────────────────────

@test "fails on unknown option" {
  run "$SCRIPT" --bogus
  assert_failure
  assert_output --partial "Unknown option"
}

# ── Pre-flight checks ────────────────────────────────────────────────────────

@test "fails when config file not found" {
  # Mock all required tools
  for cmd in git gh jq git-filter-repo yq; do
    cat > "${MOCK_BIN}/${cmd}" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" ]]; then exit 0; fi
exit 0
MOCK
    chmod +x "${MOCK_BIN}/${cmd}"
  done

  run "$SCRIPT" --config /nonexistent/config.yml
  assert_failure
  assert_output --partial "Config not found"
}

@test "fails when required tool is missing" {
  # Only provide some tools, missing git-filter-repo
  for cmd in git gh jq yq; do
    cat > "${MOCK_BIN}/${cmd}" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
    chmod +x "${MOCK_BIN}/${cmd}"
  done

  # Override PATH to only include mock dir
  export PATH="${MOCK_BIN}:/usr/bin:/bin"

  run "$SCRIPT"
  assert_failure
  assert_output --partial "is not installed"
}
