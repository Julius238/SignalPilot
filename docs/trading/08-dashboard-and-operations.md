# 08 – Dashboard und Operations

## Einordnung in das bestehende Design

Das vorhandene Dashboard organisiert Seiten über Navigationsgruppen und nutzt serverseitige API-Aufrufe, gemeinsame Karten/Tabellen/Badges sowie einzelne Client Controls. Shadow Trading erhält eine klar getrennte Gruppe **Shadow Trading**. Bestehende Seiten „Paper-Auswertung“ und „Performance“ bleiben als Signalresearch sichtbar und werden nicht umbenannt oder mit Trade-P&L vermischt.

Vorgesehene Pfade:

| Seite                 | Route                            | Inhalt                                                                                   |
| --------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| Trading Overview      | `/dashboard/trading`             | Session/Kill, Equity, Cash/Reserve, offene Exposure, Tages-P&L/Drawdown, Pipelinezustand |
| Trade Candidates      | `/dashboard/trading/candidates`  | Status, Asset, Strategieversion, Anchor, Ablauf, Reason Codes, Evidence-Drilldown        |
| Risk Decisions        | `/dashboard/trading/risk`        | PASS/FAIL, alle Rule Results, actual/limit, Severity, Inputhash                          |
| Shadow Orders         | `/dashboard/trading/orders`      | Status, Restmenge, Reserve, Profile, Fills, Ablauf                                       |
| offene Positionen     | `/dashboard/trading/positions`   | Menge, Entry, konservativer Mark, Stop/TP, unrealized P&L, Max-Hold                      |
| abgeschlossene Trades | `/dashboard/trading/trades`      | Exitgrund, Fills, netto P&L/R, Gebühren, Haltedauer                                      |
| Portfolio             | `/dashboard/trading/portfolio`   | Cash, Reserve, Equity Curve, Drawdown, Exposure, Ledger-/Snapshotstatus                  |
| Strategy Performance  | `/dashboard/trading/strategies`  | strikt Shadow-Trades pro StrategyVersion, nicht Paper Evaluation                         |
| Risk Events           | `/dashboard/trading/risk-events` | Severity, Grund, Aggregat, Acknowledge-/Resolutionstatus                                 |
| Sessions              | `/dashboard/trading/sessions`    | Zustand, Heartbeat/Reconcile, Kill-Switch-Historie, Adminaktionen                        |
| Audit Timeline        | `/dashboard/trading/audit`       | unveränderliche Ereigniskette mit Korrelation/Hashes                                     |

Desktop und Mobile müssen bestehende responsive Tabellen-/Kartenmuster einhalten. Die bereits verwendete Chart-Bibliothek kann für Equity/Drawdown wiederverwendet werden; Charts berechnen keine Fachkennzahl im Browser.

## Anzeigeprioritäten

Trading Overview zeigt oberhalb des Folds:

1. dauerhaftes Banner `SHADOW – KEINE EXCHANGE-AUSFÜHRUNG`;
2. Sessionstatus und Kill Switch mit letzter Änderung/Akteur;
3. Daten-/Worker-Freshness und letztes erfolgreiches Reconcile;
4. Equity, verfügbares/reserviertes Cash, Tages-P&L relativ zur 1-%-Grenze, aktueller/maximaler Drawdown;
5. offene Positionen und Exposure gegen 40-/20-/30-%-Limits;
6. wartende Orders, blockierte Kandidaten und Critical Risk Events.

Fehlende Daten werden als `UNBEKANNT/BLOCKIERT` dargestellt, nie als 0 oder gesund. Modellierte Spreads/Slippage tragen sichtbar das Label „simuliert, nicht beobachtet“.

Jeder Candidate, jede Order, jeder Fill und jede Position zeigt ein eindeutiges `LONG`-/`SHORT`-Badge sowie Strategy, StrategyVersion und Direction. Short-Ansichten tragen dauerhaft „synthetischer ungehebelter Shadow-Short – keine Börsenposition“. Positionen zeigen reserviertes Collateral und ein richtungsabhängig serverseitig berechnetes P&L; der Browser berechnet oder dreht kein Vorzeichen selbst.

## Drilldowns

- Candidate: Direction, Strategy/StrategyVersion/Hash, Anchor-Candle, alle Evidence-Typen, Snapshotzeiten, Entry/Stop/TP/RR, Strategy- und Risk-Gründe, Status-Timeline.
- Risk: jede Regel inklusive PASS, stabile Codes, actual/limit/unit, Rule-/Limitset-Version, Assessment-Inputhash.
- Order/Fill: Preisbrücke Referenz -> Spread -> Slippage -> Rundung -> Fee, Candle und Intrabar-/Gapregel.
- Position: Direction, reserviertes Short-Collateral, Entry-/Exitfills einschließlich BUY/SELL-Seite, PositionEvents, ExitPlan-Versionen, Exitgrund und richtungsabhängige P&L-Brücke gross -> fees -> net.
- Portfolio: Ledgersequenz und Snapshotsequenz; nur Admins dürfen Korrekturdetails sehen, keine Korrektur in v1-UI.
- Audit: Filter nach CorrelationId, Aggregate, Actor, Reason und Zeit; keine Secrets/Headers/raw Credentials.

