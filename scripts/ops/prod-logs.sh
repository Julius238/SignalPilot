#!/usr/bin/env bash
set -euo pipefail

COMPOSE="docker compose -f docker-compose.prod.yml"

# If a service name is passed, tail that service; otherwise tail all
$COMPOSE logs --follow --tail=100 "$@"
