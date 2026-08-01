# SignalPilot Asset Discovery und dynamisches Marktuniversum

## Zweck und Sicherheitsrahmen

Asset Discovery erweitert SignalPilot um eine dynamische Research-Auswahl für Kryptowährungen,
Aktien und ETFs. Es entstehen Beobachtungen, Scores und Frühwarnkontext, aber keine Kauf- oder
Verkaufsempfehlungen, Orders, Broker-Aufrufe oder Live-Trading-Funktionen.

Der produktive Startzustand ist absichtlich:

```env
ASSET_DISCOVERY_ENABLED=false
ASSET_DISCOVERY_DRY_RUN=true
```

Discovery selbst versendet keine Telegram-Sofortmeldung. Vorschläge erscheinen im Dashboard und,
wenn aktiviert, in der regulären Radar Summary. Ein Sofort-Alert bleibt ausschließlich der
bestehenden vollständigen Signalpipeline und ihrem zentralen Qualitätsgate vorbehalten.

## Universe-Konzept

| Gruppe | Zweck | Automatisch entfernbar |
|---|---|---|
| Core Universe | Benchmarks, Marktregime-Referenzen und dauerhaft geschützte Werte | Nein |
| Discovery Universe | Großer, günstiger Provider-Katalog für oberflächliche Prüfung | Nicht produktiv aktiv |
| Active Analysis Universe | Begrenzte dynamische Auswahl für Candles, Signale, Radar und News | Nur `AUTO_DISCOVERED` |

`AssetUniverseRole` beschreibt die aktuelle technische Rolle (`CORE`, `DISCOVERY`, `ACTIVE`,
`INACTIVE`). `AssetUniverseSource` hält den Ursprung (`CORE`, `PINNED`, `AUTO_DISCOVERED`,
`MANUAL`, `EXCLUDED`, `INACTIVE`). Nutzerregeln liegen dauerhaft in
`AssetUniversePreference`. Memberships sind Zeitintervalle: Ein Wechsel schließt die bisherige
Zeile über `validTo` und legt eine neue aktuelle Zeile an. Damit bleiben Aufenthaltsdauer,
Cooldown und Auswahlhistorie messbar. Ein partieller Unique-Index stellt sicher, dass je Asset
höchstens eine aktuelle Membership existiert.

Die Migration klassifiziert `SPY`, `QQQ`, `IWM`, `BTCUSDT` und `ETHUSDT` als Core. Alle anderen
bereits aktiven Assets werden als `MANUAL` übernommen. Bestehende Auswahl, Watchlist,
`alertEnabled`, Signale, Candles, Paper-Daten und Backtests bleiben erhalten.

## Mehrstufiger Funnel

1. Provider-Instrumentliste: Binance `exchangeInfo`, Finnhub `stock/symbol`.
2. Harte Metadatenfilter: Identität, Status, Handelbarkeit, Produkttyp und Stablecoins.
3. Günstige Snapshots: Binance-Batch-Ticker; Finnhub hat aktuell keinen wirtschaftlichen
   Batch-Snapshot und verwendet eine begrenzte rotierende Stichprobe.
4. Shortlist: standardmäßig höchstens 45 Assets einschließlich geschützter aktiver Assets.
5. Begrenzte Datenprüfung: maximal 80 aktuelle 1h- beziehungsweise 1d-Kerzen.
6. Diversifizierte Active-Auswahl.
7. Erst nach tatsächlicher produktiver Aktivierung: resumierbarer vollständiger Backfill.

Für Tausende Instrumente werden niemals sofort vollständige Historien importiert.

## Aufnahme- und Ausschlussregeln

Ein Instrument wird hart ausgeschlossen, wenn mindestens eine Bedingung zutrifft:

- Symbol, Provider-Symbol oder Handelsplatz sind nicht eindeutig.
- Das Instrument ist nicht handelbar, inaktiv oder delistet.
- Der Typ ist offensichtlich ungeeignet, etwa Warrant, Right, Unit oder Test-Instrument.
- Ein ETF ist gehebelt oder invers und `ASSET_DISCOVERY_ALLOW_LEVERAGED_ETFS` ist nicht aktiv.
- Ein Krypto-Basistoken ist ein Stablecoin und Stablecoins sind nicht freigegeben.
- Beide Seiten eines Kryptopaars sind Stablecoins.
- Die normalisierte Liquidität liegt unter dem Mindestwert.
- Datenfrische, Kerzenmenge oder Vollständigkeit bestehen das Datenqualitätsgate nicht.
- Der finale Discovery Score liegt unter dem Mindestwert.
- Der Nutzer hat das Asset ausgeschlossen oder auf „nur beobachten“ gesetzt.

