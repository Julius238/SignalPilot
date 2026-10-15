# Entwurf: Gates v4 — Portfolio-Mehrwert eigenständiger Strategiefamilien

> **Entwurf zur Prüfung durch den Betreiber, noch nicht festgeschrieben.**
> Stand 2026-10-15, Basis `0ca95f8`. Es gibt keinen Code, keinen Backtest
> und keinen KI-Lauf. Gates v1–v3 bleiben unverändert (Hashes
> `65da3536…`, `8341a3c7…`, `250bf745…`); die Risk Engine, insbesondere
> R-020, wird weder verändert noch umgangen. Der offizielle VPS-Forward-Test
> bleibt unberührt. Festgeschrieben wird v4 erst nach der Prüfung, mit eigenem
> Hash und ADR, **vor** dem ersten Experiment.
>
> Zugehörige Familie: [REGIME_PULLBACK_LONG](2026-10-15-evolution-family-regime-pullback-draft.md).

## 1. Auftrag und Umsetzung

Betreiberentscheidung vom 2026-10-15: Option B, also ein eigenes Gates v4 für
neue, eigenständige Familien. Die Diversifikationsprüfung wird dabei
ausdrücklich **nicht** dadurch gelockert, dass offene Challenger-Positionen bei
der Überschneidung ignoriert werden. Stattdessen bewertet v4 den zusätzlichen
Nutzen im Gesamtportfolio.

| Vorgabe | Umsetzung |
|---|---|
| 1. Familie unabhängig von bisherigen Einstiegslogiken | Strukturprüfung `INDEPENDENT_FAMILY` (Abschnitt 3); der Evaluator der Familie prüft kein Regime mehr und hat keinen Regime-Exit; R-020 wirkt allein in der Risk Engine |
| 2. Portfolio mit und ohne Kandidat, gleiches Gesamtkapital, gleiche übergeordnete Risikogrenzen | Methode `shared-pool-v1` (Abschnitt 4) |
| 3. Nettorendite, Sharpe, Drawdown, gleichzeitiges Risiko, Kapitalbindung, tatsächlicher Zusatzgewinn; kein Durchfallen nur wegen einer Challenger-Position | Prüfungen P1–P7 (Abschnitt 5.3). Die Überschneidung mit offenen Positionen wird gemessen und berichtet, entscheidet aber nicht |
| 4. Keine Scheindiversifikation | Prüfungen P8–P10 und die Redundanzprüfung (Abschnitt 5.4); Abschnitt 6 ordnet jedem bekannten Muster seine Prüfung zu |
| 5. Trade-Kennzahlen des Challengers nur bei vergleichbarer Geometrie als Mindestwerte | `TRADE_GEOMETRY` (Abschnitt 5.2) |
| 6. v1–v3 unverändert, v4 vorab registriert, Zähler und Vorwissen berücksichtigt | Abschnitte 7, 8 und 10 |
| 7. Risk Engine und R-020 unverändert | Der Pool verwendet nur Trades, die die Risk Engine im Backtest jedes Mitglieds bereits genehmigt hat. Er kann Trades streichen, aber keine hinzufügen (Abschnitt 4.1) |

## 2. Kurzfassung

- Für BREAKOUT_LONG und REGIME_LONG ist v4 **identisch** mit v3. Ein Test
  sichert das ab.
- Für Kandidaten einer **eigenständigen Familie** ersetzt v4 die
  Linienentscheidung von v3 durch eine **Portfolioentscheidung**:
  - Gleiches Kapital, gleiche Portfolio-Grenzen aus `RISK_LIMIT_SET_V1`.
  - Einmal mit, einmal ohne Kandidat.
  - Der Kandidat muss das Portfolio netto, risikobereinigt und in beiden
    Zeiträumen verbessern.
  - Er muss sein zusätzlich gebundenes Risiko und Kapital mindestens halb so
    gut verzinsen wie der Bestand.
  - Sein Ertrag muss überwiegend eigener Ertrag sein: signifikantes α,
    α-Anteil ≥ 50 %, höchstens die Hälfte seiner Schwankung durch bestehende
    Strategien erklärt.
