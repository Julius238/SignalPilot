/**
 * Historical market data of the evolution worker: the gzip-CSV snapshots
 * written by `exportBinanceHistory` (data/market-snapshots/real, gitignored).
 *
 * The loader is the structural guarantee behind "no forward data in
 * research": every candle closing at or after the split's `forwardFrom`
 * (the start of the official forward test) is dropped while reading, whatever
 * the file contains. The fingerprint hashes exactly the candles that remain,
 * so refreshing a snapshot with newer data does not change it.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { researchDataEndMs, type DailyBar, type EvolutionDataSplit } from "@signalpilot/evolution";
import type { ReplayCandle, ReplayMarketData, ReplaySeries, ReplayTimeframe } from "@signalpilot/shadow-replay";

export const EVOLUTION_TIMEFRAMES: readonly ReplayTimeframe[] = ["1h", "4h", "1d"];
const HEADER = "openTime,closeTime,open,high,low,close,volume";

export interface SnapshotFileInfo {
  readonly file: string;
  readonly candles: number;
  readonly droppedAfterCutoff: number;
  readonly firstCloseAt: string | null;
  readonly lastCloseAt: string | null;
}

export interface EvolutionMarketSnapshot {
  readonly dir: string;
  /** SHA-256 over the candles that research may use (after the cut-off). */
  readonly fingerprint: string;
  readonly cutoffAt: string;
  readonly files: readonly SnapshotFileInfo[];
  readonly market: ReplayMarketData;
}

export function snapshotFileName(symbol: string, timeframe: ReplayTimeframe): string {
  return `${symbol}-${timeframe}.csv.gz`;
}

/** Decode one snapshot and drop every candle that closes after `cutoffMs`. */
export function decodeSnapshot(content: Buffer, cutoffMs: number): { candles: ReplayCandle[]; dropped: number; canonical: string } {
  const [first, ...rows] = gunzipSync(content).toString("utf8").split("\n");
  if (first !== HEADER) throw new Error(`Unexpected candle snapshot header: ${first}`);
  const candles: ReplayCandle[] = [];
  const kept: string[] = [];
  let dropped = 0;
  rows.forEach((row, index) => {
    if (row.length === 0) return;
    const [openTime, closeTime, open, high, low, close, volume] = row.split(",");
    if (volume === undefined) throw new Error(`Malformed candle snapshot row ${index + 2}`);
    const closeMs = Number(closeTime);
    if (!Number.isFinite(closeMs) || closeMs > cutoffMs) {
      dropped += 1;
      return;
    }
    candles.push({ openTime: Number(openTime), closeTime: closeMs, open: open!, high: high!, low: low!, close: close!, volume });
    kept.push(row);
  });
  candles.sort((a, b) => a.openTime - b.openTime);
  return { candles, dropped, canonical: kept.join("\n") };
}

export async function loadEvolutionMarket(dir: string, split: EvolutionDataSplit): Promise<EvolutionMarketSnapshot> {
  const cutoffMs = researchDataEndMs(split);
  const hash = createHash("sha256").update(`evolution-market-v1|cutoff=${cutoffMs}`);
  const files: SnapshotFileInfo[] = [];
  const series: ReplaySeries[] = [];
  for (const symbol of split.symbols) {
    const candles: Partial<Record<ReplayTimeframe, readonly ReplayCandle[]>> = {};
    for (const timeframe of EVOLUTION_TIMEFRAMES) {
      const file = snapshotFileName(symbol, timeframe);
      const path = resolve(dir, file);
      if (!existsSync(path)) throw new Error(`Missing market snapshot ${path}; export it with exportBinanceHistory first.`);
      const decoded = decodeSnapshot(await readFile(path), cutoffMs);
      hash.update(`|${file}|`).update(decoded.canonical);
      candles[timeframe] = decoded.candles;
      files.push({
        file,
        candles: decoded.candles.length,
        droppedAfterCutoff: decoded.dropped,
        firstCloseAt: decoded.candles.length === 0 ? null : new Date(decoded.candles[0]!.closeTime).toISOString(),
        lastCloseAt: decoded.candles.length === 0 ? null : new Date(decoded.candles.at(-1)!.closeTime).toISOString()
      });
    }
    series.push({ symbol, assetType: "CRYPTO", source: "BINANCE", candles });
  }
  return {
    dir,
    fingerprint: hash.digest("hex"),
    cutoffAt: new Date(cutoffMs).toISOString(),
    files,
    market: { series, origin: `SNAPSHOT:${dir}`, synthetic: false }
  };
}

/** Daily bars of a symbol up to and including `lastDay` (YYYY-MM-DD). */
export function dailyBars(market: ReplayMarketData, symbol: string, lastDay: string): DailyBar[] {
  const series = market.series.find((entry) => entry.symbol === symbol);
  return (series?.candles["1d"] ?? [])
    .map((candle) => ({ day: new Date(candle.openTime).toISOString().slice(0, 10), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close) }))
    .filter((bar) => bar.day <= lastDay);
}
