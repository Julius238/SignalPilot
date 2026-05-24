# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /repo

# Copy the full monorepo (node_modules, .next, dist excluded via .dockerignore)
COPY . .

# Install all dependencies (dev + prod — needed to build TypeScript)
RUN pnpm install --frozen-lockfile

# Build: packages first (Prisma generate runs here for the correct linux binary),
# then the API
RUN pnpm -r --filter "./packages/**" build
RUN pnpm --filter @signalpilot/api build

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
FROM builder AS migrate

WORKDIR /repo
ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@signalpilot/database", "run", "prisma:migrate:deploy"]

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /standalone/api ./

EXPOSE 3100

USER node

CMD ["node", "dist/index.js"]
