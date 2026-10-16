# Vorregistrierung Gates v4: Portfolio-Mehrwert eigenständiger Strategiefamilien (2026-10-16)

Festgeschrieben **vor** dem ersten Experiment mit einer eigenständigen
Familie. Bisher gibt es keine solche Familie; REGIME_PULLBACK_LONG ist der
nächste, getrennte Schritt.

- Entscheidung: [ADR 0019](../decisions/0019-evolution-gates-v4-portfolio-value.md).
- Herleitung: [Entwurf Gates v4](2026-10-15-evolution-gates-v4-draft.md) mit
  den Betreiberentscheidungen vom 2026-10-15.
- Validierung und Gegenprobe:
  [Protokoll 2026-10-16](2026-10-16-portfolio-replay-validation-and-gates-v4-counterprobe.md).

| | Hash (`canonicalHash`) |
|---|---|
| `evolution-gates-v1` (unverändert seit `efe4df8`) | `65da3536653e56c054dd1aea13cba824e30b509085bbe0d367487639d6e82c76` |
| `evolution-gates-v2` (unverändert seit `72a94cc`) | `8341a3c7bcd6a09d852187d5e55ef6190765a7659702d9e620d9817ad8fd5e96` |
| `evolution-gates-v3` (unverändert seit `e2e6f45`) | `250bf745365f432f1b2e5b99e6b39f0a507fd73b341e0061daeb5d413677c88b` |
| `evolution-gates-v4` | `8f55cf8e14b9ca82923f2aae7bab4ed12c318e45c28f31c9f5e03e1ba054554c` |

Alle vier Hashes sind in `packages/evolution/test/gates-v4.test.ts`
festgenagelt.

Der v4-Hash umfasst:

- jede v3-Schwelle und jede v3-Methodenkennung;
- die v4-Schwellen und -Methodenkennungen;
- die Simulation: Engine-Version, Gruppenprüfung, Regelauswahl,
  Platzgröße, Symbole, Regime-Policy, Kill-Switch-Annahme und Reihenfolge der
  Portfolios.

Wer eine dieser Größen ändert, braucht ein Gates v5 mit eigener
Vorregistrierung.

## 1. Geltungsbereich

- **BREAKOUT_LONG und REGIME_LONG:** v4 entscheidet exakt wie v3. Es trägt
  dieselbe `lineage`-Policy, und ein Test sichert die Gleichheit aller v1-
  und v3-Felder ab.
- **Eigenständige Familie:** eine Familie, deren Spezifikation
  `FamilySpec.independence` setzt:
  - eigener Einstiegs-Evaluator (Engine-Version);
  - eigene Forschungsidentität;
  - eingefrorene Ausstiege;
  - Hash der eigenen Vorregistrierung.

  Ihr Genom darf keinen Ausstiegsparameter enthalten (`EXIT_PARAMETER_NAMES`).
  Ihre Kandidaten entscheidet der Portfolio-Weg (Abschnitte 3 und 4).
- **Standard bleibt v3** (`EVOLUTION_GATES_VERSION`). v4 ist wählbar und für
  die bestehenden Familien gleichwertig. Für eine eigenständige Familie ist v4
  Pflicht.

## 2. Simulation und Kapitalrahmen

- **Chronologische Mehrstrategien-Simulation** `portfolio-replay-v1/1.0.0`
  (`packages/shadow-replay/src/portfolio-replay.ts`).
  - Alle Strategie-Portfolios laufen mit BTCUSDT und ETHUSDT Stunde für
    Stunde auf einer Zeitleiste.
  - Fills, Kosten, Ledger, Exits, Bewertung und Kill-Switch kommen aus
    demselben Portfolio-Buch wie der Einzel-Replay (`replay-core.ts`).
  - Einzelne Backtests werden nicht addiert.
