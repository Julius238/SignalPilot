import { supportedFinnhubIntervals, type FinnhubInterval, type NormalizedCandle } from "./types.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type FinnhubCandleResponse = {
  s: string;
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  v?: number[];
};

export type FinnhubFetchResult =
  | { kind: "ok"; candles: NormalizedCandle[] }
  | { kind: "no_data" }
  | { kind: "rate_limit" };

export class FinnhubMarketDataAdapter {
  private readonly baseUrl: string;
  private readonly fetchClient: FetchLike;
  private readonly apiKey: string;

  constructor(options: { baseUrl?: string; fetchClient?: FetchLike; apiKey?: string } = {}) {
    this.baseUrl = options.baseUrl ?? "https://finnhub.io";
    this.fetchClient = options.fetchClient ?? fetch;
    this.apiKey = options.apiKey ?? process.env.FINNHUB_API_KEY ?? "";
  }

  assertApiKey(): void {
    if (!this.apiKey) {
      throw new Error("FINNHUB_API_KEY environment variable is not set.");
    }
  }

  async fetchStockCandles(
    symbol: string,
    interval: FinnhubInterval,
    from: Date,
    to: Date
  ): Promise<FinnhubFetchResult> {
    assertSupportedInterval(interval);

    const resolution = toFinnhubResolution(interval);
    const url = new URL("/api/v1/stock/candle", this.baseUrl);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("resolution", resolution);
    url.searchParams.set("from", String(Math.floor(from.getTime() / 1000)));
    url.searchParams.set("to", String(Math.floor(to.getTime() / 1000)));
    url.searchParams.set("token", this.apiKey);

    const response = await this.fetchClient(url);

    if (response.status === 429) {
      return { kind: "rate_limit" };
    }

    if (!response.ok) {
      throw new Error(`Finnhub candle request failed with HTTP ${response.status}.`);
    }

    const payload: unknown = await response.json();
    return normalizeFinnhubResponse(symbol, interval, payload);
  }
}

export function normalizeFinnhubResponse(
  symbol: string,
  interval: FinnhubInterval,
  payload: unknown
): FinnhubFetchResult {
  if (!isFinnhubCandleResponse(payload)) {
    throw new Error("Invalid Finnhub candle response format.");
  }

  if (payload.s === "no_data") {
    return { kind: "no_data" };
  }

  if (payload.s !== "ok") {
    throw new Error(`Unexpected Finnhub candle status: ${payload.s}.`);
  }

  const { t, o, h, l, c, v } = payload;

  if (!t || !o || !h || !l || !c || !v || t.length === 0) {
    return { kind: "no_data" };
  }

  const candles: NormalizedCandle[] = t.map((timestamp, index) => {
    const openTime = new Date(timestamp * 1000);
    return {
      symbol,
      timeframe: interval,
      openTime,
      closeTime: shiftByInterval(openTime, interval),
      open: String(o[index]),
      high: String(h[index]),
      low: String(l[index]),
      close: String(c[index]),
      volume: String(v[index]),
      source: "FINNHUB" as const
    };
  });

  return { kind: "ok", candles };
}

function shiftByInterval(date: Date, interval: FinnhubInterval): Date {
  const ms = date.getTime();
  if (interval === "1h") {
    return new Date(ms + 60 * 60 * 1000);
  }
  return new Date(ms + 24 * 60 * 60 * 1000);
}

function isFinnhubCandleResponse(payload: unknown): payload is FinnhubCandleResponse {
  return typeof payload === "object" && payload !== null && typeof (payload as FinnhubCandleResponse).s === "string";
}

function toFinnhubResolution(interval: FinnhubInterval): string {
  if (interval === "1h") return "60";
  return "D";
}

function assertSupportedInterval(interval: string): asserts interval is FinnhubInterval {
  if (!supportedFinnhubIntervals.includes(interval as FinnhubInterval)) {
    throw new Error(`Unsupported Finnhub interval: ${interval}.`);
  }
}
