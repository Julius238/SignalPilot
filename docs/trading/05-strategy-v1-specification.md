# 05 – Strategy-v1-Spezifikation

## Empfehlung

`CRYPTO_MTF_BREAKOUT_V1` ist der erste und einzige vertikale Schnitt. Er ist bewusst selten, deterministisch und leicht gegen geschlossene Candles zu reproduzieren.

| Dimension | Verbindlicher Wert |
| --- | --- |
| Markt | Crypto Spot |
| Richtung | Long-only |
| Quote | USDT |
| Assets | ausschließlich explizite Assignments für `BTCUSDT`, `ETHUSDT` |
| Hebel/Margin/Futures | nicht unterstützt; Wert muss 1/false/Spot sein |
| Entscheidungs-Timeframe | 1h, Kontext 4h und 1d |
| Entry | simulierte Market Order frühestens am Open der nächsten 1h-Candle |
| Parameter-/Engineversion | immutable `StrategyVersion` |
| LLM | nicht verwendet |

Discovery darf später liquide Assets vorschlagen, aktiviert sie aber nie. Jede Erweiterung verlangt Daten-/Execution-Profile, eigene Assignment-Freigabe und mindestens eine getrennte Shadow-Beobachtungsphase.

## Eingangsdaten-Snapshot

Der Worker erzeugt einen `StrategyInputSnapshotV1`, bevor die reine Engine läuft. Pflichtfelder:

- `asOf`, `assetId`, Symbol, Asset-Typ, Exchange/Provider, Basis-/Quote-Währung, `isTradable`, `isLeveraged`, `isInverse`, `isStablecoin`, Instrumentstatus;
- `strategyVersionId`, Specification-/Code-/Engine-Hash und `strategyAssignmentId`;
- neueste 250 geschlossene Candles je 1h, 4h und 1d, mindestens 200 je Timeframe, jeweils ID/Open-/Close-Zeit, OHLCV und Source;
- aktuelle `CandleDataQuality` je Timeframe mit Sourcezeit;
- exakt referenzierte aktuelle Signale 1h, 4h, 1d einschließlich IDs, Status, Richtung, Basis-/Adjusted Score, Risk Level, Signal-/Output-/Rule-Kontext und Erzeugungszeit;
- aus diesen Signalen deterministisch berechnete Multi-Timeframe-Zusammenfassung samt Version;
- aktueller `MarketRegimeSnapshot` mit ID, crypto-/overall-Regime, Risk Mode, Confidence und berechnetem Zeitpunkt;
- relevante Radar-, News- und Event-Snapshots innerhalb ihrer definierten Zeitfenster, auch wenn die Liste leer ist;
- aktives `InstrumentExecutionProfile` einschließlich Hash;
- kanonischer Gesamthash.

Ein Verweis auf „latest“ ohne ID und `asOf` ist unzulässig. Der aktuelle Crypto-Pfad füllt News/Event teilweise neutral; Strategy v1 wertet neutral/leer nicht als positive Bestätigung. LLM-Ausgaben oder freier Text dürfen keine Bedingung steuern.

## Vorvalidierung

Vor einer fachlichen Entry-Prüfung müssen alle Bedingungen wahr sein:

1. Assignment aktiv, StrategyVersion `ACTIVE`, Asset exakt BTCUSDT oder ETHUSDT und Portfolio/Session passend.
2. Asset `CRYPTO`, `isTradable=true`, Quote `USDT`, nicht leveraged/inverse/stablecoin; Spot-Execution-Profile aktiv.
3. Jede Candle ist geschlossen; keine Open-Time-Duplikate; OHLC-Invarianten (`low <= open/close <= high`), Volumen nicht negativ.
4. Mindestens 200 Candles je Timeframe und keine Lücke in den für Indikatoren/Breakout benötigten letzten 200 Intervallen.
5. Freshness: 1h höchstens 2h15, 4h höchstens 8h15, 1d höchstens 48h15 alt; DQ-Snapshot höchstens 2h alt; Regime höchstens 26h alt.
6. Signalzeitpunkte liegen nicht nach `asOf`; 1h-Signal gehört zur Anker-Candle, 4h höchstens 8h15 und 1d höchstens 48h15 alt.
7. Keine Quelle ist `UNKNOWN`, fehlerhaft oder widersprüchlich.

Fehler 1–7 ergeben keinen Trade: bei formaler/technischer Verletzung `INVALID`, bei gültigem, aber fachlich nicht passendem Markt schlicht `NO_CANDIDATE`. Keine Ersatzwerte und kein „neutraler“ Default.

## Entry-Voraussetzungen

Alle Bedingungen werden mit Decimalarithmetik und nur auf der neuesten geschlossenen 1h-Anker-Candle `C0` ausgewertet:

### Trend und Breakout

- `close(C0) > SMA20_1h > SMA50_1h > SMA200_1h`;
- `close_4h > SMA50_4h > SMA200_4h`;
- `close_1d > SMA50_1d > SMA200_1d`;
- `close(C0) > max(high)` der exakt 20 unmittelbar vorherigen 1h-Candles; `C0` selbst darf nicht im Vergleichsfenster liegen;
- 1h RSI(14) einschließlich `C0` liegt geschlossen in `[50, 72]`;
- relatives 1h-Volumen `volume(C0) / mean(volume der 20 vorherigen Candles) >= 1,50`;
- ATR(14)/Close liegt in `[0,005; 0,04]`, sonst zu wenig oder zu viel Volatilität.

Indikatorformeln müssen für Strategy v1 gepinnt und in Unit-/Golden-Tests gegen `packages/indicators` verglichen werden. Die Strategy Engine darf nicht stillschweigend eine später geänderte Indikatorsemantik übernehmen.

### Bestehende Signal- und Kontextbestätigung

- 1h-Signal: Richtung `BULLISH`, Status `WATCH` oder `STRONG_WATCH`, `adjustedScore >= 70`, Risk Level nicht `HIGH`;
- 4h- und 1d-Signal: Richtung jeweils `BULLISH`, Status nicht `AVOID/NO_EDGE`, Risk Level nicht `HIGH`;
- Multi-Timeframe: exakt `BULLISH_ALIGNED` und `alignmentScore >= 0,65`; `HIGHER_TIMEFRAME_CONFIRMATION` reicht in v1 nicht;
- Regime: `cryptoRegime=RISK_ON`, `riskMode` weder `DEFENSIVE` noch `HIGH_RISK/UNKNOWN`, Confidence `>= 60`;
- kein aktueller Critical Radar-/Market-Event mit explizit bearish/risk-off klassifiziertem Kontext;
- News/Event ist optionaler Evidenzkontext, aber ein explizit negativer High-Impact-Konflikt blockiert. Leer/neutral gibt keinen Bonus.

Die vorhandenen Signale sind Belege, nicht die Trade-Entscheidung selbst. Ein `STRONG_WATCH` alleine erzeugt keinen Kandidaten.

## Candidate-Preisplan

Referenz ist `referenceEntry = close(C0)`. ATR ist `ATR14_1h(C0)`.

```text
rawStopDistance = max(1.5 * ATR, 0.0075 * referenceEntry)
stopDistancePct = rawStopDistance / referenceEntry
```

Kandidat wird fachlich verworfen, wenn `stopDistancePct > 0,03` oder Stop <= 0. Sonst:

```text
stopPrice       = referenceEntry - rawStopDistance
takeProfitPrice = referenceEntry + 2.5 * rawStopDistance
plannedRR       = (takeProfitPrice - referenceEntry) /
                  (referenceEntry - stopPrice) = 2.5
```

Das Bruttoziel ist seit ADR 0008 (2026-08-02) 2,5R, nicht 2,0R: Spread, Slippage und Roundtrip-Gebühren verkleinern den Bruttogewinn, ohne das Risiko zu verkleinern, sodass ein exakt 2,0R-Bruttoziel das in Dokument 06 verbindliche **Netto**-Mindest-CRV von 2,0 (`R-008-MIN-RR`) bei keinem realistischen Kostenprofil erreichen konnte. Das Netto-Minimum der Risk Engine bleibt unverändert 2,0 und wird durch diese Änderung nicht abgesenkt; 2,5R brutto ist Kopfraum für Kosten, keine Freigabegarantie – bei ungewöhnlich hohem Spread/Slippage kann `R-008` weiterhin ablehnen.

Preise werden im Candidate noch nicht günstig gerundet. Risk/Simulation quantisieren Stop advers: Stop für Long nach oben wäre weniger Risiko, deshalb wird für Risikorechnung auf den nächstniedrigeren Tick und TP auf den nächstniedrigeren Tick gerundet. Nach tatsächlichem Entry-Fill werden Risikobudget und RR mit dem adversen Fill erneut geprüft. Liegt das Netto-RR dann unter 2,0, darf die Order vor Fill auslaufen/abgelehnt werden; ein bereits erfolgter Fill erhält unverzüglich einen gültigen ExitPlan und wird nicht „unsichtbar“ gemacht.

## Candidate-Gültigkeit

