# 03 – Domänenmodell

## Modellierungsregeln

- Neue Tabellen verwenden UUIDs/CUIDs entsprechend der bestehenden Prisma-Konvention; öffentliche IDs dürfen interne Sequenzen nicht offenlegen.
- Geld, Preis, Menge, Rate und P&L: `Decimal(30,12)`, nie `Float`. Prozentwerte werden als Dezimalrate gespeichert (`0.0025` = 0,25 %), Basispunkte als Integer nur in versionierten Ausführungsprofilen.
- Alle Zeitpunkte sind `DateTime` in UTC. Fachliches Datum für Tageslimits ist zusätzlich `tradingDateUtc`.
- Alle Aggregate mit Veränderung erhalten `version Int @default(0)`, `createdAt` und `updatedAt`.
- Historische Versionen, Evidenz, Fills, Ledger-, Position- und Audit-Events werden nicht aktualisiert oder gelöscht. Korrekturen erfolgen durch Gegen-/Folgeereignisse.
- Fremdschlüssel zu Analysequellen sind optional, weil Retention/Quelle variieren kann; der unveränderliche Snapshot plus Hash ist Pflicht.
- Löschverhalten für finanzielle Historie ist `Restrict`; kein Cascade-Delete von Portfolio, Strategieversion, Kandidat, Order, Fill, Position oder Audit.

## Aggregate und Tabellen

Die Feldnamen sind verbindliche Spezifikation für die spätere Prisma-Implementierung. Kleine Prisma-konforme Namensanpassungen sind nur zulässig, wenn sie in demselben Claude-Paket dokumentiert und von Codex geprüft werden.

### Strategy

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id` | ID | Primärschlüssel |
| `key` | String, unique | stabiler Maschinenname, z. B. `CRYPTO_MTF_BREAKOUT_V1` |
| `name` | String | Anzeigename |
| `description` | String | fachlicher Zweck |
| `status` | `DRAFT/ACTIVE/RETIRED` | Lifecycle der Strategiefamilie |
| `createdAt`, `updatedAt` | DateTime | Auditzeit |

Eine `Strategy` entscheidet nie selbst; nur eine immutable `StrategyVersion` ist ausführbar.

### StrategyVersion

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `strategyId` | ID/FK | Version und Familie |
| `version` | Int; unique mit `strategyId` | monoton steigend |
| `status` | `DRAFT/APPROVED/ACTIVE/RETIRED` | nur `ACTIVE` zuweisbar |
| `engineVersion` | String | Version der Engine-Semantik |
| `codeVersion` | String | Git-Commit oder unveränderlicher Build-Identifier |
| `parametersJson` | Json | vollständig expandierte Parameter, keine Env-Verweise |
| `specificationHash` | String | SHA-256 über kanonische Spezifikation/Parameter |
| `effectiveFrom`, `effectiveTo` | DateTime? | Gültigkeitsfenster |
| `createdBy`, `approvedBy` | String | Akteure, keine Secrets |
| `approvedAt`, `createdAt` | DateTime | Freigabe-/Anlagezeit |

Ab `APPROVED` sind Parameter/Hashes unveränderlich. Änderungen erzeugen eine neue Version.

### StrategyAssignment

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id` | ID | Primärschlüssel |
| `strategyVersionId`, `portfolioId`, `assetId` | FK | explizite Version, Portfolio und handelbares Asset |
| `timeframe` | String | v1 exakt `1h` |
| `enabled` | Boolean default false | zusätzlicher Freigabeschalter |
| `validFrom`, `validTo` | DateTime? | Aktivitätsfenster |
| `assignmentConfigJson` | Json | nur erlaubte assignment-spezifische Caps |
| `createdBy`, `createdAt`, `updatedAt` | String/DateTime | Audit |

Unique/Partial-Constraint: höchstens eine zeitlich aktive Zuweisung je Portfolio, Asset und Strategiefamilie. `Asset.isActive` oder Discovery-Mitgliedschaft ersetzt diese Zuweisung nicht.

