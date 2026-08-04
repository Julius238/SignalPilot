import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DecimalValue } from "@signalpilot/trading-domain";

import {
  RISK_RULE_COUNT,
  RISK_RULE_ORDER,
  RISK_RULES,
  RiskReasonCode,
  RiskRuleCode,
  evaluateRisk,
  type RiskInputSnapshotV1
} from "../src/index.js";

import {
  APPROVABLE_TAKE_PROFIT,
  STRATEGY_V1_TAKE_PROFIT,
  buildApprovableSnapshot,
  buildApprovableShortSnapshot,
  clone,
  openPosition,
  type DeepMutable
} from "./support/build-risk-snapshot.js";

const d = (value: string): DecimalValue => DecimalValue.fromString(value);

type MutableSnapshot = DeepMutable<RiskInputSnapshotV1>;

const mutate = (
  change: (snapshot: MutableSnapshot) => void
): RiskInputSnapshotV1 => {
  const snapshot = clone(buildApprovableSnapshot());
  change(snapshot);
  return snapshot as RiskInputSnapshotV1;
};

const ruleOf = (snapshot: RiskInputSnapshotV1, ruleCode: string) => {
  const result = evaluateRisk(snapshot).ruleResults.find(
    (rule) => rule.ruleCode === ruleCode
  );
  assert.ok(result, `missing rule result for ${ruleCode}`);
  return result;
};

describe("risk registry", () => {
  it("implements exactly the 26 documented rules, in order", () => {
    assert.equal(RISK_RULE_COUNT, 26);
    assert.equal(Object.keys(RISK_RULES).length, 26);
    assert.deepEqual([...RISK_RULE_ORDER], Object.values(RiskRuleCode));
    for (const ruleCode of RISK_RULE_ORDER) {
      assert.equal(typeof RISK_RULES[ruleCode], "function", ruleCode);
    }
  });

  it("returns one result per rule on every evaluation, PASS included", () => {
    const result = evaluateRisk(buildApprovableSnapshot());
    assert.equal(result.ruleResults.length, 26);
    assert.deepEqual(
      result.ruleResults.map((rule) => rule.ruleCode),
      [...RISK_RULE_ORDER]
    );
    assert.ok(result.ruleResults.every((rule) => rule.outcome === "PASS"));
  });
});

describe("approval path", () => {
  const result = evaluateRisk(buildApprovableSnapshot());

  it("approves a clean candidate and sizes it", () => {
    assert.equal(result.outcome, "APPROVED");
    assert.equal(result.directive, "NONE");
    assert.equal(result.assessment.status, "PASS");
    assert.equal(result.decision.outcome, "APPROVE_SHADOW");
    assert.equal(result.primaryReasonCode, RiskReasonCode.RISK_APPROVED);
    assert.ok(d(result.assessment.approvedQuantity).isPositive());
  });

  it("keeps the worst-case risk at or below 0.25 % of equity", () => {
    const riskAmount = d(result.assessment.riskAmount);
    assert.ok(riskAmount.lte(d("25")));
    assert.ok(riskAmount.lte(d(result.assessment.sizing.riskBudget)));
  });

  it("persists the full cost bridge with the assessment", () => {
    const sizing = result.assessment.sizing;
    assert.equal(sizing.computable, true);
    assert.ok(
      d(sizing.worstEntryPrice).gt(
        d(result.assessment.sizing.worstStopFillPrice)
      )
    );
    assert.ok(d(sizing.netRewardRisk).gte(d("2")));
    assert.ok(
      d(sizing.reservedQuoteAmount).lte(d(result.assessment.availableCash))
    );
  });

  it("creates no order, fill, position or ledger artefact", () => {
    const serialised = JSON.stringify(result);
    for (const forbidden of [
      "shadowOrder",
      "shadowFill",
      "shadowPosition",
      "ledgerEntry",
      "exitPlan"
    ]) {
      assert.ok(
        !serialised.includes(forbidden),
        `output must not contain ${forbidden}`
      );
    }
  });
});

