import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DecimalValue } from "@signalpilot/trading-domain";

import {
  comparisonPortfolios,
  evaluateGroupRisk,
  portfolioTotalCapital,
  runPortfolioReplay,
  runShadowReplay,
  type GroupRiskResult,
  type PortfolioDecision,
  type ReplayTrade
} from "../src/index.js";
import { forcedCandidates } from "./support/forced-candidates.js";
import { memberOf, portfolioConfig, withStrategyKey } from "./support/portfolio-fixtures.js";
import { REGRESSION_CASES, baseConfig, everyThirdMorning, syntheticMarket, twiceDaily, ETH_PROFILE } from "./support/regression-matrix.js";

// Every market here is synthetic and every candidate comes from a test double:
// the tests prove the simulation mechanics, never anything about strategies.
const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);
const data = syntheticMarket(245);
const streaky = syntheticMarket(245, 29, 33);

const lazy = <T>(build: () => T): (() => T) => {
  let value: T | undefined;
  return () => (value ??= build());
};
const sum = (values: readonly string[]) => values.reduce((total, value) => total.add(DecimalValue.fromString(value)), DecimalValue.ZERO);
const overlaps = (a: ReplayTrade, b: ReplayTrade) => Date.parse(a.openedAt) < Date.parse(b.closedAt) && Date.parse(b.openedAt) < Date.parse(a.closedAt);
const morningsOffset = forcedCandidates({
  every: (closeMs) => new Date(closeMs + 1).getUTCHours() === 15 && Math.floor(closeMs / DAY) % 3 === 1,
  stopPct: "0.022"
});

describe("portfolio replay — one portfolio equals the single-strategy replay", () => {
  // Each case: the recorded single replay against the same strategy as the only portfolio, group check on.
  for (const key of ["R2-spec-forced", "R3-spec-kill-switch", "R4-spec-regime-exit-shut", "R5-spec-eth-profile", "R6-spec-regime-long-native"]) {
    it(`${key}: same trades, funnel, equity curve and output hash`, () => {
      const entry = REGRESSION_CASES.find((candidate) => candidate.key === key)!;
      const single = runShadowReplay(entry.market(), entry.config, entry.hooks);
      const portfolio = runPortfolioReplay(entry.market(), {
        members: [
          {
            key: "P",
            strategyKey: entry.config.strategyKey,
            startingCash: entry.config.startingCash,
            symbols: [{ symbol: entry.config.symbol, executionProfile: entry.config.executionProfile }],
            hooks: entry.hooks
          }
        ],
        reserveCash: "0",
        regimePolicy: entry.config.regimePolicy,
        groupRisk: "GROUP_RISK_V1",
        codeVersion: entry.config.codeVersion
      });
      const member = portfolio.members[0]!;
      assert.deepEqual(member.trades, single.trades);
      assert.deepEqual(member.funnel, single.funnel);
      assert.deepEqual(member.equityCurve, single.equityCurve);
      assert.equal(member.finalEquity, single.finalEquity);
      assert.equal(member.killSwitchEngagements > 0, single.notes.some((note) => note.includes("Kill-Switch")));
      assert.equal(member.groupRejected, 0);
      assert.equal(member.outputHash, single.outputHash);
      assert.equal(portfolio.group.finalEquity, single.finalEquity);
    });
  }
});