- **Feste Plätze à 20 000 USDT**, je Platz ein Strategie-Portfolio mit beiden
  Symbolen.
  - Vergleich A: Bestand plus ein Reserveplatz als Kasse.
  - Vergleich B: der Kandidat auf diesem Platz.
  - Reihenfolge: Wurzeln (Champion, Challenger), freigegebene Kandidaten nach
    Schlüssel, Kandidat zuletzt.
  - Andere Gewichte werden nie gerechnet.
- **Stufe 1:** das unveränderte `evaluateRisk` gegen das eigene Portfolio,
  alle 26 Regeln.
- **Stufe 2:** `group-risk-v1/1.0.0`, nur nach Freigabe in Stufe 1, nur
  ablehnend. Es prüft die unveränderten Regelfunktionen R-010, R-013, R-014
  und R-015 auf der Gesamtsicht.
  - Die Duplikatsperre in R-014 greift nur über das eigene Portfolio.
  - Löst der Tagesverlust der Gruppe aus, sind neue Einstiege aller
    Portfolios 24 h gesperrt.
  - Begründung je Regel: [Entwurf, Abschnitt 4.6](2026-10-15-evolution-gates-v4-draft.md).
- **Zeiträume** (`evolution-split-v1`, unverändert):
  - Entdeckung 2018-04-01 – 2022-06-30, Validierung 2022-07-01 – 2023-12-31.
  - Der Holdout 2024-01-01 – 2026-10-14 dient nur als Schutz.
  - Ab 2026-10-15 wird nie simuliert.

## 3. Screening eines Kandidaten einer eigenständigen Familie

Die **v1-Basisprüfungen** laufen unverändert auf den eigenen Backtests des
Kandidaten (Trades, Vorteil, Validierung, Kostenstress, Drawdown, Phasen,
Redundanz, Benchmark). Dazu kommen die v4-Prüfungen:

| Prüfung | Bestanden, wenn |
|---|---|
| `LINEAGE_BUDGET` | höchstens 10 Validierungsprüfungen der Familie im Monat (alle Versionen); strengere Grenzen der Familien-Vorregistrierung gelten zusätzlich |
| `INDEPENDENT_FAMILY` | Erklärung vollständig: eigenständig, nur Einstiegsparameter, feste Ausstiege, eigener Evaluator, Vorregistrierungs-Hash |
| `TRADE_GEOMETRY` | Bei einer bestehenden Strategie mit Ø Haltedauer **und** Trades je Jahr innerhalb Faktor 2 gilt: Validierung Ø R ≥ deren − 0,05; PF ≥ 90 % von deren PF; Ø R bei doppelten Kosten ≥ deren − 0,05; Trades ≥ 80 % von deren Zahl. Sonst nur Bericht |
| `PORTFOLIO_NET_GAIN` | Δ Nettorendite des Gesamtkapitals (B − A, nach allen Kosten, Verdrängung eingerechnet) > 0 in Entdeckung + Validierung, in der Entdeckung und in der Validierung |
| `PORTFOLIO_SHARPE_GAIN` | Δ Sharpe > 0 in allen drei Fenstern |
| `PORTFOLIO_DRAWDOWN` | Rendite ÷ max. Drawdown in B ≥ A in allen drei Fenstern, und max. Drawdown in B ≤ 10 % |
| `PORTFOLIO_RISK_EFFICIENCY` | Δ Nettorendite ÷ Δ Ø gleichzeitiges Risiko ≥ 0,5 × (Nettorendite ÷ Ø gleichzeitiges Risiko) von A; steigt das Ø Risiko nicht, genügt ein Nettozuwachs |
| `PORTFOLIO_CAPITAL_EFFICIENCY` | wie oben mit Ø Kapitalbindung |
| `INCREMENT_STABILITY` | Zuwachs B − A je Kalenderjahr-Phase: unter den Phasen mit ≥ 2 Kandidaten-Trades ≥ 50 % positiv, keine Phase > 65 % des positiven Zuwachses |
| `INCREMENT_COST_STRESS` | bei doppelten Gebühren, Spread und Slippage aller Portfolios (analytisch auf denselben Trades) Δ Nettorendite > 0 und Δ Sharpe > 0 über Entdeckung + Validierung |
| `OWN_ALPHA` | Monatsrenditen des Kandidaten-Portfolios in B, regressiert auf jedes Bestandsportfolio in B (eigene Regressoren): t ≥ max(2; √(2·ln N); t₀,₉₇₅ mit n − K − 1 FG), ≥ 36 Monate, ≥ 24 mit eigenem Ertrag, α̂ > 0 in Entdeckung **und** Validierung. Eine Kopie oder Neugewichtung hat keinen eigenen Rest und ist „nicht testbar“, also abgelehnt |
| `INCREMENT_SIGNIFICANCE` | gepaarter Monatsvergleich Gesamtportfolio B − A (Newey–West, Student-t): t ≥ max(2; √(2·ln N); t₀,₉₇₅ mit n − 1 FG), ≥ 36 Monate, ≥ 24 mit Unterschied |
| `PORTFOLIO_DECISION` | alle v4-Prüfungen bestanden |

