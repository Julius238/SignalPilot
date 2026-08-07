import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { redirectAfterLogin, type LoginRouter } from "../src/lib/login-redirect";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("login page dev login", () => {
  it("posts the regular login with included credentials", async () => {
    const source = await readFile(resolve(appDir, "src/app/login/page.tsx"), "utf8");

    assert.match(source, /\/auth\/login/);
    assert.match(source, /method: "POST"/);
    assert.match(source, /credentials: "include"/);
    assert.match(source, /username: formData\.get\("username"\)/);
    assert.match(source, /password: formData\.get\("password"\)/);
    assert.match(source, /redirectToDashboard\(\)/);
    assert.match(source, /Benutzername oder Passwort stimmt nicht/);
  });

  it("redirects authenticated sessions and only renders the dev button when enabled", async () => {
    const source = await readFile(resolve(appDir, "src/app/login/page.tsx"), "utf8");

    assert.match(source, /\/auth\/status/);
    assert.match(source, /cache: "no-store"/);
    assert.match(source, /status\.authenticated === true/);
    assert.match(source, /redirectToDashboard\(\)/);
    assert.match(source, /setDevLoginEnabled\(status\.devLoginEnabled === true\)/);
    assert.match(source, /devLoginEnabled \? \(/);
    assert.match(source, /Ohne Anmeldung fortfahren \(nur lokale Entwicklung\)/);
  });

  it("is written in German and marks the dev entry as the secondary path", async () => {
    const source = await readFile(resolve(appDir, "src/app/login/page.tsx"), "utf8");

    // Die Seite trug als einzige der Anwendung noch englische Oberflächentexte.
    assert.match(source, /Zum Fortfahren bitte anmelden/);
    assert.match(source, /Benutzername/);
    assert.match(source, /Passwort/);
    assert.match(source, /Anmelden/);
    assert.doesNotMatch(source, /Sign in/);
    assert.doesNotMatch(source, /Continue in Dev Mode/);
    assert.doesNotMatch(source, /Unable to reach API/);
    assert.doesNotMatch(source, /Dev login is not available/);

    // Labels über den Feldern, gleiche Breite, Dev-Zugang als Textlink.
    assert.match(source, /className="login-label"/);
    assert.match(source, /htmlFor="login-username"/);
    assert.match(source, /htmlFor="login-password"/);
    assert.match(source, /className="dev-login-link"/);
    assert.doesNotMatch(source, /className="dev-login-button"/);

    const css = await readFile(resolve(appDir, "src/app/globals.css"), "utf8");
    assert.match(css, /\.login-form input\s*\{[^}]*width:\s*100%/);
    assert.match(css, /\.dev-login-link\s*\{/);
  });

  it("posts dev login with included credentials", async () => {
    const source = await readFile(resolve(appDir, "src/app/login/page.tsx"), "utf8");

    assert.match(source, /\/auth\/dev-login/);
    assert.match(source, /method: "POST"/);
    assert.match(source, /credentials: "include"/);
    assert.match(source, /redirectToDashboard\(\)/);
  });

  it("clears the login UI while the successful redirect is being committed", async () => {
    const source = await readFile(resolve(appDir, "src/app/login/page.tsx"), "utf8");

    assert.match(source, /setPending\(false\)/);
    assert.match(source, /setDevPending\(false\)/);
    assert.match(source, /setRedirecting\(true\)/);
    assert.match(source, /if \(redirecting\) return null/);
  });

  it("replaces the login history entry and refreshes the authenticated route", () => {
    const calls: string[] = [];
    const router: LoginRouter = {
      replace(href) {
        calls.push(`replace:${href}`);
      },
      refresh() {
        calls.push("refresh");
      }
    };

    redirectAfterLogin(router);

    assert.deepEqual(calls, ["replace:/dashboard", "refresh"]);
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