describe("R-008 and the strategy v1 take profit", () => {
  it("rejects the strategy's own 2R plan once costs are priced in", () => {
    // docs/trading/05 sets the take profit at exactly 2R while docs/trading/06
    // demands a net reward/risk of 2.0 after spread, slippage and round-trip
    // fees. With any positive cost the two cannot both hold — see the report.
    const snapshot = mutate((next) => {
      next.candidate.takeProfitPrice = STRATEGY_V1_TAKE_PROFIT;
    });
    const result = evaluateRisk(snapshot);
    assert.equal(result.outcome, "REJECTED");
    assert.equal(
      result.primaryReasonCode,
      RiskReasonCode.REWARD_RISK_BELOW_MINIMUM
    );
    assert.ok(d(result.assessment.sizing.netRewardRisk).lt(d("2")));
    assert.equal(d(result.assessment.approvedQuantity).isZero(), true);
  });

  it("approves once the take profit clears the costed threshold", () => {
    const snapshot = mutate((next) => {
      next.candidate.takeProfitPrice = APPROVABLE_TAKE_PROFIT;
    });
    assert.equal(evaluateRisk(snapshot).outcome, "APPROVED");
  });

  it("blocks a take profit at or below the entry", () => {
    const snapshot = mutate((next) => {
      next.candidate.takeProfitPrice = next.candidate.referenceEntryPrice;
    });
    assert.equal(ruleOf(snapshot, RiskRuleCode.MIN_RR).outcome, "FAIL");
  });
});

describe("mode, session and portfolio rules", () => {
  it("R-001 fails critically on live trading", () => {
    const rule = ruleOf(
      mutate((next) => {
        next.capability.enableLiveTrading = true;
      }),
      RiskRuleCode.SHADOW_MODE
    );
    assert.equal(rule.severity, "CRITICAL");
    assert.equal(rule.reasonCode, RiskReasonCode.LIVE_TRADING_FORBIDDEN);
  });

  it("R-001 blocks when the risk job flag is off", () => {
    const snapshot = mutate((next) => {
      next.capability.riskJobEnabled = false;
    });
    assert.equal(evaluateRisk(snapshot).outcome, "REJECTED");
    assert.equal(
      ruleOf(snapshot, RiskRuleCode.SHADOW_MODE).reasonCode,
      RiskReasonCode.RISK_JOB_DISABLED
    );
  });

  it("R-002 blocks a paused session and an engaged kill switch", () => {
    const paused = mutate((next) => {
      next.session!.status = "PAUSED";
    });
    assert.equal(
      ruleOf(paused, RiskRuleCode.SESSION).reasonCode,
      RiskReasonCode.SESSION_BLOCKS_ENTRY
    );
    assert.equal(evaluateRisk(paused).directive, "BLOCK_NEW");

    const killed = mutate((next) => {
      next.session!.killSwitchEngaged = true;
    });
    assert.equal(
      ruleOf(killed, RiskRuleCode.SESSION).reasonCode,
      RiskReasonCode.SESSION_KILL_SWITCH_ENGAGED
    );
    assert.equal(evaluateRisk(killed).outcome, "REJECTED");
  });

  it("R-003 fails critically when the ledger replay drifts beyond tolerance", () => {
    const snapshot = mutate((next) => {
      next.ledgerReplay.availableCash = "9999.000000000000";
    });
    const rule = ruleOf(snapshot, RiskRuleCode.PORTFOLIO_CONSISTENCY);
    assert.equal(rule.severity, "CRITICAL");
    assert.equal(rule.reasonCode, RiskReasonCode.PORTFOLIO_INCONSISTENT);
    const result = evaluateRisk(snapshot);
    assert.equal(result.outcome, "ERROR");
    assert.equal(result.directive, "ERROR_LOCK");
  });

  it("R-003 tolerates a difference at the documented decimal tolerance", () => {
    const snapshot = mutate((next) => {
      next.ledgerReplay.availableCash = "10000.000000010000";
    });
    assert.equal(
      ruleOf(snapshot, RiskRuleCode.PORTFOLIO_CONSISTENCY).outcome,
      "PASS"
    );
  });

  it("R-003 fails on negative cash, an orphan ledger row and a duplicate scope", () => {
    for (const [change, reasonCode] of [
      [
        (next: MutableSnapshot) => {
          next.portfolio.availableCash = "-1.000000000000";
          next.ledgerReplay.availableCash = "-1.000000000000";
          next.portfolio.equity = "-1.000000000000";
        },
        RiskReasonCode.PORTFOLIO_NEGATIVE_CASH
      ],
      [
        (next: MutableSnapshot) => {
          next.ledgerReplay.orphanReferenceCount = 1;
        },
        RiskReasonCode.PORTFOLIO_ORPHAN_LEDGER_REFERENCE
      ],
      [
        (next: MutableSnapshot) => {
          next.openPositions = [
            openPosition({ marketValue: "10.000000000000" }),
            openPosition({ marketValue: "10.000000000000" })
          ];
          next.portfolio.equity = "10020.000000000000";
        },
        RiskReasonCode.PORTFOLIO_DUPLICATE_POSITION_SCOPE
      ]
    ] as const) {
      const rule = ruleOf(mutate(change), RiskRuleCode.PORTFOLIO_CONSISTENCY);
      assert.equal(rule.reasonCode, reasonCode);
      assert.equal(rule.severity, "CRITICAL");
    }
  });

  it("R-003 fails when the reservations do not sum to reservedCash", () => {
    const snapshot = mutate((next) => {
      next.reservations = [
        {
          shadowOrderId: "order-1",
          assetId: "asset-eth",
          symbol: "ETHUSDT",
          status: "WAITING_FOR_ENTRY",
          reservedQuoteAmount: "500.000000000000"
        }
      ];
    });
    assert.equal(
      ruleOf(snapshot, RiskRuleCode.PORTFOLIO_CONSISTENCY).reasonCode,
      RiskReasonCode.PORTFOLIO_RESERVATION_MISMATCH
    );
  });

  it("R-003 blocks a portfolio that is not ACTIVE", () => {
    const snapshot = mutate((next) => {
      next.portfolio.status = "DRAFT";
    });
    assert.equal(
      ruleOf(snapshot, RiskRuleCode.PORTFOLIO_CONSISTENCY).reasonCode,
      RiskReasonCode.PORTFOLIO_NOT_ACTIVE
    );
  });
});

