import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { describeApiError } from "../src/lib/api-error";
import { discoveryEmptyCopy, resolveDiscoveryStatus } from "../src/lib/discovery-status";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const stripLineComments = (source: string) =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

// Regression: Schlug `/discovery/overview` fehl, war `data` undefined und die Übersicht
// rendete "Asset Discovery ist sicher deaktiviert" — eine falsche Tatsachenbehauptung
// über den Systemzustand.

describe("discovery status", () => {
  const base = {
    errorKind: undefined,
    hasError: false,
    enabled: true,
    hasRun: true,
    candidateCountToday: 2
  };

  it("never reports a failed call as disabled", () => {
    for (const errorKind of ["unreachable", "server", "request", "unauthorized"] as const) {
      const status = resolveDiscoveryStatus({
        ...base,
        errorKind,
        hasError: true,
        // Genau die Ausgangslage des Bugs: Bei einem Fehler sind diese Felder undefined.
        enabled: undefined,
        hasRun: undefined,
        candidateCountToday: 0
      });

      assert.equal(status, "error");
      assert.notEqual(status, "disabled");
      assert.notEqual(status, "no-run");
    }
  });

  it("keeps the error state even when the feature really is disabled", () => {
    const status = resolveDiscoveryStatus({
      ...base,
      hasError: true,
      errorKind: "server",
      enabled: false
    });

    // Solange der Aufruf fehlschlägt, ist über die Konfiguration nichts bekannt.
    assert.equal(status, "error");
  });

  it("distinguishes disabled, no run, no candidates and ready", () => {
    assert.equal(
      resolveDiscoveryStatus({ ...base, enabled: false, hasRun: false }),
      "disabled"
    );
    assert.equal(resolveDiscoveryStatus({ ...base, hasRun: false }), "no-run");
    assert.equal(
      resolveDiscoveryStatus({ ...base, candidateCountToday: 0 }),
      "no-candidates-today"
    );
    assert.equal(resolveDiscoveryStatus(base), "ready");
  });

  it("uses distinct copy per state and drops the misleading wording", () => {
    const disabled = discoveryEmptyCopy("disabled");
    const noRun = discoveryEmptyCopy("no-run");
    const noneToday = discoveryEmptyCopy("no-candidates-today");

    assert.notEqual(disabled.title, noRun.title);
    assert.notEqual(noRun.title, noneToday.title);
    assert.match(noRun.title, /Noch kein Discovery-Lauf/);
    assert.match(disabled.title, /deaktiviert/);

    for (const copy of [disabled, noRun, noneToday]) {
      assert.doesNotMatch(copy.description, /sicher deaktiviert/);
      assert.doesNotMatch(copy.title, /sicher deaktiviert/);
    }
  });
});

describe("API error copy", () => {
  it("names the actual cause instead of claiming there is no data", () => {
    const unreachable = describeApiError("unreachable", "fetch failed", "Die Discovery-Daten");
    assert.match(unreachable.title, /nicht erreichbar/);
    assert.match(unreachable.message, /Die Discovery-Daten/);
    assert.equal(unreachable.retryable, true);

    const server = describeApiError("server", "HTTP 500", "Die Discovery-Daten");
    assert.match(server.title, /Interner Fehler/);
    assert.match(server.hint, /HTTP 500/);
    assert.equal(server.retryable, true);
  });

  it("does not offer a retry when the session is gone", () => {
    const unauthorized = describeApiError("unauthorized", "Unauthorized");
    assert.match(unauthorized.title, /Anmeldung/);
    assert.equal(unauthorized.retryable, false);
  });

  it("produces different copy per error kind", () => {
    const titles = new Set(
      (["unauthorized", "unreachable", "server", "request"] as const).map(
        (kind) => describeApiError(kind, "x").title
      )
    );
    assert.equal(titles.size, 4);
  });

  it("never describes any failure as deactivated or empty", () => {
    for (const kind of ["unauthorized", "unreachable", "server", "request", undefined] as const) {
      const copy = describeApiError(kind, "x", "Die Discovery-Daten");
      assert.doesNotMatch(copy.title, /deaktiviert/i);
      assert.doesNotMatch(copy.message, /deaktiviert/i);
    }
  });
});

describe("discovery pages", () => {
  it("renders an honest error state with a retry action", async () => {
    const overview = await readFile(resolve(appDir, "src/app/dashboard/page.tsx"), "utf8");
    const discoveryPage = await readFile(
      resolve(appDir, "src/app/dashboard/discovery/page.tsx"),
      "utf8"
    );

    assert.match(overview, /discoveryStatus === "error"/);
    assert.match(overview, /<RetryButton \/>/);
    assert.match(discoveryPage, /<RetryButton \/>/);
    assert.match(discoveryPage, /Noch kein Discovery-Lauf durchgeführt\./);

    // Der falsche Satz darf als Anzeigetext nirgends zurückkommen. Zeilenkommentare
    // dürfen ihn zitieren (sie erklären die Regression) — daher vorher entfernen.
    assert.doesNotMatch(stripLineComments(overview), /sicher deaktiviert/);
    assert.doesNotMatch(stripLineComments(discoveryPage), /sicher deaktiviert/);
  });
});
