import { classifyProviderHttpError, toTemporaryProviderError } from "./provider-errors.js";
import type { FetchLike } from "./binance.js";
import type { NormalizedCandle } from "./types.js";

// Öffentliche FRED-Zeitreihen (Federal Reserve Bank of St. Louis) als
// Tages-Schlusskurse, ohne API-Key über den CSV-Download. Gedacht für die
// Regime-Benchmarks im Replay: FRED liefert einen Indexwert je Handelstag,
// keine OHLC-Kerzen und kein Volumen. Die Regime-Logik liest nur Schlusskurse.

/**
 * Index-Proxys für die ETF-Benchmarks der Regime-Logik. SPY bildet den
 * S&P 500 ab, QQQ den Nasdaq-100 — als Kursindex ohne Dividenden, also mit
 * derselben Trend- und Momentum-Struktur. Für IWM (Russell 2000) bietet FRED
 * keine Reihe an.
 */
export const FRED_EQUITY_BENCHMARK_PROXIES: Readonly<Record<string, string>> = Object.freeze({
  SPY: "SP500",
  QQQ: "NASDAQ100"
});

/**
 * Schlusszeit eines US-Handelstags in UTC, konservativ nach dem Börsenschluss
 * (16:00 New York = 20:00 UTC Sommerzeit, 21:00 UTC Winterzeit): Ein Wert gilt
 * im Replay erst ab 21:00 UTC als bekannt, nie früher.
 */
const US_SESSION_CLOSE_UTC_HOUR = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseFredSeriesCsv(symbol: string, seriesId: string, csv: string): NormalizedCandle[] {
  const [header, ...rows] = csv.trim().split(/\r?\n/);
  const columns = header?.split(",") ?? [];
  if (columns.length !== 2 || columns[1] !== seriesId) {
    throw new Error(`Unexpected FRED CSV header for ${seriesId}: ${header}`);
  }

  return rows.flatMap((row) => {
    const [date, value] = row.split(",");
    // FRED markiert Tage ohne Beobachtung (Feiertage) mit "." oder leer.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || value === undefined || !/^\d+(\.\d+)?$/.test(value)) {
      return [];
    }
    const dayStart = Date.parse(`${date}T00:00:00.000Z`);
    return [
      {
        symbol,
        timeframe: "1d",
        openTime: new Date(dayStart),
        closeTime: new Date(dayStart + US_SESSION_CLOSE_UTC_HOUR * 60 * 60 * 1000),
        open: value,
        high: value,
        low: value,
        close: value,
        volume: "0",
        source: "FRED"
      } satisfies NormalizedCandle
    ];
  });
}

export class FredSeriesAdapter {
  private readonly baseUrl: string;
  private readonly fetchClient: FetchLike;

  constructor(options: { baseUrl?: string; fetchClient?: FetchLike } = {}) {
    this.baseUrl = options.baseUrl ?? "https://fred.stlouisfed.org";
    this.fetchClient = options.fetchClient ?? fetch;
  }

  async fetchDailyCloses(symbol: string, seriesId: string, from?: Date): Promise<NormalizedCandle[]> {
    const url = new URL("/graph/fredgraph.csv", this.baseUrl);
    url.searchParams.set("id", seriesId);
    let response: Response;
    try {
      response = await this.fetchClient(url);
    } catch {
      throw toTemporaryProviderError("FRED", "series");
    }
    if (!response.ok) {
      const hint = await response.text().catch(() => "");
      throw classifyProviderHttpError("FRED", "series", response.status, hint);
    }
    const candles = parseFredSeriesCsv(symbol, seriesId, await response.text());
    return from === undefined ? candles : candles.filter((candle) => candle.openTime.getTime() >= from.getTime() - DAY_MS);
  }
}
