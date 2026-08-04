# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo

COPY . .

RUN pnpm install --frozen-lockfile

# Build the worker together with its complete workspace dependency closure, in
# pnpm's topological order. Same `<pkg>...` filter as apps/api/Dockerfile — see
# the long note there. Prisma generate runs as part of
# `@signalpilot/database`'s own build, so the linux engine binary is still
# produced here.
RUN pnpm --filter "@signalpilot/worker..." build

# Create a minimal standalone deployment with only production dependencies.
# @prisma/client and prisma are direct deps so pnpm deploy includes them with
# root-level node_modules symlinks. See apps/api/Dockerfile for full explanation.
RUN pnpm --filter @signalpilot/worker deploy --prod /standalone/worker

# Generate the Prisma client inside the deployed standalone.
# See apps/api/Dockerfile for the full explanation.
RUN cd /standalone/worker && \
    node_modules/.bin/prisma generate \
      --schema ./node_modules/@signalpilot/database/prisma/schema.prisma

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /standalone/worker ./

# Worker runs the long-lived scheduler process
CMD ["node", "dist/scheduler.js"]
