# 01 – Tatsächlicher Bestand und Gap-Analyse

## Prüfgrundlage

Untersucht wurde der tatsächliche Working Tree am 2026-08-01. Bereits vor diesem Dokumentationspaket vorhandene, nicht eingecheckte Änderungen – insbesondere zur Asset Discovery sowie Änderungen an Prisma-, App-, Docker-/Deployment-nahen und Lock-Dateien – wurden nur gelesen und nicht verändert. `.env.production` und Secrets wurden nicht geöffnet. Aussagen über neue Discovery-Bestandteile beziehen sich deshalb ausdrücklich auf den vorgefundenen Working Tree und nicht zwingend auf `HEAD`.

## Monorepo

SignalPilot ist ein TypeScript-/pnpm-Monorepo mit Workspaces `apps/*` und `packages/*`, ESM/NodeNext, Ziel ES2022 und strikten TypeScript-Einstellungen.

| Bereich | Tatsächlicher Zweck |
| --- | --- |
| `apps/api` | Fastify-API für Authentifizierung, Dashboard-Lesezugriffe und wenige administrative Mutationen |
| `apps/dashboard` | Next.js-15-/React-19-Dashboard, überwiegend serverseitig geladene Seiten |
| `apps/worker` | `node-cron`-Scheduler und Analyse-, Daten-, Radar-, Paper-Evaluation- und Discovery-Jobs |
| `packages/database` | Prisma-Schema, Migrationen, Client und exportierte Runtime-Enums/Typen |
| `packages/market-data` | Binance-/Finnhub-Marktdaten, Candle-Upserts, Provider-Retry, Datenqualität und Discovery-Metadaten |
| `packages/discovery` | Im Working Tree vorhandene deterministische Eligibility-, Ranking-, Auswahl- und Reconciliation-Logik |
| `packages/indicators` | SMA, EMA, RSI, ATR, Volumen- und Hoch/Tief-Kennzahlen |
| `packages/scoring-engine` | deterministischer Signal-Score aus technischen und Kontextkomponenten |
| `packages/signal-rules` | regelbasierte Score-Anpassungen unter Einbeziehung historischen Feedbacks |
| `packages/multi-timeframe` | 1h-/4h-/1d-Ausrichtungsanalyse |
| `packages/market-regime` | persistierte Marktregime-Auswertung für Benchmarks |
| `packages/news-intelligence` | regelbasierte News-Auswertung |
| `packages/events-intelligence` | Ereignis- und globaler Marktkontext |
| `packages/impact-engine` | deterministische Impact-Einstufung |
| `packages/output-composer` | SignalOutput-/Dashboard-/Text-Zusammenstellung |
| `packages/data-quality` | Candle-Gap-, Freshness- und Coverage-Prüfung |
| `packages/backtesting` | candlebasierte retrospektive Signalbewertung |
| `packages/strategy-lab` | Vergleiche persistierter Signale anhand JSON-Konfigurationen |
| `packages/performance-intelligence` | Aggregation von `PaperSignalEvaluation` |
| `packages/alerts` | persistierte Webhook-Alerts mit Retry und Qualitätsschranken |
| `packages/shared` | gemeinsame DTOs und Basistypen |

Es existieren noch keine Pakete `trading-domain`, `strategy-engine`, `risk-engine`, `trading-simulation` oder `portfolio` und keine App `trading-worker`.

## Datenbestand und Migrationen

Das Prisma-Schema enthält Assets, Candles, Candle-Datenqualität, Signale und Outputs, Regel-Auswertungen, Marktregime, News/Ereignisse, Radar, Alerts, Bot-Läufe/-Logs, Audit, Backtests, Strategy Lab, Paper Evaluation und – im aktuellen Working Tree – Discovery-Läufe, Kandidaten und Universe-Mitgliedschaften. Migrationen reichen von der initialen Anlage im Mai 2026 bis zur vorgefundenen Discovery-Migration vom Juli 2026.

Konkret liegen 20 SQL-Migrationsverzeichnisse plus `migration_lock.toml` vor: Initialschema; Watchlist; Alert States; Paper Signal Evaluation und dessen Kind-Enum; zwei News-Erweiterungen; zwei namentlich ähnliche Earnings/Event-Migrationen plus Wiederherstellung der Summary-Spalte; Marktregime; Signalregeln; Backtesting; Strategy Lab; Audit; Radar; globale Market Events; Pattern-Radar-Enums; Provider-Datenqualität/News-Deduplizierung; und die im Working Tree noch nicht eingecheckte Discovery-Universe-Migration. Keine Migration nach dem Initialschema erweitert `PaperAccount`, `PaperOrder` oder `PaperPosition`.

