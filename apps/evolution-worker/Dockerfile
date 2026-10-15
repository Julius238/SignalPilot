# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo

COPY . .

RUN pnpm install --frozen-lockfile

# The evolution worker and its workspace dependency closure (`<pkg>...`), in
# pnpm's topological order — same pattern as the other app images.
RUN pnpm --filter "@signalpilot/evolution-worker..." build

RUN pnpm --filter @signalpilot/evolution-worker deploy --prod /standalone/evolution-worker

RUN cd /standalone/evolution-worker && \
    node_modules/.bin/prisma generate \
      --schema ./node_modules/@signalpilot/database/prisma/schema.prisma

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production
ENV TZ=UTC
ENV EVOLUTION_HEARTBEAT_FILE=/tmp/evolution-worker-heartbeat
ENV EVOLUTION_SNAPSHOT_DIR=/data/market-snapshots

COPY --from=builder --chown=root:root /standalone/evolution-worker ./

# Historical research only (docs/trading/20-evolution-engine.md): no exchange
# adapter, no trading path, no Docker access. Runs as the unprivileged `node`
# user; the code directory stays owned by root and is not writable.
USER node

CMD ["node", "dist/index.js"]
