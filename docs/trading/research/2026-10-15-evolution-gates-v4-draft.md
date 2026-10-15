# Entwurf: Gates v4 — Portfolio-Mehrwert eigenständiger Strategiefamilien

> **Entwurf zur Prüfung durch den Betreiber, noch nicht festgeschrieben.**
> Stand 2026-10-15, zweite Fassung. Es gibt keinen Code, keinen Backtest
> und keinen KI-Lauf.
>
> - Gates v1–v3 bleiben unverändert (Hashes `65da3536…`, `8341a3c7…`,
>   `250bf745…`).
> - Das Paket `@signalpilot/risk-engine` bleibt unverändert: keine Regel,
>   kein Grenzwert, keine Freigabeliste, kein Refactoring.
> - Der offizielle VPS-Forward-Test bleibt unberührt.
> - v4 wird erst nach der Prüfung mit Hash und ADR festgeschrieben, **vor**
>   dem ersten Experiment.
>
> Zugehörige Familie: [REGIME_PULLBACK_LONG](2026-10-15-evolution-family-regime-pullback-draft.md).

## 1. Auftrag und Umsetzung

| # | Anforderung des Betreibers | Umsetzung |
|---|---|---|
| 1 | Chronologische Simulation mit echten Einstiegen, Fills, Exits, Gebühren, Kapitalbindung und Risikolimits; kein Zusammenrechnen | Abschnitt 3: eine Uhr, alle Strategien, Stunde für Stunde, mit denselben Produktionsbausteinen wie der Shadow-Replay |
| 2 | Gleiches Gesamtkapital, Gewichte vorab fest, keine Gewichtsoptimierung | Abschnitt 3.2: feste Plätze à 20 000 USDT; eine andere Gewichtung wird nie gerechnet oder berichtet |
| 3 | Risk-Regeln unverändert; die Gesamtprüfung begrenzt nur; exakte Dokumentation der Wiederverwendung | Abschnitt 4: Stufe 1 = unverändertes `evaluateRisk`; Stufe 2 = unveränderte Regelfunktionen aus `RISK_RULES` auf einer Gesamtsicht, nur nach einer Freigabe in Stufe 1 |
| 4 | Angepasste Schwellenwerte; belastbarer Zusatzertrag nach Kosten bei kontrolliertem Risiko | Abschnitte 5 und 6 |
| 5 | Strenge Statistik; Bekanntes ist kein Nachweis; alles vorregistriert | P8 und P9 mit Mehrfachtest-Schwelle (Abschnitt 5.4); Abschnitte 5.8 und 10 |
| 6 | Eigene Strategieidentität für REGIME_PULLBACK_LONG; keine falsche Zuordnung, keine spätere Umgehung der Freigabeliste | Abschnitt 7 |
| 7 | Gates v1–v3 und VPS-Forward-Test unverändert | Abschnitt 9 |

## 2. Kurzfassung

- **Geltungsbereich.** Für BREAKOUT_LONG und REGIME_LONG ist v4 identisch mit
  v3; ein Test sichert das ab. Für Kandidaten einer **eigenständigen
  Familie** ersetzt v4 die Linienentscheidung durch eine
  **Portfolioentscheidung**.
- **Simulation.** Der Bestand (Champion, Challenger, freigegebene Kandidaten)
  wird einmal mit einem leeren Reserveplatz und einmal mit dem Kandidaten auf
  diesem Platz gerechnet. Beide Läufe sind chronologisch und nutzen dasselbe
  Gesamtkapital.
- **Risikoprüfung.** Jeder Einstieg wird zweimal geprüft:
  - zuerst vollständig gegen das eigene Strategie-Portfolio, genau wie live;
  - dann zusätzlich gegen die Gesamtsicht aller Portfolios.
  - Die zweite Prüfung kann nur ablehnen.
- **Entscheidend:**
  - Der Gesamtertrag steigt nach Kosten in beiden Zeiträumen.
  - Er steigt **statistisch belastbar**: gepaarter Monatsvergleich mit
    Mehrfachtest-Schwelle (P9).
  - Er stammt aus eigener Quelle: signifikantes α gegenüber den bestehenden
    Strategien (P8).
  - Das Risiko bleibt kontrolliert: Rendite je Drawdown nicht schlechter,
    Risiko- und Kapitaleffizienz, Kostenstress.
- **Gestrichen oder nur noch berichtet** werden die Schwellen, die wertvolle
  Strategien systematisch ausschließen (Begründung in Abschnitt 6):
  - ΔSharpe ≥ +0,10 bei festem Gewicht;
  - Drawdown ≤ 1,10 ×;
  - α-Anteil ≥ 50 %;
  - R² ≤ 0,5.

## 3. Chronologische Portfolio-Simulation (`portfolio-replay-v1`)

### 3.1 Grundsatz

Die Simulation erweitert den bestehenden Shadow-Replay. Sie ersetzt ihn
nicht und rechnet keine Einzel-Backtests zusammen.

**Gleiche Bausteine wie der Einzel-Replay:**

- Fills: Market-Fill, Einstiegslücke, Ablauf nach 2 Kerzen
  (`trading-simulation`).
- Ledger, Reservierungen, konservative Marks, Bewertung und
  Tagesbeginn-Snapshot (`@signalpilot/portfolio`).
- Risk Engine (`evaluateRisk`) und Fill-Nachprüfung
  (`computePostFillNetRewardRisk`).
- Kennzahlen (`performance-intelligence`).

**Neu ist nur:**

- mehrere Strategie-Portfolios und beide Symbole in **einer** gemeinsamen
  Zeitschleife;
- die Gesamtsicht über alle Portfolios (Abschnitt 4).

### 3.2 Kapitalrahmen: vorab fest

