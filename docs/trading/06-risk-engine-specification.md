# 06 – Risk-Engine-v1-Spezifikation

## Vertrag

Die Risk Engine ist eine reine Funktion:

```ts
evaluateRisk(input: RiskAssessmentInputV1): RiskAssessmentOutputV1
```

Der Input enthält ausschließlich unveränderliche Snapshotwerte; keine DB, Uhr, Env oder Netzwerkzugriffe. Output enthält Gesamtergebnis, genehmigte Menge, jede Regel in stabiler Reihenfolge und eine optionale Session-Direktive. Die Orchestrierung persistiert `RiskAssessment`, sämtliche `RiskRuleResult`, `TradeDecision`, Risk Events und Statusänderung atomar.

Auswertungssemantik:

- `CRITICAL ERROR` -> Gesamtergebnis `ERROR`, `ERROR_LOCK`, keine Order.
- mindestens ein `BLOCKER FAIL` -> `FAIL`, keine Order.
- `WARNING` kann v1 nie eine BLOCKER-Regel überstimmen.
- Alle Regeln laufen auch nach einem Fehler, soweit ihre Inputs sicher verfügbar sind, damit das Audit vollständig ist. Nicht prüfbare Pflichtregeln liefern `ERROR`, niemals PASS.

## Verbindliches Limitset v1

| Limit                             | Wert                                                             |
| --------------------------------- | ---------------------------------------------------------------- |
| Kontorisiko je Trade              | maximal 0,25 % (`0.0025`) der aktuellen Equity                   |
| Tagesverlust                      | maximal 1,00 % (`0.01`) der UTC-Start-of-Day-Equity              |
| offene Positionen                 | maximal 2 nach dem geplanten Fill                                |
| neue Trades                       | maximal 4 gefüllte Entries pro UTC-Tag                           |
| Mindest-CRV                       | 2,00 netto konservativer Kosten                                  |
| Brutto-Exposure                   | maximal 40 % Equity                                              |
| Einzelasset-Exposure              | maximal 20 % Equity                                              |
| korrelierte Crypto-Major-Exposure | maximal 30 % Equity                                              |
| voller Spread                     | maximal 20 bp                                                    |
| Slippage je Seite                 | maximal 15 bp                                                    |
| Verlustserie                      | 3 aufeinanderfolgende netto negative Closed Trades -> Tages-Kill |

Exposure ist immer das Post-Trade-Szenario inklusive Reserven und offener Positionen. Negative oder fehlende Equity blockiert.

Long und Short werden für Brutto-, Asset- und Korrelations-Exposure mit ihrem absoluten Quote-Wert addiert, niemals gegeneinander genettet. Eine aktive Position oder aktive Entry-Order desselben Portfolio-/Asset-Scopes blockiert die Gegenrichtung.

## Richtungsabhängiges Sizing und Netto-CRV

Alle Werte sind `Decimal(30,12)`; Quantity wird konservativ auf `stepSize` abgerundet, adverse Preise und Gebühren werden niemals zugunsten des Portfolios gerundet.

```text
LONG:
worstEntry    = adverse Buy-Fill
worstStopFill = adverse Sell-Fill
worstTpFill   = adverse Sell-Fill
perUnitRisk   = worstEntry - worstStopFill + Entry-/Stop-Gebühren je Einheit
netReward     = worstTpFill - worstEntry - Entry-/TP-Gebühren je Einheit

SHORT:
worstEntry    = adverse Sell-Fill
worstStopFill = adverse Buy-Fill
worstTpFill   = adverse Buy-Fill
perUnitRisk   = worstStopFill - worstEntry + Entry-/Stop-Gebühren je Einheit
netReward     = worstEntry - worstTpFill - Entry-/TP-Gebühren je Einheit

riskBudget = equity × 0.0025
rawQuantity = riskBudget / perUnitRisk
netCRV = netReward / perUnitRisk
```

Die genehmigte Menge ist das Minimum aus Risk-Budget-, Cash-/Collateral-, MinNotional-, QuantityStep-, Brutto-, Asset- und Korrelationslimit. Short-Collateral ist der volle ungehebelte adverse Entry-Notional plus Gebühr; es gibt keinen Leverage-Effekt.

