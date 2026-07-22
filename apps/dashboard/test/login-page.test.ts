import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("login page dev login", () => {
  it("posts the regular login with included credentials", async () => {
    const source = await readFile(resolve(appDir, "src/app/login/page.tsx"), "utf8");

    assert.match(source, /\/auth\/login/);
    assert.match(source, /method: "POST"/);
    assert.match(source, /credentials: "include"/);
    assert.match(source, /username: formData\.get\("username"\)/);
    assert.match(source, /password: formData\.get\("password"\)/);
  });

  it("loads auth status and only renders the dev button from devLoginEnabled", async () => {
    const source = await readFile(resolve(appDir, "src/app/login/page.tsx"), "utf8");

    assert.match(source, /\/auth\/status/);
    assert.match(source, /setDevLoginEnabled\(status\.devLoginEnabled === true\)/);
    assert.match(source, /devLoginEnabled \? \(/);
    assert.match(source, /Continue in Dev Mode/);
  });

  it("posts dev login with included credentials", async () => {
    const source = await readFile(resolve(appDir, "src/app/login/page.tsx"), "utf8");

    assert.match(source, /\/auth\/dev-login/);
    assert.match(source, /method: "POST"/);
    assert.match(source, /credentials: "include"/);
    assert.match(source, /router\.replace\("\/dashboard"\)/);
  });
});

describe("production API routing", () => {
  it("uses a same-origin browser fallback and an internal server URL", async () => {
    const source = await readFile(resolve(appDir, "src/lib/api-url.ts"), "utf8");

    assert.match(source, /DEFAULT_BROWSER_API_URL = "\/api"/);
    assert.match(source, /NEXT_PUBLIC_SIGNALPILOT_API_URL/);
    assert.match(source, /SIGNALPILOT_API_INTERNAL_URL/);
    assert.doesNotMatch(source, /localhost:3100/);
  });

  it("rewrites same-origin API requests to the configured internal API", async () => {
    const source = await readFile(resolve(appDir, "next.config.ts"), "utf8");

    assert.match(source, /source: "\/api\/:path\*"/);
    assert.ok(source.includes('destination: `${internalApiUrl}/:path*`'));
  });

  it("passes the public API URL into the Docker build", async () => {
    const dockerfile = await readFile(resolve(appDir, "Dockerfile"), "utf8");
    const compose = await readFile(resolve(appDir, "../../docker-compose.prod.yml"), "utf8");

    assert.match(dockerfile, /ARG NEXT_PUBLIC_SIGNALPILOT_API_URL=\/api/);
    assert.match(dockerfile, /ENV NEXT_PUBLIC_SIGNALPILOT_API_URL=/);
    assert.match(compose, /NEXT_PUBLIC_SIGNALPILOT_API_URL: \$\{NEXT_PUBLIC_SIGNALPILOT_API_URL:-\/api\}/);
  });

  it("disables dashboard cookie enforcement when API auth is disabled", async () => {
    const source = await readFile(resolve(appDir, "src/middleware.ts"), "utf8");

    assert.match(source, /process\.env\.API_AUTH_ENABLED !== "false"/);
    assert.match(source, /process\.env\.DASHBOARD_AUTH_ENABLED !== "false"/);
  });

  it("keeps the login page reachable so an invalid stale cookie can be replaced", async () => {
    const source = await readFile(resolve(appDir, "src/middleware.ts"), "utf8");

    assert.doesNotMatch(source, /isLoginPage && hasSession/);
  });
});