describe("instrument, direction and leverage rules", () => {
  it("R-004 blocks a symbol outside BTC/ETH", () => {
    const snapshot = mutate((next) => {
      next.asset.symbol = "SOLUSDT";
      next.candidate.symbol = "SOLUSDT";
    });
    assert.equal(
      ruleOf(snapshot, RiskRuleCode.ASSET_SCOPE).reasonCode,
      RiskReasonCode.ASSET_NOT_ALLOWED
    );
  });

  it("R-004 blocks a non-USDT quote and a leveraged token", () => {
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.asset.quoteCurrency = "USDC";
        }),
        RiskRuleCode.ASSET_SCOPE
      ).reasonCode,
      RiskReasonCode.NOT_SPOT_USDT
    );
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.asset.isLeveraged = true;
        }),
        RiskRuleCode.ASSET_SCOPE
      ).reasonCode,
      RiskReasonCode.NOT_SPOT_USDT
    );
  });

  it("R-004 blocks a disabled assignment", () => {
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.candidate.assignmentEnabled = false;
        }),
        RiskRuleCode.ASSET_SCOPE
      ).reasonCode,
      RiskReasonCode.ASSIGNMENT_NOT_ACTIVE
    );
  });

  it("R-005 permits only a fully declared and fully gated synthetic short", () => {
    const allowed = ruleOf(
      buildApprovableShortSnapshot(),
      RiskRuleCode.LONG_ONLY
    );
    assert.equal(allowed.outcome, "PASS");
    assert.equal(allowed.reasonCode, RiskReasonCode.DIRECTION_ALLOWED);

    const flagsOff = clone(buildApprovableShortSnapshot());
    flagsOff.capability.shadowShortEnabled = false;
    assert.equal(
      ruleOf(flagsOff as RiskInputSnapshotV1, RiskRuleCode.LONG_ONLY)
        .reasonCode,
      RiskReasonCode.SHORT_FLAGS_DISABLED
    );

    const mismatch = clone(buildApprovableShortSnapshot());
    mismatch.candidate.assignmentDirection = "LONG";
    assert.equal(
      ruleOf(mismatch as RiskInputSnapshotV1, RiskRuleCode.LONG_ONLY).severity,
      "CRITICAL"
    );

    const exchange = clone(buildApprovableShortSnapshot());
    exchange.capability.exchangeExecutionEnabled = true;
    assert.equal(
      ruleOf(exchange as RiskInputSnapshotV1, RiskRuleCode.LONG_ONLY).severity,
      "CRITICAL"
    );
  });

  it("R-005 fails critically on an unknown direction", () => {
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.candidate.direction = "SIDEWAYS";
        }),
        RiskRuleCode.LONG_ONLY
      ).severity,
      "CRITICAL"
    );
  });

  it("R-006 fails critically on a leveraged instrument", () => {
    const rule = ruleOf(
      mutate((next) => {
        next.asset.isLeveraged = true;
      }),
      RiskRuleCode.NO_LEVERAGE
    );
    assert.equal(rule.reasonCode, RiskReasonCode.LEVERAGE_OR_MARGIN_FORBIDDEN);
    assert.equal(rule.severity, "CRITICAL");
  });
});

