# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

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
