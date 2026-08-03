/**
 * @signalpilot/risk-engine — deterministic pre-trade risk evaluation for
 * SignalPilot Shadow Trading v1.
 *
 * The package turns a complete `RiskInputSnapshotV1` into an `APPROVED`,
 * `REJECTED` or `ERROR` verdict with a conservative position size, all 26 rule
 * results and the drafted `RiskAssessment` and `TradeDecision` rows.
 *
 * It must never read a database, call the network, read `process.env`, look at
 * the system clock or consult an LLM (docs/trading/02, module table;
 * docs/trading/decisions/0003-deterministic-versioned-engines.md). It also
 * never creates an order, fill, position or ledger entry — those belong to
 * work package 4.
 */

export * from "./contracts.js";
export * from "./reason-codes.js";
export * from "./policy-v1.js";
export * from "./position-sizing.js";
export * from "./post-fill-recheck.js";
export * from "./rules.js";
export * from "./evaluate-risk.js";
