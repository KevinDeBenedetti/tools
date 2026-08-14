# syntax=docker/dockerfile:1
#
# The tools web UI, containerised.
#
# Two targets share one dependency layer:
#   dev      — source bind-mounted, server reloads on save (the compose default)
#   runtime  — self-contained image, no mounts, unprivileged user
#
# The UI spawns `src/cli/index.ts` as a child process for every run, so the
# image needs the whole source tree and node_modules, not a bundled artifact.
# There is deliberately no `bun build` step: `bun build` in this repo targets the
# CLI entrypoint, while the front-end is bundled by Bun.serve from the HTML
# import at request time.

FROM oven/bun:1-alpine AS base
WORKDIR /app
# Bound to every interface *inside the container* — a process on 127.0.0.1 there
# is unreachable from the host. The compose file is what keeps the published
# port on the host's loopback; see the note in src/web/serve.ts.
ENV TOOLS_UI_HOST=0.0.0.0 \
    TOOLS_UI_PORT=3030
EXPOSE 3030

# ── Dependencies ───────────────────────────────────────────────────────────────
# Keyed on the manifest alone, so editing source does not reinstall anything.
FROM base AS deps
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# ── Development ────────────────────────────────────────────────────────────────
FROM base AS dev
# No USER here, deliberately — the contrast with `USER bun` in runtime is not an
# oversight. This stage exists to be run with the working tree bind-mounted, and
# on Linux a bind mount keeps the host's uid/gid: a container user that does not
# match it cannot write the files it is meant to edit. The trade is acceptable
# only because this stage is never shipped and never leaves the developer's
# machine. Runtime, the image that could, drops root.
RUN apk add --no-cache git
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# --hot restarts the server on save. The source is bind-mounted over this copy
# by compose, which is why the COPY above only has to make the image runnable on
# its own.
CMD ["bun", "--hot", "run", "./src/web/serve.ts"]

# ── Runtime ────────────────────────────────────────────────────────────────────
FROM base AS runtime
RUN apk add --no-cache git
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The image ships no credentials: OPENAI_API_KEY and friends arrive at run time,
# from the environment or from the UI's own Environment page.
USER bun
CMD ["bun", "run", "./src/web/serve.ts"]
