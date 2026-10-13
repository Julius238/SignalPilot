import {
  CRYPTO_MTF_BREAKOUT_V1,
  StrategyEvaluationOutcome,
  evaluateStrategy,
  type StrategyEvaluationResultV1,
  type StrategyInputSnapshotV1
} from "@signalpilot/strategy-engine";
import { DecimalValue, RoundingMode } from "@signalpilot/trading-domain";

/**
 * Test double for the strategy step only: on matching anchors it emits a
 * well-formed long candidate (tick-aligned stop `stopPct` below the close,
 * target 2.5R). Everything downstream of the strategy stays production code.
 */
export function forcedCandidates(options: {
  readonly every: (anchorCloseMs: number) => boolean;
  readonly stopPct: string;
  readonly tick?: string;
}): (snapshot: StrategyInputSnapshotV1) => StrategyEvaluationResultV1 {
  const tick = DecimalValue.fromString(options.tick ?? "0.01");
  return (snapshot) => {
    const real = evaluateStrategy(snapshot);
    const anchor = snapshot.series["1h"].candles.at(-1)!;
    if (real.outcome === StrategyEvaluationOutcome.INVALID_INPUT || !options.every(Date.parse(anchor.closeTime))) return real;

    const entry = DecimalValue.fromString(anchor.close);
    const stop = entry.mul(DecimalValue.ONE.sub(DecimalValue.fromString(options.stopPct)), RoundingMode.FLOOR).quantizeToStep(tick, RoundingMode.FLOOR);
    const distance = entry.sub(stop);
    const takeProfit = entry.add(distance.mul(DecimalValue.fromString("2.5"), RoundingMode.FLOOR)).quantizeToStep(tick, RoundingMode.FLOOR);
    const closeMs = Date.parse(anchor.closeTime);
    const candidateKey = `forced-${anchor.id}`;
    const candidate = {
      candidateKey,
      strategyKey: CRYPTO_MTF_BREAKOUT_V1.key,
      strategyVersionId: snapshot.strategy.strategyVersionId,
      strategyAssignmentId: snapshot.assignment.id,
      portfolioId: snapshot.assignment.portfolioId,
      assetId: snapshot.asset.id,
      symbol: snapshot.asset.symbol,
      anchorCandleId: anchor.id,
      anchorSignalId: snapshot.signals["1h"]?.id ?? null,
      direction: "LONG" as const,
      entryType: "MARKET" as const,
      status: "CREATED" as const,
      dataAsOf: snapshot.asOf,
      decisionTime: snapshot.asOf,
      validFrom: anchor.closeTime,
      earliestFillAt: anchor.closeTime,
      expiresAt: new Date(closeMs + 2 * 3600_000).toISOString(),
      referenceEntryPrice: entry.toString(),
      plannedEntryMinimum: stop.toString(),
      plannedEntryMaximum: entry.mul(DecimalValue.fromString("1.01"), RoundingMode.FLOOR).toString(),
      maximumEntryGapDistance: entry.mul(DecimalValue.fromString("0.01"), RoundingMode.FLOOR).toString(),
      stopPrice: stop.toString(),
      stopDistance: distance.toString(),
      stopDistancePct: distance.div(entry, RoundingMode.CEIL).toString(),
      takeProfitPrice: takeProfit.toString(),
      minimumRewardRisk: "2.000000000000",
      plannedRewardRisk: takeProfit.sub(entry).div(distance, RoundingMode.FLOOR).toString(),
      maxHoldHours: 72,
      indicators: {} as never,
      evidence: [],
      reasonCodes: [],
      engineVersion: CRYPTO_MTF_BREAKOUT_V1.engineVersion,
      specificationHash: CRYPTO_MTF_BREAKOUT_V1.specificationHash,
      inputHash: real.inputHash,
      outputHash: `forced-${real.inputHash}`
    };
    return {
      outcome: StrategyEvaluationOutcome.CANDIDATE,
      strategyKey: CRYPTO_MTF_BREAKOUT_V1.key,
      engineVersion: CRYPTO_MTF_BREAKOUT_V1.engineVersion,
      specificationHash: CRYPTO_MTF_BREAKOUT_V1.specificationHash,
      inputHash: real.inputHash,
      outputHash: candidate.outputHash,
      evaluatedAt: snapshot.asOf,
      reasonCodes: [],
      checks: real.checks,
      candidate
    } as StrategyEvaluationResultV1;
  };
}
