# 07 – Shadow-Ausführungsmodell

## Grundsatz

Die Simulation soll reproduzierbar und im Zweifel schlechter, nicht besser, als die aus OHLCV belegbare Ausführung sein. Sie behauptet keine Tick-Reihenfolge, die in 1h-Candles nicht vorhanden ist. Jeder Algorithmus und jedes Kosten-/Instrumentprofil ist versioniert.

V1 unterstützt Market Orders. Limit Orders sind ein späterer Zusatz und dürfen erst nach separater Spezifikation aktiviert werden.

## Eingaben je Simulationsschritt

- immutable `ShadowOrder` und aktueller erwarteter `version`-Wert;
- eine neue, geschlossene 1h-`Candle` nach `earliestFillAt`, die noch nicht verarbeitet wurde;
- persistierter `InstrumentExecutionProfile`-Snapshot aus der Order;
- für Exits: Position, aktiver ExitPlan und alle bisherigen Fills;
- Portfolio-/Reserve-Snapshot für Invarianten;
- `simulationVersion`, UTC-Zeit und kanonischer Input-Hash.

Eine laufende Candle darf nie verwendet werden. Eine Candle wird je Order/Position durch `lastProcessedCandleId` und eindeutige Fill-/Eventschlüssel genau einmal verarbeitet.

## Marktorder-Preis

`fullSpreadRate = fullSpreadBps / 10_000`, `slippageRate = slippageBps / 10_000`.

Für eine Referenz `p`:

```text
syntheticAsk = p * (1 + fullSpreadRate / 2)
syntheticBid = p * (1 - fullSpreadRate / 2)
BUY rawFill  = syntheticAsk * (1 + slippageRate)
SELL rawFill = syntheticBid * (1 - slippageRate)
```

Rundung ist advers:

- BUY-Fillpreis auf den nächsthöheren Tick;
- SELL-Fillpreis auf den nächstniedrigeren Tick;
- Kauf-/Verkaufsmenge immer auf die nächstkleinere Step Size;
- Gebühren auf die persistierte Decimal-Skala zuungunsten des Portfolios aufrunden.

Entry-Referenz ist der Open der nächsten zulässigen Candle. Stop/TP/Time-/Manual-Exits verwenden die unten festgelegte Triggerreferenz. Modellierter voller Spread und Slippage müssen die Risk-Grenzen bereits bestanden haben.

## Gebühren

V1 verwendet den im Execution Profile freigegebenen konservativen Taker-Satz, initial 10 bp je Fill, nicht einen behaupteten Börsengebührensatz. Für jeden Fill:

```text
notional = quantity * fillPrice
fee = ceilAdverse(notional * feeBps / 10_000)
```

Gebühr in v1 ausschließlich USDT. Rabatte, BNB/BGB-Zahlung, Maker-Rebates, Funding und Steuern sind nicht modelliert. Ein späterer Demo-Adapter muss die tatsächliche Fee pro Fill speichern und darf sie nicht aus dem Profil rekonstruieren.

## Instrumentminimum und Präzision

Vor Akzeptanz und vor jedem Fill werden geprüft:

- `quantity % stepSize == 0` nach Abrundung;
- Preis entspricht Tick Size nach adverser Rundung;
- Quantity `>= minQuantity`;
- Notional `>= minNotional`;
- Buy-Kosten plus Fee `<=` zugeordnete Reserve;
- Sell-Quantity `<= position.openQuantity`.

Ändern sich Providerfilter nach Ordererzeugung, gilt für die Reproduktion der Order deren Snapshot. Neue Orders brauchen das neue aktive Profile. Ein als sicherheitskritisch markiertes Filterupdate cancelt ungefüllte Entries; offene Positionen behalten ein ausführbares, konservatives Exitprofil und erzeugen einen Risk Event.

## Liquidität und Teilausführungen

Die Simulation nutzt nur das belegte Basisvolumen der Candle. Ein Market-Order-Fill ist pro Candle auf folgende Menge begrenzt:

```text
liquidityCap = floorToStep(candle.volume * maxParticipationRate)
fillQuantity = min(remainingQuantity, liquidityCap)
```

Initial ist `maxParticipationRate=0.01` (1 % des 1h-Basisvolumens). Das ist eine konservative, versionierte Modellannahme, keine Orderbuchmessung.

