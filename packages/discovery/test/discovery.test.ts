import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultDiscoveryPolicy,
  evaluateInstrumentEligibility,
  scoreDiscoveryAsset,
  selectActiveUniverse,
  type DiscoveryCandle,
  type UniverseSelectionCandidate
} from "../src/index.js";

const now = new Date("2026-07-26T12:00:00.000Z");

function candles(count = 60, price = 100, volume = 2_000_000): DiscoveryCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = price * (1 + index * 0.002);
    return {
      openTime: new Date(now.getTime() - (count - index) * 86_400_000),
      closeTime: new Date(now.getTime() - (count - index - 1) * 86_400_000),
      open: close * 0.995,
      high: close * 1.015,
      low: close * 0.985,
      close,
      volume: index === count - 1 ? volume * 1.8 : volume
    };
  });
}

function candidate(
  overrides: Partial<UniverseSelectionCandidate> = {}
): UniverseSelectionCandidate {
  return {
    assetId: "asset-1",
    symbol: "AAA",
    assetType: "STOCK",
    sector: "Technology",
    score: 75,
    dataQuality: 90,
    liquidity: 90,
    eligible: true,
    isActive: false,
    isCore: false,
    isPinned: false,
    isManual: false,
    isExcluded: false,
    ...overrides
  };
}

describe("instrument eligibility", () => {
  it("rejects stablecoin pairs and leveraged products by default", () => {
    const stableReasons = evaluateInstrumentEligibility(
      {
        provider: "BINANCE",
        providerSymbol: "USDCUSDT",
        symbol: "USDCUSDT",
        name: "USDC / USDT",
        assetType: "CRYPTO",
        exchange: "BINANCE",
        baseCurrency: "USDC",
        quoteCurrency: "USDT",
        status: "ACTIVE",
        tradable: true,
        leveraged: false,
        inverse: false,
        stablecoin: true
      },
      defaultDiscoveryPolicy
    );
    const leveragedReasons = evaluateInstrumentEligibility(
      {
        provider: "FINNHUB",
        providerSymbol: "TQQQ",
        symbol: "TQQQ",
        name: "ProShares UltraPro QQQ",
        assetType: "ETF",
        exchange: "NASDAQ",
        status: "ACTIVE",
        tradable: true,
        leveraged: true,
        inverse: false,
        stablecoin: false
      },
      defaultDiscoveryPolicy
    );
    const leveragedTokenReasons = evaluateInstrumentEligibility(
      {
        provider: "BINANCE",
        providerSymbol: "ETHUPUSDT",
        symbol: "ETHUPUSDT",
        name: "ETHUP / USDT",
        assetType: "CRYPTO",
        exchange: "BINANCE",
        baseCurrency: "ETHUP",
        quoteCurrency: "USDT",
        status: "ACTIVE",
        tradable: true,
        leveraged: true,
        inverse: false,
        stablecoin: false
      },
      { ...defaultDiscoveryPolicy, allowLeveragedEtfs: true }
    );

    assert.ok(stableReasons.includes("STABLECOIN_PAIR"));
    assert.ok(leveragedReasons.includes("LEVERAGED_OR_INVERSE_NOT_ALLOWED"));
    assert.ok(leveragedTokenReasons.includes("LEVERAGED_OR_INVERSE_NOT_ALLOWED"));
  });
});

describe("discovery scoring", () => {
  it("hard-limits poor and incomplete data", () => {
    const result = scoreDiscoveryAsset(
      {
        assetType: "CRYPTO",
        snapshot: {
          provider: "BINANCE",
          providerSymbol: "FASTUSDT",
          observedAt: new Date("2026-07-20T12:00:00.000Z"),
          price: 10,
          quoteVolume24h: 500_000_000,
          baseVolume24h: 50_000_000,
          priceChangePercent24h: 25,
          high24h: 15,
          low24h: 7,
          tradeCount24h: 500_000
        },
        candles: candles(5),
        now
      },
      defaultDiscoveryPolicy
    );

    assert.equal(result.eligible, false);
    assert.ok(result.score <= defaultDiscoveryPolicy.maximumCandidateScoreWithoutCandles);
    assert.ok(result.exclusionReasons.includes("INSUFFICIENT_DATA_QUALITY"));
  });

  it("shrinks tiny historical samples instead of granting high confidence", () => {
    const result = scoreDiscoveryAsset(
      {
        assetType: "STOCK",
        candles: candles(),
        historicalSignals: { sampleSize: 1, winRate: 100, averageReturn: 8 },
        paperEvaluation: { sampleSize: 1, winRate: 100, averageReturn: 8 },
        now
      },
      defaultDiscoveryPolicy
    );

    assert.ok(result.components.historicalSignalQuality < 65);
    assert.ok(result.components.paperAndBacktestQuality < 65);
  });

  it("excludes illiquid assets even when trend and movement look attractive", () => {
    const result = scoreDiscoveryAsset(
      {
        assetType: "CRYPTO",
        snapshot: {
          provider: "BINANCE",
          providerSymbol: "TINYUSDT",
          observedAt: now,
          price: 1,
          quoteVolume24h: 5_000,
          baseVolume24h: 5_000,
          priceChangePercent24h: 6,
          high24h: 1.08,
          low24h: 0.96,
          tradeCount24h: 100
        },
        candles: candles(60, 1, 5_000),
        now
      },
      defaultDiscoveryPolicy
    );

    assert.equal(result.eligible, false);
    assert.ok(result.exclusionReasons.includes("INSUFFICIENT_LIQUIDITY"));
  });
});

