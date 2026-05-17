import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BotRunStatus,
  PaperEvaluationOutcome,
  PaperEvaluationStatus,
  Prisma,
  RiskLevel,
  SignalDirection,
  SignalStatus,
  SignalType
} from "@signalpilot/database";

import {
  createPaperEvaluationsForSignals,
  evaluatePaperSignals
} from "../src/jobs/paperSignalEvaluations.js";

describe("paper signal evaluations", () => {
  it("creates evaluations for WATCH and STRONG_WATCH signals", async () => {
    const created: unknown[] = [];
    const database = createPaperDatabase({
      signals: [
        createSignal({ id: "signal-watch", status: SignalStatus.WATCH }),
        createSignal({ id: "signal-strong", status: SignalStatus.STRONG_WATCH })
      ],
      created
    });

    const summary = await createPaperEvaluationsForSignals(database as never);

    assert.equal(summary.createdEvaluationCount, 2);
    assert.equal(created.length, 2);
  });

  it("skips NO_EDGE signals", async () => {
    const created: unknown[] = [];
    const database = createPaperDatabase({
      signals: [createSignal({ status: SignalStatus.NO_EDGE, signalType: SignalType.NO_SIGNAL })],
      created
    });

    const summary = await createPaperEvaluationsForSignals(database as never);

    assert.equal(summary.skippedSignalCount, 1);
    assert.equal(summary.createdEvaluationCount, 0);
    assert.equal(created.length, 0);
  });

  it("keeps evaluation creation idempotent per signalId", async () => {
    const database = createPaperDatabase({
      signals: [createSignal()],
      createError: new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test"
      })
    });

    const summary = await createPaperEvaluationsForSignals(database as never);

    assert.equal(summary.createdEvaluationCount, 0);
    assert.equal(summary.duplicateSkipCount, 1);
  });

  it("evaluates bullish returns as positive", async () => {
    const updates: Array<{ data: Record<string, unknown> }> = [];
    const openedAt = new Date("2026-01-01T00:00:00.000Z");
    const database = createPaperDatabase({
      evaluations: [
        createEvaluation({
          direction: SignalDirection.BULLISH,
          entryPrice: "100",
          targetPrice: "110",
          invalidationPrice: "98",
          openedAt
        })
      ],
      candles: createEvaluationCandles(openedAt, [100, 100.3, 100.6, 101.2, 102], 102, 99),
      updates
    });

    const summary = await evaluatePaperSignals(database as never);
    const update = updates.at(-1)?.data;

    assert.equal(summary.evaluatedCount, 1);
    assert.equal(update?.outcome, PaperEvaluationOutcome.POSITIVE);
    assert.equal(Math.round((update?.returnAfter1d as number) * 10) / 10, 1.2);
  });

  it("evaluates bearish and AVOID signals as positive warning outcomes when price falls", async () => {
    const updates: Array<{ data: Record<string, unknown> }> = [];
    const openedAt = new Date("2026-01-01T00:00:00.000Z");
    const database = createPaperDatabase({
      evaluations: [
        createEvaluation({
          direction: SignalDirection.BEARISH,
          status: SignalStatus.AVOID,
          entryPrice: "100",
          targetPrice: "90",
          invalidationPrice: "104",
          openedAt
        })
      ],
      candles: createEvaluationCandles(openedAt, [100, 99.8, 99, 98, 97], 101, 97),
      updates
    });

    await evaluatePaperSignals(database as never);

    assert.equal(updates.at(-1)?.data.outcome, PaperEvaluationOutcome.POSITIVE);
    assert.equal(Math.round((updates.at(-1)?.data.returnAfter1d as number) * 10) / 10, -2);
  });

  it("expires open evaluations after 4 days without enough data", async () => {
    const updates: Array<{ data: Record<string, unknown> }> = [];
    const openedAt = new Date("2020-01-01T00:00:00.000Z");
    const database = createPaperDatabase({
      evaluations: [createEvaluation({ openedAt })],
      candles: [],
      updates
    });

    const summary = await evaluatePaperSignals(database as never);

    assert.equal(summary.expiredCount, 1);
    assert.equal(updates.at(-1)?.data.evaluationStatus, PaperEvaluationStatus.EXPIRED);
  });
});

