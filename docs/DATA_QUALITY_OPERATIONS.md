# Datenqualität: Betrieb und Erfolgskontrolle

## Abläufe

SignalPilot trennt Candle-Import bewusst in drei Pfade:

1. **Normaler inkrementeller Import**: `fetchCryptoCandles` und
   `fetchEquityCandles` laden nur einen kleinen Überlappungsbereich ab der
   neuesten abgeschlossenen Kerze. Der Pipeline-Scheduler führt ausschließlich
   diesen Pfad aus.
2. **Initial Backfill**: `pnpm worker:backfill-candles` paginiert Binance mit
   `startTime`/`endTime` und lädt Finnhub in begrenzten Zeitfenstern. Nach jeder
   gespeicherten Seite wird `CandleDataQuality.backfillCursor` fortgeschrieben.
   Ein abgebrochener Lauf setzt dort wieder an.
3. **Gap Audit und Reparatur**: `pnpm worker:audit-candle-gaps` prüft
   abgeschlossene Kerzen, persistiert Coverage und lädt ausschließlich erkannte
   Fehlintervalle nach. Die Anzahl der Reparaturen pro Lauf ist begrenzt.

Alle Candle-Schreibvorgänge verwenden den bestehenden eindeutigen Schlüssel
`(assetId, timeframe, openTime)` und Upserts. Offene Kerzen werden vor dem
Speichern ausgesondert. Wiederholte Backfills, Audits und inkrementelle Läufe
sind dadurch idempotent.

## Persistente Messwerte

Die rückwärtskompatible Migration
`20260724090000_add_provider_data_quality_and_news_dedup` ergänzt
`CandleDataQuality`. Pro Asset, Provider und Timeframe werden älteste und
neueste abgeschlossene Kerze, Ist-/Soll-Anzahl, Lücken, Datenalter,
Providerfehler, Rate Limits, Entitlement-/403-Fehler, `no_data`, letzter Erfolg,
letzter Audit und Backfill-Cursor gespeichert.

Bei News entfernt die Migration nur den globalen URL-Unique-Index. Bestehende
Zeilen bleiben unverändert. Neue Zeilen verwenden einen kanonischen,
assetbezogenen Deduplizierungsschlüssel. Dadurch kann dieselbe Meldung mehreren
Assets zugeordnet werden. `source` ist die Originalquelle,
`transportProvider` der Transportweg (aktuell `FINNHUB`).

## Provider-Schutz

- maximal 3 Versuche mit begrenztem exponentiellem Backoff;
- Standardwartezeit 500 ms zwischen Providerabrufen;
- Binance-Seiten maximal 1.000 Kerzen;
- Finnhub-Historie standardmäßig 30-Tage-Fenster für `1h` und
  365-Tage-Fenster für `1d`;
- maximal 25 Gap-Reparaturen je Audit;
- Initial-Backfill wird niemals automatisch von der normalen Pipeline
  gestartet;
- `401`/ungültiger Key, `403`/Entitlement und nicht unterstützte Symbole sind
  dauerhaft und werden nicht wiederholt;
- `429`, Netzwerkfehler und `5xx` sind temporär und werden begrenzt wiederholt;
- Logs enthalten Statusklasse, Endpoint, Symbol und Timeframe, aber weder API-Key
  noch vollständige Providerantwort.

## Empfohlene Produktionswerte

```env
MARKET_DATA_REQUEST_DELAY_MS=500
PROVIDER_RETRY_MAX_ATTEMPTS=3
PROVIDER_RETRY_BASE_DELAY_MS=500
PROVIDER_RETRY_MAX_DELAY_MS=8000
CRYPTO_INCREMENTAL_CANDLE_LIMIT=300
EQUITY_INCREMENTAL_BOOTSTRAP_DAYS=7
FINNHUB_MAX_DATA_AGE_HOURS=96

CANDLE_BACKFILL_MAX_ASSETS=100
CRYPTO_BACKFILL_LOOKBACK_DAYS=730
BINANCE_BACKFILL_PAGE_SIZE=1000
FINNHUB_BACKFILL_1H_DAYS=90
FINNHUB_BACKFILL_1D_DAYS=1825
FINNHUB_BACKFILL_1H_WINDOW_DAYS=30
FINNHUB_BACKFILL_1D_WINDOW_DAYS=365

CANDLE_GAP_AUDIT_ENABLED=false
CANDLE_GAP_AUDIT_CRON=15 3 * * *
CANDLE_GAP_MAX_REPAIRS_PER_RUN=25

NEWS_LOOKBACK_DAYS=7
NEWS_MIN_RELEVANCE_SCORE=30
```

## VPS-Deployment

Die echte `.env.production` weder öffnen noch committen. Änderungen dort
werden vom Betreiber anhand der Variablen oben vorgenommen.

```bash
cd /opt/signalpilot
git pull --ff-only
pnpm ops:prod:backup
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres redis
./scripts/ops/prod-migrate-docker.sh
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 api worker-scheduler
```