| | Plätze (je 20 000 USDT) | Gesamtkapital |
|---|---|---|
| Vergleich **A** (ohne Kandidat) | Champion, Challenger, je freigegebener Kandidat ein Platz, **ein Reserveplatz als Kasse** | 20 000 × (Bestand + 1) |
| Vergleich **B** (mit Kandidat) | derselbe Bestand, der Kandidat **auf dem Reserveplatz** | identisch |

- Heute heißt das 60 000 USDT: drei Plätze in A wie in B.
- Jeder Platz ist ein **eigenes Strategie-Portfolio mit beiden Symbolen**
  (BTCUSDT, ETHUSDT), wie ein Shadow-Portfolio im Live-Betrieb. Die
  Risk-Engine-Regeln gelten je Portfolio über beide Symbole hinweg (siehe
  Entscheidung T1 in Abschnitt 11).
- Die Positionsgröße bestimmt die Risk Engine je Portfolio unverändert: 0,25 %
  Risiko der Portfolio-Equity.
- **Keine Optimierung der Gewichtung.**
  - Gerechnet werden ausschließlich A und B mit gleich großen Plätzen.
  - Keine andere Gewichtung wird gerechnet, gespeichert, angezeigt oder an die
    KI gemeldet.
  - Die Platzgröße ist Teil des v4-Hashes.
  - Über eine andere Kapitalverteilung im Live-Betrieb entscheidet der
    Betreiber getrennt und nach dem Forward-Test.

### 3.3 Ablauf je Stunde (feste Reihenfolge)

Für jede geschlossene 1h-Ankerkerze:

1. **Fills.** Für jedes Portfolio und jedes Symbol, in fester Reihenfolge,
   versuchen offene Einstiegsorders zu füllen (Logik des Einzel-Replays).
2. **Positionen überwachen.**
   - Reihenfolge: Stop zuerst, dann Ziel, dann Zeit-Exit.
   - Ein Regime-Exit gilt nur für Strategien, die ihn spezifizieren
     (Challenger ja, REGIME_PULLBACK_LONG nein).
3. **Bewertung.**
   - Jedes Portfolio wird zum Kerzenschluss bewertet.
   - An einem neuen UTC-Tag wird ein Tagesbeginn-Snapshot je Portfolio
     erzeugt, zusätzlich einer für die Gesamtsicht.
4. **Gesamtsicht aktualisieren** (Abschnitt 4.3).
5. **Entscheidungen.**
   - Reihenfolge der Portfolios: Champion, Challenger, freigegebene Kandidaten
     nach Schlüssel, Kandidat bzw. Reserve. Symbole: BTCUSDT, dann ETHUSDT.
   - Je Paar: Evaluator → Stufe 1 → Stufe 2 → Reservierung.
   - Eine Reservierung geht sofort in die Gesamtsicht ein. Das nächste
     Portfolio in derselben Stunde sieht sie also bereits.

Ein abgelehnter Einstieg wird nicht nachgeholt oder ersetzt. Die Strategie
bewertet in der nächsten Stunde neu, wie live.

### 3.4 Gemessene Größen (je Vergleich, je Fenster)

- Nettorendite des Gesamtkapitals nach allen Kosten.
- Sharpe aus Tagesrenditen mit √365, wie in v3.
- Maximaler Drawdown und Rendite ÷ Drawdown.
- **Gleichzeitiges Risiko:** Ø und Spitze des Anfangsrisikos aller offenen
  Positionen ÷ Gesamt-Equity.
- **Kapitalbindung:** Ø Brutto-Notional ÷ Gesamt-Equity.
- Schlechtester Tag und Tage mit Gruppen-Tagesverlust-Sperre.
- Ausgeführte und abgelehnte Einstiege je Portfolio, getrennt nach Stufe 1
  und Stufe 2, jeweils mit Regelcode.
- **Zusatzgewinn:** Netto-PnL der Kandidaten-Trades in B.
- **Verdrängung:** Bestandstrades, die in A ausgeführt, in B aber von Stufe 2
  abgelehnt wurden, mit ihrem Netto-PnL aus A.
- Nur zur Information: Klumpenrisiko (Kandidaten-Risikostunden, in denen eine
  bestehende Strategie dasselbe Asset hält), das v3-Maß „bespielte
  Einstiege“ und Korrelationen.

### 3.5 Determinismus und Laufzeit

- Ohne Uhrzeit und Zufall, mit deterministischen IDs und einem `outputHash`
  wie im Einzel-Replay.
- Die Strategie-Bewertung hängt nicht vom Portfolio-Zustand ab. Sie wird je
  Strategie, Symbol und Stunde vorab parallel berechnet und gecacht. Nur die
  Schleife aus Fills, Exits und Risikoprüfung läuft sequenziell.
- Geschätzt: Entdeckung + Validierung für A und B zusammen etwa 20–30
  CPU-Minuten.

## 4. Doppelte Risikoprüfung: genaue Wiederverwendung

### 4.1 Stufe 1: das eigene Strategie-Portfolio

- **Code:** `evaluateRisk(snapshot)` aus `@signalpilot/risk-engine`,
  unverändert. Der Snapshot entsteht mit der bestehenden Replay-Funktion
  `buildRiskSnapshot` aus dem Zustand **dieses** Portfolios.
- **Inhalt:**
  - Alle 26 Regeln laufen, mit Limitset v1 und Policy v1.
  - Die Größe berechnet `computePositionSizing` in `evaluateRisk`.
  - Kill-Switch und `ERROR_LOCK` wirken wie im Einzel-Replay, einschließlich
    der Annahme einer Freigabe nach 24 h.
- **Wirkung:** Nur `APPROVED` geht weiter. Menge, Stop und Ziel stehen ab
  hier fest.

### 4.2 Stufe 2: die Gesamtsicht, nur nach Freigabe in Stufe 1

