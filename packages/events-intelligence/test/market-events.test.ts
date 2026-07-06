import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyGlobalNews,
  classifyGlobalNewsItem,
  type GlobalNewsInput
} from "../src/marketEvents.js";

function newsItem(overrides: Partial<GlobalNewsInput> = {}): GlobalNewsInput {
  return {
    externalId: "1001",
    source: "Reuters",
    headline: "Fed signals possible rate cut after inflation cools",
    summary: "Federal Reserve officials pointed to easing consumer prices.",
    url: "https://news.example/fed",
    publishedAt: new Date("2026-07-06T08:00:00.000Z"),
    category: "general",
    ...overrides
  };
}

describe("classifyGlobalNewsItem", () => {
  it("classifies central bank news with conservative confidence", () => {
    const candidate = classifyGlobalNewsItem(newsItem());

    assert.ok(candidate);
    assert.equal(candidate.eventType, "CENTRAL_BANK");
    assert.equal(candidate.dedupKey, "finnhub-general:1001");
    assert.equal(candidate.region, "USA");
    assert.ok(candidate.confidence <= 0.6, "confidence stays conservative");
    assert.ok(candidate.confidence >= 0.3);
    assert.match(candidate.reasoning, /Keyword-basierte Einordnung als CENTRAL_BANK/);
    assert.match(candidate.reasoning, /niedriger Confidence/);
    assert.equal(candidate.sourceUrl, "https://news.example/fed");
  });

  it("classifies conflict news and escalates severity via urgency keywords", () => {
    const candidate = classifyGlobalNewsItem(
      newsItem({
        externalId: "1002",
        headline: "Breaking: invasion escalates as missile attack hits port city",
        summary: "Military escalation raises fears of wider war and supply crisis."
      })
    );

    assert.ok(candidate);
    assert.equal(candidate.eventType, "CONFLICT");
    assert.equal(candidate.severity, "CRITICAL");
  });

  it("does not match keyword substrings inside other words", () => {
    const candidate = classifyGlobalNewsItem(
      newsItem({
        externalId: "1003",
        headline: "Software award ceremony celebrates hardware developers",
        summary: null
      })
    );

    assert.equal(candidate, null);
  });

  it("returns null for unclassifiable headlines instead of storing noise", () => {
    const candidate = classifyGlobalNewsItem(
      newsItem({
        externalId: "1004",
        headline: "Celebrity chef opens new restaurant in downtown",
        summary: "The menu features seasonal dishes."
      })
    );

    assert.equal(candidate, null);
  });

  it("keeps single weak matches at INFO severity", () => {
    const candidate = classifyGlobalNewsItem(
      newsItem({
        externalId: "1005",
        headline: "Analysts discuss inflation outlook for next year",
        summary: null
      })
    );

    assert.ok(candidate);
    assert.equal(candidate.eventType, "INFLATION");
    assert.equal(candidate.severity, "INFO");
  });

  it("builds a stable hash dedup key when externalId is missing", () => {
    const first = classifyGlobalNewsItem(newsItem({ externalId: null }));
    const second = classifyGlobalNewsItem(newsItem({ externalId: null }));

    assert.ok(first);
    assert.ok(second);
    assert.equal(first.dedupKey, second.dedupKey);
    assert.match(first.dedupKey, /^finnhub-general:2026-07-06:[a-f0-9]{16}$/);
  });

  it("detects regions from keywords", () => {
    const candidate = classifyGlobalNewsItem(
      newsItem({
        externalId: "1006",
        headline: "Oil prices surge as Red Sea shipping disruptions continue",
        summary: "Crude oil supply concerns in the Middle East."
      })
    );

    assert.ok(candidate);
    assert.equal(candidate.eventType, "ENERGY_COMMODITY");
    assert.equal(candidate.region, "Naher Osten");
  });
});

describe("classifyGlobalNews", () => {
  it("skips duplicates and unclassifiable items", () => {
    const items = [
      newsItem({ externalId: "2001" }),
      newsItem({ externalId: "2001" }),
      newsItem({ externalId: "2002", headline: "Local bakery wins pastry contest", summary: null })
    ];

    const candidates = classifyGlobalNews(items);

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].dedupKey, "finnhub-general:2001");
  });

  it("never produces trading language in reasoning", () => {
    const candidates = classifyGlobalNews([
      newsItem({ externalId: "3001" }),
      newsItem({
        externalId: "3002",
        headline: "OPEC announces surprise production cut, oil surges",
        summary: "Crude prices jumped after the announcement."
      })
    ]);

    for (const candidate of candidates) {
      assert.doesNotMatch(candidate.reasoning, /kauf|verkauf|long|short|entry|exit/i);
    }
  });
});
