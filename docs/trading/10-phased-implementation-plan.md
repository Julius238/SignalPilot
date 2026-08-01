# 10 – Phasenplan für Claude

## Ausführungsregeln

- Pakete strikt nacheinander, kein Sammel-PR; nach jedem Paket unabhängige Codex-Prüfung.
- Claude liest vor Beginn alle Dokumente und akzeptierten ADRs unter `docs/trading`. Abweichungen werden vor Codeänderung als ADR vorgeschlagen, nicht still entschieden.
- Kein Paket außer P10 darf Exchange-Abhängigkeiten, Credentials, Ordernetzwerkzugriffe oder einen `LIVE`-Modus enthalten.
- Migrationen sind additiv. Legacy-Paper-Tabellen bleiben unangetastet.
- Flags, Assignments und Sessions bleiben nach Deployment aus/gestoppt.

## P1 – Shadow-Trading-Domänenmodell

### Ziel, Scope und Nicht-Scope

Reine Domainverträge, Zustandsmaschinen und additive Prisma-Persistenz schaffen. Scope: `trading-domain`, alle Modelle aus Dokument 03, Decimal-/Hash-/Transition-Guards und DB-Constraints. Nicht-Scope: Strategy, Risk, Simulation, Jobs, API/UI, aktive Seed-Daten sowie jede Änderung/Migration der vier vorhandenen Paper-Modelle.

### Dateien

Neu:

```text
packages/trading-domain/package.json
packages/trading-domain/tsconfig.json
packages/trading-domain/src/index.ts
packages/trading-domain/src/types.ts
packages/trading-domain/src/decimal.ts
packages/trading-domain/src/state-machines.ts
packages/trading-domain/src/idempotency.ts
packages/trading-domain/src/canonical-json.ts
packages/trading-domain/test/decimal.test.ts
packages/trading-domain/test/state-machines.test.ts
packages/trading-domain/test/idempotency.test.ts
packages/database/prisma/migrations/20260802090000_add_shadow_trading_domain/migration.sql
packages/database/test/shadow-trading-schema.test.ts
```

Ändern:

```text
packages/database/prisma/schema.prisma
packages/database/src/runtime-values.ts
packages/database/src/types.ts
packages/database/test/esm-exports.test.ts
pnpm-lock.yaml
```

### Modelle, Schnittstellen und Zustände

Alle Felder/Constraints aus Dokument 03 für `Strategy`, `StrategyVersion`, `StrategyAssignment`, `TradeCandidate`, `TradeCandidateEvidence`, `TradeDecision`, `RiskAssessment`, `RiskRuleResult`, `InstrumentExecutionProfile`, `ShadowOrder`, `ShadowFill`, `ShadowPosition`, `ShadowPositionEvent`, `ExitPlan`, `Portfolio`, `PortfolioLedgerEntry`, `PortfolioSnapshot`, `RiskLimitSet`, `RiskEvent`, `TradingSession`, `StrategyPerformance`, `TradingAuditEvent`, `TradingJobCursor`. Decimal(30,12), UTC, `version`, Hash-/Idempotenzfelder, Restrict-Deletes und Unique Constraints sind verbindlich.

Exports: Status-/Reason-Typen, `assertCandidateTransition`, `assertOrderTransition`, `assertPositionTransition`, `assertSessionTransition`, `DecimalValue`, `canonicalHash`. Übergänge exakt Dokument 04.

### Transaktionen, Flags, Tests und Abnahme

Noch keine Runtime-Transaktion/Flags/Producer. Tests: jede erlaubte/verbotene Transition, terminale Zustände, Decimal/Rundung ohne `number`, kanonischer Hash, Unique/FK/Restrict, Migration auf leerer DB und Fixture mit Legacy-Paperzeilen. Abnahme: Schema nur additiv, Build/Test grün, keine aktive Assignment/Session und kein ausführbarer Live-/Exchange-Modus.

### Rollback und Voraussetzung

Code rollbacken, leere additive Tabellen stehen lassen; kein destruktives Down. P2 erst nach geprüftem Schema/Exports/Guards.

## P2 – Strategy Engine v1

### Ziel, Scope und Nicht-Scope

