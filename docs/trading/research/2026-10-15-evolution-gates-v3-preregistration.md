# Vorregistrierung Gates v3: Linien- und Diversifikationsregel (2026-10-15)

Festgeschrieben **vor** dem ersten Forschungsdurchlauf mit Gates v3. Gates v1
([Vorregistrierung](2026-10-15-evolution-v1-preregistration.md)) und Gates v2
([Vorregistrierung](2026-10-15-evolution-gates-v2-preregistration.md)) bleiben
vollständig unverändert und für Reproduktionen wählbar. Entscheidung:
[ADR 0018](../decisions/0018-evolution-gates-v3-lineage-rule.md).

| | Hash (`canonicalHash`) |
|---|---|
| `evolution-gates-v1` (unverändert seit `efe4df8`) | `65da3536653e56c054dd1aea13cba824e30b509085bbe0d367487639d6e82c76` |
| `evolution-gates-v2` (unverändert seit `72a94cc`) | `8341a3c7bcd6a09d852187d5e55ef6190765a7659702d9e620d9817ad8fd5e96` |
| `evolution-gates-v3` | `250bf745365f432f1b2e5b99e6b39f0a507fd73b341e0061daeb5d413677c88b` |

Alle drei Hashes sind in `packages/evolution/test/gates-v3.test.ts`
festgenagelt. Der v3-Hash umfasst nicht nur jede Schwelle, sondern auch
**Methodenkennungen** (Sharpe, gepaarter Test, α-Regression,
Signalüberschneidung, Portfolio, Mehrfachtest-Zähler): Wer eine Berechnung
ändert, braucht eine neue Gate-Version wie bei einer geänderten Schwelle.
Split (`evolution-split-v1`), Kostenmodell und Suchraum bleiben unverändert.

## Anlass: EVO-REG-0004

EVO-REG-0004 (Durchlauf `EVO-RUN-20261015T152351-22d709`, Gates v2) bestand
alle 13 Prüfungen, war aber schwächer als der Challenger, aus dem er
abgeleitet ist:

- Validierung Ø 0,35 R statt 0,48 R;
- im bereits analysierten Holdout Sharpe 0,68 statt 1,08 (gepaart t = −1,67);
- mehr Kapitalbindung.

Er bestand nur, weil seine Tagesrenditen mit 0,887 knapp unter der
Nachfolger-Schwelle 0,90 korrelierten. Er galt deshalb als „eigenständig“ und
wurde nur am schwachen Champion gemessen (Sharpe 0,30). Der Betreiber hat
ihn am 2026-10-15 als **formal bestandenen, aber nach manueller Prüfung
abgelehnten** Kandidaten markiert (`REJECTED_BY_OPERATOR`). Seine
gespeicherten Gate-Ergebnisse und Kennzahlen bleiben unverändert.

## Analyse der Lücke

1. **v2 wählt die Referenz über einen Korrelations-Schalter.** Über 0,90 gilt
   die Wurzel als Referenz, darunter der Champion. Jeder solche Schalter hat
   eine Kante: Knapp darunter wird gegen eine schwächere Referenz geprüft.
2. **Korrelation ist billig zu senken.** Andere Ausstiege oder Haltedauern
   ändern die Tagesrenditen, ohne die Einstiege zu ändern. Claude hat die
   Redundanz-Prüfung aus der Historie gelernt und EVO-REG-0004 ausdrücklich
   so formuliert, dass die Tagesrenditen abweichen.
3. **Der Champion ist kein Maßstab für Regime-Varianten.** Fast jede
   Regime-Variante schlägt Sharpe 0,30.
4. **Ein Portfolio-Gewinn allein beweist keine Diversifikation.**
   - EVO-REG-0004 hätte das gleichgewichtete Portfolio aus Champion und
     Challenger von Sharpe 0,79 auf 0,93 gehoben.
   - Er gewichtet dort aber nur die starke Regime-Linie stärker und den
     schwachen Champion schwächer.

**Folgerung:** Die Wahl der Referenz darf nicht von der Korrelation abhängen.
Die Korrelation darf nur entscheiden, ob ein Kandidat *überhaupt*
Eigenständigkeit beanspruchen kann. Diese muss dann mit Maßen belegt
werden, die eine Parametervariante nicht fälschen kann.

## Die Regel

