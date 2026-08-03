/**
 * Double-submit CSRF protection for `/trading/operations/*` only.
 *
 * The app has no existing CSRF mechanism to reuse (auth relies solely on
 * `sameSite: "lax"` cookies + CORS restricted to `DASHBOARD_ORIGIN` — see
 * `server.ts`/`auth/session.ts`). That baseline already blocks a classic
 * cross-site form POST from attaching the session cookie at all, but the
 * trading operations are high-stakes enough (kill switch, session
 * activation, manual position close) to warrant a second, explicit layer
 * rather than relying only on `SameSite`.
 *
 * `GET /trading/csrf-token` (admin-only) issues a random token and sets it
 * as a non-httpOnly cookie the client can read and echo back. Every
 * `/trading/operations/*` route then requires the `x-trading-csrf-token`
 * header to match that cookie's current value — a cross-site attacker can
 * read neither, so it cannot forge a match.
 */

import { randomBytes } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

const CSRF_HEADER_NAME = "x-trading-csrf-token";

export function getTradingCsrfCookieName(): string {
  return process.env.TRADING_CSRF_COOKIE_NAME ?? "signalpilot_trading_csrf";
}

export function issueTradingCsrfToken(reply: FastifyReply): string {
  const token = randomBytes(32).toString("hex");
  reply.setCookie(getTradingCsrfCookieName(), token, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.AUTH_COOKIE_SECURE === "true",
    path: "/",
    maxAge: 3600
  });
  return token;
}

export async function requireTradingCsrf(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookieValue = request.cookies?.[getTradingCsrfCookieName()];
  const headerValue = request.headers[CSRF_HEADER_NAME];
  const header = typeof headerValue === "string" ? headerValue : undefined;

  if (!cookieValue || !header || cookieValue !== header) {
    await reply.code(403).send({ error: "Forbidden", message: "Missing or invalid CSRF token." });
  }
}