- **Code:** dieselben, unveränderten Regelfunktionen aus der exportierten
  Tabelle `RISK_RULES`, nur diese vier:

  | Regel | Prüft in der Gesamtsicht |
  |---|---|
  | `R-010-DAILY-LOSS` | Tagesverlust aller Portfolios ≤ 1 % der Gesamt-Equity zum Tagesbeginn |
  | `R-013-GROSS-EXPOSURE` | Brutto-Exposure aller Portfolios nach dem Trade ≤ 40 % |
  | `R-014-ASSET-EXPOSURE` | Exposure im Asset über alle Portfolios ≤ 20 % |
  | `R-015-CORRELATION` | BTC + ETH über alle Portfolios ≤ 30 % |

- **Eingabe:** ein Gruppenkontext vom exportierten Typ
  `RiskEvaluationContext`. Ihn baut die neue, versionierte Research-Funktion
  `buildGroupRiskContext` (`group-risk-v1`, im Paket `shadow-replay`).

  | Feld | Wert |
  |---|---|
  | `snapshot` | der Stufe-1-Snapshot desselben Kandidaten; nur `startOfDay.equity` wird durch die Gesamt-Equity zum Tagesbeginn ersetzt und `dailyCounters.dailyPnl` durch das Tagesergebnis aller Portfolios |
  | `equity` | Summe der Equity aller Portfolios plus Reserve-Kasse |
  | `grossExposure`, `assetExposure`, `correlatedExposure` | Summen über alle Portfolios, mit **denselben Formeln** wie in `evaluateRisk`: Marktwert der Positionen mit Exposure plus offene ENTRY-Reservierungen, nach Asset bzw. Korrelationsgruppe gefiltert |
  | `sizing` | das Stufe-1-Ergebnis mit **unveränderter Menge**; nur die drei Felder `postTrade…Exposure` werden auf Gesamtsicht + Notional des Trades umgerechnet |
  | `dailyPnl` | Tagesergebnis aller Portfolios |
  | `assetAlreadyOpen` | ob **das eigene Portfolio** des Kandidaten schon eine Position mit Exposure im Asset hält, berechnet wie in `evaluateRisk`. Nach einer Freigabe in Stufe 1 ist das nachweislich `false` (Abschnitt 4.6) |
  | übrige Felder | wie in Stufe 1; die vier Regeln lesen sie nicht |

- **Wirkung:**
  - `FAIL` oder `ERROR` einer der vier Regeln lehnt den Einstieg ab
    (Grund: Regelcode mit Zusatz `GROUP`). `WARN` lehnt nicht ab, genau wie
    in `evaluateRisk`.
  - Schlägt `R-010` in der Gesamtsicht an (`ENGAGE_KILL_SWITCH`), sind neue
    Einstiege **aller** Portfolios bis zur Freigabe nach 24 h gesperrt. Das
    ist dieselbe Annahme wie beim Kill-Switch im Einzel-Replay.

### 4.3 Garantien

1. Stufe 2 läuft nur nach `APPROVED` in Stufe 1. Die Gesamtentscheidung ist
   Stufe 1 **und** Stufe 2. Ein Trade, den die normale Risk Engine
   abgelehnt hat, ist damit ausgeschlossen.
2. Stufe 2 ändert weder Menge, Preise noch Richtung. Sie kann nur ablehnen.
3. Keine Regelfunktion, kein Grenzwert, keine Policy und keine Freigabeliste
   wird verändert. Das Risk-Engine-Paket bleibt byte-gleich. Ein Test
   vergleicht die Hashes von Policy, Limitset und Regelreihenfolge.
4. **Treuetest:** Bei einer Gesamtsicht aus genau einem Portfolio müssen die
   `inputJson`-Werte der vier Regeln aus Stufe 2 mit denen aus den
   Stufe-1-`ruleResults` übereinstimmen: aktuelle Exposure, Exposure nach dem
   Trade, Equity. So ist belegt, dass die Aggregation dieselben Formeln nutzt.

### 4.4 Warum nicht einfach `evaluateRisk` auf die Gesamtsicht

1. **Falsche Menge.** `evaluateRisk` berechnet die Positionsgröße selbst aus
   der Equity. Mit der Gesamt-Equity entstünde bei drei Plätzen die
   dreifache Menge eines Trades, den es nie gab.
2. **Falsche Sperren.** Mehrere Regeln sind portfoliobezogene
   Ausschlussregeln:
   - `R-011`: höchstens 2 offene Positionen;
   - `R-012`: höchstens 4 Einstiege je Tag;
   - `R-021`: Verlustserie;
   - `R-022`: kein Aufstocken im selben Asset, kritisch mit `ERROR_LOCK`;
   - der Duplikat-Teil von `R-014`.

   In der Gesamtsicht würden sie einen Kandidaten nur deshalb sperren, weil
   **ein anderes** Portfolio dasselbe Asset hält. Genau das ist
   ausgeschlossen. Diese Regeln wirken vollständig in Stufe 1 für das eigene
   Portfolio, so wie live.
3. **Zu `assetAlreadyOpen`.** `R-014` enthält vor der Exposure-Grenze eine
   Duplikatsperre. Wie sie in der Gesamtsicht behandelt wird, beschreibt
   Abschnitt 4.6.

### 4.5 Bewusst nicht enthalten

- Keine zusätzliche Grenze, die es in der Risk Engine nicht gibt, zum
  Beispiel keine Obergrenze für das offene Gesamtrisiko. Das gleichzeitige
  Risiko wird gemessen und über P4 bewertet.
- Mit den heutigen Größen werden die vier Gruppenregeln selten greifen: 0,25 %
  je Trade von 20 000 USDT entspricht 0,083 % des Gesamtkapitals. Die
  Simulation belegt das, statt es anzunehmen.

### 4.6 R-014 und die Auswahl der Gruppenregeln (geprüft vor der Implementierung)

