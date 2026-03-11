#!/usr/bin/env bats

# Tests for scan-secrets.sh
# Uses mocked git — never touches real repos

setup() {
  DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
  REPO_ROOT="$(cd "$DIR/../.." && pwd)"
  SCRIPT="${REPO_ROOT}/shell/github/scan-secrets.sh"

  load '../test_helper/bats-support/load'
  load '../test_helper/bats-assert/load'

  MOCK_BIN="$(mktemp -d)"
  export PATH="${MOCK_BIN}:${PATH}"
}

teardown() {
  rm -rf "$MOCK_BIN"
}

# ── Usage & help ──────────────────────────────────────────────────────────────

@test "shows usage with --help" {
  run "$SCRIPT" --help
  assert_success
  assert_output --partial "Usage:"
  assert_output --partial "--repo"
  assert_output --partial "--local"
  assert_output --partial "--dry-run"
  assert_output --partial "--history"
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

# ── Dry-run ───────────────────────────────────────────────────────────────────

@test "dry-run for local repo shows scan info" {
  cat > "${MOCK_BIN}/git" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "rev-parse" && "$2" == "--is-inside-work-tree" ]]; then echo "true"; exit 0; fi
if [[ "$1" == "rev-parse" && "$2" == "--show-toplevel" ]]; then echo "/tmp/fake-repo"; exit 0; fi
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git"

  run "$SCRIPT" --dry-run
  assert_success
  assert_output --partial "[dry-run]"
  assert_output --partial "rules"
}

@test "dry-run for remote repo shows clone info" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
  chmod +x "${MOCK_BIN}/gh"
  cat > "${MOCK_BIN}/git" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git"

  run "$SCRIPT" --repo owner/repo --dry-run
  assert_success
  assert_output --partial "[dry-run] Would clone owner/repo"
}

@test "dry-run shows history flag state" {
  cat > "${MOCK_BIN}/git" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "rev-parse" && "$2" == "--is-inside-work-tree" ]]; then echo "true"; exit 0; fi
if [[ "$1" == "rev-parse" && "$2" == "--show-toplevel" ]]; then echo "/tmp/fake-repo"; exit 0; fi
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git"

  run "$SCRIPT" --dry-run --history
  assert_success
  assert_output --partial "History scan: true"
}

# ── Local scan with mocked data ──────────────────────────────────────────────

@test "detects secrets in working tree" {
  cat > "${MOCK_BIN}/git" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "rev-parse" && "$2" == "--is-inside-work-tree" ]]; then echo "true"; exit 0; fi
if [[ "$1" == "rev-parse" && "$2" == "--show-toplevel" ]]; then echo "/tmp/fake-repo"; exit 0; fi
if [[ "$1" == "-C" && "$3" == "grep" ]]; then
  echo "config.py:3:API_KEY = \"sk-abc123longfakekey\""
  echo ".env:1:AWS_SECRET_ACCESS_KEY = \"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\""
  exit 0
fi
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git"

  run "$SCRIPT" --local
  assert_failure  # exits with 1 when secrets found
  assert_output --partial "2 potential secret(s)"
  assert_output --partial "WARNING"
}

@test "reports no secrets when clean" {
  cat > "${MOCK_BIN}/git" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "rev-parse" && "$2" == "--is-inside-work-tree" ]]; then echo "true"; exit 0; fi
if [[ "$1" == "rev-parse" && "$2" == "--show-toplevel" ]]; then echo "/tmp/fake-repo"; exit 0; fi
if [[ "$1" == "-C" && "$3" == "grep" ]]; then exit 1; fi  # no matches
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git"

  run "$SCRIPT" --local
  assert_success
  assert_output --partial "No secrets detected"
}