describe("portfolio replay — independent strategy portfolios on one timeline", () => {
  // P1 and P2 receive identical candidates on BTC at the same hours.
  const twins = lazy(() =>
    runPortfolioReplay(
      data,
      portfolioConfig([memberOf("P1", ["BTCUSDT"], everyThirdMorning), memberOf("P2", ["BTCUSDT"], everyThirdMorning)], { recordDecisions: true })
    )
  );
  const alone = lazy(() => runShadowReplay(data, baseConfig({ mode: "SPEC" }), { evaluate: everyThirdMorning }));

  it("enters the same asset in two portfolios at the same hour; stage 2 does not treat that as a duplicate", () => {
    const [p1, p2] = twins().members;
    assert.ok(p1!.trades.length > 0);
    assert.deepEqual(p1!.trades, p2!.trades);
    assert.ok(p1!.trades.some((trade) => p2!.trades.some((other) => trade.openedAt === other.openedAt && overlaps(trade, other))));
    assert.equal(p1!.groupRejected + p2!.groupRejected, 0);
    const decisions = twins().decisions!.filter((decision) => decision.orderPlaced);
    assert.ok(decisions.every((decision) => decision.stage1 === "APPROVED" && decision.stage2 === "PASSED"));
  });

  it("keeps every portfolio's result identical to running it alone while no group limit binds", () => {
    for (const member of twins().members) {
      assert.equal(member.outputHash, alone().outputHash);
    }
  });

  it("values the group as the sum of all portfolios at every point (closings, fees and marks included)", () => {
    const result = twins();
    const memberEquity = sum(result.members.map((member) => member.finalEquity));
    assert.equal(result.group.finalEquity, memberEquity.toString());
    for (const [index, point] of result.equityCurve.entries()) {
      const total = sum(result.members.map((member) => member.equityCurve[index]!.equity));
      assert.equal(point.at, result.members[0]!.equityCurve[index]!.at);
      assert.equal(point.equity, total.toString());
    }
    for (const member of result.members) {
      assert.equal(member.invariantViolations, 0);
      // Every closed trade is booked: final equity = start + realized net PnL when nothing is open at the end.
      const realized = sum(member.trades.map((trade) => trade.netPnl));
      const expected = DecimalValue.fromString(member.startingCash).add(realized);
      if (member.funnel.entriesFilled === member.trades.length) assert.equal(member.finalEquity, expected.toString());
    }
  });

  it("measures concurrent risk and capital tie-up across portfolios", () => {
    const group = twins().group;
    // Two simultaneous 0.25 % risks of about 10 000 USDT each on about 20 000 USDT: about 0.25 % of the
    // group. The risk is fixed at the equity of the entry, the group equity of the peak hour can be lower.
    assert.ok(Number(group.peakOpenRiskPct) > 0.24 && Number(group.peakOpenRiskPct) < 0.26, String(group.peakOpenRiskPct));
    assert.ok(Number(group.averageCapitalBoundPct) > 0);
    assert.ok(Number(group.peakCapitalBoundPct) >= Number(group.averageCapitalBoundPct));
    assert.ok(group.hoursWithOpenPositions > 0 && group.hoursWithOpenPositions <= group.hours);
  });

  it("is deterministic and restarts identically: a shorter window reproduces the same earlier decisions", () => {
    const again = runPortfolioReplay(
      data,
      portfolioConfig([memberOf("P1", ["BTCUSDT"], everyThirdMorning), memberOf("P2", ["BTCUSDT"], everyThirdMorning)], { recordDecisions: true })
    );
    assert.equal(again.outputHash, twins().outputHash);
    const cutMs = START + 236 * DAY;
    const shorter = runPortfolioReplay(
      data,
      portfolioConfig([memberOf("P1", ["BTCUSDT"], everyThirdMorning), memberOf("P2", ["BTCUSDT"], everyThirdMorning)], {
        recordDecisions: true,
        to: new Date(cutMs).toISOString()
      })
    );
    const before = (decisions: readonly PortfolioDecision[]) => decisions.filter((decision) => Date.parse(decision.at) <= cutMs);
    assert.ok(before(shorter.decisions!).length > 0);
    assert.deepEqual(before(shorter.decisions!), before(twins().decisions!));
  });
});

