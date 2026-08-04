#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=./_common.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_common.sh"
require_production_env

# If a service name is passed, tail that service; otherwise tail all
"${COMPOSE[@]}" logs --follow --tail=100 "$@"
