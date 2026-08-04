# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo

# Copy the full monorepo (node_modules, .next, dist excluded via .dockerignore)
COPY . .

# Install all dependencies (dev + prod — needed to build TypeScript)
RUN pnpm install --frozen-lockfile

# Build the API together with its COMPLETE workspace dependency closure, in
# pnpm's topological order (dependencies first).
#
# The trailing "..." is load-bearing: `--filter "<pkg>..."` selects <pkg> plus
# everything it depends on. The previous `-r --filter "./packages/**"` selected
# only packages/, which silently excluded `apps/trading-worker` — and the API
# imports its export paths (`@signalpilot/trading-worker/lib/tradingSafety`,
# `/jobs/*`, ...). Locally that resolved against a stale `dist/` left over from
# an earlier host build; inside Docker `.dockerignore` strips every `dist/`, so
# the API compile failed with TS2307 and took the migrate target down with it.
#
# Expressing this as a dependency closure rather than a hand-maintained list of
# build steps means a future workspace dependency is picked up automatically
# instead of reintroducing exactly this bug. Prisma generate still runs here
# (it is `@signalpilot/database`'s own build script) and therefore still
# produces the linux engine binary.
RUN pnpm --filter "@signalpilot/api..." build

# Create a minimal standalone deployment with only production dependencies.
#
# @prisma/client and prisma are declared as direct dependencies of apps/api so
# pnpm deploy creates a root-level node_modules/@prisma/client symlink (not just
# a transitive entry buried in .pnpm/). This is required for two reasons:
#   1. createRequire(import.meta.url)('@prisma/client') in runtime-values.js
#      resolves from /app/dist/ and needs @prisma/client accessible at the root.
#   2. prisma generate (run below) needs @prisma/client at the root level so it
#      can resolve where to write the generated .prisma/client/ directory.
RUN pnpm --filter @signalpilot/api deploy --prod /standalone/api

# Generate the Prisma client inside the deployed standalone.
#
# pnpm deploy copies @prisma/client (the package) but NOT the generated
# .prisma/client/ code — that directory is the output of prisma generate and
# is not tracked as a package. Without this step the runtime throws:
#   @prisma/client did not initialize yet. Please run "prisma generate".
#
# Running from /standalone/api with the schema from the deployed
# @signalpilot/database package ensures prisma generate writes the generated
# client to the correct location inside the deployed .pnpm/ virtual store:
#   node_modules/.pnpm/@prisma+client.../node_modules/.prisma/client/
# That is exactly where @prisma/client/index.js does require('.prisma/client/...').
#
# prisma generate does NOT need a database connection.
RUN cd /standalone/api && \
    node_modules/.bin/prisma generate \
      --schema ./node_modules/@signalpilot/database/prisma/schema.prisma

# ── Migrate (uses full builder with devDeps + Prisma CLI) ─────────────────────
#
# This target deliberately keeps the builder's devDependencies: `prisma` is a
# devDependency and `db:migrate:deploy` needs the CLI plus the migration files.
# It is a run-on-demand ops image (Compose profile `migration`), never a
# long-running service, so its size is not a runtime cost. The lean, prod-only
# image is `runtime` below.
FROM builder AS migrate

WORKDIR /repo
ENV NODE_ENV=production

CMD ["pnpm", "db:migrate:deploy"]

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /standalone/api ./

EXPOSE 3100

USER node

CMD ["node", "dist/index.js"]
