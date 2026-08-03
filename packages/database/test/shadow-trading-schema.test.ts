/**
 * Contract tests for the Shadow Trading v1 schema and its migration.
 *
 * Specification: docs/trading/03-domain-model.md, docs/trading/10 (package P1)
 * and docs/trading/12 ("Domain- und Schema-Abnahme").
 *
 * These tests read the Prisma schema and the migration SQL as text, so they run
 * without a database. The optional PostgreSQL integration checks live in
 * `packages/database/test/shadow-trading-schema.integration.test.ts` style runs
 * and are not part of this file.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import * as domain from "@signalpilot/trading-domain";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "..", "prisma", "schema.prisma");
const migrationPath = join(
  here,
  "..",
  "prisma",
  "migrations",
  "20260802090000_add_shadow_trading_domain",
  "migration.sql"
);

const schema = readFileSync(schemaPath, "utf8");
const migration = readFileSync(migrationPath, "utf8");

// ── Helpers ────────────────────────────────────────────────────────────────

function block(kind: "model" | "enum", name: string): string {
  const match = schema.match(new RegExp(`^${kind} ${name} \\{$([\\s\\S]*?)^\\}$`, "m"));
  assert.ok(match, `${kind} ${name} is missing from schema.prisma`);
  return match[1];
}

function bodyLines(kind: "model" | "enum", name: string): string[] {
  return block(kind, name)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("//") && !line.startsWith("///"));
}

/** `fieldName Type` for every field, attributes stripped. */
function fieldSignatures(model: string): string[] {
  return bodyLines("model", model)
    .filter((line) => !line.startsWith("@@"))
    .map((line) => line.split(/\s+/).slice(0, 2).join(" "));
}

function enumValues(name: string): string[] {
  return bodyLines("enum", name);
}

function fieldLine(model: string, field: string): string {
  const line = bodyLines("model", model).find((entry) => entry.split(/\s+/)[0] === field);
  assert.ok(line, `${model}.${field} is missing`);
  return line;
}

const SHADOW_MODELS = [
  "Strategy",
  "StrategyVersion",
  "StrategyAssignment",
  "InstrumentExecutionProfile",
  "TradeCandidate",
  "TradeCandidateEvidence",
  "TradeDecision",
  "RiskAssessment",
  "RiskRuleResult",
  "RiskLimitSet",
  "RiskEvent",
  "ShadowOrder",
  "ShadowFill",
  "ShadowPosition",
  "ShadowPositionEvent",
  "ExitPlan",
  "Portfolio",
  "PortfolioLedgerEntry",
  "PortfolioSnapshot",
  "TradingSession",
  "StrategyPerformance",
  "TradingAuditEvent",
  "TradingJobCursor"
] as const;

// ── Models and fields ──────────────────────────────────────────────────────

