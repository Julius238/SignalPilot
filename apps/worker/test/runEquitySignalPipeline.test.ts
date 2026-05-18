import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BotRunStatus } from "@signalpilot/database";

import { runEquitySignalPipeline } from "../src/jobs/runEquitySignalPipeline.js";

describe("runEquitySignalPipeline", () => {
  it("runs equity candle fetch before signal analysis in correct order", async () => {
    const calls: string[] = [];
    const botRunUpdates: Array<{ data: { status: BotRunStatus; metadataJson?: unknown } }> = [];
    const botLogs: Array<{ data: { message: string } }> = [];
    const database = createPipelineDatabase(botRunUpdates, botLogs);

    const summary = await runEquitySignalPipeline(database as never, {
      fetchEquityCandles: async () => {
        calls.push("fetch");
        return {
          status: BotRunStatus.SUCCESS,
          assetCount: 5,
          timeframeCount: 2,
          savedCandleCount: 2500,
          noDataCount: 0,
          errorCount: 0,
          rateLimitCount: 0
        };
      },
      analyzeEquitySignals: async () => {
        calls.push("analyze");
        return {
          status: BotRunStatus.SUCCESS,
          analyzedCount: 10,
          savedSignalCount: 10,
          missingDataCount: 0,
          sentAlertCount: 0,
          skippedAlertCount: 10,
          equityAlertsDisabledCount: 10,
          alertMode: "ALL_ASSETS",
          routedAlertCount: 0,
          routeSkippedAlertCount: 0,
          cooldownSkippedAlertCount: 0,
          watchlistDisabledSkipCount: 0,
          notOnWatchlistSkipCount: 0,
          notHighPrioritySkipCount: 0,
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
    assert.equal(summary.fetchEquityCandles?.savedCandleCount, 2500);
    assert.equal(summary.analyzeEquitySignals?.savedSignalCount, 10);
    assert.equal(summary.paperEvaluationEnabled, true);
    assert.equal(botRunUpdates.at(-1)?.data.status, BotRunStatus.SUCCESS);
    assert.ok(botLogs.some((log) => log.data.message === "Equity Pipeline gestartet"));
    assert.ok(botLogs.some((log) => log.data.message === "Equity Candle Fetch beendet"));
    assert.ok(botLogs.some((log) => log.data.message === "Equity Signal Analyse beendet"));
    assert.ok(botLogs.some((log) => log.data.message === "Equity Pipeline erfolgreich beendet"));
  });

  it("marks the pipeline FAILED and does not analyze signals when candle fetch throws", async () => {
    const calls: string[] = [];
    const botRunUpdates: Array<{ data: { status: BotRunStatus } }> = [];
    const botLogs: Array<{ data: { message: string } }> = [];
    const database = createPipelineDatabase(botRunUpdates, botLogs);

    await assert.rejects(
      runEquitySignalPipeline(database as never, {
        fetchEquityCandles: async () => {
          calls.push("fetch");
          throw new Error("fetch failed");
        },
        analyzeEquitySignals: async () => {
          calls.push("analyze");
          throw new Error("should not run");
        },
        createPaperEvaluationsForSignals: async () => {
          throw new Error("should not run");
        },
        evaluatePaperSignals: async () => {
          throw new Error("should not run");
        }
      }),
      /fetch failed/
    );

    assert.deepEqual(calls, ["fetch"]);
    assert.equal(botRunUpdates.at(-1)?.data.status, BotRunStatus.FAILED);
    assert.ok(botLogs.some((log) => log.data.message === "Equity Pipeline Fehler"));
  });
});

function createPipelineDatabase(
  botRunUpdates: Array<{ data: { status: BotRunStatus; metadataJson?: unknown } }>,
  botLogs: Array<{ data: { message: string } }>
) {
  return {
    botRun: {
      create: async () => ({ id: "equity-pipeline-run-1" }),
      update: async (operation: { data: { status: BotRunStatus; metadataJson?: unknown } }) => {
        botRunUpdates.push(operation);
        return { id: "equity-pipeline-run-1", ...operation.data };
      }
    },
    botLog: {
      create: async (operation: { data: { message: string } }) => {
        botLogs.push(operation);
      }
    }
  };
}