- `fillQuantity <= 0` oder Notional unter Minimum: kein Fill; Order wartet bis Ablauf.
- `0 < fillQuantity < remaining`: `PARTIALLY_FILLED`; Reserve des ungefüllten Teils bleibt bestehen.
- Rest vollständig: `FILLED`; überschüssige Reserve wird atomar freigegeben.
- Nach zwei zulässigen Candles: ungefüllter Rest `EXPIRED` und Reserve freigeben. Bereits gefüllte Position bleibt bestehen.
- Exit-Orders verwenden dieselbe Cap-Logik. Der verbleibende Positionsteil bleibt mit Stop-Risiko sichtbar; bei Stop-/Gap-Exit wird die konservative Slippage je Folgecandle erneut angewandt.

Eine spätere realistischere Volumen-/Orderbuchkalibrierung erhält eine neue SimulationVersion; historische Fills werden nicht neu geschrieben.

## Entry und Gap

1. Candidate basiert auf geschlossener Anker-Candle `C0`.
2. Keine Ausführung in `C0`.
3. Erste zulässige Candle `C1`: Referenz `open(C1)`.
4. `open(C1) > referenceEntry + 0.5 × ATR`: kompletter ungefüllter Entry läuft als `ENTRY_GAP_TOO_LARGE` aus; kein FOMO-Fill.
5. Ansonsten Market-Buy-Formel und Liquiditätscap.
6. Nach einem Entry-Fill werden Stop/TP mit tatsächlichem Average Entry und gespeichertem ExitPlan geprüft. Ein Fill darf niemals ohne ExitPlan/Position/Ledger committen.

## Stop, Take Profit und Intrakerzenkonflikte

Für jede Position und neue geschlossene Candle in folgender Reihenfolge:

1. **Gap durch Stop:** `open <= stop`. Trigger Stop, Referenz `open` (schlechter als Stop möglich), Sell-Spread/Slippage.
2. **Gap über Take Profit:** `open >= takeProfit`. Trigger TP, Referenz höchstens `takeProfit`; günstigerer Open wird nicht gutgeschrieben.
3. **Beide Schwellen im Range:** `low <= stop` und `high >= takeProfit`. Reihenfolge unbekannt, deshalb zwingend `STOP_FIRST`; Stopreferenz.
4. **Nur Stop:** `low <= stop`, Stopreferenz.
5. **Nur TP:** `high >= takeProfit`, TPreference höchstens TP.
6. **Max Hold fällig:** wenn kein Preisexit, Referenz `close` der ersten Candle mit `closeTime >= maxHoldUntil`.
7. **Regime-/manueller Exit:** wenn vor Candleverarbeitung angefordert und kein härterer Stop, Referenz `open` der nächsten Candle; kommt die Anforderung erst nach Open, `close` der nächsten vollständig beobachtbaren Candle.

Für eine in `C1` am Open eröffnete Position wird der gesamte OHLC-Range von `C1` danach als potenzieller Exitpfad behandelt. Treffen Stop und TP, gilt ebenfalls Stop zuerst. Das ist konservativ, aber deterministisch.

## Gap-Risiken

- Stop-Gap wird am adversen Candle-Open ausgeführt, nicht am Stoppreis.
- TP-Gap wird höchstens am Ziel ausgeführt; kein positiver Gap-Bonus.
- Liegt der berechnete adverse Fill außerhalb der OHLC-Candle, wird er nicht künstlich in den Range geklemmt, weil Spread/Slippage außerhalb des Mid-OHLC plausibel ist. Annahme und Abweichung werden gespeichert.
- Ist Open/Range ungültig oder fehlt die Candle, kein erfundener Fill: Risk Event, Session locken, Position weiter als Exposure zählen.

## Limit Orders – expliziter späterer Scope

Eine spätere Version muss mindestens Queue-/Touch-Modell, Maker/Taker, Partial Fill, Gap-through, GTC/IOC/FOK, Änderung/Cancel und same-candle Entry/Exit definieren. Bis dahin existiert kein Feature-Flag, das `LIMIT` aktivieren kann. Ein Enumwert kann migrationsseitig vorbereitet werden, aber Domain Guard und API müssen ihn ablehnen.

## Portfolio-Cash und Reservierung

