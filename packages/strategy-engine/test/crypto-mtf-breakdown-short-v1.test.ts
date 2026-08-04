import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DecimalValue,
  RoundingMode,
  TradeDirection,
  checkPricePlanOrdering
} from "@signalpilot/trading-domain";

import { evaluateCryptoMtfBreakdownShortV1 } from "../src/crypto-mtf-breakdown-short-v1.js";
import { priorPeriodLow } from "../src/indicators-v1.js";
import {
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_PARAMETERS,
  CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH,
  CRYPTO_MTF_BREAKOUT_LONG_V1_PARAMETERS
} from "../src/specification-v1.js";
import {
  buildPassingSnapshot,
  clone,
  type SeriesShape
} from "./support/build-snapshot.js";

const d = (value: string) => DecimalValue.fromString(value);

/** Mirror of the bullish fixture shapes: falling drift, falling anchor. */
const BEAR_1H: SeriesShape = {
  base: 26000,
  drift: -15,
  waveAmplitude: 40,
  halfRange: 110,
  volume: 100,
  anchorMove: -420,
  anchorVolume: 320
};
const BEAR_4H: SeriesShape = {
  base: 24000,
  drift: -40,
  waveAmplitude: 60,
  halfRange: 200,
  volume: 400,
  anchorMove: -120,
  anchorVolume: 500
};
const BEAR_1D: SeriesShape = {
  base: 26000,
  drift: -70,
  waveAmplitude: 90,
  halfRange: 400,
  volume: 2000,
  anchorMove: -200,
  anchorVolume: 2400
};

/** A snapshot shaped for the short strategy: bearish series, signals and regime. */
function buildBearishSnapshot() {
  const snapshot = clone(
    buildPassingSnapshot({
      shapes: { "1h": BEAR_1H, "4h": BEAR_4H, "1d": BEAR_1D }
    })
  );

  snapshot.strategy.strategyKey = CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY;
  snapshot.strategy.engineVersion =
    CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION;
  snapshot.strategy.specificationHash =
    CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH;

  for (const timeframe of ["1h", "4h", "1d"] as const) {
    snapshot.signals[timeframe].direction = "BEARISH";
  }
  snapshot.multiTimeframe.alignment = "BEARISH_ALIGNED";
  snapshot.marketRegime.cryptoRegime = "RISK_OFF";
  snapshot.marketRegime.equityRegime = "RISK_OFF";
  snapshot.marketRegime.overallRegime = "RISK_OFF";

  return snapshot;
}

function reasons(
  result: ReturnType<typeof evaluateCryptoMtfBreakdownShortV1>
): readonly string[] {
  return result.checks
    .filter((check) => !check.passed)
    .map((check) => check.reasonCode);
}

describe("CRYPTO_MTF_BREAKDOWN_SHORT_V1 — specification", () => {
  it("is a separate identity from the long strategy", () => {
    assert.equal(
      CRYPTO_MTF_BREAKDOWN_SHORT_V1_PARAMETERS.key,
      "CRYPTO_MTF_BREAKDOWN_SHORT_V1"
    );
    assert.equal(CRYPTO_MTF_BREAKDOWN_SHORT_V1_PARAMETERS.direction, "SHORT");
    assert.notEqual(
      CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH,
      // Long and short must never share a specification hash (ADR 0011).
      CRYPTO_MTF_BREAKOUT_LONG_V1_PARAMETERS.key
    );
    assert.match(
      CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH,
      /^[0-9a-f]{64}$/
    );
  });

  it("declares a synthetic, unleveraged short with no borrow or funding model", () => {
    const p = CRYPTO_MTF_BREAKDOWN_SHORT_V1_PARAMETERS;
    assert.equal(p.syntheticShadowShort, true);
    assert.equal(p.leverageAllowed, false);
    assert.equal(p.marginAllowed, false);
    assert.equal(p.futuresAllowed, false);
    assert.equal(p.borrowModelled, false);
    assert.equal(p.fundingModelled, false);
    assert.equal(p.liquidationModelled, false);
    assert.equal(p.llmUsed, false);
  });

  it("requires RISK_OFF, a bearish RSI band and the documented price plan", () => {
    const p = CRYPTO_MTF_BREAKDOWN_SHORT_V1_PARAMETERS;
    assert.equal(p.regimeRequiredCryptoRegime, "RISK_OFF");
    assert.equal(p.rsiMinimum, "28");
    assert.equal(p.rsiMaximum, "50");
    assert.equal(p.breakdownLookback, 20);
    assert.equal(p.takeProfitRMultiple, "2.5");
    assert.equal(p.stopDistanceCapPct, "0.03");
    assert.equal(p.maxHoldHours, 72);
    assert.deepEqual([...p.allowedSymbols], ["BTCUSDT", "ETHUSDT"]);
  });

  it("keeps the long strategy on RISK_ON and its own bullish RSI band", () => {
    assert.equal(
      CRYPTO_MTF_BREAKOUT_LONG_V1_PARAMETERS.regimeRequiredCryptoRegime,
      "RISK_ON"
    );
    assert.equal(CRYPTO_MTF_BREAKOUT_LONG_V1_PARAMETERS.rsiMinimum, "50");
    assert.equal(CRYPTO_MTF_BREAKOUT_LONG_V1_PARAMETERS.direction, "LONG");
  });
});

