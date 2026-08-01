import type {
  DiscoveryCandle,
  DiscoveryInstrument,
  DiscoveryMarketSnapshot
} from "@signalpilot/discovery";

import { BinanceMarketDataAdapter, type FetchLike as BinanceFetchLike } from "./binance.js";
import { FinnhubMarketDataAdapter } from "./finnhub.js";
import { classifyProviderHttpError, toTemporaryProviderError } from "./provider-errors.js";

export type DiscoveryProviderUsage = {
  requestCount: number;
  estimatedApiUnits: number;
};

export type DiscoveryProviderResult<T> = {
  data: T;
  usage: DiscoveryProviderUsage;
};

export interface AssetDiscoveryProvider {
  readonly id: string;
  readonly assetTypes: ReadonlyArray<DiscoveryInstrument["assetType"]>;
  listInstruments(): Promise<DiscoveryProviderResult<DiscoveryInstrument[]>>;
  fetchMarketSnapshots(): Promise<DiscoveryProviderResult<DiscoveryMarketSnapshot[]>>;
  fetchVerificationCandles(
    instrument: DiscoveryInstrument,
    limit: number,
    now?: Date
  ): Promise<DiscoveryProviderResult<DiscoveryCandle[]>>;
}

type BinanceExchangeSymbol = {
  symbol?: unknown;
  status?: unknown;
  baseAsset?: unknown;
  quoteAsset?: unknown;
  isSpotTradingAllowed?: unknown;
  permissions?: unknown;
};

type BinanceExchangeInfo = { symbols?: BinanceExchangeSymbol[] };
type BinanceTicker = {
  symbol?: unknown;
  lastPrice?: unknown;
  quoteVolume?: unknown;
  volume?: unknown;
  priceChangePercent?: unknown;
  highPrice?: unknown;
  lowPrice?: unknown;
  count?: unknown;
  closeTime?: unknown;
};
type FinnhubSymbol = {
  currency?: unknown;
  description?: unknown;
  displaySymbol?: unknown;
  figi?: unknown;
  mic?: unknown;
  symbol?: unknown;
  type?: unknown;
};

const stablecoins = new Set([
  "USDT",
  "USDC",
  "BUSD",
  "FDUSD",
  "TUSD",
  "DAI",
  "USDP",
  "EURT",
  "PYUSD"
]);

export class BinanceDiscoveryProvider implements AssetDiscoveryProvider {
  readonly id = "BINANCE";
  readonly assetTypes = ["CRYPTO"] as const;
  private readonly baseUrl: string;
  private readonly fetchClient: BinanceFetchLike;
  private readonly candleAdapter: BinanceMarketDataAdapter;

  constructor(options: { baseUrl?: string; fetchClient?: BinanceFetchLike } = {}) {
    this.baseUrl = options.baseUrl ?? process.env.BINANCE_BASE_URL ?? "https://api.binance.com";
    this.fetchClient = options.fetchClient ?? fetch;
    this.candleAdapter = new BinanceMarketDataAdapter({
      baseUrl: this.baseUrl,
      fetchClient: this.fetchClient
    });
  }

  async listInstruments(): Promise<DiscoveryProviderResult<DiscoveryInstrument[]>> {
    const payload = await this.fetchJson("/api/v3/exchangeInfo", "exchangeInfo");
    const symbols =
      typeof payload === "object" && payload !== null
        ? (payload as BinanceExchangeInfo).symbols
        : undefined;
    if (!Array.isArray(symbols)) throw new Error("Invalid Binance exchangeInfo response.");

    return {
      data: symbols.flatMap(normalizeBinanceInstrument),
      usage: { requestCount: 1, estimatedApiUnits: 20 }
    };
  }

  async fetchMarketSnapshots(): Promise<
    DiscoveryProviderResult<DiscoveryMarketSnapshot[]>
  > {
    const payload = await this.fetchJson("/api/v3/ticker/24hr", "ticker/24hr");
    if (!Array.isArray(payload)) throw new Error("Invalid Binance 24h ticker response.");
    return {
      data: payload.flatMap(normalizeBinanceSnapshot),
      usage: { requestCount: 1, estimatedApiUnits: 40 }
    };
  }

