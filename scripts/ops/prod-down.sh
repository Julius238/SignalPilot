#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./_common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_production_env

echo "=== SignalPilot: Stopping production services ==="
echo ""

"${COMPOSE[@]}" down "$@"

echo ""
echo "Services stopped."