- **Die v3-Maße Korrelation ≤ 0,5 und „bespielte Einstiege“ entscheiden in
  diesem Pfad nicht mehr.** Sie werden weiter berechnet und angezeigt. Ersetzt
  werden sie durch Wertmaße, die eine Scheindiversifikation direkt messen.
- **Trade-Kennzahlen bestehender Strategien** sind nur dann harte
  Mindestwerte, wenn Haltedauer **und** Handelsfrequenz vergleichbar sind
  (innerhalb Faktor 2).

## 3. Eigenständige Familie (Definition)

Eine Familie gilt nur dann als eigenständig, wenn **alle** Punkte erfüllt
sind. Das ist Teil ihrer eigenen Vorregistrierung und wird im Code geprüft
(`INDEPENDENT_FAMILY`, blockierend):

1. **Eigener Einstiegs-Evaluator** in einer eigenen Datei. Er ruft keinen
   Einstiegs-Evaluator einer anderen Strategie auf und prüft kein
   Regime-Gate. Ein Test über den Import-Graphen sichert das ab.
2. **Nur Einstiegsparameter sind suchbar.** Stop, Ziel und Haltedauer sind in
   der Familienspezifikation fest. Damit kann die Familie keine
   Ausstiegsvarianten erzeugen, also genau das Muster, das v3 bekämpft.
3. **Eigenes Startgenom und eigenes Raster**, vorregistriert mit Hash vor dem
   ersten Experiment.
4. **Läuft unverändert durch die Risk Engine** (Modus `SPEC`, alle Regeln
   einschließlich R-020 und R-008) als Research-Identität. Die Familie wird nie
   registriert, nie als `StrategyVersion` angelegt und ist nie live
   ausführbar.

## 4. Gemeinsames Portfolio (Methode `shared-pool-v1`)

### 4.1 Mitglieder

- **Bestand:** alle bestehenden Strategien wie in v3, also die Wurzeln
  (Champion, Challenger) und alle vom Betreiber freigegebenen Kandidaten aller
  Familien.
- **Mit Kandidat:** derselbe Bestand plus der Kandidat.
- **Trades:** Jedes Mitglied bringt die Trades aus seinem eigenen Backtest
  (Entdeckung + Validierung, im Finale auch Holdout) mit. Darin hat die Risk
  Engine schon jede Regel angewendet, auch R-020, R-008, höchstens 2 offene
  Positionen, höchstens 4 neue Trades je Tag, Verlustserie und kein Aufstocken.
- **Wirkung des Pools:** Er kann Trades nur **streichen**, nie hinzufügen
  oder verändern.

### 4.2 Kapital und Positionsgröße

- Ein gemeinsamer Kapitalpool mit 20 000 USDT Startkapital, in beiden
  Portfolios gleich. Alle Kennzahlen sind relativ, der Betrag dient nur dem
  Bericht.
- **Jeder Trade riskiert 0,25 % der Pool-Equity**, gemessen zum letzten
  Stundenmark vor dem Einstieg. Das ist `maxRiskPerTradePct` der Risk Engine.
- Der Mitglieds-Trade wird mit s = 0,25 % · Equity ÷ `plannedRisk` skaliert.
  Menge, Brutto-PnL, Gebühren, Spread und Slippage skalieren linear.
- Warum kein fester Kapitalanteil (½ gegen ⅓)? Ein Drittel für den
  Kandidaten würde die bestehenden Strategien verkleinern. Gemessen würde dann
  eine Umverteilung, nicht der Zusatz. Die Risk Engine bemisst ohnehin jeden
  Trade am Kapital des ganzen Portfolios.

### 4.3 Übergeordnete Grenzen

Die Grenzen sind in beiden Portfolios identisch. Die Werte stammen aus
`RISK_LIMIT_SET_V1` und werden im v4-Hash festgenagelt.

