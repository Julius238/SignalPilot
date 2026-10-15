import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { RiskReasonCode } from "@signalpilot/risk-engine";
import { DecimalValue } from "@signalpilot/trading-domain";

import {
  GROUP_RISK_RULE_CODES,
  buildGroupRiskContext,
  evaluateGroupRisk,
  runPortfolioReplay,
  type GroupPosition,
  type GroupRiskInput,
  type GroupRiskView,
  type PortfolioDecisionDetail
} from "../src/index.js";
import { memberOf, portfolioConfig } from "./support/portfolio-fixtures.js";
import { everyThirdMorning, syntheticMarket } from "./support/regression-matrix.js";

// Synthetic market and test-double candidates: the tests prove how stage 2
// reuses the risk engine's rules, nothing about strategy performance.
describe("group risk (stage 2) — reuse of the unchanged risk-engine rules", () => {
  const data = syntheticMarket(245);
  let details: PortfolioDecisionDetail[] = [];
  let base: GroupRiskInput;

  before(() => {
    // One strategy portfolio and no reserve: the group view equals the portfolio itself.
    runPortfolioReplay(data, portfolioConfig([memberOf("P1", ["BTCUSDT"], everyThirdMorning)]), {
      onDecision: (detail) => {
        if (detail.stage2 !== null) details.push(detail);
      }
    });
    details = details.filter((detail) => detail.stage2Input !== null);
    assert.ok(details.length > 0, "expected stage-1 approvals that reach stage 2");
    base = details[0]!.stage2Input!;
  });

  it("checks exactly the four cross-portfolio rules", () => {
    assert.deepEqual([...GROUP_RISK_RULE_CODES], ["R-010-DAILY-LOSS", "R-013-GROSS-EXPOSURE", "R-014-ASSET-EXPOSURE", "R-015-CORRELATION"]);
  });

  it("reproduces stage 1 exactly when the group is a single portfolio (same aggregation formulas)", () => {
    for (const detail of details) {
      assert.equal(detail.stage2!.passed, true);
      for (const verdict of detail.stage2!.verdicts) {
        const stage1 = detail.stage1!.risk.ruleResults.find((rule) => rule.ruleCode === verdict.ruleCode)!;
        assert.equal(verdict.outcome, stage1.outcome, verdict.ruleCode);
        assert.equal(verdict.reasonCode, stage1.reasonCode, verdict.ruleCode);
        assert.deepEqual(verdict.inputJson, stage1.inputJson, verdict.ruleCode);
        assert.equal(verdict.actualValue ?? null, stage1.actualValue, verdict.ruleCode);
        assert.equal(verdict.limitValue ?? null, stage1.limitValue, verdict.ruleCode);
      }
    }
  });

  const equity = "20000.000000000000";
  const view = (overrides: Partial<GroupRiskView> = {}): GroupRiskView => ({
    equity,
    availableCash: equity,
    reservedCash: "0.000000000000",
    startOfDay: { asOf: base.snapshot.asOf, equity },
    dailyPnl: "0.000000000000",
    positions: [],
    reservations: [],
    ...overrides
  });
  const position = (symbol: string, marketValue: string): GroupPosition => ({
    assetId: `asset-${symbol}`,
    symbol,
    status: "OPEN",
    openQuantity: "0.100000000000",
    marketValue,
    equityContribution: marketValue,
    reservedCollateral: "0.000000000000"
  });
  const input = (group: GroupRiskView, ownPortfolioHoldsAsset = false): GroupRiskInput => ({ ...base, group, ownPortfolioHoldsAsset });
  const verdictOf = (result: ReturnType<typeof evaluateGroupRisk>, ruleCode: string) => result.verdicts.find((verdict) => verdict.ruleCode === ruleCode)!;
  const notional = () => Number(base.sizing.notional);

  it("lets two independent portfolios hold the same asset when the combined exposure stays under the cap", () => {
    // Another portfolio already holds the candidate's asset (BTC): no duplicate block, only the exposure cap counts.
    const other = (0.2 * Number(equity) - notional()) * 0.5;
    const result = evaluateGroupRisk(input(view({ positions: [position("BTCUSDT", other.toFixed(12))] })));
    assert.equal(result.passed, true);
    assert.equal(verdictOf(result, "R-014-ASSET-EXPOSURE").reasonCode, RiskReasonCode.ASSET_EXPOSURE_WITHIN_LIMIT);
  });

  it("rejects on the cross-portfolio asset cap with MAX_ASSET_EXPOSURE, never with DUPLICATE_ASSET_POSITION", () => {
    const other = 0.2 * Number(equity) - notional() + 1;
    const result = evaluateGroupRisk(input(view({ positions: [position("BTCUSDT", other.toFixed(12))] })));
    assert.equal(result.passed, false);
    assert.equal(verdictOf(result, "R-014-ASSET-EXPOSURE").reasonCode, RiskReasonCode.MAX_ASSET_EXPOSURE);
    assert.ok(result.failedRules.includes(`R-014-ASSET-EXPOSURE:${RiskReasonCode.MAX_ASSET_EXPOSURE}`));
    assert.ok(result.verdicts.every((verdict) => verdict.reasonCode !== RiskReasonCode.DUPLICATE_ASSET_POSITION));
  });

  it("reaches the duplicate branch of R-014 only through the candidate's own portfolio", () => {
    const result = evaluateGroupRisk(input(view(), true));
    assert.equal(verdictOf(result, "R-014-ASSET-EXPOSURE").reasonCode, RiskReasonCode.DUPLICATE_ASSET_POSITION);
    // In the replay this cannot happen: stage 1 (R-014, R-022) already refused such a candidate.
  });

  it("rejects on the BTC + ETH correlation cap across portfolios", () => {
    const eth = 0.3 * Number(equity) - notional() + 1;
    const result = evaluateGroupRisk(input(view({ positions: [position("ETHUSDT", eth.toFixed(12))] })));
    assert.equal(result.passed, false);
    assert.equal(verdictOf(result, "R-015-CORRELATION").reasonCode, RiskReasonCode.MAX_CORRELATED_EXPOSURE);
  });

  it("rejects on the gross exposure cap across portfolios", () => {
    // A symbol outside the correlation group isolates R-013 from R-015.
    const other = 0.4 * Number(equity) - notional() + 1;
    const result = evaluateGroupRisk(input(view({ positions: [position("SOLUSDT", other.toFixed(12))] })));
    assert.equal(verdictOf(result, "R-013-GROSS-EXPOSURE").reasonCode, RiskReasonCode.MAX_GROSS_EXPOSURE);
    assert.equal(verdictOf(result, "R-015-CORRELATION").outcome, "PASS");
    assert.equal(result.passed, false);
  });

  it("counts pending entry reservations of other portfolios like evaluateRisk does", () => {
    const reserved = 0.2 * Number(equity) - notional() + 1;
    const result = evaluateGroupRisk(
      input(view({ reservations: [{ assetId: base.snapshot.candidate.assetId, symbol: base.snapshot.candidate.symbol, purpose: "ENTRY", reservedQuoteAmount: reserved.toFixed(12) }] }))
    );
    assert.equal(verdictOf(result, "R-014-ASSET-EXPOSURE").reasonCode, RiskReasonCode.MAX_ASSET_EXPOSURE);
  });

  it("stops new entries at the group daily loss limit and engages the group kill switch", () => {
    const limit = (0.01 * Number(equity)).toFixed(12);
    const atLimit = evaluateGroupRisk(input(view({ dailyPnl: `-${limit}` })));
    assert.equal(atLimit.passed, false);
    assert.equal(verdictOf(atLimit, "R-010-DAILY-LOSS").reasonCode, RiskReasonCode.DAILY_LOSS_LIMIT_REACHED);
    assert.equal(atLimit.directive, "ENGAGE_KILL_SWITCH");
    const justInside = evaluateGroupRisk(input(view({ dailyPnl: (-(0.01 * Number(equity)) + 0.01).toFixed(12) })));
    assert.equal(justInside.passed, true);
    assert.equal(justInside.directive, "NONE");
  });

  it("fails closed without a group start-of-day snapshot", () => {
    const result = evaluateGroupRisk(input(view({ startOfDay: null })));
    assert.equal(result.passed, false);
    assert.equal(verdictOf(result, "R-010-DAILY-LOSS").reasonCode, RiskReasonCode.START_OF_DAY_SNAPSHOT_MISSING);
  });

  it("never changes the stage-1 quantity; only the post-trade exposures move to the group totals", () => {
    const other = position("BTCUSDT", "1234.500000000000");
    const context = buildGroupRiskContext(input(view({ positions: [other] })));
    assert.equal(context.sizing.approvedQuantity, base.sizing.approvedQuantity);
    assert.equal(context.sizing.notional, base.sizing.notional);
    assert.equal(context.sizing.riskAmount, base.sizing.riskAmount);
    const expected = DecimalValue.fromString(other.marketValue).add(DecimalValue.fromString(base.sizing.notional)).toString();
    assert.equal(context.sizing.postTradeAssetExposure, expected);
    assert.equal(context.equity.toString(), DecimalValue.fromString(equity).toString());
  });
});