v3 übernimmt alle v1-Prüfungen mit identischen Schwellen. Es gibt keine
Nachfolger-Weiche. Jeder Kandidat muss **einen von zwei Pfaden** bestehen
(`LINEAGE_DECISION`). Die Teilprüfungen des Pfads, der nicht entschieden
hat, werden als *informativ* gespeichert und angezeigt. Sie verwerfen nie
für sich allein.

### Pfad A — Mehrwert gegenüber der eigenen Linie

Referenzen, **unabhängig von der Korrelation** und **jede für sich**:

- die eingefrorene Wurzel der Familie;
- die Elternstrategie, wenn sie ein Kandidat ist;
- der beste bestehende Vertreter der Familie: höchste Sharpe über Entdeckung
  und Validierung unter der Wurzel und allen vom Betreiber freigegebenen
  Kandidaten der Familie.

Freigegebene Kandidaten werden dafür mit dem aktuellen Code-Stand neu
gerechnet, als Referenz und nicht als neuer Nachweis.

Gemessen auf Entdeckung + Validierung (2018-04 – 2023-12), BTC + ETH
kombiniert, gegen jede Referenz:

| Prüfung | Bestanden, wenn (für **jede** Referenz) |
|---|---|
| `VALUE_RISK_ADJUSTED` | Referenz-Sharpe ≥ 0,5: ΔSharpe ≥ +0,15 **und** Sharpe ≥ 1,10 × Referenz. Darunter: ΔSharpe ≥ +0,15 **und** eigene Sharpe ≥ 0,5 |
| `VALUE_CONSISTENCY` | ΔSharpe > 0 in der Entdeckung **und** in der Validierung |
| `VALUE_SIGNIFICANCE` | gepaarter Monatsvergleich t ≥ max(2,0; √(2·ln N); t₀,₉₇₅ mit n − 1 FG), mindestens 36 Monate, davon 24 mit Unterschied |
| `VALUE_NO_MATERIAL_DETERIORATION` | keine wesentliche Verschlechterung (Toleranzen siehe unten) |

**Nicht jede Kennzahl muss besser werden.** Verlangt ist eine klare,
belastbare Verbesserung der risikobereinigten Nettorendite. In allen übrigen
Dimensionen darf der Kandidat innerhalb vorregistrierter Toleranzen
schlechter sein:

| Dimension | Toleranz gegenüber der Referenz |
|---|---|
| Validierung | Ø R höchstens 0,05 R niedriger |
| Profit Factor | mindestens 90 % des Referenzwerts (ohne Verlusttrade und mit Gewinn: erfüllt) |
| Drawdown | höchstens 1,1 × der maximale Drawdown der Referenz |
| Kostenrobustheit | Ø R bei doppelten Kosten höchstens 0,05 R niedriger |
| Kostenlast | Kostenanteil am Bruttogewinn höchstens 10 Prozentpunkte höher |
| Marktphasen | höchstens eine positive Phase weniger; Anteil der stärksten Phase höchstens 15 Prozentpunkte höher |
| Kapitalbindung | Zeit im Markt höchstens 1,2 × Referenz; mehr nur, wenn die Rendite je gebundener Zeit mindestens gleich hoch ist |
| Stichprobe | mindestens 80 % der Trades der Referenz |

Die Schwellen der ersten drei Prüfungen sind die von v2. Sie gelten jetzt für
**jeden** Kandidaten, nicht nur oberhalb einer Korrelation.

### Pfad B — echte Diversifikation

Für eine Strategie mit geringerer Rendite, die wirklich eigenständig ist und
das Portfolio nachweisbar verbessert. Bestehende Strategien sind die Wurzeln
und alle freigegebenen Kandidaten aller Familien.

| Prüfung | Bestanden, wenn |
|---|---|
| `DIVERSIFICATION_INDEPENDENCE` | gegenüber **jeder** bestehenden Strategie: Korrelation der Tagesrenditen ≤ 0,5 **und** höchstens 50 % der Einstiege auf schon bespielten Gelegenheiten (siehe unten) |
| `DIVERSIFICATION_PORTFOLIO_GAIN` | Portfolio der bestehenden Strategien mit dem Kandidaten: ΔSharpe ≥ +0,10 über Entdeckung + Validierung, ΔSharpe > 0 in **jedem** der beiden Zeiträume, max. Drawdown nicht größer |
| `DIVERSIFICATION_SIGNIFICANCE` | α der Regression seiner Monatsrenditen auf **jede** bestehende Strategie: t ≥ max(2,0; √(2·ln N); t₀,₉₇₅ mit n − K − 1 FG), mindestens 36 Monate, davon 24 mit eigenem Ertrag |

