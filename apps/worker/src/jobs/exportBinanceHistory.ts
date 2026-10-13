import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BinanceMarketDataAdapter,
  candleSnapshotFileName,
  isCandleClosed,
  supportedBinanceIntervals,
  writeCandleSnapshot,
  type BinanceInterval,
  type NormalizedCandle
} from "@signalpilot/market-data";

// Exportiert öffentliche Binance-Kerzen als gzip-CSV-Snapshots (ohne Datenbank,
// ohne API-Key). Für Umgebungen, in denen nur ein Teil des Netzes erreichbar ist:
// der Export läuft dort, wo Binance erreichbar ist, der Import/Replay woanders.
//
//   EXPORT_SYMBOLS=BTCUSDT,ETHUSDT EXPORT_FROM=2022-01-01 EXPORT_OUT_DIR=./snapshot \
//     tsx src/jobs/exportBinanceHistory.ts

const defaultBaseUrls = ["https://data-api.binance.vision", "https://api.binance.com"];

export async function exportBinanceHistory(options: {
  symbols: string[];
  intervals: BinanceInterval[];
  from: Date;
  to: Date;
  outDir: string;
  baseUrls?: string[];
}): Promise<Array<{ symbol: string; interval: BinanceInterval; count: number; first?: Date; last?: Date }>> {
  const adapter = await pickReachableAdapter(options.baseUrls ?? defaultBaseUrls);
  await mkdir(options.outDir, { recursive: true });
  const summary = [];

  for (const symbol of options.symbols) {
    for (const interval of options.intervals) {
      const candles: NormalizedCandle[] = [];
      for await (const page of adapter.fetchKlineHistoryPages(symbol, interval, options.from, options.to)) {
        candles.push(...page.filter((candle) => isCandleClosed(candle, options.to)));
      }
      const unique = [...new Map(candles.map((c) => [c.openTime.getTime(), c])).values()];
      await writeCandleSnapshot(resolve(options.outDir, candleSnapshotFileName(symbol, interval)), unique);
      summary.push({ symbol, interval, count: unique.length, first: unique[0]?.openTime, last: unique.at(-1)?.openTime });
    }
  }
  return summary;
}

async function pickReachableAdapter(baseUrls: string[]): Promise<BinanceMarketDataAdapter> {
  const failures: string[] = [];
  for (const baseUrl of baseUrls) {
    const adapter = new BinanceMarketDataAdapter({ baseUrl });
    try {
      await adapter.fetchKlines("BTCUSDT", "1h", { limit: 1, retry: { maxAttempts: 1 } });
      return adapter;
    } catch (error) {
      failures.push(`${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`No Binance endpoint reachable:\n${failures.join("\n")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const intervals = (process.env.EXPORT_INTERVALS ?? supportedBinanceIntervals.join(","))
    .split(",")
    .map((value) => value.trim()) as BinanceInterval[];
  const summary = await exportBinanceHistory({
    symbols: (process.env.EXPORT_SYMBOLS ?? "BTCUSDT").split(",").map((value) => value.trim()),
    intervals,
    from: new Date(process.env.EXPORT_FROM ?? "2022-01-01T00:00:00.000Z"),
    to: new Date(),
    outDir: resolve(process.env.EXPORT_OUT_DIR ?? "candle-snapshot"),
    baseUrls: process.env.BINANCE_BASE_URL ? [process.env.BINANCE_BASE_URL] : undefined
  });
  for (const row of summary) {
    console.log(
      `${row.symbol} ${row.interval}: ${row.count} candles ${row.first?.toISOString() ?? "-"} → ${row.last?.toISOString() ?? "-"}`
    );
  }
}