describe("portfolio replay — per-portfolio risk rules stay per portfolio", () => {
  // One portfolio trading BTC and ETH twice a day; a 72 h hold keeps positions open across signals.
  const both = lazy(() =>
    runPortfolioReplay(data, portfolioConfig([memberOf("P", ["BTCUSDT", "ETHUSDT"], twiceDaily)], { recordDecisions: true }))
  );

  it("lets one portfolio hold BTC and ETH at the same time (R-011: two positions)", () => {
    const member = both().members[0]!;
    const btc = member.trades.filter((trade) => trade.symbol === "BTCUSDT");
    const eth = member.trades.filter((trade) => trade.symbol === "ETHUSDT");
    assert.ok(btc.length > 0 && eth.length > 0);
    assert.ok(btc.some((trade) => eth.some((other) => overlaps(trade, other))));
    assert.equal(member.invariantViolations, 0);
  });

  it("refuses a second entry in an asset the same portfolio already holds (R-014 duplicate / R-022 in stage 1)", () => {
    const member = both().members[0]!;
    const failed = Object.keys(member.funnel.failedRiskRules);
    assert.ok(
      failed.some((key) => key.startsWith("R-022-NO-SCALE-IN:") || key === "R-014-ASSET-EXPOSURE:DUPLICATE_ASSET_POSITION"),
      failed.join(", ")
    );
    const rejected = both().decisions!.filter((decision) => decision.stage1 === "REJECTED");
    assert.ok(rejected.length > 0);
    assert.ok(rejected.every((decision) => decision.stage2 === "NOT_RUN" && !decision.orderPlaced));
  });

  it("shares one cash ledger across both symbols of a portfolio", () => {
    const member = both().members[0]!;
    // Never more than the starting cash committed: equity stays consistent and no invariant breaks.
    assert.equal(member.invariantViolations, 0);
    assert.ok(Number(both().group.peakCapitalBoundPct) < 100);
  });

  it("keeps one portfolio's kill switch inside that portfolio", () => {
    const streakyLone = runShadowReplay(streaky, baseConfig({ mode: "SPEC" }), { evaluate: twiceDaily });
    const other = runShadowReplay(streaky, baseConfig({ mode: "SPEC", symbol: "ETHUSDT", executionProfile: ETH_PROFILE }), { evaluate: morningsOffset });
    const result = runPortfolioReplay(
      streaky,
      portfolioConfig([memberOf("LOSER", ["BTCUSDT"], twiceDaily), memberOf("OTHER", ["ETHUSDT"], morningsOffset)])
    );
    const [loser, unaffected] = result.members;
    assert.ok(loser!.killSwitchEngagements > 0, "expected the loss-streak kill switch in the losing portfolio");
    assert.equal(loser!.outputHash, streakyLone.outputHash);
    assert.equal(unaffected!.killSwitchEngagements, 0);
    assert.equal(unaffected!.outputHash, other.outputHash);
  });
});

describe("portfolio replay — stage 2 can only limit", () => {
  const members = () => [memberOf("P1", ["BTCUSDT"], everyThirdMorning), memberOf("P2", ["ETHUSDT"], morningsOffset)];

  it("runs stage 2 only after a stage-1 approval and never with another quantity", () => {
    const calls: number[] = [];
    const seen: { stage1Quantity: string | null; stage2Quantity: string | null }[] = [];
    runPortfolioReplay(data, portfolioConfig(members()), {
      groupCheck: (input) => {
        calls.push(input.asOfMs);
        return evaluateGroupRisk(input);
      },
      onDecision: (detail) => {
        if (detail.stage2Input !== null) {
          seen.push({ stage1Quantity: detail.stage1?.approvedQuantity ?? null, stage2Quantity: detail.stage2Input.sizing.approvedQuantity });
        }
        if (detail.decision.stage1 === "REJECTED") assert.equal(detail.stage2Input, null);
      }
    });
    assert.ok(calls.length > 0);
    assert.equal(seen.length, calls.length);
    for (const entry of seen) assert.equal(entry.stage2Quantity, entry.stage1Quantity);
  });

  it("places no order at all when stage 2 rejects everything, while stage 1 still approved", () => {
    const rejectAll = (): GroupRiskResult => ({ version: "test", passed: false, directive: "NONE", verdicts: [], failedRules: ["TEST:REJECT_ALL"] });
    const result = runPortfolioReplay(data, portfolioConfig(members(), { recordDecisions: true }), { groupCheck: rejectAll });
    for (const member of result.members) {
      assert.ok(member.funnel.riskApproved > 0);
      assert.equal(member.funnel.entriesFilled, 0);
      assert.equal(member.trades.length, 0);
      assert.equal(member.groupRejected, member.funnel.riskApproved);
      assert.equal(member.finalEquity, DecimalValue.fromString(member.startingCash).toString());
    }
    assert.ok(result.decisions!.every((decision) => !decision.orderPlaced));
    assert.equal(result.group.stage2Rejections["TEST:REJECT_ALL"], result.members.reduce((total, member) => total + member.groupRejected, 0));
  });

  it("gives an always-passing stage 2 the same result as no stage 2", () => {
    const pass = (): GroupRiskResult => ({ version: "test", passed: true, directive: "NONE", verdicts: [], failedRules: [] });
    const withPass = runPortfolioReplay(data, portfolioConfig(members()), { groupCheck: pass });
    const without = runPortfolioReplay(data, portfolioConfig(members(), { groupRisk: "NONE" }));
    assert.deepEqual(
      withPass.members.map((member) => member.outputHash),
      without.members.map((member) => member.outputHash)
    );
  });

  it("stops every portfolio after a group kill switch and restarts after the 24 h review", () => {
    let engaged = false;
    const firstFails = (input: Parameters<typeof evaluateGroupRisk>[0]): GroupRiskResult => {
      if (engaged) return evaluateGroupRisk(input);
      engaged = true;
      return { version: "test", passed: false, directive: "ENGAGE_KILL_SWITCH", verdicts: [], failedRules: ["R-010-DAILY-LOSS:DAILY_LOSS_LIMIT_REACHED"] };
    };
    const result = runPortfolioReplay(data, portfolioConfig(members(), { recordDecisions: true }), { groupCheck: firstFails });
    const approved = result.decisions!.filter((decision) => decision.stage1 === "APPROVED");
    const trigger = approved.find((decision) => decision.stage2 === "REJECTED")!;
    const triggerMs = Date.parse(trigger.at);
    const during = approved.filter((decision) => Date.parse(decision.at) > triggerMs && Date.parse(decision.at) + 5 * 60_000 < triggerMs + DAY);
    const after = approved.filter((decision) => Date.parse(decision.at) >= triggerMs + DAY);
    assert.equal(result.group.groupKillSwitchEngagements, 1);
    assert.ok(during.every((decision) => decision.stage2 === "GROUP_KILL_SWITCH" && !decision.orderPlaced));
    assert.ok(after.some((decision) => decision.orderPlaced), "expected entries after the review delay");
    assert.ok(result.notes.some((note) => note.includes("Gruppen-Kill-Switch")));
  });
});