`CRYPTO_MTF_BREAKOUT_V1` reproduzierbar aus vollständigem Snapshot auswerten. Scope: Inputvalidierung, gepinnte Indikatoren/Breakout, Entrybedingungen, Preisplan, Candidate-/No-Candidate-Reason Codes und Golden Fixtures. Nicht-Scope: DB/Worker, Sizing/Risk, Orders/Fills, LLM, Discovery-Autoassignment und Optimierung.

### Dateien

```text
packages/strategy-engine/package.json                         (neu)
packages/strategy-engine/tsconfig.json                        (neu)
packages/strategy-engine/src/index.ts                         (neu)
packages/strategy-engine/src/contracts.ts                     (neu)
packages/strategy-engine/src/validate-input.ts                (neu)
packages/strategy-engine/src/crypto-mtf-breakout-v1.ts        (neu)
packages/strategy-engine/src/indicators-v1.ts                 (neu)
packages/strategy-engine/src/reason-codes.ts                  (neu)
packages/strategy-engine/test/validate-input.test.ts          (neu)
packages/strategy-engine/test/crypto-mtf-breakout-v1.test.ts  (neu)
packages/strategy-engine/test/fixtures/btc-pass.json          (neu)
packages/strategy-engine/test/fixtures/eth-rejections.json    (neu)
packages/strategy-engine/test/golden.test.ts                  (neu)
pnpm-lock.yaml                                                 (ändern)
```

### Modelle, Schnittstellen und Zustände

`StrategyInputSnapshotV1` enthält alle Asset-, Version-, 250×1h/4h/1d-Candle-, DQ-, Signal-, MTF-, Regime-, News/Event/Radar- und Execution-Profilefelder aus Dokument 05. Output: `CANDIDATE` mit LONG/MARKET/referenceEntry/Stop/TP/RR/Anchor/Expiry/Evidence, `NO_CANDIDATE` oder `INVALID_INPUT`, jeweils Reason Codes und Hashes. Keine Persistenz; spätere Semantik `CANDIDATE -> CREATED`.

### Transaktionen, Flags, Tests und Abnahme

Keine DB/Env/Flags. Boundarytests jeder Bedingung, Breakoutfenster ohne C0, RSI/ATR, stale/missing/future/OHLC, keine Inputmutation, deterministische Golden Hashes und Vergleich gepinnter Indikatoren mit dem Bestand. Abnahme: bytegleicher Output, keine Prisma-/Worker-/Netzwerk-/LLM-Imports, nur BTC/ETH Spot-USDT Long.

### Rollback und Voraussetzung

Paketversion entfernen/zurückrollen, keine DB-Wirkung. P3 benötigt stabile Contracts/Golden Hashes.

## P3 – Risk Engine v1

### Ziel, Scope und Nicht-Scope

Alle 26 Regeln aus Dokument 06 deterministisch auswerten und eine konservative Menge liefern. Scope: Sizing, Exposure/Tagesverlust/Loss Streak, vollständige Rule Results und Session-Direktive. Nicht-Scope: DB-Orchestrierung, Sessionmutation, Orderanlage, Alerts, LLM/Overrides.

### Dateien

```text
packages/risk-engine/package.json                              (neu)
packages/risk-engine/tsconfig.json                             (neu)
packages/risk-engine/src/index.ts                              (neu)
packages/risk-engine/src/contracts.ts                          (neu)
packages/risk-engine/src/evaluate-risk.ts                      (neu)
packages/risk-engine/src/position-sizing.ts                    (neu)
packages/risk-engine/src/rules.ts                              (neu)
packages/risk-engine/src/reason-codes.ts                       (neu)
packages/risk-engine/test/rules.test.ts                        (neu)
packages/risk-engine/test/position-sizing.test.ts              (neu)
packages/risk-engine/test/golden.test.ts                       (neu)
packages/risk-engine/test/fixtures/pass-10000-usdt.json        (neu)
packages/risk-engine/test/fixtures/critical-cases.json         (neu)
pnpm-lock.yaml                                                  (ändern)
```

### Modelle, Schnittstellen und Zustände

`RiskAssessmentInputV1`: Candidate/Snapshot/Hashes, Portfolio/Ledger-Reconcile-State, Tagesanfang/Equity/P&L, Positionen/Orders/Reserven, Closed-Trade-Sequenz, Limitset, Execution Profile, Session/config capability. `RiskAssessmentOutputV1`: status, requested/approved qty, Risk/Cost/Exposure, geordnete Rule Results, `NONE|BLOCK_NEW|ENGAGE_KILL_SWITCH|ERROR_LOCK`, Hashes. Spätere Transition `READY_FOR_RISK -> APPROVED_FOR_SHADOW|RISK_REJECTED`.

