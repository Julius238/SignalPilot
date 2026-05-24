import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("login page dev login", () => {
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