describe("active universe selection", () => {
  it("never removes core, pinned, or manual assets", () => {
    const result = selectActiveUniverse(
      [
        candidate({
          assetId: "core",
          symbol: "SPY",
          score: 10,
          eligible: false,
          isActive: true,
          isCore: true
        }),
        candidate({
          assetId: "pin",
          symbol: "PIN",
          score: 10,
          eligible: false,
          isActive: true,
          isPinned: true
        }),
        candidate({
          assetId: "manual",
          symbol: "MAN",
          score: 10,
          eligible: false,
          isActive: true,
          isManual: true
        })
      ],
      defaultDiscoveryPolicy,
      now
    );

    assert.deepEqual(new Set(result.selectedAssetIds), new Set(["core", "pin", "manual"]));
    assert.equal(result.removals.length, 0);
  });

  it("never selects excluded assets", () => {
    const result = selectActiveUniverse(
      [candidate({ assetId: "excluded", isExcluded: true, score: 99 })],
      defaultDiscoveryPolicy,
      now
    );
    assert.equal(result.additions.length, 0);
    assert.equal(result.decisions[0]?.reason, "USER_EXCLUDED");
  });

  it("scans observe-only assets without proposing them for active analysis", () => {
    const result = selectActiveUniverse(
      [candidate({ assetId: "observe", isObserveOnly: true, score: 99 })],
      defaultDiscoveryPolicy,
      now
    );
    assert.equal(result.additions.length, 0);
    assert.equal(result.decisions[0]?.reason, "USER_OBSERVE_ONLY");
  });

  it("limits correlated candidates and requires a material replacement delta", () => {
    const policy = {
      ...defaultDiscoveryPolicy,
      activeLimits: { ...defaultDiscoveryPolicy.activeLimits, STOCK: 2 },
      maxPerSector: 5,
      maxCorrelatedAssets: 1,
      maxAdditionsPerRun: 2,
      maxRemovalsPerRun: 2
    };
    const activeSince = new Date("2026-07-01T00:00:00.000Z");
    const belowDelta = selectActiveUniverse(
      [
        candidate({
          assetId: "active",
          symbol: "ACTIVE",
          score: 70,
          isActive: true,
          activeSince,
          correlationGroup: "tech-growth"
        }),
        candidate({
          assetId: "new",
          symbol: "NEW",
          score: 77,
          correlationGroup: "tech-growth"
        })
      ],
      policy,
      now
    );
    assert.equal(belowDelta.additions.length, 0);

    const aboveDelta = selectActiveUniverse(
      [
        candidate({
          assetId: "active",
          symbol: "ACTIVE",
          score: 70,
          isActive: true,
          activeSince,
          correlationGroup: "tech-growth"
        }),
        candidate({
          assetId: "new",
          symbol: "NEW",
          score: 79,
          correlationGroup: "tech-growth"
        })
      ],
      policy,
      now
    );
    assert.equal(aboveDelta.additions[0]?.assetId, "new");
    assert.equal(aboveDelta.removals[0]?.assetId, "active");
  });

  it("honors minimum holding time and removal cooldown", () => {
    const policy = {
      ...defaultDiscoveryPolicy,
      activeLimits: { ...defaultDiscoveryPolicy.activeLimits, STOCK: 1 }
    };
    const youngActive = candidate({
      assetId: "young",
      symbol: "YOUNG",
      score: 65,
      isActive: true,
      activeSince: new Date("2026-07-24T00:00:00.000Z")
    });
    const better = candidate({
      assetId: "better",
      symbol: "BETTER",
      score: 90,
      cooldownUntil: new Date("2026-08-01T00:00:00.000Z")
    });
    const result = selectActiveUniverse([youngActive, better], policy, now);

    assert.equal(result.removals.length, 0);
    assert.equal(result.additions.length, 0);
    assert.ok(result.selectedAssetIds.includes("young"));
  });

  it("reduces over-cap automatic incumbents while keeping user overrides", () => {
    const policy = {
      ...defaultDiscoveryPolicy,
      activeLimits: { ...defaultDiscoveryPolicy.activeLimits, STOCK: 2 },
      maxPerSector: 10,
      maxRemovalsPerRun: 3
    };
    const activeSince = new Date("2026-07-01T00:00:00.000Z");
    const result = selectActiveUniverse(
      [
        candidate({
          assetId: "pinned",
          symbol: "PIN",
          score: 20,
          isActive: true,
          isPinned: true,
          activeSince
        }),
        candidate({
          assetId: "strong-auto",
          symbol: "STRONG",
          score: 85,
          isActive: true,
          activeSince
        }),
        candidate({
          assetId: "weak-auto",
          symbol: "WEAK",
          score: 65,
          isActive: true,
          activeSince
        })
      ],
      policy,
      now
    );

    assert.ok(result.selectedAssetIds.includes("pinned"));
    assert.ok(result.selectedAssetIds.includes("strong-auto"));
    assert.equal(result.removals[0]?.assetId, "weak-auto");
  });
});