Auf Wunsch des Betreibers wurden alle 26 Regelfunktionen in
`packages/risk-engine/src/rules.ts` darauf geprüft, ob sie in der Gesamtsicht
eine portfolioübergreifende Grenze durchsetzen oder eine Sperre enthalten, die
nur innerhalb eines Portfolios Sinn ergibt.

**`R-014-ASSET-EXPOSURE` (`ruleAssetExposure`) besteht aus zwei Teilen:**

1. **Duplikatsperre:** Ist `ctx.assetAlreadyOpen` wahr, liefert die Regel
   `FAIL` mit `DUPLICATE_ASSET_POSITION`, noch vor jeder Exposure-Prüfung.
   `evaluateRisk` setzt den Wert, wenn **irgendeine** Position im Snapshot
   dasselbe Asset hält.
2. **Exposure-Grenze:** Exposure im Asset nach dem Trade ≤
   `maxAssetExposurePct` × Equity (`exposureRule`).

**Folgerung: Mit einem Gruppensnapshot ist R-014 unverändert nicht geeignet.**
Würde man `assetAlreadyOpen` aus allen Portfolios ableiten, sperrte Teil 1
jeden Einstieg, sobald ein **anderes** Strategie-Portfolio dasselbe Asset hält.
Zwei unabhängige Portfolios könnten dasselbe Asset dann nie gleichzeitig halten.

**Gewählte Lösung:**

- Die Regelfunktion bleibt unverändert.
- Das Feld `assetAlreadyOpen` erhält in der Gesamtsicht seine
  portfolioeigene Bedeutung: Es zeigt an, ob **das Portfolio des Kandidaten
  selbst** das Asset schon hält. Es wird aus den eigenen Positionen berechnet,
  nicht als Konstante gesetzt.
- Stufe 2 läuft nur nach `APPROVED` in Stufe 1. Dort hat dieselbe Regel R-014
  das eigene Portfolio bereits geprüft, und R-022 hat zusätzlich offene
  Positionen **und** offene Einstiegsorders im Asset ausgeschlossen. Deshalb
  ist der Wert in Stufe 2 immer `false`.
- R-014 erreicht damit in der Gesamtsicht immer Teil 2. Dieser prüft die
  Asset-Exposure über **alle** Portfolios gegen 20 % der Gesamt-Equity, mit
  genau der Rundung und dem Vergleich der Risk Engine.
- Ein Test belegt das mit zwei Fällen:
  - Zwei Portfolios halten dasselbe Asset unter der Grenze: Stufe 2 lässt den
    Einstieg zu.
  - Über der Grenze: Stufe 2 lehnt mit `MAX_ASSET_EXPOSURE` ab, nie mit
    `DUPLICATE_ASSET_POSITION`.

**Ergebnis der Prüfung aller Regeln:**

| Regel | in Stufe 2? | Begründung |
|---|---|---|
| R-010 Tagesverlust | **ja** | reine Kapitalgrenze; mit Gesamt-Equity zum Tagesbeginn und Tagesergebnis aller Portfolios |
| R-013 Brutto-Exposure | **ja** | nur `exposureRule` |
| R-014 Asset-Exposure | **ja**, wie oben | Duplikatsperre portfoliobezogen, Exposure-Grenze portfolioübergreifend |
| R-015 Korrelationsgruppe | **ja** | prüft nur Gruppe und Symbol und danach `exposureRule` |
| R-009 Risiko je Trade | nein | bezieht sich auf die Equity des eigenen Portfolios; gegen die Gesamt-Equity wäre es immer erfüllt |
| R-011 offene Positionen, R-012 Einstiege je Tag, R-021 Verlustserie, R-022 kein Aufstocken | nein | Ausführungsregeln je Strategie-Portfolio; über Portfolios hinweg würden sie unabhängige Strategien gegenseitig sperren |
| R-001 – R-008, R-016 – R-020, R-023 – R-026 | nein | betreffen Modus, Sitzung, Ledger, Kandidat, Daten, Regime oder Version und sind für denselben Kandidaten in Stufe 1 bereits vollständig geprüft |

Diese Auswahl ist T3 und wird Teil der Methodenkennung `group-risk-v1`.

## 5. Prüfregeln für Kandidaten eigenständiger Familien

Entdeckung + Validierung heißt 2018-04 – 2023-12. „Je Fenster“ heißt
Entdeckung und Validierung getrennt.

### 5.1 Eigenständige Familie (`INDEPENDENT_FAMILY`, blockierend)

1. Eigener Einstiegs-Evaluator in eigener Datei. Er ruft keinen
   Einstiegs-Evaluator einer anderen Strategie auf und prüft kein
   Regime-Gate. Ein Test über den Import-Graphen sichert das ab.
2. Nur Einstiegsparameter sind suchbar. Stop, Ziel und Haltedauer sind fest.
3. Eigenes Startgenom und Raster, vorregistriert mit Hash.
4. Eigene Forschungsidentität nach Abschnitt 7. Der Hash der Vorregistrierung
   passt zum Code.
5. Läuft unverändert durch die Risk Engine (`SPEC`).

### 5.2 Basis: v1-Prüfungen des Kandidaten allein (Schwellen unverändert)

Gerechnet auf dem Standard-Backtest der Evolution Engine:

- Technik und Datenintegrität;
- ≥ 20 / ≥ 6 Trades;
- Entdeckung Ø R ≥ 0,05 und PF ≥ 1,15;
- Validierung Ø R > 0 und PF ≥ 1,0;
- doppelte Kosten > 0;
- Drawdown ≤ 10 %;
- ≥ 50 % positive Phasen, keine Phase > 65 %;
- Benchmark gegen den Champion;
- Redundanz: Korrelation ≤ 0,9 mit jeder bestehenden Strategie.

Die Schwellen sind absolut, nicht relativ zum Challenger.