### Transaktionen, Flags, Tests und Abnahme

Keine DB/Env. Tests aller Regel- und Goldenfälle plus Properties: Risiko nie >0,25 %, Cash/Exposures nie über Cap, Größe monoton bei sinkender Equity, gleicher Input gleicher Output, fehlender Pflichtinput nie PASS, 26 Resultate bei prüfbarem Input. Abnahme durch unabhängige Formelprüfung.

### Rollback und Voraussetzung

Paketrollback ohne DB-Wirkung. P4 erst nach Golden-/Property-Abnahme.

## P4 – Shadow Execution und Portfolio

### Ziel, Scope und Nicht-Scope

Reine Fill-/Exit-Simulation und replaybares Portfolio-Ledger. Scope: Market, adverse Kosten/Rundung, Instrumentminimum, Volumencap/Partial Fills, Gap/Stop-first, Reservation, Ledger, Position/P&L/Snapshot. Nicht-Scope: Limit, Provider/Exchange, DB-Transaktion, Scheduler, Funding/Steuer.

### Dateien

```text
packages/trading-simulation/package.json                      (neu)
packages/trading-simulation/tsconfig.json                     (neu)
packages/trading-simulation/src/index.ts                      (neu)
packages/trading-simulation/src/contracts.ts                  (neu)
packages/trading-simulation/src/market-fill-v1.ts             (neu)
packages/trading-simulation/src/exit-resolution-v1.ts         (neu)
packages/trading-simulation/src/rounding.ts                   (neu)
packages/trading-simulation/src/reason-codes.ts                (neu)
packages/trading-simulation/test/market-fill.test.ts           (neu)
packages/trading-simulation/test/intrabar-and-gap.test.ts      (neu)
packages/trading-simulation/test/partial-fill.test.ts          (neu)
packages/portfolio/package.json                               (neu)
packages/portfolio/tsconfig.json                              (neu)
packages/portfolio/src/index.ts                               (neu)
packages/portfolio/src/contracts.ts                           (neu)
packages/portfolio/src/ledger.ts                              (neu)
packages/portfolio/src/reservations.ts                        (neu)
packages/portfolio/src/positions.ts                           (neu)
packages/portfolio/src/valuation.ts                           (neu)
packages/portfolio/src/invariants.ts                          (neu)
packages/portfolio/test/ledger.test.ts                         (neu)
packages/portfolio/test/invariants.test.ts                     (neu)
packages/portfolio/test/replay.test.ts                         (neu)
pnpm-lock.yaml                                                 (ändern)
```

### Modelle, Schnittstellen und Zustände

`SimulateOrderInputV1`/`SimulatePositionInputV1` liefern Domain-Event-Drafts mit allen Fillfeldern aus Dokument 07. Portfolio exportiert `reserve`, `release`, `applyEntryFill`, `applyExitFill`, `markToMarket`, `replayLedger`, jeweils erwartete Sequenz/Decimalstrings. Transition-Drafts Dokument 04.

### Transaktionen, Flags, Tests und Abnahme

Noch reine Funktionen. Tests: Full/partial/no fill, Minima, BUY-up/SELL-down, Fee/Reserve/Release, same-candle Stop+TP -> Stop, Gaps, Entry+Exit gleiche Candle, Zwei-Candle-Expiry, Ledger Replay/Retry, keine negative Cash/Menge. Abnahme: Golden P&L-Brücke und adversarial Review.

### Rollback und Voraussetzung

Bibliotheksrollback. P5 erst nach Simulation-/Ledger-Abnahme.

## P5 – Trading Worker und Scheduler

### Ziel, Scope und Nicht-Scope

Engines sicher mit bestehender Read-DB und neuen Tabellen orchestrieren. Scope: separate App, Input Assembler, sieben Jobs, PostgreSQL-Locks/Claims, Transaktionen, Recovery/Reconcile, Audit, BotRun/BotLog, Startup-Safety, alle Flags aus. Nicht-Scope: Exchange/Netzwerkorders, Änderung bestehender Workerjobs, automatische Aktivierung, UI/API.

### Dateien

Neu:

```text
apps/trading-worker/package.json
apps/trading-worker/tsconfig.json
apps/trading-worker/Dockerfile
apps/trading-worker/src/index.ts
apps/trading-worker/src/config.ts
apps/trading-worker/src/safety.ts
apps/trading-worker/src/scheduler.ts
apps/trading-worker/src/lib/claims.ts
apps/trading-worker/src/lib/input-assembler.ts
apps/trading-worker/src/lib/idempotency.ts
apps/trading-worker/src/lib/transactions.ts
apps/trading-worker/src/lib/reconciliation.ts
apps/trading-worker/src/lib/trading-audit.ts
apps/trading-worker/src/jobs/create-candidates.ts
apps/trading-worker/src/jobs/decide-risk.ts
apps/trading-worker/src/jobs/simulate-entry.ts
apps/trading-worker/src/jobs/monitor-positions.ts
apps/trading-worker/src/jobs/snapshot-portfolio.ts
apps/trading-worker/src/jobs/reconcile-trading.ts
apps/trading-worker/src/jobs/rollup-performance.ts
apps/trading-worker/test/config-and-safety.test.ts
apps/trading-worker/test/candidate-idempotency.test.ts
apps/trading-worker/test/risk-transaction.test.ts
apps/trading-worker/test/fill-transaction.test.ts
apps/trading-worker/test/recovery.test.ts
apps/trading-worker/test/reconciliation.test.ts
apps/trading-worker/test/scheduler.test.ts
```

Ändern:

```text
package.json
pnpm-lock.yaml
docker-compose.yml
docker-compose.production.yml
.env.example
.env.production.example
docs/DEPLOYMENT.md
```

### Modelle, Schnittstellen, Zustände und Transaktionen

Liest bestehende Asset/Candle/DQ/Signal/Output/Rules/Regime/Radar/News/Event/Discovery nur; schreibt P1-Modelle. Methoden `persistCandidate`, `persistRiskDecision`, `acceptOrderAndReserve`, `applyEntryFill`, `applyExitFill`, `engageKillOrErrorLock`, `reconcilePortfolio`. Übergänge Dokument 04, Transaktionsgruppen Dokument 02.

### Flags, Tests und Abnahme

Defaults: `TRADING_MODE=DISABLED`, `TRADING_SHADOW_ENABLED=false`, vier Jobflags false, `STRATEGY_V1_ENABLED=false`; unknown oder `ENABLE_LIVE_TRADING=true` -> Startabbruch. Tests: Cross-process Lock, Claim-Ablauf, doppelte Schedules, Abbruch jeder Transaktionskante, Retry/Hashkonflikt/stale/Kill/Partial/Restart/Ledgerabweichung/shutdown sowie Negativtest auf Exchange-Abhängigkeit/URL/Env. Abnahme: alle Flags aus erzeugen keine Tradingobjekte; Testsession exakt einmal; keine Teilbuchung; Container non-root; bestehender Worker unverändert.

### Rollback und Voraussetzung

Masterflag aus/Kill, Worker stoppen, App rollback; Historie behalten. P6 erst nach Recovery-/Chaos-Abnahme und sauberem Reconcile.

## P6 – Trading API

### Ziel, Scope und Nicht-Scope

Geschützte, paginierte Read-API und minimale auditierte Operationskommandos. Scope: Routen/DTOs aus Dokument 08, Version/Idempotenz, Session/Kill/Cancel/Risk-Close/Acknowledge. Nicht-Scope: Exchange, freie Statusupdates, Strategyeditor, Portfolio-Correction, unbounded Export und fachliche Engineberechnung im Request.

### Dateien

```text
apps/api/src/routes/trading.ts                       (neu)
apps/api/src/lib/trading-idempotency.ts              (neu)
apps/api/test/trading-read.test.ts                   (neu)
apps/api/test/trading-commands.test.ts               (neu)
apps/api/test/trading-auth-and-safety.test.ts        (neu)
apps/api/src/server.ts                               (ändern)
apps/api/src/routes/health.ts                        (ändern)
apps/api/src/lib/safety.ts                           (ändern)
apps/api/package.json                                (ändern)
pnpm-lock.yaml                                        (ändern)
```

### Modelle, Schnittstellen, Zustände und Transaktionen

DTOs Decimalstring/ISO UTC, niemals Prismaobjekt direkt. Mutationen schreiben `TradingSession`, RiskEvent-Acknowledge, interne Cancel-/Risk-Close-Intents und `TradingAuditEvent`; bestehendes `AuditLog` optional nach Commit. Session/Kill/Audit, Cancel/Audit und Risk-Close/Audit jeweils atomar; Transitions Dokument 04.

