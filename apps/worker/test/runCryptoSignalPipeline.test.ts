import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BotRunStatus } from "@signalpilot/database";

import { runCryptoSignalPipeline } from "../src/jobs/runCryptoSignalPipeline.js";

describe("runCryptoSignalPipeline", () => {
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
      }
    });

    assert.deepEqual(calls, ["fetch", "analyze"]);
    assert.equal(summary.status, BotRunStatus.SUCCESS);
    assert.equal(summary.fetchCryptoCandles?.savedCandleCount, 9000);
    assert.equal(summary.analyzeCryptoSignals?.sentAlertCount, 1);
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
        }
      }),
      /fetch failed/
    );

    assert.deepEqual(calls, ["fetch"]);
    assert.equal(botRunUpdates.at(-1)?.data.status, BotRunStatus.FAILED);
    assert.ok(botLogs.some((log) => log.data.message === "Pipeline Fehler"));
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
