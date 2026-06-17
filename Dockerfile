# syntax=docker/dockerfile:1.7
# ============================================================
# G-NAF Address Autocomplete — optimized Bun image
# - Pinned to oven/bun:1.3.14-alpine (~80MB vs ~200MB Debian)
# - Builder stage: install prod deps only
# - Runtime stage: non-root user via entrypoint + healthcheck
# ============================================================

# ---------- Builder ----------
FROM oven/bun:1.3.14-alpine AS builder
WORKDIR /app

# Install prod deps first (best layer caching — only invalidates on lockfile change)
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --production

# Copy source + static assets
COPY src/ src/
COPY scripts/ scripts/
COPY sql/ sql/
COPY pages/ pages/

# ---------- Runtime ----------
FROM oven/bun:1.3.14-alpine AS runtime

# Install runtime tools + create non-root user in one RUN
RUN apk add --no-cache curl unzip su-exec \
    && addgroup -S -g 1001 appuser \
    && adduser -S -G appuser -u 1001 -D -H appuser \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Pull built artifact from builder
COPY --from=builder --chown=appuser:appuser /app /app

# Entrypoint: runs as root, fixes volume permissions, drops to appuser
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]

EXPOSE 8000

# Bake healthcheck into the image so it works without docker-compose
# start-period accounts for ts startup + DB connection retry
HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=15s \
  CMD curl -fsS http://localhost:8000/healthz || exit 1

CMD ["bun", "run", "src/index.ts"]