### Flags, Tests und Abnahme

`TRADING_API_MUTATIONS_ENABLED=false`; Reads getrennt ausrollbar. Kill/risk-reducing bleibt trotz Entry-off erreichbar. Tests: Auth, Pagination/Filter/Decimal, 404/409, Idempotency/Hashkonflikt, verbotene Transition, synchrones Audit, keine Secretfelder. Abnahme: keine Route akzeptiert Live/Exchange/Futures/Leverage und keine Engine läuft in API.

### Rollback und Voraussetzung

Mutationsflag aus, API rollback; Worker/DB unabhängig. P7 nach stabilen DTOs.

## P7 – Trading Dashboard

### Ziel, Scope und Nicht-Scope

Shadow-Zustand im bestehenden Design vollständig sichtbar/sicher bedienbar machen. Scope: alle Seiten/Drilldowns Dokument 08, Navigation, Equity/Drawdown, Session/Kill, responsive/accessibility. Nicht-Scope: Client-Fachrechnung, Live/Key-UI, Strategyeditor, Portfolio-Korrektur.

### Dateien

Neu:

```text
apps/dashboard/src/app/dashboard/trading/page.tsx
apps/dashboard/src/app/dashboard/trading/candidates/page.tsx
apps/dashboard/src/app/dashboard/trading/candidates/[id]/page.tsx
apps/dashboard/src/app/dashboard/trading/risk/page.tsx
apps/dashboard/src/app/dashboard/trading/orders/page.tsx
apps/dashboard/src/app/dashboard/trading/orders/[id]/page.tsx
apps/dashboard/src/app/dashboard/trading/positions/page.tsx
apps/dashboard/src/app/dashboard/trading/positions/[id]/page.tsx
apps/dashboard/src/app/dashboard/trading/trades/page.tsx
apps/dashboard/src/app/dashboard/trading/portfolio/page.tsx
apps/dashboard/src/app/dashboard/trading/strategies/page.tsx
apps/dashboard/src/app/dashboard/trading/risk-events/page.tsx
apps/dashboard/src/app/dashboard/trading/sessions/page.tsx
apps/dashboard/src/app/dashboard/trading/audit/page.tsx
apps/dashboard/src/components/trading/shadow-banner.tsx
apps/dashboard/src/components/trading/trading-status-cards.tsx
apps/dashboard/src/components/trading/equity-chart.tsx
apps/dashboard/src/components/trading/session-controls.tsx
apps/dashboard/src/components/trading/risk-rule-table.tsx
apps/dashboard/src/components/trading/fill-price-bridge.tsx
apps/dashboard/test/trading-dashboard.test.ts
apps/dashboard/test/trading-controls.test.ts
```

Ändern:

```text
apps/dashboard/src/components/nav-bar.tsx
apps/dashboard/src/lib/signalpilot-api.ts
apps/dashboard/src/app/globals.css
apps/dashboard/test/dashboard-design.test.ts
```

### Modelle, Schnittstellen, Zustände und Transaktionen

Nutzt P6-DTOs. Controls bieten nur dokumentierte Session-/Order-/Risk-Transitions mit `expectedVersion`/Idempotency. Keine DB-Transaktion/Fachrechnung im UI.

### Flags, Tests und Abnahme

`TRADING_DASHBOARD_MUTATIONS_ENABLED=false`; Banner unabhängig. Tests: Banner überall, Unknown nicht 0, Kill keyboard/mobile, Bestätigung, keine Live-/Key-Controls, responsive Tabellen, API 409/stale, Paper/Shadow eindeutig getrennt. Abnahme per Design-/Accessibility-Review.

### Rollback und Voraussetzung

Controlsflag aus, Nav/Seiten rollback; API/Worker bleiben. P8 nach UI-Abnahme.

## P8 – Performance und Audit

### Ziel, Scope und Nicht-Scope

Reproduzierbare Shadow-Performance, Equity/Drawdown und Audit-Timeline. Scope: Berechnung nur aus Shadow-Fills/Positionen/Ledger, daily/30d/all-time, Auditquery, Risk Alerts nach Commit. Nicht-Scope: Paper Evaluation, Parameteroptimierung, Steuern/Export.

### Dateien