**Parametervarianten können sich nicht als unabhängig ausgeben**, aus zwei
Gründen:

- **Einstiege werden geprüft, nicht nur Renditen.** Ein Einstieg gilt als
  „schon bespielte Gelegenheit“, wenn die Referenz auf demselben Symbol
  binnen ±24 h selbst einsteigt oder zu diesem Zeitpunkt bereits eine
  Position hält. Andere Ausstiege oder Haltedauern ändern daran nichts.
- **Das α wird gegen jede Strategie einzeln geschätzt, nicht gegen eine
  Mischung.** Eine Kopie oder Kombination bestehender Strategien hat damit ein
  α nahe null. Gegen das Mischportfolio würde eine Kopie der stärksten
  Strategie dagegen ein scheinbares α zeigen.

### Entscheidung, Holdout, Budget

- **`LINEAGE_DECISION`** ist bestanden mit Pfad A (Vorrang) oder Pfad B.
  Sonst wird der Kandidat verworfen (`NO_VALUE_NO_DIVERSIFICATION`).
- **Redundanz**: Eine Fast-Kopie (> 0,9) einer Strategie *außerhalb* der
  eigenen Linie bleibt redundant wie in v1. Eine Fast-Kopie der eigenen
  Linie ist nicht mehr besonders und wird in Pfad A gemessen.
- **Finale**: alle v1-Finalprüfungen (Nachbarn, Walk-Forward, Holdout) plus
  ein **Holdout-Schutz**. Der Holdout ist bereits analysiert und daher **nie
  Nachweis**, er kann nur stoppen:
  - Pfad A: ΔSharpe gegenüber jeder Referenz ≥ −0,10;
  - Pfad B: ΔSharpe des Portfolios ≥ −0,05.
- **Familien-Budget** (`LINEAGE_BUDGET`):
  - höchstens 10 Kandidaten je Familie und Kalendermonat (UTC) auf
    Validierungsdaten, gezählt über **alle** Gate-Versionen anhand der
    Validierungs-Exposition;
  - Hypothesen darüber werden ohne Backtest verworfen
    (`LINEAGE_BUDGET_EXHAUSTED`), und Claude erfährt das verbleibende Budget;
  - höchstens ein Finalist je Familie und Durchlauf.

## Methoden (Teil des Hashes)

| Kennung | Bedeutung |
|---|---|
| `sharpe` | tägliche Renditen der kombinierten Mark-to-Market-Equity (BTC + ETH, je 10 000 USDT), √365 |
| `paired` | Monatsdifferenzen Kandidat − Referenz; Standardfehler max(iid, Newey–West, Bartlett, Lag ⌊4·(n/100)^(2/9)⌋); Student-t-Quantil |
| `alpha` | OLS der Monatsrenditen auf jede bestehende Strategie; Standardfehler des Achsenabschnitts max(iid, Newey–West-Sandwich); Student-t mit n − K − 1 FG; ohne Restvarianz (exakte Kopie) nicht testbar, nie „unendlich signifikant“ |
| `signalOverlap` | Anteil der Einstiege mit Referenz-Einstieg (±24 h) oder offener Referenz-Position auf demselben Symbol |
| `portfolio` | getrennte, gleich große Konten (Wurzeln + freigegebene Kandidaten), Summe der Equity |
| `trials` | 30 Trainingskonfigurationen der Vorforschung + jede in Entdeckung und Validierung geprüfte Konfiguration (Kandidaten und Nachbarn, alle Versionen), nie zurückgesetzt |

## Bekannte Ergebnisse sind kein unabhängiger Nachweis

Alle bisherigen Kandidaten sind bekannt. Ihre Daten haben die Regel
mitgeformt. Sie behalten ihr Urteil und werden **nicht** neu bewertet. Ein
Test prüft, dass ein v3-Durchlauf frühere Zeilen unverändert lässt.

