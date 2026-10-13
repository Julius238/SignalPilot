import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";

import { supportedBinanceIntervals, type BinanceInterval, type NormalizedCandle } from "./types.js";

// Kerzen-Snapshots als gzip-CSV: eine Datei je Symbol und Zeitebene,
// `<SYMBOL>-<interval>.csv.gz`, Zeiten in Millisekunden UTC.
const header = "openTime,closeTime,open,high,low,close,volume";

export function candleSnapshotFileName(symbol: string, interval: BinanceInterval): string {
  return `${symbol}-${interval}.csv.gz`;
}

export function encodeCandleSnapshot(candles: NormalizedCandle[]): Buffer {
  const sorted = [...candles].sort((a, b) => a.openTime.getTime() - b.openTime.getTime());
  const lines = sorted.map((c) =>
    [c.openTime.getTime(), c.closeTime.getTime(), c.open, c.high, c.low, c.close, c.volume].join(",")
  );
  return gzipSync(`${header}\n${lines.join("\n")}\n`);
}

export function decodeCandleSnapshot(
  symbol: string,
  interval: BinanceInterval,
  content: Buffer
): NormalizedCandle[] {
  if (!supportedBinanceIntervals.includes(interval)) {
    throw new Error(`Unsupported snapshot interval: ${interval}`);
  }
  const [first, ...rows] = gunzipSync(content).toString("utf8").split("\n");
  if (first !== header) throw new Error(`Unexpected candle snapshot header: ${first}`);

  return rows
    .filter((row) => row.length > 0)
    .map((row, index) => {
      const [openTime, closeTime, open, high, low, close, volume] = row.split(",");
      if (volume === undefined) throw new Error(`Malformed candle snapshot row ${index + 2}`);
      return {
        symbol,
        timeframe: interval,
        openTime: new Date(Number(openTime)),
        closeTime: new Date(Number(closeTime)),
        open,
        high,
        low,
        close,
        volume,
        source: "BINANCE" as const
      };
    });
}

export async function writeCandleSnapshot(path: string, candles: NormalizedCandle[]): Promise<void> {
  await writeFile(path, encodeCandleSnapshot(candles));
}

export async function readCandleSnapshot(
  path: string,
  symbol: string,
  interval: BinanceInterval
): Promise<NormalizedCandle[]> {
  return decodeCandleSnapshot(symbol, interval, await readFile(path));
}
