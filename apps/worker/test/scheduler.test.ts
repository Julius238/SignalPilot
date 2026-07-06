import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BotRunStatus } from "@signalpilot/database";

import {
  resolveSchedulerSettings,
  runScheduledCryptoPipeline,
  runScheduledEquityPipeline,
  runScheduledQuickRadar,
  runScheduledRadarSummary,
  type SchedulerState
} from "../src/scheduler.js";

describe("scheduler", () => {
  it("uses conservative crypto scheduler defaults", () => {
    const settings = resolveSchedulerSettings({});

    assert.equal(settings.cryptoCron, "0 * * * *");
    assert.equal(settings.runOnStart, false);
    assert.equal(settings.environment, "development");
    assert.equal(settings.schedulerEnabled, true);
  });

  it("keeps quick radar and radar summary schedules disabled by default", () => {
    const settings = resolveSchedulerSettings({});

    assert.equal(settings.quickRadarEnabled, false);
    assert.equal(settings.quickRadarCron, "*/5 * * * *");
    assert.equal(settings.radarSummaryEnabled, false);
    assert.equal(settings.radarSummaryCron, "0 * * * *");
  });

  it("reads quick radar and radar summary schedules from the environment", () => {
    const settings = resolveSchedulerSettings({
      QUICK_RADAR_ENABLED: "true",
      QUICK_RADAR_CRON: "*/10 * * * *",
      RADAR_SUMMARY_ENABLED: "true",
      RADAR_SUMMARY_CRON: "0 7,19 * * *"
    });

    assert.equal(settings.quickRadarEnabled, true);
    assert.equal(settings.quickRadarCron, "*/10 * * * *");
    assert.equal(settings.radarSummaryEnabled, true);
    assert.equal(settings.radarSummaryCron, "0 7,19 * * *");
  });

  it("uses WORKER_RUN_ON_START for startup crypto pipeline runs", () => {
    const settings = resolveSchedulerSettings({
      CRYPTO_PIPELINE_CRON: "*/15 * * * *",
      WORKER_RUN_ON_START: "true",
      NODE_ENV: "production"
    });

    assert.equal(settings.cryptoCron, "*/15 * * * *");
    assert.equal(settings.runOnStart, true);
    assert.equal(settings.environment, "production");
  });

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

describe("quick radar scheduler", () => {
  it("skips a quick radar run when the previous run is still active", async () => {
    const botLogs: Array<{ data: { message: string; level: string } }> = [];
    const state: SchedulerState = { isRunning: true, isShuttingDown: false };
    const database = createSchedulerDatabase(botLogs);
    let jobCalled = false;

    const result = await runScheduledQuickRadar(database as never, state, async () => {
      jobCalled = true;
      throw new Error("should not run");
    });

    assert.equal(result, "skipped");
    assert.equal(jobCalled, false);
    assert.ok(
      botLogs.some(
        (log) =>
          log.data.level === "warn" &&
          log.data.message === "Skipped scheduled quick radar run because previous run is still active"
      )
    );
  });

  it("runs the quick radar and logs success", async () => {
    const botLogs: Array<{ data: { message: string; level: string } }> = [];
    const state: SchedulerState = { isRunning: false, isShuttingDown: false };
    const database = createSchedulerDatabase(botLogs);

    const result = await runScheduledQuickRadar(database as never, state, async () =>
      ({ status: BotRunStatus.SUCCESS, enabled: true }) as never
    );

    assert.equal(result, "success");
    assert.equal(state.isRunning, false);
    assert.ok(botLogs.some((log) => log.data.message === "Scheduled quick radar run started"));
    assert.ok(botLogs.some((log) => log.data.message === "Scheduled quick radar run finished"));
  });

  it("logs quick radar failures and releases the run guard", async () => {
    const botLogs: Array<{ data: { message: string; level: string } }> = [];
    const state: SchedulerState = { isRunning: false, isShuttingDown: false };
    const database = createSchedulerDatabase(botLogs);

    const result = await runScheduledQuickRadar(database as never, state, async () => {
      throw new Error("radar failed");
    });

    assert.equal(result, "failed");
    assert.equal(state.isRunning, false);
    assert.ok(
      botLogs.some(
        (log) => log.data.level === "error" && log.data.message === "Scheduled quick radar run failed"
      )
    );
  });
});

describe("radar summary scheduler", () => {
  it("runs the radar summary and logs success", async () => {
    const botLogs: Array<{ data: { message: string; level: string } }> = [];
    const state: SchedulerState = { isRunning: false, isShuttingDown: false };
    const database = createSchedulerDatabase(botLogs);

    const result = await runScheduledRadarSummary(database as never, state, async () =>
      ({ status: BotRunStatus.SUCCESS, enabled: true }) as never
    );

    assert.equal(result, "success");
    assert.equal(state.isRunning, false);
    assert.ok(botLogs.some((log) => log.data.message === "Scheduled radar summary run started"));
    assert.ok(botLogs.some((log) => log.data.message === "Scheduled radar summary run finished"));
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
