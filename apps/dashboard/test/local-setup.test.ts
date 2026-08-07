import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
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

  it("löst pnpm auch ohne pnpm im PATH über corepack auf", () => {
    // Ein PATH ohne pnpm, aber mit node/corepack — genau die Umgebung, in der
    // die Root-Skripte vorher mit `sh: pnpm: command not found` abbrachen.
    const nodeBin = dirname(process.execPath);
    const path = [nodeBin, "/usr/bin", "/bin"].join(":");

    const probe = spawnSync("sh", ["-c", "command -v pnpm"], { env: { PATH: path }, encoding: "utf8" });
    if (probe.status === 0) {
      // Auf dieser Maschine liegt pnpm global neben node — dann greift Zweig 1.
      assert.ok(probe.stdout.trim().length > 0);
    }

    const result = spawnSync(shim, ["--version"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { PATH: path, HOME: process.env.HOME ?? "", COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" }
    });

    assert.equal(result.status, 0, `scripts/pnpm --version scheiterte: ${result.stderr}`);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
  });
});

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