### TradeCandidate

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id` | ID | Primärschlüssel |
| `candidateKey` | String, unique | Assignment/Version/Asset/Anker-Candle |
| `strategyAssignmentId`, `strategyVersionId`, `portfolioId`, `assetId` | FK | vollständige Herkunft |
| `anchorCandleId` | FK Candle | geschlossene 1h-Entscheidungskerze |
| `anchorSignalId` | FK Signal? | primäres Signal, falls vorhanden |
| `direction` | `LONG` | v1 ausschließlich Long |
| `entryType` | `MARKET` | v1 ausschließlich Market |
| `status` | CandidateStatus | siehe Zustandsmaschine |
| `referenceEntryPrice`, `stopPrice`, `takeProfitPrice` | Decimal | Strategy-Entwurf vor tatsächlichem Fill |
| `minimumRewardRisk` | Decimal | geforderter Mindestwert |
| `dataAsOf`, `decisionTime`, `expiresAt` | DateTime | Daten-/Lebenszeitgrenze |
| `inputSnapshotJson`, `inputHash` | Json/String | kompletter kanonischer Input und SHA-256 |
| `strategyReasonCodes` | Json | sortierte maschinenlesbare Gründe |
| `invalidReasonCode`, `cancelReasonCode` | String? | terminale Erklärung |
| `claimedBy`, `claimedAt`, `claimExpiresAt` | String?/DateTime? | Worker-Recovery |
| `version`, `createdAt`, `updatedAt` | Int/DateTime | Concurrency/Audit |

Unique: `(strategyAssignmentId, strategyVersionId, assetId, anchorCandleId)`. Ein gleicher Key mit anderem Hash ist ein Critical Risk Event.

### TradeCandidateEvidence

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `tradeCandidateId` | ID/FK | Evidenz und Kandidat |
| `type` | `CANDLE/SIGNAL/MTF/REGIME/DATA_QUALITY/RADAR/NEWS/EVENT/DISCOVERY/EXECUTION_PROFILE` | Quellklasse |
| `sourceType`, `sourceId` | String/String? | Tabellen-/Providerreferenz |
| `observedAt`, `capturedAt` | DateTime | fachlicher Quellzeitpunkt und Snapshotzeit |
| `required` | Boolean | Fehlen blockiert, wenn true |
| `payloadJson`, `payloadHash` | Json/String | minimale reproduzierbare Evidenz |

Unique: `(tradeCandidateId, type, sourceType, sourceId)`; bei nullbarer Source muss ein deterministischer Ersatzschlüssel verwendet werden.

### TradeDecision

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `tradeCandidateId`, `riskAssessmentId` | ID/FK; Candidate unique | finale Pre-Trade-Entscheidung |
| `decisionKey` | String, unique | idempotenter Schlüssel |
| `outcome` | `APPROVE_SHADOW/REJECT/EXPIRE/CANCEL/ERROR` | Entscheidung |
| `reasonCode` | String | primärer stabiler Code |
| `inputHash`, `outputHash` | String | Reproduzierbarkeit |
| `decidedAt` | DateTime | UTC |

V1 erlaubt genau eine finale Decision pro Kandidat. Eine spätere Neubewertung braucht einen neuen Kandidaten, nicht das Umschreiben der Entscheidung.

### RiskAssessment

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `tradeCandidateId`, `portfolioId`, `riskLimitSetId` | ID/FK | Scope |
| `assessmentKey` | String, unique | Candidate + Limits + Input-Hash |
| `status` | `PASS/FAIL/ERROR` | Gesamtergebnis |
| `ruleSetVersion` | String | Engine-/Regelversion |
| `equity`, `availableCash`, `reservedCash`, `dailyPnl` | Decimal | verwendeter Portfoliozustand |
| `openPositionCount`, `newTradesToday`, `consecutiveLosses` | Int | verwendete Zähler |
| `grossExposure`, `assetExposure`, `correlatedExposure` | Decimal | Post-Trade-Szenario |
| `requestedQuantity`, `approvedQuantity`, `riskAmount` | Decimal | Sizing-Ergebnis |
| `portfolioSnapshotAsOf`, `marketDataAsOf` | DateTime | Freshness |
| `inputsJson`, `inputHash`, `outputHash` | Json/String | vollständiger Prüfkontext |
| `assessedAt`, `createdAt` | DateTime | Audit |

### RiskRuleResult

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `riskAssessmentId` | ID/FK | Ergebniszuordnung |
| `ruleCode`, `ruleVersion` | String | stabiler Code und Semantik |
| `outcome` | `PASS/FAIL/WARN/ERROR` | Einzelergebnis |
| `severity` | `INFO/WARNING/BLOCKER/CRITICAL` | Reaktion |
| `reasonCode`, `message` | String | maschinenlesbar + sichere Anzeige |
| `actualValue`, `limitValue`, `unit` | Decimal?/String | direkte Vergleichswerte, sofern skalar |
| `inputJson` | Json | regelminimaler Input, ohne Secrets |
| `evaluatedAt` | DateTime | UTC |

Unique: `(riskAssessmentId, ruleCode)`. Auch PASS-Ergebnisse werden gespeichert.

### InstrumentExecutionProfile (zusätzlich erforderlich)

Das vorhandene Asset-Modell enthält nicht alle nachweisbaren Ausführungsfilter. Deshalb wird ein versioniertes Profil benötigt.

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `assetId` | ID/FK | Instrument |
| `version`, `status` | Int; `DRAFT/ACTIVE/RETIRED` | immutable Version |
| `tickSize`, `stepSize`, `minQuantity`, `minNotional` | Decimal | Quantisierung/Minimum |
| `feeBps`, `fullSpreadBps`, `slippageBps`, `maxParticipationRate` | Int/Decimal | konservative Simulationsparameter |
| `source`, `sourceObservedAt` | String/DateTime | belegte Herkunft |
| `specificationHash`, `effectiveFrom`, `effectiveTo` | String/DateTime? | Versionierung |

Unique: `(assetId, version)` und höchstens ein aktives Profil je Asset. Keine Strategie darf Werte aus `providerMetadata` erraten.

### ShadowOrder

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `tradeCandidateId`, `tradeDecisionId` | ID/FK; Entry-Candidate unique | Herkunft |
| `portfolioId`, `assetId`, `tradingSessionId`, `executionProfileId` | FK | Scope/Snapshot |
| `orderKey`, `clientOrderId` | String, beide unique | intern idempotent; Format später adapterfähig |
| `purpose` | `ENTRY/EXIT` | Orders für Entry oder Exit |
| `side` | `BUY/SELL` | Spot-Seite |
| `orderType` | `MARKET` | v1 |
| `timeInForce` | `NEXT_BARS` | interne Gültigkeit |
| `status` | ShadowOrderStatus | siehe Zustandsmaschine |
| `requestedQuantity`, `filledQuantity`, `remainingQuantity` | Decimal | Mengen |
| `referencePrice`, `reservedQuoteAmount` | Decimal | Plan/Reservation |
| `earliestFillAt`, `expiresAt` | DateTime | kein Fill in Signalcandle |
| `precisionSnapshotJson`, `costModelSnapshotJson` | Json | unveränderliche Profile |
| `lastProcessedCandleId` | FK Candle? | Recovery-Cursor |
| `rejectionReasonCode`, `cancelReasonCode` | String? | terminale Gründe |
| `claimed*`, `version`, Zeitstempel | wie Candidate | Recovery/Concurrency |

### ShadowFill

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `shadowOrderId`, `assetId`, `sourceCandleId` | ID/FK | Herkunft |
| `shadowPositionId` | FK? | beim atomaren Position-Update gesetzt |
| `fillKey` | String, unique | Order + Candle + Sequenz |
| `sequence` | Int; unique mit Order | Reihenfolge |
| `side` | `BUY/SELL` | Richtung |
| `quantity` | Decimal | Basismenge |
| `referencePrice`, `spreadAmount`, `slippageAmount`, `fillPrice` | Decimal | Preisbrücke |
| `notional`, `feeAmount` | Decimal | Quote-Wert und Gebühr |
| `feeAsset` | String | v1 `USDT` |
| `liquidityAvailable`, `participationRate` | Decimal | Partial-Fill-Beleg |
| `triggerType` | `ENTRY/STOP/TAKE_PROFIT/TIME_EXIT/INVALIDATION/MANUAL_RISK_CLOSE` | Fill-Grund |
| `simulationVersion` | String | Algorithmusversion |
| `assumptionsJson`, `inputHash` | Json/String | Candle, Profil, Rundung, Konfliktregel |
| `occurredAt`, `createdAt` | DateTime | simulierte/faktische Persistenzzeit |

Fills sind append-only.

### ShadowPosition

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `positionKey` | ID/String unique | Aggregate |
| `portfolioId`, `assetId`, `strategyVersionId`, `strategyAssignmentId` | FK | Attribution |
| `entryOrderId` | FK unique | Ursprung |
| `status` | ShadowPositionStatus | Zustandsmaschine |
| `initialQuantity`, `openQuantity`, `closedQuantity` | Decimal | Mengen |
| `averageEntryPrice`, `averageExitPrice` | Decimal | gewichtete Preise |
| `grossEntryNotional`, `grossExitNotional` | Decimal | Quote-Werte |
| `realizedPnl`, `feesPaid` | Decimal | realisierte Ergebnisse |
| `stopPrice`, `takeProfitPrice`, `maxHoldUntil` | Decimal/DateTime | gecachter aktueller ExitPlan |
| `openedAt`, `closedAt`, `lastValuationAt` | DateTime? | Lebenszyklus |
| `lastProcessedCandleId` | FK Candle? | Recovery |
| `version`, `createdAt`, `updatedAt` | Int/DateTime | Concurrency |

V1: höchstens eine nichtterminale Position je Portfolio/Asset. Keine positive Mengenmutation nach abgeschlossenem Entry-Order-Prozess.

### ShadowPositionEvent

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `shadowPositionId` | ID/FK | Aggregate |
| `eventKey` | String, unique | idempotenter Ereignisschlüssel |
| `sequence` | Int; unique mit Position | lückenlos monoton |
| `type` | `OPENING/OPENED/PARTIAL_CLOSE/CLOSED/STOPPED_OUT/INVALIDATED/MARKED/ERROR` | Ereignis |
| `sourceOrderId`, `sourceFillId`, `sourceCandleId` | FK? | Kausalität |
| `quantity`, `price`, `realizedPnlDelta` | Decimal? | Wirkung |
| `payloadJson`, `occurredAt`, `createdAt` | Json/DateTime | Snapshot/Audit |

### ExitPlan

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `shadowPositionId` | ID/FK | Position |
| `version` | Int; unique mit Position | Planversion |
| `status` | `ACTIVE/TRIGGERED/COMPLETED/CANCELLED` | Lifecycle |
| `stopPrice`, `takeProfitPrice` | Decimal | feste v1-Schwellen |
| `maxHoldUntil` | DateTime | 72 Stunden ab erstem Fill |
| `intrabarConflictPolicy` | `STOP_FIRST` | v1 konservativ |
| `triggeredBy`, `triggeredAt` | String?/DateTime? | Exitgrund |
| `specificationJson`, `specificationHash` | Json/String | immutable Plan |
| `createdAt`, `updatedAt` | DateTime | Audit |

Ein neuer Plan ersetzt niemals Historie; `ShadowPosition` referenziert/denormalisiert die aktive Version.

### Portfolio

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `key` | ID/String unique | Shadow-Portfolio |
| `name`, `baseCurrency` | String | v1 `USDT` |
| `status` | `DRAFT/ACTIVE/PAUSED/ERROR_LOCKED/ARCHIVED` | Betriebszustand |
| `startingCash`, `availableCash`, `reservedCash` | Decimal | Cash-Komponenten |
| `realizedPnl`, `feesPaid`, `equity`, `highWaterMark` | Decimal | gecachte Projektionen |
| `ledgerSequence` | Int | letzter gebuchter Ledgerstand |
| `lastReconciledAt` | DateTime? | Konsistenzzeit |
| `version`, Zeitstempel | Int/DateTime | Concurrency |

### PortfolioLedgerEntry (zusätzlich erforderlich)

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `portfolioId` | ID/FK | Portfolio |
| `entryKey` | String, unique | Idempotenz |
| `sequence` | Int; unique mit Portfolio | lückenlos monoton |
| `type` | `INITIAL_CASH/RESERVE/RELEASE/BUY_NOTIONAL/SELL_NOTIONAL/FEE/PNL_ADJUSTMENT/CORRECTION` | Buchung |
| `availableCashDelta`, `reservedCashDelta`, `realizedPnlDelta`, `feeDelta` | Decimal | Wirkung |
| `shadowOrderId`, `shadowFillId`, `shadowPositionId` | FK? | Herkunft |
| `correctionOfId` | FK self? | explizite Korrektur |
| `balanceAfterJson`, `occurredAt`, `createdAt` | Json/DateTime | Audit/Replay |

Ohne Ledger wäre `Portfolio.currentBalance` eine nicht belegbare mutable Zahl; dieses Zusatzmodell ist deshalb zwingend.

### PortfolioSnapshot

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `portfolioId` | ID/FK | Portfolio |
| `asOf`, `tradingDateUtc`, `sourceLedgerSequence` | DateTime/Date/Int | Projektionspunkt |
| `availableCash`, `reservedCash`, `marketValue`, `equity` | Decimal | Bewertung |
| `realizedPnl`, `unrealizedPnl`, `feesPaid`, `dailyPnl` | Decimal | Ergebnis |
| `highWaterMark`, `drawdownAmount`, `drawdownPct` | Decimal | Risiko |
| `grossExposure`, `openPositionCount` | Decimal/Int | Exposure |
| `valuationJson`, `inputHash` | Json/String | Marks je Position |

Unique: `(portfolioId, asOf, sourceLedgerSequence)`.

### RiskLimitSet

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `key`, `version` | ID/String/Int; key+version unique | versioniertes Regelwerk |
| `status` | `DRAFT/ACTIVE/RETIRED` | nur ein aktives Set je Scope |
| `scope` | `PORTFOLIO` | v1 |
| `maxRiskPerTradePct`, `maxDailyLossPct`, `minRewardRisk` | Decimal | 0,0025 / 0,01 / 2,0 |
| `maxOpenPositions`, `maxNewTradesPerDay`, `maxConsecutiveLosses` | Int | 2 / 4 / 3 |
| `maxGrossExposurePct`, `maxAssetExposurePct`, `maxCorrelatedExposurePct` | Decimal | 0,40 / 0,20 / 0,30 |
| `maxSpreadBps`, `maxSlippageBps` | Int | 20 / 15 |
| `parametersJson`, `specificationHash` | Json/String | weitere Freshness-/DQ-Regeln |
| `effectiveFrom`, `effectiveTo`, Auditfelder | DateTime/String | Versionierung |

Ab `ACTIVE` immutable.

### RiskEvent

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `eventKey` | ID/String unique | Ereignis |
| `type`, `severity`, `reasonCode` | Enum/String | Regelbruch/Systemrisiko |
| `portfolioId` | FK | Pflichtscope |
| `tradeCandidateId`, `shadowOrderId`, `shadowPositionId`, `tradingSessionId` | FK? | Betroffene Aggregate |
| `riskRuleResultId` | FK? | Auslöser |
| `payloadJson`, `inputHash` | Json/String | Beleg |
| `acknowledgedBy`, `acknowledgedAt`, `resolutionNote` | String?/DateTime? | manuelle Bearbeitung |
| `createdAt` | DateTime | UTC |

BLOCKER/CRITICAL-Ergebnisse erzeugen ein Event; WARN kann je Regel konfiguriert werden.

### TradingSession

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `sessionKey` | ID/String unique | Session |
| `portfolioId` | FK | genau ein Portfolio in v1 |
| `mode` | `SHADOW` | kein LIVE-Enum in v1 |
| `status` | `STOPPED/SHADOW_ACTIVE/PAUSED/KILLED/ERROR_LOCKED/CLOSED` | Zustand |
| `killSwitchEngaged` | Boolean default true | redundante, fail-closed Schranke |
| `killReasonCode`, `killNote` | String? | Grund |
| `startedAt`, `pausedAt`, `killedAt`, `closedAt` | DateTime? | Lifecycle |
| `activatedBy`, `lastChangedBy` | String | Akteur |
| `reconciledAt`, `heartbeatAt` | DateTime? | Betriebsfähigkeit |
| `version`, Zeitstempel | Int/DateTime | Concurrency |

Constraint: `SHADOW_ACTIVE` verlangt `killSwitchEngaged=false`, erfolgreiches Reconcile und aktives Portfolio. Alle anderen Zustände blockieren neue Entries.

### StrategyPerformance

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `strategyVersionId`, `portfolioId` | ID/FK | Attribution |
| `window` | `DAILY/ROLLING_30D/ALL_TIME` | Zeitraum |
| `asOf`, `from`, `to` | DateTime | Grenzen |
| `closedTrades`, `wins`, `losses`, `breakeven` | Int | Shadow Trades |
| `grossPnl`, `netPnl`, `fees`, `averageR`, `profitFactor` | Decimal | Resultate |
| `maxDrawdownPct`, `averageHoldMinutes`, `expectancy` | Decimal | Risiko/Qualität |
| `sourceThroughPositionEventId`, `inputHash` | String | reproduzierbare Projektion |

Unique: `(strategyVersionId, portfolioId, window, asOf)`. Ausschließlich geschlossene Shadow-Positionen; keine PaperSignalEvaluation.

### TradingAuditEvent

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `eventKey` | ID/String unique | append-only Audit |
| `eventType`, `aggregateType`, `aggregateId` | String | Handlung und Ziel |
| `actorType`, `actorId` | `SYSTEM/ADMIN/RECOVERY`, String? | Urheber |
| `correlationId`, `causationId`, `idempotencyKey` | String | Ablaufverknüpfung |
| `reasonCode` | String | maschinenlesbarer Grund |
| `beforeState`, `afterState`, `metadataJson` | Json? | sichere Snapshots |
| `inputHash`, `outputHash`, `engineVersion`, `codeVersion` | String? | Reproduzierbarkeit |
| `occurredAt`, `createdAt` | DateTime | UTC |

Die Applikation bietet kein Update/Delete für diese Tabelle. Retention/Archivierung ist eine offene Operationsentscheidung, keine v1-Löschfunktion.

### TradingJobCursor (zusätzlich erforderlich)

| Feld | Typ/Constraint | Bedeutung |
| --- | --- | --- |
| `id`, `jobKey`, `scopeKey` | ID/String; job+scope unique | Job/Assignment/Position |
| `lastCandleId`, `lastProcessedAt` | FK?/DateTime | Fortschritt |
| `claimedBy`, `claimedAt`, `claimExpiresAt` | String?/DateTime? | Recovery |
| `inputHash`, `version`, `updatedAt` | String/Int/DateTime | Concurrency |

Dieser Cursor ergänzt, ersetzt aber nicht die Unique Constraints der Aggregate.

## Relationen in Kurzform

```text
Strategy 1--n StrategyVersion 1--n StrategyAssignment
Portfolio 1--n StrategyAssignment
Assignment 1--n TradeCandidate 1--n Evidence
Candidate 1--1 TradeDecision 1--1 RiskAssessment 1--n RiskRuleResult
Decision 1--0..1 Entry ShadowOrder 1--n ShadowFill
Portfolio 1--n ShadowOrder / ShadowPosition / LedgerEntry / Snapshot
ShadowPosition 1--n ShadowPositionEvent / ExitPlan(versioniert) / Exit Orders
TradingSession 1--n ShadowOrder / RiskEvent / TradingAuditEvent
StrategyVersion 1--n StrategyPerformance
```

## Legacy-Übergang

1. Keine Änderung/Backfill der drei `Paper*`-Tabellen im Domänenmodell-Paket.
2. Neue Tabellen mit eindeutiger Benennung `Shadow*`/`Portfolio*` anlegen.
3. API und Dashboard labeln alte Kennzahlen als „Signal-Paper-Auswertung“ und neue als „Shadow Trading“.
4. Nach stabiler Shadow-Testphase separat Datenbestand und unbekannte Consumer prüfen.
5. Erst dann ADR für Drop/Archivierung; keine automatische Konvertierung, weil alte Datensätze keine Fill-/Fee-/Risk-Historie rekonstruieren können.