| Grenze | Wert | Herkunft |
|---|---|---|
| offenes Gesamtrisiko (Summe des Anfangsrisikos aller offenen Positionen) | ≤ 1,0 % der Equity | `maxDailyLossPct`: Auch ein gleichzeitiger Stop aller Positionen bleibt innerhalb des Tagesverlust-Limits. Zugleich das Höchstmaß des Bestands (2 Strategien × 2 Positionen × 0,25 %) |
| Tagesverlust | ab −1,0 % gegenüber dem Tagesbeginn (realisiert + Mark) keine neuen Einstiege bis Tagesende UTC | `maxDailyLossPct` (R-010) |
| Brutto-Exposure | ≤ 40 % der Equity | `maxGrossExposurePct` (R-013) |
| je Asset | ≤ 20 % | `maxAssetExposurePct` (R-014) |
| korrelierte Gruppe BTC + ETH | ≤ 30 % | `maxCorrelatedExposurePct` (R-015) |

**Nicht aggregiert** werden die Regeln, die heute je Strategie-Portfolio
gelten: höchstens 2 offene Positionen, höchstens 4 neue Trades je Tag,
Verlustserie, kein Aufstocken. Sie wirken weiter im Backtest jedes Mitglieds.

- Würde man „höchstens 2 offene Positionen“ unverändert auf das ganze
  Portfolio anwenden, wäre schon der Bestand nicht mehr darstellbar. Champion
  und Challenger brauchen auf zwei Symbolen bis zu vier Plätze.
- Außerdem würde der Kandidat dann blockiert, sobald der Challenger hält, was
  Vorgabe 3 ausschließt.
- Das Gesamtrisiko begrenzen stattdessen die Risiko-Obergrenze und der
  Tagesverlust.

### 4.4 Reihenfolge, wenn eine Grenze greift

- Einstiege werden chronologisch nach Eröffnungszeit verarbeitet.
- Bei gleicher Zeit geht der Bestand vor, in fester Reihenfolge: Champion,
  Challenger, freigegebene Kandidaten nach Schlüssel. Der Kandidat kommt
  zuletzt.
- Offene Positionen werden nie gekürzt.
- Ein blockierter Einstieg entfällt ganz, ohne Ersatz-Einstieg in einer
  späteren Stunde. Das ist **konservativ zulasten des Kandidaten**: Auch ein
  Bestandstrade, den er verdrängt, zählt voll gegen ihn, obwohl der Bestand in
  Wirklichkeit oft eine Stunde später einsteigen würde.

### 4.5 Bewertung

- Stündliches Mark-to-Market mit den 1h-Schlusskursen aus dem Markt-Snapshot
  des Laufs.
- Der Ausstieg folgt aus dem Brutto-PnL des Mitglieds-Trades.
- Tages-Equity ist der letzte Stundenwert, wie in den Mitglieds-Backtests.
- Sharpe aus Tagesrenditen mit √365, wie in v3.
- Kostenstress: Gebühren, Spread und Slippage aller Mitglieder analytisch
  verdoppelt.

### 4.6 Gemessene Größen (je Portfolio, je Fenster)

- Nettorendite, Sharpe, maximaler Drawdown, Rendite ÷ Drawdown.
- **Gleichzeitiges Risiko:** Ø und Spitze des offenen Gesamtrisikos;
  Anteil der Stunden mit ≥ 0,75 %.
- **Kapitalbindung:** Ø Brutto-Notional ÷ Equity.
- Schlechtester Tag; Tage mit Tagesverlust-Sperre.
- Ausgeführte und blockierte Trades je Mitglied, jeweils mit Grund.
- **Zusatzgewinn:** Netto-PnL der ausgeführten Kandidaten-Trades.
- **Verdrängung:** Netto-PnL der Bestandstrades, die nur wegen offener
  Kandidaten-Positionen blockiert wurden.
- **Klumpenrisiko** (nur Bericht): Anteil der Kandidaten-Risikostunden, in
  denen eine bestehende Strategie dasselbe Asset hält, und das v3-Maß
  „bespielte Einstiege“.

## 5. Prüfregeln für Kandidaten eigenständiger Familien

Entdeckung + Validierung heißt 2018-04 – 2023-12. „Je Fenster“ heißt
Entdeckung und Validierung getrennt. Die Schwellen sind Vorschläge zur
Prüfung (Abschnitt 11).

