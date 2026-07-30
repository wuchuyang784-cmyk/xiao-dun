#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

export XIAODUN_PORT=5000
export XIAODUN_HOST="0.0.0.0"
export XIAODUN_NO_OPEN=1
export XIAODUN_WEB_ONLY=1

exec node scripts/start-web.mjs