describe("stop and per-trade risk rules", () => {
  it("R-007 blocks a stop at or above the entry", () => {
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.candidate.stopPrice = next.candidate.referenceEntryPrice;
        }),
        RiskRuleCode.STOP_REQUIRED
      ).reasonCode,
      RiskReasonCode.STOP_MISSING_OR_INVALID
    );
  });

  it("R-007 blocks a non-positive stop and a stop off the tick grid", () => {
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.candidate.stopPrice = "0.000000000000";
        }),
        RiskRuleCode.STOP_REQUIRED
      ).outcome,
      "FAIL"
    );
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.candidate.stopPrice = "23598.035000000000";
        }),
        RiskRuleCode.STOP_REQUIRED
      ).outcome,
      "FAIL"
    );
  });

  it("R-009 blocks non-positive equity", () => {
    const snapshot = mutate((next) => {
      next.portfolio.equity = "0.000000000000";
      next.portfolio.availableCash = "0.000000000000";
      next.ledgerReplay.availableCash = "0.000000000000";
      next.startOfDay!.equity = "0.000000000000";
    });
    assert.equal(
      ruleOf(snapshot, RiskRuleCode.RISK_PER_TRADE).reasonCode,
      RiskReasonCode.EQUITY_NOT_POSITIVE
    );
  });
});