## Regelkatalog

Jede Tabellenzeile definiert Input, Resultat/Ablehnungsgrund, Severity, Persistenz und Mindesttests.

| Code                          | Eingaben und PASS-Bedingung                                                                                                                                                                                                                                                                                                                          | FAIL/ERROR Reason                                           | Severity/Reaktion                                          | Persistenz                               | Mindesttests                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `R-001-SHADOW-MODE`           | Build capability=`SHADOW_ONLY`, `TRADING_MODE=SHADOW`, `ENABLE_LIVE_TRADING != true`                                                                                                                                                                                                                                                                 | `MODE_NOT_SHADOW` / unbekannt=`CONFIG_INVALID`              | CRITICAL; ERROR_LOCK/start fail                            | RuleResult + RiskEvent + Audit           | gültig; DISABLED; LIVE/unknown                                                                       |
| `R-002-SESSION`               | Session `SHADOW_ACTIVE`, Kill=false, Heartbeat/Reconcile frisch                                                                                                                                                                                                                                                                                      | `SESSION_BLOCKS_ENTRY`                                      | BLOCKER; block new                                         | RuleResult, bei Kill RiskEvent           | active; paused; killed; stale reconcile                                                              |
| `R-003-PORTFOLIO-CONSISTENCY` | Ledgersequence/-summen = Portfolio-Caches; Reserve je Order; Cash >=0; keine Orphans                                                                                                                                                                                                                                                                 | `PORTFOLIO_INCONSISTENT`                                    | CRITICAL; ERROR_LOCK                                       | RuleResult + Critical RiskEvent + Audit  | konsistent; 1-Cent-Differenz über Toleranz; orphan fill; negative cash                               |
| `R-004-ASSET-SCOPE`           | CRYPTO, Spot, Quote USDT, Symbol BTCUSDT/ETHUSDT, aktive Assignment, tradable; nicht leveraged/inverse/stablecoin                                                                                                                                                                                                                                    | spezifisch `ASSET_NOT_ALLOWED`, `NOT_SPOT_USDT`             | BLOCKER                                                    | RuleResult                               | BTC; ETH; fremdes Asset; leveraged token; inactive                                                   |
| `R-005-LONG-ONLY`             | Historischer Code, neue Semantik: LONG mit BUY/SELL oder synthetischer SHORT mit SELL/BUY. SHORT nur bei `TRADING_MODE=SHADOW`, `TRADING_SHADOW_ENABLED=true`, `TRADING_SHADOW_SHORT_ENABLED=true`, `TRADING_STRATEGY_SHORT_V1_ENABLED=true`, `ENABLE_LIVE_TRADING=false`, eindeutiger Direction-Kette und ohne Exchange-/Margin-/Futures-Capability | `SIDE_NOT_ALLOWED` / `CONFIG_INVALID`                       | CRITICAL bei unbekannt/widersprüchlich, sonst BLOCKER      | RuleResult + ggf. RiskEvent              | Long; vollständiger Shadow-Short; fehlendes Flag; Side-/Direction-Mismatch; Live-/Capability-Versuch |
| `R-006-NO-LEVERAGE`           | requestedLeverage=1, margin=false, borrow=0, Portfolio Cash-Sizing                                                                                                                                                                                                                                                                                   | `LEVERAGE_OR_MARGIN_FORBIDDEN`                              | CRITICAL; ERROR_LOCK bei technischem Versuch               | RuleResult + RiskEvent                   | 1x spot; 2x; margin flag; debt                                                                       |
| `R-007-STOP-REQUIRED`         | Stop vorhanden, >0, tickkonform; Long `stop < entry < TP`, Short `TP < entry < stop`; aktiver ExitPlan kann atomar entstehen                                                                                                                                                                                                                         | `STOP_MISSING_OR_INVALID`                                   | BLOCKER                                                    | RuleResult                               | beide Richtungen; null; falsche Lage; <=0; falscher Tick                                             |
| `R-008-MIN-RR`                | richtungsabhängiges `netReward/perUnitRisk >= 2.0`, einschließlich Roundtrip-Kosten                                                                                                                                                                                                                                                                  | `REWARD_RISK_BELOW_MINIMUM`                                 | BLOCKER                                                    | RuleResult mit actual/limit              | genau 2; 1.9999; adverser Fill senkt RR; falsche TP-Lage                                             |
| `R-009-RISK-PER-TRADE`        | worst-case Verlust inkl. Entry-/Exitgebühren <= Equity×0.0025, genehmigte Menge >0                                                                                                                                                                                                                                                                   | `TRADE_RISK_EXCEEDS_25BP`                                   | BLOCKER                                                    | RuleResult + Assessment sizing           | darunter; exakt Grenze; darüber; Rundung; Equity<=0                                                  |
| `R-010-DAILY-LOSS`            | `dailyPnl = currentEquity - startOfDayEquity`, inklusive negativer unrealized Werte; Verlust < 1 %                                                                                                                                                                                                                                                   | `DAILY_LOSS_LIMIT_REACHED`                                  | CRITICAL; ENGAGE_KILL_SWITCH bis nächster UTC-Tag + Review | RuleResult + RiskEvent + Session Audit   | -0.99%; exakt -1%; negative unrealized; Tageswechsel                                                 |
| `R-011-OPEN-POSITIONS`        | Anzahl aller Exposure-tragenden Positionen inkl. ERROR + geplantes neues Asset <=2                                                                                                                                                                                                                                                                   | `MAX_OPEN_POSITIONS`                                        | BLOCKER                                                    | RuleResult                               | 0/1 pass; 2 bestehend fail; ERROR zählt                                                              |
| `R-012-TRADES-PER-DAY`        | gefüllte Entry-Orders seit 00:00 UTC <4 vor neuem Fill                                                                                                                                                                                                                                                                                               | `MAX_DAILY_TRADES`                                          | BLOCKER bis Tageswechsel                                   | RuleResult                               | 0/3 pass; 4 fail; Candidate/abgelehnte Order zählt nicht; partial Entry zählt einmal                 |
| `R-013-GROSS-EXPOSURE`        | `(offene Marktwerte + Entry-Reserve)/Equity <=0.40`                                                                                                                                                                                                                                                                                                  | `MAX_GROSS_EXPOSURE`                                        | BLOCKER, Größe vorher kappbar                              | RuleResult                               | Cap sizing; exakt; über; negative equity                                                             |
| `R-014-ASSET-EXPOSURE`        | Post-Trade-Exposure des Assets/Equity <=0.20; keine zweite offene Position desselben Assets                                                                                                                                                                                                                                                          | `MAX_ASSET_EXPOSURE` / `DUPLICATE_ASSET_POSITION`           | BLOCKER                                                    | RuleResult                               | erstes Asset; cap; zweite Position; reserve zählt                                                    |
| `R-015-CORRELATION`           | BTC/ETH gehören v1 fest Gruppe `CRYPTO_MAJOR`; Summe Post-Trade/Equity <=0.30                                                                                                                                                                                                                                                                        | `MAX_CORRELATED_EXPOSURE`                                   | BLOCKER, Größe kappbar                                     | RuleResult + Gruppeninput                | BTC allein; BTC+ETH <=30%; >30%; fehlende Gruppe=ERROR                                               |
| `R-016-DATA-FRESHNESS`        | 1h<=2h15, 4h<=8h15, 1d<=48h15, DQ<=2h, Regime<=26h, Portfolio Snapshot<=5m                                                                                                                                                                                                                                                                           | `DATA_STALE_<SOURCE>`                                       | BLOCKER; bei Exposure/stark stale RiskEvent                | ein Result je Regel mit Quellenliste     | jede Boundary; 1 ms darüber; Clock skew/future timestamp                                             |
| `R-017-DATA-QUALITY`          | je TF >=200 Candles, letzte 200 gapfrei, OHLC valide, Providerstatus ok, aktuelle DQ Coverage/Freshness bestanden                                                                                                                                                                                                                                    | `DATA_QUALITY_INSUFFICIENT`                                 | BLOCKER; widersprüchliche OHLC CRITICAL/ERROR_LOCK         | RuleResult + bei CRITICAL Event          | vollständig; 199; gap; provider error; malformed OHLC                                                |
| `R-018-SPREAD`                | aktives Profile, `fullSpreadBps <=20` und nicht negativ                                                                                                                                                                                                                                                                                              | `SPREAD_LIMIT_EXCEEDED` / fehlt=`EXECUTION_PROFILE_MISSING` | BLOCKER; fehlendes/negatives Profil CRITICAL               | RuleResult                               | 0/20 pass; 21 fail; null/negativ error                                                               |
| `R-019-SLIPPAGE`              | `slippageBps <=15`, Kosten in Sizing/CRV enthalten                                                                                                                                                                                                                                                                                                   | `SLIPPAGE_LIMIT_EXCEEDED`                                   | BLOCKER                                                    | RuleResult                               | 15 pass; 16 fail; nicht eingerechnet error                                                           |
| `R-020-REGIME`                | Long exakt `RISK_ON`, Short exakt `RISK_OFF`; Risk Mode nicht DEFENSIVE/HIGH_RISK/UNKNOWN, Confidence>=60                                                                                                                                                                                                                                            | `MARKET_REGIME_CONFLICT`                                    | BLOCKER                                                    | RuleResult mit Snapshot-ID und Direction | Long/Short korrekt; Gegenregime; 59; mixed/neutral; stale separat                                    |
| `R-021-LOSS-STREAK`           | aufeinanderfolgende chronologische Closed-Trade-Netto-PnLs <3 Verluste; Break-even beendet Verlustserie nicht, Gewinn setzt zurück                                                                                                                                                                                                                   | `CONSECUTIVE_LOSS_LIMIT`                                    | CRITICAL; ENGAGE_KILL_SWITCH bis nächster UTC-Tag + Review | RuleResult + RiskEvent + Session         | 0/2 pass; 3 fail; Gewinn reset; breakeven bleibt Serie                                               |
| `R-022-NO-SCALE-IN`           | keine nichtterminale Position/Entry-Order für Portfolio+Asset; Orderzweck ENTRY; Candidate nicht aus bestehender Position                                                                                                                                                                                                                            | `AVERAGING_OR_SCALE_IN_FORBIDDEN`                           | CRITICAL bei Umgehungsversuch                              | RuleResult + RiskEvent                   | neue Position; offene Position; partial Order; zweiter Candidate                                     |
| `R-023-NO-MARTINGALE`         | Sizing exakt Formel/Limitset; kein Multiplikator aus vorherigem PnL/Verlustserie, kein manuelles Size Override                                                                                                                                                                                                                                       | `NON_DETERMINISTIC_SIZE_OVERRIDE`                           | CRITICAL; ERROR_LOCK                                       | RuleResult + Audit Hashvergleich         | normal; loss multiplier; admin override; gleicher Input gleicher Output                              |
| `R-024-NO-POST-LOSS-INCREASE` | genehmigtes Risiko <=0,25 % aktueller Equity und <= vorheriger gleichartiger Risikobudgetwert, falls Equity nach Verlust geringer; Parameter unverändert                                                                                                                                                                                             | `RISK_INCREASE_AFTER_LOSS`                                  | BLOCKER/CRITICAL bei Override                              | RuleResult                               | Equity sinkt -> Budget sinkt; unverändert; manipulierte höhere Größe                                 |
| `R-025-INSTRUMENT-MINIMUMS`   | nach Abrundung qty>=minQty, notional>=minNotional, Preis/Menge tick-/stepkonform, Cashreserve ausreichend                                                                                                                                                                                                                                            | `BELOW_INSTRUMENT_MINIMUM` / `INSUFFICIENT_CASH`            | BLOCKER                                                    | RuleResult                               | Grenzwerte; unter min; Rundung auf 0; Cash inkl. Fee                                                 |
| `R-026-IDEMPOTENCY-VERSION`   | Candidate/Input/Strategy/Risk/Profile-Hashes entsprechen; kein Key-Payload-Konflikt                                                                                                                                                                                                                                                                  | `IDEMPOTENCY_OR_VERSION_CONFLICT`                           | CRITICAL; ERROR_LOCK                                       | RuleResult + RiskEvent + Audit           | normal retry; gleicher key/hash; gleicher key/anderer hash; retired version                          |

