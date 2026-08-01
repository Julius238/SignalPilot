# 02 – Shadow-Trading-Zielarchitektur

## Architekturziel

Shadow v1 ist ein vollständig internes, DB-zentriertes System. Es liest reale, bereits persistierte Marktdaten und Analyseergebnisse, schreibt jedoch ausschließlich neue Shadow-Domänenobjekte. Es kennt weder Exchange-Credentials noch einen Netzwerkport für Orderausführung.

```text
bestehende Analyse-DB (read only aus Trading-Sicht)
  Asset, Candle, CandleDataQuality, Signal, SignalOutput,
  RadarEvent, NewsItem, MarketEvent, MarketRegimeSnapshot, Discovery
                         |
                         v
apps/trading-worker -> Input-Assembler -> packages/strategy-engine
                         |                        |
                         |                  CandidateDraft
                         v                        v
                packages/risk-engine -> TradeDecision
                         |                        |
                         v                        v
             packages/trading-simulation -> ShadowFill
                         |                        |
                         +------ packages/portfolio
                                      |
                                      v
                    neue Trading-Tabellen + TradingAuditEvent
                              /                 \
                       apps/api             apps/dashboard
```

## Module und Verantwortlichkeiten

| Modul | Verantwortlich | Darf nicht |
| --- | --- | --- |
| `packages/trading-domain` | Geld-/Mengenwerte, Enums, Aggregate-IDs, Events, Transition Guards, fachliche Fehler und Ports | Prisma, Netzwerk, `process.env`, Systemuhr oder Scheduler importieren |
| `packages/strategy-engine` | reine Auswertung eines vollständigen `StrategyInputSnapshot`; Candidate-Entwurf und Reason Codes | DB lesen/schreiben, Positionsgröße endgültig freigeben, LLM nutzen |
| `packages/risk-engine` | alle deterministischen Pre-Trade-Regeln; Assessment und Rule Results | Order/Position persistieren, Daten nachladen, stillschweigende Defaults verwenden |
| `packages/trading-simulation` | Market-Order-, Fill-, Fee-, Spread-/Slippage-, Partial-Fill- und Exit-Ereignisse aus Candles | Provider/Exchange anrufen, Portfolio direkt mutieren, Zufall ohne gespeicherten Seed verwenden |
| `packages/portfolio` | Ledger-Buchungen, Cash/Reserve/Exposure/P&L, Snapshots und Invarianten | Strategie entscheiden, Orders erzeugen oder DB-Transaktionen besitzen |
| `apps/trading-worker` | Daten assemblieren, Jobs claimen, reine Engines aufrufen, Transaktionen/Recovery/Audit orchestrieren | Exchange-SDK/Adapter importieren oder unversionierte Entscheidungen erzeugen |
| `apps/api` | geschützte Trading-Queries und streng auditierte Session-/Kill-Switch-Kommandos | Strategie/Risiko/Fill im Requestprozess berechnen oder Status frei setzen |
| `apps/dashboard` | read-only Übersicht plus bestätigungspflichtige Session-/Kill-Switch-Aktionen | fachliche Berechnungen duplizieren oder Live-Modus anbieten |

Abhängigkeitsrichtung:

```text
trading-domain
  <- strategy-engine
  <- risk-engine
  <- trading-simulation
  <- portfolio
       ^
       |
apps/trading-worker -> packages/database + bestehende Read-Pakete
apps/api            -> packages/database + trading-domain DTO-Mapping
apps/dashboard      -> API-Verträge, niemals Datenbankpaket
```

Die vier Engine-Pakete dürfen einander nur über `trading-domain`-Verträge koppeln. `portfolio` verarbeitet bestätigte Domain Events, nicht intern rekonstruierte Strategieannahmen.

## Datenfluss v1

1. Ein neuer, geschlossener 1h-Anker-Candle ist die kleinste Entscheidungseinheit.
2. Der Trading Worker lädt die explizit aktivierte `StrategyAssignment`, die angegebene `StrategyVersion`, Candle-Historien und referenzierte Analysequellen mit jeweiligem `asOf`.
3. Der Assembler validiert Vollständigkeit/Freshness und erzeugt einen kanonisch serialisierten, gehashten Input-Snapshot.
4. Die Strategy Engine liefert entweder `NO_CANDIDATE` mit Gründen oder einen `CandidateDraft`. Kandidat und normalisierte Evidenzen werden atomar persistiert.
5. Die Risk Engine erhält Kandidat, Portfolio-/Loss-/Exposure-Snapshot, aktives `RiskLimitSet`, Execution Profile und Sessionstatus. Sämtliche Regeln – auch PASS – werden gespeichert.
6. Bei Freigabe entstehen `TradeDecision`, `ShadowOrder` und Cash-Reservierung in einer Transaktion. Bei Ablehnung endet der Kandidat ohne Order.
7. Die Simulation prüft ab der nächsten zulässigen Candle Orderfills. Fill, Orderzustand, Position/PositionEvent, Ledger und Audit werden atomar geschrieben.
8. Der Position-Monitor verarbeitet jede neue geschlossene 1h-Candle genau einmal; Stop, Take Profit und Time Exit werden konservativ simuliert.
9. Snapshot-/Performance-Projektionen werden aus Ledger, Fills und Positionen aufgebaut. Sie sind reparierbare Projektionen, nicht die primäre Wahrheit.

