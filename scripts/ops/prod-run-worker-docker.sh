#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT"

if [ "$#" -lt 1 ]; then
  echo "ERROR: Worker script name is required."
  echo "Usage: $0 <worker-script-name> [-- extra args]"
  echo "Example: $0 worker:run-crypto-pipeline"
  exit 1
fi

WORKER_SCRIPT="$1"
shift

NETWORK="${SIGNALPILOT_DOCKER_NETWORK:-signalpilot_internal}"
ENV_FILE="${SIGNALPILOT_ENV_FILE:-.env.production}"
IMAGE="${SIGNALPILOT_NODE_IMAGE:-node:22-bookworm}"
PNPM_VERSION="9.15.0"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: Environment file '$ENV_FILE' not found."
  echo "Set SIGNALPILOT_ENV_FILE to override the default."
  exit 1
fi

if [ ! -f "packages/database/prisma/schema.prisma" ]; then
  echo "ERROR: Prisma schema not found at packages/database/prisma/schema.prisma."
  exit 1
fi

if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  echo "ERROR: Docker network '$NETWORK' not found."
  echo "Start the production stack first or set SIGNALPILOT_DOCKER_NETWORK."
  exit 1
fi

echo "=== SignalPilot: Production worker run via temporary Node container ==="
echo "Network: $NETWORK"
echo "Env file: $ENV_FILE"
echo "Image: $IMAGE"
echo "Worker script: $WORKER_SCRIPT"
echo ""

docker run --rm \
  --network "$NETWORK" \
  --env-file "$ENV_FILE" \
  -e "SIGNALPILOT_PNPM_VERSION=$PNPM_VERSION" \
  -v "$PWD:/app" \
  -w /app \
  "$IMAGE" \
  bash -lc 'set -euo pipefail; worker_script="$1"; shift; corepack enable; corepack prepare "pnpm@${SIGNALPILOT_PNPM_VERSION}" --activate; pnpm install --frozen-lockfile; pnpm --filter @signalpilot/database exec prisma generate --schema=/app/packages/database/prisma/schema.prisma; pnpm -r --filter "./packages/**" build; pnpm --filter @signalpilot/worker build; pnpm "$worker_script" "$@"' \
  bash "$WORKER_SCRIPT" "$@"

echo ""
echo "Production worker run complete."