## Vorgesehene API

Alle Routen liegen unter dem bestehenden geschützten Dashboard-Scope und verwenden paginierte, begrenzte Antworten.

### Read

```text
GET /trading/overview
GET /trading/candidates
GET /trading/candidates/:id
GET /trading/risk-assessments
GET /trading/risk-assessments/:id
GET /trading/orders
GET /trading/orders/:id
GET /trading/positions?status=open|closed
GET /trading/positions/:id
GET /trading/portfolios/:id
GET /trading/portfolios/:id/snapshots
GET /trading/strategies
GET /trading/performance
GET /trading/risk-events
GET /trading/sessions
GET /trading/audit
```

Filter: begrenztes `limit`/`offset`, UTC-`from/to`, Status, Asset, `direction`, StrategyVersion und Severity. Candidate-, Order-, Fill- und Positionlisten unterstützen Short-Filter und Paginierung. DTOs nutzen Decimalstrings und ISO-UTC-Zeiten; `exchangePosition=false` ist serverseitig fest und bei Short kommt `syntheticShadowShort=true` hinzu.

### Mutationen

```text
POST /trading/sessions/:id/activate-shadow
POST /trading/sessions/:id/pause
POST /trading/sessions/:id/kill
POST /trading/sessions/:id/resolve-to-stopped
POST /trading/orders/:id/cancel
POST /trading/positions/:id/request-risk-close
POST /trading/risk-events/:id/acknowledge
POST /trading/operations/set-assignment
```

Kein Endpoint heißt oder akzeptiert `live`, `execute`, `exchange`, Futures oder Leverage. Jede Mutation verlangt:

- bestehende Adminauthentifizierung;
- `Idempotency-Key` und Request-Hash;
- erwartete `version` im Body (`409` bei Konflikt);
- serverseitig erlaubte Transition;
- Reason Code, bei Kill/Risk Close zusätzlich Bestätigungstext;
- fachliches `TradingAuditEvent` in derselben Transaktion und optional bestehendes `AuditLog` nach Commit;
- API-Featureflag standardmäßig aus.

Die API führt keine Strategie-, Risk- oder Fillberechnung aus.

`set-assignment` ruft ausschließlich den gemeinsamen sicheren Operations-Service auf. Er verlangt Operator, eindeutigen Idempotency-Key, erwartete Assignment-Version und den exakten dynamischen Bestätigungstext. Es gibt keine direkte Statusmutation aus Route oder UI. Long- und Short-Assignments für BTCUSDT/ETHUSDT werden einzeln bedient und bleiben nach Setup standardmäßig deaktiviert.

## Kill-Switch-UX

- Status ist auf jeder Trading-Seite sichtbar, nicht nur unter Sessions.
- `Kill` ist deutlich, erfordert Bestätigung, aber keine unnötige mehrstufige Verzögerung.
- Kill-Dialog erklärt: neue Entries blockiert, wartende Entries werden gecancelt, bestehende Stops/Exits bleiben aktiv; keine automatische Sofortliquidation.
- `Resolve to stopped` ist eine getrennte Aktion und nur nach erfolgreichem Reconcile verfügbar.
- `Activate shadow` ist nochmals getrennt, zeigt alle Guards und scheitert fail-closed.
- Das UI bietet keinen Bypass von Critical Events oder Risk Rules.

## Operations und Observability

### Health-/Readiness

Der Trading Worker erhält getrennte Checks/Metriken:

- Prozess alive;
- DB erreichbar;
- letzter Scheduler-Heartbeat;
- Alter letzter erfolgreicher Candidate/Risk/Simulation/Reconcile-Lauf;
- Claim-/Job-Backlog und ältester Datensatz;
- Session-/Killstatus;
- letzter verarbeiteter Candle je Assignment/Position;
- offene Orders ohne Reserve, Positionen ohne ExitPlan, Ledger-/Cache-Differenzen;
- Anzahl Risk Events nach Severity;
- keine Exchange-Capability kompiliert/geladen.

Readiness für neue Entries ist strenger als Liveness. Eine nicht entry-bereite Instanz darf bestehende Positionen trotzdem weiter monitoren, wenn DB und Daten valide sind.

### BotRun, BotLog und Alerts

