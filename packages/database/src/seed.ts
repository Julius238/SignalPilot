import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

import type { PrismaClient } from "./index.js";
import type { AssetType as AssetTypeValue } from "@prisma/client";

const seedDir = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(seedDir, "../../../.env") });
config();

const { AssetType, prisma } = await import("./index.js");

type WatchlistAsset = {
  symbol: string;
  name: string;
  assetType: AssetTypeValue;
  exchange: string;
  baseCurrency?: string;
  quoteCurrency?: string;
};

const watchlistAssets: WatchlistAsset[] = [
  {
    symbol: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    assetType: AssetType.ETF,
    exchange: "NYSEARCA"
  },
  {
    symbol: "QQQ",
    name: "Invesco QQQ Trust",
    assetType: AssetType.ETF,
    exchange: "NASDAQ"
  },
  {
    symbol: "IWM",
    name: "iShares Russell 2000 ETF",
    assetType: AssetType.ETF,
    exchange: "NYSEARCA"
  },
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    assetType: AssetType.STOCK,
    exchange: "NASDAQ"
  },
  {
    symbol: "MSFT",
    name: "Microsoft Corporation",
    assetType: AssetType.STOCK,
    exchange: "NASDAQ"
  },
  {
    symbol: "NVDA",
    name: "NVIDIA Corporation",
    assetType: AssetType.STOCK,
    exchange: "NASDAQ"
  },
  {
    symbol: "TSLA",
    name: "Tesla, Inc.",
    assetType: AssetType.STOCK,
    exchange: "NASDAQ"
  },
  {
    symbol: "AMZN",
    name: "Amazon.com, Inc.",
    assetType: AssetType.STOCK,
    exchange: "NASDAQ"
  },
  {
    symbol: "META",
    name: "Meta Platforms, Inc.",
    assetType: AssetType.STOCK,
    exchange: "NASDAQ"
  },
  {
    symbol: "GOOGL",
    name: "Alphabet Inc.",
    assetType: AssetType.STOCK,
    exchange: "NASDAQ"
  },
  {
    symbol: "BTCUSDT",
    name: "Bitcoin / Tether USD",
    assetType: AssetType.CRYPTO,
    exchange: "BINANCE",
    baseCurrency: "BTC",
    quoteCurrency: "USDT"
  },
  {
    symbol: "ETHUSDT",
    name: "Ethereum / Tether USD",
    assetType: AssetType.CRYPTO,
    exchange: "BINANCE",
    baseCurrency: "ETH",
    quoteCurrency: "USDT"
  },
  {
    symbol: "SOLUSDT",
    name: "Solana / Tether USD",
    assetType: AssetType.CRYPTO,
    exchange: "BINANCE",
    baseCurrency: "SOL",
    quoteCurrency: "USDT"
  },
  {
    symbol: "BNBUSDT",
    name: "BNB / Tether USD",
    assetType: AssetType.CRYPTO,
    exchange: "BINANCE",
    baseCurrency: "BNB",
    quoteCurrency: "USDT"
  },
  {
    symbol: "XRPUSDT",
    name: "XRP / Tether USD",
    assetType: AssetType.CRYPTO,
    exchange: "BINANCE",
    baseCurrency: "XRP",
    quoteCurrency: "USDT"
  },
  {
    symbol: "ADAUSDT",
    name: "Cardano / Tether USD",
    assetType: AssetType.CRYPTO,
    exchange: "BINANCE",
    baseCurrency: "ADA",
    quoteCurrency: "USDT"
  },
  {
    symbol: "LINKUSDT",
    name: "Chainlink / Tether USD",
    assetType: AssetType.CRYPTO,
    exchange: "BINANCE",
    baseCurrency: "LINK",
    quoteCurrency: "USDT"
  },
  {
    symbol: "AVAXUSDT",
    name: "Avalanche / Tether USD",
    assetType: AssetType.CRYPTO,
    exchange: "BINANCE",
    baseCurrency: "AVAX",
    quoteCurrency: "USDT"
  },
  {
    symbol: "DOGEUSDT",
    name: "Dogecoin / Tether USD",
    assetType: AssetType.CRYPTO,
    exchange: "BINANCE",
    baseCurrency: "DOGE",
    quoteCurrency: "USDT"
  },
  {
    symbol: "MATICUSDT",
    name: "Polygon / Tether USD",
    assetType: AssetType.CRYPTO,
    exchange: "BINANCE",
    baseCurrency: "MATIC",
    quoteCurrency: "USDT"
  }
];

async function seedWatchlist() {
  const database: PrismaClient = prisma;

  for (const asset of watchlistAssets) {
    await database.asset.upsert({
      where: {
        symbol_exchange_assetType: {
          symbol: asset.symbol,
          exchange: asset.exchange,
          assetType: asset.assetType
        }
      },
      create: {
        ...asset,
        isActive: true
      },
      update: {
        name: asset.name,
        baseCurrency: asset.baseCurrency ?? null,
        quoteCurrency: asset.quoteCurrency ?? null,
        isActive: true
      }
    });
  }

  console.log(`Seeded ${watchlistAssets.length} SignalPilot watchlist assets.`);
}

try {
  await seedWatchlist();
} finally {
  await prisma.$disconnect();
}