Unbekannte Tokens und Microcaps gelangen nur durch den Funnel, wenn sie die
assetklassenspezifischen Notional-Volumen- und Datenqualitätsgates bestehen.

Core, Pins und manuelle Active-Assets sind zwingende Bestandteile der Auswahl. Die API lehnt den
Ausschluss eines Core-Assets ab. `alertEnabled` wird ausschließlich weiterhin über
`WatchlistItem` gesteuert und bei Universe-Änderungen nie geschrieben.

## Discovery Score v1.0.0

Alle Komponenten liegen auf einer erklärbaren Skala von 0 bis 100. Gewichte sind pro Assetklasse
konfigurierbar und werden zusammen mit jeder Score-Zeile historisch gespeichert.

| Komponente | Crypto | Aktie | ETF |
|---|---:|---:|---:|
| Liquidität | 15 | 12 | 15 |
| Handelsvolumen | 11 | 8 | 9 |
| Volumenänderung | 7 | 7 | 7 |
| Volatilität | 6 | 6 | 6 |
| Kursbewegung | 6 | 6 | 6 |
| Trendstärke | 9 | 9 | 11 |
| Relative Stärke | 7 | 7 | 9 |
| Ausbruchsnähe | 7 | 7 | 7 |
| Multi-Timeframe-Konfluenz | 6 | 6 | 6 |
| Datenfrische | 8 | 8 | 8 |
| Datenvollständigkeit | 10 | 10 | 10 |
| News/Event-Aktivität | 1 | 5 | 1 |
| Ungewöhnliche Aktivität | 4 | 4 | 4 |
| Historische Signalqualität | 2 | 2 | 2 |
| Paper-/Backtestqualität | 2 | 4 | 3 |

Besondere Schutzregeln:

- Volatilität und absolute Kursbewegung haben ein Optimum. Extreme Werte werden wieder
  abgewertet und können den Score nicht allein treiben.
- Der Score ist auf ungefähr `Datenqualität + 8` begrenzt.
- Unter 40 brauchbaren Kerzen ist der Score auf 48 begrenzt.
- Unter dem Datenqualitätsminimum wird zusätzlich ein harter Abschlag angewandt.
- Paper-, Backtest- und Signalqualität werden bei kleinen Stichproben gegen 50 geschrumpft:
  `n / (n + 30)`. Ein einzelner Treffer erzeugt daher keine hohe Confidence.
- Komponenten, Gewichte, Rohscore, Quality Cap, Stichprobengröße und Messwerte werden in
  `DiscoveryScoreSnapshot` gespeichert und im Dashboard erklärt.

Gewichte können über `ASSET_DISCOVERY_SCORE_WEIGHTS_JSON` überschrieben werden. Bei jeder
fachlichen Änderung muss `ASSET_DISCOVERY_POLICY_VERSION` erhöht werden.

## Diversifikation und Stabilität

Standardgrenzen:

- 12 Kryptowährungen, 15 Aktien und 8 ETFs im Active Universe.
- Höchstens 3 Assets je Sektor.
- Höchstens 2 stark korrelierte Assets bei absoluter Pearson-Korrelation ab 0,85.
- Mindestens 7 Tage Verweildauer vor einer automatischen Entfernung.
- 14 Tage Cooldown nach automatischer Entfernung.
- Höchstens 3 Aufnahmen und 3 Entfernungen pro Lauf.
- Ersatz nur, wenn der neue Score mindestens 8 Punkte höher ist.

Korrelation wird aus bis zu 40 aktuellen Renditen berechnet. Fehlt eine ausreichende
gemeinsame Historie, wird keine Scheingenauigkeit angenommen; Sektorgruppen bilden dann den
zusätzlichen Diversifikationsschutz.

## Jobs und Scripts

| Job | Script | Aufgabe |
|---|---|---|
| Universe Refresh | `pnpm worker:discovery-refresh` | Provider-Katalog und Metadaten |
| Discovery Scan | `pnpm worker:discovery-scan` | günstiger Scan und Score-Snapshots |
| Active Selection | `pnpm worker:discovery-select` | Limits, Korrelation, Stabilität, Vorschläge |
| Reconciliation | `pnpm worker:discovery-reconcile` | Dry-Run oder sichere Membership-Änderung |
| Gesamtlauf | `pnpm worker:discovery-run` | alle vier Phasen in Reihenfolge |

