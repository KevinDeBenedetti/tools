#!/usr/bin/env bats

# Tests for detect-bots.sh
# Uses mocked git commands — never touches real repos

setup() {
  DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
  REPO_ROOT="$(cd "$DIR/../.." && pwd)"
  SCRIPT="${REPO_ROOT}/shell/github/detect-bots.sh"

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
  assert_output --partial "--format"
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
  assert_output --partial "Bot patterns"
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

# ── Local scan with mocked data ──────────────────────────────────────────────

@test "detects bot commits in local repo" {
  cat > "${MOCK_BIN}/git" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "rev-parse" && "$2" == "--is-inside-work-tree" ]]; then echo "true"; exit 0; fi
if [[ "$1" == "rev-parse" && "$2" == "--show-toplevel" ]]; then echo "/tmp/fake-repo"; exit 0; fi
if [[ "$1" == "-C" && "$3" == "log" ]]; then
  cat <<'LOG'
abc12345|dependabot[bot]|dependabot@github.com|Bump lodash from 4.17.20 to 4.17.21
def67890|renovate[bot]|renovate@whitesourcesoftware.com|Update dependency express to v4.18.2
111aaabb|John Doe|john@example.com|Add new feature
LOG
  exit 0
fi
if [[ "$1" == "-C" && "$3" == "rev-list" ]]; then echo "50"; exit 0; fi
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git"

  run "$SCRIPT" --local
  assert_success
  assert_output --partial "2 bot commit(s)"
  assert_output --partial "dependabot"
  assert_output --partial "renovate"
}

@test "reports no bot commits when clean" {
  cat > "${MOCK_BIN}/git" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "rev-parse" && "$2" == "--is-inside-work-tree" ]]; then echo "true"; exit 0; fi
if [[ "$1" == "rev-parse" && "$2" == "--show-toplevel" ]]; then echo "/tmp/fake-repo"; exit 0; fi
if [[ "$1" == "-C" && "$3" == "log" ]]; then
  cat <<'LOG'
abc12345|John Doe|john@example.com|Add feature
def67890|Jane Smith|jane@example.com|Fix bug
LOG
  exit 0
fi
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git"

  run "$SCRIPT" --local
  assert_success
  assert_output --partial "No bot commits found"
}

# ── Purge-bots ────────────────────────────────────────────────────────────────

@test "purge-bots requires git-filter-repo" {
  cat > "${MOCK_BIN}/git" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "rev-parse" && "$2" == "--is-inside-work-tree" ]]; then echo "true"; exit 0; fi
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git"

  # Ensure git-filter-repo is NOT available
  rm -f "${MOCK_BIN}/git-filter-repo"
  export PATH="${MOCK_BIN}:/usr/bin:/bin"

  run "$SCRIPT" --purge-bots
  assert_failure
  assert_output --partial "git-filter-repo"
}

@test "purge-bots rejects --repo flag" {
  cat > "${MOCK_BIN}/git" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git"
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
  chmod +x "${MOCK_BIN}/gh"
  cat > "${MOCK_BIN}/git-filter-repo" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git-filter-repo"

  run "$SCRIPT" --repo owner/repo --purge-bots
  assert_failure
  assert_output --partial "only works on local"
}

@test "purge-bots dry-run shows preview" {
  cat > "${MOCK_BIN}/git" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "rev-parse" && "$2" == "--is-inside-work-tree" ]]; then echo "true"; exit 0; fi
if [[ "$1" == "rev-parse" && "$2" == "--show-toplevel" ]]; then echo "/tmp/fake-repo"; exit 0; fi
if [[ "$1" == "-C" && "$3" == "log" ]]; then
  echo "abc12345|dependabot[bot]|dependabot@github.com|Bump lodash"
  exit 0
fi
if [[ "$1" == "-C" && "$3" == "rev-list" ]]; then echo "10"; exit 0; fi
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git"
  cat > "${MOCK_BIN}/git-filter-repo" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
  chmod +x "${MOCK_BIN}/git-filter-repo"

  run "$SCRIPT" --purge-bots --dry-run
  assert_success
  assert_output --partial "[dry-run]"
  assert_output --partial "1 bot commit(s)"
}
