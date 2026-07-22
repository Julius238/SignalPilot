#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${SIGNALPILOT_ENV_FILE:-.env.production}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml)

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found."
  echo "       Copy .env.production.example, fill in values, then retry."
  exit 1
fi

echo "=== SignalPilot: Building production images ==="
echo ""

"${COMPOSE[@]}" build "$@"

echo ""
echo "Build complete. Run 'pnpm ops:prod:up' to start."