Wiederverwendbare Faktenquellen:

- `Asset` enthält unter anderem Asset-Typ, Exchange/Provider, Basis-/Quote-Währung, Instrumentstatus sowie Tradable-/Leveraged-/Inverse-/Stablecoin-Merkmale. `Asset.isActive` ist ein Analyse-Universumsmerkmal, keine Trading-Freigabe.
- `Candle` speichert `Decimal(30,12)` OHLCV, Quelle, Timeframe und eine Eindeutigkeit auf Asset/Timeframe/Open-Time. `saveCandles` übernimmt nur geschlossene Kerzen und führt einzelne Upserts aus.
- `CandleDataQuality` hält Coverage, erwartete/fehlende Kerzen, Gaps, Freshness, Providerfehler und Backfill-Metadaten nach Asset, Provider und Timeframe.
- `Signal`, `SignalOutput` und `SignalRuleEvaluation` halten Scores, Status/Richtung/Risiko und JSON-Kontext. Es gibt keinen eindeutigen Schlüssel je Asset/Timeframe/Entscheidungskerze; Wiederholungen können mehrere Signale erzeugen.
- `MarketRegimeSnapshot` hält den Report als JSON mit Confidence. Source-IDs werden in heutigen Signal-Kontexten nicht durchgehend normalisiert referenziert.
- `RadarEvent`, `NewsItem`, `MarketEvent` und globale Market Events liefern Kontext, aber keine Trade-Freigabe.

### Vorhandene Paper-Modelle

`PaperAccount`, `PaperOrder` und `PaperPosition` stammen aus der initialen Migration. Außer Prisma-Schema, Migration, Runtime-Enumexporten und einem Exporttest gibt es im untersuchten Code keinen Erzeuger, Consumer, API-Endpunkt, Worker-Job oder Dashboard-Bereich für diese drei Modelle.

| Modell | Vorhandene Felder/Zustände | Fehlend für Shadow Trading |
| --- | --- | --- |
| `PaperAccount` | Name, Start-/aktueller Saldo, Währung, aktiv, Relationen zu Orders/Positionen | verfügbares/reserviertes Cash, Equity, Ledger, Version, Reconciliation, Status/Kill Switch |
| `PaperOrder` | Account, Asset, optional Signal, BUY/SELL, Menge, ein Preis, `PENDING/FILLED/CANCELLED/REJECTED`, Create-/Fill-Zeit | Strategie/Kandidat/Risiko/Session, Ordertyp, Teilausführungen, Restmenge, Ablauf, Gebühren, Spread/Slippage, Präzisionssnapshot, Idempotenz, Zustandsversion |
| `PaperPosition` | Account, Asset, Menge, Durchschnittseinstieg, `OPEN/CLOSED`, Open-/Close-Zeit | Order-/Fill-Herkunft, Stop/Take Profit, Events, Teil-Exit, realisiertes/unrealisiertes P&L, Gebühren, Strategieversion, Fehler-/Invalidierungszustand, Lock-Version |

Entscheidung: nicht wiederverwenden, nicht erweitern und zunächst nicht migrieren. Neue `Shadow*`-/`Portfolio*`-Modelle werden daneben eingeführt. Die Legacy-Modelle werden dokumentarisch als veraltet markiert und erst in einer späteren, eigenen Datenbereinigungsphase entfernt, nachdem Datenbestand und externe Consumer nachweislich geprüft wurden. Begründung und Übergang stehen in ADR 0002.

`PaperSignalEvaluation` ist dagegen aktiv: Worker legen pro Signal genau eine Evaluation an, evaluieren Preisbewegungen über Zeithorizonte und `performance-intelligence` aggregiert diese Resultate. Diese Auswertung ist keine Order-/Fill-/Cash-/Positionssimulation und bleibt als Research-Benchmark bestehen. Sie darf weder in Shadow-Trade-Zahlen noch in `StrategyPerformance` einfließen.

## Aktuelle Daten- und Analysepipelines

### Marktdaten und Qualität

