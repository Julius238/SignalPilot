# SignalPilot — Deployment Guide

Private alpha deployment using Docker Compose. No cloud lock-in.

## Prerequisites

- Docker 24+ with Docker Compose v2
- `pnpm` (for auth tooling on the host — only needed for key generation)
- A Linux VPS or local machine with 1 GB+ RAM
- Optional: a domain + reverse proxy (nginx/Caddy) for HTTPS

---

## Quick Start

### Hostinger VPS with n8n/Traefik

This production path assumes the Hostinger VPS already runs n8n through Docker/Traefik and Traefik owns ports `80` and `443`.

SignalPilot must stay on its own Compose project and Docker network:

```bash
cd /opt/signalpilot
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres redis
./scripts/ops/prod-migrate-docker.sh
./scripts/ops/prod-seed-docker.sh
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

The migration and seed scripts start a temporary `node:22-bookworm` container on the `signalpilot_internal` network, mount the current repo at `/app`, enable Corepack, install the repo with the pinned pnpm version, and run the root `db:*` scripts. They do not run `migrate dev`, reset, drop, or print secrets.

Override defaults only when the VPS differs:

```bash
SIGNALPILOT_DOCKER_NETWORK=signalpilot_internal \
SIGNALPILOT_ENV_FILE=.env.production \
SIGNALPILOT_NODE_IMAGE=node:22-bookworm \
./scripts/ops/prod-migrate-docker.sh
```

Check that migrations created tables:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"'
```

Check service health and logs:

```bash
docker compose -f docker-compose.prod.yml ps
curl -fsS http://127.0.0.1:3100/health
curl -fsS http://127.0.0.1:3000/
docker compose -f docker-compose.prod.yml logs --tail=100 api
docker compose -f docker-compose.prod.yml logs --tail=100 worker-scheduler
```

Manually verify the worker image can start:

```bash
docker compose -f docker-compose.prod.yml run --rm --no-deps worker-scheduler node dist/index.js
docker compose -f docker-compose.prod.yml up -d worker-scheduler
docker compose -f docker-compose.prod.yml logs --tail=100 worker-scheduler
```

Cron examples for routine operations:

```cron
0 3 * * * cd /opt/signalpilot && pnpm ops:prod:backup >> /var/log/signalpilot-backup.log 2>&1
*/10 * * * * cd /opt/signalpilot && docker compose -f docker-compose.prod.yml ps >/dev/null 2>&1
```

n8n stays separate. SignalPilot sends alerts only through `N8N_WEBHOOK_SIGNAL_URL`; do not merge it into the n8n Traefik stack unless you intentionally add routing later.

Never commit `.env.production`. Because bcrypt hashes contain `$`, set `ADMIN_PASSWORD_HASH` in `.env.production` as a quoted value, for example:

```env
ADMIN_PASSWORD_HASH='$2b$12$...'
```

By default Postgres and Redis are internal only. The API is bound to `127.0.0.1:3100`, and the dashboard is bound to `3000` for quick IP testing. Browser API requests use the same-origin `/api` path; Next.js forwards them to `http://api:3100` on the internal Compose network. Do not bind SignalPilot to `80` or `443` on this VPS while n8n Traefik owns those ports.

For an HTTP/IP deployment, set:

```env
DASHBOARD_ORIGIN=http://YOUR_VPS_IP:3000
NEXT_PUBLIC_SIGNALPILOT_API_URL=/api
SIGNALPILOT_API_INTERNAL_URL=http://api:3100
AUTH_COOKIE_SECURE=false
API_AUTH_ENABLED=true
DASHBOARD_AUTH_ENABLED=true
```

Replace `YOUR_VPS_IP` and do not add a trailing slash to `DASHBOARD_ORIGIN`.

`NEXT_PUBLIC_SIGNALPILOT_API_URL` is a Docker build argument and is embedded in the browser bundle. Always build with `--env-file .env.production` (or use `pnpm ops:prod:build`) after changing it. The internal API URL is used for server-side rendering and the same-origin rewrite; it must not be `localhost` inside the dashboard container.

### 1. Clone and prepare

```bash
git clone <repo> signalpilot
cd signalpilot
pnpm install          # host-side only, for auth tooling
```

### 2. Create `.env.production`

```bash
cp .env.production.example .env.production
```

Fill in all values (see the comments in the file). Critical fields:

| Variable | How to generate |
|---|---|
| `POSTGRES_PASSWORD` | Random string: `openssl rand -hex 20` |
| `ADMIN_PASSWORD_HASH` | `ADMIN_PASSWORD='choose-a-cleartext-password' pnpm auth:hash-password` |
| `AUTH_SESSION_SECRET` | `openssl rand -hex 32` |

### 3. Build images

```bash
pnpm ops:prod:build
```

First build takes 5–10 minutes (downloads base images, installs deps, compiles TypeScript).
Subsequent builds use Docker layer cache.

### 4. Run database migrations

```bash
./scripts/ops/prod-migrate-docker.sh
```

This runs `prisma migrate deploy` with `--schema=packages/database/prisma/schema.prisma` in a temporary Node container. Safe to run multiple times.

Seed initial watchlist data after the migrations:

```bash
./scripts/ops/prod-seed-docker.sh
```

### 5. Start all services

```bash
pnpm ops:prod:up
```

Services started:

| Service | Port | Notes |
|---|---|---|
| `postgres` | — | Internal only |
| `redis` | — | Internal only |
| `api` | `127.0.0.1:3100` | Loopback only by default |
| `dashboard` | `3000` | Exposed publicly |
| `worker-scheduler` | — | Background cron |

### Worker scheduling

The worker scheduler reads its cadence from `.env.production`. The always-on `worker-scheduler`
container schedules these jobs in-process — no host crontab entries are needed for them:

| In-process job | Enabled by | Cron variable | Default | Recommended |
|---|---|---|---|---|
| Crypto Full Pipeline (candles + regime + signals + paper eval) | always on | `CRYPTO_PIPELINE_CRON` | `0 * * * *` | `*/15 * * * *` |
| Equity Pipeline | `ENABLE_EQUITY_PIPELINE=true` | `EQUITY_PIPELINE_CRON` | `30 * * * *` | `0 */4 * * *` |
| Quick Crypto Radar | `QUICK_RADAR_ENABLED=true` | `QUICK_RADAR_CRON` | `*/5 * * * *` | `*/5 * * * *` |
| Equity/ETF Radar | `EQUITY_RADAR_ENABLED=true` | `EQUITY_RADAR_CRON` | `15 */4 * * *` | `15 */4 * * *` (nach der Equity-Pipeline) |
| Radar Summary / Daily Briefing | `RADAR_SUMMARY_ENABLED=true` | `RADAR_SUMMARY_CRON` | `0 * * * *` | `0 7,19 * * *` + `RADAR_SUMMARY_LOOKBACK_MINUTES=720` |
| Global Event Monitor | `GLOBAL_EVENT_MONITOR_ENABLED=true` | `GLOBAL_EVENT_MONITOR_CRON` | `*/30 * * * *` | `*/30 * * * *` (Finnhub-Limits beachten) |
| Asset Discovery | `ASSET_DISCOVERY_ENABLED=true` | `ASSET_DISCOVERY_CRON` | `30 2 * * *` | zunächst nur mit `ASSET_DISCOVERY_DRY_RUN=true` |

Market Regime and Paper Evaluation run as steps inside the Crypto Full Pipeline
(`ENABLE_MARKET_REGIME`, `ENABLE_PAPER_EVALUATION`) and do not need separate schedules.

Do not run the Crypto Full Pipeline every minute. Quick Crypto Radar is the lightweight
high-frequency job; it only reads a few recent candles per watchlist asset.

Cron uses five time fields: minute, hour, day of month, month, day of week. For example, `*/15 * * * *` means every 15 minutes, and `*/5` in the minute field means every 5 minutes.

Production scheduler variables:

```env
CRYPTO_PIPELINE_CRON=*/15 * * * *
WORKER_RUN_ON_START=false
QUICK_RADAR_ENABLED=false
QUICK_RADAR_CRON=*/5 * * * *
QUICK_RADAR_TIMEFRAME=1h
QUICK_RADAR_MAX_ASSETS=10
QUICK_RADAR_ALERTS_ENABLED=false
QUICK_RADAR_ALERT_COOLDOWN_MINUTES=60
QUICK_RADAR_MIN_ALERT_SEVERITY=IMPORTANT
RADAR_SUMMARY_ENABLED=false
RADAR_SUMMARY_CRON=0 * * * *
RADAR_SUMMARY_MIN_EVENT_COUNT=1
RADAR_SUMMARY_WEBHOOK_ENABLED=false
GLOBAL_EVENT_MONITOR_ENABLED=false
GLOBAL_EVENT_MONITOR_CRON=*/30 * * * *
GLOBAL_EVENT_MONITOR_CATEGORIES=general
GLOBAL_EVENT_MONITOR_MAX_EVENTS=25
GLOBAL_EVENT_ALERTS_ENABLED=false
MIN_EVENT_ALERT_SEVERITY=IMPORTANT
GLOBAL_EVENT_ALERT_COOLDOWN_MINUTES=120
GLOBAL_EVENT_MAX_ALERTS_PER_RUN=3
```

Set `WORKER_RUN_ON_START=true` only when the worker should run the Crypto Full Pipeline once immediately after startup. The scheduler logs the cron expression, run-on-start setting, environment, and scheduler enabled state at startup without logging secrets. Invalid cron expressions abort startup with a clear error message.