**Nur Bericht, nie entscheidend:** α-Anteil, R², Korrelationen, Anteil
„bespielter Einstiege“ und Änderungen der Bestandsportfolios zwischen A und B.

N ist der unveränderte Zähler von v3 (30 Trainingskonfigurationen plus jede
geprüfte Konfiguration). Er steht bei der Festschreibung bei **52**, die
Schwelle also bei mindestens 2,81.

## 4. Finale

- Alle v1-Finalprüfungen (Nachbarn, Walk-Forward, Holdout).
- `PORTFOLIO_NEIGHBOURS`: Jede Ein-Schritt-Nachbarvariante erreicht in
  ihrem eigenen Vergleich B Δ Nettorendite > 0 und Δ Sharpe > 0.
- `PORTFOLIO_HOLDOUT_GUARD`: Vergleich A/B auf dem Holdout, Δ Sharpe ≥ −0,05
  und Δ Nettorendite ≥ 0. Der Holdout ist bereits analysiert: Er kann nur
  stoppen, nie belegen.
- Höchstens ein Finalist je Familie und Durchlauf.

## 5. Unverändert

- Gates v1–v3 mit Code, Schwellen, Methoden und Hashes, und die
  `GateId`-Liste von v1 (v4 führt eigene Kennungen).
- Keine rückwirkende Neubewertung; EVO-REG-0004 bleibt
  `REJECTED_BY_OPERATOR`; bekannte Genome bleiben gesperrt.
- Mehrfachtest-Zähler (nie zurückgesetzt), Split, Kostenmodell, Daten-Lader
  mit Forward-Sperre, Familien- und KI-Budget.
- Das Paket `@signalpilot/risk-engine` (byte-gleich), Strategie-Registry,
  Champion, Challenger, Arena V1, offizieller Forward-Test, VPS.
- Jeder bestehende Einzel-Backtest: Zehn aufgezeichnete Einzel-Replays
  liefern nach dem Umbau identische Hashes.

## 6. Validierung der Simulation vor dem Festschreiben

Einzelheiten im [Protokoll](2026-10-16-portfolio-replay-validation-and-gates-v4-counterprobe.md).

- Auf echten Daten (2018-04 – 2023-12) liefert die Portfolio-Simulation für
  Champion und Challenger auf BTC und ETH einzeln exakt denselben
  `outputHash` wie der Einzel-Replay (4 von 4).
- Vergleich A (Champion, Challenger, Reserve) besteht alle
  Konsistenzprüfungen:
  - Ledger;
  - Gruppen-Equity an jedem Tag;
  - Gebühren, Spread und Slippage;
  - Netto- gegen Brutto-PnL;
  - Zuordnung.
- Die Gruppenprüfung lief bei allen 321 Freigaben. Ihre höchste Auslastung
  lag zwischen 28 % (R-010) und 40 % (R-015) der Grenze, eine Ablehnung gab
  es nie. Mit und ohne Gruppenprüfung sind die Ergebnisse identisch.

