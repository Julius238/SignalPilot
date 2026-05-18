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

```bash
ENABLE_EQUITY_ALERTS=false   # default — signals written, no n8n dispatch
ENABLE_EQUITY_ALERTS=true    # enables n8n alert routing for equity signals
```

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