After changing scheduler variables, restart the worker container:

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate worker-scheduler
docker compose -f docker-compose.prod.yml logs --tail=50 worker-scheduler
```

Each scheduled run writes BotLog rows (`Scheduled quick radar run started/finished/failed` etc.) and each job writes its own BotRun row, so the dashboard and Postgres always show when workers last ran.

Quick Crypto Radar is a lightweight observation job for watchlist crypto assets. It stores Beobachtung summaries in `BotRun.metadataJson`, writes BotLogs, and persists structured `RadarEvent` rows for auffällige Bewegung, Volumenanstieg, and erhöhte Volatilität. It does not create user-facing recommendations. The API exposes recent rows at `GET /radar/events`.

With `QUICK_RADAR_PATTERNS_ENABLED=true` (default) both radar jobs additionally run the
Chart-Pattern-Radar on the same candles: Nähe zum 20-Perioden-Hoch/Tief wird als
`SR_PROXIMITY` (ohne Volumenbestätigung, INFO) oder `BREAKOUT_PROXIMITY` (mit erhöhtem
Volumen, WATCH/IMPORTANT) gemeldet, RSI-Mittellinien-Kreuzungen als `MOMENTUM_SHIFT`, und ab
drei gleichzeitigen Faktoren entsteht ein `CONFLUENCE`-Ereignis (IMPORTANT/CRITICAL). Alle
Messwerte stehen in `metadataJson.patternDetails`; die Formulierungen bleiben Research-Hinweise
("möglicher Ausbruchsbereich", nie kaufen/verkaufen).

The Equity/ETF Radar (`EQUITY_RADAR_ENABLED=true`) runs the same metric and pattern analysis
for watchlist stocks/ETFs — but exclusively on candles already imported by the Equity-Pipeline
(no extra Finnhub calls). Assets whose latest candle is older than
`EQUITY_RADAR_MAX_DATA_AGE_HOURS` (default 96h) are skipped and counted as stale instead of
being evaluated on outdated data. Schedule it after the Equity-Pipeline (default `15 */4 * * *`).
Alerts use `alertType: equity_radar` and the same n8n webhook.

Optional Radar alerts use the existing `N8N_WEBHOOK_SIGNAL_URL` only. There is no direct Telegram integration. Keep `QUICK_RADAR_ALERTS_ENABLED=false` unless the n8n flow is ready for `type: radar_event` payloads. When enabled, SignalPilot sends only events at or above `QUICK_RADAR_MIN_ALERT_SEVERITY` and suppresses repeated alerts for the same symbol/event type within `QUICK_RADAR_ALERT_COOLDOWN_MINUTES`.

Radar Summary is a compact research update for the latest Radar Events, chart patterns, global
market events, and market-regime context. When `RADAR_SUMMARY_ENABLED=true`, the
worker-scheduler runs it on `RADAR_SUMMARY_CRON` (manual runs via `worker:radar-summary` also
work). The lookback window is configurable via `RADAR_SUMMARY_LOOKBACK_MINUTES` (default 60) —
for a morning/evening Daily Briefing set `RADAR_SUMMARY_CRON=0 7,19 * * *` and
`RADAR_SUMMARY_LOOKBACK_MINUTES=720`. It sends `type: radar_summary` payloads only when
`RADAR_SUMMARY_ENABLED=true`, `RADAR_SUMMARY_WEBHOOK_ENABLED=true`, and at least
`RADAR_SUMMARY_MIN_EVENT_COUNT` events (Radar + globale Ereignisse kombiniert) exist in the
lookback window. Repeated manual runs do not resend when no newer events exist.

The Global Event Monitor fetches Finnhub General News (`GLOBAL_EVENT_MONITOR_CATEGORIES`,
default `general`), classifies them with transparent keyword rules into structured
`MarketEvent` rows (eventType, severity, confidence, region, reasoning, source URL) and
deduplicates via a unique `dedupKey`. Unclassifiable headlines are skipped instead of stored.
Confidence is deliberately conservative (max 0.6) because the classification is keyword-based —
every event keeps its source and a human-readable reasoning. Alerts go through the same n8n
webhook: only new events at or above `MIN_EVENT_ALERT_SEVERITY`, at most
`GLOBAL_EVENT_MAX_ALERTS_PER_RUN` per run, and per eventType no more than one alert per
`GLOBAL_EVENT_ALERT_COOLDOWN_MINUTES`. The dashboard shows recent events in the
"Globale Ereignisse" section; the API serves them at `GET /market-events`.

Each new event additionally runs through the rule-based Impact Engine
(`@signalpilot/impact-engine`): ~16 deterministic rules (Ölpreis auf/ab, Zinssenkungs-/
Zinserhöhungserwartung, USD-Stärke/-Schwäche, geopolitische Eskalation/Entspannung,
schwache/starke Konjunkturdaten, Inflation, Risk-on/off, Lieferketten) fill
`positiveImpact`/`negativeImpact`, `affectedAssetClasses`, `affectedSectors` and
`affectedSymbols` (repräsentative Proxy-ETFs). The engine is intentionally boring: no LLM,
matched rules are listed in the reasoning and in `metadataJson.appliedImpactRules`,
contradictory signals land in `metadataJson.mixedSignals` instead of being hidden, and the
impact confidence is capped at 0.6. Events no rule matches keep empty impact lists. The
dashboard aggregates these lists into the "Asset Impact Map" and the
"Makro & Geopolitik Monitor" (last 48h).

Run jobs manually:

```bash
pnpm worker:quick-crypto-radar
pnpm worker:quick-equity-radar
pnpm worker:radar-summary
pnpm worker:global-event-monitor
```

### Testing Telegram/n8n alerts

All alerts go exclusively through `N8N_WEBHOOK_SIGNAL_URL` (an n8n webhook that forwards to
Telegram). SignalPilot never calls the Telegram Bot API directly.

Every payload is JSON with a `type` discriminator the n8n flow can switch on:

| `type` | Sent by | Purpose |
|---|---|---|
| `signal` fields (no discriminator, has `signalId`) | Signal pipeline | Signal-Beobachtung |
| `radar_event` | Quick Crypto Radar | Auffällige Marktbewegung |
| `radar_summary` | Radar Summary | Kompakte Research-Zusammenfassung |
| `market_event` | Global Event Monitor | Makro-/Geopolitik-/Markt-Ereignis |

`radar_event` and `market_event` payloads share the research-alert format from
`@signalpilot/alerts`:

- `alertType`: `crypto_radar`, `equity_radar`, `commodity_radar`, `chart_pattern`,
  `market_event`, `macro_event`, `geopolitical_event`, `risk_warning`, `daily_summary`,
  `urgent_event`
- `severity`: `INFO` | `WATCH` | `IMPORTANT` | `CRITICAL`
- `title`, `whatHappened`, `whyRelevant`
- `potentiallyPositive` / `potentiallyNegative` (Impact-Listen; bei `market_event` von der
  regelbasierten Impact Engine befüllt, bei `radar_event` weiterhin leer)
- `confidence` (0–1 oder null), `sourceName`, `sourceUrl`
- `telegramText`: fertig formatierte Nachricht — der n8n-Flow kann sie unverändert an
  Telegram weiterreichen
- `disclaimer`: immer "Keine Handlungsempfehlung. Research- und Beobachtungshinweis."

The wording is deliberately observation-only (beobachtenswert, auffällige Bewegung) — no
buy/sell/entry/exit language is ever generated.

Test the flow end to end:

```bash
# 1. Send the latest signal through n8n (creates an Alert row):
pnpm alert:test-latest-signal

