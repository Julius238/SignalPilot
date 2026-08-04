#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./_common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_production_env
require_service_running postgres

echo "=== SignalPilot: Prisma migration deploy in the built migrate image ==="
echo ""

"${COMPOSE[@]}" --profile migration run --rm --no-deps migrate

echo ""
echo "Production migration complete."