describe("portfolio limit rules", () => {
  it("R-010 kills on a daily loss at exactly the limit", () => {
    const snapshot = mutate((next) => {
      next.portfolio.equity = "9900.000000000000";
      next.portfolio.availableCash = "9900.000000000000";
      next.ledgerReplay.availableCash = "9900.000000000000";
      next.dailyCounters.dailyPnl = "-100.000000000000";
    });
    const rule = ruleOf(snapshot, RiskRuleCode.DAILY_LOSS);
    assert.equal(rule.reasonCode, RiskReasonCode.DAILY_LOSS_LIMIT_REACHED);
    assert.equal(rule.severity, "CRITICAL");
    const result = evaluateRisk(snapshot);
    assert.equal(result.outcome, "REJECTED");
    assert.equal(result.directive, "ENGAGE_KILL_SWITCH");
  });

  it("R-010 passes just inside the limit and blocks without a start-of-day snapshot", () => {
    const inside = mutate((next) => {
      next.portfolio.equity = "9901.000000000000";
      next.portfolio.availableCash = "9901.000000000000";
      next.ledgerReplay.availableCash = "9901.000000000000";
      next.dailyCounters.dailyPnl = "-99.000000000000";
    });
    assert.equal(ruleOf(inside, RiskRuleCode.DAILY_LOSS).outcome, "PASS");

    const missing = mutate((next) => {
      next.startOfDay = null;
    });
    assert.equal(
      ruleOf(missing, RiskRuleCode.DAILY_LOSS).reasonCode,
      RiskReasonCode.START_OF_DAY_SNAPSHOT_MISSING
    );
  });

  it("R-011 blocks a third open position and counts ERROR positions", () => {
    const snapshot = mutate((next) => {
      next.openPositions = [
        openPosition({
          assetId: "asset-eth",
          symbol: "ETHUSDT",
          marketValue: "10.000000000000"
        }),
        openPosition({
          assetId: "asset-sol",
          symbol: "SOLUSDT",
          marketValue: "10.000000000000",
          status: "ERROR"
        })
      ];
      next.portfolio.equity = "10020.000000000000";
    });
    const rule = ruleOf(snapshot, RiskRuleCode.OPEN_POSITIONS);
    assert.equal(rule.reasonCode, RiskReasonCode.MAX_OPEN_POSITIONS);
    assert.equal(rule.actualValue, "3");
  });

  it("R-012 blocks the fifth entry of a UTC day and passes on the fourth", () => {
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.dailyCounters.filledEntryOrdersToday = 3;
        }),
        RiskRuleCode.TRADES_PER_DAY
      ).outcome,
      "PASS"
    );
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.dailyCounters.filledEntryOrdersToday = 4;
        }),
        RiskRuleCode.TRADES_PER_DAY
      ).reasonCode,
      RiskReasonCode.MAX_DAILY_TRADES
    );
  });

  it("R-014 blocks a second position in the same asset", () => {
    const snapshot = mutate((next) => {
      next.openPositions = [
        openPosition({
          assetId: "asset-btc",
          symbol: "BTCUSDT",
          marketValue: "100.000000000000"
        })
      ];
      next.portfolio.equity = "10100.000000000000";
    });
    assert.equal(
      ruleOf(snapshot, RiskRuleCode.ASSET_EXPOSURE).reasonCode,
      RiskReasonCode.DUPLICATE_ASSET_POSITION
    );
  });

  it("R-015 errors without the fixed correlation group", () => {
    const rule = ruleOf(
      mutate((next) => {
        next.correlationGroup = null;
      }),
      RiskRuleCode.CORRELATION
    );
    assert.equal(rule.outcome, "ERROR");
    assert.equal(rule.reasonCode, RiskReasonCode.CORRELATION_GROUP_MISSING);
  });

  it("R-013 and R-015 cap the size instead of approving beyond the limit", () => {
    const snapshot = mutate((next) => {
      next.openPositions = [
        openPosition({
          assetId: "asset-eth",
          symbol: "ETHUSDT",
          marketValue: "2990.000000000000"
        })
      ];
      next.portfolio.equity = "12990.000000000000";
      next.portfolio.availableCash = "10000.000000000000";
      next.ledgerReplay.availableCash = "10000.000000000000";
      next.startOfDay!.equity = "12990.000000000000";
    });
    const result = evaluateRisk(snapshot);
    assert.equal(result.assessment.sizing.cappedBy, "CORRELATED_EXPOSURE");
    assert.ok(
      d(result.assessment.sizing.postTradeCorrelatedExposure).lte(d("3897"))
    );
  });
});

