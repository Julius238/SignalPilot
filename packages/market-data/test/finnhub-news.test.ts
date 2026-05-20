import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FinnhubNewsAdapter, normalizeNewsResponse } from "../src/finnhub-news.js";

const okPayload = [
  {
    category: "company news",
    datetime: 1710000000,
    headline: "Apple beats earnings expectations",
    id: 123456,
    image: "https://example.com/image.jpg",
    related: "AAPL",
    source: "Reuters",
    summary: "Apple Inc. reported strong quarterly results.",
    url: "https://reuters.com/apple-earnings"
  }
];

describe("normalizeNewsResponse", () => {
  it("normalizes a Finnhub news response correctly", () => {
    const result = normalizeNewsResponse("AAPL", okPayload);

    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;

    assert.equal(result.items.length, 1);
    assert.deepEqual(result.items[0], {
      symbol: "AAPL",
      source: "Reuters",
      headline: "Apple beats earnings expectations",
      summary: "Apple Inc. reported strong quarterly results.",
      url: "https://reuters.com/apple-earnings",
      imageUrl: "https://example.com/image.jpg",
      publishedAt: new Date(1710000000 * 1000),
      category: "company news",
      rawJson: okPayload[0]
    });
  });

  it("returns no_news for an empty array", () => {
    const result = normalizeNewsResponse("AAPL", []);
    assert.equal(result.kind, "no_news");
  });

  it("returns no_news when all items are malformed", () => {
    const result = normalizeNewsResponse("AAPL", [{ invalid: true }]);
    assert.equal(result.kind, "no_news");
  });

  it("throws for a non-array response", () => {
    assert.throws(
      () => normalizeNewsResponse("AAPL", { error: "invalid" }),
      /Invalid Finnhub news response format/
    );
  });

  it("sets null for empty optional fields", () => {
    const payload = [{ ...okPayload[0], image: "", summary: "", url: "", category: "" }];
    const result = normalizeNewsResponse("AAPL", payload);

    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;

    assert.equal(result.items[0].imageUrl, null);
    assert.equal(result.items[0].summary, null);
    assert.equal(result.items[0].url, null);
    assert.equal(result.items[0].category, null);
  });
});

describe("FinnhubNewsAdapter", () => {
  it("throws when FINNHUB_API_KEY is missing", () => {
    const adapter = new FinnhubNewsAdapter({ apiKey: "" });
    assert.throws(() => adapter.assertApiKey(), /FINNHUB_API_KEY/);
  });

  it("returns rate_limit for HTTP 429", async () => {
    const mockFetch = async () => ({ ok: false, status: 429, json: async () => ({}) }) as Response;
    const adapter = new FinnhubNewsAdapter({ apiKey: "test-key", fetchClient: mockFetch });

    const result = await adapter.fetchCompanyNews(
      "AAPL",
      new Date("2026-01-01"),
      new Date("2026-01-07")
    );
    assert.equal(result.kind, "rate_limit");
  });

  it("throws for non-429 HTTP errors", async () => {
    const mockFetch = async () => ({ ok: false, status: 403, json: async () => ({}) }) as Response;
    const adapter = new FinnhubNewsAdapter({ apiKey: "test-key", fetchClient: mockFetch });

    await assert.rejects(
      () => adapter.fetchCompanyNews("AAPL", new Date("2026-01-01"), new Date("2026-01-07")),
      /HTTP 403/
    );
  });

  it("returns ok items for a successful response", async () => {
    const mockFetch = async () =>
      ({ ok: true, status: 200, json: async () => okPayload }) as Response;
    const adapter = new FinnhubNewsAdapter({ apiKey: "test-key", fetchClient: mockFetch });

    const result = await adapter.fetchCompanyNews(
      "AAPL",
      new Date("2026-01-01"),
      new Date("2026-01-07")
    );
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.items[0].source, "Reuters");
  });
});
