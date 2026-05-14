import { supportedBinanceIntervals, type BinanceInterval, type NormalizedCandle } from "./types.js";

type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string
];

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class BinanceMarketDataAdapter {
  private readonly baseUrl: string;
  private readonly fetchClient: FetchLike;

  constructor(options: { baseUrl?: string; fetchClient?: FetchLike } = {}) {
    this.baseUrl = options.baseUrl ?? process.env.BINANCE_BASE_URL ?? "https://api.binance.com";
    this.fetchClient = options.fetchClient ?? fetch;
  }

  async fetchKlines(
    symbol: string,
    interval: BinanceInterval,
    limit: number
  ): Promise<NormalizedCandle[]> {
    assertSupportedInterval(interval);

    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error("Binance kline limit must be an integer between 1 and 1000.");
    }

    const url = new URL("/api/v3/klines", this.baseUrl);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", String(limit));

    const response = await this.fetchClient(url);

    if (!response.ok) {
      throw new Error(`Binance klines request failed with HTTP ${response.status}.`);
    }

    const payload: unknown = await response.json();

    return normalizeBinanceKlines(symbol, interval, payload);
  }
}

export function normalizeBinanceKlines(
  symbol: string,
  interval: BinanceInterval,
  payload: unknown
): NormalizedCandle[] {
  assertSupportedInterval(interval);

  if (!Array.isArray(payload)) {
    throw new Error("Invalid Binance kline response: expected an array.");
  }

  return payload.map((entry, index) => normalizeBinanceKline(symbol, interval, entry, index));
}

function normalizeBinanceKline(
  symbol: string,
  interval: BinanceInterval,
  entry: unknown,
  index: number
): NormalizedCandle {
  if (!isBinanceKline(entry)) {
    throw new Error(`Invalid Binance kline response at index ${index}.`);
  }

  return {
    symbol,
    timeframe: interval,
    openTime: new Date(entry[0]),
    closeTime: new Date(entry[6]),
    open: entry[1],
    high: entry[2],
    low: entry[3],
    close: entry[4],
    volume: entry[5],
    source: "BINANCE"
  };
}

function isBinanceKline(entry: unknown): entry is BinanceKline {
  if (!Array.isArray(entry) || entry.length < 12) {
    return false;
  }

  return (
    typeof entry[0] === "number" &&
    typeof entry[1] === "string" &&
    typeof entry[2] === "string" &&
    typeof entry[3] === "string" &&
    typeof entry[4] === "string" &&
    typeof entry[5] === "string" &&
    typeof entry[6] === "number"
  );
}

function assertSupportedInterval(interval: string): asserts interval is BinanceInterval {
  if (!supportedBinanceIntervals.includes(interval as BinanceInterval)) {
    throw new Error(`Unsupported Binance interval: ${interval}.`);
  }
}