Der Scheduler startet den Gesamtlauf nur bei `ASSET_DISCOVERY_ENABLED=true`. Der Run-Key besteht
standardmäßig aus UTC-Datum und Jobart. Wiederholungen desselben Tages verwenden denselben
Discovery-Run und upserten Kandidaten/Snapshots. Mit `ASSET_DISCOVERY_RUN_KEY` kann Operations
gezielt einen resumierbaren Schlüssel vorgeben.

Jede Phase schreibt `BotRun`, `BotLog` und `AssetDiscoveryRun`. Providerfehler werden je Provider
beziehungsweise Asset protokolliert. Ein fehlgeschlagener Kandidat rollt keine bereits gültige
Membership zurück. Membership-Wechsel selbst laufen transaktional.

Reconciliation akzeptiert nur die erfolgreiche Selection desselben resumierbaren Run-Keys mit
derselben Policy-Version und demselben Dry-Run-/Live-Modus. So kann eine alte Dry-Run-Auswahl
nach einer Freigabe nicht versehentlich produktiv übernommen werden.

## Dashboard und API

- `GET /discovery/overview` liefert aktuelle Assets, Vorschläge, Auf-/Absteiger,
  Score-Erklärungen, Verweildauer, Paper-Vergleich und Kosten.
- `GET /discovery/runs` hält die strukturierte Laufhistorie zugänglich.
- `GET /discovery/candidates/:id` liefert den vollständigen historischen Score-Snapshot.
- `PATCH /assets/:id/universe-preference` steuert Pin, Ausschluss, manuelle Aktivierung und
  „nur beobachten“. Die Optionen sind gegenseitig ausschließend; Core kann nicht deaktiviert
  werden.

Das Watchlist-Modell und `alertEnabled` werden von dieser API nicht geschrieben. Das kompakte
Overview zeigt nur neue, vorgeschlagene oder materiell aufgestiegene Kandidaten; Rohdetails
bleiben auf „Markt entdecken“.

## Umgebungsvariablen

| Variable | Default | Bedeutung |
|---|---:|---|
| `ASSET_DISCOVERY_ENABLED` | `false` | Scheduler und Pipeline fachlich freischalten |
| `ASSET_DISCOVERY_DRY_RUN` | `true` | Keine produktive Aktivierung/Deaktivierung |
| `ASSET_DISCOVERY_CRON` | `30 2 * * *` | täglicher Lauf |
| `ASSET_DISCOVERY_POLICY_VERSION` | `discovery-v1.0.0` | Version in allen Snapshots |
| `ASSET_DISCOVERY_MAX_CANDIDATES` | `45` | begrenzte Verifikations-Shortlist |
| `ASSET_DISCOVERY_VERIFICATION_CANDLE_LIMIT` | `80` | leichte Datenprüfung |
| `ASSET_DISCOVERY_ACTIVE_CRYPTO_LIMIT` | `12` | Klassenlimit |
| `ASSET_DISCOVERY_ACTIVE_EQUITY_LIMIT` | `15` | Klassenlimit |
| `ASSET_DISCOVERY_ACTIVE_ETF_LIMIT` | `8` | Klassenlimit |
| `ASSET_DISCOVERY_MIN_SCORE` | `62` | Mindestscore 0–100 |
| `ASSET_DISCOVERY_MIN_DATA_QUALITY` | `70` | Datenqualitätsgate 0–100 |
| `ASSET_DISCOVERY_MIN_LIQUIDITY` | `60` | normalisierter Liquiditätsscore 0–100 |
| `ASSET_DISCOVERY_MIN_DAYS_ACTIVE` | `7` | Mindestverweildauer |
| `ASSET_DISCOVERY_REPLACEMENT_SCORE_DELTA` | `8` | materieller Score-Vorsprung |
| `ASSET_DISCOVERY_MAX_ADDITIONS_PER_RUN` | `3` | Änderungsbremse |
| `ASSET_DISCOVERY_MAX_REMOVALS_PER_RUN` | `3` | Änderungsbremse |
| `ASSET_DISCOVERY_REMOVAL_COOLDOWN_DAYS` | `14` | Rückkehrs-Cooldown |
| `ASSET_DISCOVERY_MAX_PER_SECTOR` | `3` | Sektorlimit |
| `ASSET_DISCOVERY_MAX_CORRELATED_ASSETS` | `2` | Korrelationslimit |
| `ASSET_DISCOVERY_CORRELATION_THRESHOLD` | `0.85` | absolute Korrelationsschwelle |
| `ASSET_DISCOVERY_ALLOW_LEVERAGED_ETFS` | `false` | gehebelte/inverse ETFs zulassen |
| `ASSET_DISCOVERY_ALLOW_STABLECOINS` | `false` | Stablecoin-Basiswerte zulassen |
| `ASSET_DISCOVERY_SUMMARY_ENABLED` | `true` | Vorschläge in regulärer Summary |
| `ASSET_DISCOVERY_SCORE_WEIGHTS_JSON` | leer | optionale Gewichtsüberschreibung |

