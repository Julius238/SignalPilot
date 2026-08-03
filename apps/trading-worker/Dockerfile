# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo

COPY . .

RUN pnpm install --frozen-lockfile

# Build packages first (ensures Prisma client is generated for linux),
# then the trading worker.
RUN pnpm -r --filter "./packages/**" build
RUN pnpm --filter @signalpilot/trading-worker build

# Create a minimal standalone deployment with only production dependencies.
# @prisma/client and prisma are direct deps so pnpm deploy includes them with
# root-level node_modules symlinks. See apps/api/Dockerfile for full explanation.
RUN pnpm --filter @signalpilot/trading-worker deploy --prod /standalone/trading-worker

# Generate the Prisma client inside the deployed standalone.
RUN cd /standalone/trading-worker && \
    node_modules/.bin/prisma generate \
      --schema ./node_modules/@signalpilot/database/prisma/schema.prisma

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production
ENV TRADING_WORKER_HEARTBEAT_FILE=/tmp/trading-worker-heartbeat

COPY --from=builder /standalone/trading-worker ./

# No exchange adapter, no API, no dashboard: this process only orchestrates
# the shadow strategy/risk/simulation/portfolio jobs on a schedule and never
# runs a migration on normal startup (docs/trading P5, "Docker und Betrieb").
CMD ["node", "dist/index.js"]
