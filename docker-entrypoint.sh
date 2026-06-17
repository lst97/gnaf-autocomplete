#!/bin/sh
set -e

# ── docker-entrypoint.sh ──
# Ensures the G-NAF data volume is writable by appuser before handing control
# to the CMD. Runs as root (default Docker entrypoint user), then drops
# privileges via su-exec.
#
# Without this, `docker compose run --rm api bun run scripts/create-gnaf.ts`
# fails with "Permission denied" when appuser tries to extract into the
# volume-mounted /opt/gnaf-data directory.

# Always fix permissions on the volume mount point (/opt/gnaf-data).
# GNAF_DATA_ROOT is the host-side path for docker-compose, not the container path.
GNAF_DIR="/opt/gnaf-data"
mkdir -p "$GNAF_DIR"
chown -R appuser:appuser "$GNAF_DIR"

# Drop privileges and execute the CMD
exec su-exec appuser "$@"
