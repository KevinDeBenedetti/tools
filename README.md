# tools

A collection of shell scripts, Makefiles, and Docker templates for development workflows.

## Shell scripts

> `shell/github/` · Requires [gh](https://cli.github.com/) and [jq](https://jqlang.github.io/jq/) · All scripts support `--dry-run`

| Script             | Description                                    |
| ------------------ | ---------------------------------------------- |
| `purge-actions.sh` | Delete GitHub Actions workflow runs            |
| `purge-release.sh` | Delete GitHub releases                         |
| `purge-tags.sh`    | Delete Git tags                                |
| `detect-bots.sh`   | Detect (and optionally purge) bot commits      |
| `scan-secrets.sh`  | Scan a repo for accidentally committed secrets |
| `clean-repo.sh`    | Remove unwanted files from Git history         |
| `backup-repos.sh`  | Backup all GitHub repos as bare mirrors        |
| `maintain-all.sh`  | Run full maintenance across all GitHub repos   |

Scripts are also exposed as `make` targets — pass flags via `ARGS=`:

```bash
make purge-actions ARGS="--repo owner/repo --dry-run"
make detect-bots   ARGS="--repo owner/repo"
make test                     # run all Bats tests
make test-scan-secrets        # test a specific script
```

## Makefiles

> `makefiles/` · Reusable fragments to include in any project's `Makefile`

Each fragment (`fastapi.mk`, `nuxt.mk`, `vue.mk`) exposes a consistent set of targets — `validate`, `dev`, `build`, `lint`, `clean`, `upgrade` — configured via variables like `JS_PKG_MANAGER`, `PY_PKG_MANAGER`, or `DOCKER`.

```makefile
JS_PKG_MANAGER := pnpm
include path/to/tools/makefiles/nuxt.mk
```

## Docker

> `docker/` · Production-ready multi-stage Dockerfiles

| Template          | Stack                                          | Description                                     |
| ----------------- | ---------------------------------------------- | ----------------------------------------------- |
| `docker/fastapi/` | Python · [uv](https://github.com/astral-sh/uv) | Multi-stage image with cached dependency layer  |
| `docker/nuxt/`    | Node · npm                                     | Two-stage build with `.output/` production copy |
| `docker/vue/`     | Node · pnpm                                    | Multi-stage image with frozen lockfile install  |

## Requirements

[gh](https://cli.github.com/) · [jq](https://jqlang.github.io/jq/) · [bats](https://bats-core.readthedocs.io/) · [Docker](https://www.docker.com/)