```text
packages/portfolio/src/performance.ts                              (neu)
packages/portfolio/test/performance.test.ts                        (neu)
apps/trading-worker/test/performance-rollup.test.ts                (neu)
apps/trading-worker/test/trading-audit.test.ts                     (neu)
apps/trading-worker/test/risk-alerts.test.ts                       (neu)
apps/api/test/trading-audit-read.test.ts                           (neu)
packages/portfolio/src/index.ts                                    (ändern)
apps/trading-worker/src/jobs/rollup-performance.ts                 (ändern)
apps/trading-worker/src/lib/trading-audit.ts                       (ändern)
apps/api/src/routes/trading.ts                                     (ändern)
apps/dashboard/src/app/dashboard/trading/portfolio/page.tsx        (ändern)
apps/dashboard/src/app/dashboard/trading/strategies/page.tsx       (ändern)
apps/dashboard/src/app/dashboard/trading/audit/page.tsx            (ändern)
```

### Modelle, Schnittstellen, Zustände und Transaktionen

Schreibt `PortfolioSnapshot`, `StrategyPerformance`, `TradingAuditEvent`; Felder Dokument 03, Source-Cursor/Inputhash Pflicht, Audit append-only. Rollup per Unique-Key idempotent, Snapshot an Ledgersequence, Alert nach fachlichem Commit. Keine neuen Zustände.

### Flags, Tests und Abnahme

Vorhandenes Snapshot-/Performancejobflag default false. Tests: Gross/Net/Fee/R/Profit Factor/Drawdown, Teilfills/Break-even/UTC, idempotenter Rollup, Projektion-Rebuild, Auditkorrelation und Negativtest auf `PaperSignalEvaluation` in Berechnungsqueries. Abnahme via Golden-Kennzahlen.

### Rollback und Voraussetzung

Rollup aus/Code rollback; Projektionen rebuildbar, Audit behalten. P9 nach Reconcile/Kennzahlenreview.

## P9 – Shadow-Testphase

### Ziel, Scope und Nicht-Scope

Sicherheit, Determinismus und Betriebsstabilität intern nachweisen. Scope: Readiness, Replay/Soak/Chaos, staged BTC dann ETH, Betriebsprotokoll. Nicht-Scope: Demo/Live, Strategyänderung im Messfenster, weitere Assets.

### Dateien

```text
apps/trading-worker/src/commands/shadow-readiness.ts          (neu)
apps/trading-worker/src/commands/replay-shadow-cycle.ts       (neu)
apps/trading-worker/test/end-to-end-shadow.test.ts            (neu)
apps/trading-worker/test/chaos-recovery.test.ts               (neu)
apps/trading-worker/test/soak-invariants.test.ts               (neu)
docs/trading/evidence/shadow-test-run-template.md             (neu)
apps/trading-worker/package.json                              (ändern)
docs/DEPLOYMENT.md                                            (ändern)
docs/trading/12-test-and-acceptance-plan.md                   (ändern)
```

### Modelle, Schnittstellen, Zustände und Transaktionen

Keine neuen Modelle. Setup erzeugt Portfolio/StrategyVersion/RiskLimitSet/Profile/Assignments/Session nach Dokument 03, alles auditieren. Erst BTC, dann ETH. Readiness aktiviert nichts; Transaktionen/Flags unverändert P5; Killtests monitoren Exposure weiter.

### Tests und Abnahme

Dokument 12: mindestens 60 Kalendertage, mindestens 50 geschlossene Positionen oder dokumentierte Verlängerung bei seltener Strategie, 0 ungeklärte Critical Events, 0 Invariantenverletzungen, Replay/Restart/DB-Timeout/Kill/Datenlücke bestanden und Netzwerkaudit ohne Exchangeverbindung.

### Rollback und Voraussetzung

Kill/Entryflags aus, Entries canceln, Positionen ausmonitoren/risikoreduzierend schließen, Worker stoppen, Historie behalten. P10 nur mit separatem Auftrag, Nutzerentscheidung, Codex-Review und grünen Legal-/Regional-/Provider-Gates.

## P10 – späterer Bitget-Demo-Adapter (separater Auftrag)

### Ziel, Scope und Nicht-Scope