### 5.1 Basis: v1-Prüfungen des Kandidaten allein (Schwellen unverändert)

- Technik und Datenintegrität;
- ≥ 20 / ≥ 6 Trades;
- Entdeckung Ø R ≥ 0,05 und PF ≥ 1,15;
- Validierung Ø R > 0 und PF ≥ 1,0;
- doppelte Kosten > 0;
- Drawdown ≤ 10 %;
- ≥ 50 % positive Phasen, keine Phase > 65 %;
- Benchmark gegen den Champion.

Diese Schwellen sind **absolut**, nicht relativ zum Challenger.

### 5.2 Eigenständigkeit und Geometrie

| Prüfung | Bestanden, wenn | Wirkung |
|---|---|---|
| `INDEPENDENT_FAMILY` | Die Familie erfüllt Abschnitt 3, und der Hash ihrer Vorregistrierung passt zum Code | blockierend |
| `TRADE_GEOMETRY` | Für jede bestehende Strategie: Ist Ø Haltedauer **und** Trades je Jahr jeweils innerhalb Faktor 2 der Strategie, gelten deren v3-Trade-Toleranzen als harte Mindestwerte (Validierung Ø R ≥ Referenz − 0,05; PF ≥ 90 %; Ø R bei doppelten Kosten ≥ Referenz − 0,05; Trades ≥ 80 %). Weicht eines davon um Faktor 2 oder mehr ab, werden sie nur berichtet | blockierend nur bei vergleichbarer Geometrie |

Ø R und PF hängen an der Haltedauer, die Trade-Zahl an der Frequenz. Bei
deutlich anderer Geometrie messen diese Werte die Bauart, nicht die Qualität.
Wer dagegen gebaut ist wie eine bestehende Strategie, muss sich auch an deren
Trade-Qualität messen lassen.

### 5.3 Portfolio-Mehrwert (mit gegen ohne Kandidat, Abschnitt 4)

| Nr. | Prüfung | Bestanden, wenn |
|---|---|---|
| P1 | `PORTFOLIO_NET_GAIN` | ΔNettorendite > 0 über Entdeckung + Validierung **und** in jedem Fenster. Verdrängte Bestandstrades sind eingerechnet |
| P2 | `PORTFOLIO_SHARPE_GAIN` | ΔSharpe ≥ +0,10 über Entdeckung + Validierung, > 0 in jedem Fenster |
| P3 | `PORTFOLIO_DRAWDOWN` | max. Drawdown mit Kandidat ≤ 1,10 × ohne (gesamt und je Fenster) **und** Rendite ÷ Drawdown mit ≥ ohne (gesamt) |
| P4 | `PORTFOLIO_RISK_EFFICIENCY` | ΔNettorendite ÷ Δ Ø offenes Gesamtrisiko ≥ 0,5 × (Nettorendite ÷ Ø offenes Gesamtrisiko) ohne Kandidat. Steigt das Ø Risiko nicht, genügt P1 |
| P5 | `PORTFOLIO_CAPITAL_EFFICIENCY` | wie P4 mit Ø Kapitalbindung |
| P6 | `INCREMENT_STABILITY` | Zuwachs je Marktphase (Kalenderjahr, Netto-PnL mit minus ohne): ≥ 50 % der Phasen mit Kandidaten-Trades positiv, keine Phase trägt mehr als 65 % des positiven Zuwachses (v1-Schwellen) |
| P7 | `INCREMENT_COST_STRESS` | bei doppelten Kosten aller Mitglieder ΔNettorendite > 0 und ΔSharpe > 0 (gesamt) |

P4 und P5 verhindern, dass mehr Ertrag nur aus mehr gebundenem Risiko oder
Kapital kommt, also ein reiner Hebeleffekt ist. Der Faktor 0,5 lässt einen
Zusatz zu, der weniger effizient ist als der Bestand. Der Zusatz muss dann
aber über P2 und die α-Prüfungen diversifizieren.

### 5.4 Keine Scheindiversifikation

