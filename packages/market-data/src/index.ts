export { BinanceMarketDataAdapter, normalizeBinanceKlines } from "./binance.js";
export { FinnhubMarketDataAdapter, normalizeFinnhubResponse } from "./finnhub.js";
export type { FinnhubFetchResult } from "./finnhub.js";
export { FinnhubNewsAdapter, normalizeNewsResponse } from "./finnhub-news.js";
export type { FinnhubNewsFetchResult, NormalizedNewsItem } from "./finnhub-news.js";
export { saveCandles } from "./candles.js";
export { supportedBinanceIntervals, supportedFinnhubIntervals } from "./types.js";
export type { BinanceInterval, FinnhubInterval, CandleSource, NormalizedCandle } from "./types.js";
