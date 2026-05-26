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
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d postgres redis
./scripts/ops/prod-migrate-docker.sh
./scripts/ops/prod-seed-docker.sh
docker compose -f docker-compose.prod.yml up -d
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

By default Postgres and Redis are internal only. The API is bound to `127.0.0.1:3100`, and the dashboard is bound to `3000` for quick IP testing. Do not bind SignalPilot to `80` or `443` on this VPS while n8n Traefik owns those ports.

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

The worker scheduler reads its cadence from `.env.production`.

Recommended VPS frequencies:

| Worker task | Suggested cadence | Cron example |
|---|---:|---|
| Crypto Full Pipeline | every 15 minutes | `*/15 * * * *` |
| Quick Radar later | every 5 minutes | `*/5 * * * *` |
| Market Regime | hourly | `0 * * * *` |
| Paper Evaluation | every 2 hours | `0 */2 * * *` |
| Equity Pipeline | every 4 hours | `0 */4 * * *` |

Do not run the Crypto Full Pipeline every minute. Use a faster lightweight task later for high-frequency dashboard activity.

Cron uses five time fields: minute, hour, day of month, month, day of week. For example, `*/15 * * * *` means every 15 minutes, and `*/5` in the minute field means every 5 minutes.

Production scheduler variables:

```env
CRYPTO_PIPELINE_CRON=*/15 * * * *
WORKER_RUN_ON_START=false
QUICK_RADAR_ENABLED=false
QUICK_RADAR_TIMEFRAME=1h
QUICK_RADAR_MAX_ASSETS=10
QUICK_RADAR_ALERTS_ENABLED=false
QUICK_RADAR_ALERT_COOLDOWN_MINUTES=60
QUICK_RADAR_MIN_ALERT_SEVERITY=IMPORTANT
RADAR_SUMMARY_ENABLED=false
RADAR_SUMMARY_CRON=0 * * * *
RADAR_SUMMARY_MIN_EVENT_COUNT=1
RADAR_SUMMARY_WEBHOOK_ENABLED=false
```

Set `WORKER_RUN_ON_START=true` only when the worker should run the Crypto Full Pipeline once immediately after startup. The scheduler logs the cron expression, run-on-start setting, environment, and scheduler enabled state at startup without logging secrets.

Quick Crypto Radar is a lightweight observation job for watchlist crypto assets. It stores Beobachtung summaries in `BotRun.metadataJson`, writes BotLogs, and persists structured `RadarEvent` rows for auffällige Bewegung, Volumenanstieg, and erhöhte Volatilität. It does not create user-facing recommendations. The API exposes recent rows at `GET /radar/events`.

Optional Radar alerts use the existing `N8N_WEBHOOK_SIGNAL_URL` only. There is no direct Telegram integration. Keep `QUICK_RADAR_ALERTS_ENABLED=false` unless the n8n flow is ready for `type: radar_event` payloads. When enabled, SignalPilot sends only events at or above `QUICK_RADAR_MIN_ALERT_SEVERITY` and suppresses repeated alerts for the same symbol/event type within `QUICK_RADAR_ALERT_COOLDOWN_MINUTES`.

Radar Summary is a compact research update for the latest Radar Events and market-regime context. It is manual/cron driven via `worker:radar-summary`, disabled by default, and sends `type: radar_summary` payloads only when `RADAR_SUMMARY_ENABLED=true`, `RADAR_SUMMARY_WEBHOOK_ENABLED=true`, and at least `RADAR_SUMMARY_MIN_EVENT_COUNT` events exist in the lookback window. Repeated manual runs do not resend when no newer Radar Events exist.

Run it manually:

```bash
pnpm worker:quick-crypto-radar
pnpm worker:radar-summary
```

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

Use cron for lightweight/manual worker runs through `scripts/ops/prod-run-worker-docker.sh`. This keeps the runtime containers slim while each scheduled job prepares a temporary Node container, generates Prisma Client, builds packages, builds the worker, and runs the requested root worker script.