## 7. Gegenprobe vor dem Festschreiben

Vor dem Festschreiben lief der Portfolio-Weg auf bekannten Strategien als
Kandidat in Vergleich B: Kopien von Champion und Challenger und die
Challenger-Varianten EVO-REG-0004 bis 0010. Die Strukturprüfung war dabei
als bestanden gesetzt, damit allein die Portfolio-Prüfungen entscheiden.
Einzelheiten und Tabelle im
[Protokoll, Abschnitt 4](2026-10-16-portfolio-replay-validation-and-gates-v4-counterprobe.md).

- **Alle neun werden abgelehnt.** Für beide Kopien ist α nicht testbar
  (R² = 1). Die Varianten erreichen α-t 0,74 – 1,63 bei Schwelle 2,81.
- Die Kopie des Challengers und alle Varianten bestehen jede reine
  Wertprüfung (Netto, Sharpe, Drawdown, Effizienz, Phasen, Kostenstress).
  Sie scheitern an `OWN_ALPHA` und an `INCREMENT_SIGNIFICANCE`
  (Zuwachs-t 2,15 – 2,49), fünf der sieben Varianten zusätzlich an
  `TRADE_GEOMETRY`.
- Keine Schwelle wurde nach der Gegenprobe geändert; Schwellen und
  Methoden stehen so, wie sie im Entwurf mit dem Betreiber abgestimmt
  wurden. Der Hash oben wurde nach der Gegenprobe festgenagelt.

## 8. Bekannte Ergebnisse und Datenzugriffe

| Datum | Was | Zeitraum | Konfigurationen | zählt für N |
|---|---|---|---|---:|
| 2026-10-14 | Vorforschung, Training: Varianten × Regime-Policies, Bedingungs- und Regime-Studie | 2018-03 – 2023-12 | 30 | 30 |
| 2026-10-14 | Vorforschung, einmaliger Test K1/K2, Regime-Studie | 2024-01 – 2026-10-14 | 3 | – (Holdout als `PREVIOUSLY_ANALYZED` markiert) |
| 2026-10-15 | Evolution v1, Mock-Hypothesen auf echten Daten: EVO-BRK-0001 – 0004, EVO-REG-0001 – 0003 | Entdeckung + Validierung | 7 | 7 |
| 2026-10-15 | erster Claude-Lauf (Gates v2): EVO-BRK-0005/0006, EVO-REG-0004/0005, 2 Nachbarn von EVO-REG-0004; Holdout nur für EVO-REG-0004 | Entdeckung + Validierung, Holdout | 6 | 6 |
| 2026-10-15 | drei Claude-Läufe (Gates v3): EVO-BRK-0007 – 0010, EVO-REG-0006 – 0010 | Entdeckung + Validierung | 9 | 9 |
| 2026-10-16 | Validierung der Simulation: nur Champion und Challenger (Referenz) | Entdeckung + Validierung | 0 neue | – |
| 2026-10-16 | Gegenprobe: Kopien der Wurzeln und EVO-REG-0004 – 0010 als bekannte Referenzen in Vergleich B | Entdeckung + Validierung | 0 neue | – |
| ab 2026-10-15 | Forward | – | – | unberührt |

- Das Exposure-Ledger der Entwicklungsdatenbank bestätigt 22 geprüfte
  Konfigurationen (20 Kandidaten und 2 Nachbarn). **N = 30 + 22 = 52.**
- Validierung und Gegenprobe sind Referenzläufe ohne neue Konfiguration.
  Sie zählen nicht und ändern kein Urteil.
- Zusätzlich gilt: Alle historischen Daten bis etwa Mitte 2026 sind im
  Vorwissen des Sprachmodells enthalten, das die Hypothesen formuliert.
  Kein Zeitraum vor 2026-10-15 ist unberührt.

