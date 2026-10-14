import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FRED_EQUITY_BENCHMARK_PROXIES,
  FredSeriesAdapter,
  candleSnapshotFileName,
  writeCandleSnapshot
} from "@signalpilot/market-data";

// Exportiert Tages-Schlusskurse öffentlicher FRED-Indizes als Regime-Proxys
// für SPY (S&P 500) und QQQ (Nasdaq-100) in denselben Snapshot-Ordner wie die
// Binance-Kerzen. Ohne Datenbank und ohne API-Key. IWM hat keine FRED-Reihe.
//
//   EXPORT_OUT_DIR=./data/market-snapshots/real tsx src/jobs/exportEquityBenchmarkProxies.ts
//
// `sources.json` im Ordner hält fest, dass diese Dateien Index-Proxys sind.

export async function exportEquityBenchmarkProxies(options: {
  outDir: string;
  adapter?: FredSeriesAdapter;
}): Promise<Array<{ symbol: string; seriesId: string; count: number; first?: Date; last?: Date }>> {
  const adapter = options.adapter ?? new FredSeriesAdapter();
  await mkdir(options.outDir, { recursive: true });
  const summary = [];
  const sources: Record<string, unknown> = await readSources(options.outDir);

  for (const [symbol, seriesId] of Object.entries(FRED_EQUITY_BENCHMARK_PROXIES)) {
    const candles = await adapter.fetchDailyCloses(symbol, seriesId);
    await writeCandleSnapshot(resolve(options.outDir, candleSnapshotFileName(symbol, "1d")), candles);
    sources[symbol] = {
      provider: "FRED",
      seriesId,
      kind: "INDEX_PROXY",
      note: `Tages-Schlusskurs des Index ${seriesId} als Proxy für ${symbol}; open=high=low=close, kein Volumen.`
    };
    summary.push({ symbol, seriesId, count: candles.length, first: candles[0]?.openTime, last: candles.at(-1)?.openTime });
  }

  await writeFile(resolve(options.outDir, "sources.json"), `${JSON.stringify(sources, null, 2)}\n`);
  return summary;
}

async function readSources(dir: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(resolve(dir, "sources.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const summary = await exportEquityBenchmarkProxies({
    outDir: resolve(process.env.EXPORT_OUT_DIR ?? "candle-snapshot")
  });
  for (const row of summary) {
    console.log(
      `${row.symbol} ← FRED ${row.seriesId}: ${row.count} Tage ${row.first?.toISOString().slice(0, 10) ?? "-"} → ${row.last?.toISOString().slice(0, 10) ?? "-"}`
    );
  }
}