### Entry-Akzeptanz

Worst-Case-Reserve:

```text
worstEntryPrice = BUY(referencePrice, maxSpread, maxSlippage), advers gerundet
reservedQuote = quantity * worstEntryPrice + adverseEntryFee
```

Ledger: `availableCash -= reservedQuote`, `reservedCash += reservedQuote`. Eine Order ohne vollständige Reserve wird nicht akzeptiert. Portfolio-Caches und Ledger entstehen atomar.

### Entry-Fill

Für tatsächliche Kosten `fillNotional + fee`:

- `reservedCash -=` der dem Fill zugeordneten Reserve;
- nicht benötigter reservierter Teil dieses Fills zurück zu `availableCash`;
- tatsächliche Buy-Kosten werden aus dem Portfoliovermögen gegen den Basisasset-Marktwert transformiert; Ledger hält Quote-Cash- und Fee-Wirkung;
- Restreserve bleibt an die Restmenge gebunden.

Cancel/Expiry gibt nur den ungefüllten Rest frei. Kein Pfad darf `availableCash` negativ machen.

### Exit-Fill

```text
netProceeds = fillNotional - exitFee
availableCash += netProceeds
realizedPnlDelta = quantity * (fillPrice - allocatedAverageEntryPrice)
                   - allocatedEntryFees - exitFee
```

Entry Fees werden proportional zur geschlossenen Menge zugeordnet. Rundungsreste werden erst beim finalen Close deterministisch dem letzten Fill zugeschlagen.

## Realisiert, unrealisiert und Equity

- Realisiert: ausschließlich aus abgeschlossenen Sell-Fills abzüglich zugeordneter Entry-/Exitgebühren.
- Unrealisiert: offene Menge × (`conservativeBidMark - averageEntryPrice`) minus geschätzte Exitfee. Mark ist Candle-Close mit halbem Sell-Spread, ohne zusätzliche Slippage; Risk-Worst-Case kann separat Slippage abziehen.
- Marktwert: offene Menge × conservativeBidMark.
- Equity: `availableCash + reservedCash + marketValue`. Reserviertes Cash bleibt Eigentum des Portfolios und darf nicht doppelt als Marktwert gezählt werden.
- High Water Mark steigt nur mit einem reconciled Snapshot; Drawdown wird davon abgeleitet.

## Historisch zu speichernde Filldaten

Für jeden Fill zwingend:

- interne Fill-/Order-/Position-/Portfolio-/Asset-/Session-IDs;
- Candidate, Decision, StrategyVersion und Assignment über Orderrelation;
- Fillsequenz, Seite, Zweck/Trigger und simulierte Zeit;
- Source-Candle-ID, Open/High/Low/Close/Volume-Snapshot und Candle-Source/-Close-Time;
- Referenzpreis, voller/halber Spread in bp und Betrag, Slippage in bp und Betrag, ungerundeter und gerundeter Fillpreis;
- angefragte/restliche/verfügbare/gefillte Menge, Participation Rate;
- Tick/Step/MinQty/MinNotional und ExecutionProfile-ID/-Hash;
- Notional, Fee Rate, Fee Amount, Fee Asset;
- Rundungsmodus und -differenzen;
- Intrabar-Regel, Gap-Indikator und angewandte Konfliktpriorität;
- Simulation-/Codeversion, kanonischer Input- und Output-Hash;
- Correlation-/Causation-/Idempotency-Key und Erstellzeit.

Damit ist ein Fill ohne Zugriff auf später veränderte Candles/Profile reproduzierbar.

## Fehlerbehandlung

- Arithmetik-Overflow, NaN, negative Preise/Mengen oder Hash-Konflikt: kein Fill, Critical Risk Event, `ERROR_LOCKED`.
- DB-Fehler vor Commit: keinerlei Teilwirkung; Retry über FillKey.
- Prozessabbruch nach Commit: Retry findet vorhandenen Fill und rekonstruiert Resultat.
- Prozessabbruch zwischen Berechnung und Commit: kein Fill vorhanden; gleiche Inputs erzeugen nach Claim-Ablauf denselben Fill.
- Projektion fehlerhaft, Ledger korrekt: Projektion neu aufbauen und auditieren.
- Ledger unklar: niemals aus Projektion überschreiben; manuelle Auflösung.
