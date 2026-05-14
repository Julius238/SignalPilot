export interface HealthResponse {
  status: "ok";
  service: "signalpilot-api";
}

export type AssetClass = "stock" | "etf" | "crypto";

export interface IndicatorSnapshot {
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  rsi14: number | null;
  atr14: number | null;
  averageVolume20: number | null;
  relativeVolume: number | null;
  periodHigh20: number | null;
  periodLow20: number | null;
  lastClose: number | null;
  lastVolume: number | null;
  candleCount: number;
}
