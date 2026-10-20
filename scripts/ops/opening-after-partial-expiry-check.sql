-- OFFICIAL_V1: ausschließlich lesende Prüfung auf gestrandete OPENING-Positionen
--
-- Grundlage: docs/trading/decisions/0024-opening-position-after-entry-expiry.md
-- (Abschnitt „Z1 – Lesende Prüfung auf dem VPS“). Erwartungswerte stehen dort.
--
-- Sicherheit:
--   - eine Transaktion REPEATABLE READ READ ONLY, am Ende ROLLBACK;
--   - nur SELECT, SET LOCAL und psql-Metabefehle;
--   - statement_timeout 30 s, lock_timeout 2 s.
--
-- Ausführung nur nach gesonderter Freigabe, vom Mac aus (wie
-- scripts/ops/official-v1-readonly-check.sql auf Branch
-- claude/risk-directive-enforcement-draft):
--
--   ssh root@191.101.2.236 'cd /opt/signalpilot && docker compose --project-name signalpilot --env-file .env.production -f docker-compose.prod.yml exec -T postgres sh -c "psql -X -v ON_ERROR_STOP=1 -P pager=off -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\""' \
--     < scripts/ops/opening-after-partial-expiry-check.sql > opening-check-$(date -u +%Y%m%dT%H%M%SZ).txt
--
-- Zeitstempel: Prisma speichert UTC ohne Zeitzone (timestamp(3)).

\set ON_ERROR_STOP on
\pset pager off
\pset null '(null)'

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

\echo '== Q1 Gestrandet: Position OPENING, Entry-Order terminal (erwartet: 0 Zeilen)'
SELECT pf."key"                 AS portfolio,
       a."symbol",
       p."id"                   AS position_id,
       p."direction",
       p."openQuantity",
       p."averageEntryPrice",
       p."stopPrice",
       p."maxHoldUntil",
       p."openedAt",
       p."createdAt"            AS position_created_at,
       o."id"                   AS entry_order_id,
       o."status"               AS order_status,
       o."cancelReasonCode",
       o."requestedQuantity",
       o."filledQuantity",
       o."remainingQuantity",
       o."reservedQuoteAmount",
       o."expiresAt",
       o."updatedAt"            AS order_updated_at,
       (SELECT count(*) FROM "ShadowFill" f
         WHERE f."shadowOrderId" = o."id" AND f."triggerType" = 'ENTRY')     AS entry_fills,
       (SELECT count(*) FROM "ShadowFill" f
         WHERE f."shadowPositionId" = p."id" AND f."triggerType" <> 'ENTRY') AS exit_fills
FROM "ShadowPosition" p
JOIN "ShadowOrder" o ON o."id" = p."entryOrderId"
JOIN "Portfolio"  pf ON pf."id" = p."portfolioId"
JOIN "Asset"       a ON a."id" = p."assetId"
WHERE p."status" = 'OPENING'
  AND o."status" IN ('FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED')
ORDER BY p."createdAt";

\echo '== Q2 Jede OPENING-Position mit Alter und Session-Zustand (erwartet: 0 Zeilen oder nur jünger als 2 h mit PARTIALLY_FILLED)'
SELECT pf."key"                                            AS portfolio,
       p."id"                                              AS position_id,
       o."status"                                          AS order_status,
       o."expiresAt",
       (now() AT TIME ZONE 'UTC') - p."createdAt"          AS alter,
       (now() AT TIME ZONE 'UTC') > o."expiresAt"          AS fenster_vorbei,
       s."status"                                          AS session_status,
       s."killSwitchEngaged",
       s."killReasonCode",
       pf."status"                                         AS portfolio_status
FROM "ShadowPosition" p
JOIN "ShadowOrder" o ON o."id" = p."entryOrderId"
JOIN "Portfolio"  pf ON pf."id" = p."portfolioId"
LEFT JOIN LATERAL (
  SELECT ts."status", ts."killSwitchEngaged", ts."killReasonCode"
  FROM "TradingSession" ts
  WHERE ts."portfolioId" = p."portfolioId" AND ts."status" <> 'CLOSED'
  ORDER BY ts."createdAt" DESC
  LIMIT 1
) s ON true
WHERE p."status" = 'OPENING'
ORDER BY p."createdAt";

\echo '== Q3 Gab es je eine Teilfüllung? (erwartet: teilgefuellt = 0, mehrere_entry_fills = 0)'
SELECT pf."key"                                                         AS portfolio,
       o."status",
       count(*)                                                         AS entry_orders,
       count(*) FILTER (WHERE o."filledQuantity" > 0
                          AND o."filledQuantity" < o."requestedQuantity") AS teilgefuellt,
       count(*) FILTER (WHERE fc.n > 1)                                 AS mehrere_entry_fills
FROM "ShadowOrder" o
JOIN "Portfolio" pf ON pf."id" = o."portfolioId"
LEFT JOIN LATERAL (
  SELECT count(*) AS n FROM "ShadowFill" f
  WHERE f."shadowOrderId" = o."id" AND f."triggerType" = 'ENTRY'
) fc ON true
WHERE o."purpose" = 'ENTRY'
GROUP BY pf."key", o."status"
ORDER BY pf."key", o."status";

\echo '== Q4 Indirektes Symptom: Reconciliation-Befunde (erwartet: keine PORTFOLIO_EQUITY_MISMATCH-Zeile)'
SELECT pf."key" AS portfolio, r."reasonCode", count(*) AS anzahl,
       min(r."createdAt") AS erstmals, max(r."createdAt") AS zuletzt
FROM "RiskEvent" r
JOIN "Portfolio" pf ON pf."id" = r."portfolioId"
WHERE r."type" = 'RECONCILIATION_FINDING'
GROUP BY pf."key", r."reasonCode"
ORDER BY pf."key", r."reasonCode";

\echo '== Q5 Vorbedingung: wie dünn war die dünnste BTCUSDT-1h-Kerze seit Start? (Teilfüllung erst unter 100 × Ordermenge)'
SELECT min(c."volume")                                                    AS min_volumen_btc,
       percentile_disc(0.001) WITHIN GROUP (ORDER BY c."volume")         AS p0_1_volumen_btc,
       (SELECT max(o."requestedQuantity") * 100 FROM "ShadowOrder" o
         WHERE o."purpose" = 'ENTRY')                                     AS schwelle_100x_max_order,
       count(*) FILTER (WHERE c."volume" < (SELECT max(o."requestedQuantity") * 100
                                             FROM "ShadowOrder" o
                                             WHERE o."purpose" = 'ENTRY')) AS kerzen_unter_schwelle,
       count(*)                                                           AS kerzen
FROM "Candle" c
WHERE c."symbol" = 'BTCUSDT'
  AND c."timeframe" = '1h'
  AND c."openTime" >= TIMESTAMP '2026-10-15 07:00:00';

ROLLBACK;
