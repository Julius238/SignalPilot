import { supportedFinnhubIntervals, type FinnhubInterval, type NormalizedCandle } from "./types.js";
import { classifyProviderHttpError, toTemporaryProviderError } from "./provider-errors.js";

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
  | { kind: "rate_limit" }
  | { kind: "invalid_api_key"; statusCode: number }
  | { kind: "entitlement"; statusCode: number }
  | { kind: "unsupported_symbol"; statusCode: number }
  | { kind: "temporary_error"; statusCode: number | null }
  | { kind: "permanent_error"; statusCode: number };

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

    let response: Response;
    try {
      response = await this.fetchClient(url);
    } catch {
      const error = toTemporaryProviderError("FINNHUB", "stock/candle");
      return { kind: "temporary_error", statusCode: error.statusCode };
    }

    if (response.status === 429) {
      return { kind: "rate_limit" };
    }

    if (!response.ok) {
      const hint = await response.text().catch(() => "");
      const error = classifyProviderHttpError(
        "FINNHUB",
        "stock/candle",
        response.status,
        hint
      );
      if (error.kind === "INVALID_API_KEY") {
        return { kind: "invalid_api_key", statusCode: response.status };
      }
      if (error.kind === "ENTITLEMENT") {
        return { kind: "entitlement", statusCode: response.status };
      }
      if (error.kind === "UNSUPPORTED_SYMBOL") {
        return { kind: "unsupported_symbol", statusCode: response.status };
      }
      if (error.kind === "TEMPORARY") {
        return { kind: "temporary_error", statusCode: response.status };
      }
      return { kind: "permanent_error", statusCode: response.status };
    }

    try {
      const payload: unknown = await response.json();
      return normalizeFinnhubResponse(symbol, interval, payload);
    } catch {
      return { kind: "temporary_error", statusCode: response.status };
    }
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