## Portfolio-Konsistenz und Toleranz

V1-Währung ist USDT. Vergleichstoleranz ist `min(0.00000001 USDT, kleinste im Execution Profile belegte Quote-Einheit)`; ist keine Quote-Einheit belegt, gilt exakt bis zur gespeicherten Decimal-Skala. Die Toleranz darf nicht als regelmäßige P&L-Korrektur dienen.

Pflichtinvarianten:

```text
availableCash >= 0
reservedCash >= 0
sum(active order reservations) == reservedCash
portfolio caches == replay(ledger through ledgerSequence)
position.openQuantity == entry fills - exit fills
order.filledQuantity == sum(order fills)
LONG position.reservedCollateral == 0
SHORT open position.reservedCollateral > 0 und vollständig in reservedCash repräsentiert
terminal position.reservedCollateral == 0
keine gegensätzlichen oder doppelten aktiven Portfolio-/Asset-Scopes
equity == availableCash + reservedCash + richtungsabhängiger konservativer Beitrag
```

Eine Abweichung wird nicht automatisch gegen `currentBalance` gebucht. Reconciliation erzeugt `ERROR_LOCKED`; ein explizites Correction-Ledger-Event erfordert begründete Adminfreigabe und unabhängige Prüfung.

## Tagesverlust und Drawdown