- Erzeugung direkt nach `C0` und vollständigem Daten-Snapshot.
- `earliestFillAt = closeTime(C0)`; ausgewertet wird der Open-Preis der nächsten erstmals verarbeiteten 1h-Candle, niemals ein Preis innerhalb `C0`.
- `expiresAt = closeTime(C0) + 2 Stunden`. Höchstens zwei aufeinanderfolgende 1h-Candles sind Fillquellen.
- Öffnet die erste Fillcandle mehr als `0,5 × ATR` über `referenceEntry`, wird der Entry wegen Gap nicht gejagt und die Order `EXPIRED` (`ENTRY_GAP_TOO_LARGE`).
- Neue fachliche Daten nach Candidate-Erzeugung ändern den Kandidaten nicht. Ein späterer Anker erzeugt bei erneutem Setup einen neuen Kandidaten.

## Positionsgrößenformel

Die Strategy Engine schlägt keine endgültige Größe vor. Die Risk Engine berechnet auf Basis konservativer Kosten:

```text
riskBudget = currentEquity * 0.0025
worstEntry = referenceEntry mit halbem Spread + max. erlaubter Buy-Slippage
worstStopFill = stopPrice mit halbem Spread + max. erlaubter Sell-Slippage
roundTripFeesPerUnit = worstEntry * feeRate + worstStopFill * feeRate
perUnitRisk = worstEntry - worstStopFill + roundTripFeesPerUnit
rawQuantity = riskBudget / perUnitRisk
```

Danach wird `rawQuantity` durch verfügbare Cash-Reserve, 40 % Portfolio-, 20 % Asset- und 30 % Korrelations-Exposure gekappt und auf `stepSize` abgerundet. Die Größe darf nach einem Verlust niemals mit Faktor/Override erhöht werden. Fällt sie unter Mindestmenge/-notional oder wird `riskBudget <= 0`, wird abgelehnt.

## Exit-Modell

### Reihenfolge und Gründe

V1 verwendet feste Schwellen, keine Trailing Stops, Teilziele oder Stop-Weitung.

| Reason Code | Trigger | Fillmodell |
| --- | --- | --- |
| `HARD_STOP` | Low erreicht/unterläuft Stop oder Candle öffnet darunter | Stop bzw. bei Gap adverser Open, jeweils Sell-Kosten |
| `TAKE_PROFIT` | High erreicht/übersteigt TP, ohne vorherigen Stop-Konflikt | höchstens TP, kein günstigerer Gap-Gewinn |
| `MAX_HOLD` | 72 Stunden nach erstem Entry-Fill | nächster verarbeiteter Candle-Open/Close gemäß Simulationsregel |
| `REGIME_INVALIDATED` | frischer Snapshot wird `RISK_OFF` oder `HIGH_RISK` | risikoreduzierender Market Exit an nächster Candle |
| `DATA_INVALIDATION` | offene Position, aber kritische Candle-/Portfolio-Datenverletzung | Session locken; konservativer Market Exit nur bei verwertbarem Preis |
| `MANUAL_RISK_CLOSE` | bestätigtes Admin-Kommando | risikoreduzierender Market Exit |

Sind Stop und TP innerhalb derselben Candle möglich und ist die Reihenfolge unbekannt, gilt Stop zuerst. Gap-, Partial-Fill- und Rundungsregeln stehen in `07-shadow-execution-model.md`.

## Fehlende oder widersprüchliche Daten

| Situation | Neue Kandidaten | Bestehende Orders | Offene Positionen |
| --- | --- | --- | --- |
| Pflichtquelle fehlt/stale | `INVALID`/kein Kandidat | Entry cancel/expire | Monitoring mit letzter belegter Schwelle; Risk Event |
| OHLC/DQ widersprüchlich | blockiert | Entry cancel | `ERROR_LOCKED`; kein fiktiver Fill aus fehlerhafter Candle |
| Signale widersprechen | kein Kandidat | vorhandener Candidate unverändert, vor Fill erneute Risk-Freshness-Prüfung | kein automatischer Exit allein wegen Signalwechsel |
| Regime `UNKNOWN/NEUTRAL/MIXED` | kein Kandidat | noch ungefüllten Entry blockieren | Stop/TP/Max-Hold bleiben aktiv |
| Execution Profile fehlt/stale | blockiert | reject/cancel | vorhandenen Profilsnapshot zur Risikoreduktion weiterverwenden, Risk Event |
| Portfolio inkonsistent | blockiert | Entry cancel | `ERROR_LOCKED`, Reconcile, nur risikoreduzierend |

## Nicht-Scope Strategy v1

- Short, Futures, Margin, Leverage, andere Quote-Währungen;
- Discovery-Autoaktivierung;
- LLM-/Sentimentfreigabe oder LLM-Sizing;
- Optimierung anhand laufender Shadow-Ergebnisse, Online Learning;
- Trailing Stop, Break-even Move, Scale-in/out, Averaging, Martingale;
- Limit Orders oder Orderbuchmodelle;
- mehrere Strategien oder Parameterexperimente im selben Portfolio.