Grundlage ist die Regression der Monatsrenditen des Kandidaten auf jede
bestehende Strategie als eigenen Regressor. Das ist die unveränderte
v3-Methode `alpha`, eine gemeinsame Regression und keine Mischung.

| Nr. | Prüfung | Bestanden, wenn |
|---|---|---|
| – | `REDUNDANCY` (v1, unverändert) | Korrelation der Tagesrenditen ≤ 0,9 mit jeder bestehenden Strategie |
| P8 | `OWN_ALPHA` | α-t ≥ max(2,0; √(2·ln N); t₀,₉₇₅ mit n − K − 1 Freiheitsgraden), mindestens 36 Monate, davon 24 mit eigenem Ertrag |
| P9 | `ALPHA_SHARE` | α̂ ≥ 50 % der Ø Monatsrendite des Kandidaten (gesamt) **und** α̂ > 0 in jedem Fenster |
| P10 | `OWN_VARIANCE` | R² der Regression ≤ 0,5: höchstens die Hälfte der Monatsschwankung wird durch bestehende Strategien erklärt (entspricht einer multiplen Korrelation ≤ 0,71) |

P9 misst, ob der **Ertrag** eigener Ertrag ist. P10 misst, ob die
**Bewegungen** eigene Bewegungen sind. Zusammen mit P8 heißt das: Eine
Strategie, „die nur dieselben Marktbewegungen anders handelt“, scheitert.
Das gilt auch dann, wenn ihre Positionen zeitlich mit dem Challenger
zusammenfallen.

### 5.5 Entscheidung `PORTFOLIO_DECISION`

- **Bestanden** nur, wenn 5.1, `INDEPENDENT_FAMILY`, die harten Teile von
  `TRADE_GEOMETRY` und P1–P10 alle bestehen.
- **Für spätere Generationen** derselben Familie gilt ein zweiter Weg,
  sobald die Familie freigegebene Mitglieder hat: v3-Pfad A gegen den besten
  freigegebenen Vertreter der eigenen Familie. Innerhalb der Familie ist die
  Geometrie gleich, deshalb sind die Trade-Toleranzen dort sachgerecht.
  - Ein freigegebener Familienvertreter ist zugleich Teil des Bestands.
  - Eine bloße Variante von ihm scheitert deshalb am Portfolio-Weg (α ≈ 0)
    und muss ihn über Pfad A schlagen.
- **Das Startgenom** hat nur den Portfolio-Weg.

### 5.6 Finale und Holdout

- Alle v1-Finalprüfungen: Nachbarvarianten mit Ø R > 0, Walk-Forward mit
  Effizienz ≥ 0,25, Holdout mit ≥ 5 Trades, Ø R > 0 und PF ≥ 1.
- Zusätzlich muss **jede Nachbarvariante** im Pool ΔNettorendite > 0 und
  ΔSharpe > 0 erreichen (gesamt).
- **Holdout-Schutz im Pool:** ΔSharpe ≥ −0,05 und ΔNettorendite ≥ 0. Der
  Holdout ist bereits analysiert und **nie Nachweis**, er kann nur stoppen.

### 5.7 Budget und Zähler

- Das v3-Familienbudget gilt unverändert: 10 Validierungsprüfungen je Familie
  und Monat, über alle Versionen gezählt, und höchstens ein Finalist je
  Familie und Durchlauf.
- Strengere Grenzen aus der Familien-Vorregistrierung gelten zusätzlich.
- Der Mehrfachtest-Zähler N läuft mit der unveränderten Methode weiter
  (heute 52). Er wird nie zurückgesetzt.

## 6. Wie v4 Scheindiversifikation abfängt