- `startOfDayEquity` ist der letzte reconciled Snapshot um/kurz nach 00:00 UTC; fehlt er, blockieren neue Trades.
- `dailyPnl = currentEquity - startOfDayEquity - externe Cashflows`. Shadow v1 hat keine externen Cashflows nach Initialisierung; ein unerwarteter Cashflow ist ein Konsistenzfehler.
- Die 1-%-Grenze betrachtet realisierte plus unrealisiert negative P&L nach konservativem Exit-Mark. Positive unrealized P&L darf realisierte Tagesverluste ausgleichen, wird aber nach konservativen Sell-Kosten bewertet.
- Drawdown ist `(highWaterMark - equity) / highWaterMark`; er wird beobachtet und persistiert. Ein zusätzlicher Drawdown-Kill-Grenzwert bleibt offene Entscheidung und ist nicht heimlich mit der Tagesgrenze gleichzusetzen.

## Correlation v1

Da ausschließlich BTCUSDT/ETHUSDT zugelassen sind, ist keine instabile laufende Korrelationsschätzung für die Freigabe nötig: beide gehören deterministisch zur Gruppe `CRYPTO_MAJOR`. Das 30-%-Gruppenlimit begrenzt gemeinsame Exposure. Die vorhandene Discovery-Korrelation kann als Evidenz gespeichert werden, darf diese harte Gruppenzuordnung in v1 aber nicht lockern.

