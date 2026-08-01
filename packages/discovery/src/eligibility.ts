import type { DiscoveryInstrument, DiscoveryPolicy } from "./types.js";

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

const unsuitableNamePatterns = [
  /\btest\b/i,
  /\bdelisted\b/i,
  /\bnon[- ]tradable\b/i,
  /\bwarrant\b/i,
  /\bright\b/i,
  /\bunit\b/i
];

export function evaluateInstrumentEligibility(
  instrument: DiscoveryInstrument,
  policy: DiscoveryPolicy
): string[] {
  const reasons: string[] = [];

  if (!instrument.symbol || !instrument.providerSymbol || !instrument.exchange) {
    reasons.push("AMBIGUOUS_IDENTITY");
  }
  if (!instrument.tradable) reasons.push("NOT_TRADABLE");
  if (instrument.status === "DELISTED" || instrument.status === "INACTIVE") {
    reasons.push("INACTIVE_OR_DELISTED");
  }
  if (
    unsuitableNamePatterns.some((pattern) => pattern.test(instrument.name)) ||
    unsuitableNamePatterns.some((pattern) => pattern.test(instrument.symbol))
  ) {
    reasons.push("UNSUITABLE_INSTRUMENT");
  }
  if (
    (instrument.leveraged || instrument.inverse) &&
    !(instrument.assetType === "ETF" && policy.allowLeveragedEtfs)
  ) {
    reasons.push("LEVERAGED_OR_INVERSE_NOT_ALLOWED");
  }
  if (instrument.assetType === "CRYPTO") {
    const baseStable =
      instrument.stablecoin || stablecoins.has(instrument.baseCurrency?.toUpperCase() ?? "");
    const quoteStable = stablecoins.has(instrument.quoteCurrency?.toUpperCase() ?? "");

    if (baseStable && quoteStable) reasons.push("STABLECOIN_PAIR");
    if (baseStable && !policy.allowStablecoins) reasons.push("STABLECOIN_NOT_ALLOWED");
  }

  return [...new Set(reasons)];
}

export function isKnownStablecoin(symbol: string | null | undefined): boolean {
  return stablecoins.has(symbol?.toUpperCase() ?? "");
}