| Muster | Beispiel | Abgelehnt durch |
|---|---|---|
| Ausstiegsvariante einer bestehenden Strategie | EVO-REG-0006 – 0010 | In einer eigenständigen Familie unmöglich, weil die Ausstiege fest sind. Solche Varianten bleiben in ihrer Familie unter den v3-Regeln |
| Kopie oder Neugewichtung bestehender Strategien | dieselben Positionen, anders gewichtet | P8 (α ≈ 0), P9, P10, Redundanz |
| Mehr Risiko auf dieselben Bewegungen | zusätzlicher Long an Challenger-Tagen ohne Timing-Vorteil | P2 (Sharpe steigt nicht), P4/P5, P9/P10 |
| Verdünnung | schwankungsarmer Zusatz fast ohne Ertrag, der nur die Volatilität senkt | P1, P4/P5, P8 |
| Glückstreffer | Ertrag aus einem Jahr oder wenigen Trades | P6, „in jedem Fenster“ bei P1/P2/P9, Mehrfachtest-Schwelle in P8, Nachbarn, Walk-Forward |
| Ertrag nur bei günstiger Ausführung | knapper Vorteil pro Trade | P7, v1-Kostenstress |
| Verdrängung | Kandidat blockiert Bestandstrades | in P1 eingerechnet, konservativ ohne Ersatz-Einstieg |

## 7. Methoden (Teil des v4-Hashes)

| Kennung | Bedeutung |
|---|---|
| alle v3-Methoden | unverändert: `sharpe`, `paired`, `alpha`, `signalOverlap`, `portfolio` (nur für v3-Pfad B der alten Familien), `trials` |
| `pool` | `shared-pool-v1`: Abschnitt 4 (gemeinsames Kapital, 0,25 % je Trade von der Pool-Equity, Reihenfolge Bestand vor Kandidat, kein Ersatz-Einstieg, stündliche Marks) |
| `poolLimits` | die fünf Werte aus 4.3, festgenagelt (nicht per Verweis) |
| `geometry` | Ø Haltedauer und Trades je Jahr über Entdeckung + Validierung, Faktor 2 |
| `efficiency` | ΔNettorendite ÷ Δ Ø offenes Risiko bzw. Δ Ø Kapitalbindung, Faktor 0,5 gegen den Bestand |
| `alphaShare` | α̂ ÷ Ø Monatsrendite und R² aus derselben Regression wie `alpha` |
| `increment` | ΔNetto-PnL je Kalenderjahr-Phase |

## 8. Was unverändert bleibt

- Gates v1–v3: Code, Schwellen, Methoden und Hashes. Frühere Entscheidungen
  werden nicht neu bewertet. Bekannte Genome und Nachbarn bleiben gesperrt.
  EVO-REG-0004 bleibt `REJECTED_BY_OPERATOR`.
- BREAKOUT_LONG- und REGIME_LONG-Kandidaten unter v4 entscheiden exakt wie
  unter v3. Ein Gleichheitstest auf gespeicherten Kandidaten sichert das ab.
- Split `evolution-split-v1` mit Holdout als `PREVIOUSLY_ANALYZED`,
  Kostenmodell, Daten-Lader mit Forward-Sperre, Zählmethode, Familienbudgets
  und KI-Budget.
- Risk Engine mit allen Regeln (R-020, R-008, Limitset), Strategie-Registry,
  Spezifikations-Hashes und Golden Fixtures von Champion und Challenger.
- Arena V1, Portfolios und Sessions des offiziellen Forward-Tests, VPS.

## 9. Technische Integration

### 9.1 Bausteine