function createPaperDatabase(input: {
  signals?: ReturnType<typeof createSignal>[];
  evaluations?: ReturnType<typeof createEvaluation>[];
  candles?: ReturnType<typeof createCandle>[];
  created?: unknown[];
  updates?: Array<{ data: Record<string, unknown> }>;
  createError?: Error;
}) {
  const created = input.created ?? [];
  const updates = input.updates ?? [];

  return {
    botRun: {
      create: async () => ({ id: "bot-run-1" }),
      update: async () => ({ id: "bot-run-1", status: BotRunStatus.SUCCESS })
    },
    botLog: {
      create: async () => undefined
    },
    signal: {
      findMany: async () => input.signals ?? []
    },
    candle: {
      findFirst: async () => input.candles?.[0] ?? createCandle(),
      findMany: async () => input.candles ?? []
    },
    paperSignalEvaluation: {
      create: async (operation: unknown) => {
        if (input.createError) {
          throw input.createError;
        }

        created.push(operation);
      },
      findMany: async () => input.evaluations ?? [],
      update: async (operation: { data: Record<string, unknown> }) => {
        updates.push(operation);
        return operation.data;
      }
    }
  };
}

function createSignal(overrides: Partial<ReturnType<typeof createBaseSignal>> = {}) {
  return {
    ...createBaseSignal(),
    ...overrides
  };
}

function createBaseSignal() {
  return {
    id: "signal-1",
    assetId: "asset-1",
    symbol: "BTCUSDT",
    timeframe: "1h",
    signalType: SignalType.TREND_ALERT,
    status: SignalStatus.WATCH,
    direction: SignalDirection.BULLISH,
    score: 72,
    riskLevel: RiskLevel.MEDIUM,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    output: {
      technicalJson: {}
    },
    paperEvaluation: null
  };
}

function createEvaluation(overrides: Partial<ReturnType<typeof createBaseEvaluation>> = {}) {
  return {
    ...createBaseEvaluation(),
    ...overrides
  };
}

function createBaseEvaluation() {
  return {
    id: "evaluation-1",
    signalId: "signal-1",
    assetId: "asset-1",
    symbol: "BTCUSDT",
    timeframe: "1h",
    direction: SignalDirection.BULLISH,
    status: SignalStatus.WATCH,
    signalType: SignalType.TREND_ALERT,
    score: 72,
    riskLevel: RiskLevel.MEDIUM,
    entryPrice: "100",
    invalidationPrice: "98",
    targetPrice: "104",
    evaluationStatus: PaperEvaluationStatus.OPEN,
    openedAt: new Date("2026-01-01T00:00:00.000Z"),
    evaluatedAt: null,
    priceAfter1h: null,
    priceAfter4h: null,
    priceAfter1d: null,
    priceAfter3d: null,
    returnAfter1h: null,
    returnAfter4h: null,
    returnAfter1d: null,
    returnAfter3d: null,
    maxFavorableMove: null,
    maxAdverseMove: null,
    outcome: null,
    notes: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  };
}

function createEvaluationCandles(openedAt: Date, closes: number[], high: number, low: number) {
  const offsets = [0, 60 * 60 * 1000, 4 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, 3 * 24 * 60 * 60 * 1000];

  return closes.map((close, index) =>
    createCandle({
      close: String(close),
      high: String(high),
      low: String(low),
      closeTime: new Date(openedAt.getTime() + offsets[index])
    })
  );
}

function createCandle(overrides: Partial<ReturnType<typeof createBaseCandle>> = {}) {
  return {
    ...createBaseCandle(),
    ...overrides
  };
}

function createBaseCandle() {
  return {
    id: "candle-1",
    assetId: "asset-1",
    symbol: "BTCUSDT",
    timeframe: "1h",
    openTime: new Date("2026-01-01T00:00:00.000Z"),
    closeTime: new Date("2026-01-01T00:00:00.000Z"),
    open: "100",
    high: "101",
    low: "99",
    close: "100",
    volume: "1000",
    source: "test",
    createdAt: new Date("2026-01-01T00:00:00.000Z")
  };
}
