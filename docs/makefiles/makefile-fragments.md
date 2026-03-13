---
title: Makefile Fragments
---

# Makefile Fragments

Reusable fragments in `makefiles/` provide a consistent target interface across stacks.

## Available fragments

- `makefiles/vue.mk`
- `makefiles/nuxt.mk`
- `makefiles/fastapi.mk`

## Standard targets

Each fragment maps these common targets:

- `validate`
- `dev`
- `build`
- `lint`
- `clean`
- `upgrade`

## Vue example

```makefile
JS_PKG_MANAGER := pnpm
VUE_DIR := .
DOCKER := false

include ../tools/makefiles/vue.mk
```

```bash
make validate
make dev
make build
make lint
```

## Nuxt example

```makefile
JS_PKG_MANAGER := npm
NUXT_DIR := .

include ../tools/makefiles/nuxt.mk
```

## FastAPI example

```makefile
PY_PKG_MANAGER := uv
FASTAPI_DIR := .
DOCKER := false

include ../tools/makefiles/fastapi.mk
```

## Notes

- Fragments assume package-manager commands exist in your PATH.
- Some `lint` and `format` commands are optional and may no-op if missing in the project.
- `DOCKER=true` routes selected operations through Docker Compose where supported.
