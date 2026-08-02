/**
 * Strategy registry.
 *
 * Specification: docs/trading/05-strategy-v1-specification.md ("`CRYPTO_MTF_BREAKOUT_V1`
 * ist der erste und einzige vertikale Schnitt") and docs/trading/03-domain-model.md
 * ("Eine `Strategy` entscheidet nie selbst; nur eine immutable `StrategyVersion`
 * ist ausführbar").
 *
 * The registry is a closed lookup table, not a plugin loader: an unknown key can
 * never resolve to "something similar". A snapshot whose key is not registered
 * is refused with `STRATEGY_KEY_UNKNOWN`.
 */

import { buildInputHash, buildOutputHash } from "@signalpilot/trading-domain";

import type { StrategyDefinitionV1, StrategyEvaluationResultV1, StrategyInputSnapshotV1 } from "./contracts.js";
import { evaluateCryptoMtfBreakoutV1 } from "./crypto-mtf-breakout-v1.js";
import { StrategyCheckStage, StrategyEvaluationOutcome, StrategyReasonCode } from "./reason-codes.js";
import {
  CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
  CRYPTO_MTF_BREAKOUT_V1_KEY,
  CRYPTO_MTF_BREAKOUT_V1_PARAMETERS,
  CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH
} from "./specification-v1.js";

export const CRYPTO_MTF_BREAKOUT_V1: StrategyDefinitionV1 = Object.freeze({
  key: CRYPTO_MTF_BREAKOUT_V1_KEY,
  engineVersion: CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
  specificationHash: CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
  parameters: CRYPTO_MTF_BREAKOUT_V1_PARAMETERS,
  evaluate: evaluateCryptoMtfBreakoutV1
});

const REGISTRY = new Map<string, StrategyDefinitionV1>([
  [CRYPTO_MTF_BREAKOUT_V1.key, CRYPTO_MTF_BREAKOUT_V1]
]);

export const STRATEGY_REGISTRY: ReadonlyMap<string, StrategyDefinitionV1> = REGISTRY;

/** Registered strategy keys, sorted — stable input for capability tests. */
export const REGISTERED_STRATEGY_KEYS: readonly string[] = Object.freeze(
  [...REGISTRY.keys()].sort()
);

export function getStrategy(key: string): StrategyDefinitionV1 | null {
  return REGISTRY.get(key) ?? null;
}

/**
 * Resolve the strategy from the snapshot and evaluate it. An unregistered key
 * yields `INVALID_INPUT` — the engine never guesses a strategy.
 */
export function evaluateStrategy(snapshot: StrategyInputSnapshotV1): StrategyEvaluationResultV1 {
  const key = typeof snapshot?.strategy?.strategyKey === "string" ? snapshot.strategy.strategyKey : "";
  const strategy = getStrategy(key);
  if (strategy !== null) return strategy.evaluate(snapshot);

  const inputHash = buildInputHash(snapshot);
  const checks = Object.freeze([
    {
      checkId: "STRATEGY_REGISTERED",
      stage: StrategyCheckStage.PRE_VALIDATION,
      passed: false,
      reasonCode: StrategyReasonCode.STRATEGY_KEY_UNKNOWN,
      actual: key,
      limit: REGISTERED_STRATEGY_KEYS.join(",")
    }
  ]);
  const reasonCodes = Object.freeze([StrategyReasonCode.STRATEGY_KEY_UNKNOWN]);
  const core = {
    outcome: StrategyEvaluationOutcome.INVALID_INPUT,
    strategyKey: key,
    engineVersion: CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
    specificationHash: CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
    inputHash,
    reasonCodes,
    checks,
    candidate: null
  };

  return {
    outcome: StrategyEvaluationOutcome.INVALID_INPUT,
    strategyKey: key,
    engineVersion: CRYPTO_MTF_BREAKOUT_V1_ENGINE_VERSION,
    specificationHash: CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH,
    inputHash,
    outputHash: buildOutputHash(core),
    evaluatedAt: typeof snapshot?.asOf === "string" ? snapshot.asOf : "1970-01-01T00:00:00.000Z",
    reasonCodes,
    checks,
    primaryReasonCode: StrategyReasonCode.STRATEGY_KEY_UNKNOWN,
    candidate: null
  };
}