- Crypto-Candles kommen ohne privaten Schlüssel über öffentliche Binance-Spot-Klines; unterstützt werden im aktuellen Pfad 1h, 4h und 1d.
- Aktien-/ETF-Candles, News und Ereignisse kommen über Finnhub.
- Bounded Retry und klassifizierte Providerfehler sind vorhanden. Providerfehler geben den API-Key nach den vorhandenen Tests nicht aus.
- Qualität wird aus geschlossenen Candles, Coverage, Freshness und Gaps berechnet und persistiert.
- Für kontinuierliche Märkte nutzt die bestehende Freshness-Prüfung grob `2 × Timeframe + 15 Minuten`; Session-Märkte erhalten größere Wochenend-/Börsenpausen-Toleranzen.
- Es fehlen Bid/Ask, Spread, Orderbuch/Trades, Quote-Volumen-Normalisierung als Ausführungsquelle und persistierte Exchange-Filter wie Tick Size, Step Size und Mindestnotional.

### Asset Discovery

Der aktuelle Working Tree enthält eine standardmäßig deaktivierte und standardmäßig dry-run-fähige Discovery-Pipeline: Provider-Refresh, Scan, deterministische Auswahl, Reconciliation und Backfill. Lauf- und Kandidatenschlüssel unterstützen Wiederholungen; Aktivierungsänderungen werden pro Asset transaktional geschrieben. Es gibt jedoch keinen verteilten Scheduler-Lock, und `Asset.isActive` ist ein Discovery-/Analyseergebnis. Eine spätere Trade-Freigabe muss ausschließlich über `StrategyAssignment` erfolgen.

### Signal, Radar, News und Regime

- Der Crypto-Full-Pipeline-Pfad lädt Candles, berechnet optional Regime, erzeugt 1h-/4h-/1d-Signale und startet Paper Evaluation.
- Scoring ist deterministisch. Fehlende Eingaben werden an mehreren Stellen neutral statt blockierend behandelt – für Trading ist deshalb eine separate Fail-Closed-Normalisierung nötig.
- Multi-Timeframe nutzt Gewichte 1d 0,45, 4h 0,35 und 1h 0,20.
- Der Marktregime-Job betrachtet SPY, QQQ, IWM, BTCUSDT und ETHUSDT und persistiert Snapshots.
- Quick Radar lädt öffentliche Binance-Candles direkt und erzeugt Events mit anwendungsseitigem Cooldown; ein DB-Eindeutigkeitsschlüssel fehlt.
- Crypto-Signale erhalten derzeit neutralen News-/Event-Kontext; globale Marktevents existieren separat. Deshalb darf Strategy v1 „News vorhanden“ nicht behaupten, sondern muss eine fehlende, widersprüchliche oder neutrale Quelle explizit behandeln.
- `signal-rules` kann aufgrund von Paper-Feedback Scores anpassen. Eine handelbare Strategie muss Engine-, Parameter- und Input-Versionen pinnen, damit diese adaptive Rückkopplung nachvollziehbar bleibt.

## Paper Evaluation, Backtesting, Strategy Lab und Performance

- Paper Evaluation sucht einen Candle-Preis nahe dem Signalzeitpunkt und misst spätere Returns/MFE/MAE. Sie modelliert keine Orders, Fills, Cash, Gebühren oder parallele Positionen. Werden Target und Invalidation innerhalb derselben aggregierten Betrachtung erreicht, wird im vorhandenen Pfad das Target zuerst geprüft; das ist für eine konservative Ausführung ungeeignet.
- Backtesting erzeugt historische Signale ohne offensichtlichen Look-ahead bei der Signalerzeugung, wertet Ausgänge aber candlebasiert ohne Spread, Slippage, Gebühren, Portfolio oder gleichzeitige Trades aus. Bei Target und Stop in derselben Candle wird ebenfalls Target zuerst geprüft.
- Strategy Lab filtert und vergleicht vorhandene Signalresultate anhand generischer JSON-Konfigurationen. Es ist keine versionierte, ausführbare Strategie-Engine.
- Performance Intelligence aggregiert `PaperSignalEvaluation`, nicht echte oder simulierte Trades. Die Bezeichnung „Performance“ im heutigen Dashboard ist daher nicht mit zukünftiger Shadow-Portfolio-Performance gleichzusetzen.

## Scheduler, Jobs und Wiederaufnahme

`apps/worker/src/scheduler.ts` verwendet `node-cron`. Der Crypto-Hourly-Job ist standardmäßig aktiv; Equity-, Radar-, Summary-, Global-Event-, Gap-Audit- und Discovery-Jobs sind je nach Job standardmäßig deaktiviert. Schutz vor Überlappung erfolgt durch In-Memory-Flags und wirkt nicht zwischen Prozessen oder Replikas. `BotRun` und `BotLog` liefern Laufstatus und Logs, aber keine verteilte Lease, keine Workflow-Claims und keinen atomaren Trading-Cursor.

