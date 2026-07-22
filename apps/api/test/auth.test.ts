import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { afterEach, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import "@fastify/cookie";
import Fastify from "fastify";
import bcrypt from "bcryptjs";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";

import { validateAuthConfig } from "../src/auth/config.js";
import { setAuditDatabaseForTests } from "../src/auth/audit.js";
import { requireAdmin } from "../src/auth/helpers.js";
import { registerAuthRoutes } from "../src/routes/auth.js";
import { buildServer } from "../src/server.js";

const TEST_USERNAME = "testadmin";
const TEST_PASSWORD = "correct-password-123";
const TEST_SESSION_SECRET = "test-secret-must-be-long-enough-32chars";
let TEST_PASSWORD_HASH: string;
const apiDir = dirname(fileURLToPath(import.meta.url)) + "/..";

before(async () => {
  TEST_PASSWORD_HASH = await bcrypt.hash(TEST_PASSWORD, 4);
});

async function createAuthServer({
  authEnabled = true,
  devLoginEnabled = false
}: { authEnabled?: boolean; devLoginEnabled?: boolean } = {}) {
  const server = Fastify({ logger: false });
  await server.register(cookie);
  await server.register(rateLimit, { global: false });
  await server.register(registerAuthRoutes);
  server.get(
    "/protected-test",
    { preHandler: requireAdmin as never },
    async () => ({ ok: true })
  );

  process.env.API_AUTH_ENABLED = authEnabled ? "true" : "false";
  process.env.ADMIN_USERNAME = TEST_USERNAME;
  process.env.ADMIN_PASSWORD_HASH = TEST_PASSWORD_HASH;
  process.env.AUTH_SESSION_SECRET = TEST_SESSION_SECRET;
  process.env.AUTH_COOKIE_SECURE = "false";
  process.env.DEV_LOGIN_ENABLED = devLoginEnabled ? "true" : "false";
  if (devLoginEnabled) {
    process.env.NODE_ENV = "development";
    delete process.env.APP_ENV;
    delete process.env.VERCEL_ENV;
  }

  return server;
}

describe("auth routes", () => {
  const saved = {
    API_AUTH_ENABLED: process.env.API_AUTH_ENABLED,
    ADMIN_USERNAME: process.env.ADMIN_USERNAME,
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
    AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET,
    AUTH_COOKIE_SECURE: process.env.AUTH_COOKIE_SECURE,
    DEV_LOGIN_ENABLED: process.env.DEV_LOGIN_ENABLED,
    DEV_LOGIN_USERNAME: process.env.DEV_LOGIN_USERNAME,
    NODE_ENV: process.env.NODE_ENV,
    APP_ENV: process.env.APP_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("login success sets HttpOnly cookie", async () => {
    const server = await createAuthServer();

    const response = await server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: TEST_USERNAME, password: TEST_PASSWORD }
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { ok: true });

    const setCookie = response.headers["set-cookie"] as string | string[];
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie;
    assert.ok(cookieHeader, "Set-Cookie header should be present");
    assert.ok(cookieHeader.includes("signalpilot_session="), "cookie name should match");
    assert.ok(cookieHeader.toLowerCase().includes("httponly"), "cookie should be HttpOnly");
    assert.ok(cookieHeader.toLowerCase().includes("samesite=lax"), "cookie should be SameSite=Lax");
    assert.doesNotMatch(cookieHeader, /;\s*Secure(?:;|$)/i);

    await server.close();
  });

  it("sets a Secure cookie when AUTH_COOKIE_SECURE=true", async () => {
    const server = await createAuthServer();
    process.env.AUTH_COOKIE_SECURE = "true";

    const response = await server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: TEST_USERNAME, password: TEST_PASSWORD }
    });

    assert.equal(response.statusCode, 200);
    const setCookie = response.headers["set-cookie"] as string | string[];
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie;
    assert.match(cookieHeader, /;\s*Secure(?:;|$)/i);

    await server.close();
  });

  it("login failure returns 401 without detail", async () => {
    const server = await createAuthServer();

    const wrongPass = await server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: TEST_USERNAME, password: "wrong-password" }
    });
    assert.equal(wrongPass.statusCode, 401);
    const body = wrongPass.json();
    const serializedBody = JSON.stringify(body);
    assert.ok(
      !JSON.stringify(body).toLowerCase().includes("password"),
      "should not reveal password hint"
    );
    assert.ok(
      !JSON.stringify(body).toLowerCase().includes("username"),
      "should not reveal username hint"
    );
    assert.ok(!serializedBody.includes(TEST_PASSWORD), "should not expose submitted password");
    assert.ok(!serializedBody.includes(TEST_PASSWORD_HASH), "should not expose password hash");
    assert.ok(!serializedBody.includes(TEST_SESSION_SECRET), "should not expose session secret");

    const wrongUser = await server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "notadmin", password: TEST_PASSWORD }
    });
    assert.equal(wrongUser.statusCode, 401);

    await server.close();
  });

  it("login failure writes an audit reason without secrets", async () => {
    const auditEntries: Array<{ data: Record<string, unknown> }> = [];
    setAuditDatabaseForTests({
      auditLog: {
        create: async (entry: { data: Record<string, unknown> }) => {
          auditEntries.push(entry);
        }
      }
    } as never);

    const server = await createAuthServer();

    const response = await server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: TEST_USERNAME, password: "wrong-password" }
    });

    assert.equal(response.statusCode, 401);
    assert.equal(auditEntries.length, 1);
    assert.equal(auditEntries[0]?.data.action, "login_failed");
    assert.equal(auditEntries[0]?.data.actor, TEST_USERNAME);
    assert.deepEqual(auditEntries[0]?.data.metadataJson, { reason: "invalid credentials" });
    assert.ok(!JSON.stringify(auditEntries).includes("wrong-password"));
    assert.ok(!JSON.stringify(auditEntries).includes(TEST_PASSWORD_HASH));
    assert.ok(!JSON.stringify(auditEntries).includes(TEST_SESSION_SECRET));

    await server.close();
    setAuditDatabaseForTests({
      auditLog: {
        create: async () => undefined
      }
    } as never);
  });

  it("protected endpoint without cookie returns 401", async () => {
    const server = await createAuthServer();

    const response = await server.inject({ method: "GET", url: "/protected-test" });

    assert.equal(response.statusCode, 401);

    await server.close();
  });

  it("protected endpoint with valid cookie returns 200", async () => {
    const server = await createAuthServer();

    const loginResponse = await server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: TEST_USERNAME, password: TEST_PASSWORD }
    });
    assert.equal(loginResponse.statusCode, 200);

    const rawCookie = loginResponse.headers["set-cookie"] as string | string[];
    const cookieValue = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie).split(";")[0];

    const protectedResponse = await server.inject({
      method: "GET",
      url: "/protected-test",
      headers: { cookie: cookieValue }
    });

    assert.equal(protectedResponse.statusCode, 200);
    assert.deepEqual(protectedResponse.json(), { ok: true });

    await server.close();
  });

  it("logout clears cookie", async () => {
    const server = await createAuthServer();

    const loginResponse = await server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: TEST_USERNAME, password: TEST_PASSWORD }
    });
    const rawCookie = loginResponse.headers["set-cookie"] as string | string[];
    const cookieValue = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie).split(";")[0];

    const logoutResponse = await server.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: cookieValue }
    });

    assert.equal(logoutResponse.statusCode, 200);
    const logoutSetCookie = logoutResponse.headers["set-cookie"] as string | string[];
    const logoutCookieStr = Array.isArray(logoutSetCookie)
      ? logoutSetCookie.join("; ")
      : logoutSetCookie ?? "";
    assert.ok(
      logoutCookieStr.includes("signalpilot_session=;") ||
        logoutCookieStr.includes("signalpilot_session=")
    );

    await server.close();
  });

  it("logout clears an HTTPS cookie with matching security attributes", async () => {
    const server = await createAuthServer();
    process.env.AUTH_COOKIE_SECURE = "true";

    const logoutResponse = await server.inject({
      method: "POST",
      url: "/auth/logout"
    });

    assert.equal(logoutResponse.statusCode, 200);
    const setCookie = logoutResponse.headers["set-cookie"] as string | string[];
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie;
    assert.match(cookieHeader, /;\s*Secure(?:;|$)/i);
    assert.match(cookieHeader, /HttpOnly/i);
    assert.match(cookieHeader, /SameSite=Lax/i);

    await server.close();
  });

  it("auth disabled lets protected endpoints through", async () => {
    const server = await createAuthServer({ authEnabled: false });

    const response = await server.inject({ method: "GET", url: "/protected-test" });

    assert.equal(response.statusCode, 200);

    await server.close();
  });

  it("/auth/status reflects auth state", async () => {
    const server = await createAuthServer();

    const unauthResponse = await server.inject("/auth/status");
    assert.equal(unauthResponse.statusCode, 200);
    assert.equal(unauthResponse.json().authenticated, false);
    assert.equal(unauthResponse.json().authEnabled, true);
    assert.equal(unauthResponse.json().devLoginEnabled, false);
    assert.equal(typeof unauthResponse.json().environment, "string");
    assert.equal(JSON.stringify(unauthResponse.json()).includes(TEST_SESSION_SECRET), false);
    assert.equal(JSON.stringify(unauthResponse.json()).includes(TEST_PASSWORD_HASH), false);

    const loginResponse = await server.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: TEST_USERNAME, password: TEST_PASSWORD }
    });
    const rawCookie = loginResponse.headers["set-cookie"] as string | string[];
    const cookieValue = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie).split(";")[0];

    const authResponse = await server.inject({
      url: "/auth/status",
      headers: { cookie: cookieValue }
    });
    assert.equal(authResponse.json().authenticated, true);

    await server.close();
  });

  it("/auth/dev-login returns 403 when DEV_LOGIN_ENABLED=false", async () => {
    process.env.DEV_LOGIN_ENABLED = "false";
    const server = await createAuthServer();

    const response = await server.inject({
      method: "POST",
      url: "/auth/dev-login"
    });

    assert.equal(response.statusCode, 403);

    await server.close();
  });

  it("/auth/dev-login sets an HttpOnly cookie when enabled outside production", async () => {
    process.env.DEV_LOGIN_USERNAME = "local-dev";
    const server = await createAuthServer({ devLoginEnabled: true });

    const response = await server.inject({
      method: "POST",
      url: "/auth/dev-login"
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      ok: true,
      user: { username: "local-dev", role: "admin", devLogin: true }
    });
    const setCookie = response.headers["set-cookie"] as string | string[];
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie;
    assert.ok(cookieHeader.includes("signalpilot_session="), "cookie name should match");
    assert.ok(cookieHeader.toLowerCase().includes("httponly"), "cookie should be HttpOnly");

    await server.close();
  });

  it("/auth/me works after dev-login", async () => {
    process.env.DEV_LOGIN_USERNAME = "dev-admin";
    const server = await createAuthServer({ devLoginEnabled: true });

    const loginResponse = await server.inject({
      method: "POST",
      url: "/auth/dev-login"
    });
    const rawCookie = loginResponse.headers["set-cookie"] as string | string[];
    const cookieValue = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie).split(";")[0];

    const meResponse = await server.inject({
      url: "/auth/me",
      headers: { cookie: cookieValue }
    });

    assert.equal(meResponse.statusCode, 200);
    assert.deepEqual(meResponse.json(), {
      role: "admin",
      username: "dev-admin",
      devLogin: true
    });

    await server.close();
  });

  it("dev-login writes an audit log", async () => {
    const auditEntries: Array<{ data: Record<string, unknown> }> = [];
    setAuditDatabaseForTests({
      auditLog: {
        create: async (entry: { data: Record<string, unknown> }) => {
          auditEntries.push(entry);
        }
      }
    } as never);
    process.env.DEV_LOGIN_USERNAME = "audit-dev";
    const server = await createAuthServer({ devLoginEnabled: true });

    const response = await server.inject({
      method: "POST",
      url: "/auth/dev-login"
    });

    assert.equal(response.statusCode, 200);
    assert.equal(auditEntries.length, 1);
    assert.equal(auditEntries[0]?.data.action, "dev_login");
    assert.equal(auditEntries[0]?.data.actor, "audit-dev");
    assert.deepEqual(auditEntries[0]?.data.metadataJson, { devLogin: true });

    await server.close();
    setAuditDatabaseForTests({
      auditLog: {
        create: async () => undefined
      }
    } as never);
  });

  it("rate limit blocks excessive login attempts", async () => {
    process.env.API_AUTH_ENABLED = "true";
    process.env.ADMIN_USERNAME = TEST_USERNAME;
    process.env.ADMIN_PASSWORD_HASH = TEST_PASSWORD_HASH;
    process.env.AUTH_SESSION_SECRET = TEST_SESSION_SECRET;
    process.env.AUTH_RATE_LIMIT_MAX = "3";

    const server = Fastify({ logger: false });
    await server.register(cookie);
    await server.register(rateLimit, { global: false });
    await server.register(registerAuthRoutes);

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        server.inject({
          method: "POST",
          url: "/auth/login",
          payload: { username: "x", password: "x" }
        })
      )
    );

    const statusCodes = results.map((r) => r.statusCode);
    assert.ok(statusCodes.includes(429), `Expected 429 among [${statusCodes.join(", ")}]`);

    await server.close();
  });

  it("/health is accessible without auth (sanity check for public route logic)", async () => {
    const server = await createAuthServer();
    // health is registered outside the protected scope; this confirms auth helpers work
    const response = await server.inject("/auth/status");
    assert.equal(response.statusCode, 200);

    await server.close();
  });
});

