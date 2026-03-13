#!/usr/bin/env bats

# Tests for purge-packages.sh
# Uses mocked gh/jq commands — never touches real repos

setup() {
  DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
  REPO_ROOT="$(cd "$DIR/../.." && pwd)"
  SCRIPT="${REPO_ROOT}/shell/github/purge-packages.sh"

  load '../test_helper/bats-support/load'
  load '../test_helper/bats-assert/load'

  MOCK_BIN="$(mktemp -d)"
  export PATH="${MOCK_BIN}:${PATH}"

  # Provide a real jq so JSON processing works
  JQ_REAL="$(command -v jq)"
  cat > "${MOCK_BIN}/jq" <<MOCK
#!/usr/bin/env bash
exec "${JQ_REAL}" "\$@"
MOCK
  chmod +x "${MOCK_BIN}/jq"

  # Default gh mock: authenticated + full package scopes
  _write_gh_mock() {
    cat > "${MOCK_BIN}/gh" <<'GH_MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "  - Token scopes: 'read:packages', 'delete:packages', 'repo'"
  exit 0
fi
if [[ "$1" == "auth" ]]; then exit 0; fi
GH_MOCK
    chmod +x "${MOCK_BIN}/gh"
  }
  _write_gh_mock
}

teardown() {
  rm -rf "$MOCK_BIN"
}

# ── Usage & help ──────────────────────────────────────────────────────────────

@test "fails when --owner is missing" {
  run "$SCRIPT"
  assert_failure
  assert_output --partial "--owner"
}

@test "--package-type and --package-name are optional" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "  - Token scopes: 'read:packages', 'delete:packages', 'repo'"
  exit 0
fi
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" ]]; then printf '[]'; exit 0; fi
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --owner myuser --dry-run
  assert_success
}

@test "shows usage with --help" {
  run "$SCRIPT" --help
  assert_success
  assert_output --partial "--owner"
  assert_output --partial "--package-type"
  assert_output --partial "--package-name"
  assert_output --partial "--dry-run"
  assert_output --partial "--keep-latest"
  assert_output --partial "--version-pattern"
}

# ── Scope checks ─────────────────────────────────────────────────────────────

@test "fails with helpful message when token lacks read:packages" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "  - Token scopes: 'repo', 'workflow'"
  exit 0
fi
if [[ "$1" == "auth" ]]; then exit 0; fi
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --owner myuser --package-type container --dry-run
  assert_failure
  assert_output --partial "read:packages"
  assert_output --partial "gh auth"
}

@test "fails when token lacks delete:packages for non-dry-run" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "  - Token scopes: 'read:packages', 'repo'"
  exit 0
fi
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" ]]; then
  printf '[{"name":"myapp"}]'
  exit 0
fi
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --owner myuser --package-type container --package-name myapp
  assert_failure
  assert_output --partial "delete:packages"
}

@test "allows read-only dry-run with only read:packages scope" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "  - Token scopes: 'read:packages', 'repo'"
  exit 0
fi
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" ]]; then printf '[]'; exit 0; fi
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --owner myuser --package-type container --dry-run
  assert_success
}

# ── Argument validation ───────────────────────────────────────────────────────

@test "fails on unknown option" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "  - Token scopes: 'read:packages', 'delete:packages'"
  exit 0
fi
if [[ "$1" == "auth" ]]; then exit 0; fi
echo "[]"
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --owner myuser --package-type container --package-name myapp --bogus
  assert_failure
  assert_output --partial "Unknown option"
}

@test "fails on invalid package type" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" ]]; then exit 0; fi
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --owner myuser --package-type invalid --package-name myapp
  assert_failure
  assert_output --partial "Invalid --package-type"
}

# ── Named package: dry-run ────────────────────────────────────────────────────

@test "dry-run lists versions without deleting (named package)" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "  - Token scopes: 'read:packages', 'delete:packages'"
  exit 0
fi
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" ]]; then
  printf '[{"id":1,"name":"1.2.0"},{"id":2,"name":"1.1.0"},{"id":3,"name":"1.0.0"}]'
  exit 0
fi
echo "UNEXPECTED: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --owner myuser --package-type container --package-name myapp --dry-run
  assert_success
  assert_output --partial "[dry-run] Would delete: 1.2.0"
  assert_output --partial "[dry-run] Would delete: 1.1.0"
  assert_output --partial "[dry-run] Would delete: 1.0.0"
  assert_output --partial "3 version(s) would be deleted"
}

@test "dry-run uses org path when --org is set" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "  - Token scopes: 'read:packages', 'delete:packages'"
  exit 0
fi
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" && "$2" == *"orgs/myorg"* ]]; then
  printf '[{"id":10,"name":"2.0.0"}]'
  exit 0
fi
echo "UNEXPECTED path: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --owner myorg --org --package-type npm --package-name mylib --dry-run
  assert_success
  assert_output --partial "[dry-run] Would delete: 2.0.0"
}