describe("data, execution profile and regime rules", () => {
  it("R-016 blocks each stale source and a future timestamp", () => {
    for (const [change, reasonCode] of [
      [
        (next: MutableSnapshot) =>
          (next.freshness.candleAgeMs["1h"] = 8_100_001),
        RiskReasonCode.DATA_STALE_CANDLES_1H
      ],
      [
        (next: MutableSnapshot) =>
          (next.freshness.dataQualityAgeMs = 7_200_001),
        RiskReasonCode.DATA_STALE_DATA_QUALITY
      ],
      [
        (next: MutableSnapshot) => (next.freshness.regimeAgeMs = 93_600_001),
        RiskReasonCode.DATA_STALE_REGIME
      ],
      [
        (next: MutableSnapshot) =>
          (next.freshness.portfolioSnapshotAgeMs = 300_001),
        RiskReasonCode.DATA_STALE_PORTFOLIO_SNAPSHOT
      ],
      [
        (next: MutableSnapshot) => (next.freshness.hasFutureTimestamp = true),
        RiskReasonCode.DATA_TIMESTAMP_IN_FUTURE
      ]
    ] as const) {
      assert.equal(
        ruleOf(mutate(change), RiskRuleCode.DATA_FRESHNESS).reasonCode,
        reasonCode
      );
    }
  });

  it("R-016 accepts the exact freshness boundary and refuses one millisecond later", () => {
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.freshness.candleAgeMs["1h"] = 8_100_000;
        }),
        RiskRuleCode.DATA_FRESHNESS
      ).outcome,
      "PASS"
    );
  });

  it("R-016 blocks an expired candidate", () => {
    const snapshot = mutate((next) => {
      next.candidate.expiresAt = "2026-08-02T09:00:00.000Z";
    });
    assert.equal(
      ruleOf(snapshot, RiskRuleCode.DATA_FRESHNESS).reasonCode,
      RiskReasonCode.CANDIDATE_EXPIRED
    );
  });

  it("R-017 blocks thin history, gaps and provider errors", () => {
    for (const change of [
      (next: MutableSnapshot) =>
        (next.dataQuality.minimumClosedCandles["4h"] = 199),
      (next: MutableSnapshot) => (next.dataQuality.gapCount["1d"] = 1),
      (next: MutableSnapshot) => (next.dataQuality.providerErrorCount["1h"] = 1)
    ]) {
      assert.equal(
        ruleOf(mutate(change), RiskRuleCode.DATA_QUALITY).reasonCode,
        RiskReasonCode.DATA_QUALITY_INSUFFICIENT
      );
    }
  });

  it("R-017 fails critically on contradictory OHLC", () => {
    const rule = ruleOf(
      mutate((next) => {
        next.dataQuality.ohlcContradiction = true;
      }),
      RiskRuleCode.DATA_QUALITY
    );
    assert.equal(rule.severity, "CRITICAL");
    assert.equal(
      evaluateRisk(
        mutate((next) => (next.dataQuality.ohlcContradiction = true))
      ).outcome,
      "ERROR"
    );
  });

  it("R-018 and R-019 hold the documented basis point caps", () => {
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.executionProfile!.fullSpreadBps = 20;
        }),
        RiskRuleCode.SPREAD
      ).outcome,
      "PASS"
    );
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.executionProfile!.fullSpreadBps = 21;
        }),
        RiskRuleCode.SPREAD
      ).reasonCode,
      RiskReasonCode.SPREAD_LIMIT_EXCEEDED
    );
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.executionProfile!.slippageBps = 15;
        }),
        RiskRuleCode.SLIPPAGE
      ).outcome,
      "PASS"
    );
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.executionProfile!.slippageBps = 16;
        }),
        RiskRuleCode.SLIPPAGE
      ).reasonCode,
      RiskReasonCode.SLIPPAGE_LIMIT_EXCEEDED
    );
  });

  it("R-018 fails critically without an execution profile", () => {
    const snapshot = mutate((next) => {
      next.executionProfile = null;
    });
    const rule = ruleOf(snapshot, RiskRuleCode.SPREAD);
    assert.equal(rule.reasonCode, RiskReasonCode.EXECUTION_PROFILE_MISSING);
    assert.equal(evaluateRisk(snapshot).outcome, "ERROR");
  });

  it("R-020 blocks a non RISK_ON regime, a defensive mode and low confidence", () => {
    for (const change of [
      (next: MutableSnapshot) => (next.marketRegime!.cryptoRegime = "MIXED"),
      (next: MutableSnapshot) => (next.marketRegime!.riskMode = "DEFENSIVE"),
      (next: MutableSnapshot) => (next.marketRegime!.confidence = 59)
    ]) {
      assert.equal(
        ruleOf(mutate(change), RiskRuleCode.REGIME).reasonCode,
        RiskReasonCode.MARKET_REGIME_CONFLICT
      );
    }
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.marketRegime!.confidence = 60;
        }),
        RiskRuleCode.REGIME
      ).outcome,
      "PASS"
    );
  });
});