**`TRADE_GEOMETRY`:** Sind Ø Haltedauer **und** Trades je Jahr jeweils
innerhalb Faktor 2 einer bestehenden Strategie, gelten deren v3-Trade-Toleranzen
als harte Mindestwerte:

- Validierung Ø R ≥ Referenz − 0,05;
- PF ≥ 90 % der Referenz;
- Ø R bei doppelten Kosten ≥ Referenz − 0,05;
- Trades ≥ 80 % der Referenz.

Andernfalls werden diese Werte nur berichtet.

### 5.3 Portfolio-Mehrwert (Simulation A gegen B, Abschnitt 3)

| Nr. | Prüfung | Bestanden, wenn |
|---|---|---|
| P1 | `PORTFOLIO_NET_GAIN` | ΔNettorendite des Gesamtkapitals > 0 über Entdeckung + Validierung **und** in jedem Fenster, nach allen Kosten und einschließlich Verdrängung |
| P2 | `PORTFOLIO_SHARPE_GAIN` | ΔSharpe > 0 gesamt **und** in jedem Fenster |
| P3 | `PORTFOLIO_DRAWDOWN` | Rendite ÷ maximaler Drawdown in B ≥ A, gesamt und in jedem Fenster; max. Drawdown in B ≤ 10 % des Gesamtkapitals |
| P4 | `PORTFOLIO_RISK_EFFICIENCY` | ΔNettorendite ÷ Δ Ø gleichzeitiges Risiko ≥ 0,5 × (Nettorendite ÷ Ø gleichzeitiges Risiko) in A. Steigt das Ø Risiko nicht, genügt P1 |
| P5 | `PORTFOLIO_CAPITAL_EFFICIENCY` | wie P4 mit Ø Kapitalbindung |
| P6 | `INCREMENT_STABILITY` | Zuwachs je Marktphase (Kalenderjahr, Netto-PnL B − A): ≥ 50 % der Phasen mit Kandidaten-Trades positiv, keine Phase trägt mehr als 65 % des positiven Zuwachses |
| P7 | `INCREMENT_COST_STRESS` | bei doppelten Gebühren, Spread und Slippage **aller** Portfolios ΔNettorendite > 0 und ΔSharpe > 0 (gesamt; analytisch auf denselben Trades wie der v1-Kostenstress, siehe T5) |

### 5.4 Statistik: belastbarer, eigener Zusatzertrag

Beide Tests verwenden die Mehrfachtest-Schwelle
**t\* = max(2,0; √(2·ln N); t₀,₉₇₅)**. N ist der unveränderte, nie
zurückgesetzte Zähler (heute 52, also t\* ≥ 2,82). Beide brauchen mindestens 36
Monate, davon 24 aussagekräftige.

| Nr. | Prüfung | Bestanden, wenn |
|---|---|---|
| P8 | `OWN_ALPHA` | Monatsrenditen des Kandidaten-Portfolios aus B, gemeinsam regressiert auf die Monatsrenditen **jedes** Bestandsportfolios aus B (v3-Methode `alpha`, unverändert): α-t ≥ t\* (Freiheitsgrade n − K − 1) **und** α̂ > 0 in jedem Fenster |
| P9 | `INCREMENT_SIGNIFICANCE` | gepaarter Monatsvergleich der Gesamtrenditen B − A (v3-Methode `paired`, unverändert: Newey–West, Student-t): t ≥ t\* |

- P9 belegt, dass das Gesamtportfolio **nach Kosten belastbar mehr** verdient.
- P8 belegt, dass dieser Mehrertrag **nicht** aus denselben Bewegungen kommt,
  die der Bestand schon handelt.
- Beide müssen bestehen.

**Nur berichtet, nicht entscheidend:** α-Anteil, R², Korrelationen,
Klumpenrisiko und das v3-Maß „bespielte Einstiege“.

### 5.5 Entscheidung `PORTFOLIO_DECISION`

- **Bestanden** nur, wenn alle Teile bestehen: 5.1, 5.2 einschließlich der
  harten Teile von `TRADE_GEOMETRY`, P1–P9.
- **Spätere Generationen** einer Familie mit freigegebenen Mitgliedern dürfen
  stattdessen v3-Pfad A gegen den besten freigegebenen Vertreter der eigenen
  Familie bestehen. Innerhalb der Familie ist die Geometrie gleich.
  - Ein freigegebener Vertreter ist Teil des Bestands.
  - Eine bloße Variante von ihm scheitert deshalb an P8.
- **Das Startgenom** hat nur den Portfolio-Weg.

### 5.6 Finale und Holdout

- Alle v1-Finalprüfungen: Nachbarvarianten mit Ø R > 0, Walk-Forward mit
  Effizienz ≥ 0,25, Holdout mit ≥ 5 Trades, Ø R > 0 und PF ≥ 1.
- **Jede Nachbarvariante** wird ebenfalls als B simuliert und braucht
  ΔNettorendite > 0 und ΔSharpe > 0 (gesamt).
- **Holdout-Schutz:** A und B werden auch auf 2024-01 – 2026-10-14 simuliert.
  Verlangt sind ΔSharpe ≥ −0,05 und ΔNettorendite ≥ 0. Der Holdout ist
  bereits analysiert und **nie Nachweis**, er kann nur stoppen.

### 5.7 Budget und Zähler

- v3-Familienbudget unverändert: 10 Validierungsprüfungen je Familie und
  Monat, über alle Versionen gezählt, und höchstens ein Finalist je Familie
  und Durchlauf.
- Strengere Grenzen der Familien-Vorregistrierung gelten zusätzlich.
- Die Simulationen A und B sind keine neuen Konfigurationen.
  - A ist ein Referenzlauf.
  - B gehört zu dem bereits gezählten Kandidaten bzw. Nachbarn.
  - Der Zähler N läuft daher mit unveränderter Methode weiter.