## Providerkosten pro Standardlauf

Die gespeicherten „API-Einheiten“ sind konservative technische Schätzwerte, keine
Abrechnungsbeträge:

- Binance Instrumentliste: 1 HTTP-Aufruf, geschätzt 20 Einheiten.
- Binance 24h Batch-Ticker: 1 HTTP-Aufruf, geschätzt 40 Einheiten.
- Binance Verifikationskerzen: 1 Aufruf und 2 Einheiten je geprüftem Crypto-Asset.
- Finnhub US-Instrumentliste: 1 Aufruf und 1 Einheit.
- Finnhub Verifikationskerzen: 1 Aufruf und 1 Einheit je geprüftem Aktien-/ETF-Asset.

Mit 45 Kandidaten liegt die harte Größenordnung bei höchstens etwa 48 HTTP-Aufrufen und,
abhängig vom Klassenmix, ungefähr 115–130 geschätzten Einheiten. Bereits vorhandene aktuelle
Kerzen reduzieren die Aufrufe. Reconciliation-Backfill-Kosten entstehen nur nach einer
tatsächlichen produktiven Aktivierung und werden separat im Backfill-`BotRun` erfasst.

Keine neue kostenpflichtige API wurde integriert. Finnhub-Sektor- und ETF-Metadaten sind im
aktuellen Bestand teilweise lückenhaft; die Schnittstelle lässt einen späteren EODHD- oder
separaten Fundamentals-Provider zu.

## VPS-Deployment und Dry-Run-Freigabe

1. Backup erstellen und Code holen:

   ```bash
   cd /opt/signalpilot
   pnpm ops:prod:backup
   git pull --ff-only
   ```

2. In `.env.production` nur die neuen Variablen ergänzen. Secrets nicht ändern:

   ```env
   ASSET_DISCOVERY_ENABLED=false
   ASSET_DISCOVERY_DRY_RUN=true
   ```

3. Images bauen, Infrastruktur starten und additive Migration deployen:

   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml build
   docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres redis
   ./scripts/ops/prod-migrate-docker.sh
   ./scripts/ops/prod-seed-docker.sh
   docker compose --env-file .env.production -f docker-compose.prod.yml up -d
   ```

4. Schema und Services prüfen:

   ```bash
   docker compose -f docker-compose.prod.yml ps
   curl -fsS http://127.0.0.1:3100/health
   docker compose -f docker-compose.prod.yml logs --tail=100 worker-scheduler
   ```

5. Für die Beobachtungsphase `ASSET_DISCOVERY_ENABLED=true` setzen, aber Dry-Run aktiviert
   lassen. Worker neu erstellen:

   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml \
     up -d --force-recreate worker-scheduler
   ```

6. Einen manuellen Dry-Run im Worker-Image ausführen:

   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml \
     run --rm worker-scheduler node dist/jobs/runAssetDiscoveryPipeline.js
   ```

7. Mindestens mehrere tägliche Läufe im Dashboard „Markt entdecken“ und mit den SQL-Abfragen
   unten prüfen. Erst wenn Kosten, Qualität, Stabilität und Paper-Vergleich tragen, darf
   `ASSET_DISCOVERY_DRY_RUN=false` gesetzt werden. Diese Änderung ist eine bewusste manuelle
   Freigabe.

## Dry-Run-Prüfungen

- Der letzte Reconciliation-Run enthält `dryRun=true`, `activatedCount=0` und
  `deactivatedCount=0`.
- Kandidaten besitzen trotzdem Score-Komponenten, Gründe und `proposedAction`.
- `Asset.isActive` sowie aktuelle Core-/Active-Memberships bleiben gegenüber vor dem Lauf
  unverändert.
- Es gibt keinen Alert mit Discovery-Kandidat als Sofortmeldung. Die reguläre Radar Summary darf
  Discovery-Vorschläge als Sammelkontext enthalten.
- Provider-Requests und geschätzte Einheiten bleiben unter dem erwarteten Budget.

## SQL-Kontrollen

```sql
-- Letzte Discovery-Läufe und Kosten
SELECT "kind", "status", "dryRun", "checkedAssetCount", "candidateCount",
       "proposedAdditionCount", "proposedRemovalCount",
       "providerRequestCount", "estimatedApiUnits", "startedAt", "finishedAt"