## Prozessgrenzen

- `apps/worker` bleibt Eigentümer bestehender Analysepipelines und schreibt keine Trading-Tabellen.
- `apps/trading-worker` ist ein separates Deployment und einziger automatischer Writer der Shadow-Workflowtabellen. Zunächst exakt eine Replik.
- `apps/api` darf nur explizite Admin-Kommandos für Sessions/Kill Switch/Assignments schreiben; jede Mutation benötigt Auth, CSRF-taugliche bestehende Cookie-Mechanik, Idempotency-Key und synchrone Auditpersistenz.
- Dashboard ist kein fachlicher Writer.
- PostgreSQL ist in v1 Queue, Lock- und Wahrheitssystem. Redis wird nicht neu vorausgesetzt.
- Ein Exchange-Adapter oder `execution-service` wird weder als Stub noch Interfaceimplementierung angelegt. Ein abstrakter Adapter-Port wird erst mit der Demo-Phase spezifiziert.

## Jobs und Zeitmodell

Alle fachlichen Zeiten sind UTC. Scheduler-Zeitzone und Tageslimits sind UTC, unabhängig von Host oder Dashboard-Zeitzone.

| Job | Takt/Trigger | Aufgabe | Cursor/Idempotenz |
| --- | --- | --- | --- |
| `trading:candidate-scan` | nach erwartetem 1h-Close plus 5 Minuten, stündlich | aktive Assignments und neue Anker-Candles auswerten | `assignmentId + strategyVersionId + assetId + candleId` |
| `trading:risk-decide` | jede Minute | `READY_FOR_RISK` claimen und vollständig bewerten | `candidateId + riskLimitSetId + candidate.inputHash` |
| `trading:simulate-entry` | nach jedem neuen geschlossenen 1h-Candle | wartende Market Orders füllen/teilfüllen/ablaufen lassen | `orderId + candleId + sequence` |
| `trading:monitor-positions` | nach jedem neuen geschlossenen 1h-Candle | Stop/TP/Max-Hold/Invalidierung | `positionId + candleId + exitPlan.version` |
| `trading:portfolio-snapshot` | nach jedem Ledger-Ereignis plus täglich 00:05 | Equity/Drawdown-Projektion | `portfolioId + asOf + sourceLedgerSequence` |
| `trading:reconcile` | beim Start und alle 5 Minuten | Aggregate gegen Ledger/Constraints prüfen, Claims zurückholen | persistierter Cursor und Reconciliation-Run-ID |
| `trading:performance-rollup` | täglich 00:15 | Shadow-only Kennzahlen pro Strategieversion | `strategyVersionId + portfolioId + window + asOf` |

Ein jobeigener PostgreSQL-Advisory-Lock verhindert Parallelstarts. Fachliche Eindeutigkeiten bleiben trotzdem zwingend, weil Locks bei Prozessabbruch verschwinden. Aktive Arbeit wird zusätzlich per Claim (`claimedBy`, `claimedAt`, `claimExpiresAt`) oder atomarem Statuswechsel übernommen; abgelaufene Claims dürfen nach Reconciliation erneut verarbeitet werden.

## Transaktionsgrenzen

Folgende Gruppen sind jeweils eine DB-Transaktion; Geldtransaktionen verwenden mindestens `Serializable` oder explizite Row Locks plus `version`-Compare-and-swap:

1. `TradeCandidate` + alle `TradeCandidateEvidence` + Candidate-Audit.
2. `RiskAssessment` + alle `RiskRuleResult` + `TradeDecision` + Candidate-Übergang.
3. Freigabe: Decision + `ShadowOrder` + Portfolio-Reserve-Ledger + Order-/Portfolio-Audit. Ist Reservierung nicht möglich, wird nicht freigegeben.
4. Entry Fill: `ShadowFill` + Orderstatus + Position/PositionEvent + Cash-/Reserve-Ledger + Audit.
5. Exit Fill: `ShadowFill` + Order/Position/Event + Cash/P&L/Fee-Ledger + ExitPlan + Audit.
6. Kill-Switch-Änderung: Sessionstatus + Kill-Metadaten + Audit; das Canceln offener Entry-Orders erfolgt idempotent im Folgeschritt je Order.
7. Reconciliation-Fund: `RiskEvent` + Session `ERROR_LOCKED` + Audit atomar.

`BotRun`/`BotLog` bleiben Betriebsbeobachtung außerhalb dieser fachlichen Atomizität. Externe Alerts werden erst nach Commit versandt und dürfen den fachlichen Commit nicht zurückrollen; für verlässliche Benachrichtigungen ist später ein Outbox-Paket vorgesehen.