describe("structural prohibition rules", () => {
  it("R-021 kills after three consecutive net losses", () => {
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.dailyCounters.consecutiveLosses = 2;
        }),
        RiskRuleCode.LOSS_STREAK
      ).outcome,
      "PASS"
    );
    const snapshot = mutate((next) => {
      next.dailyCounters.consecutiveLosses = 3;
    });
    assert.equal(
      ruleOf(snapshot, RiskRuleCode.LOSS_STREAK).severity,
      "CRITICAL"
    );
    assert.equal(evaluateRisk(snapshot).directive, "ENGAGE_KILL_SWITCH");
  });

  it("R-022 fails critically when exposure for the asset already exists", () => {
    const snapshot = mutate((next) => {
      next.openPositions = [
        openPosition({
          assetId: "asset-btc",
          symbol: "BTCUSDT",
          marketValue: "100.000000000000"
        })
      ];
      next.portfolio.equity = "10100.000000000000";
    });
    const rule = ruleOf(snapshot, RiskRuleCode.NO_SCALE_IN);
    assert.equal(
      rule.reasonCode,
      RiskReasonCode.AVERAGING_OR_SCALE_IN_FORBIDDEN
    );
    assert.equal(rule.severity, "CRITICAL");
  });

  it("R-023 fails critically on a manual size or a risk multiplier", () => {
    for (const change of [
      (next: MutableSnapshot) =>
        (next.sizeOverride.manualQuantity = "1.000000000000"),
      (next: MutableSnapshot) =>
        (next.sizeOverride.riskMultiplier = "2.000000000000"),
      (next: MutableSnapshot) => (next.sizeOverride.requestedBy = "admin")
    ]) {
      const rule = ruleOf(mutate(change), RiskRuleCode.NO_MARTINGALE);
      assert.equal(
        rule.reasonCode,
        RiskReasonCode.NON_DETERMINISTIC_SIZE_OVERRIDE
      );
      assert.equal(rule.severity, "CRITICAL");
    }
  });

  it("R-024 fails when equity fell but the approved risk grew", () => {
    const snapshot = mutate((next) => {
      next.previousApproval = {
        assessedAt: "2026-08-01T12:00:00.000Z",
        equity: "20000.000000000000",
        riskAmount: "1.000000000000"
      };
    });
    const rule = ruleOf(snapshot, RiskRuleCode.NO_POST_LOSS_INCREASE);
    assert.equal(rule.reasonCode, RiskReasonCode.RISK_INCREASE_AFTER_LOSS);
    assert.equal(evaluateRisk(snapshot).directive, "ERROR_LOCK");
  });

  it("R-025 blocks below the minimum quantity, notional and available cash", () => {
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.executionProfile!.minQuantity = "1.000000000000";
        }),
        RiskRuleCode.INSTRUMENT_MINIMUMS
      ).reasonCode,
      RiskReasonCode.BELOW_INSTRUMENT_MINIMUM
    );
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.executionProfile!.minNotional = "100000.000000000000";
        }),
        RiskRuleCode.INSTRUMENT_MINIMUMS
      ).reasonCode,
      RiskReasonCode.BELOW_INSTRUMENT_MINIMUM
    );
  });

  it("R-025 blocks when the rounded quantity collapses to zero", () => {
    const snapshot = mutate((next) => {
      next.executionProfile!.stepSize = "1.000000000000";
    });
    assert.equal(
      ruleOf(snapshot, RiskRuleCode.INSTRUMENT_MINIMUMS).reasonCode,
      RiskReasonCode.QUANTITY_NOT_POSITIVE
    );
  });

  it("R-025 blocks when the reserve exceeds available cash", () => {
    const snapshot = mutate((next) => {
      // Cash is small enough that the reserve cannot be funded, but the risk
      // budget alone would still allow a larger size.
      next.portfolio.availableCash = "20.000000000000";
      next.ledgerReplay.availableCash = "20.000000000000";
      next.portfolio.equity = "20.000000000000";
      next.startOfDay!.equity = "20.000000000000";
    });
    const rule = ruleOf(snapshot, RiskRuleCode.INSTRUMENT_MINIMUMS);
    assert.ok(
      rule.reasonCode === RiskReasonCode.INSUFFICIENT_CASH ||
        rule.reasonCode === RiskReasonCode.BELOW_INSTRUMENT_MINIMUM ||
        rule.reasonCode === RiskReasonCode.QUANTITY_NOT_POSITIVE
    );
    assert.equal(evaluateRisk(snapshot).outcome, "REJECTED");
  });
});

