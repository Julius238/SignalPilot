---
name: project-overview
description: SignalPilot monorepo structure, stack, and key constraints
metadata:
  type: project
---

SignalPilot is a multi-asset market intelligence platform (stocks, ETFs, crypto) — no real trades, no broker code.

**Stack:** pnpm monorepo · Fastify v5 API (port 3100) · Next.js 15 App Router dashboard (port 3000) · Prisma 6 / PostgreSQL · Node.js native test runner

**Monorepo layout:**
- `apps/api` — Fastify API, all routes in `src/routes/dashboard.ts` (3k+ lines)
- `apps/dashboard` — Next.js, server components call `fetchApi`, client components call `mutateApi`
- `apps/worker` — background job scripts
- `packages/database` — Prisma schema + generated client

**Why:** No live trading, private internal use only.
**How to apply:** Keep all code changes within this structure; no broker/trade/buy/sell code.
