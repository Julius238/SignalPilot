---
name: project-deployment
description: Deployment & Operations v1 — Docker Compose, Dockerfiles, ops scripts, health endpoint, safety check
metadata:
  type: project
---

Deployment & Operations v1 implemented (2026-05-22).

**Docker setup:**
- `apps/api/Dockerfile` — multi-stage (builder → migrate → runtime); pnpm deploy --prod; `node dist/index.js`
- `apps/dashboard/Dockerfile` — multi-stage; Next.js standalone output at `apps/dashboard/server.js` relative to bundle root
- `apps/worker/Dockerfile` — multi-stage; pnpm deploy --prod; `node dist/scheduler.js`
- `docker-compose.prod.yml` — postgres, redis, api (loopback:3100), dashboard (:3000), worker-scheduler; migrate profile for migrations
- `.dockerignore` — excludes node_modules, dist, .next, .env.*, backups

**Operations scripts:**
- All in `scripts/ops/` — prod-build, prod-up, prod-down, prod-logs, prod-migrate, backup-postgres, restore-postgres, healthcheck
- Root package.json: `ops:prod:build`, `ops:prod:up`, `ops:prod:down`, `ops:prod:logs`, `ops:prod:ps`, `ops:prod:migrate`, `ops:prod:backup`, `ops:prod:restore`, `ops:prod:health`

**Safety check:**
- `apps/api/src/lib/safety.ts` + `apps/worker/src/lib/safety.ts` — `assertProductionSafety()` calls process.exit(1) if ENABLE_LIVE_TRADING=true
- Called in API startup (`apps/api/src/index.ts`) and worker scheduler (`apps/worker/src/scheduler.ts`)

**Health endpoints:**
- `GET /health` — public, returns status+uptime
- `GET /health/deep` — protected (requireAdmin), checks DB latency + redis config

**Next.js standalone note:**
- `output: 'standalone'` in next.config.ts
- In pnpm monorepo, standalone output structure: `.next/standalone/apps/dashboard/server.js`
- Dockerfile copies static to `./apps/dashboard/.next/static` and public to `./apps/dashboard/public`

**Migration:**
- `packages/database/package.json` has `prisma:migrate:deploy` script
- Migrate runs via docker compose --profile migration run --rm migrate
- NEVER use prisma migrate dev in production

**DB backup/restore:**
- pg_dump -Fc (custom format) via `docker compose exec -T`
- Restore uses pg_restore --clean --if-exists; requires explicit "yes" confirmation
- backups/ directory in repo with .gitkeep; *.dump gitignored

**Prisma Docker fix v2 (2026-05-23) — definitive:**
- Root cause: pnpm uses strict non-hoisting. `@prisma/client` is a transitive dep (via `@signalpilot/database`) so pnpm deploy puts it only in `.pnpm/` virtual store, NOT as a root-level symlink. `createRequire(import.meta.url)('@prisma/client')` from `/app/dist/` can't find it. Also, `@prisma/client` ships without the generated `.prisma/client/` code — that directory is the output of `prisma generate` (not in the content-addressable store), so pnpm deploy never copies it. Result: "did not initialize yet" + "Cannot find module '@prisma/client'".
- Fix: Add `@prisma/client` and `prisma` as DIRECT deps to both `apps/api/package.json` and `apps/worker/package.json`. pnpm deploy then creates root-level symlinks. After deploy, run `node_modules/.bin/prisma generate --schema ./node_modules/@signalpilot/database/prisma/schema.prisma` from within the standalone. Prisma 6.19+ writes the generated client to `.pnpm/@prisma+client.../node_modules/.prisma/client/` — exactly where `@prisma/client/index.js` does `require('.prisma/client/default')`.
- `packages/database/package.json` has `prisma` moved from devDeps to deps (also direct dep of api/worker for standalone access).
- Smoke test: `scripts/ops/prisma-smoke.sh` (`pnpm ops:prod:prisma-smoke`) — no DB needed.

**Prisma ESM fix (2026-05-22):**
- Root cause: `@prisma/client/default.js` is `module.exports = { ...require(...) }` — Node.js ESM cannot statically analyze spread-require exports, so `export { X } from "@prisma/client"` fails at runtime in pnpm deploy --prod Docker builds.
- Fix: `packages/database/src/runtime-values.ts` uses `createRequire` to load @prisma/client as CJS. `src/index.ts` re-exports from runtime-values. `src/types.ts` re-exports from @prisma/client for proper TypeScript enum+namespace types. `package.json` exports routes TypeScript to `dist/types.d.ts` and Node.js to `dist/index.js`.
- Test: `packages/database/test/esm-exports.test.ts` — 8 smoke tests verifying enum values accessible at runtime.

**Why:** Private alpha, no cloud lock-in, single VPS or local Docker Compose.
