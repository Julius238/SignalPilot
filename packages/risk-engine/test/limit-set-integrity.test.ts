/**
 * Integrity of the stored risk limit set (ADR 0021, option A).
 *
 * Every case keeps the pinned v1 specification hash, so a passing case can
 * only come from the values themselves. The bypasses confirmed synthetically
 * on 2026-10-18 (probe P1–P6) are pinned here as refusals.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DecimalValue } from "@signalpilot/trading-domain";

import {
  RISK_LIMIT_SET_DECIMAL_FIELDS,
  RISK_LIMIT_SET_EXACT_FIELDS,
  RISK_LIMIT_SET_SPECIFICATION_HASH,
  RISK_LIMIT_SET_V1,
  RiskReasonCode,
  RiskRuleCode,
  evaluateRisk,
  riskLimitSetDeviations,
  type RiskInputSnapshotV1,
  type RiskLimitSetInputV1
} from "../src/index.js";

import {
  STRATEGY_V1_TAKE_PROFIT,
  buildApprovableSnapshot,
  clone,
  type DeepMutable
} from "./support/build-risk-snapshot.js";

type MutableSnapshot = DeepMutable<RiskInputSnapshotV1>;

const mutate = (
  change: (snapshot: MutableSnapshot) => void,
  base: RiskInputSnapshotV1 = buildApprovableSnapshot()
): RiskInputSnapshotV1 => {
  const snapshot = clone(base);
  change(snapshot);
  return snapshot as RiskInputSnapshotV1;
};

const pinnedSet = (): RiskLimitSetInputV1 => buildApprovableSnapshot().riskLimitSet!;

/** The pinned values the way `Decimal(30,12)` columns reach the snapshot. */
const twelvePlaces = (set: RiskLimitSetInputV1): RiskLimitSetInputV1 => ({
  ...set,
  maxRiskPerTradePct: "0.002500000000",
  maxDailyLossPct: "0.010000000000",
  minRewardRisk: "2.000000000000",
  maxGrossExposurePct: "0.400000000000",
  maxAssetExposurePct: "0.200000000000",
  maxCorrelatedExposurePct: "0.300000000000"
});

const r026 = (snapshot: RiskInputSnapshotV1) => {
  const rule = evaluateRisk(snapshot).ruleResults.find(
    (result) => result.ruleCode === RiskRuleCode.IDEMPOTENCY_VERSION
  );
  assert.ok(rule);
  return rule;
};

/** A refused set: ERROR, ERROR_LOCK, nothing approved, R-026 names the fields. */
const assertRefused = (
  snapshot: RiskInputSnapshotV1,
  fields: readonly string[],
  label: string
) => {
  const result = evaluateRisk(snapshot);
  assert.equal(result.outcome, "ERROR", label);
  assert.equal(result.directive, "ERROR_LOCK", label);
  assert.equal(result.assessment.approvedQuantity, "0.000000000000", label);
  assert.equal(result.assessment.riskAmount, "0.000000000000", label);
  assert.equal(result.decision.outcome, "ERROR", label);
  const rule = r026(snapshot);
  assert.equal(rule.outcome, "ERROR", label);
  assert.equal(rule.severity, "CRITICAL", label);
  assert.equal(rule.reasonCode, RiskReasonCode.IDEMPOTENCY_OR_VERSION_CONFLICT, label);
  assert.deepEqual(rule.inputJson.riskLimitSetDeviations, [...fields], label);
};