  async fetchVerificationCandles(
    instrument: DiscoveryInstrument,
    limit: number
  ): Promise<DiscoveryProviderResult<DiscoveryCandle[]>> {
    const candles = await this.candleAdapter.fetchKlines(instrument.providerSymbol, "1h", {
      limit: Math.min(500, Math.max(40, limit)),
      retry: {
        maxAttempts: Number(process.env.PROVIDER_RETRY_MAX_ATTEMPTS ?? 3),
        baseDelayMs: Number(process.env.PROVIDER_RETRY_BASE_DELAY_MS ?? 500),
        maxDelayMs: Number(process.env.PROVIDER_RETRY_MAX_DELAY_MS ?? 8_000)
      }
    });
    return {
      data: candles.map((candle) => ({
        openTime: candle.openTime,
        closeTime: candle.closeTime,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume: Number(candle.volume),
        timeframe: candle.timeframe
      })),
      usage: { requestCount: 1, estimatedApiUnits: 2 }
    };
  }

  private async fetchJson(path: string, endpoint: string): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    let response: Response;
    try {
      response = await this.fetchClient(url);
    } catch {
      throw toTemporaryProviderError(this.id, endpoint);
    }
    if (!response.ok) {
      const hint = await response.text().catch(() => "");
      throw classifyProviderHttpError(this.id, endpoint, response.status, hint);
    }
    return response.json();
  }
}

export class FinnhubDiscoveryProvider implements AssetDiscoveryProvider {
  readonly id = "FINNHUB";
  readonly assetTypes = ["STOCK", "ETF"] as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchClient: typeof fetch;
  private readonly candleAdapter: FinnhubMarketDataAdapter;

  constructor(options: {
    baseUrl?: string;
    apiKey?: string;
    fetchClient?: typeof fetch;
  } = {}) {
    this.baseUrl = options.baseUrl ?? "https://finnhub.io";
    this.apiKey = options.apiKey ?? process.env.FINNHUB_API_KEY ?? "";
    this.fetchClient = options.fetchClient ?? fetch;
    this.candleAdapter = new FinnhubMarketDataAdapter({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      fetchClient: this.fetchClient
    });
  }

  async listInstruments(): Promise<DiscoveryProviderResult<DiscoveryInstrument[]>> {
    if (!this.apiKey) throw new Error("FINNHUB_API_KEY environment variable is not set.");
    const url = new URL("/api/v1/stock/symbol", this.baseUrl);
    url.searchParams.set("exchange", "US");
    url.searchParams.set("token", this.apiKey);
    let response: Response;
    try {
      response = await this.fetchClient(url);
    } catch {
      throw toTemporaryProviderError(this.id, "stock/symbol");
    }
    if (!response.ok) {
      const hint = await response.text().catch(() => "");
      throw classifyProviderHttpError(this.id, "stock/symbol", response.status, hint);
    }
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error("Invalid Finnhub stock symbol response.");
    return {
      data: payload.flatMap(normalizeFinnhubInstrument),
      usage: { requestCount: 1, estimatedApiUnits: 1 }
    };
  }

  async fetchMarketSnapshots(): Promise<
    DiscoveryProviderResult<DiscoveryMarketSnapshot[]>
  > {
    // The current Finnhub integration has no economical batch snapshot endpoint.
    // A bounded rotating shortlist is verified via daily candles instead.
    return { data: [], usage: { requestCount: 0, estimatedApiUnits: 0 } };
  }

  async fetchVerificationCandles(
    instrument: DiscoveryInstrument,
    limit: number,
    now: Date = new Date()
  ): Promise<DiscoveryProviderResult<DiscoveryCandle[]>> {
    const lookbackDays = Math.max(60, Math.ceil(limit * 1.8));
    const result = await this.candleAdapter.fetchStockCandles(
      instrument.providerSymbol,
      "1d",
      new Date(now.getTime() - lookbackDays * 86_400_000),
      now
    );
    if (result.kind !== "ok") {
      if (result.kind === "no_data" || result.kind === "unsupported_symbol") {
        return { data: [], usage: { requestCount: 1, estimatedApiUnits: 1 } };
      }
      throw new Error(`Finnhub verification candles failed: ${result.kind}`);
    }
    return {
      data: result.candles.slice(-limit).map((candle) => ({
        openTime: candle.openTime,
        closeTime: candle.closeTime,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume: Number(candle.volume),
        timeframe: candle.timeframe
      })),
      usage: { requestCount: 1, estimatedApiUnits: 1 }
    };
  }
}