describe("priorPeriodLow", () => {
  const candle = (low: string) => ({
    open: d("1"),
    high: d("1"),
    low: d(low),
    close: d("1"),
    volume: d("1")
  });

  it("excludes the anchor candle from its own reference window", () => {
    // 20 prior lows of 100, then an anchor that prints a much lower low. The
    // reference must stay 100 — otherwise the anchor would confirm against
    // itself.
    const candles = [
      ...Array.from({ length: 20 }, () => candle("100")),
      candle("1")
    ];
    assert.equal(priorPeriodLow(candles, 20)?.toString(), "100.000000000000");
  });

  it("returns the minimum of exactly the prior window", () => {
    const lows = ["105", "103", "99", "101"];
    const candles = [...lows.map(candle), candle("50")];
    assert.equal(priorPeriodLow(candles, 4)?.toString(), "99.000000000000");
  });

  it("returns null when there is not enough history", () => {
    assert.equal(priorPeriodLow([candle("100")], 20), null);
  });
});

describe("CRYPTO_MTF_BREAKDOWN_SHORT_V1 — evaluation", () => {
  it("produces a SHORT candidate on a confirmed bearish setup", () => {
    const result = evaluateCryptoMtfBreakdownShortV1(buildBearishSnapshot());
    assert.equal(result.outcome, "CANDIDATE", JSON.stringify(reasons(result)));
    assert.ok(result.candidate);
    assert.equal(result.candidate.direction, "SHORT");
    assert.equal(
      result.candidate.strategyKey,
      CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY
    );
    assert.equal(
      result.candidate.specificationHash,
      CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH
    );
    assert.equal(result.candidate.maxHoldHours, 72);
  });

  it("places the stop ABOVE and the take profit BELOW the entry", () => {
    const result = evaluateCryptoMtfBreakdownShortV1(buildBearishSnapshot());
    assert.ok(result.candidate);
    const entry = d(result.candidate.referenceEntryPrice);
    const stop = d(result.candidate.stopPrice);
    const takeProfit = d(result.candidate.takeProfitPrice);

    assert.ok(stop.gt(entry), "stop must be above the entry");
    assert.ok(entry.gt(takeProfit), "take profit must be below the entry");
    assert.equal(
      checkPricePlanOrdering({
        direction: TradeDirection.SHORT,
        entryPrice: result.candidate.referenceEntryPrice,
        stopPrice: result.candidate.stopPrice,
        takeProfitPrice: result.candidate.takeProfitPrice
      }).ok,
      true
    );
  });

  it("targets 2.5R gross and never plans below the 2.0R strategy floor", () => {
    const result = evaluateCryptoMtfBreakdownShortV1(buildBearishSnapshot());
    assert.ok(result.candidate);
    const entry = d(result.candidate.referenceEntryPrice);
    const stop = d(result.candidate.stopPrice);
    const takeProfit = d(result.candidate.takeProfitPrice);

    const risk = stop.sub(entry);
    const reward = entry.sub(takeProfit);
    // reward / risk == 2.5 exactly, by construction of the price plan.
    assert.equal(
      reward.toString(),
      risk.mul(d("2.5"), RoundingMode.FLOOR).toString()
    );
    assert.ok(d(result.candidate.plannedRewardRisk).gte(d("2")));
  });

  it("keeps the stop distance within the 3 % cap", () => {
    const result = evaluateCryptoMtfBreakdownShortV1(buildBearishSnapshot());
    assert.ok(result.candidate);
    assert.ok(d(result.candidate.stopDistancePct).lte(d("0.03")));
  });

  it("is deterministic — identical input, identical hashes", () => {
    const first = evaluateCryptoMtfBreakdownShortV1(buildBearishSnapshot());
    const second = evaluateCryptoMtfBreakdownShortV1(buildBearishSnapshot());
    assert.equal(first.inputHash, second.inputHash);
    assert.equal(first.outputHash, second.outputHash);
    assert.deepEqual(first.candidate, second.candidate);
  });
});