### 5.8 Bekanntes ist kein Nachweis

- Alle historischen Zeiträume sind bekannt.
  - Vergleich A besteht nur aus Strategien mit bekannten Ergebnissen.
  - Der Holdout ist `PREVIOUSLY_ANALYZED`.
- Ein bestandenes v4 heißt nur „historisch nicht widerlegt“. Nachweis ist
  allein ein Forward-Test auf Daten ab 2026-10-15, nach gesonderter
  Freigabe.
- Frühere Kandidaten werden nicht neu bewertet; ihre Genome bleiben gesperrt.

## 6. Kalibrierung: was geändert wurde und warum

Die Werte unten stammen aus einer Modellrechnung, nicht aus Backtests.

| Schwelle (erste Fassung) | Problem | jetzt |
|---|---|---|
| ΔSharpe ≥ +0,10 bei festem Gewicht | Der Gewinn hängt vom Volatilitätsanteil ab: Eine Strategie mit Sharpe 1,5 und 5 % Anteil bringt +0,06 und fiele durch. Bei festen Gewichten lässt sich das nicht durch Umgewichten „reparieren“, und das soll auch nicht sein | ΔSharpe > 0 gesamt und je Fenster (P2); die Belastbarkeit prüfen P8 und P9 |
| Drawdown ≤ 1,10 × | Jedes zusätzliche Risiko auf demselben Kapital hebt den absoluten Drawdown etwa mit der Volatilität: Bei Gewicht 0,3 und Korrelation 0,3 steigt sie um 13 %, obwohl Sharpe um +0,31 steigt | Rendite ÷ Drawdown nicht schlechter, absolut ≤ 10 % (P3) |
| α-Anteil ≥ 50 % | Der Wert einer Strategie hängt nur von α ÷ Restschwankung ab. Der Anteil, der dem Bestand folgt, ist kein Schaden | nur Bericht; α̂ > 0 je Fenster bleibt Pflicht (P8) |
| R² ≤ 0,5 | bestraft gerade die Strategien, deren α am genauesten gemessen ist | nur Bericht |
| – | „belastbarer zusätzlicher Portfolio-Ertrag“ war nur indirekt geprüft | neu: P9, gepaarter Test B − A mit t\* |

**Unverändert streng:** P8 und P9 mit t\* ≥ 2,82. Bei 5,75 Jahren Daten hängt
die Bestehenschance stark vom wahren Informationsverhältnis IR (α ÷
Restschwankung, jährlich) ab:

| wahres IR | Chance, P8 zu bestehen |
|---:|---:|
| 0,5 | 5 % |
| 1,0 | 34 % |
| 1,5 | 78 % |

- Der historische Test findet damit zuverlässig nur außergewöhnliche
  Strategien.
- Mäßige, aber wertvolle Vorteile verwirft er meist. Das ist die Folge von
  Datenlänge und Mehrfachtests und ist so gewollt; ein Fehler in der
  Kalibrierung ist es nicht.

**Weiterhin gilt:**

- P4/P5 mit Faktor 0,5 entsprechen bei zwei Tagen Haltedauer etwa 0,05 R je
  Trade. Sie schließen nur reine Hebeleffekte aus.
- P1, P6 und P7 sind Vorzeichen- und Stabilitätsprüfungen.

## 7. Strategieidentität und Freigabeliste

**Problem:**

- Replay und Risk Engine verlangen einen registrierten, freigegebenen
  Schlüssel: `R-005` prüft `APPROVED_LONG_STRATEGY_KEYS`, die
  Eingabevalidierung prüft Schlüssel und Spezifikations-Hash.
- Eine neue Forschungsfamilie hat keinen solchen Schlüssel. Ihn hinzuzufügen
  hieße, die Risk-Policy zu ändern.
- Deshalb laufen alle Evolution-Genome heute mit dem Schlüssel einer
  bestehenden Strategie als **technischer Hülle**.

**Lösung: Identität und Hülle strikt trennen.**

| | Forschungsidentität (maßgeblich) | Replay-Hülle (nur technisch) |
|---|---|---|
| Schlüssel | `RESEARCH:REGIME_PULLBACK_LONG_V1` | `CRYPTO_REGIME_LONG_V1` |
| Engine-Version | `crypto-regime-pullback-research-v1/1.0.0` | die des Challengers |
| Spezifikations-Hash | eigener: Hash über Familienspezifikation und Genom | der des Challengers |
| erscheint in | jeder Evolution-Zeile (Kandidat, Backtest, Trades, Simulation, Bericht, Dashboard, Audit) | nur im Risk-Input und Kandidaten-Entwurf **innerhalb** eines Replays; gespeichert nur im ausdrücklich benannten Feld `replayHull` |

**Schutz vor falscher Zuordnung und vor einer Umgehung der Freigabeliste:**

1. **Kein Registry-Eintrag.** Der Pullback-Evaluator steht in keiner Registry.
   Der Live-Pfad löst Evaluatoren nur über die Registry auf. Der Schlüssel
   des Challengers führt dort immer zu `evaluateCryptoRegimeLongV1`. Ein
   Test hält die Zuordnung Schlüssel → Evaluator → Spezifikations-Hash fest.
2. **Keine Abhängigkeit.** Trading-Worker, API-Trading-Pfade und der
   Daten-Worker hängen nicht von `@signalpilot/evolution` ab. Ein
   Abhängigkeitstest sichert das ab. Die Evolution-Datenbankrolle hat keine
   Schreibrechte auf Trading-Tabellen.
3. **Zuordnung über das Portfolio.** In der Simulation werden Trades über das
   Portfolio einer Strategie zugeordnet, nie über den Schlüssel im
   Kandidaten-Entwurf. Ein Test prüft, dass kein Kandidaten-Trade dem
   Challenger zugeordnet wird und umgekehrt.
