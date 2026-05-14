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

## API Health Check

When the API is running:

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{ "status": "ok", "service": "signalpilot-api" }
```
