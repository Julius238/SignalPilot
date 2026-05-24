#!/usr/bin/env bash
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"

if [ ! -f ".env.production" ]; then
  echo "ERROR: .env.production not found."
  echo "       Copy .env.production.example, fill in values, then retry."
  exit 1
fi

echo "=== SignalPilot: Starting production services ==="
echo ""

$COMPOSE up -d "$@"

echo ""
echo "Services started."
echo "  Logs:   pnpm ops:prod:logs"
echo "  Status: pnpm ops:prod:ps"
echo "  Health: pnpm ops:prod:health"
