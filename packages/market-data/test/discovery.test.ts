import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BinanceDiscoveryProvider,
  FinnhubDiscoveryProvider
} from "../src/discovery.js";

describe("asset discovery providers", () => {
  it("normalizes Binance identity and product-risk metadata from one list request", async () => {
    const provider = new BinanceDiscoveryProvider({
      fetchClient: (async () =>
        jsonResponse({
          symbols: [
            {
              symbol: "BTCUSDT",
              status: "TRADING",
              baseAsset: "BTC",
              quoteAsset: "USDT",
              isSpotTradingAllowed: true,
              permissions: ["SPOT"]
            },
            {
              symbol: "ETHUPUSDT",
              status: "TRADING",
              baseAsset: "ETHUP",
              quoteAsset: "USDT",
              isSpotTradingAllowed: true,
              permissions: ["SPOT"]
            }
          ]
        })) as never
    });

    const result = await provider.listInstruments();

    assert.equal(result.usage.requestCount, 1);
    assert.equal(result.usage.estimatedApiUnits, 20);
    assert.equal(result.data[0]?.providerSymbol, "BTCUSDT");
    assert.equal(result.data[0]?.exchange, "BINANCE");
    assert.equal(result.data[1]?.leveraged, true);
  });

  it("uses Binance's batch snapshot instead of one quote request per asset", async () => {
    let requests = 0;
    const provider = new BinanceDiscoveryProvider({
      fetchClient: (async () => {
        requests += 1;
        return jsonResponse([
          {
            symbol: "BTCUSDT",
            lastPrice: "100",
            quoteVolume: "100000000",
            volume: "1000000",
            priceChangePercent: "3",
            highPrice: "105",
            lowPrice: "96",
            count: 1000,
            closeTime: 1_785_080_100_000
          },
          {
            symbol: "ETHUSDT",
            lastPrice: "50",
            quoteVolume: "80000000",
            volume: "1600000",
            priceChangePercent: "2",
            highPrice: "52",
            lowPrice: "48",
            count: 800,
            closeTime: 1_785_080_100_000
          }
        ]);
      }) as never
    });

    const result = await provider.fetchMarketSnapshots();

    assert.equal(requests, 1);
    assert.equal(result.data.length, 2);
    assert.equal(result.usage.requestCount, 1);
    assert.equal(result.usage.estimatedApiUnits, 40);
  });

  it("preserves Finnhub symbol, MIC, currency and product type metadata", async () => {
    let requestedUrl = "";
    const provider = new FinnhubDiscoveryProvider({
      apiKey: "test-key",
      fetchClient: (async (url: URL | RequestInfo) => {
        requestedUrl = String(url);
        return jsonResponse([
          {
            currency: "USD",
            description: "Example Broad Market ETF",
            displaySymbol: "EXM",
            figi: "BBG000TEST",
            mic: "ARCX",
            symbol: "EXM",
            type: "ETP"
          }
        ]);
      }) as never
    });

    const result = await provider.listInstruments();

    assert.match(requestedUrl, /exchange=US/);
    assert.match(requestedUrl, /token=test-key/);
    assert.equal(result.data[0]?.assetType, "ETF");
    assert.equal(result.data[0]?.exchange, "ARCX");
    assert.equal(result.data[0]?.currency, "USD");
    assert.deepEqual(result.data[0]?.metadata, {
      figi: "BBG000TEST",
      instrumentType: "ETP"
    });
    assert.deepEqual(result.usage, { requestCount: 1, estimatedApiUnits: 1 });
  });
});

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