| Bereich | Neu oder geändert |
|---|---|
| `packages/evolution/src/pool.ts` (neu, rein) | `simulateSharedPool({ members, hourlyCloses, limits, from, to })` → Stunden- und Tages-Equity, ausgeführte und blockierte Trades je Mitglied (mit Grund), Risiko- und Kapitalbindung, Zusatzgewinn, Verdrängung, Klumpenrisiko; `poolComparison(base, withCandidate, windows)` → Deltas für P1–P7 |
| `packages/evolution/src/gates-v4.ts` (neu) | `EVOLUTION_GATES_V4 = { ...EVOLUTION_GATES_V3, version: "evolution-gates-v4", independentFamily: {...} }` mit allen Schwellen und Methodenkennungen; `independentFamilyGates(input, gates)`; `isGatesV4`; Hash festgenagelt. Alte Familien laufen über `lineageScreeningGates` aus v3 |
| `gates.ts` | nur der Typ `GateId` wird additiv erweitert; `EVOLUTION_GATES_V1` und sein Hash bleiben unberührt |
| `gate-versions.ts` | `v4` registrieren; Standard erst beim Festschreiben umstellen (Abschnitt 11) |
| `paired.ts` | `spanningAlphaTest` wiederverwenden; zusätzlich α̂, Ø Monatsrendite und R² ausgeben (additiv) |
| `genome.ts`, `lineage.ts` | Familie REGIME_PULLBACK_LONG mit Beschreibung `independence` (Evaluator, „nur Einstieg“, feste Ausstiege, Vorregistrierungs-Hash), Startgenom, Präfix `RPB`; Einzelheiten im Familienentwurf |
| `context.ts`, `prompt.ts`, `report.ts` | Die KI sieht für eigenständige Familien die Pool-Kennzahlen nur auf Entdeckungsdaten und für die Validierung nur das Urteil (Leak-Prüfung wie bisher); der Bericht zeigt den Pool-Vergleich |
| `packages/strategy-engine` | eigener Evaluator der Familie (siehe Familienentwurf); Challenger- und Champion-Dateien bleiben byte-gleich |
| `apps/evolution-worker` | `researchCycle.ts`: Für Kandidaten eigenständiger Familien wird in Schritt 5d der Bestand aus den gecachten Referenz-Backtests zusammengestellt; der Pool-Bestand wird je Lauf und Fenster einmal gerechnet; 1h-Schlusskurse kommen aus dem bereits geladenen Markt-Snapshot, ohne neue Datenquelle. `cli.ts`: `evolution evaluate-seed --family=… --actor=…` ohne KI-Aufruf. Ergebnisse werden in `metricsJson.portfolioV4` und `gatesJson` gespeichert, ohne Migration. Das Manifest erhält Gate-Version, v4-Hash und den Hash der Familien-Vorregistrierung |
| `apps/dashboard`, `apps/api` | Beschriftungen der neuen Prüfungen und eine Pool-Vergleichstabelle auf der Kandidatenseite; nur lesend |

### 9.2 Tests

**Pool:**

- Skalierung, Kosten und Ausstiegspreis exakt;
- Grenzen blockieren in der festgelegten Reihenfolge;
- offene Positionen werden nie gekürzt;
- der Bestand allein ist mit und ohne leeren Kandidaten identisch;
- der Pool erzeugt nie einen Trade, den kein Mitglied hatte (Eigenschaftstest).

**Gates v4:**

- Hash festgenagelt;
- Hashes von v1–v3 unverändert;
- gespeicherte BREAKOUT_LONG- und REGIME_LONG-Kandidaten erhalten unter v4
  dieselben Urteile wie unter v3;
- jede Prüfung P1–P10 und die Geometrie-Weiche einzeln mit Grenzfällen;
- synthetische Scheindiversifikation (Kopie, Neugewichtung, Hebel,
  Verdünnung) wird abgelehnt.

**Familie und Ablauf:**

- Familie unabhängig: Der Import-Graph zeigt keinen fremden
  Einstiegs-Evaluator.
- Ende-zu-Ende mit Mock-Daten über `evaluate-seed`.
- Kontext ohne Leck.

### 9.3 Reihenfolge der Commits

Jeder Schritt ist für sich grün; danach folgt kein Lauf.

1. `pool.ts` mit Tests.
2. `gates-v4.ts`, Registrierung, Hash- und Gleichheitstests.
3. Evaluator der Familie mit Tests.
4. Familie in `packages/evolution` mit Tests.
5. Worker-Integration, `evaluate-seed`, Ende-zu-Ende-Test.
6. Dashboard-Beschriftungen.
7. Endgültige Vorregistrierungen (v4 und Familie) mit Hashes und ADR 0019.

Grobe Schätzung: zwei bis drei Arbeitstage.

## 10. Ablauf bis zum ersten Experiment

1. **Prüfung dieses Entwurfs** durch den Betreiber (offene Punkte in
   Abschnitt 11).
2. **Implementierung** nach eigener Freigabe, auf
   `claude/inspiring-noether-rjh92d`. Kein Merge nach `main`, kein VPS.
