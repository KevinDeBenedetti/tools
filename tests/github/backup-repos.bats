#!/usr/bin/env bats

# Tests for backup-repos.sh
# Uses mocked gh/git commands — never touches real repos

setup() {
  DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
  REPO_ROOT="$(cd "$DIR/../.." && pwd)"
  SCRIPT="${REPO_ROOT}/shell/github/backup-repos.sh"

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
  assert_output --partial "--dry-run"
  assert_output --partial "--user"
  assert_output --partial "--output"
}

@test "shows usage with -h" {
  run "$SCRIPT" -h
  assert_success
  assert_output --partial "Usage:"
}

# ── Argument validation ──────────────────────────────────────────────────────

@test "fails on unknown option" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" ]]; then echo "testuser"; exit 0; fi
echo ""
MOCK
  chmod +x "${MOCK_BIN}/gh"
  cat > "${MOCK_BIN}/git" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git"

  run "$SCRIPT" --bogus
  assert_failure
  assert_output --partial "Unknown option"
}

# ── Dry-run with mocked data ─────────────────────────────────────────────────

@test "dry-run lists repos without cloning" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" ]]; then echo "testuser"; exit 0; fi
if [[ "$1" == "repo" && "$2" == "list" ]]; then
  printf "testuser/repo-a\ntestuser/repo-b\n"
  exit 0
fi
echo "UNEXPECTED: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"
  cat > "${MOCK_BIN}/git" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git"

  run "$SCRIPT" --dry-run
  assert_success
  assert_output --partial "[dry-run] Would back up: testuser/repo-a"
  assert_output --partial "[dry-run] Would back up: testuser/repo-b"
  assert_output --partial "2 repo(s) would be backed up"
}

@test "dry-run with --user specifies user" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "repo" && "$2" == "list" ]]; then
  printf "octocat/hello-world\n"
  exit 0
fi
echo "UNEXPECTED: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"
  cat > "${MOCK_BIN}/git" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git"

  run "$SCRIPT" --dry-run --user octocat
  assert_success
  assert_output --partial "Backing up repos for: octocat"
  assert_output --partial "[dry-run] Would back up: octocat/hello-world"
}

@test "reports no repos found when empty" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" ]]; then echo "testuser"; exit 0; fi
if [[ "$1" == "repo" && "$2" == "list" ]]; then echo ""; exit 0; fi
echo "UNEXPECTED: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"
  cat > "${MOCK_BIN}/git" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git"

  run "$SCRIPT" --dry-run
  assert_success
  assert_output --partial "No repos found"
}
