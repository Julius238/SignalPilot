#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./_common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_production_env

echo "=== SignalPilot: Starting production services ==="
echo ""

"${COMPOSE[@]}" up -d "$@"

echo ""
echo "Services started."
echo "  Logs:   ./scripts/ops/prod-logs.sh"
echo "  Health: ./scripts/ops/healthcheck.sh"