## Spread-/Slippage-Grenze trotz Candle-Daten

Der Bestand liefert keinen beobachteten Bid/Ask-Spread. V1 prüft deshalb ein aktiv freigegebenes, versioniertes konservatives Execution Profile; sie behauptet nicht, den Live-Spread gemessen zu haben. Der Dashboard-Status muss dies als „modelliert“ kennzeichnen. Bevor Discovery-Assets oder ein Demo-Adapter zugelassen werden, müssen beobachtete Spreads/Exchange-Filter separat erhoben und reconciled werden.

## Risk-Engine-Goldenfälle

Zusätzlich zu den Einzeltests müssen fixture-basierte Gesamttests existieren:

1. BTC-Setup, 10.000 USDT Equity, alle Daten frisch: Größe so abrunden, dass Worst-Case-Risiko einschließlich Kosten höchstens 25 USDT ist.
2. Identischer Input zweimal: byte-identischer kanonischer Output/Hash.
3. Zweite ETH-Position wird auf 30-%-Korrelationslimit gekappt; unter Mindestnotional danach Reject.
4. Tages-P&L exakt -100 USDT bei 10.000 Start-Equity: Reject + Kill-Direktive.
5. Portfolio-Ledger weicht um mehr als Toleranz ab: kein Sizing, `ERROR`, `ERROR_LOCK`.
6. Stop und TP valide, aber adverse Kosten reduzieren CRV auf 1,999: Reject.
7. Fehlender DQ-/Regime-/Execution-Snapshot: kein Default, Reject/Error.
8. Versuch, nach Verlust einen 2×-Faktor anzuwenden: Critical Rule Result.
