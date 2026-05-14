export interface HealthResponse {
  status: "ok";
  service: "signalpilot-api";
}

export type AssetClass = "stock" | "etf" | "crypto";
