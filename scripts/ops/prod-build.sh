#!/usr/bin/env bash
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"

echo "=== SignalPilot: Building production images ==="
echo ""

$COMPOSE build "$@"

echo ""
echo "Build complete. Run 'pnpm ops:prod:up' to start."