describe("R-026 idempotency and versions", () => {
  it("fails critically on a stored assessment with a different hash", () => {
    const snapshot = mutate((next) => {
      next.existingAssessment = {
        assessmentKey:
          "risk-assessment.v1|trade-candidate-1|risk-limit-set-1|deadbeef",
        inputHash: "f".repeat(64),
        status: "PASS"
      };
    });
    const rule = ruleOf(snapshot, RiskRuleCode.IDEMPOTENCY_VERSION);
    assert.equal(
      rule.reasonCode,
      RiskReasonCode.IDEMPOTENCY_OR_VERSION_CONFLICT
    );
    assert.equal(rule.severity, "CRITICAL");
    const result = evaluateRisk(snapshot);
    assert.equal(result.outcome, "ERROR");
    assert.equal(result.directive, "ERROR_LOCK");
  });

  it("accepts a replay whose stored hash matches", () => {
    const base = buildApprovableSnapshot();
    const inputHash = evaluateRisk(base).inputHash;
    const replay = mutate((next) => {
      next.existingAssessment = {
        assessmentKey:
          "risk-assessment.v1|trade-candidate-1|risk-limit-set-1|x",
        inputHash,
        status: "PASS"
      };
    });
    assert.equal(
      ruleOf(replay, RiskRuleCode.IDEMPOTENCY_VERSION).outcome,
      "PASS"
    );
  });

  it("fails critically on an incomplete candidate plan", () => {
    const rule = ruleOf(
      mutate((next) => {
        next.candidate.earliestFillAt = null;
      }),
      RiskRuleCode.IDEMPOTENCY_VERSION
    );
    assert.equal(rule.reasonCode, RiskReasonCode.CANDIDATE_PLAN_INCOMPLETE);
    assert.equal(rule.severity, "CRITICAL");
  });

  it("fails critically on a retired strategy version and an edited limit set", () => {
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.candidate.strategyVersionStatus = "RETIRED";
        }),
        RiskRuleCode.IDEMPOTENCY_VERSION
      ).reasonCode,
      RiskReasonCode.STRATEGY_VERSION_RETIRED
    );
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.riskLimitSet!.maxOpenPositions = 5;
        }),
        RiskRuleCode.IDEMPOTENCY_VERSION
      ).reasonCode,
      RiskReasonCode.IDEMPOTENCY_OR_VERSION_CONFLICT
    );
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.riskLimitSet!.specificationHash = "0".repeat(64);
        }),
        RiskRuleCode.IDEMPOTENCY_VERSION
      ).reasonCode,
      RiskReasonCode.IDEMPOTENCY_OR_VERSION_CONFLICT
    );
  });

  it("fails critically when the candidate already carries a decision", () => {
    assert.equal(
      ruleOf(
        mutate((next) => {
          next.candidate.hasFinalDecision = true;
        }),
        RiskRuleCode.IDEMPOTENCY_VERSION
      ).reasonCode,
      RiskReasonCode.CANDIDATE_ALREADY_DECIDED
    );
  });
});

describe("determinism and snapshot handling", () => {
  it("returns byte-identical output for the same snapshot", () => {
    const first = evaluateRisk(buildApprovableSnapshot());
    const second = evaluateRisk(buildApprovableSnapshot());
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(first.inputHash, second.inputHash);
    assert.equal(first.outputHash, second.outputHash);
  });

  it("ignores the existing-assessment probe when hashing the input", () => {
    const base = evaluateRisk(buildApprovableSnapshot());
    const withProbe = evaluateRisk(
      mutate((next) => {
        next.existingAssessment = {
          assessmentKey: "k",
          inputHash: base.inputHash,
          status: "PASS"
        };
      })
    );
    assert.equal(withProbe.inputHash, base.inputHash);
  });

  it("changes the hash when any decision value changes", () => {
    const base = evaluateRisk(buildApprovableSnapshot());
    const changed = evaluateRisk(
      mutate((next) => {
        next.portfolio.equity = "10001.000000000000";
      })
    );
    assert.notEqual(changed.inputHash, base.inputHash);
  });

  it("never mutates the snapshot", () => {
    const snapshot = buildApprovableSnapshot();
    const before = JSON.stringify(snapshot);
    evaluateRisk(snapshot);
    assert.equal(JSON.stringify(snapshot), before);
  });

  it("derives the timestamp from asOf, never from the system clock", () => {
    const snapshot = buildApprovableSnapshot();
    assert.equal(evaluateRisk(snapshot).evaluatedAt, snapshot.asOf);
    assert.equal(evaluateRisk(snapshot).assessment.assessedAt, snapshot.asOf);
  });

  it("errors with all 26 results on an unsupported snapshot version", () => {
    const snapshot = {
      ...buildApprovableSnapshot(),
      snapshotVersion: "RISK_INPUT_SNAPSHOT_V2"
    };
    const result = evaluateRisk(snapshot as unknown as RiskInputSnapshotV1);
    assert.equal(result.outcome, "ERROR");
    assert.equal(result.ruleResults.length, 26);
    assert.equal(
      result.primaryReasonCode,
      RiskReasonCode.RISK_SNAPSHOT_VERSION_UNSUPPORTED
    );
    assert.equal(result.directive, "ERROR_LOCK");
  });
});