# 2. Radar alerts: enable flags in .env.production first
#    (QUICK_RADAR_ENABLED=true, QUICK_RADAR_ALERTS_ENABLED=true,
#     QUICK_RADAR_MIN_ALERT_SEVERITY=WATCH lowers the bar for testing), then:
./scripts/ops/prod-run-worker-docker.sh worker:quick-crypto-radar

# 3. Global Event Monitor: enable flags in .env.production first
#    (GLOBAL_EVENT_MONITOR_ENABLED=true; for a Telegram test additionally
#     GLOBAL_EVENT_ALERTS_ENABLED=true and MIN_EVENT_ALERT_SEVERITY=WATCH), then:
./scripts/ops/prod-run-worker-docker.sh worker:global-event-monitor

# 4. Check what was sent and whether it succeeded (no secrets printed):
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'select id, channel, status, error, "createdAt" from "Alert" order by "createdAt" desc limit 10;'

# 5. Inspect detected market events:
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'select "eventType", severity, confidence, region, title from "MarketEvent" order by "detectedAt" desc limit 10;'
```

Failed deliveries stay in the `Alert` table with `status = FAILED` and the error message; the
dispatcher retries 3 times before giving up. Cooldowns prevent alert spam: per symbol/eventType
within `QUICK_RADAR_ALERT_COOLDOWN_MINUTES`, and only events at or above
`QUICK_RADAR_MIN_ALERT_SEVERITY` are sent.

### Manual worker runs

Use the production worker Docker runner for one-off worker jobs on the VPS. It starts a temporary Node container on the production Docker network, loads `.env.production`, installs dependencies, generates Prisma Client, builds the packages, builds the worker, and then runs the requested root worker script.

Manual Crypto Full Pipeline test:

```bash
./scripts/ops/prod-run-worker-docker.sh worker:run-crypto-pipeline
```

Other examples:

```bash
./scripts/ops/prod-run-worker-docker.sh worker:fetch-crypto-candles
./scripts/ops/prod-run-worker-docker.sh worker:calculate-market-regime
./scripts/ops/prod-run-worker-docker.sh worker:quick-crypto-radar
./scripts/ops/prod-run-worker-docker.sh worker:radar-summary
pnpm ops:prod:run-worker:docker worker:run-crypto-pipeline
```

Override defaults only when the VPS differs:

```bash
SIGNALPILOT_DOCKER_NETWORK=signalpilot_internal \
SIGNALPILOT_ENV_FILE=.env.production \
SIGNALPILOT_NODE_IMAGE=node:22-bookworm \
./scripts/ops/prod-run-worker-docker.sh worker:run-crypto-pipeline
```

### Hostinger VPS cron plan

The periodic jobs (Crypto Pipeline, Equity Pipeline, Quick Crypto Radar, Radar Summary) run
inside the always-on `worker-scheduler` container — see "Worker scheduling" above. They must
NOT also be scheduled in the host crontab; that would run them twice and spin up a heavy
temporary build container every few minutes.

If you previously installed crontab entries for `worker:quick-crypto-radar`,
`worker:run-crypto-pipeline`, `worker:calculate-market-regime`, `worker:evaluate-paper-signals`,
`worker:run-equity-pipeline`, or `worker:radar-summary`, remove them (`crontab -e`) and control
those cadences via `.env.production` instead.

Use host cron only for heavy jobs that should stay manual or nightly, via
`scripts/ops/prod-run-worker-docker.sh` (each run prepares a temporary Node container, generates
Prisma Client, builds packages, and runs the requested root worker script):

Create the log directory once:

```bash
cd /opt/signalpilot
mkdir -p logs
```

Open the crontab:

```bash
crontab -e
```

Optional plan for heavy jobs only:

```cron
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Backtests / Strategy Comparison: run manually, or schedule at night only after reviewing runtime.
# 30 2 * * * cd /opt/signalpilot && ./scripts/ops/prod-run-worker-docker.sh worker:run-strategy-comparison >> /opt/signalpilot/logs/strategy-comparison.log 2>&1
```

Do not schedule the Crypto Full Pipeline every minute. Quick Crypto Radar (in-process, every 5 minutes) covers frequent observations. Watch API limits, Binance/Finnhub response behavior, CPU, RAM, and disk growth on the VPS. If jobs overlap or logs show rate-limit pressure, widen the intervals in `.env.production`.

Backtests and Strategy Comparison should remain manual or run at night after you know their runtime:

```bash
cd /opt/signalpilot
./scripts/ops/prod-run-worker-docker.sh worker:run-backtest
./scripts/ops/prod-run-worker-docker.sh worker:run-strategy-comparison
```

The helper script `scripts/ops/install-cron.example.sh` prints the recommended crontab snippet but does not install or overwrite anything.

Monitoring commands:

```bash
cd /opt/signalpilot

