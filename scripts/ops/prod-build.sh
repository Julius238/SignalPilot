#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./_common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_production_env

echo "=== SignalPilot: Building production images ==="
echo ""

"${COMPOSE[@]}" build "$@"

echo ""
echo "Build complete. No container was started and no migration was run."