Pipelines bestehen aus mehreren persistierenden Schritten ohne Gesamttransaktion. Das ist für Analyse akzeptabel, für Cash/Order/Position jedoch nicht. Shadow Trading benötigt DB-Eindeutigkeiten, compare-and-swap-Zustandswechsel, fachliche Transaktionen und explizite Wiederaufnahme-Cursor.

## API, Dashboard, Alerts und Audit

- Fastify schützt Dashboard-/Audit-Routen über Admin-Authentifizierung, sofern Auth aktiviert ist. Helmet, eine einzelne CORS-Origin, Cookie-Auth und globales Rate-Limiting sind vorhanden.
- `AuditLog` erfasst Akteur, Netzwerk-/User-Agent-Kontext, Aktion und Metadaten. `logAudit` ist best effort, Fehler werden geschluckt und Aufrufer warten häufig nicht darauf. Das reicht nicht für fachlich atomare Trading-Audits.
- Alerts werden persistiert und per Webhook/n8n mit Retry versandt. Es besteht keine Exchange-Anbindung.
- Das Dashboard hat Bereiche für Lage, Beobachten, Kontext, Research und System. Paper-Auswertung/Performance sind Signalresearch. Trading-Seiten und Trading-DTOs fehlen.

## Deployment und Sicherheitsbestand

- Development-/Production-Compose enthalten PostgreSQL und Redis; im untersuchten Applikationscode wird Redis nicht als Trading-Queue genutzt.
- API, Dashboard und Worker werden separat gebaut. API/Dashboard laufen in ihren Dockerfiles als nicht privilegierter Nutzer; für den Worker ist kein entsprechender `USER`-Wechsel sichtbar.
- Produktionsdokumentation fordert `ENABLE_LIVE_TRADING=false` und `PAPER_TRADING_ONLY=true`.
- Tatsächlich erzwingt Code nur den exakten Wert `ENABLE_LIVE_TRADING === "true"`: API beim Start und der Scheduler beim direkten Start beenden sich dann. `PAPER_TRADING_ONLY` hat im untersuchten Sourcecode keinen Consumer; `/config/public` leitet „paper only“ lediglich aus dem negierten Live-Flag ab.
- Direkt gestartete einzelne Worker-Jobs und der generische Worker-Einstieg verwenden die Scheduler-Startprüfung nicht zwangsläufig. Ein neuer Trading Worker braucht daher einen eigenen Fail-Closed-Startup-Guard.
- Es existieren keine Exchange-Adapter, privaten Orderaufrufe oder Exchange-Order-Credentials im untersuchten Codebestand.

## Tests

Es wurden 53 Testdateien unter `apps` und `packages` gefunden. Abgedeckt sind unter anderem API-Auth/Safety/Watchlist, Dashboard-Design/Login, Scheduling/Überlappung, Provider/Retry, Candles/Datenqualität, Indikatoren, Scoring, Regeln, Multi-Timeframe, Regime, News/Events, Radar, Paper Evaluation, Backtesting, Strategy Lab, Performance und Discovery. Nicht vorhanden sind Tests für Trading-Zustandsmaschinen, Portfolio-Ledger, Risk Engine, Fill-Simulation, Recovery, Trading-Idempotenz oder Kill Switch.

## Priorisierte Gaps

1. Keine klar abgegrenzte Shadow-Trade-Domäne und kein unveränderliches Portfolio-Ledger.
2. Keine versionierte ausführbare Strategie samt Assignment und reproduzierbarem Input-Snapshot.
3. Keine deterministische Risk Engine mit persistierten Einzelregelergebnissen.
4. Legacy-Paper-Modelle sind strukturell unzureichend; aktive Paper Evaluation misst Signale statt Trades.
5. Keine konservative Ausführungs- und Intrakerzen-Simulation.
6. Keine DB-gestützte, prozessübergreifende Idempotenz/Recovery für Trading-Workflows.
7. Bestehender Audit-Pfad ist nicht atomar genug für finanzielle Zustandsänderungen.
8. Candle-Daten enthalten keine beobachteten Spreads/Orderbuchtiefe und das Asset-Modell keine verlässlichen Ausführungsfilter.
9. Feature-Safety ist derzeit ein einzelner Negativcheck, nicht der erforderliche mehrstufige, fail-closed Shadow-Modus.
10. Keine Trading-API, -UI, -Operationsmetriken oder spezialisierte Abnahme-/Invariantentests.