4. **Keine Hülle im Forward.**
   - Der Freigabebefehl der Evolution Engine registriert nichts.
   - Eine Freigabe für einen Forward-Test unter dem Challenger-Schlüssel ist
     ausgeschlossen; das steht in der Vorregistrierung.
   - Ein Forward-Test braucht einen eigenen registrierten Schlüssel (zum
     Beispiel `CRYPTO_REGIME_PULLBACK_LONG_V1`) mit eigenem
     Spezifikations-Hash und eigener StrategyVersion.
   - Ohne einen **gesonderten** Beschluss über
     `APPROVED_LONG_STRATEGY_KEYS` lehnt die unveränderte Risk Engine diesen
     Schlüssel mit `R-005` kritisch ab. Die Freigabeliste bleibt damit die
     einzige Tür.
5. **Ausstieg der Hülle abgeschaltet.** Der Challenger deklariert einen
   Regime-Exit, den der Replay sonst erben würde. Er wird ausdrücklich
   abgeschaltet (`regimeExit.enabled = false`), ein Test sichert das ab.

## 8. Scheindiversifikation

| Muster | Abgelehnt durch |
|---|---|
| Ausstiegsvariante einer bestehenden Strategie | In einer eigenständigen Familie unmöglich (feste Ausstiege). Solche Varianten bleiben unter v3 |
| Kopie, Mischung oder Neugewichtung bestehender Strategien | P8 (α ≈ 0), P9, Redundanz |
| Mehr Risiko auf dieselben Bewegungen ohne Timing-Vorteil | P8, P2, P4/P5 |
| Verdünnung (schwankungsarm, fast ohne Ertrag) | P1, P9, P4/P5 |
| Glückstreffer (ein Jahr, wenige Trades) | P6, „je Fenster“ bei P1/P2/P3/P8, t\* in P8/P9, Nachbarn, Walk-Forward |
| Ertrag nur bei günstiger Ausführung | P7, v1-Kostenstress |
| Ertrag auf Kosten des Bestands (Verdrängung) | Verdrängte Trades sind in P1 und P9 enthalten, denn A und B werden vollständig simuliert |

## 9. Was unverändert bleibt

- Gates v1–v3 mit Code, Schwellen, Methoden und Hashes. Keine rückwirkende
  Neubewertung. EVO-REG-0004 bleibt `REJECTED_BY_OPERATOR`.
- BREAKOUT_LONG und REGIME_LONG unter v4 entscheiden exakt wie unter v3.
  Ein Gleichheitstest läuft auf gespeicherten Kandidaten.
- Das Paket `@signalpilot/risk-engine` vollständig, einschließlich R-020,
  R-005 mit Freigabeliste, R-008 und Limitset.
- Strategie-Registry, Spezifikations-Hashes und Golden Fixtures von Champion
  und Challenger.
- Der Einzel-Replay `runShadowReplay` liefert für jede bestehende
  Konfiguration denselben `outputHash` wie vorher (Regressionstest).
- Split, Kostenmodell, Daten-Lader mit Forward-Sperre, Zählmethode,
  Familienbudgets und KI-Budget.
- Arena V1, offizieller Forward-Test, VPS.

## 10. Technische Integration

### 10.1 Bausteine

| Bereich | Neu oder geändert |
|---|---|
| `packages/shadow-replay` | **Umbau ohne Verhaltensänderung:** Die Zustandslogik eines Portfolios (Orders, Positionen, Ledger, Zähler, Tagesbeginn, Kill-Switch) und die Schritte Fill, Überwachung, Bewertung und Entscheidung werden aus `runShadowReplay` in wiederverwendbare Funktionen gezogen. `runShadowReplay` bleibt ein dünner Wrapper mit identischem `outputHash`. **Neu:** `runPortfolioReplay(market, config)` mit Mitgliedern (Portfolio-Schlüssel, Forschungsidentität, Hülle, Hooks, Platzkapital), Reserveplatz und fester Reihenfolge. **Neu:** `group-risk.ts` mit `buildGroupRiskContext` und `evaluateGroupRisk` (`group-risk-v1`, Abschnitt 4.2) |
| `packages/evolution` | `gates-v4.ts` mit allen Schwellen, Methodenkennungen, Platzgröße und Regelauswahl im Hash; `isGatesV4`; Prüfungen P1–P9; Weiterleitung alter Familien an `lineageScreeningGates` (v3). `gate-versions.ts`: v4 registrieren. `gates.ts`: nur der Typ `GateId` wird additiv erweitert. `paired.ts`: `pairedMonthlyTest` und `spanningAlphaTest` werden wiederverwendet. Familie und Forschungsidentität in `genome.ts` und `lineage.ts` (siehe Familienentwurf); Bericht und KI-Kontext nur mit Entdeckungswerten und Urteilen |
| `apps/evolution-worker` | Schritt 5d für eigenständige Familien: A einmal je Lauf und Fenster rechnen und cachen, B je Kandidat bzw. Nachbar. Vorab-Bewertungen parallel in Kindprozessen, die Portfolio-Schleife sequenziell. `evolution evaluate-seed` ohne KI. Speicherung in `metricsJson.portfolioV4` und `gatesJson` (keine Migration). Das Manifest enthält Gate-Version, v4-Hash, Hash der Familien-Vorregistrierung und `outputHash` beider Simulationen |
| `apps/dashboard`, `apps/api` | nur lesend: Beschriftungen der Prüfungen, Vergleich A/B, Entscheidungsprotokoll der Stufen 1 und 2 |

### 10.2 Tests

**Replay und Simulation:**

- Regression: `runShadowReplay` mit identischen `outputHash`-Werten für alle
  vorhandenen Fixtures und die gecachten Wurzel-Backtests.
- Ein Portfolio allein ergibt in der Portfolio-Simulation dieselben Trades
  wie im Einzel-Replay mit gleichem Kapital und gleichen Symbolen.
