# ADR 0019 – Gates v4: Portfolio-Mehrwert eigenständiger Strategiefamilien

- Status: Accepted
- Datum: 2026-10-16

## Kontext

Die Risk Engine erlaubt Long-Einstiege nur bei Krypto-`RISK_ON` (R-020).
Der Challenger nutzt diesen Raum fast vollständig: Er ist 25,5 % der Zeit im
Markt, bei rund 30 % offenem Gate. Unter Gates v3 hat deshalb **jede** neue
Long-Familie rund 100 % „bespielte Einstiege“, und Pfad B
(Diversifikation) ist unerreichbar. Pfad A misst gegen den Challenger auch
Trade-Kennzahlen wie Ø R, Profit Factor und Trade-Zahl. Für eine Strategie
mit anderer Haltedauer messen diese Werte die Bauart, nicht die Qualität.

Der Betreiber hat entschieden: Die Überschneidung mit offenen
Challenger-Positionen wird **nicht** einfach ignoriert. Stattdessen soll ein
eigenes Gates v4 bewerten, ob eine eigenständige Strategie das
Gesamtportfolio bei gleichem Kapital, realistischen Kosten und unveränderten
Risk-Regeln tatsächlich verbessert.

## Entscheidung

1. **Gates v4** (`evolution-gates-v4`) übernimmt v3 mit identischen Schwellen
   und Methoden für BREAKOUT_LONG und REGIME_LONG.
2. **Eigenständige Familie.** Eine Familie gilt als eigenständig, wenn sie
   sich in ihrer Spezifikation als eigenständig erklärt
   (`FamilySpec.independence`):
   - eigener Einstiegs-Evaluator;
   - nur Einstiegsparameter sind suchbar;
   - eingefrorene Ausstiege;
   - eigene Forschungsidentität und eigene Vorregistrierung.

   Kandidaten einer solchen Familie entscheidet der **Portfolio-Weg**.
3. **Grundlage ist die chronologische Mehrstrategien-Simulation**
   (`portfolio-replay-v1`). Einzelne Backtests werden nicht nachträglich
   addiert.
   - Kapitalrahmen: feste, gleich große Plätze à 20 000 USDT.
   - Vergleich A: der Bestand und ein Reserveplatz als Kasse.
   - Vergleich B: der Kandidat auf diesem Platz.
   - Jeder Einstieg wird zuerst vom unveränderten `evaluateRisk` des eigenen
     Portfolios geprüft.
   - Nur nach dieser Freigabe folgen die unveränderten Regelfunktionen
     R-010, R-013, R-014 und R-015 auf der Gesamtsicht (`group-risk-v1`).
     Sie können nur ablehnen.
4. **Prüfungen:** v1-Basis auf den eigenen Backtests, Eigenständigkeit,
   Geometrie, Nettozuwachs und Sharpe in allen Fenstern, Rendite je
   Drawdown, Risiko- und Kapitaleffizienz, Stabilität über Marktphasen,
   Kostenstress, eigenes α und ein signifikanter gepaarter Zuwachs des
   Gesamtportfolios. Für α und Zuwachs gilt die Mehrfachtest-Schwelle.
   Nachbarvarianten und der Holdout dienen nur als Schutz. Einzelheiten:
   [Vorregistrierung](../research/2026-10-16-evolution-gates-v4-preregistration.md).
5. **v1–v3 bleiben unverändert** und wählbar, ihre Hashes sind
   festgenagelt. v4 hat einen eigenen Hash, der Schwellen, Methoden,
   Simulation und Kapitalrahmen umfasst. Der Standard bleibt vorerst v3
   (`EVOLUTION_GATES_VERSION`). Für eine eigenständige Familie ist v4
   Pflicht.
6. **Keine rückwirkende Neubewertung, kein Zurücksetzen des
   Mehrfachtest-Zählers.** Bekannte Ergebnisse sind kein unabhängiger
   Nachweis. Ein bestandenes v4 heißt nur „historisch nicht widerlegt“.
7. **Risk Engine, Champion, Challenger, Arena V1 und der offizielle
   Forward-Test bleiben unberührt.** Ein späterer Forward-Test einer neuen
   Familie braucht einen eigenen Strategie-Schlüssel und einen gesonderten
   Beschluss über die Freigabeliste der Risk Engine.

## Konsequenzen

- Eine eigenständige Strategie kann nicht mehr scheitern, nur weil der
  Challenger dasselbe Asset hält. Sie muss aber belegen, dass das
  Gesamtportfolio nach Kosten mehr verdient und dass dieser Mehrertrag nicht
  aus denselben Bewegungen stammt.
- Kopien, Neugewichtungen und Ausstiegsvarianten bestehender Strategien
  scheitern am α-Test. Die Gegenprobe auf echten Daten belegt das (siehe
  Vorregistrierung).
- Die statistische Hürde ist hoch: t ≥ 2,82 bei 69 Monaten verlangt ein
  jährliches Informationsverhältnis von rund 1,2. Mäßige, aber wertvolle
  Vorteile werden historisch meist verworfen. Nachweis liefert nur ein
  Forward-Test.
- Jede Bewertung kostet zwei Portfolio-Simulationen. Vergleich A wird je Lauf
  einmal gerechnet; Vergleich B kostet je Kandidat etwa so viel wie sechs
  Einzel-Backtests.
- Unter den heutigen, gleichen Prozentgrenzen greifen die Gruppenregeln nur
  bei Kursdrift oder Gap-Verlusten. Eine strengere gemeinsame Grenze wäre
  eine neue Risk-Grenze und eine eigene Entscheidung.
