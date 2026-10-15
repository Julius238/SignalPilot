import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { gzipSync } from "node:zlib";

import { EVOLUTION_ROOTS } from "@signalpilot/evolution";
import { generateSyntheticSeries } from "@signalpilot/shadow-replay";

import { ChildProcessBacktestPool } from "../src/backtest/pool.js";
import { snapshotFileName } from "../src/market/snapshots.js";

// Synthetic candles in the snapshot format: proves the process mechanics only.
function writeSyntheticSnapshots(dir: string) {
  const start = Date.UTC(2017, 8, 1);
  const hours = 320 * 24;
  for (const [symbol, price, seed] of [["BTCUSDT", 4000, 3], ["ETHUSDT", 300, 5]] as const) {
    const series = generateSyntheticSeries({ symbol, startMs: start, hours, startPrice: price, seed, baseVolume: 900 });
    for (const timeframe of ["1h", "4h", "1d"] as const) {
      const rows = (series.candles[timeframe] ?? []).map((c) => [c.openTime, c.closeTime, c.open, c.high, c.low, c.close, c.volume].join(","));
      writeFileSync(join(dir, snapshotFileName(symbol, timeframe)), gzipSync(["openTime,closeTime,open,high,low,close,volume", ...rows, ""].join("\n")));
    }
  }
}

describe("child-process backtest pool", { timeout: 300_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "evo-pool-"));
  before(() => writeSyntheticSnapshots(dir));

  const job = (kind: "TECHNICAL" | "BACKTEST") => ({
    jobId: `${kind}-${Math.random()}`,
    kind,
    subjectKey: EVOLUTION_ROOTS[1]!.key,
    subject: { kind: "GENOME" as const, genome: EVOLUTION_ROOTS[1]!.genome },
    symbol: "BTCUSDT",
    windowKey: kind === "TECHNICAL" ? ("TECHNICAL" as const) : ("DISCOVERY_VALIDATION" as const),
    from: "2018-05-01T00:00:00.000Z",
    to: "2018-05-20T23:59:59.999Z",
    splitAt: kind === "TECHNICAL" ? undefined : "2018-05-15T00:00:00.000Z",
    codeVersion: "test"
  });

  const pool = new ChildProcessBacktestPool({ snapshotDir: dir, concurrency: 1, timeoutMs: 240_000, maxOldSpaceMb: 512 });
  after(async () => pool.close());

  it("runs technical checks and backtests in a separate process with the data fingerprint", async () => {
    const technical = await pool.run(job("TECHNICAL"));
    assert.equal(technical.ok, true, technical.ok ? "" : technical.error);
    assert.ok(technical.ok && technical.technical!.deterministic);
    assert.ok(technical.ok && technical.dataFingerprint.length === 64);
    const backtest = await pool.run(job("BACKTEST"));
    assert.equal(backtest.ok, true, backtest.ok ? "" : backtest.error);
    assert.ok(backtest.ok && backtest.summary!.funnel.cycles > 0);
    assert.ok(backtest.ok && backtest.summary!.periods.discovery !== undefined && backtest.summary!.periods.validation !== undefined);
  });

  it("kills a backtest that exceeds its time limit and keeps serving afterwards", async () => {
    const strict = new ChildProcessBacktestPool({ snapshotDir: dir, concurrency: 1, timeoutMs: 1, maxOldSpaceMb: 512 });
    try {
      const result = await strict.run(job("BACKTEST"));
      assert.equal(result.ok, false);
      assert.match(!result.ok ? result.error : "", /timed out/);
    } finally {
      await strict.close();
    }
    const again = await pool.run(job("TECHNICAL"));
    assert.equal(again.ok, true);
  });
});