# In-process scheduled jobs log to the worker-scheduler container
docker compose -f docker-compose.prod.yml logs --tail=100 worker-scheduler

# Tail logs of optional host-cron jobs (heavy jobs only)
tail -f logs/strategy-comparison.log

# Check Compose services
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100 api
docker compose -f docker-compose.prod.yml logs --tail=100 dashboard

# Count recent activity in Postgres. These commands do not print secrets.
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'select "jobName", status, count(*) from "BotRun" group by 1, 2 order by 1, 2;'

docker compose -f docker-compose.prod.yml exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'select "eventType", severity, count(*) from "RadarEvent" group by 1, 2 order by 1, 2;'

docker compose -f docker-compose.prod.yml exec postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'select channel, status, count(*) from "Alert" group by 1, 2 order by 1, 2;'
```

### 6. Check health

```bash
pnpm ops:prod:health
```

---

## Daily Operations

### View logs

```bash
pnpm ops:prod:logs              # all services
pnpm ops:prod:logs api          # single service
pnpm ops:prod:logs -- -n 50     # last 50 lines, no follow
```

### Service status

```bash
pnpm ops:prod:ps
```

### Stop

```bash
pnpm ops:prod:down
```

Volumes are preserved. Data is safe.

---

## Backup & Restore

### Backup

Creates a pg_dump custom-format file with timestamp:

```bash
pnpm ops:prod:backup
# → backups/signalpilot_20240501_143022.dump
```

Run this before updates and on a schedule.

### Restore

```bash
pnpm ops:prod:restore backups/signalpilot_20240501_143022.dump
```

Prompts for confirmation. Existing data is replaced.

### Reset Postgres volume (credential drift / fresh start)

Use only when the volume has no data worth keeping:

```bash
pnpm ops:prod:reset-db-volume
```

Requires typing `RESET_SIGNALPILOT_PROD_DB` to confirm. Removes only the `postgres_data` volume; Redis data is untouched.

### Automated backups (cron)

```cron
0 3 * * * cd /path/to/signalpilot && pnpm ops:prod:backup >> /var/log/signalpilot-backup.log 2>&1
```

Keep backups off-site (S3, rsync, etc.).

---

## Update Deployment

```bash
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres redis
./scripts/ops/prod-migrate-docker.sh
./scripts/ops/prod-seed-docker.sh
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

---

## HTTPS with a Reverse Proxy

The API is bound to `127.0.0.1:3100` (loopback only). Put Caddy or nginx in front:

### Caddy (recommended)

```caddyfile
your-domain.example.com {
    reverse_proxy localhost:3000
}
```

### nginx