Create the log directory once:

```bash
cd /opt/signalpilot
mkdir -p logs
```

Open the crontab:

```bash
crontab -e
```

Copy-paste this plan and adjust only if the deployment path differs:

```cron
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# SignalPilot worker jobs. Logs stay inside the repo at /opt/signalpilot/logs.
# Quick Crypto Radar: every 5 minutes
*/5 * * * * cd /opt/signalpilot && ./scripts/ops/prod-run-worker-docker.sh worker:quick-crypto-radar >> /opt/signalpilot/logs/quick-crypto-radar.log 2>&1

# Full Crypto Pipeline: every 15 minutes
*/15 * * * * cd /opt/signalpilot && ./scripts/ops/prod-run-worker-docker.sh worker:run-crypto-pipeline >> /opt/signalpilot/logs/crypto-pipeline.log 2>&1

# Market Regime: hourly
0 * * * * cd /opt/signalpilot && ./scripts/ops/prod-run-worker-docker.sh worker:calculate-market-regime >> /opt/signalpilot/logs/market-regime.log 2>&1

# Paper Evaluation: every 2 hours
5 */2 * * * cd /opt/signalpilot && ./scripts/ops/prod-run-worker-docker.sh worker:evaluate-paper-signals >> /opt/signalpilot/logs/paper-evaluation.log 2>&1

# Equity Pipeline: every 4 hours
10 */4 * * * cd /opt/signalpilot && ./scripts/ops/prod-run-worker-docker.sh worker:run-equity-pipeline >> /opt/signalpilot/logs/equity-pipeline.log 2>&1

# Radar Summary: hourly, still disabled unless RADAR_SUMMARY_ENABLED=true
15 * * * * cd /opt/signalpilot && ./scripts/ops/prod-run-worker-docker.sh worker:radar-summary >> /opt/signalpilot/logs/radar-summary.log 2>&1

# Backtests / Strategy Comparison: run manually, or schedule at night only after reviewing runtime.
# 30 2 * * * cd /opt/signalpilot && ./scripts/ops/prod-run-worker-docker.sh worker:run-strategy-comparison >> /opt/signalpilot/logs/strategy-comparison.log 2>&1
```

Do not schedule the Crypto Full Pipeline every minute. Use Quick Crypto Radar for frequent observations. Watch API limits, Binance/Finnhub response behavior, Docker image pull/cache behavior, CPU, RAM, and disk growth on the VPS. If jobs overlap or logs show rate-limit pressure, widen the intervals.

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

# Tail cron worker logs
tail -f logs/quick-crypto-radar.log
tail -f logs/crypto-pipeline.log
tail -f logs/market-regime.log
tail -f logs/paper-evaluation.log
tail -f logs/equity-pipeline.log
tail -f logs/radar-summary.log

# Check Compose services
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100 worker-scheduler
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
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d postgres redis
./scripts/ops/prod-migrate-docker.sh
./scripts/ops/prod-seed-docker.sh
docker compose -f docker-compose.prod.yml up -d
```

---

## HTTPS with a Reverse Proxy

The API is bound to `127.0.0.1:3100` (loopback only). Put Caddy or nginx in front:

### Caddy (recommended)

```caddyfile
your-domain.example.com {
    reverse_proxy /api/* localhost:3100
    reverse_proxy /* localhost:3000
}
```

### nginx

```nginx
server {
    listen 443 ssl;
    server_name your-domain.example.com;

    location /api/ {
        proxy_pass http://127.0.0.1:3100/;
        proxy_set_header Host $host;
    }

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }
}
```

Then in `.env.production`:

```env
DASHBOARD_ORIGIN=https://your-domain.example.com
NEXT_PUBLIC_SIGNALPILOT_API_URL=https://your-domain.example.com/api
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
| Scheduling | `CRYPTO_PIPELINE_CRON`, `WORKER_RUN_ON_START`, `EQUITY_PIPELINE_CRON`, `RUN_EQUITY_PIPELINE_ON_START` |
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