Nach erneuter Freigabe genehmigte Intents ausschließlich in Bitget Demo spiegeln/reconciliieren. Scope: Demo-only Port, Secret Boundary, Outbox/Inbox, `clientOid`, REST+WS, Orders/Fills/Balance, Rate Limit/Circuit Breaker, Permission/Domain Self-check. Nicht-Scope: Live, Echtgeld, Futures/Margin/Hebel, Transfer/Withdrawal, UI-Keyeingabe, automatische Umschaltung.

Harte Voraussetzung: aktuelle Region/Terms/Entity/UTA/Demo schriftlich grün. Für Deutschland ist das nach Dokument 09 derzeit nicht erfüllt. Separate Demo-Keys nur Read+Spot Trade, keine Transfer-/Withdrawal-/Copy-/Futuresrechte, IP-Allowlist.

### Vorgesehene Dateien

```text
packages/exchange-adapter-domain/package.json
packages/exchange-adapter-domain/tsconfig.json
packages/exchange-adapter-domain/src/index.ts
packages/exchange-adapter-domain/src/contracts.ts
packages/bitget-demo-adapter/package.json
packages/bitget-demo-adapter/tsconfig.json
packages/bitget-demo-adapter/src/index.ts
packages/bitget-demo-adapter/src/config.ts
packages/bitget-demo-adapter/src/auth.ts
packages/bitget-demo-adapter/src/rest-client.ts
packages/bitget-demo-adapter/src/websocket-client.ts
packages/bitget-demo-adapter/src/mapper.ts
packages/bitget-demo-adapter/src/rate-limiter.ts
packages/bitget-demo-adapter/src/reconciliation.ts
packages/bitget-demo-adapter/test/contract.test.ts
packages/bitget-demo-adapter/test/unknown-outcome.test.ts
packages/bitget-demo-adapter/test/reconciliation.test.ts
apps/execution-worker/package.json
apps/execution-worker/tsconfig.json
apps/execution-worker/Dockerfile
apps/execution-worker/src/index.ts
apps/execution-worker/src/safety.ts
apps/execution-worker/src/scheduler.ts
apps/execution-worker/src/outbox.ts
apps/execution-worker/src/inbox.ts
apps/execution-worker/src/reconcile.ts
apps/execution-worker/test/safety.test.ts
packages/database/prisma/migrations/<approved_timestamp>_add_demo_execution/migration.sql
```

Erst dann ändern:

```text
packages/database/prisma/schema.prisma
packages/database/src/runtime-values.ts
packages/database/src/types.ts
package.json
pnpm-lock.yaml
docker-compose.yml
docker-compose.production.yml
.env.example
.env.production.example
docs/DEPLOYMENT.md
docs/trading/09-bitget-demo-adapter-analysis.md
```

### Modelle, Schnittstellen, Zustände und Transaktionen

Neue Folge-ADR definiert exakt `ExecutionIntent`, `ExecutionOutbox`, `ExchangeOrder`, `ExchangeFill`, `ExchangeAccountSnapshot`, `ExchangeReconciliationRun`, `ExchangeInboxEvent`, `CredentialAttestation` mit lokalen/Exchange-IDs, `clientOid`, Environment=`BITGET_DEMO`, unknown outcome, Payloadhash, Sequenz, Fees/Zeit. Kein Credential in DB. Outbox mit Intent committen, extern außerhalb Transaktion senden, Response/WS in idempotente Inbox, Reconcile löst unknown.

### Flags, Tests und Abnahme

`EXECUTION_MODE=DISABLED|BITGET_DEMO`, Default DISABLED; kein LIVE-Wert im Binary. Kill blockiert Create, erlaubt Query/Cancel/risk-reducing. Tests: Providercontract, Signatur ohne Secretlog, Permission/IP/Domain/`paptrading`-Attestation, Limits/Timeout/Duplicate/ACK-vs-Fill/Partial/WS-Gap/REST-Bootstrap/Reconcile/Retention/Kill/Restart. Abnahme: null Livehosts, Transfer-/Withdrawalrechte oder Futures.

### Rollback

Demo-Create aus/Kill, offene Demo-Orders canceln/reconciliieren, Worker stoppen, Key widerrufen, Inbox/Outbox/Audit behalten. Nie zu Live umschalten.

## Priorität

P1 Domäne -> P2 Strategy -> P3 Risk -> P4 Simulation/Portfolio -> P5 Worker -> P6 API -> P7 Dashboard -> P8 Performance/Audit -> P9 lange Shadow-Testphase -> P10 nur separat nach neuem Gate.