describe("portfolio replay — no new strategy can bypass the risk rules", () => {
  it("refuses every entry of a strategy identity that is not on the approval list", () => {
    const unapproved = withStrategyKey(everyThirdMorning, "RESEARCH:NOT_APPROVED");
    const stage2Calls: number[] = [];
    const result = runPortfolioReplay(data, portfolioConfig([memberOf("UNAPPROVED", ["BTCUSDT"], unapproved)]), {
      groupCheck: (input) => {
        stage2Calls.push(input.asOfMs);
        return evaluateGroupRisk(input);
      }
    });
    const member = result.members[0]!;
    assert.ok(member.funnel.candidates > 0);
    assert.equal(member.funnel.riskApproved, 0);
    assert.equal(member.trades.length, 0);
    assert.ok(Object.keys(member.funnel.failedRiskRules).some((key) => key.startsWith("R-005-LONG-ONLY:")));
    assert.equal(stage2Calls.length, 0);
  });

  it("validates the frame: registered strategies, unique portfolios, known symbols, no negative reserve", () => {
    const ok = memberOf("P", ["BTCUSDT"], everyThirdMorning);
    assert.throws(() => runPortfolioReplay(data, portfolioConfig([])), /at least one/);
    assert.throws(() => runPortfolioReplay(data, portfolioConfig([ok, ok])), /Duplicate portfolio key/);
    assert.throws(() => runPortfolioReplay(data, portfolioConfig([{ ...ok, strategyKey: "NOT_REGISTERED" }])), /Unknown strategy/);
    assert.throws(
      () => runPortfolioReplay(data, portfolioConfig([{ ...ok, symbols: [{ symbol: "XRPUSDT", executionProfile: ok.symbols[0]!.executionProfile }] }])),
      /No candles for XRPUSDT/
    );
    assert.throws(() => runPortfolioReplay(data, portfolioConfig([ok], { reserveCash: "-1" })), /reserve/);
  });
});

