import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateRadarAlertQualityGate } from "@signalpilot/alerts";
import {
  AssetType,
  RadarEventSeverity,
  RadarEventType
} from "@signalpilot/database";

import {
  persistRadarEventCandidates,
  type PersistedRadarEvent
} from "../src/lib/radarPersistence.js";

describe("radar alert repetition", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");

  it("persists dashboard data but blocks an unchanged setup after cooldown", async () => {
    const database = createDatabase({
      score: 88,
      severity: RadarEventSeverity.IMPORTANT,
      movePercent: 5,
      metadataJson: {
        alertBaseline: {
          score: 88,
          severity: "IMPORTANT",
          direction: "UP"
        }
      },
      createdAt: new Date("2026-07-24T09:00:00.000Z")
    });
    const events = await persistRadarEventCandidates(
      database as never,
      context(),
      [candidate(88)]
    );

    assert.equal(events.length, 1);
    assert.equal(
      (events[0].metadataJson as { alertMaterialChange: boolean })
        .alertMaterialChange,
      false
    );
    assert.equal(evaluateRadarAlertQualityGate(events[0]).allowed, false);
  });

  it("allows a repeat after an eight-point score improvement", async () => {
    const database = createDatabase({
      score: 80,
      severity: RadarEventSeverity.IMPORTANT,
      movePercent: 5,
      metadataJson: {
        alertBaseline: {
          score: 80,
          severity: "IMPORTANT",
          direction: "UP"
        }
      },
      createdAt: new Date("2026-07-24T09:00:00.000Z")
    });
    const events = await persistRadarEventCandidates(
      database as never,
      context(),
      [candidate(88)]
    );

    assert.equal(events.length, 1);
    assert.equal(
      (events[0].metadataJson as { alertMaterialChange: boolean })
        .alertMaterialChange,
      true
    );
    assert.equal(evaluateRadarAlertQualityGate(events[0]).allowed, true);
  });

  function context() {
    return {
      assetId: "asset-1",
      symbol: "BTCUSDT",
      assetType: AssetType.CRYPTO,
      timeframe: "1h",
      movePercent: 5,
      relativeVolume: 2.4,
      rangePercent: 6,
      baseMetadata: {
        closedCandle: true,
        freshData: true,
        watchlistAlertEnabled: true
      },
      cooldownMinutes: 60,
      now
    };
  }
});

function candidate(score: number) {
  return {
    eventType: RadarEventType.MOVEMENT_SPIKE,
    severity: RadarEventSeverity.IMPORTANT,
    score,
    shortMessage: "BTCUSDT: bestätigte auffällige Bewegung."
  };
}

function createDatabase(previous: {
  score: number;
  severity: RadarEventSeverity;
  movePercent: number;
  metadataJson: unknown;
  createdAt: Date;
}) {
  return {
    radarEvent: {
      findFirst: async () => ({
        id: "previous-radar-event",
        ...previous
      }),
      create: async ({ data }: { data: Omit<PersistedRadarEvent, "id" | "createdAt"> }) => ({
        id: "radar-event-1",
        ...data,
        createdAt: new Date("2026-07-24T12:00:00.000Z")
      })
    }
  };
}
