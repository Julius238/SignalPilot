#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT"

NETWORK="${SIGNALPILOT_DOCKER_NETWORK:-signalpilot_internal}"
ENV_FILE="${SIGNALPILOT_ENV_FILE:-.env.production}"
IMAGE="${SIGNALPILOT_NODE_IMAGE:-node:22-bookworm}"
PROJECT_PNPM_VERSION="$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' package.json | head -n 1)"
PNPM_VERSION="${SIGNALPILOT_PNPM_VERSION:-$PROJECT_PNPM_VERSION}"

if [ -z "$PNPM_VERSION" ]; then
  echo "ERROR: Could not determine pnpm version from package.json."
  echo "Set SIGNALPILOT_PNPM_VERSION to override."
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: Environment file '$ENV_FILE' not found."
  echo "Set SIGNALPILOT_ENV_FILE to override the default."
  exit 1
fi

if [ ! -f "packages/database/prisma/schema.prisma" ]; then
  echo "ERROR: Prisma schema not found at packages/database/prisma/schema.prisma."
  exit 1
fi

if [ ! -d "packages/database/prisma/migrations" ]; then
  echo "ERROR: Prisma migrations directory not found at packages/database/prisma/migrations."
  exit 1
fi

if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  echo "ERROR: Docker network '$NETWORK' not found."
  echo "Start the production stack first or set SIGNALPILOT_DOCKER_NETWORK."
  exit 1
fi

echo "=== SignalPilot: Production migration via temporary Node container ==="
echo "Network: $NETWORK"
echo "Env file: $ENV_FILE"
echo "Image: $IMAGE"
echo ""
echo "Running: pnpm db:migrate:deploy"
echo ""

docker run --rm \
  --network "$NETWORK" \
  --env-file "$ENV_FILE" \
  -e "SIGNALPILOT_PNPM_VERSION=$PNPM_VERSION" \
  -v "$PWD:/app" \
  -w /app \
  "$IMAGE" \
  bash -lc 'set -euo pipefail; corepack enable; corepack prepare "pnpm@${SIGNALPILOT_PNPM_VERSION}" --activate; pnpm install --frozen-lockfile; pnpm db:migrate:deploy'

echo ""
echo "Production migration complete."