- A mit leerer Reserve ändert die Bestandsportfolios nicht, solange keine
  Gruppenregel greift.
- Treuetest der Gruppensicht (4.3, Punkt 4).
- Eigenschaftstests:
  - Stufe 2 lässt nie einen in Stufe 1 abgelehnten Trade zu.
  - Stufe 2 ändert nie die Menge.
- Die Gruppenregeln greifen in konstruierten Fällen: Tagesverlust,
  Exposure, Korrelation.
- Determinismus.

**Gates v4:**

- Hash festgenagelt; Hashes von v1–v3 unverändert.
- Gleiche Urteile für alte Familien unter v3 und v4.
- P1–P9 und die Geometrie-Weiche einzeln mit Grenzfällen.
- Synthetische Scheindiversifikation wird abgelehnt: Kopie, Mischung,
  Hebel, Verdünnung.

**Identität:**

- Registry-Zuordnung unverändert.
- Abhängigkeitsgrenze zu `@signalpilot/evolution`.
- Zuordnung der Trades über das Portfolio.
- Regime-Exit der Hülle abgeschaltet.
- Hashes von Risk-Policy und Limitset unverändert.

### 10.3 Reihenfolge

Jeder Schritt ist für sich grün; es folgt kein Lauf.

1. Umbau `shadow-replay` mit Regressionstests (noch ohne neue Funktion).
2. `runPortfolioReplay` und `group-risk` mit Tests.
3. `gates-v4.ts` mit Hash- und Gleichheitstests.
4. Evaluator und Familie (siehe Familienentwurf).
5. Worker-Integration, `evaluate-seed`, Ende-zu-Ende-Test mit Mock-Daten.
6. Dashboard und API (lesend).
7. Endgültige Vorregistrierungen mit Hashes und ADR 0019.

**Aufwand grob:**

- Schritte 1–2 (Simulation): 3–5 Tage.
- Schritte 3–7: 2–3 Tage.

## 11. Offene technische Entscheidungen

✔ = vom Betreiber am 2026-10-15 wie empfohlen entschieden. T3 ist nach der Prüfung in Abschnitt 4.6 genauer gefasst.

| # | Entscheidung | Optionen | Empfehlung | spätestens |
|---|---|---|---|---|
| T1 ✔ | Strategie-Portfolio in der Simulation | **a)** ein Portfolio je Strategie mit beiden Symbolen · b) zwei Konten je Strategie (wie im Standard-Backtest) | a): realistisch, Portfolioregeln (R-011, R-015, R-021) wirken über beide Symbole. Die Mitgliedsergebnisse weichen dadurch bewusst vom Standard-Backtest ab | vor Schritt 2 |
| T2 ✔ | Platzgröße | 20 000 USDT je Platz, Reserveplatz in A | wie vorgeschlagen | vor Schritt 2 |
| T3 ✔ | Regelauswahl für Stufe 2 | **R-010, R-013, R-014 (nur Exposure-Teil), R-015** · ohne R-014 | mit R-014: Konzentration in einem Asset über alle Strategien ist ein echtes Risiko | vor Schritt 2 |
| T4 ✔ | Gruppen-Kill-Switch nach R-010 | Sperre aller Portfolios bis zur Freigabe nach 24 h · nur bis Tagesende UTC | 24 h, wie die bestehende Replay-Annahme | vor Schritt 2 |
| T5 | Kostenstress P7 | **analytisch** auf denselben Trades · neu simuliert mit doppelten Kosten | analytisch, wie der v1-Kostenstress; die Neusimulation verdoppelt die Laufzeit | vor Schritt 3 |
| T6 | Replay-Hülle | **Challenger-Schlüssel** · Champion-Schlüssel | Challenger: Der Pfad mit Research-Overrides ist erprobt; Regime-Exit ausdrücklich aus | vor Schritt 4 |
| T7 ✔ | Bewertung vorab | **parallel vorab, gecacht** · in der Schleife | vorab: gleiche Ergebnisse, kürzere Laufzeit | vor Schritt 2 |
| T8 | Standard-Gate-Version | beim Festschreiben auf v4 umstellen · v3 lassen und v4 nur für eigenständige Familien | umstellen: für alte Familien ohne Wirkung | Schritt 7 |
| T9 | Konstanten | P4/P5 Faktor 0,5; Drawdown ≤ 10 %; Geometrie Faktor 2; Platz 20 000 USDT | wie vorgeschlagen | Schritt 7 |
| T10 | Späterer Forward-Test | eigener registrierter Schlüssel + gesonderter Beschluss zur Freigabeliste | erst nach einem bestandenen v4, getrennt entscheiden | vor einem Forward-Test |

## 12. Ablauf bis zum ersten Experiment

1. **Prüfung dieser Fassung** und Entscheidung von T1–T4 und T7 durch den
   Betreiber.
2. **Implementierung** nach eigener Freigabe auf
   `claude/inspiring-noether-rjh92d`. Kein Merge nach `main`, kein VPS.
3. **Gegenprobe auf bekannten Daten**, ohne KI und ohne neue Konfiguration.
   - EVO-REG-0004 – 0010 werden als Referenzläufe in B gesetzt, als wären sie
     eigenständig. Erwartet wird ein Scheitern an P8 und P9.
   - Die Gegenprobe ist keine Bewertung dieser Kandidaten und zählt nicht
     für N.
   - Zeigt sie eine Schwäche, wird **vor** dem Festschreiben verschärft, nie
     gelockert. Das wird dokumentiert.
4. **Festschreiben:**
   - endgültige Vorregistrierung von v4 und der Familie mit Hashes;
   - ADR 0019;
   - gepusht vor jedem Experiment.
5. **Stufe 1, nur das Startgenom**, nach eigener Freigabe: ohne KI-Kosten, N
   steigt um 1 bis 3.