describe("shadow trading schema — models", () => {
  it("declares every aggregate from docs/trading/03", () => {
    for (const model of SHADOW_MODELS) {
      assert.ok(schema.includes(`model ${model} {`), `model ${model} is missing`);
    }
  });

  it("creates exactly these 23 tables in the migration", () => {
    const created = [...migration.matchAll(/CREATE TABLE "([A-Za-z]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(created, [...SHADOW_MODELS].sort());
  });

  it("carries the documented key columns", () => {
    const keyColumns: ReadonlyArray<[string, string]> = [
      ["Strategy", "key"],
      ["TradeCandidate", "candidateKey"],
      ["TradeDecision", "decisionKey"],
      ["RiskAssessment", "assessmentKey"],
      ["RiskEvent", "eventKey"],
      ["ShadowOrder", "orderKey"],
      ["ShadowOrder", "clientOrderId"],
      ["ShadowFill", "fillKey"],
      ["ShadowPosition", "positionKey"],
      ["ShadowPositionEvent", "eventKey"],
      ["Portfolio", "key"],
      ["PortfolioLedgerEntry", "entryKey"],
      ["TradingSession", "sessionKey"],
      ["TradingAuditEvent", "eventKey"],
      // P8: replaces the former composite key on StrategyPerformance, which
      // could not hold once one window carries several segments and several
      // engine versions side by side.
      ["StrategyPerformance", "snapshotKey"],
      ["TradingAlertOutbox", "idempotencyKey"]
    ];
    for (const [model, field] of keyColumns) {
      assert.match(fieldLine(model, field), /@unique/, `${model}.${field} must be unique`);
    }
  });

  it("carries the documented composite unique constraints", () => {
    const composites: ReadonlyArray<[string, string]> = [
      ["StrategyVersion", "@@unique([strategyId, version])"],
      ["InstrumentExecutionProfile", "@@unique([assetId, version])"],
      ["TradeCandidate", "@@unique([strategyAssignmentId, strategyVersionId, assetId, anchorCandleId])"],
      ["TradeCandidateEvidence", "@@unique([tradeCandidateId, type, sourceType, sourceKey])"],
      ["RiskRuleResult", "@@unique([riskAssessmentId, ruleCode])"],
      ["RiskLimitSet", "@@unique([key, version])"],
      ["ShadowFill", "@@unique([shadowOrderId, sequence])"],
      ["ShadowPositionEvent", "@@unique([shadowPositionId, sequence])"],
      ["ExitPlan", "@@unique([shadowPositionId, version])"],
      ["PortfolioLedgerEntry", "@@unique([portfolioId, sequence])"],
      ["PortfolioSnapshot", "@@unique([portfolioId, asOf, sourceLedgerSequence])"],
      ["TradingJobCursor", "@@unique([jobKey, scopeKey])"]
    ];
    for (const [model, constraint] of composites) {
      assert.ok(
        bodyLines("model", model).includes(constraint),
        `${model} must declare ${constraint}`
      );
    }
  });

  it("expresses every 'at most one active' rule as a nullable unique key", () => {
    const scopeKeys: ReadonlyArray<[string, string]> = [
      ["StrategyAssignment", "activeScopeKey"],
      ["InstrumentExecutionProfile", "activeAssetKey"],
      ["RiskLimitSet", "activeScopeKey"],
      ["ShadowOrder", "entryCandidateKey"],
      ["ShadowPosition", "openScopeKey"],
      ["ExitPlan", "activePositionKey"],
      ["TradingSession", "activePortfolioKey"]
    ];
    for (const [model, field] of scopeKeys) {
      const line = fieldLine(model, field);
      assert.match(line, /String\?/, `${model}.${field} must be nullable`);
      assert.match(line, /@unique/, `${model}.${field} must be unique`);
    }
  });

  it("gives every mutable workflow aggregate an optimistic-lock version", () => {
    for (const model of [
      "StrategyAssignment",
      "TradeCandidate",
      "ShadowOrder",
      "ShadowPosition",
      "Portfolio",
      "TradingSession",
      "TradingJobCursor"
    ]) {
      assert.match(fieldLine(model, "version"), /Int\s+@default\(0\)/, `${model}.version`);
    }
  });

  it("gives every claimable aggregate the recovery claim triple", () => {
    for (const model of ["TradeCandidate", "ShadowOrder", "TradingJobCursor"]) {
      for (const field of ["claimedBy", "claimedAt", "claimExpiresAt"]) {
        assert.ok(fieldLine(model, field).includes("?"), `${model}.${field} must be nullable`);
      }
    }
  });

  it("records input, output and specification hashes where reproducibility is required", () => {
    const hashes: ReadonlyArray<[string, string]> = [
      ["StrategyVersion", "specificationHash"],
      ["InstrumentExecutionProfile", "specificationHash"],
      ["RiskLimitSet", "specificationHash"],
      ["ExitPlan", "specificationHash"],
      ["TradeCandidate", "inputHash"],
      ["TradeCandidateEvidence", "payloadHash"],
      ["TradeDecision", "inputHash"],
      ["TradeDecision", "outputHash"],
      ["RiskAssessment", "inputHash"],
      ["RiskAssessment", "outputHash"],
      ["ShadowFill", "inputHash"],
      ["PortfolioSnapshot", "inputHash"],
      ["StrategyPerformance", "inputHash"],
      ["RiskEvent", "inputHash"]
    ];
    for (const [model, field] of hashes) {
      assert.ok(fieldLine(model, field).startsWith(field), `${model}.${field} is missing`);
    }
  });
});

// ── Decimal precision ──────────────────────────────────────────────────────

describe("shadow trading schema — money precision", () => {
  it("uses Decimal(30,12) for every Decimal in the shadow domain", () => {
    for (const model of SHADOW_MODELS) {
      for (const line of bodyLines("model", model)) {
        if (!/^\w+\s+Decimal\??/.test(line)) continue;
        assert.match(
          line,
          /@db\.Decimal\(30, 12\)/,
          `${model}: ${line} must use @db.Decimal(30, 12)`
        );
      }
    }
  });

  it("never models money, price, quantity, fee or P&L as Float", () => {
    for (const model of SHADOW_MODELS) {
      for (const line of bodyLines("model", model)) {
        assert.ok(
          !/^\w+\s+Float\??/.test(line),
          `${model}: ${line} must not be a Float in the trading domain`
        );
      }
    }
  });

  it("keeps basis points as Int and rates as Decimal", () => {
    for (const [model, field] of [
      ["InstrumentExecutionProfile", "feeBps"],
      ["InstrumentExecutionProfile", "fullSpreadBps"],
      ["InstrumentExecutionProfile", "slippageBps"],
      ["RiskLimitSet", "maxSpreadBps"],
      ["RiskLimitSet", "maxSlippageBps"]
    ] as const) {
      assert.match(fieldLine(model, field), /\bInt\b/, `${model}.${field} must be Int`);
    }
    for (const [model, field] of [
      ["InstrumentExecutionProfile", "maxParticipationRate"],
      ["RiskLimitSet", "maxRiskPerTradePct"],
      ["RiskLimitSet", "maxDailyLossPct"],
      ["RiskLimitSet", "maxGrossExposurePct"]
    ] as const) {
      assert.match(fieldLine(model, field), /Decimal.*@db\.Decimal\(30, 12\)/, `${model}.${field}`);
    }
  });

  it("stores the business trading date next to the UTC timestamps", () => {
    assert.match(fieldLine("PortfolioSnapshot", "tradingDateUtc"), /@db\.Date/);
    assert.match(fieldLine("RiskAssessment", "tradingDateUtc"), /@db\.Date/);
  });
});

// ── Referential integrity ──────────────────────────────────────────────────

describe("shadow trading schema — referential integrity", () => {
  it("never cascades a delete out of financial history", () => {
    for (const model of SHADOW_MODELS) {
      for (const line of bodyLines("model", model)) {
        if (!line.includes("@relation(fields:")) continue;
        assert.ok(
          !line.includes("onDelete: Cascade"),
          `${model}: ${line} must not cascade-delete financial history`
        );
        assert.ok(
          line.includes("onDelete: Restrict") || line.includes("onDelete: SetNull"),
          `${model}: ${line} must declare Restrict or SetNull`
        );
      }
    }
  });

  it("protects strategy, portfolio, order, fill and position history with Restrict", () => {
    const restricted: ReadonlyArray<[string, string]> = [
      ["StrategyVersion", "strategy"],
      ["TradeCandidate", "portfolio"],
      ["TradeCandidate", "strategyVersion"],
      ["TradeCandidateEvidence", "tradeCandidate"],
      ["TradeDecision", "tradeCandidate"],
      ["RiskRuleResult", "riskAssessment"],
      ["ShadowOrder", "portfolio"],
      ["ShadowFill", "shadowOrder"],
      ["ShadowPosition", "entryOrder"],
      ["ShadowPositionEvent", "shadowPosition"],
      ["ExitPlan", "shadowPosition"],
      ["PortfolioLedgerEntry", "portfolio"],
      ["PortfolioSnapshot", "portfolio"],
      ["TradingSession", "portfolio"]
    ];
    for (const [model, relation] of restricted) {
      assert.match(fieldLine(model, relation), /onDelete: Restrict/, `${model}.${relation}`);
    }
  });

  it("lets a pruned analysis source detach instead of blocking retention", () => {
    for (const [model, relation] of [
      ["TradeCandidate", "anchorSignal"],
      ["ShadowOrder", "lastProcessedCandle"],
      ["ShadowPosition", "lastProcessedCandle"],
      ["ShadowPositionEvent", "sourceCandle"],
      ["TradingJobCursor", "lastCandle"]
    ] as const) {
      assert.match(fieldLine(model, relation), /onDelete: SetNull/, `${model}.${relation}`);
    }
  });

  it("pins the reproducibility-critical candle references with Restrict", () => {
    assert.match(fieldLine("TradeCandidate", "anchorCandle"), /onDelete: Restrict/);
    assert.match(fieldLine("ShadowFill", "sourceCandle"), /onDelete: Restrict/);
  });
});

// ── Fail-closed defaults ───────────────────────────────────────────────────

describe("shadow trading schema — fail-closed defaults", () => {
  it("starts every structure disabled", () => {
    assert.match(fieldLine("Strategy", "status"), /@default\(DRAFT\)/);
    assert.match(fieldLine("StrategyVersion", "status"), /@default\(DRAFT\)/);
    assert.match(fieldLine("StrategyAssignment", "enabled"), /Boolean\s+@default\(false\)/);
    assert.match(fieldLine("InstrumentExecutionProfile", "status"), /@default\(DRAFT\)/);
    assert.match(fieldLine("RiskLimitSet", "status"), /@default\(DRAFT\)/);
    assert.match(fieldLine("Portfolio", "status"), /@default\(DRAFT\)/);
    assert.match(fieldLine("TradingSession", "status"), /@default\(STOPPED\)/);
    assert.match(fieldLine("TradingSession", "killSwitchEngaged"), /Boolean\s+@default\(true\)/);
  });

  it("offers no live mode and no limit order type", () => {
    assert.deepEqual(enumValues("TradingSessionMode"), ["SHADOW"]);
    assert.deepEqual(enumValues("ShadowOrderType"), ["MARKET"]);
    assert.deepEqual(enumValues("TradeDirection"), ["LONG"]);
    assert.deepEqual(enumValues("TradeEntryType"), ["MARKET"]);
    assert.deepEqual(enumValues("IntrabarConflictPolicy"), ["STOP_FIRST"]);
    assert.deepEqual(enumValues("RiskLimitScope"), ["PORTFOLIO"]);
  });
});

// ── Enum parity with the domain package ────────────────────────────────────

describe("shadow trading schema — enum parity with @signalpilot/trading-domain", () => {
  const parity = [
    "StrategyStatus",
    "StrategyVersionStatus",
    "TradeDirection",
    "TradeEntryType",
    "TradeCandidateStatus",
    "TradeEvidenceType",
    "TradeDecisionOutcome",
    "RiskAssessmentStatus",
    "RiskRuleOutcome",
    "RiskSeverity",
    "RiskLimitSetStatus",
    "RiskLimitScope",
    "RiskEventType",
    "InstrumentExecutionProfileStatus",
    "ShadowOrderPurpose",
    "ShadowOrderSide",
    "ShadowOrderType",
    "ShadowOrderTimeInForce",
    "ShadowOrderStatus",
    "ShadowFillTriggerType",
    "ShadowPositionStatus",
    "ShadowPositionEventType",
    "ExitPlanStatus",
    "IntrabarConflictPolicy",
    "PortfolioStatus",
    "PortfolioLedgerEntryType",
    "TradingSessionMode",
    "TradingSessionStatus",
    "StrategyPerformanceWindow",
    "TradingActorType"
  ] as const;

  it("declares the same members in the same order on both sides", () => {
    const registry = domain as unknown as Record<string, Record<string, string>>;
    for (const name of parity) {
      const domainEnum = registry[name];
      assert.ok(domainEnum, `@signalpilot/trading-domain does not export ${name}`);
      assert.deepEqual(Object.values(domainEnum), enumValues(name), `enum ${name} differs`);
    }
  });

  it("covers every shadow enum declared in the migration", () => {
    const created = [...migration.matchAll(/CREATE TYPE "([A-Za-z]+)" AS ENUM/g)].map((m) => m[1]);
    assert.equal(created.length, 30);
    for (const name of created) {
      assert.ok(schema.includes(`enum ${name} {`), `enum ${name} is missing from schema.prisma`);
    }
  });
});

// ── Legacy protection ──────────────────────────────────────────────────────

describe("legacy paper models stay untouched", () => {
  it("keeps PaperAccount exactly as it was", () => {
    assert.deepEqual(fieldSignatures("PaperAccount"), [
      "id String",
      "name String",
      "startingBalance Decimal",
      "currentBalance Decimal",
      "currency String",
      "isActive Boolean",
      "createdAt DateTime",
      "updatedAt DateTime",
      "orders PaperOrder[]",
      "positions PaperPosition[]"
    ]);
  });

  it("keeps PaperOrder exactly as it was", () => {
    assert.deepEqual(fieldSignatures("PaperOrder"), [
      "id String",
      "paperAccountId String",
      "assetId String",
      "signalId String?",
      "side PaperOrderSide",
      "quantity Decimal",
      "price Decimal",
      "status PaperOrderStatus",
      "createdAt DateTime",
      "filledAt DateTime?",
      "paperAccount PaperAccount",
      "asset Asset",
      "signal Signal?"
    ]);
  });

  it("keeps PaperPosition exactly as it was", () => {
    assert.deepEqual(fieldSignatures("PaperPosition"), [
      "id String",
      "paperAccountId String",
      "assetId String",
      "quantity Decimal",
      "averageEntryPrice Decimal",
      "status PaperPositionStatus",
      "openedAt DateTime",
      "closedAt DateTime?",
      "paperAccount PaperAccount",
      "asset Asset"
    ]);
  });

  it("keeps PaperSignalEvaluation exactly as it was", () => {
    assert.deepEqual(fieldSignatures("PaperSignalEvaluation"), [
      "id String",
      "signalId String",
      "signal Signal",
      "assetId String",
      "symbol String",
      "timeframe String",
      "direction SignalDirection",
      "status SignalStatus",
      "signalType SignalType",
      "score Float",
      "riskLevel RiskLevel",
      "entryPrice Decimal",
      "invalidationPrice Decimal?",
      "targetPrice Decimal?",
      "evaluationKind PaperEvaluationKind",
      "expectedMoveDirection PaperExpectedMoveDirection",
      "evaluationStatus PaperEvaluationStatus",
      "skipReason String?",
      "openedAt DateTime",
      "evaluatedAt DateTime?",
      "priceAfter1h Decimal?",
      "priceAfter4h Decimal?",
      "priceAfter1d Decimal?",
      "priceAfter3d Decimal?",
      "returnAfter1h Float?",
      "returnAfter4h Float?",
      "returnAfter1d Float?",
      "returnAfter3d Float?",
      "maxFavorableMove Float?",
      "maxAdverseMove Float?",
      "outcome PaperEvaluationOutcome?",
      "notes String?",
      "createdAt DateTime",
      "updatedAt DateTime"
    ]);
  });

  it("keeps every legacy paper enum unchanged", () => {
    assert.deepEqual(enumValues("PaperOrderSide"), ["BUY", "SELL"]);
    assert.deepEqual(enumValues("PaperOrderStatus"), ["PENDING", "FILLED", "CANCELLED", "REJECTED"]);
    assert.deepEqual(enumValues("PaperPositionStatus"), ["OPEN", "CLOSED"]);
    assert.deepEqual(enumValues("PaperEvaluationStatus"), ["OPEN", "EVALUATED", "EXPIRED", "SKIPPED"]);
    assert.deepEqual(enumValues("PaperEvaluationOutcome"), [
      "POSITIVE",
      "NEGATIVE",
      "NEUTRAL",
      "INVALIDATED",
      "TARGET_REACHED"
    ]);
    assert.deepEqual(enumValues("PaperEvaluationKind"), [
      "DIRECTIONAL_BULLISH",
      "DIRECTIONAL_BEARISH",
      "RISK_WARNING",
      "OBSERVATION",
      "SKIPPED"
    ]);
    assert.deepEqual(enumValues("PaperExpectedMoveDirection"), ["UP", "DOWN", "ANY", "NONE"]);
  });

  it("never reuses a legacy paper enum inside the shadow domain", () => {
    for (const model of SHADOW_MODELS) {
      for (const line of bodyLines("model", model)) {
        assert.ok(!/\bPaper[A-Za-z]*\b/.test(line), `${model}: ${line} must not reference a legacy Paper type`);
      }
    }
  });
});

// ── Migration safety ───────────────────────────────────────────────────────

describe("shadow trading migration is strictly additive", () => {
  const statements = migration
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("--"));

  it("contains no destructive statement", () => {
    const forbidden = [
      /^DROP\b/i,
      /^DELETE\b/i,
      /^TRUNCATE\b/i,
      /^UPDATE\b/i,
      /^INSERT\b/i,
      /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT|SCHEMA|DATABASE)\b/i,
      /\bRENAME\b/i,
      /\bALTER\s+COLUMN\b/i
    ];
    for (const statement of statements) {
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(statement), `destructive statement found: ${statement}`);
      }
    }
  });

  it("only alters the tables it just created", () => {
    const altered = new Set([...migration.matchAll(/ALTER TABLE "([A-Za-z]+)"/g)].map((m) => m[1]));
    const created = new Set([...migration.matchAll(/CREATE TABLE "([A-Za-z]+)"/g)].map((m) => m[1]));
    for (const table of altered) {
      assert.ok(created.has(table), `migration alters pre-existing table ${table}`);
    }
  });

  it("only adds foreign keys, never other kinds of ALTER", () => {
    const alters = statements.filter((statement) => statement.startsWith("ALTER TABLE"));
    assert.ok(alters.length > 0);
    for (const statement of alters) {
      assert.match(statement, /ADD CONSTRAINT "[A-Za-z_]+" FOREIGN KEY/, `unexpected ALTER: ${statement}`);
    }
  });

  it("never references a legacy paper table or enum in an executed statement", () => {
    // The header comment names them; no statement may.
    for (const statement of statements) {
      assert.ok(!/Paper/.test(statement), `the migration must not touch a legacy paper model: ${statement}`);
    }
  });

  it("seeds no data, so no active trading record exists after deployment", () => {
    assert.ok(!/\bINSERT\s+INTO\b/i.test(migration));
    assert.ok(!/\bCOPY\b/i.test(migration));
  });

  it("creates no exchange, credential or live trading artefact", () => {
    for (const forbidden of ["bitget", "binance_key", "apiKey", "apiSecret", "passphrase", "LIVE"]) {
      assert.ok(
        !new RegExp(forbidden, "i").test(migration),
        `the migration must not reference ${forbidden}`
      );
    }
  });

  it("is the single shadow trading migration in the history", () => {
    const migrationsDir = join(here, "..", "prisma", "migrations");
    const shadowMigrations = readdirSync(migrationsDir).filter((entry) => entry.includes("shadow_trading"));
    assert.deepEqual(shadowMigrations, ["20260802090000_add_shadow_trading_domain"]);
  });
});