## Idempotenz und Concurrency

- Jeder Erzeugungspfad besitzt einen fachlichen, per Unique Constraint erzwungenen Schlüssel; HTTP-Kommandos erhalten zusätzlich einen `Idempotency-Key` mit Request-Hash.
- Statuswechsel erfolgen als `UPDATE ... WHERE id = ? AND status = expected AND version = expectedVersion`. Betroffene Zeilenanzahl `0` bedeutet Concurrent Update, kein Retry mit blindem Überschreiben.
- Geldwerte werden als Decimal/String an Paketgrenzen übertragen; JavaScript-Float ist für Persistenz, Mengen- oder Risikorechnung unzulässig.
- JSON-Snapshots werden kanonisch serialisiert und gehasht. Ein Retry mit gleichem Schlüssel, aber anderem Input-Hash erzeugt einen Critical Risk Event.
- Keine fachliche Aktion verlässt sich allein auf `node-cron`-In-Memory-Flags.

## Wiederaufnahme nach Prozessabbruch

Beim Start bleibt die Session zunächst gestoppt, bis `trading:reconcile` erfolgreich war. Reconciliation prüft mindestens:

- Ledger-Summe gegen Portfolio-Caches und Reserven;
- Orders ohne passende Reservierung, überreservierte Orders und Reservationsleaks;
- Fills ohne Position/Event/Ledger sowie doppelte Fill-Schlüssel;
- offene Positionen ohne aktiven ExitPlan;
- terminale Kandidaten mit nichtterminalen Entry-Orders;
- pro Position die nächste Event-Sequenz und zuletzt verarbeitete Candle;
- maximale Exposure/Positionszahl und negative Cash-Invarianten;
- abgelaufene Claims.

Reparierbare Projektionen dürfen aus Ledger/Fills neu aufgebaut werden und erhalten ein Audit. Unklare Geld- oder Aggregatdifferenzen werden niemals automatisch „zurechtgerechnet“: `ERROR_LOCKED`, Critical `RiskEvent`, neue Entries blockiert, Monitoring und risikoreduzierende Schließungen bleiben erlaubt.

## Auditierbarkeit

`TradingAuditEvent` ist append-only und fachlich atomar. Pflichtfelder: Eventtyp, Aggregattyp/-ID, vorheriger/nachheriger Zustand, Reason Code, Actor (`SYSTEM`, `ADMIN`, `RECOVERY`), Correlation-/Causation-/Idempotency-ID, Engine-/Codeversion, Input-/Output-Hashes und UTC-Zeit. Geheimnisse, Tokens, vollständige Authheader und rohe Providerantworten sind verboten. Bestehendes `AuditLog` kann Adminaktionen zusätzlich spiegeln, ist aber nicht die Trading-Wahrheit.

## Feature-Flags und sichere Defaults

| Schicht | Standard | Regel |
| --- | --- | --- |
| Build | kein Adapter/keine Exchange-Abhängigkeit | Shadow v1 kann technisch keine Order senden |
| `ENABLE_LIVE_TRADING` | nicht gesetzt oder `false` | `true` beendet API, bisherigen Worker und Trading Worker |
| `TRADING_MODE` | `DISABLED` | erlaubte Werte in v1 ausschließlich `DISABLED`, `SHADOW`; unbekannt = Startabbruch |
| `TRADING_SHADOW_ENABLED` | `false` | Master-Flag für automatisierte Shadow-Jobs |
| Jobflags | jeweils `false` | Candidate, Risk, Simulation, Snapshot getrennt aktivieren |
| `STRATEGY_V1_ENABLED` | `false` | aktiviert keine Zuweisung automatisch |
| DB-Session | `STOPPED`, `killSwitchEngaged=true` | explizite, auditierte Aktivierung erforderlich |
| StrategyAssignment | `enabled=false` | nur BTCUSDT/ETHUSDT nach manueller Freigabe |
| API-Mutationen | `false` | read-only UI kann vorher ausgerollt werden |

Aktivierung benötigt alle Schichten gleichzeitig. Das Deaktivieren einer beliebigen Schicht blockiert neue Kandidaten, Freigaben, Reservierungen und Entries. Position-Monitoring, Reconciliation, Canceln unfilled Entry-Orders und risikoreduzierende Exits laufen weiter.

## Kein Execution Service in v1

Ein Execution Service würde eine Sicherheitsgrenze und Schnittstellen für externe Seiteneffekte vorwegnehmen, obwohl Shadow v1 ausschließlich DB-/Candle-Simulation benötigt. Seine Einführung würde Credential-, Netzwerk-, Retry- und Reconciliation-Risiken ohne v1-Nutzen erzeugen. Deshalb liegt Simulation bewusst als reine Domainbibliothek hinter dem Trading Worker. Siehe ADR 0006.
