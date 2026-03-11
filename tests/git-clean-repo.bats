#!/usr/bin/env bats

# Tests for git-clean-repo.sh
# Uses mocked git/git-filter-repo — never touches real repos

setup() {
  DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
  REPO_ROOT="$(cd "$DIR/.." && pwd)"
  SCRIPT="${REPO_ROOT}/shell/git-clean-repo.sh"

  load 'test_helper/bats-support/load'
  load 'test_helper/bats-assert/load'
  load 'test_helper/bats-file/load'

  MOCK_BIN="$(mktemp -d)"
  export PATH="${MOCK_BIN}:${PATH}"

  # Mock git that reports we're inside a work tree
  cat > "${MOCK_BIN}/git" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "rev-parse" && "$2" == "--is-inside-work-tree" ]]; then echo "true"; exit 0; fi
if [[ "$1" == "rev-parse" && "$2" == "--show-toplevel" ]]; then echo "/tmp/fake-repo"; exit 0; fi
if [[ "$1" == "log" ]]; then echo ""; exit 0; fi
if [[ "$1" == "filter-repo" ]]; then echo "mock filter-repo: $*"; exit 0; fi
if [[ "$1" == "reflog" ]]; then echo "mock reflog: $*"; exit 0; fi
if [[ "$1" == "gc" ]]; then echo "mock gc: $*"; exit 0; fi
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git"

  # Mock git-filter-repo
  cat > "${MOCK_BIN}/git-filter-repo" <<'MOCK'
#!/usr/bin/env bash
echo "mock git-filter-repo: $*"
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git-filter-repo"
}

teardown() {
  rm -rf "$MOCK_BIN"
}

# ── Usage & help ──────────────────────────────────────────────────────────────

@test "shows usage with --help" {
  run "$SCRIPT" --help
  assert_success
  assert_output --partial "Usage:"
  assert_output --partial "--dry-run"
  assert_output --partial "--paths"
  assert_output --partial "--aggressive"
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

@test "dry-run shows what would be removed" {
  run "$SCRIPT" --dry-run
  assert_success
  assert_output --partial "[dry-run]"
  assert_output --partial ".DS_Store"
  assert_output --partial ".env"
}

@test "dry-run with --paths includes extra files" {
  run "$SCRIPT" --dry-run --paths secret.txt debug.log --
  assert_success
  assert_output --partial "secret.txt"
  assert_output --partial "debug.log"
  assert_output --partial ".DS_Store"
}

# ── Normal run with mocks ────────────────────────────────────────────────────

@test "normal run calls filter-repo, reflog, and gc" {
  run "$SCRIPT"
  assert_success
  assert_output --partial "Rewriting history"
  assert_output --partial "Repo cleaned"
}

@test "aggressive gc uses --aggressive flag" {
  # Override git mock to capture gc args
  cat > "${MOCK_BIN}/git" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "rev-parse" && "$2" == "--is-inside-work-tree" ]]; then echo "true"; exit 0; fi
if [[ "$1" == "rev-parse" && "$2" == "--show-toplevel" ]]; then echo "/tmp/fake-repo"; exit 0; fi
if [[ "$1" == "gc" ]]; then echo "gc-args: $*"; exit 0; fi
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git"

  run "$SCRIPT" --aggressive
  assert_success
  assert_output --partial "aggressive"
}