// ── Work package 8 ──────────────────────────────────────────────────────────

describe("shadow performance and alert outbox schema (P8)", () => {
  it("identifies a performance snapshot by portfolio, window, asOf, segment, engine version and input hash", () => {
    // The identity lives in `snapshotKey` (built by
    // `buildStrategyPerformanceSnapshotKey`), not in a composite column key —
    // a recomputation with a changed engine version or changed source data
    // must add a row, never overwrite one.
    const body = bodyLines("model", "StrategyPerformance");
    assert.match(fieldLine("StrategyPerformance", "snapshotKey"), /@unique/);
    assert.ok(body.some((line) => line.startsWith("segmentType")));
    assert.ok(body.some((line) => line.startsWith("segmentKey")));
    assert.ok(body.some((line) => line.startsWith("engineVersion")));
    assert.ok(body.some((line) => line.startsWith("inputHash")));
    assert.ok(body.some((line) => line.startsWith("outputHash")));
    assert.ok(body.some((line) => line.startsWith("dataThroughAt")));
  });

  it("keeps strategyVersionId nullable so cross-version segments can exist", () => {
    // An ASSET, MARKET_REGIME or EXIT_REASON segment aggregates across
    // strategy versions and has no single version to point at.
    assert.match(fieldLine("StrategyPerformance", "strategyVersionId"), /String\?/);
  });

  it("models every new P8 metric as Decimal, never Float", () => {
    const body = bodyLines("model", "StrategyPerformance");
    const metricFields = [
      "winRatePct",
      "grossProfit",
      "grossLoss",
      "simulatedExecutionCost",
      "averageWin",
      "averageLoss",
      "cumulativeR",
      "maxDrawdownAmount",
      "recoveryFactor",
      "exposureMinutes",
      "exposurePct",
      "averageMaePct",
      "averageMfePct",
      "sharpeRatio",
      "sortinoRatio",
      "riskRejectionRatePct"
    ];
    for (const field of metricFields) {
      const line = body.find((entry) => entry.startsWith(`${field} `));
      assert.ok(line, `StrategyPerformance.${field} must exist`);
      assert.match(line, /Decimal/, `${field} must be Decimal`);
      assert.match(line, /@db\.Decimal\(30, 12\)/, `${field} must use Decimal(30,12)`);
      assert.doesNotMatch(line, /Float/, `${field} must never be Float`);
    }
  });

  it("gives the alert outbox a stable idempotency key and a bounded retry budget", () => {
    const body = bodyLines("model", "TradingAlertOutbox");
    assert.match(fieldLine("TradingAlertOutbox", "idempotencyKey"), /@unique/);
    for (const field of ["attemptCount", "maxAttempts", "nextAttemptAt", "payloadHash", "status"]) {
      assert.ok(body.some((line) => line.startsWith(`${field} `)), `TradingAlertOutbox.${field} must exist`);
    }
  });

  it("declares every documented outbox status, including a terminal DEAD", () => {
    const statuses = bodyLines("enum", "TradingAlertOutboxStatus");
    assert.deepEqual(statuses.sort(), ["DEAD", "FAILED", "PENDING", "PROCESSING", "SENT"].sort());
  });

  it("limits the alert catalogue to safety- and operations-relevant events", () => {
    const events = bodyLines("enum", "TradingAlertEventType");
    assert.deepEqual(
      events.sort(),
      [
        "CIRCUIT_BREAKER_OPEN",
        "CRITICAL_RISK_EVENT",
        "DAILY_LOSS_LIMIT_REACHED",
        "KILL_SWITCH_ENGAGED",
        "PORTFOLIO_LEDGER_CONFLICT",
        "POSITION_MONITOR_STALE",
        "POSITION_WITHOUT_SAFE_EXIT",
        "RECONCILIATION_FAILED",
        "SESSION_ERROR_LOCKED",
        "WORKER_HEARTBEAT_STALE"
      ].sort(),
      "no ordinary candidate or trade notification may enter the catalogue"
    );
  });

  it("logs one row per delivery attempt, uniquely numbered per entry", () => {
    const body = bodyLines("model", "TradingAlertOutboxAttempt");
    assert.ok(body.includes("@@unique([outboxId, attempt])"));
    for (const field of ["attempt", "status", "startedAt", "finishedAt"]) {
      assert.ok(body.some((line) => line.startsWith(`${field} `)), `${field} must exist`);
    }
  });
});