```nginx
server {
    listen 443 ssl;
    server_name your-domain.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

The reverse proxy sends `/api/*` to the dashboard as well. The dashboard's same-origin
rewrite forwards those requests to the API over the private Docker network, so port 3100
does not need a public reverse-proxy route.

Then in `.env.production`:

```env
DASHBOARD_ORIGIN=https://your-domain.example.com
NEXT_PUBLIC_SIGNALPILOT_API_URL=/api
SIGNALPILOT_API_INTERNAL_URL=http://api:3100
AUTH_COOKIE_SECURE=true
```

---

## Security Checklist

- [ ] `ENABLE_LIVE_TRADING=false` — never change this (API fails to start if set to `true`)
- [ ] `AUTH_COOKIE_SECURE=true` behind HTTPS
- [ ] `AUTH_SESSION_SECRET` is a 32-byte random value
- [ ] `ADMIN_PASSWORD` is not stored in `.env.production`
- [ ] `ADMIN_PASSWORD_HASH` starts with `$2a$`, `$2b$`, or `$2y$`
- [ ] `POSTGRES_PASSWORD` is a strong random password
- [ ] `.env.production` is NOT committed to git
- [ ] `backups/` are stored off-machine
- [ ] API port `3100` is not exposed to the internet (loopback-bound or firewall)
- [ ] `API_AUTH_ENABLED=true` and `DASHBOARD_AUTH_ENABLED=true`

---

## Environment Reference

See `.env.production.example` for the full list with comments.

Key groups:

| Group | Variables |
|---|---|
| Database | `DATABASE_URL`, `POSTGRES_*` |
| Auth | `ADMIN_*`, `AUTH_*`, `API_AUTH_ENABLED`, `DASHBOARD_AUTH_ENABLED` |
| Trading safety | `ENABLE_LIVE_TRADING=false`, `PAPER_TRADING_ONLY=true` |
| Scheduling | `CRYPTO_PIPELINE_CRON`, `WORKER_RUN_ON_START`, `EQUITY_PIPELINE_CRON`, `RUN_EQUITY_PIPELINE_ON_START`, `QUICK_RADAR_CRON`, `EQUITY_RADAR_CRON`, `RADAR_SUMMARY_CRON`, `GLOBAL_EVENT_MONITOR_CRON` |
| Pattern/Equity Radar | `QUICK_RADAR_PATTERNS_ENABLED`, `EQUITY_RADAR_ENABLED`, `EQUITY_RADAR_TIMEFRAME`, `EQUITY_RADAR_MAX_DATA_AGE_HOURS`, `EQUITY_RADAR_ALERTS_ENABLED`, `RADAR_SUMMARY_LOOKBACK_MINUTES` |
| Global Events | `GLOBAL_EVENT_MONITOR_ENABLED`, `GLOBAL_EVENT_MONITOR_CATEGORIES`, `GLOBAL_EVENT_ALERTS_ENABLED`, `MIN_EVENT_ALERT_SEVERITY`, `GLOBAL_EVENT_ALERT_COOLDOWN_MINUTES`, `GLOBAL_EVENT_MAX_ALERTS_PER_RUN` |
| Feature flags | `ENABLE_MARKET_REGIME`, `ENABLE_EQUITY_*`, `ENABLE_EQUITY_PIPELINE` |
| Alerts | `ALERT_MODE`, `ALERT_COOLDOWN_MINUTES` |

---

## Troubleshooting

**Container exits immediately**

```bash
pnpm ops:prod:logs api
```

Common cause: missing env var or `ENABLE_LIVE_TRADING=true`.

**Migration fails with P1000 (authentication failed)**

Cause: the credentials in `DATABASE_URL` do not match what Postgres was initialised with.

Checklist:

1. `DATABASE_URL` in `.env.production` must use the `postgres` hostname (the Docker service name), **not** `localhost`:
   ```env
   DATABASE_URL=postgresql://signalpilot:signalpilot@postgres:5432/signalpilot
   ```

2. `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` in `.env.production` must exactly match the username and password inside `DATABASE_URL`.

3. If the Postgres volume was previously initialised with **different** credentials (e.g. you changed the password in `.env.production`), Postgres will reject the new credentials because the volume still holds the old ones.

   **Option A — reset the volume** (use when there is no important data):
   ```bash
   pnpm ops:prod:reset-db-volume
   pnpm ops:prod:migrate
   pnpm ops:prod:up
   ```

   **Option B — change the password inside the running database** (use when you have data to keep):
   ```bash
   docker compose -f docker-compose.prod.yml exec postgres \
     psql -U signalpilot -c "ALTER USER signalpilot WITH PASSWORD 'new-password';"
   # Then update POSTGRES_PASSWORD and DATABASE_URL in .env.production to match.
   ```

**Volume / credential drift**

If you change `POSTGRES_PASSWORD` in `.env.production` after the volume has already been initialised, Postgres will refuse connections. There are two recovery paths described above.

To check what password Postgres was initialised with, there is no direct way — you can only test by trying a connection:
```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U signalpilot -c "\l"
```

**Dashboard shows "Unauthorized"**

The session cookie requires HTTPS when `AUTH_COOKIE_SECURE=true`. Set `AUTH_COOKIE_SECURE=false` for local HTTP testing.

**`apps/dashboard/public` note**

`apps/dashboard/public/.gitkeep` is intentionally committed. It keeps the directory tracked by git so the Dockerfile `COPY` for public assets never fails, even when there are no actual public files.

**`pnpm ops:prod:build` fails**

Ensure Docker daemon is running and you have network access (Docker pulls base images).