describe("CRYPTO_MTF_BREAKDOWN_SHORT_V1 — refusals", () => {
  it("refuses a RISK_ON regime — short trades only in RISK_OFF", () => {
    const snapshot = buildBearishSnapshot();
    snapshot.marketRegime.cryptoRegime = "RISK_ON";
    const result = evaluateCryptoMtfBreakdownShortV1(snapshot);
    assert.equal(result.outcome, "NO_CANDIDATE");
    assert.ok(reasons(result).includes("REGIME_NOT_RISK_OFF"));
  });

  it("refuses a neutral regime rather than treating it as close enough", () => {
    const snapshot = buildBearishSnapshot();
    snapshot.marketRegime.cryptoRegime = "NEUTRAL";
    assert.equal(
      evaluateCryptoMtfBreakdownShortV1(snapshot).outcome,
      "NO_CANDIDATE"
    );
  });

  it("refuses when the anchor close does not break the prior 20 lows", () => {
    const snapshot = buildBearishSnapshot();
    const candles = snapshot.series["1h"].candles;
    const anchor = candles[candles.length - 1];
    const previousClose = Number(candles[candles.length - 2].close);
    // A consistent candle that closes ABOVE the prior window instead of below
    // it, so the refusal comes from the breakdown rule and not from snapshot
    // validation rejecting an impossible OHLC.
    const lifted = previousClose + 500;
    anchor.open = previousClose.toFixed(6);
    anchor.high = (lifted + 10).toFixed(6);
    anchor.low = (previousClose - 10).toFixed(6);
    anchor.close = lifted.toFixed(6);

    const result = evaluateCryptoMtfBreakdownShortV1(snapshot);
    assert.equal(
      result.outcome,
      "NO_CANDIDATE",
      JSON.stringify(reasons(result))
    );
    assert.ok(reasons(result).includes("BREAKDOWN_NOT_CONFIRMED"));
  });

  it("refuses without volume confirmation", () => {
    const snapshot = buildBearishSnapshot();
    const candles = snapshot.series["1h"].candles;
    candles[candles.length - 1].volume = "1.000000";
    const result = evaluateCryptoMtfBreakdownShortV1(snapshot);
    assert.equal(result.outcome, "NO_CANDIDATE");
    assert.ok(reasons(result).includes("RELATIVE_VOLUME_BELOW_MINIMUM"));
  });

  it("refuses a bullish 4h or 1d confirmation signal", () => {
    for (const timeframe of ["4h", "1d"] as const) {
      const snapshot = buildBearishSnapshot();
      snapshot.signals[timeframe].direction = "BULLISH";
      const result = evaluateCryptoMtfBreakdownShortV1(snapshot);
      assert.equal(result.outcome, "NO_CANDIDATE", timeframe);
    }
  });

  it("refuses a bullish multi-timeframe alignment", () => {
    const snapshot = buildBearishSnapshot();
    snapshot.multiTimeframe.alignment = "BULLISH_ALIGNED";
    assert.equal(
      evaluateCryptoMtfBreakdownShortV1(snapshot).outcome,
      "NO_CANDIDATE"
    );
  });

  it("refuses stale data at pre-validation rather than evaluating it", () => {
    const snapshot = buildBearishSnapshot();
    snapshot.asOf = "2026-08-09T09:05:00.000Z"; // a week past the candle
    const result = evaluateCryptoMtfBreakdownShortV1(snapshot);
    // Stale input never reaches the entry rules: it is invalid, not merely
    // unconvincing.
    assert.equal(result.outcome, "INVALID_INPUT");
    assert.equal(result.candidate, null);
  });

  it("refuses a snapshot declaring the long identity", () => {
    const snapshot = buildBearishSnapshot();
    snapshot.strategy.strategyKey = "CRYPTO_MTF_BREAKOUT_LONG_V1";
    const result = evaluateCryptoMtfBreakdownShortV1(snapshot);
    assert.equal(result.outcome, "INVALID_INPUT");
    assert.ok(reasons(result).includes("STRATEGY_KEY_MISMATCH"));
  });

  it("refuses a bullish series even when every other bearish flag is set", () => {
    // Bullish price series with bearish metadata: the price structure itself
    // must decide, not the surrounding labels.
    const snapshot = clone(buildPassingSnapshot());
    snapshot.strategy.strategyKey = CRYPTO_MTF_BREAKDOWN_SHORT_V1_KEY;
    snapshot.strategy.engineVersion =
      CRYPTO_MTF_BREAKDOWN_SHORT_V1_ENGINE_VERSION;
    snapshot.strategy.specificationHash =
      CRYPTO_MTF_BREAKDOWN_SHORT_V1_SPECIFICATION_HASH;
    for (const timeframe of ["1h", "4h", "1d"] as const) {
      snapshot.signals[timeframe].direction = "BEARISH";
    }
    snapshot.multiTimeframe.alignment = "BEARISH_ALIGNED";
    snapshot.marketRegime.cryptoRegime = "RISK_OFF";

    const result = evaluateCryptoMtfBreakdownShortV1(snapshot);
    assert.equal(result.outcome, "NO_CANDIDATE");
    const failed = reasons(result);
    assert.ok(
      failed.includes("TREND_FILTER_1H_FAILED") ||
        failed.includes("BREAKDOWN_NOT_CONFIRMED"),
      `expected a trend or breakdown refusal, got ${failed.join(",")}`
    );
  });
});