- Jeder geplante Trading-Job erzeugt einen `BotRun` mit jobName, Scope-/Correlation-ID und aggregierter Statistik.
- `BotLog` ist Diagnose, nicht Audit. Keine Candidate-Gesamtsnapshots, Authdaten oder potenzielle Secrets loggen.
- Critical `RiskEvent`, Kill/ERROR_LOCKED, stale Position Monitor und Reconciliationfehler sollen über den vorhandenen Alert-Pfad benachrichtigt werden.
- Alertversand nach Commit. Bis eine Outbox existiert, ist Dashboard/RiskEvent die verlässliche Wahrheit und Alert `FAILED` sichtbar.

### Deployment

Shadow v1 ergänzt später einen separaten `trading-worker`-Service:

- genau eine Replik bis DB-Lease-/Failover-Tests bestanden sind;
- nicht privilegierter Containeruser;
- keine Exchange-Secret-Variablen oder ausgehende Exchange-Domain-Allowlist;
- nur DB-Zugriff; falls bestehende Read-Provider indirekt nötig wären, zunächst vermeiden und aus persistierten Candles lesen;
- graceful shutdown: neue Claims stoppen, aktive DB-Transaktion beenden/rollbacken, Claims auslaufen lassen, Prisma disconnect;
- Migrationsdeployment vor App-Rollout, Jobs/Mutationen/Assignments weiterhin deaktiviert.

Redis ist für v1 keine Voraussetzung. PostgreSQL-Advisory-Locks plus Unique Constraints/Claims sind ausreichend und reduzieren neue Operationskomplexität.

## Betriebsablauf der Shadow-Freigabe

1. Schema/Pakete/API read-only ausrollen, alle Flags aus, Session `STOPPED`/Kill=true.
2. Seed/Setup von Portfolio, immutable StrategyVersion, RiskLimitSet und belegten BTC-/ETH-Execution-Profilen; Assignments disabled.
3. Reconcile/Recovery im read-only/dry-run-Modus über Fixtures und Produktionskopie ohne Secrets prüfen.
4. Trading Worker mit Masterflag aus deployen; Health/keine Exchange-Capability nachweisen.
5. Read-Dashboard freigeben.
6. Ein BTC-Assignment aktivieren, Session weiter STOPPED; Guard-Bericht prüfen.
7. Shadow-Jobs einzeln Candidate -> Risk -> Simulation -> Snapshot aktivieren.
8. Session explizit auf `SHADOW_ACTIVE`; zunächst BTC, später ETH nach Abnahme.
9. Mindestens 30 Kalendertage und die in `12-test-and-acceptance-plan.md` geforderte Stichprobe beobachten.

## Runbooks

### Daily loss / loss streak

Kill automatisch engagieren, wartende Entries canceln, Positionen weiter managen, Risk Event benachrichtigen. Vor dem nächsten UTC-Tag kein Auto-Reset. Admin prüft P&L/Ledger und resolved auf STOPPED; neue Aktivierung separat.

### Stale data

Neue Candidates/Entries blockieren. Bei offenen Positionen letzte valide ExitPlan-Schwellen nicht verändern. Kann keine neue Candle sicher ausgewertet werden: CRITICAL Alert; kein erfundener Preis. Nach Datenreparatur zuerst Gap-Audit und Reconcile, dann weiter.

### Inkonsistentes Portfolio

Sofort `ERROR_LOCKED`, Entry-Orders canceln soweit intern sicher, keine Cache-Reparatur aus UI. Ledger/Fills/Events replayen, Ursache dokumentieren, gegebenenfalls explizites Correction Event nach Review.

### Worker-Restart

Session bleibt nicht automatisch entry-bereit. Startup-Reconcile, abgelaufene Claims, Cursor und letzte Candles prüfen. Erst bei Erfolg kann eine zuvor aktive Session intern wieder entry-bereit markiert werden; bei Zweifel `PAUSED/ERROR_LOCKED`.

## Rollback-Prinzip

App-Rollback bedeutet Flags aus/Session killen und auf die vorherige Applikationsversion zurückrollen. Additive Tabellen bleiben bestehen. Keine Migration darf beim Rollback Shadow-Historie löschen. Offene Shadow-Positionen werden entweder bis zum normalen simulierten Exit durch eine kompatible Monitorversion verwaltet oder vor Versionsrollback explizit risikoreduzierend simuliert geschlossen und auditiert.

Der Audit-/Incident-Drilldown verfolgt die vollständige Kette `Candidate -> Risk -> Order -> Fill -> Position -> Exit/ExitPlan -> Ledger -> Performance`. Sensitive Keys, Tokens, URLs, Authfelder und übergroße Payloads werden serverseitig bereinigt, bevor die Response SignalPilot verlässt.

Performance wird serverseitig nach Direction, StrategyVersion, Asset, Entry-Regime und Exitgrund segmentiert. Win Rate, Profit Factor, Expectancy, Fees, R-Multiple, Drawdown sowie MAE/MFE verwenden für Short das Short-P&L und die entgegengesetzte adverse/favorable Preisrichtung. Exposure- und Risk-Auswertungen aggregieren beide Richtungen brutto und bieten keinen Netting-Vorteil.