describe("riskLimitSetDeviations", () => {
  it("accepts the pinned v1 set in the constant's and in the database's decimal form", () => {
    assert.deepEqual(riskLimitSetDeviations(pinnedSet()), []);
    assert.deepEqual(riskLimitSetDeviations(twelvePlaces(pinnedSet())), []);
    assert.deepEqual(
      riskLimitSetDeviations({
        ...pinnedSet(),
        maxRiskPerTradePct: "0.00250",
        minRewardRisk: "2.0",
        maxGrossExposurePct: "0.40000"
      }),
      []
    );
  });

  it("names every decimal field that is raised or lowered", () => {
    for (const field of RISK_LIMIT_SET_DECIMAL_FIELDS) {
      const pinned = DecimalValue.fromString(RISK_LIMIT_SET_V1[field]);
      const step = DecimalValue.fromString("0.000000000001");
      for (const value of [pinned.add(step), pinned.sub(step)]) {
        assert.deepEqual(
          riskLimitSetDeviations({ ...pinnedSet(), [field]: value.toString() }),
          [field],
          `${field}=${value.toString()}`
        );
      }
    }
  });

  it("names every identity and integer field that differs", () => {
    const changed: Record<(typeof RISK_LIMIT_SET_EXACT_FIELDS)[number], unknown> = {
      key: "SHADOW_V2",
      version: 2,
      scope: "STRATEGY",
      maxOpenPositions: 3,
      maxNewTradesPerDay: 5,
      maxConsecutiveLosses: 4,
      maxSpreadBps: 21,
      maxSlippageBps: 16
    };
    for (const field of RISK_LIMIT_SET_EXACT_FIELDS) {
      assert.deepEqual(
        riskLimitSetDeviations({ ...pinnedSet(), [field]: changed[field] } as RiskLimitSetInputV1),
        [field],
        field
      );
    }
    // Type confusion is a deviation too, not a coercion.
    assert.deepEqual(
      riskLimitSetDeviations({ ...pinnedSet(), version: "1" } as never),
      ["version"]
    );
  });

  it("does not let the stored hash vouch for different numbers", () => {
    const tampered = { ...pinnedSet(), maxRiskPerTradePct: "0.01" };
    assert.equal(tampered.specificationHash, RISK_LIMIT_SET_SPECIFICATION_HASH);
    assert.deepEqual(riskLimitSetDeviations(tampered), ["maxRiskPerTradePct"]);
    assert.deepEqual(
      riskLimitSetDeviations({ ...pinnedSet(), specificationHash: "0".repeat(64) }),
      ["specificationHash"]
    );
  });

  it("refuses anything that is not a plain decimal string, without throwing", () => {
    for (const value of [
      "2.5e-3",
      "",
      " 0.0025",
      "0.0025 ",
      "0,0025",
      "+0.0025",
      "-0.0025",
      ".0025",
      "NaN",
      "Infinity",
      "0.0025000000000",
      "0.000000000000",
      0.0025,
      null,
      undefined,
      {}
    ]) {
      assert.deepEqual(
        riskLimitSetDeviations({ ...pinnedSet(), maxRiskPerTradePct: value } as never),
        ["maxRiskPerTradePct"],
        JSON.stringify(value) ?? String(value)
      );
    }
  });

  it("lists several deviations in a stable order", () => {
    assert.deepEqual(
      riskLimitSetDeviations({
        ...pinnedSet(),
        specificationHash: "f".repeat(64),
        maxCorrelatedExposurePct: "1",
        scope: "STRATEGY",
        maxRiskPerTradePct: "0.01",
        maxSlippageBps: 99
      } as RiskLimitSetInputV1),
      [
        "scope",
        "maxSlippageBps",
        "maxRiskPerTradePct",
        "maxCorrelatedExposurePct",
        "specificationHash"
      ]
    );
  });
});

