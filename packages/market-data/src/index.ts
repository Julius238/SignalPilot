export { BinanceMarketDataAdapter, normalizeBinanceKlines } from "./binance.js";
export { FinnhubMarketDataAdapter, normalizeFinnhubResponse } from "./finnhub.js";
export type { FinnhubFetchResult } from "./finnhub.js";
export {
  FinnhubNewsAdapter,
  normalizeNewsResponse,
  normalizeGeneralNewsResponse
} from "./finnhub-news.js";
export type {
  FinnhubNewsFetchResult,
  NormalizedNewsItem,
  FinnhubGeneralNewsFetchResult,
  NormalizedGeneralNewsItem,
  GeneralNewsCategory
} from "./finnhub-news.js";
export { FinnhubEventsAdapter, normalizeEarningsCalendarResponse } from "./finnhub-events.js";
export type { FinnhubEventsFetchResult, NormalizedEarningsEvent } from "./finnhub-events.js";
export { saveCandles } from "./candles.js";
export { supportedBinanceIntervals, supportedFinnhubIntervals } from "./types.js";
export type { BinanceInterval, FinnhubInterval, CandleSource, NormalizedCandle } from "./types.js";
