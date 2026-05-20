import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildEventContextForSignal, type EventInput } from "../src/index.js";

function daysFromNow(days: number, base: Date = new Date("2026-05-20T12:00:00Z")): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

const baseNow = new Date("2026-05-20T12:00:00Z");

function makeEvent(overrides: Partial<EventInput> & { eventDate: Date }): EventInput {
  return {
    id: "evt-1",
    symbol: "AAPL",
    eventType: "EARNINGS",
    title: "AAPL Earnings",
    fiscalQuarter: "2",
    fiscalYear: 2026,
    epsEstimate: "1.42",
    epsActual: null,
    revenueEstimate: null,
    revenueActual: null,
    ...overrides
  };
}

describe("buildEventContextForSignal", () => {
  it("returns NONE risk level for ETF", () => {
    const ctx = buildEventContextForSignal({
      asset: { symbol: "SPY", assetType: "ETF" },
      signal: { createdAt: baseNow },
      events: [],
      now: baseNow
    });

    assert.equal(ctx.eventRiskLevel, "NONE");
    assert.equal(ctx.summary, "Earnings/Event-Kontext für ETFs nicht anwendbar.");
    assert.equal(ctx.hasUpcomingEvent, false);
    assert.equal(ctx.hasRecentEvent, false);
  });

  it("returns NONE when no events provided", () => {
    const ctx = buildEventContextForSignal({
      asset: { symbol: "AAPL", assetType: "STOCK" },
      signal: { createdAt: baseNow },
      events: [],
      now: baseNow
    });

    assert.equal(ctx.eventRiskLevel, "NONE");
    assert.equal(ctx.summary, "Kein relevantes Earnings/Event im Beobachtungsfenster gefunden.");
    assert.equal(ctx.hasUpcomingEvent, false);
    assert.equal(ctx.nearestEvent, null);
  });

  it("returns HIGH risk for earnings in 2 days", () => {
    const ctx = buildEventContextForSignal({
      asset: { symbol: "AAPL", assetType: "STOCK" },
      signal: { createdAt: baseNow },
      events: [makeEvent({ eventDate: daysFromNow(2, baseNow) })],
      now: baseNow
    });

    assert.equal(ctx.eventRiskLevel, "HIGH");
    assert.equal(ctx.hasUpcomingEvent, true);
    assert.equal(ctx.daysToNearestEvent, 2);
    assert.ok(ctx.summary.includes("AAPL"));
    assert.ok(ctx.riskNote.length > 0);
  });

  it("returns HIGH risk for earnings in 3 days exactly", () => {
    const ctx = buildEventContextForSignal({
      asset: { symbol: "AAPL", assetType: "STOCK" },
      signal: { createdAt: baseNow },
      events: [makeEvent({ eventDate: daysFromNow(3, baseNow) })],
      now: baseNow
    });

    assert.equal(ctx.eventRiskLevel, "HIGH");
  });

  it("returns MEDIUM risk for earnings in 7 days", () => {
    const ctx = buildEventContextForSignal({
      asset: { symbol: "AAPL", assetType: "STOCK" },
      signal: { createdAt: baseNow },
      events: [makeEvent({ eventDate: daysFromNow(7, baseNow) })],
      now: baseNow
    });

    assert.equal(ctx.eventRiskLevel, "MEDIUM");
    assert.equal(ctx.daysToNearestEvent, 7);
  });

  it("returns LOW risk for earnings in 10 days", () => {
    const ctx = buildEventContextForSignal({
      asset: { symbol: "AAPL", assetType: "STOCK" },
      signal: { createdAt: baseNow },
      events: [makeEvent({ eventDate: daysFromNow(10, baseNow) })],
      now: baseNow
    });

    assert.equal(ctx.eventRiskLevel, "LOW");
  });

  it("detects recent earnings within 2 days", () => {
    const ctx = buildEventContextForSignal({
      asset: { symbol: "AAPL", assetType: "STOCK" },
      signal: { createdAt: baseNow },
      events: [makeEvent({ eventDate: daysFromNow(-1, baseNow), epsActual: "1.5" })],
      now: baseNow
    });

    assert.equal(ctx.hasRecentEvent, true);
    assert.equal(ctx.eventRiskLevel, "MEDIUM");
    assert.equal(ctx.daysSinceRecentEvent, 1);
  });

  it("does not include events outside the window", () => {
    const ctx = buildEventContextForSignal({
      asset: { symbol: "AAPL", assetType: "STOCK" },
      signal: { createdAt: baseNow },
      events: [makeEvent({ eventDate: daysFromNow(65, baseNow) })],
      now: baseNow,
      upcomingWindowDays: 60
    });

    assert.equal(ctx.hasUpcomingEvent, false);
    assert.equal(ctx.eventRiskLevel, "NONE");
  });

  it("selects nearest upcoming event", () => {
    const ctx = buildEventContextForSignal({
      asset: { symbol: "AAPL", assetType: "STOCK" },
      signal: { createdAt: baseNow },
      events: [
        makeEvent({ id: "far", eventDate: daysFromNow(30, baseNow) }),
        makeEvent({ id: "near", eventDate: daysFromNow(5, baseNow) })
      ],
      now: baseNow
    });

    assert.equal(ctx.nearestEvent?.id, "near");
    assert.equal(ctx.daysToNearestEvent, 5);
  });

  it("includes sourceNote when events are present", () => {
    const ctx = buildEventContextForSignal({
      asset: { symbol: "AAPL", assetType: "STOCK" },
      signal: { createdAt: baseNow },
      events: [makeEvent({ eventDate: daysFromNow(5, baseNow) })],
      now: baseNow
    });

    assert.ok(ctx.sourceNote.includes("FINNHUB"));
  });
});
