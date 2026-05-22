---
name: project-auth
description: Auth & Security v1 — single-admin cookie JWT session, rate limiting, audit logs
metadata:
  type: project
---

Auth & Security v1 implemented (2026-05-22). Single-admin setup for private local use.

**Session:** Signed JWT in HttpOnly cookie (`signalpilot_session`), HS256, TTL configurable via `AUTH_SESSION_TTL_HOURS`.

**Key files:**
- `apps/api/src/auth/session.ts` — JWT sign/verify, getCookieName, isAuthEnabled
- `apps/api/src/auth/helpers.ts` — requireAdmin, getSessionPayload (Fastify hooks)
- `apps/api/src/auth/audit.ts` — logAudit, setAuditDatabaseForTests
- `apps/api/src/routes/auth.ts` — POST /auth/login, POST /auth/logout, GET /auth/me, GET /auth/status
- `apps/api/src/routes/audit-logs.ts` — GET /audit-logs (protected)
- `apps/api/scripts/hash-password.ts` — run via `pnpm auth:hash-password`
- `apps/dashboard/src/middleware.ts` — Next.js edge middleware, cookie-existence check
- `apps/dashboard/src/app/login/page.tsx` — client-side login form

**Protection pattern:** Server.ts wraps dashboard routes in a scoped plugin with onRequest hook; /config/public is skipped. Auth routes have their own unprotected scope.

**API client:** `fetchApi` auto-forwards session cookie server-side via `next/headers`; client-side uses `credentials: 'include'`.

**Env vars:** ADMIN_USERNAME, ADMIN_PASSWORD_HASH, AUTH_SESSION_SECRET, AUTH_COOKIE_NAME, AUTH_COOKIE_SECURE, AUTH_SESSION_TTL_HOURS, API_AUTH_ENABLED, DASHBOARD_AUTH_ENABLED, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW, AUTH_RATE_LIMIT_MAX

**Tests:** `test/auth.test.ts` — 9 auth tests; `test/watchlist.test.ts` sets `API_AUTH_ENABLED=false`.

**DB migration needed:** `pnpm --filter @signalpilot/database prisma:migrate` (adds AuditLog table).

**Why:** Private single-admin platform; no multi-user needed in v1.
