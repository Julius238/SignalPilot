import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { getApiUrl, normalizeApiUrl } from "../src/lib/api-url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appDir, "../..");

describe("Vorlage für die lokale Entwicklung", () => {
  it("liegt im Repo und ist nicht gitignored", async () => {
    const example = await readFile(resolve(appDir, ".env.local.example"), "utf8");
    const gitignore = await readFile(resolve(repoRoot, ".gitignore"), "utf8");

    assert.match(gitignore, /^!\.env\.local\.example$/m);
    assert.ok(example.length > 0);
  });

  it("erklärt beide API-Variablen und warum es zwei sind", async () => {
    const example = await readFile(resolve(appDir, ".env.local.example"), "utf8");

    assert.match(example, /^NEXT_PUBLIC_SIGNALPILOT_API_URL=/m);
    assert.match(example, /^SIGNALPILOT_API_INTERNAL_URL=/m);
    assert.match(example, /relative URL/);
    assert.match(example, /Root-`?\.env`?/);
  });

  it("enthält keine Secrets", async () => {
    const example = await readFile(resolve(appDir, ".env.local.example"), "utf8");

    // Nur Adressen und Schalter — keine Schlüssel, keine Zugangsdaten.
    for (const forbidden of [
      /DATABASE_URL\s*=\s*\S/,
      /FINNHUB_API_KEY\s*=\s*\S/,
      /TELEGRAM_BOT_TOKEN\s*=\s*\S/,
      /_SECRET\s*=\s*\S/,
      /PASSWORD\s*=\s*\S/
    ]) {
      assert.doesNotMatch(example, forbidden, `Secret-Muster in der Vorlage: ${forbidden}`);
    }

    // Trading bleibt in der Vorlage ausgeschaltet.
    assert.doesNotMatch(example, /^NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED=true/m);
  });

  it("bleibt mit der tatsächlich gelesenen Konfiguration synchron", async () => {
    const example = await readFile(resolve(appDir, ".env.local.example"), "utf8");
    const apiUrl = await readFile(resolve(appDir, "src/lib/api-url.ts"), "utf8");

    for (const variable of ["NEXT_PUBLIC_SIGNALPILOT_API_URL", "SIGNALPILOT_API_INTERNAL_URL"]) {
      assert.match(apiUrl, new RegExp(variable), `${variable} wird nicht gelesen`);
      assert.match(example, new RegExp(variable), `${variable} fehlt in der Vorlage`);
    }
  });
});

describe("README dokumentiert den Startweg", () => {
  it("nennt die Vorlage, beide Variablen und corepack", async () => {
    const readme = await readFile(resolve(repoRoot, "README.md"), "utf8");

    assert.match(readme, /cp apps\/dashboard\/\.env\.local\.example apps\/dashboard\/\.env\.local/);
    assert.match(readme, /SIGNALPILOT_API_INTERNAL_URL/);
    assert.match(readme, /does not read the repository root `\.env`/);
    assert.match(readme, /corepack pnpm install/);
  });

  it("beschreibt genau den Startweg, der auch funktioniert", async () => {
    const readme = await readFile(resolve(repoRoot, "README.md"), "utf8");

    // Die vier dokumentierten Befehle müssen ohne Zusatzschritt laufen.
    for (const command of [
      "corepack pnpm install",
      "corepack pnpm test",
      "corepack pnpm lint",
      "corepack pnpm build"
    ]) {
      assert.match(readme, new RegExp(command.replace(/\s+/g, "\\s+")), `${command} fehlt`);
    }

    // Kein temporärer Shim, kein Pflicht-`corepack enable`, keine globale Installation.
    assert.match(readme, /No `corepack enable`, no global install, and no temporary\s+shim/);
    // Die frühere Einschränkung darf nur noch als behoben beschrieben sein.
    const limitation = readme.match(/.*sh: pnpm: command not found.*/)?.[0] ?? "";
    assert.match(limitation, /used to/, `Einschränkung klingt noch aktuell: ${limitation}`);
    assert.match(readme, /scripts\/pnpm/);
  });
});

