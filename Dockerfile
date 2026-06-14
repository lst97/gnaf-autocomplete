# syntax=docker/dockerfile:1.7
# ============================================================
# G-NAF Address Autocomplete — optimized Bun image
# - Pinned to oven/bun:1.3.14-alpine (~80MB vs ~200MB Debian)
# - Builder stage: install prod deps only
# - Runtime stage: distroless-style with non-root user + healthcheck
# ============================================================

# ---------- Builder ----------
FROM oven/bun:1.3.14-alpine AS builder
WORKDIR /app

# Install prod deps first (best layer caching — only invalidates on lockfile change)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source + static assets
COPY src/ src/
COPY scripts/ scripts/
COPY sql/ sql/
COPY pages/ pages/
COPY tsconfig.json ./

# ---------- Runtime ----------
FROM oven/bun:1.3.14-alpine AS runtime

# Healthcheck dependency (Alpine ships wget, but curl is needed for the
# healthcheck defined below — tiny, ~50KB)
RUN apk add --no-cache curl \
    && addgroup -S -g 1001 appuser \
    && adduser -S -G appuser -u 1001 -D -H appuser

WORKDIR /app

# Pull built artifact from builder
COPY --from=builder --chown=appuser:appuser /app /app

USER appuser
EXPOSE 8000

# Bake healthcheck into the image so it works without docker-compose
HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=10s \
  CMD curl -fsS http://localhost:8000/healthz || exit 1

CMD ["bun", "run", "src/index.ts"]