| Kandidat | Durchlauf | Gates | Urteil (bleibt) |
|---|---|---|---|
| EVO-BRK-0001 – 0004 | Mock-Hypothesen, echte Daten | v1 | verworfen |
| EVO-REG-0001 – 0003 | Mock-Hypothesen, echte Daten | v1 | verworfen (redundant) |
| EVO-BRK-0005, 0006 | erster Claude-Lauf | v2 | verworfen |
| EVO-REG-0005 | erster Claude-Lauf | v2 | verworfen (Nachfolger-Regel) |
| EVO-REG-0004 | erster Claude-Lauf | v2 | formal bestanden, **vom Betreiber abgelehnt** |

- Ihre Genome bleiben gesperrt, ebenso die geprüften Nachbarvarianten.
- Ein vom Betreiber abgelehnter Kandidat ist keine zulässige Elternstrategie
  mehr.
- Der Mehrfachtest-Zähler läuft weiter: **N = 43** zum Zeitpunkt dieser
  Vorregistrierung, Schwelle √(2·ln 43) = 2,74.
- Das Familien-Budget zählt die Oktober-Prüfungen aller Versionen mit:
  BREAKOUT_LONG 6, REGIME_LONG 5, also noch 4 bzw. 5 in diesem Monat.

### Gegenprobe (nur zur Veranschaulichung)

Vor dem Festschreiben wurde v3 auf die gespeicherten Daten der vier
Claude-Kandidaten angewendet (Entdeckung + Validierung, Code `54962b0`). Die
Probe deckte zwei schwache Maße einer ersten Fassung auf. Beide wurden vor
jedem v3-Lauf verschärft:

- **Einstiegsmaß**: Nur gleichzeitige Einstiege zu zählen ergab für
  EVO-REG-0004 43 %. Mit „Referenz hält schon eine Position“ sind es 99 %.
- **α-Test**: Gegen das Mischportfolio ergab sich für EVO-REG-0004 t = 1,94.
  Gegen jede Strategie einzeln sind es 0,97.

Deshalb ist EVO-REG-0004 **kein Beleg** dafür, dass die Regel funktioniert.
Die Tabelle zeigt nur, dass sie die bekannte Lücke schließt, ohne an einem
bekannten Kandidaten ausgerichtet zu sein.

| Kandidat | ΔSharpe Linie | Δ Entd./Valid. | gepaart t | Korrelation / bespielte Einstiege zur eigenen Linie | Portfolio ΔSharpe | α-t | v3-Urteil |
|---|---:|---|---:|---|---:|---:|---|
| EVO-REG-0004 | +0,04 | +0,06 / −0,03 | −1,06 | 0,89 / 99 % | +0,15 | 0,97 | weder Mehrwert noch Diversifikation |
| EVO-REG-0005 | +0,12 | +0,23 / −0,18 | −0,55 | 0,95 / 98 % | +0,17 | 0,92 | weder noch |
| EVO-BRK-0005 | −0,31 | −0,49 / +0,67 | −1,37 | 0,81 / 94 % | −0,26 | −1,60 | weder noch |
| EVO-BRK-0006 | +0,02 | −0,03 / +0,33 | −0,21 | 0,72 / 94 % | −0,10 | −0,55 | weder noch |

Nebenbefund: Jede Ausbruchs-Variante steigt nur ein, wenn auch die
Regime-Strategie im Markt ist (bespielte Einstiege 100 %). Beide brauchen ein
bullisches Regime. Im heutigen Parameterraum kann die Ausbruchsfamilie
deshalb keine eigenständige Diversifikation der Regime-Familie sein. Sie
kann nur über Pfad A gegen ihre eigene Linie gewinnen.

## Was ein v3-Vorschlag bedeutet

Ein bestandener historischer Test, mehr nicht. Die Daten 2018 – 2023 sind
durch alle bisherigen Versuche abgenutzt, der Holdout 2024 – 2026 wurde
bereits analysiert. Einen Nachweis kann deshalb nur ein **Forward-Test auf
neuen, ungesehenen Daten** liefern. Er läuft als eigener Shadow-Forward-Test
nach ausdrücklicher Freigabe durch den Betreiber:

- Nichts wird automatisch freigegeben.
- Nichts handelt Echtgeld.
- Champion, Challenger, Arena V1 und der offizielle VPS-Forward-Test bleiben
  unberührt.