describe("R-026 against a tampered limit set with the v1 hash", () => {
  it("refuses a raised risk per trade (probe P1) and the 4x loosening (P2)", () => {
    assertRefused(
      mutate((next) => {
        next.riskLimitSet!.maxRiskPerTradePct = "0.01";
      }),
      ["maxRiskPerTradePct"],
      "P1"
    );
    assertRefused(
      mutate((next) => {
        next.riskLimitSet!.maxRiskPerTradePct = "0.01";
        next.riskLimitSet!.maxGrossExposurePct = "1";
        next.riskLimitSet!.maxAssetExposurePct = "1";
        next.riskLimitSet!.maxCorrelatedExposurePct = "1";
      }),
      [
        "maxRiskPerTradePct",
        "maxGrossExposurePct",
        "maxAssetExposurePct",
        "maxCorrelatedExposurePct"
      ],
      "P2"
    );
  });

  it("refuses a loosened daily loss limit instead of passing a -1.5 % day (P3)", () => {
    assertRefused(
      mutate((next) => {
        next.dailyCounters.dailyPnl = "-150.000000000000";
        next.riskLimitSet!.maxDailyLossPct = "0.05";
      }),
      ["maxDailyLossPct"],
      "P3"
    );
  });

  it("refuses a lowered minimum reward/risk for the 2R plan (P4)", () => {
    assertRefused(
      mutate((next) => {
        next.candidate.takeProfitPrice = STRATEGY_V1_TAKE_PROFIT;
        next.riskLimitSet!.minRewardRisk = "1";
      }),
      ["minRewardRisk"],
      "P4"
    );
  });

  it("refuses a foreign key, version or scope (P5)", () => {
    assertRefused(
      mutate((next) => {
        next.riskLimitSet!.key = "SOMETHING_ELSE";
        next.riskLimitSet!.version = 99;
        next.riskLimitSet!.scope = "STRATEGY";
      }),
      ["key", "version", "scope"],
      "P5"
    );
  });

  it("refuses a raised percentage after a loss, which R-024 alone cannot see (P6)", () => {
    assertRefused(
      mutate(
        (next) => {
          next.previousApproval = {
            assessedAt: "2026-08-01T09:05:00.000Z",
            equity: "10000.000000000000",
            riskAmount: "24.900000000000"
          };
          next.riskLimitSet!.maxRiskPerTradePct = "0.01";
          next.riskLimitSet!.maxGrossExposurePct = "1";
          next.riskLimitSet!.maxAssetExposurePct = "1";
          next.riskLimitSet!.maxCorrelatedExposurePct = "1";
        },
        buildApprovableSnapshot({ equity: "9900.000000000000" })
      ),
      [
        "maxRiskPerTradePct",
        "maxGrossExposurePct",
        "maxAssetExposurePct",
        "maxCorrelatedExposurePct"
      ],
      "P6"
    );
  });

  it("refuses a stricter value as well: authentic means unchanged", () => {
    assertRefused(
      mutate((next) => {
        next.riskLimitSet!.maxRiskPerTradePct = "0.001";
      }),
      ["maxRiskPerTradePct"],
      "stricter"
    );
  });

  it("refuses an unreadable decimal instead of treating it as zero", () => {
    assertRefused(
      mutate((next) => {
        next.riskLimitSet!.maxDailyLossPct = "0.000000000000";
      }),
      ["maxDailyLossPct"],
      "zero"
    );
    assertRefused(
      mutate((next) => {
        next.riskLimitSet!.minRewardRisk = "2e0";
      }),
      ["minRewardRisk"],
      "exponent"
    );
  });
});

describe("R-026 with the authentic v1 set", () => {
  it("approves the 12-place database form with the same size, risk and rule results", () => {
    const constantForm = evaluateRisk(buildApprovableSnapshot());
    const databaseForm = evaluateRisk(
      mutate((next) => {
        Object.assign(next.riskLimitSet!, twelvePlaces(pinnedSet()));
      })
    );
    assert.equal(constantForm.outcome, "APPROVED");
    assert.equal(databaseForm.outcome, "APPROVED");
    assert.equal(databaseForm.directive, constantForm.directive);
    assert.deepEqual(databaseForm.assessment.sizing, constantForm.assessment.sizing);
    assert.equal(databaseForm.assessment.approvedQuantity, constantForm.assessment.approvedQuantity);
    assert.equal(databaseForm.assessment.riskAmount, constantForm.assessment.riskAmount);
    assert.deepEqual(
      databaseForm.ruleResults.map((rule) => [rule.ruleCode, rule.outcome, rule.reasonCode]),
      constantForm.ruleResults.map((rule) => [rule.ruleCode, rule.outcome, rule.reasonCode])
    );
  });

  it("keeps the passing R-026 result free of a deviation list", () => {
    const rule = r026(buildApprovableSnapshot());
    assert.equal(rule.outcome, "PASS");
    assert.equal(rule.reasonCode, RiskReasonCode.VERSIONS_CONSISTENT);
    assert.equal("riskLimitSetDeviations" in rule.inputJson, false);
  });

  it("still refuses a missing or inactive set before comparing values", () => {
    const missing = r026(
      mutate((next) => {
        next.riskLimitSet = null;
      })
    );
    assert.equal(missing.reasonCode, RiskReasonCode.RISK_LIMIT_SET_NOT_ACTIVE);
    assert.equal(missing.severity, "CRITICAL");
    const retired = r026(
      mutate((next) => {
        next.riskLimitSet!.status = "RETIRED";
      })
    );
    assert.equal(retired.reasonCode, RiskReasonCode.RISK_LIMIT_SET_NOT_ACTIVE);
  });
});
