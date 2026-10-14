/**
 * Which market regime a strategy version reads.
 *
 * `MarketRegimeSnapshot` columns hold the production report
 * (`calculateMarketRegimeReport`); the regime job stores the versioned
 * crypto-native report next to it under `reportJson.cryptoNative`. A strategy
 * version declares its model in `parameters.regimeSource` (absent = the
 * production report). Strategy and risk assemblers both select through this
 * module, so a candidate is never decided under one regime and approved under
 * another. A missing or unknown model yields `null` — fail closed, never the
 * other report.
 */

import { CRYPTO_NATIVE_REGIME_SOURCE } from "@signalpilot/strategy-engine";

export interface StoredRegimeSnapshot {
  readonly id: string;
  readonly generatedAt: Date;
  readonly equityRegime: string;
  readonly cryptoRegime: string;
  readonly overallRegime: string;
  readonly riskMode: string;
  readonly confidence: number;
  readonly reportJson: unknown;
}

export interface SelectedRegime {
  readonly id: string;
  readonly generatedAt: Date;
  readonly equityRegime: string;
  readonly cryptoRegime: string;
  readonly overallRegime: string;
  readonly riskMode: string;
  readonly confidence: number;
  /** Set for every model except the production report. */
  readonly source?: string;
}

export function regimeSourceOf(parametersJson: unknown): string | null {
  if (parametersJson === null || typeof parametersJson !== "object") return null;
  const source = (parametersJson as { regimeSource?: unknown }).regimeSource;
  return typeof source === "string" && source !== "" ? source : null;
}

export function selectRegimeForStrategy(
  snapshot: StoredRegimeSnapshot | null,
  regimeSource: string | null
): SelectedRegime | null {
  if (snapshot === null) return null;
  if (regimeSource === null) {
    return {
      id: snapshot.id,
      generatedAt: snapshot.generatedAt,
      equityRegime: snapshot.equityRegime,
      cryptoRegime: snapshot.cryptoRegime,
      overallRegime: snapshot.overallRegime,
      riskMode: snapshot.riskMode,
      confidence: snapshot.confidence
    };
  }
  if (regimeSource !== CRYPTO_NATIVE_REGIME_SOURCE) return null;

  const report =
    snapshot.reportJson !== null && typeof snapshot.reportJson === "object"
      ? (snapshot.reportJson as { cryptoNative?: unknown }).cryptoNative
      : undefined;
  if (report === null || typeof report !== "object") return null;
  const { equityRegime, cryptoRegime, overallRegime, riskMode, confidence } = report as Record<string, unknown>;
  if (
    typeof equityRegime !== "string" ||
    typeof cryptoRegime !== "string" ||
    typeof overallRegime !== "string" ||
    typeof riskMode !== "string" ||
    typeof confidence !== "number" ||
    !Number.isFinite(confidence)
  ) {
    return null;
  }
  return {
    // Same row, same generation time: the crypto-native report is computed
    // from the same benchmarks in the same job run as the columns.
    id: snapshot.id,
    generatedAt: snapshot.generatedAt,
    equityRegime,
    cryptoRegime,
    overallRegime,
    riskMode,
    confidence,
    source: regimeSource
  };
}