@test "dry-run with --keep-latest preserves recent versions" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "  - Token scopes: 'read:packages', 'delete:packages'"
  exit 0
fi
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" ]]; then
  printf '[{"id":1,"name":"3.0.0"},{"id":2,"name":"2.0.0"},{"id":3,"name":"1.0.0"}]'
  exit 0
fi
echo "UNEXPECTED: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --owner myuser --package-type container --package-name myapp --dry-run --keep-latest 2
  assert_success
  refute_output --partial "3.0.0"
  refute_output --partial "2.0.0"
  assert_output --partial "[dry-run] Would delete: 1.0.0"
}

@test "dry-run with --version-pattern filters by glob" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "  - Token scopes: 'read:packages', 'delete:packages'"
  exit 0
fi
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" ]]; then
  printf '[{"id":1,"name":"2.0.0"},{"id":2,"name":"1.0.0-rc1"},{"id":3,"name":"0.9.0-rc2"}]'
  exit 0
fi
echo "UNEXPECTED: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --owner myuser --package-type npm --package-name mylib --dry-run --version-pattern "*-rc*"
  assert_success
  refute_output --partial "2.0.0"
  assert_output --partial "1.0.0-rc1"
  assert_output --partial "0.9.0-rc2"
}

@test "reports nothing when no versions found for named package" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "  - Token scopes: 'read:packages', 'delete:packages'"
  exit 0
fi
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" ]]; then printf '[]'; exit 0; fi
echo "UNEXPECTED: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --owner myuser --package-type container --package-name myapp --dry-run
  assert_success
  assert_output --partial "No versions found"
}

@test "reports nothing to delete when pattern matches nothing" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "  - Token scopes: 'read:packages', 'delete:packages'"
  exit 0
fi
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" ]]; then
  printf '[{"id":1,"name":"1.0.0"},{"id":2,"name":"2.0.0"}]'
  exit 0
fi
echo "UNEXPECTED: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --owner myuser --package-type container --package-name myapp --dry-run --version-pattern "*-beta*"
  assert_success
  assert_output --partial "Nothing to delete"
}

# ── Auto-discovery: no --package-name ────────────────────────────────────────

@test "discovers and purges all packages when --package-name is omitted" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "  - Token scopes: 'read:packages', 'delete:packages'"
  exit 0
fi
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" ]]; then
  # List packages endpoint (user/packages?package_type=...)
  if [[ "$2" == *"packages?package_type"* ]]; then
    printf '[{"name":"app-a"},{"name":"app-b"}]'
    exit 0
  fi
  # Versions endpoint
  printf '[{"id":1,"name":"1.0.0"}]'
  exit 0
fi
echo "UNEXPECTED: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --owner myuser --package-type container --dry-run
  assert_success
  assert_output --partial "app-a"
  assert_output --partial "app-b"
  assert_output --partial "[dry-run] Would delete: 1.0.0"
}

@test "gracefully handles API error response instead of package list" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "  - Token scopes: 'read:packages', 'delete:packages'"
  exit 0
fi
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" ]]; then
  printf '{"message":"Must have admin rights to Repository.","documentation_url":"https://docs.github.com/rest"}'
  exit 0
fi
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --owner myuser --package-type container --dry-run
  assert_success
  assert_output --partial "No 'container' packages found"
}

@test "reports no packages found when registry is empty (auto-discovery)" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "  - Token scopes: 'read:packages', 'delete:packages'"
  exit 0
fi
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" ]]; then printf '[]'; exit 0; fi
echo "UNEXPECTED: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --owner myuser --package-type container --dry-run
  assert_success
  assert_output --partial "No 'container' packages found"
}

@test "falls back to deleting entire package when last tagged version error" {
  cat > "${MOCK_BIN}/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ "$1" == "auth" && "$2" == "status" ]]; then
  echo "  - Token scopes: 'read:packages', 'delete:packages'"
  exit 0
fi
if [[ "$1" == "auth" ]]; then exit 0; fi
if [[ "$1" == "api" && "$2" == "-X" && "$3" == "DELETE" ]]; then
  if [[ "$4" == *"/versions/"* ]]; then
    echo "You cannot delete the last tagged version of a package. You must delete the package instead."
    exit 1
  fi
  exit 0
fi
if [[ "$1" == "api" ]]; then
  printf '[{"id":99,"name":"sha256:abc123"}]'
  exit 0
fi
echo "UNEXPECTED: $*" >&2; exit 1
MOCK
  chmod +x "${MOCK_BIN}/gh"

  run "$SCRIPT" --owner myuser --package-type container --package-name myapp
  assert_success
  assert_output --partial "Last tagged version"
  assert_output --partial "deleting entire package"
  assert_output --partial "Package 'myapp' deleted entirely"
}

