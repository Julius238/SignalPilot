import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BotRunStatus } from "@signalpilot/database";

import { runScheduledCryptoPipeline, runScheduledEquityPipeline, type SchedulerState } from "../src/scheduler.js";

describe("scheduler", () => {
  it("skips a scheduled pipeline run when a previous run is active", async () => {
    const botLogs: Array<{ data: { message: string; level: string } }> = [];
    const state: SchedulerState = {
      isRunning: true,
      isShuttingDown: false
    };
    const database = createSchedulerDatabase(botLogs);
    let pipelineCalled = false;

    const result = await runScheduledCryptoPipeline(database as never, state, async () => {
      pipelineCalled = true;
      throw new Error("should not run");
    });

    assert.equal(result, "skipped");
    assert.equal(pipelineCalled, false);
    assert.equal(state.isRunning, true);
    assert.ok(
      botLogs.some(
        (log) =>
          log.data.level === "warn" &&
          log.data.message ===
            "Skipped scheduled crypto pipeline run because previous run is still active"
      )
    );
  });

  it("logs pipeline errors and keeps the scheduler run guard usable", async () => {
    const botLogs: Array<{ data: { message: string; level: string } }> = [];
    const state: SchedulerState = {
      isRunning: false,
      isShuttingDown: false
    };
    const database = createSchedulerDatabase(botLogs);

    const result = await runScheduledCryptoPipeline(database as never, state, async () => {
      throw new Error("pipeline failed");
    });

    assert.equal(result, "failed");
    assert.equal(state.isRunning, false);
    assert.ok(
      botLogs.some(
        (log) => log.data.level === "error" && log.data.message === "Scheduled crypto pipeline run failed"
      )
    );
  });

  it("runs the pipeline and logs success", async () => {
    const botLogs: Array<{ data: { message: string; level: string } }> = [];
    const state: SchedulerState = {
      isRunning: false,
      isShuttingDown: false
    };
    const database = createSchedulerDatabase(botLogs);

    const result = await runScheduledCryptoPipeline(database as never, state, async () => ({
      status: BotRunStatus.SUCCESS,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z"
    }));

    assert.equal(result, "success");
    assert.equal(state.isRunning, false);
    assert.ok(
      botLogs.some(
        (log) => log.data.level === "info" && log.data.message === "Scheduled crypto pipeline run started"
      )
    );
    assert.ok(
      botLogs.some(
        (log) => log.data.level === "info" && log.data.message === "Scheduled crypto pipeline run finished"
      )
    );
  });
});

describe("equity scheduler", () => {
  it("skips equity pipeline run when previous run is still active", async () => {
    const botLogs: Array<{ data: { message: string; level: string } }> = [];
    const state: SchedulerState = { isRunning: true, isShuttingDown: false };
    const database = createSchedulerDatabase(botLogs);
    let pipelineCalled = false;

    const result = await runScheduledEquityPipeline(database as never, state, async () => {
      pipelineCalled = true;
      throw new Error("should not run");
    });

    assert.equal(result, "skipped");
    assert.equal(pipelineCalled, false);
    assert.ok(
      botLogs.some(
        (log) =>
          log.data.level === "warn" &&
          log.data.message === "Skipped scheduled equity pipeline run because previous run is still active"
      )
    );
  });

  it("runs the equity pipeline and logs success", async () => {
    const botLogs: Array<{ data: { message: string; level: string } }> = [];
    const state: SchedulerState = { isRunning: false, isShuttingDown: false };
    const database = createSchedulerDatabase(botLogs);

    const result = await runScheduledEquityPipeline(database as never, state, async () => ({
      status: BotRunStatus.SUCCESS,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      paperEvaluationEnabled: false
    }));

    assert.equal(result, "success");
    assert.equal(state.isRunning, false);
    assert.ok(botLogs.some((log) => log.data.message === "Scheduled equity pipeline run started"));
    assert.ok(botLogs.some((log) => log.data.message === "Scheduled equity pipeline run finished"));
  });
});

function createSchedulerDatabase(botLogs: Array<{ data: { message: string; level: string } }>) {
  return {
    botLog: {
      create: async (operation: { data: { message: string; level: string } }) => {
        botLogs.push(operation);
      }
    }
  };
}