describe("portfolio replay — comparison frame with fixed capital slots", () => {
  const frame = () =>
    comparisonPortfolios({
      slotCash: "10000",
      existing: [{ key: "EXISTING", strategyKey: "CRYPTO_MTF_BREAKOUT_LONG_V1", symbols: memberOf("x", ["BTCUSDT"], everyThirdMorning).symbols, hooks: { evaluate: everyThirdMorning } }],
      candidate: {
        key: "CANDIDATE",
        strategyKey: "CRYPTO_MTF_BREAKOUT_LONG_V1",
        researchIdentity: "RESEARCH:TEST_FAMILY_V1",
        symbols: memberOf("x", ["ETHUSDT"], morningsOffset).symbols,
        hooks: { evaluate: morningsOffset },
        // A weight smuggled in at runtime is ignored: every portfolio gets exactly one slot.
        ...({ startingCash: "99999" } as object)
      },
      shared: { regimePolicy: "CRYPTO_ONLY", groupRisk: "GROUP_RISK_V1", codeVersion: "test" }
    });
  const runs = lazy(() => {
    const { baseline, withCandidate } = frame();
    return { baseline: runPortfolioReplay(data, baseline), withCandidate: runPortfolioReplay(data, withCandidate) };
  });

  it("uses the same total capital and equal, pre-set slots in both comparisons", () => {
    const { baseline, withCandidate, totalCapital } = frame();
    assert.equal(totalCapital, DecimalValue.fromString("20000").toString());
    assert.equal(portfolioTotalCapital(baseline), totalCapital);
    assert.equal(portfolioTotalCapital(withCandidate), totalCapital);
    assert.equal(baseline.reserveCash, DecimalValue.fromString("10000").toString());
    assert.deepEqual(baseline.members.map((member) => member.key), ["EXISTING"]);
    assert.deepEqual(withCandidate.members.map((member) => member.key), ["EXISTING", "CANDIDATE"]);
    assert.ok([...baseline.members, ...withCandidate.members].every((member) => member.startingCash === DecimalValue.fromString("10000").toString()));
    assert.throws(() => comparisonPortfolios({ ...frameInput(), candidate: { ...frameInput().candidate, key: "EXISTING" } }), /already taken/);
  });

  it("keeps the existing strategy identical in both comparisons and attributes trades by portfolio", () => {
    const { baseline, withCandidate } = runs();
    const existingA = baseline.members.find((member) => member.key === "EXISTING")!;
    const existingB = withCandidate.members.find((member) => member.key === "EXISTING")!;
    const candidate = withCandidate.members.find((member) => member.key === "CANDIDATE")!;
    assert.equal(existingA.outputHash, existingB.outputHash);
    assert.equal(candidate.researchIdentity, "RESEARCH:TEST_FAMILY_V1");
    assert.ok(candidate.trades.length > 0);
    assert.ok(candidate.trades.every((trade) => trade.symbol === "ETHUSDT"));
    assert.ok(existingB.trades.every((trade) => trade.symbol === "BTCUSDT"));
  });

  it("counts the reserve as idle capital: same total, lower tie-up per unit of capital", () => {
    const { baseline, withCandidate } = runs();
    assert.equal(baseline.group.totalCapital, withCandidate.group.totalCapital);
    const existing = baseline.members[0]!;
    assert.equal(baseline.group.finalEquity, DecimalValue.fromString(existing.finalEquity).add(DecimalValue.fromString("10000")).toString());
    const lone = runPortfolioReplay(data, portfolioConfig([memberOf("EXISTING", ["BTCUSDT"], everyThirdMorning)]));
    // Same positions on twice the capital: about half the capital tie-up.
    const ratio = Number(baseline.group.averageCapitalBoundPct) / Number(lone.group.averageCapitalBoundPct);
    assert.ok(ratio > 0.45 && ratio < 0.55, String(ratio));
  });

  function frameInput() {
    return {
      slotCash: "10000",
      existing: [{ key: "EXISTING", strategyKey: "CRYPTO_MTF_BREAKOUT_LONG_V1", symbols: memberOf("x", ["BTCUSDT"], everyThirdMorning).symbols }],
      candidate: { key: "CANDIDATE", strategyKey: "CRYPTO_MTF_BREAKOUT_LONG_V1", symbols: memberOf("x", ["ETHUSDT"], morningsOffset).symbols },
      shared: { regimePolicy: "CRYPTO_ONLY" as const, groupRisk: "GROUP_RISK_V1" as const, codeVersion: "test" }
    };
  }
});

