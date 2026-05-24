#!/usr/bin/env bash
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"

echo "=== SignalPilot: Stopping production services ==="
echo ""

$COMPOSE down "$@"

echo ""
echo "Services stopped."
