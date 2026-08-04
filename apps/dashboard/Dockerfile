# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Build-time configuration only.
#
# Next.js inlines every NEXT_PUBLIC_* value into the client bundle at BUILD
# time, so these must be build args — setting them at container start has no
# effect on an already-compiled bundle. That also means only values which are
# safe to ship to a browser may appear here: never a secret, never a private
# server variable. SIGNALPILOT_API_INTERNAL_URL is not NEXT_PUBLIC_* and stays
# server-side (it is read in next.config.ts for the rewrite target).
ARG NEXT_PUBLIC_SIGNALPILOT_API_URL=/api
ARG SIGNALPILOT_API_INTERNAL_URL=http://api:3100
# Shadow trading dashboard. Defaults to false: an image built without an
# explicit opt-in has no trading navigation and no reachable
# /dashboard/trading/* page (docs/trading P7).
ARG NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED=false

ENV NEXT_PUBLIC_SIGNALPILOT_API_URL=${NEXT_PUBLIC_SIGNALPILOT_API_URL}
ENV SIGNALPILOT_API_INTERNAL_URL=${SIGNALPILOT_API_INTERNAL_URL}
ENV NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED=${NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED}

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo

# Copy the full monorepo (node_modules, .next, dist excluded via .dockerignore)
COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @signalpilot/dashboard build

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# In a pnpm monorepo, Next.js standalone traces back to the repo root,
# so server.js lives at apps/dashboard/server.js within the bundle.
COPY --from=builder /repo/apps/dashboard/.next/standalone ./
# Static assets — must sit next to the traced server.js
COPY --from=builder /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
# Public files
COPY --from=builder /repo/apps/dashboard/public ./apps/dashboard/public

EXPOSE 3000

USER node

CMD ["node", "apps/dashboard/server.js"]
