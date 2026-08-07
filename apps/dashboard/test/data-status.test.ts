import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeStatus,
  formatMetric,
  hasData,
  isErrorStatus,
  metricValue,
  resolveDataStatus,
  shortStatusNote,
  statusOfList,
  type DataStatus
} from "../src/lib/data-status";
import type { ApiResult } from "../src/lib/signalpilot-api";

const NOW = new Date("2026-08-06T12:00:00.000Z");

function ok<T>(data: T): ApiResult<T> {
  return { data, error: null };
}

function failed<T>(kind: "unauthorized" | "unreachable" | "server" | "request"): ApiResult<T> {
  return { data: null, error: "boom", errorKind: kind };
}

describe("resolveDataStatus", () => {
  it("maps each API error kind onto its own status", () => {
    assert.equal(
      resolveDataStatus({ error: "x", errorKind: "unreachable", isEmpty: true }),
      "unreachable"
    );
    assert.equal(
      resolveDataStatus({ error: "x", errorKind: "server", isEmpty: true }),
      "server-error"
    );
    assert.equal(
      resolveDataStatus({ error: "x", errorKind: "unauthorized", isEmpty: true }),
      "unauthorized"
    );
    // Eine abgelehnte Anfrage ist für den Nutzer dasselbe wie ein interner Fehler.
    assert.equal(
      resolveDataStatus({ error: "x", errorKind: "request", isEmpty: true }),
      "server-error"
    );
  });

  it("lets the error win over the empty state — always", () => {
    // Das ist der eigentliche Regressionsschutz: Ein gescheiterter Abruf liefert
    // `data: null`, was ohne diese Regel als "es gibt nichts" durchgeht.
    const status = resolveDataStatus({
      error: "Failed to fetch",
      errorKind: "unreachable",
      isEmpty: true,
      newestAt: null,
      staleAfterHours: 24,
      now: NOW
    });

    assert.equal(status, "unreachable");
    assert.notEqual(status, "empty");
    assert.ok(isErrorStatus(status));
    assert.equal(hasData(status), false);
  });

  it("falls back to an internal error when the kind is missing", () => {
    assert.equal(resolveDataStatus({ error: "kaputt", isEmpty: false }), "server-error");
  });

  it("reports empty only when the call actually succeeded", () => {
    assert.equal(resolveDataStatus({ error: null, isEmpty: true }), "empty");
  });

  it("marks data as stale once it is older than the window", () => {
    const status = resolveDataStatus({
      error: null,
      isEmpty: false,
      newestAt: "2026-05-24T15:13:00.000Z",
      staleAfterHours: 24,
      now: NOW
    });

    assert.equal(status, "stale");
    // Veraltete Daten sind echte Daten — sie dürfen angezeigt werden.
    assert.equal(hasData(status), true);
    assert.equal(isErrorStatus(status), false);
  });

  it("keeps fresh data available", () => {
    const status = resolveDataStatus({
      error: null,
      isEmpty: false,
      newestAt: "2026-08-06T11:29:00.000Z",
      staleAfterHours: 24,
      now: NOW
    });

    assert.equal(status, "available");
  });

  it("ignores an unparsable timestamp instead of guessing", () => {
    const status = resolveDataStatus({
      error: null,
      isEmpty: false,
      newestAt: "nicht-ein-datum",
      staleAfterHours: 24,
      now: NOW
    });

    assert.equal(status, "available");
  });
});

describe("statusOfList", () => {
  it("treats a failed list call as an error, not as an empty list", () => {
    assert.equal(statusOfList(failed<string[]>("unreachable")), "unreachable");
  });

  it("treats an empty successful list as empty", () => {
    assert.equal(statusOfList(ok<string[]>([])), "empty");
  });

  it("treats a filled list as available", () => {
    assert.equal(statusOfList(ok(["a"])), "available");
  });
});

describe("metric values", () => {
  it("never reports 0 for a failed call", () => {
    for (const status of ["unreachable", "server-error", "unauthorized"] as DataStatus[]) {
      assert.equal(metricValue(status, 0), null);
      assert.equal(formatMetric(metricValue(status, 0)), "—");
      // Auch ein von der Seite berechneter Wert darf nicht durchrutschen.
      assert.equal(metricValue(status, 7), null);
    }
  });

  it("keeps a real zero when the call succeeded", () => {
    assert.equal(metricValue("empty", 0), 0);
    assert.equal(formatMetric(metricValue("empty", 0)), "0");
    assert.equal(metricValue("stale", 3), 3);
  });
});

describe("status copy", () => {
  it("returns German copy with a next step for every error status", () => {
    for (const status of ["unreachable", "server-error", "unauthorized"] as DataStatus[]) {
      const copy = describeStatus(status, "technisch", "Die Signale");
      assert.ok(copy, `keine Copy für ${status}`);
      assert.ok(copy.title.length > 0);
      assert.match(copy.message, /Die Signale/);
      assert.ok(copy.hint.length > 0);
    }
  });

  it("does not offer a retry when a new session is required", () => {
    assert.equal(describeStatus("unauthorized", "", "Die Signale")?.retryable, false);
    assert.equal(describeStatus("unreachable", "", "Die Signale")?.retryable, true);
  });

  it("stays silent for non-error statuses", () => {
    assert.equal(describeStatus("available", "", "Die Signale"), null);
    assert.equal(describeStatus("empty", "", "Die Signale"), null);
    assert.equal(describeStatus("stale", "", "Die Signale"), null);
    assert.equal(shortStatusNote("empty"), null);
    assert.match(String(shortStatusNote("unreachable")), /nicht abrufbar/);
  });
});