describe("pnpm-Startweg ohne globales pnpm", () => {
  const shim = resolve(repoRoot, "scripts/pnpm");

  it("ruft in keinem Root-Skript ein unpräfixiertes pnpm auf", async () => {
    const pkg = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    for (const [name, body] of Object.entries(pkg.scripts)) {
      assert.doesNotMatch(
        body,
        /(^|[;&|]\s*)pnpm\s/,
        `Root-Skript "${name}" ruft ein unpräfixiertes pnpm auf: ${body}`
      );
    }

    // Und der Shim wird über einen relativen Pfad angesprochen — kein absoluter.
    for (const body of Object.values(pkg.scripts)) {
      assert.doesNotMatch(body, /\/(Users|home)\//, `Absoluter Pfad im Root-Skript: ${body}`);
    }
  });

  it("liefert einen ausführbaren Shim, der keine Version festschreibt", async () => {
    const source = await readFile(shim, "utf8");
    const mode = (await stat(shim)).mode;

    assert.ok(mode & 0o111, "scripts/pnpm ist nicht ausführbar");
    assert.match(source, /^#!\/bin\/sh/);
    // Erst ein vorhandenes pnpm (CI und Docker bleiben unverändert), dann corepack.
    assert.match(source, /command -v pnpm/);
    assert.match(source, /exec corepack pnpm "\$@"/);
    // Keine eigene Versionsangabe — die kommt aus `packageManager`.
    assert.doesNotMatch(source, /pnpm@\d/);
  });

  // Die drei Zweige des Shims werden mit Stub-Programmen in einem sonst leeren
  // PATH geprüft: kein Netzwerk, kein echtes pnpm, auf jeder Maschine gleich.
  // Der Shim selbst braucht nur /bin/sh aus seiner Shebang-Zeile.
  function runShimWith(stubs: Record<string, string>, args: string[]) {
    const binDir = mkdtempSync(join(tmpdir(), "signalpilot-shim-"));
    try {
      for (const [name, label] of Object.entries(stubs)) {
        const file = join(binDir, name);
        writeFileSync(file, `#!/bin/sh\necho "${label} $*"\n`);
        chmodSync(file, 0o755);
      }
      return spawnSync(shim, args, { cwd: repoRoot, encoding: "utf8", env: { PATH: binDir }, timeout: 10_000 });
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  }

  it("bevorzugt ein vorhandenes pnpm im PATH", () => {
    const result = runShimWith({ pnpm: "pnpm-stub", corepack: "corepack-stub" }, ["--version"]);

    assert.equal(result.status, 0, `scripts/pnpm scheiterte: ${result.stderr}`);
    assert.equal(result.stdout.trim(), "pnpm-stub --version");
  });

  it("leitet ohne pnpm im PATH alle Argumente an corepack weiter", () => {
    const result = runShimWith({ corepack: "corepack-stub" }, ["-r", "--filter", "./packages/**", "build"]);

    assert.equal(result.status, 0, `scripts/pnpm scheiterte: ${result.stderr}`);
    assert.equal(result.stdout.trim(), "corepack-stub pnpm -r --filter ./packages/** build");
  });

  it("bricht ohne pnpm und corepack verständlich mit Exit 127 ab", () => {
    const result = runShimWith({}, ["--version"]);

    assert.equal(result.status, 127);
    assert.match(result.stderr, /weder 'pnpm' noch 'corepack' gefunden/);
  });

  it("löst pnpm auch ohne pnpm im PATH über corepack auf — offline aus dem Cache", async (t) => {
    // Im PATH liegen nur node und corepack — genau die Umgebung, in der die
    // Root-Skripte vorher mit `sh: pnpm: command not found` abbrachen. Ein
    // globales pnpm neben node bleibt bewusst unsichtbar: es lädt für
    // `packageManager` sonst selbst eine passende pnpm-Version aus dem Netz
    // nach und hing so in einer Sandbox ohne Proxy-Variablen unbegrenzt.
    const pkg = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8")) as {
      packageManager: string;
    };
    const expectedVersion = pkg.packageManager.replace(/^pnpm@/, "").replace(/\+.*$/, "");
    const corepack = spawnSync("sh", ["-c", "command -v corepack"], { encoding: "utf8" }).stdout.trim();
    if (!corepack) {
      skipOutsideCi(t, "corepack ist nicht installiert");
      return;
    }

    const binDir = mkdtempSync(join(tmpdir(), "signalpilot-corepack-"));
    try {
      symlinkSync(process.execPath, join(binDir, "node"));
      symlinkSync(corepack, join(binDir, "corepack"));

      const env: NodeJS.ProcessEnv = {
        PATH: binDir,
        HOME: process.env.HOME ?? "",
        COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
        // Kein Download: pnpm muss aus dem lokalen Corepack-Cache kommen.
        COREPACK_ENABLE_NETWORK: "0"
      };
      for (const key of ["COREPACK_HOME", "XDG_CACHE_HOME"]) {
        if (process.env[key]) env[key] = process.env[key];
      }

      const result = spawnSync(shim, ["--version"], { cwd: repoRoot, encoding: "utf8", env, timeout: 60_000 });

      if (result.status !== 0 && /Network access disabled/.test(result.stderr)) {
        skipOutsideCi(
          t,
          `pnpm@${expectedVersion} liegt nicht im Corepack-Cache — einmal \`corepack pnpm install\` ausführen`
        );
        return;
      }

      assert.equal(result.error, undefined, `scripts/pnpm --version brach ab: ${result.error?.message}`);
      assert.equal(result.status, 0, `scripts/pnpm --version scheiterte: ${result.stderr}`);
      assert.equal(result.stdout.trim(), expectedVersion);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});

// Lokal ist ein fehlender Corepack-Cache eine Voraussetzung, kein Fehler des
// Shims — die Stub-Tests oben decken dessen Logik weiterhin ab. In CI muss der
// echte Weg laufen, deshalb wird dort aus dem Überspringen ein Fehlschlag.
function skipOutsideCi(t: TestContext, reason: string): void {
  if (process.env.CI) assert.fail(reason);
  t.skip(reason);
}

describe("getApiUrl", () => {
  it("meldet eine fehlende Serveradresse verständlich statt sie durchzureichen", () => {
    const previous = process.env.SIGNALPILOT_API_INTERNAL_URL;
    delete process.env.SIGNALPILOT_API_INTERNAL_URL;

    try {
      assert.throws(
        () => getApiUrl(true),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          // Vorher meldete Node nur "Failed to parse URL from /api/health".
          assert.match(message, /SIGNALPILOT_API_INTERNAL_URL/);
          assert.match(message, /\.env\.local\.example/);
          return true;
        }
      );
    } finally {
      if (previous === undefined) delete process.env.SIGNALPILOT_API_INTERNAL_URL;
      else process.env.SIGNALPILOT_API_INTERNAL_URL = previous;
    }
  });

  it("gibt eine gesetzte absolute Adresse unverändert zurück", () => {
    const previous = process.env.SIGNALPILOT_API_INTERNAL_URL;
    process.env.SIGNALPILOT_API_INTERNAL_URL = "http://localhost:3100/";

    try {
      assert.equal(getApiUrl(true), "http://localhost:3100");
    } finally {
      if (previous === undefined) delete process.env.SIGNALPILOT_API_INTERNAL_URL;
      else process.env.SIGNALPILOT_API_INTERNAL_URL = previous;
    }
  });

  it("lässt den Browserpfad relativ", () => {
    assert.equal(normalizeApiUrl(undefined, "/api"), "/api");
    assert.equal(getApiUrl(false), normalizeApiUrl(process.env.NEXT_PUBLIC_SIGNALPILOT_API_URL, "/api"));
  });
});