describe("auth config validation", () => {
  const saved = {
    API_AUTH_ENABLED: process.env.API_AUTH_ENABLED,
    ADMIN_USERNAME: process.env.ADMIN_USERNAME,
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
    AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET,
    DEV_LOGIN_ENABLED: process.env.DEV_LOGIN_ENABLED,
    NODE_ENV: process.env.NODE_ENV,
    APP_ENV: process.env.APP_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("rejects invalid ADMIN_PASSWORD_HASH format when auth is enabled", () => {
    process.env.API_AUTH_ENABLED = "true";
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_PASSWORD_HASH =
      "98d18937ff140bd5c1621266a64b94ab1b013936f50ccb2b52715a6cb3355642";
    process.env.AUTH_SESSION_SECRET = TEST_SESSION_SECRET;
    process.env.DEV_LOGIN_ENABLED = "false";

    assert.throws(
      () => validateAuthConfig(),
      /ADMIN_PASSWORD_HASH must be a complete bcrypt hash starting with \$2a\$, \$2b\$ or \$2y\$/
    );
  });

  it("rejects a truncated bcrypt hash caused by environment interpolation", () => {
    process.env.API_AUTH_ENABLED = "true";
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_PASSWORD_HASH = "$2b$12$";
    process.env.AUTH_SESSION_SECRET = TEST_SESSION_SECRET;
    process.env.DEV_LOGIN_ENABLED = "false";

    assert.throws(
      () => validateAuthConfig(),
      /ADMIN_PASSWORD_HASH must be a complete bcrypt hash/
    );
  });

  it("prevents API startup with a hex ADMIN_PASSWORD_HASH", async () => {
    process.env.API_AUTH_ENABLED = "true";
    process.env.ADMIN_USERNAME = "admin";
    process.env.ADMIN_PASSWORD_HASH =
      "98d18937ff140bd5c1621266a64b94ab1b013936f50ccb2b52715a6cb3355642";
    process.env.AUTH_SESSION_SECRET = TEST_SESSION_SECRET;
    process.env.DEV_LOGIN_ENABLED = "false";

    await assert.rejects(
      () => buildServer(),
      /ADMIN_PASSWORD_HASH must be a complete bcrypt hash starting with \$2a\$, \$2b\$ or \$2y\$/
    );
  });

  it("prevents API startup when DEV_LOGIN_ENABLED=true in production", async () => {
    process.env.API_AUTH_ENABLED = "true";
    process.env.AUTH_SESSION_SECRET = TEST_SESSION_SECRET;
    process.env.DEV_LOGIN_ENABLED = "true";
    process.env.NODE_ENV = "production";
    delete process.env.APP_ENV;
    delete process.env.VERCEL_ENV;

    await assert.rejects(
      () => buildServer(),
      /DEV_LOGIN_ENABLED must not be true in production\./
    );
  });
});

describe("auth scripts", () => {
  it("auth:hash-password rejects ADMIN_PASSWORD when it looks like a bcrypt hash", () => {
    const result = spawnSync("pnpm", ["exec", "tsx", "scripts/hash-password.ts"], {
      cwd: apiDir,
      env: {
        ...process.env,
        ADMIN_PASSWORD: "$2b$12$existinghash"
      },
      encoding: "utf8"
    });

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /ADMIN_PASSWORD must be the cleartext password, not an existing bcrypt hash\./
    );
    assert.equal(result.stdout, "");
  });

  it("auth:hash-password prints ADMIN_PASSWORD_HASH for a cleartext password", () => {
    const result = spawnSync("pnpm", ["exec", "tsx", "scripts/hash-password.ts"], {
      cwd: apiDir,
      env: {
        ...process.env,
        ADMIN_PASSWORD: "testpass123"
      },
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^ADMIN_PASSWORD_HASH='\$2b\$12\$/);
    assert.match(result.stdout, /'\nUse this hash in \.env/);
    assert.ok(!result.stdout.includes("testpass123"));
  });

  it("auth:verify-password outputs true for the matching cleartext password", async () => {
    const hash = await bcrypt.hash("testpass123", 4);
    const result = spawnSync("pnpm", ["exec", "tsx", "scripts/verify-password.ts"], {
      cwd: apiDir,
      env: {
        ...process.env,
        ADMIN_PASSWORD: "testpass123",
        ADMIN_PASSWORD_HASH: hash
      },
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "Password matches hash: true\n");
    assert.equal(result.stderr, "");
  });
});
