# SignalPilot

SignalPilot is a multi-asset market intelligence platform for stocks, ETFs, and crypto.

The initial scope is market analysis infrastructure, dashboards, Telegram alerts, and paper-trading preparation. It does not execute real trades.

## Local Setup

```bash
pnpm install
docker compose up -d
pnpm build
pnpm dev
```

## Environment

Copy `.env.example` to `.env` and fill values locally. Do not commit secrets.

```bash
cp .env.example .env
```

Alert routing is controlled with `ALERT_MODE`. If it is unset or invalid, SignalPilot falls back
to `ALL_ASSETS`.

```bash
ALERT_MODE=ALL_ASSETS
ALERT_MODE=WATCHLIST_ONLY
ALERT_MODE=HIGH_PRIORITY_ONLY
```

- `ALL_ASSETS`: relevant signals can alert for all active assets, except assets explicitly disabled on the watchlist.
- `WATCHLIST_ONLY`: alerts only route for watchlist items with `alertEnabled=true`.
- `HIGH_PRIORITY_ONLY`: alerts only route for high-priority watchlist items with `alertEnabled=true`.

## Services

- API: Fastify server with `GET /health`
- Worker: TypeScript worker process
- Database: Prisma package prepared for PostgreSQL
- Infrastructure: PostgreSQL and Redis via Docker Compose

## Database Seed

After PostgreSQL is running and migrations have been applied, seed the initial v1 watchlist:

```bash
pnpm db:seed
```

The seed is idempotent. Running it multiple times updates the existing watchlist assets and keeps them active without creating duplicates.

Open Prisma Studio:

```bash
pnpm db:studio
```

## Market Data

Fetch public Binance OHLCV candles for active crypto assets:

```bash
pnpm worker:fetch-crypto-candles
```

The job fetches `1h`, `4h`, and `1d` klines, stores them with idempotent upserts, and writes `BotRun` and `BotLog` records. It uses the public Binance API only and does not require API keys.

Fetch Finnhub OHLCV candles for active STOCK and ETF assets:

```bash
pnpm worker:fetch-equity-candles
```

Requires `FINNHUB_API_KEY` in `.env`. Fetches `1h` and `1d` candles only. If the key is missing, the job logs a clear error and ends with `FAILED` status without throwing.

## Signal Analysis

Run the equity signal analysis pipeline:

```bash
pnpm worker:analyze-equity-signals
pnpm worker:run-equity-pipeline
```

`analyzeEquitySignals` processes active STOCK and ETF assets over `1h` and `1d` timeframes, generates signals and `SignalOutput` records, computes multi-timeframe summaries from `1d` and `1h` only (no `4h`), and optionally routes alerts to n8n.

Alert gate: set `ENABLE_EQUITY_ALERTS=true` to allow equity signals to trigger n8n webhooks. The default is `false` — signals and outputs are always written, but no webhooks are sent.

## Market Regime Intelligence

Calculate and store the latest benchmark market regime:

```bash
pnpm worker:calculate-market-regime
```

The job uses stored `1d` candles for `SPY`, `QQQ`, `IWM`, `BTCUSDT`, and `ETHUSDT`. Missing assets or missing candles are handled as `UNKNOWN`/lower confidence; no external provider is required by this step.

Environment:

```bash
ENABLE_MARKET_REGIME=true              # default — run inside crypto/equity pipelines
MARKET_REGIME_MAX_AGE_MINUTES=60       # default — reuse recent snapshots
```

Signal outputs include `dashboardJson.marketRegimeContext` and a Telegram `Market Regime` block when a snapshot exists. The dashboard page is available at `/dashboard/market-regime`, and the scanner shows a Market Regime banner.

## Signal Rules Tuning

`packages/signal-rules` applies explainable rule-based score adjustments after the base scoring engine. It uses stored performance buckets, market regime context, news/events, and data quality signals. It does not execute trades and does not emit order instructions.

Environment:

```bash
SIGNAL_RULES_MAX_DELTA=15       # default maximum absolute total score adjustment
```

Each application is stored as `SignalRuleApplication` with original vs adjusted score/status, adjustment reasons, warnings, and summary. Signal outputs include `originalScore`, `adjustedScore`, `signalRuleAdjustments`, and `ruleWarnings`; Telegram text includes a `Score Adjustments` block.

Dashboard:

- `/dashboard/rules` lists rule applications and summary metrics.
- `/dashboard/signals/:id` shows the score adjustment card.

## Equity News

Fetch equity and ETF news via Finnhub Company News:

```bash
pnpm worker:fetch-equity-news
```

Requires `FINNHUB_API_KEY`. Fetches news for active STOCK and ETF assets and stores them in the `NewsItem` table with idempotent deduplication by URL.

News environment:

```bash
ENABLE_EQUITY_NEWS=true        # default — load news before signal analysis
NEWS_LOOKBACK_DAYS=7           # days of news history to fetch (default: 7)
NEWS_WATCHLIST_ONLY=false      # only fetch news for watchlist assets (default: false)
```

When `ENABLE_EQUITY_NEWS=true` (default), the equity signal pipeline fetches news before running signal analysis. News context is embedded in `SignalOutput.dashboardJson` and in the Telegram text block. The `/dashboard/news` page shows all stored news items.

```bash
ENABLE_EQUITY_ALERTS=false   # default — signals written, no n8n dispatch
ENABLE_EQUITY_ALERTS=true    # enables n8n alert routing for equity signals
```