export function createDefaultDiscoveryProviders(): AssetDiscoveryProvider[] {
  const providers: AssetDiscoveryProvider[] = [new BinanceDiscoveryProvider()];
  if (process.env.FINNHUB_API_KEY) providers.push(new FinnhubDiscoveryProvider());
  return providers;
}

function normalizeBinanceInstrument(entry: unknown): DiscoveryInstrument[] {
  if (!entry || typeof entry !== "object") return [];
  const value = entry as BinanceExchangeSymbol;
  const symbol = stringValue(value.symbol);
  const baseCurrency = stringValue(value.baseAsset);
  const quoteCurrency = stringValue(value.quoteAsset);
  if (!symbol || !baseCurrency || !quoteCurrency) return [];
  const status = stringValue(value.status);
  const permissions = Array.isArray(value.permissions) ? value.permissions.map(String) : [];
  const tradable =
    status === "TRADING" &&
    value.isSpotTradingAllowed !== false &&
    (permissions.length === 0 || permissions.includes("SPOT"));
  const leveraged = /(?:UP|DOWN|BULL|BEAR)$/.test(baseCurrency);
  return [
    {
      provider: "BINANCE",
      providerSymbol: symbol,
      symbol,
      name: `${baseCurrency} / ${quoteCurrency}`,
      assetType: "CRYPTO",
      exchange: "BINANCE",
      baseCurrency,
      quoteCurrency,
      status: status === "TRADING" ? "ACTIVE" : "INACTIVE",
      tradable,
      leveraged,
      inverse: /(?:DOWN|BEAR)$/.test(baseCurrency),
      stablecoin: stablecoins.has(baseCurrency),
      metadata: { permissions, isSpotTradingAllowed: value.isSpotTradingAllowed !== false }
    }
  ];
}

function normalizeBinanceSnapshot(entry: unknown): DiscoveryMarketSnapshot[] {
  if (!entry || typeof entry !== "object") return [];
  const value = entry as BinanceTicker;
  const providerSymbol = stringValue(value.symbol);
  if (!providerSymbol) return [];
  return [
    {
      provider: "BINANCE",
      providerSymbol,
      observedAt: dateValue(value.closeTime) ?? new Date(),
      price: numberValue(value.lastPrice),
      quoteVolume24h: numberValue(value.quoteVolume),
      baseVolume24h: numberValue(value.volume),
      priceChangePercent24h: numberValue(value.priceChangePercent),
      high24h: numberValue(value.highPrice),
      low24h: numberValue(value.lowPrice),
      tradeCount24h: numberValue(value.count)
    }
  ];
}

function normalizeFinnhubInstrument(entry: unknown): DiscoveryInstrument[] {
  if (!entry || typeof entry !== "object") return [];
  const value = entry as FinnhubSymbol;
  const providerSymbol = stringValue(value.symbol);
  const displaySymbol = stringValue(value.displaySymbol) ?? providerSymbol;
  const description = stringValue(value.description);
  const type = stringValue(value.type) ?? "UNKNOWN";
  const mic = stringValue(value.mic);
  if (!providerSymbol || !displaySymbol) return [];
  const name = description ?? displaySymbol;
  const assetType = /\b(ETF|ETP|FUND)\b/i.test(type) ? "ETF" : "STOCK";
  if (!/\b(COMMON STOCK|ADR|ETF|ETP|FUND)\b/i.test(type)) return [];
  const leveraged = /\b(2X|3X|ULTRA|LEVERAGED)\b/i.test(name);
  const inverse = /\b(INVERSE|SHORT|BEAR)\b/i.test(name);
  return [
    {
      provider: "FINNHUB",
      providerSymbol,
      symbol: displaySymbol,
      name,
      assetType,
      exchange: mic ?? "US",
      mic,
      currency: stringValue(value.currency),
      status: "ACTIVE",
      tradable: true,
      leveraged,
      inverse,
      stablecoin: false,
      metadata: { figi: stringValue(value.figi), instrumentType: type }
    }
  ];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateValue(value: unknown) {
  const parsed = numberValue(value);
  if (parsed === null) return null;
  const date = new Date(parsed);
  return Number.isFinite(date.getTime()) ? date : null;
}