3. **Gegenprobe auf gespeicherten Daten**, ohne neue Backtests und ohne KI:
   - Der Portfolio-Weg wird auf die bekannten Kandidaten EVO-REG-0004 –
     0010 angewendet, als wären sie eigenständig. Das sind sie nicht, deshalb
     ist das nur zur Veranschaulichung.
   - Erwartung: Alle scheitern an P8–P10, weil sie fast nur Challenger-Ertrag
     sind.
   - Zeigt die Probe eine Schwäche, wird **vor** dem Festschreiben verschärft,
     nie gelockert. Probe und etwaige Änderungen werden dokumentiert.
4. **Festschreiben:** endgültige Vorregistrierung von v4 und der Familie mit
   Hashes und ADR 0019, committet vor jedem Experiment.
5. **Stufe 1, Startgenom** nach eigener Freigabe: ohne KI-Kosten, N steigt um
   1 bis 3.

## 11. Offene Punkte zur Prüfung

| Punkt | Vorschlag | Bemerkung |
|---|---|---|
| Obergrenze offenes Gesamtrisiko | 1,0 % | aus `maxDailyLossPct`; alternativ 0,75 % (strenger) |
| Drawdown-Toleranz | ≤ 1,10 × und Rendite ÷ DD nicht schlechter | v3-Pfad B verlangte „nicht größer“, aber mit getrennten Konten, bei denen jedes neue Mitglied zusätzliches Kapital mitbringt und den Drawdown dämpft. Im gemeinsamen Pool erhöht jeder Zusatz das Risiko auf demselben Kapital |
| Effizienzfaktor P4/P5 | 0,5 | 1,0 hieße „mindestens so effizient wie der Bestand“ und würde gute Diversifizierer ausschließen |
| α-Anteil, R² | ≥ 50 %, ≤ 0,5 | Kern der Abwehr von Scheindiversifikation |
| Geometrie-Faktor | 2 | gilt je Dimension; Trade-Toleranzen sind nur hart, wenn beide Dimensionen vergleichbar sind |
| Reihenfolge bei Gleichstand | Bestand vor Kandidat | konservativ |
| Standard-Gate-Version | beim Festschreiben auf v4 umstellen | für alte Familien ohne Wirkung; Manifeste tragen dann den v4-Hash |
| Späterer Forward-Test | – | Ein Forward-Test der Familie bräuchte ihren Schlüssel in `APPROVED_LONG_STRATEGY_KEYS`. Das ändert die Identität der Risk-Policy, nicht ihre Regeln. Es verträgt sich daher nicht ohne Weiteres mit „Risk Engine unverändert“ und ist erst vor einem Forward-Test gesondert zu entscheiden |

## 12. Einordnung

- **v4 stellt die richtige Frage:** Verdient das Portfolio mit der neuen
  Familie bei gleichem Kapital und gleichen Grenzen nachweisbar mehr, und
  stammt dieser Mehrertrag aus eigener Quelle?
- **Es ist keine bloße Lockerung von v3.** Die beiden Ähnlichkeitsmaße
  (Korrelation ≤ 0,5, bespielte Einstiege) werden durch Wertmaße ersetzt.
  Diese sind in vielem strenger:
  - Netto-Zuwachs in beiden Fenstern;
  - Drawdown;
  - Risiko- und Kapitaleffizienz;
  - α-Anteil und eigene Schwankung;
  - Stabilität und Kostenstress des Zuwachses.
- **Lockerer ist v4 an genau einer Stelle:** Eine Korrelation zwischen 0,5
  und 0,71 wird zugelassen, wenn der Mehrwert belegt ist.
- **Die höchste Hürde bleibt die Statistik.** Ein α mit t ≥ 2,82 ist mit
  wenigen, kurzen Trades schwer zu erreichen. Das Startgenom hat auch unter
  v4 eher geringe Aussichten. Ein Scheitern wäre aber erstmals eine
  aussagekräftige Antwort auf die Frage, ob Einstiegs-Timing innerhalb des
  Regimes etwas Eigenes verdient.
