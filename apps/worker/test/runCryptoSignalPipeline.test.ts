import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { BotRunStatus } from "@signalpilot/database";

import { runCryptoSignalPipeline } from "../src/jobs/runCryptoSignalPipeline.js";

describe("runCryptoSignalPipeline", () => {
  const originalEnablePaperEvaluation = process.env.ENABLE_PAPER_EVALUATION;

  afterEach(() => {
    if (originalEnablePaperEvaluation === undefined) {
      delete process.env.ENABLE_PAPER_EVALUATION;
    } else {
      process.env.ENABLE_PAPER_EVALUATION = originalEnablePaperEvaluation;
    }
  });

  it("runs candle fetch before signal analysis and stores a pipeline summary", async () => {
    const calls: string[] = [];
    const botRunUpdates: Array<{ data: { status: BotRunStatus; metadataJson?: unknown } }> = [];
    const botLogs: Array<{ data: { message: string; metadataJson?: unknown } }> = [];
    const database = createPipelineDatabase(botRunUpdates, botLogs);

    const summary = await runCryptoSignalPipeline(database as never, {
      fetchCryptoCandles: async () => {
        calls.push("fetch");
        return {
          status: BotRunStatus.SUCCESS,
          assetCount: 10,
          timeframeCount: 3,
          savedCandleCount: 9000,
          errorCount: 0
        };
      },
      analyzeCryptoSignals: async () => {
        calls.push("analyze");
        return {
          status: BotRunStatus.SUCCESS,
          analyzedCount: 30,
          savedSignalCount: 30,
          sentAlertCount: 1,
          skippedAlertCount: 29,
          alertErrorCount: 0,
          errorCount: 0
        };
      },
      createPaperEvaluationsForSignals: async () => {
        calls.push("create-paper");
        return {
          status: BotRunStatus.SUCCESS,
          scannedSignalCount: 2,
          createdEvaluationCount: 2,
          skippedSignalCount: 0,
          duplicateSkipCount: 0,
          missingEntryPriceCount: 0,
          errorCount: 0
        };
      },
      evaluatePaperSignals: async () => {
        calls.push("evaluate-paper");
        return {
          status: BotRunStatus.SUCCESS,
          openEvaluationCount: 2,
          evaluatedCount: 1,
          expiredCount: 0,
          stillOpenCount: 1,
          errorCount: 0
        };
      }
    });

    assert.deepEqual(calls, ["fetch", "analyze", "create-paper", "evaluate-paper"]);
    assert.equal(summary.status, BotRunStatus.SUCCESS);
    assert.equal(summary.paperEvaluationEnabled, true);
    assert.equal(summary.fetchCryptoCandles?.savedCandleCount, 9000);
    assert.equal(summary.analyzeCryptoSignals?.sentAlertCount, 1);
    assert.equal(summary.createPaperEvaluationsForSignals?.createdEvaluationCount, 2);
    assert.equal(summary.evaluatePaperSignals?.evaluatedCount, 1);
    assert.equal(botRunUpdates.at(-1)?.data.status, BotRunStatus.SUCCESS);
    assert.ok(botLogs.some((log) => log.data.message === "Pipeline gestartet"));
    assert.ok(botLogs.some((log) => log.data.message === "Candle Fetch gestartet"));
    assert.ok(botLogs.some((log) => log.data.message === "Candle Fetch beendet"));
    assert.ok(botLogs.some((log) => log.data.message === "Signal Analyse gestartet"));
    assert.ok(botLogs.some((log) => log.data.message === "Signal Analyse beendet"));
    assert.ok(botLogs.some((log) => log.data.message === "Pipeline erfolgreich beendet"));
  });

  it("marks the pipeline failed and does not analyze signals when candle fetch throws", async () => {
    const calls: string[] = [];
    const botRunUpdates: Array<{ data: { status: BotRunStatus; metadataJson?: unknown } }> = [];
    const botLogs: Array<{ data: { message: string; metadataJson?: unknown } }> = [];
    const database = createPipelineDatabase(botRunUpdates, botLogs);

    await assert.rejects(
      runCryptoSignalPipeline(database as never, {
        fetchCryptoCandles: async () => {
          calls.push("fetch");
          throw new Error("fetch failed");
        },
        analyzeCryptoSignals: async () => {
          calls.push("analyze");
          throw new Error("analysis should not run");
        },
        createPaperEvaluationsForSignals: async () => {
          calls.push("create-paper");
          throw new Error("paper evaluation should not run");
        },
        evaluatePaperSignals: async () => {
          calls.push("evaluate-paper");
          throw new Error("paper evaluation should not run");
        }
      }),
      /fetch failed/
    );

    assert.deepEqual(calls, ["fetch"]);
    assert.equal(botRunUpdates.at(-1)?.data.status, BotRunStatus.FAILED);
    assert.ok(botLogs.some((log) => log.data.message === "Pipeline Fehler"));
  });

  it("does not report full success when a child provider job returns FAILED", async () => {
    const botRunUpdates: Array<{ data: { status: BotRunStatus; metadataJson?: unknown } }> = [];
    const botLogs: Array<{ data: { message: string; metadataJson?: unknown } }> = [];
    const database = createPipelineDatabase(botRunUpdates, botLogs);

    const summary = await runCryptoSignalPipeline(database as never, {
      fetchCryptoCandles: async () =>
        ({
          status: BotRunStatus.FAILED,
          assetCount: 1,
          timeframeCount: 3,
          savedCandleCount: 0,
          errorCount: 1
        }) as never,
      analyzeCryptoSignals: async () =>
        ({ status: BotRunStatus.SUCCESS, analyzedCount: 0, savedSignalCount: 0 }) as never,
      createPaperEvaluationsForSignals: async () =>
        ({ status: BotRunStatus.SUCCESS }) as never,
      evaluatePaperSignals: async () =>
        ({ status: BotRunStatus.SUCCESS }) as never
    });

    assert.equal(summary.status, BotRunStatus.FAILED);
    assert.equal(botRunUpdates.at(-1)?.data.status, BotRunStatus.FAILED);
    assert.ok(botLogs.some((log) => log.data.message.includes("Providerfehlern")));
  });
});

function createPipelineDatabase(
  botRunUpdates: Array<{ data: { status: BotRunStatus; metadataJson?: unknown } }>,
  botLogs: Array<{ data: { message: string; metadataJson?: unknown } }>
) {
  return {
    botRun: {
      create: async () => ({
        id: "pipeline-run-1"
      }),
      update: async (operation: { data: { status: BotRunStatus; metadataJson?: unknown } }) => {
        botRunUpdates.push(operation);
        return {
          id: "pipeline-run-1",
          ...operation.data
        };
      }
    },
    botLog: {
      create: async (operation: { data: { message: string; metadataJson?: unknown } }) => {
        botLogs.push(operation);
      }
    }
  };
}
