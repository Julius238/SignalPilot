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

## Worker Scheduler

Run the crypto signal pipeline scheduler:

```bash
pnpm worker:scheduler
```

Scheduler environment:

```bash
CRYPTO_PIPELINE_CRON="0 * * * *"
RUN_PIPELINE_ON_START=false
```

The default cron runs hourly at the top of the hour. Set `RUN_PIPELINE_ON_START=true` to run the pipeline once immediately when the scheduler starts, then continue on the cron schedule.

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
curl http://localhost:3100/assets/BTCUSDT
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