Initialen Backfill einmalig und wiederaufnehmbar starten:

```bash
./scripts/ops/prod-run-worker-docker.sh worker:backfill-candles
./scripts/ops/prod-run-worker-docker.sh worker:audit-candle-gaps
```

Erst wenn beide Läufe stabil sind, `CANDLE_GAP_AUDIT_ENABLED=true` setzen und
den Scheduler neu erstellen:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  up -d --force-recreate worker-scheduler
```

## SQL-Prüfungen

```sql
SELECT provider, timeframe,
       COUNT(*) AS series,
       SUM("candleCount") AS candles,
       SUM("expectedCandleCount") AS expected,
       SUM("gapCount") AS gaps,
       SUM("missingCandleCount") AS missing,
       SUM("rateLimitCount") AS rate_limits,
       SUM("entitlementErrorCount") AS http_403,
       SUM("noDataCount") AS no_data,
       MAX("lastSuccessfulFetchAt") AS last_success
FROM "CandleDataQuality"
GROUP BY provider, timeframe
ORDER BY provider, timeframe;
```

```sql
SELECT a.symbol, q.provider, q.timeframe, q."oldestCandle",
       q."latestClosedCandle", q."latestDataAgeSeconds",
       q."gapCount", q."missingCandleCount", q."lastErrorKind"
FROM "CandleDataQuality" q
JOIN "Asset" a ON a.id = q."assetId"
WHERE q."gapCount" > 0 OR q."lastErrorKind" IS NOT NULL
ORDER BY q."gapCount" DESC, q."latestDataAgeSeconds" DESC NULLS FIRST;
```

```sql
SELECT "jobName", status, "startedAt", "finishedAt", "metadataJson"
FROM "BotRun"
WHERE "jobName" IN (
  'fetchCryptoCandles', 'fetchEquityCandles', 'backfillCandleHistory',
  'auditCandleGaps', 'fetchEquityNews'
)
ORDER BY "startedAt" DESC
LIMIT 50;
```

```sql
SELECT "transportProvider", COUNT(*) AS stored,
       COUNT(*) FILTER (WHERE "dashboardOnly") AS dashboard_only,
       COUNT(*) FILTER (WHERE "relevanceScore" >= 30) AS relevant,
       MIN("relevanceScore") AS min_score,
       MAX("relevanceScore") AS max_score
FROM "NewsItem"
GROUP BY "transportProvider";
```

```sql
SELECT url, COUNT(DISTINCT "assetId") AS linked_assets,
       ARRAY_AGG(DISTINCT symbol) AS symbols
FROM "NewsItem"
WHERE url IS NOT NULL
GROUP BY url
HAVING COUNT(DISTINCT "assetId") > 1
ORDER BY linked_assets DESC;
```

API-Prüfungen nach Anmeldung:

```text
GET /data-quality/report
GET /data-quality/assets?limit=100
GET /news?minRelevance=30&maxAgeHours=72&limit=20
GET /bot-runs?jobName=auditCandleGaps&limit=10
```

## Bekannte Grenzen

- Für US-Aktien ist kein neuer Börsenkalender-Provider integriert. Der
  Session-Audit ignoriert Overnight- und Wochenendlücken, kann bei täglichen
  Kerzen aber Börsenfeiertage zunächst als Lücke zählen; ein `no_data`-Ergebnis
  macht diese Abweichung sichtbar.
- Finnhub kann unbekannte Symbole als echte leere Antwort statt als expliziten
  Symbolfehler liefern. Explizite HTTP-Symbolfehler werden getrennt
  klassifiziert; ein nicht weiter spezifiziertes `no_data` bleibt bewusst
  `no_data`.
- Coverage vor dem ersten Audit ist noch nicht vollständig befüllt. Die Seite
  zeigt dann einen Empty State statt erfundener Werte.
- Historische Finnhub-Verfügbarkeit bleibt tarif- und symbolabhängig. Das Paket
  setzt kein kostenpflichtiges Entitlement voraus.

## Mindestens sieben Tage beobachten

- Coverage-Prozent, Lücken und fehlende Kerzen je Provider/Timeframe;
- Median und Maximum von `latestDataAgeSeconds`;
- `rateLimitCount` pro Job und Provider;
- Finnhub `entitlementErrorCount`/403 und `INVALID_API_KEY`;
- `noDataCount` je Symbol/Timeframe;
- Anteil fehlgeschlagener vs. erfolgreicher Providerjobs;
- Backfill-Fortschritt und wiederholte Cursor-Stillstände;
- gespeicherte News, Dashboard-only-Rohmeldungen, Duplikate und
  relevante Meldungen der letzten 72 Stunden;
- älteste/neuste Finnhub-Candle je beobachtetem Asset;
- Unterschiede zwischen Binance- und Finnhub-Coverage.

Erst nach sieben vollständigen Produktionstagen sollte anhand dieser Werte
entschieden werden, ob Finnhub ersetzt, tariflich anders konfiguriert oder nur
mit anderen Abruffenstern betrieben werden muss.
