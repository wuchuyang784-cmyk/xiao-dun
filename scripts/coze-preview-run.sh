#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Read expose_port from .preview, fallback to 5000
EXPOSE_PORT=$(awk -F '[ =]+' '/^expose_port/ {gsub(/[^0-9]/, "", $2); print $2; exit}' .preview 2>/dev/null || echo 5000)

# Clean up residual processes on the target port (never touch 9000)
if [ "$EXPOSE_PORT" != "9000" ]; then
  fuser -k "${EXPOSE_PORT}/tcp" 2>/dev/null || true
  sleep 1
fi

export XIAODUN_PORT="$EXPOSE_PORT"
export XIAODUN_HOST="0.0.0.0"
export XIAODUN_NO_OPEN=1
export XIAODUN_WEB_ONLY=1

exec node scripts/start-web.mjs
