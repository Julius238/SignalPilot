---
name: architecture
description: Package layout, pipeline flow, and key implementation patterns for SignalPilot
metadata:
  type: project
---

## Monorepo layout

```
packages/
  database/          Prisma schema + client
  market-data/       Finnhub + Binance adapters (candles, news, events)
  events-intelligence/  buildEventContextForSignal()
  news-intelligence/ buildNewsContextForSignal()
  output-composer/   composeSignalOutput() → telegramText + dashboardJson
  scoring-engine/    scoreSignal()
  indicators/        buildIndicatorSnapshot()
  multi-timeframe/   calculateMultiTimeframeSummary()
  alerts/            sendSignalAlertToN8n()
  data-quality/      buildDataQualityReport()
  performance-intelligence/  buildPerformanceReport()
  shared/            shared TypeScript types

apps/
  worker/  Job runner — fetch candles/news/events, analyze signals, paper eval
  api/     Fastify API — dashboard routes
  dashboard/  Next.js frontend
```

## Equity pipeline flow

`runEquitySignalPipeline`:
1. `fetchEquityCandles` (Finnhub OHLCV)
2. `fetchEquityNews` (Finnhub company news) — when ENABLE_EQUITY_NEWS=true
3. `fetchEquityEvents` (Finnhub earnings calendar) — when ENABLE_EQUITY_EVENTS=true
4. `analyzeEquitySignals` (indicators → scoring → output composer)
5. Paper evaluations — when ENABLE_PAPER_EVALUATION=true

## Key patterns

**BotRun/BotLog**: Every worker job creates a BotRun (RUNNING → SUCCESS/FAILED) and writes BotLog entries.

**Dedup**: Events dedup via findFirst on symbol+eventType+eventDate+fiscalQuarter+fiscalYear; updates if exists.

**Test tsconfig**: New packages need `test/tsconfig.json` extending parent tsconfig with `rootDir: ".."` to satisfy ESLint project service.

**New package checklist**:
1. `packages/<name>/package.json` with correct name/exports
2. `packages/<name>/tsconfig.json` extending `../../tsconfig.base.json`
3. `packages/<name>/test/tsconfig.json` extending parent with rootDir and include
4. Add to dependent packages' package.json
5. Run `pnpm install`

**Event risk levels** (from events-intelligence):
- HIGH: earnings ≤ 3 days away
- MEDIUM: ≤ 7 days, or recent with actuals
- LOW: ≤ 14 days
- NONE: no events or ETF
