---
name: project-overview
description: High-level status and goals of the SignalPilot project
metadata:
  type: project
---

SignalPilot is a multi-asset market intelligence platform (stocks, ETFs, crypto). No live trading, no broker code, no buy/sell output.

**Tech stack**: pnpm monorepo, Prisma/PostgreSQL, Next.js dashboard, Fastify API, tsx workers.

**Features implemented as of 2026-05-20**:
- Crypto pipeline (Binance candles + signals)
- Equity/ETF pipeline (Finnhub candles, news, events, signals)
- Multi-timeframe intelligence (1h, 4h, 1d)
- News intelligence (sentiment, relevance scoring)
- Events intelligence (Earnings calendar, risk levels)
- Output composer (Telegram text, dashboard JSON)
- Watchlist, alert routing, cooldown/dedup
- Paper evaluation and performance intelligence
- Dashboard with scanner, signals, news, events, assets pages

**Why**: Internal market intelligence tool, not production trading.

**How to apply**: When adding new data sources or intelligence features, follow the established patterns (BotRun/BotLog, adapter + worker job + API route + dashboard page).
