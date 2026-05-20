import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildNewsContextForSignal, type NewsItemInput } from "../src/index.js";

const baseSignal = {
  createdAt: new Date("2026-01-01T12:00:00.000Z")
};

const baseAsset = {
  id: "asset-1",
  symbol: "AAPL"
};

function newsItem(overrides: Partial<NewsItemInput> = {}): NewsItemInput {
  return {
    id: "news-1",
    symbol: "AAPL",
    headline: "Apple reports record revenue",
    summary: "Apple Inc. announced quarterly results.",
    source: "Reuters",
    publishedAt: new Date("2026-01-01T10:00:00.000Z"),
    url: "https://reuters.com/apple-results",
    ...overrides
  };
}

describe("buildNewsContextForSignal", () => {
  it("returns hasRecentNews=false when no news items are provided", () => {
    const ctx = buildNewsContextForSignal({
      asset: baseAsset,
      signal: baseSignal,
      newsItems: []
    });

    assert.equal(ctx.hasRecentNews, false);
    assert.equal(ctx.recentNewsCount, 0);
    assert.equal(ctx.relevanceScore, 0);
    assert.equal(ctx.sentiment, "UNKNOWN");
    assert.match(ctx.summary, /Keine relevante neue Meldung/);
  });

  it("returns hasRecentNews=false when all news are outside the time window", () => {
    const ctx = buildNewsContextForSignal({
      asset: baseAsset,
      signal: baseSignal,
      newsItems: [newsItem({ publishedAt: new Date("2025-01-01T00:00:00.000Z") })],
      now: new Date("2026-01-01T12:00:00.000Z")
    });

    assert.equal(ctx.hasRecentNews, false);
  });

  it("increases relevanceScore for earnings keyword", () => {
    const ctx = buildNewsContextForSignal({
      asset: baseAsset,
      signal: baseSignal,
      newsItems: [newsItem({ headline: "Apple beats earnings expectations", summary: "" })],
      now: new Date("2026-01-01T12:00:00.000Z")
    });

    assert.equal(ctx.hasRecentNews, true);
    assert.ok(ctx.relevanceScore >= 60, `Expected score >= 60, got ${ctx.relevanceScore}`);
  });

  it("increases relevanceScore for guidance keyword", () => {
    const ctx = buildNewsContextForSignal({
      asset: baseAsset,
      signal: baseSignal,
      newsItems: [newsItem({ headline: "Apple raises guidance for next quarter" })],
      now: new Date("2026-01-01T12:00:00.000Z")
    });

    assert.ok(ctx.relevanceScore >= 60);
  });

  it("sets sentiment NEGATIVE for negative keywords", () => {
    const ctx = buildNewsContextForSignal({
      asset: baseAsset,
      signal: baseSignal,
      newsItems: [newsItem({ headline: "Apple faces new SEC investigation into accounting practices" })],
      now: new Date("2026-01-01T12:00:00.000Z")
    });

    assert.equal(ctx.sentiment, "NEGATIVE");
  });

  it("sets sentiment POSITIVE for positive keywords", () => {
    const ctx = buildNewsContextForSignal({
      asset: baseAsset,
      signal: baseSignal,
      newsItems: [newsItem({ headline: "Apple gets FDA approval for new health feature", summary: "" })],
      now: new Date("2026-01-01T12:00:00.000Z")
    });

    assert.equal(ctx.sentiment, "POSITIVE");
  });

  it("sets sentiment MIXED when positive and negative keywords co-occur", () => {
    const ctx = buildNewsContextForSignal({
      asset: baseAsset,
      signal: baseSignal,
      newsItems: [
        newsItem({ headline: "Apple beats earnings but faces layoffs investigation" })
      ],
      now: new Date("2026-01-01T12:00:00.000Z")
    });

    assert.equal(ctx.sentiment, "MIXED");
  });

  it("includes topNews with headline, source, url, sentiment", () => {
    const ctx = buildNewsContextForSignal({
      asset: baseAsset,
      signal: baseSignal,
      newsItems: [newsItem()],
      now: new Date("2026-01-01T12:00:00.000Z")
    });

    assert.equal(ctx.topNews.length, 1);
    assert.equal(ctx.topNews[0].headline, "Apple reports record revenue");
    assert.equal(ctx.topNews[0].source, "Reuters");
    assert.equal(ctx.topNews[0].url, "https://reuters.com/apple-results");
  });

  it("limits topNews to 3 items", () => {
    const ctx = buildNewsContextForSignal({
      asset: baseAsset,
      signal: baseSignal,
      newsItems: Array.from({ length: 10 }, (_, i) =>
        newsItem({ id: `news-${i}`, headline: `News ${i}`, url: `https://example.com/${i}` })
      ),
      now: new Date("2026-01-01T12:00:00.000Z")
    });

    assert.ok(ctx.topNews.length <= 3);
  });

  it("includes a riskNote for negative high-relevance news", () => {
    const ctx = buildNewsContextForSignal({
      asset: baseAsset,
      signal: baseSignal,
      newsItems: [newsItem({ headline: "Apple faces SEC investigation into revenue recognition" })],
      now: new Date("2026-01-01T12:00:00.000Z")
    });

    assert.ok(ctx.riskNote.length > 0);
  });
});
