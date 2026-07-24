import { supportedBinanceIntervals, type BinanceInterval, type NormalizedCandle } from "./types.js";
import { classifyProviderHttpError, toTemporaryProviderError } from "./provider-errors.js";
import {
  retryProviderRequest,
  type ProviderRetryEvent,
  type ProviderRetryOptions
} from "./retry.js";

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

export type BinanceKlineRequest = {
  limit: number;
  startTime?: Date | number;
  endTime?: Date | number;
  retry?: Omit<ProviderRetryOptions<NormalizedCandle[]>, "shouldRetryResult" | "resultKind">;
};

export type BinanceHistoryOptions = {
  pageSize?: number;
  retry?: BinanceKlineRequest["retry"];
  onRetry?: (event: ProviderRetryEvent) => void | Promise<void>;
};

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
    limitOrRequest: number | BinanceKlineRequest
  ): Promise<NormalizedCandle[]> {
    assertSupportedInterval(interval);
    const request =
      typeof limitOrRequest === "number" ? { limit: limitOrRequest } : limitOrRequest;
    const { limit } = request;

    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error("Binance kline limit must be an integer between 1 and 1000.");
    }

    const url = new URL("/api/v3/klines", this.baseUrl);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", String(limit));
    if (request.startTime !== undefined) {
      url.searchParams.set("startTime", String(toMilliseconds(request.startTime)));
    }
    if (request.endTime !== undefined) {
      url.searchParams.set("endTime", String(toMilliseconds(request.endTime)));
    }

    const outcome = await retryProviderRequest(async () => {
      let response: Response;
      try {
        response = await this.fetchClient(url);
      } catch {
        throw toTemporaryProviderError("BINANCE", "klines");
      }

      if (!response.ok) {
        const hint = await response.text().catch(() => "");
        throw classifyProviderHttpError("BINANCE", "klines", response.status, hint);
      }

      const payload: unknown = await response.json();
      return normalizeBinanceKlines(symbol, interval, payload);
    }, request.retry);

    return outcome.value;
  }

  async *fetchKlineHistoryPages(
    symbol: string,
    interval: BinanceInterval,
    from: Date,
    to: Date,
    options: BinanceHistoryOptions = {}
  ): AsyncGenerator<NormalizedCandle[]> {
    assertSupportedInterval(interval);
    const pageSize = options.pageSize ?? 1000;
    let cursor = from.getTime();
    const endTime = to.getTime();

    while (cursor <= endTime) {
      const page = await this.fetchKlines(symbol, interval, {
        limit: pageSize,
        startTime: cursor,
        endTime,
        retry: {
          ...options.retry,
          onRetry: options.onRetry ?? options.retry?.onRetry
        }
      });

      if (page.length === 0) return;
      yield page;

      const nextCursor = page.at(-1)!.openTime.getTime() + intervalDurationMs(interval);
      if (nextCursor <= cursor || page.length < pageSize) return;
      cursor = nextCursor;
    }
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

function toMilliseconds(value: Date | number) {
  return value instanceof Date ? value.getTime() : value;
}

function intervalDurationMs(interval: BinanceInterval) {
  if (interval === "1h") return 60 * 60 * 1000;
  if (interval === "4h") return 4 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}