FROM "AssetDiscoveryRun"
ORDER BY "startedAt" DESC
LIMIT 20;

-- Aktuelles Universe inklusive Nutzer-Vorrang
SELECT a."symbol", a."assetType", a."isActive", m."role", m."source",
       p."isPinned", p."isExcluded", p."manualActive", p."observeOnly",
       w."alertEnabled", m."activatedAt", m."cooldownUntil"
FROM "Asset" a
JOIN "AssetUniverseMembership" m ON m."assetId" = a."id" AND m."isCurrent" = true
LEFT JOIN "AssetUniversePreference" p ON p."assetId" = a."id"
LEFT JOIN "WatchlistItem" w ON w."assetId" = a."id"
ORDER BY m."role", a."assetType", a."symbol";

-- Schutzverletzungen müssen null Zeilen liefern
SELECT a."symbol", m."role", m."source", a."isActive"
FROM "Asset" a
JOIN "AssetUniverseMembership" m ON m."assetId" = a."id" AND m."isCurrent" = true
LEFT JOIN "AssetUniversePreference" p ON p."assetId" = a."id"
WHERE (m."role" = 'CORE' OR p."isPinned" = true OR p."manualActive" = true)
  AND a."isActive" = false;

-- Letzte Vorschläge mit Gründen
SELECT a."symbol", c."rank", c."score", c."dataQuality", c."liquidity",
       c."proposedAction", c."reasonsJson", c."exclusionReasonsJson"
FROM "AssetDiscoveryCandidate" c
JOIN "Asset" a ON a."id" = c."assetId"
WHERE c."discoveryRunId" = (
  SELECT "id" FROM "AssetDiscoveryRun"
  WHERE "kind" = 'ACTIVE_SELECTION' AND "status" = 'SUCCESS'
  ORDER BY "startedAt" DESC LIMIT 1
)
ORDER BY c."rank" NULLS LAST, c."score" DESC;

-- Historische Membership-Dauer
SELECT a."symbol", m."source", m."activatedAt", m."deactivatedAt",
       EXTRACT(EPOCH FROM (COALESCE(m."deactivatedAt", NOW()) - m."activatedAt")) / 86400 AS days_active
FROM "AssetUniverseMembership" m
JOIN "Asset" a ON a."id" = m."assetId"
WHERE m."role" = 'ACTIVE' AND m."activatedAt" IS NOT NULL
ORDER BY m."activatedAt" DESC;

-- Discovery darf keine Telegram-Sofortmeldung erzeugen
SELECT al.*
FROM "Alert" al
WHERE al."channel" = 'TELEGRAM'
  AND al."payloadJson"::text ILIKE '%discovery%';
```

## Verbleibende Risiken und Datenlücken

- Finnhub liefert im vorhandenen kostenlosen Integrationspfad keine günstigen Batch-Volumen- und
  vollständigen Sektordaten. Aktien/ETFs werden deshalb rotierend und streng begrenzt geprüft.
- Korrelation aus 40 Renditen ist eine kurzfristige Näherung und kann Regimewechsel übersehen.
- Neue Instrumente haben zunächst keine Signal-/Paper-/Backtesthistorie; deren historische
  Qualitätskomponenten bleiben konservativ nahe 45.
- Binance API-Gewichte können sich providerseitig ändern. Die gespeicherten Einheiten sind
  Policy-Schätzungen und sollten gegen Provider-Header weiter verfeinert werden.
- Automatische Auswahl ist erst erfolgreich, wenn ein ausreichend langer Paper-Zeitraum mit
  belastbarer Stichprobe mindestens gleichwertige Trefferquote und Rendite gegenüber
  manuellen/Core-Assets zeigt. Das Dashboard zeigt beide Gruppen, aktiviert aber keine
  automatische Freigabe.