## Equity Earnings & Events

Fetch stored earnings events for active STOCK assets via Finnhub Earnings Calendar:

```bash
pnpm worker:fetch-equity-events
```

Requires `FINNHUB_API_KEY`. ETFs are not queried for earnings and are treated as not applicable in event intelligence. Crypto events are not connected in this phase.

Events environment:

```bash
ENABLE_EQUITY_EVENTS=true      # default — fetch events before signal analysis
EVENTS_LOOKBACK_DAYS=14        # default lookback window
EVENTS_LOOKAHEAD_DAYS=60       # default lookahead window
EVENTS_WATCHLIST_ONLY=false    # only fetch events for watchlist stocks
```

When enabled, the equity pipeline runs candles, optional news, events, signal analysis, and optional Paper Evaluation. Event context is embedded in `SignalOutput.dashboardJson` and in the Telegram Events block using only stored Event rows.

Dashboard pages:

- `/dashboard/events` lists stored events with symbol/type/date filters.
- `/dashboard/assets/:symbol` shows Upcoming / Recent Events.
- `/dashboard/signals/:id` shows the computed Event Context.

## Worker Scheduler

Run the crypto signal pipeline scheduler:

```bash
pnpm worker:scheduler
```

Scheduler environment:

```bash
CRYPTO_PIPELINE_CRON="0 * * * *"
RUN_PIPELINE_ON_START=false
ENABLE_EQUITY_PIPELINE=false
EQUITY_PIPELINE_CRON="30 * * * *"
RUN_EQUITY_PIPELINE_ON_START=false
```

The crypto cron runs hourly at the top of the hour by default. Set `RUN_PIPELINE_ON_START=true` to run the crypto pipeline immediately when the scheduler starts.

Set `ENABLE_EQUITY_PIPELINE=true` to activate the equity signal pipeline on its own cron (default: 30 minutes past each hour). Set `RUN_EQUITY_PIPELINE_ON_START=true` to run it once immediately on scheduler start. The crypto pipeline is unaffected by equity settings.

## API Health Check

Start the API locally:

```bash
pnpm --filter @signalpilot/api dev
```

When the API is running:

```bash
curl http://localhost:3100/health
```

Expected response:

```json
{ "status": "ok", "service": "signalpilot-api" }
```

Dashboard API examples:

```bash
curl "http://localhost:3100/signals?limit=10"
curl "http://localhost:3100/scanner?assetType=CRYPTO&timeframe=1h&showOnlyAlertWorthy=true"
curl http://localhost:3100/assets/BTCUSDT
curl "http://localhost:3100/assets/BTCUSDT?includeMultiTimeframe=true"
curl "http://localhost:3100/scanner/multi-timeframe?assetType=CRYPTO&limit=100"
```

## Dashboard

Run the API and the Next.js dashboard:

```bash
pnpm --filter @signalpilot/api dev
NEXT_PUBLIC_SIGNALPILOT_API_URL=http://localhost:3100 pnpm dashboard:dev
```

Open:

```bash
http://localhost:3000/dashboard
```

Dashboard signal and asset detail pages render candlestick charts with TradingView Lightweight Charts.
The scanner page at `/dashboard/scanner` groups current signals into Strong Watch, Watchlist,
Volume Spikes, Breakouts, High Risk / Avoid, and No Edge / Low Priority with filters for asset
type, timeframe, minimum score, and alert-worthy signals.

The multi-timeframe page at `/dashboard/multi-timeframe` shows one row per active asset with
the latest `1h`, `4h`, and `1d` signal alignment, risk level, primary timeframe, confirming
and conflicting timeframes, summary, and next focus. It supports URL filters for asset type
and alignment and links each row to the asset detail page.

## Paper Evaluation Maintenance

Paper Evaluations are hypothetical signal-quality measurements only. SignalPilot does not
execute real trades, does not place paper orders, and does not integrate with brokers.

Reclassify older Paper Evaluations with the current eligibility rules:

```bash
pnpm worker:reclassify-paper-evaluations
```

The reclassification worker defaults to dry-run mode:

```bash
RECLASSIFY_DRY_RUN=true
RECLASSIFY_BATCH_SIZE=100
```

Set `RECLASSIFY_DRY_RUN=false` only when you want to update stored `evaluationKind`,
`expectedMoveDirection`, `skipReason`, and safe `evaluationStatus` transitions. Existing
prices, returns, and outcomes are preserved.

Backfill missing Paper Evaluations for signals that do not have one yet:

```bash
pnpm worker:backfill-paper-evaluations
```

Optional filters:

```bash
BACKFILL_SYMBOL=BTCUSDT
BACKFILL_FROM=2026-05-01T00:00:00.000Z
BACKFILL_TO=2026-05-18T00:00:00.000Z
BACKFILL_LIMIT=500
```

## Data Quality

The Data Quality dashboard at `/dashboard/data-quality` shows candle coverage, signal
coverage, Paper Evaluation coverage, skipped reasons, alert coverage, and per-asset quality
scores. Use it when Performance Intelligence has too few evaluated records or too many
skipped evaluations.

API endpoints:

```bash
curl "http://localhost:3100/data-quality/report?assetType=CRYPTO"
curl "http://localhost:3100/data-quality/assets?assetType=CRYPTO&minQualityScore=70"
```
