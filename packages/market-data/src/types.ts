export const supportedBinanceIntervals = ["1h", "4h", "1d"] as const;

export type BinanceInterval = (typeof supportedBinanceIntervals)[number];

export type CandleSource = "BINANCE";

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
