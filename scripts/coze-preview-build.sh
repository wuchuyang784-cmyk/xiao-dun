#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Install dependencies if node_modules is missing or incomplete
if [ ! -d "node_modules" ]; then
  npm install
fi
