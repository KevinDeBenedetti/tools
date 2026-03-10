# Global arguments - must be provided at build time
ARG PYTHON_VERSION
ARG UV_VERSION
ARG APP_PORT

# =============================================================================
# Stage: base
# Common configuration for all stages
# =============================================================================
FROM python:${PYTHON_VERSION}-slim AS base

ARG UV_VERSION
ARG APP_PORT

# Copy uv binary
COPY --from=ghcr.io/astral-sh/uv:${UV_VERSION} /uv /uvx /bin/

# Environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV UV_LINK_MODE=copy
ENV UV_SYSTEM_PYTHON=1
ENV PYTHONPATH=/app

WORKDIR /app

# Copy dependency files
COPY pyproject.toml uv.lock* ./

# =============================================================================
# Stage: dependencies
# Dependencies installation (with cache)
# =============================================================================
FROM base AS dependencies

# Install all dependencies
RUN uv sync --no-cache

# =============================================================================
# Stage: dev
# Development environment
# =============================================================================
FROM base AS dev

ARG APP_PORT

# Copy dependencies from previous stage
COPY --from=dependencies /app/.venv /app/.venv

# Copy source code
COPY . .

# Expose port
EXPOSE ${APP_PORT}

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${APP_PORT}/health').read()" || exit 1

# Default command
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "${APP_PORT}", "--reload"]

# =============================================================================
# Stage: build
# Build application for production (optional - for compiled assets)
# =============================================================================
FROM dependencies AS build

# Copy source code
COPY . .

# Environment variables for build (can be overridden)
ARG PYTHON_ENV=production
ENV PYTHON_ENV=${PYTHON_ENV}

# Optional: Run any build steps if needed (e.g., compile translations, assets)
# RUN uv run python -m compileall .

# =============================================================================
# Stage: prod
# Production image
# =============================================================================
FROM python:${PYTHON_VERSION}-slim AS prod

ARG UV_VERSION
ARG APP_PORT

# Copy uv binary
COPY --from=ghcr.io/astral-sh/uv:${UV_VERSION} /uv /uvx /bin/

# Environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV UV_LINK_MODE=copy
ENV UV_SYSTEM_PYTHON=1
ENV PYTHONPATH=/app
ENV PYTHON_ENV=production

WORKDIR /app

# Copy dependencies and application from build stage
COPY --from=build /app/.venv /app/.venv
COPY --from=build /app /app

# Expose port
EXPOSE ${APP_PORT}

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${APP_PORT}/health').read()" || exit 1

# Start application
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "${APP_PORT}"]