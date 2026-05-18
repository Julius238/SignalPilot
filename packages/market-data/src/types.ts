export const supportedBinanceIntervals = ["1h", "4h", "1d"] as const;
export type BinanceInterval = (typeof supportedBinanceIntervals)[number];

export const supportedFinnhubIntervals = ["1h", "1d"] as const;
export type FinnhubInterval = (typeof supportedFinnhubIntervals)[number];

export type CandleSource = "BINANCE" | "FINNHUB";

export type NormalizedCandle = {
  symbol: string;
  timeframe: BinanceInterval;
  openTime: Date;
  closeTime: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  source: CandleSource;
};