## 9. Einschränkungen (bekannt bei der Festschreibung)

1. **Trennschärfe.** t ≥ 2,82 (ab N = 53, also schon beim ersten
   Kandidaten der Familie) bei 69 Monaten verlangt ein jährliches
   Informationsverhältnis von rund 1,2. Bei IR 1,0 besteht ein wirklich
   wertvoller Kandidat P8 nur mit etwa 34 % Wahrscheinlichkeit, bei IR 0,5
   mit 5 %. Ein Scheitern heißt deshalb oft „nicht belegt“, nicht „wertlos“.
2. **Gruppengrenzen greifen selten.** Bei gleichen Prozentgrenzen je
   Portfolio und Gruppe greifen sie nur durch Kursdrift oder Kurslücken; die
   höchste gemessene Auslastung lag bei 40 %. Eine wirksamere gemeinsame
   Grenze wäre eine neue Risk-Grenze.
3. **Ein Portfolio je Strategie mit beiden Symbolen (T1).** Die Regeln je
   Portfolio wirken über BTC und ETH zusammen; vor allem zählt die
   Verlustserie (R-021) für beide Symbole.
   - Der Champion kommt dadurch in Vergleich A auf −10,6 R (24
     Kill-Switch-Auslösungen) statt etwa +15,8 R in getrennten Konten je
     Symbol.
   - Vergleich A und B nutzen dasselbe Modell; der Vergleich bleibt also
     fair. Die Kennzahlen der Bestandsstrategien weichen aber von ihren
     Standard-Backtests ab.
4. **Laufzeit.**
   - Vergleich A braucht lokal rund 17 Minuten (2 × 2 Portfolio-Symbole),
     ein Vergleich B rund 25 Minuten.
   - Der Vorab-Cache der Bestandsbewertungen (T7) würde B etwa auf ein
     Drittel verkürzen. Für die Prüfung eines Startgenoms ist er nicht nötig;
     vor regelmäßigen Läufen auf dem VPS (0,75 CPU) ist er zu empfehlen.
5. **Kostenstress** wirkt analytisch auf denselben Trades; zusätzliche
   Ablehnungen durch R-008 bei höheren Kosten würden nur Trades entfernen.
6. **Noch nicht verdrahtet.**
   - Der Forschungszyklus ruft den Portfolio-Weg erst auf, wenn eine Familie
     `independence` setzt. Diese Verdrahtung (Schritt 5d, `evaluate-seed`,
     Ende-zu-Ende-Test) gehört zum Familienschritt.
   - Die Prüfroutine dafür ist fertig und getestet
     (`apps/evolution-worker/src/cycle/portfolioAssessment.ts`).
   - Pfad A innerhalb einer eigenständigen Familie braucht freigegebene
     Familienmitglieder, die es noch nicht geben kann.
7. **Forward.** Ein späterer Forward-Test braucht einen eigenen
   Strategie-Schlüssel und einen gesonderten Beschluss über die Freigabeliste
   der Risk Engine.
8. **Kopien stoppt im Portfolio-Weg nur `OWN_ALPHA`.** Die Gegenprobe
   zeigt: Eine Kopie des Challengers besteht alle reinen Wertprüfungen; die
   Zuwachs-Signifikanz stoppt sie nur knapp (t 2,22). Die zweite Sperre ist
   die Strukturprüfung `INDEPENDENT_FAMILY`. Sie hängt an der ehrlichen
   Familienerklärung, die bei der Vorregistrierung der Familie geprüft wird.

## 10. Was ein v4-Vorschlag bedeutet

Ein bestandener historischer Test, mehr nicht.

- Daten bis 2023 sind durch alle bisherigen Versuche abgenutzt, der Holdout
  ist analysiert.
- Nachweis liefert nur ein Forward-Test auf Daten ab 2026-10-15, nach
  ausdrücklicher Freigabe.
- Nichts wird automatisch freigegeben, nichts handelt Echtgeld.
