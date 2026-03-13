---
title: Docker Templates
---

# Docker Templates

Stack-specific templates are available under `docker/`:

- `docker/fastapi/`
- `docker/nuxt/`
- `docker/vue/`

Each stack directory includes:

- `Dockerfile`
- `.dockerignore`

## Typical usage

Copy the desired stack template into your project and adjust base images, runtime commands, and exposed ports to match your application requirements.

## Recommendations

- Pin base image versions for reproducibility.
- Keep runtime images small by using multi-stage builds.
- Avoid copying build-only files into final runtime layers.
- Keep `.dockerignore` strict to reduce context size.

## Validation checklist

```bash
docker build -t my-app:local .
docker run --rm -p 3000:3000 my-app:local
```

Use the checklist above after adapting template files in your project.
