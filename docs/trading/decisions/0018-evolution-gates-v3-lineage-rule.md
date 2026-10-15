# ADR 0018 – Gates v3: Linien- und Diversifikationsregel der Evolution Engine

- Status: Accepted
- Datum: 2026-10-15

## Kontext

Unter Gates v2 bestand EVO-REG-0004 alle Prüfungen, obwohl er schwächer war
als der Challenger, aus dem er abgeleitet ist. Seine Tagesrenditen
korrelierten mit 0,887 knapp unter der Nachfolger-Schwelle 0,90. Deshalb
wurde er nur am schwachen Champion gemessen. Der Betreiber hat ihn nach
manueller Prüfung abgelehnt. Ursache ist ein Korrelations-Schalter, der
bestimmt, gegen welche Referenz ein Kandidat antritt: Knapp darunter gilt die
schwächere Referenz. Korrelation lässt sich zudem durch andere Ausstiege
billig senken.

## Entscheidung

1. **Gates v3** entfernt den Schalter. Jeder Kandidat muss **unabhängig von
   der Korrelation** einen von zwei Pfaden bestehen:
   - **Mehrwert**: Er schlägt seine Wurzel, seine Elternstrategie und den
     besten bestehenden Familienvertreter je einzeln. Verlangt sind eine
     deutlich höhere risikobereinigte Nettorendite in beiden Zeiträumen,
     gepaart signifikant, und keine wesentliche Verschlechterung bei Profit
     Factor, Drawdown, Kosten, Marktphasen, Kapitalbindung, Validierung oder
     Stichprobe (vorregistrierte Toleranzen).
   - **Echte Diversifikation**: Korrelation ≤ 0,5 und höchstens 50 % schon
     bespielte Einstiege gegenüber jeder bestehenden Strategie. Das Portfolio
     wird in beiden Zeiträumen besser, ohne tieferen Drawdown. Dazu kommt ein
     signifikantes α, das keine Kombination der bestehenden Strategien
     erklärt.

   Einzelheiten: [Vorregistrierung](../research/2026-10-15-evolution-gates-v3-preregistration.md).
2. **v1 und v2 bleiben unverändert** und wählbar. Neue Durchläufe verwenden
   v3 (`EVOLUTION_GATES_VERSION`, Standard `v3`). Der v3-Hash umfasst
   Schwellen **und** Methodenkennungen.
3. **Keine rückwirkende Neubewertung.** Bekannte Ergebnisse sind kein
   unabhängiger Nachweis. Der Mehrfachtest-Zähler läuft weiter. Der Holdout
   ist nur Verschlechterungs-Schutz.
4. **Begrenzte Abnutzung**: höchstens 10 Validierungsprüfungen je Familie
   und Monat über alle Versionen; Hypothesen darüber werden ohne Backtest
   verworfen. Höchstens ein Finalist je Familie und Durchlauf.
5. **Betreiberentscheidungen wirken auf die Suche**: Ein vom Betreiber
   abgelehnter Kandidat ist keine zulässige Elternstrategie mehr. Ein
   freigegebener Kandidat wird Referenz seiner Familie und Teil des
   Vergleichsportfolios.
6. Champion, Challenger, Arena V1 und der offizielle Forward-Test bleiben
   unberührt. Nachweis liefert nur ein Forward-Test auf neuen Daten nach
   ausdrücklicher Freigabe. Nichts wird automatisch freigegeben, kein
   Echtgeld.

## Konsequenzen

- Ein schwächerer Nachfolger kann nicht mehr durch eine niedrigere
  Korrelation bestehen. Mit gleicher Linie scheitert er in Pfad A
  unverändert, und Pfad B verlangt Eigenständigkeit in Einstiegen und
  Erträgen, die eine Parametervariante nicht vortäuschen kann.
- Die Hürden steigen für alle Kandidaten. Bei 69 Monaten und N = 43 liegt die
  Signifikanzschwelle bei etwa 2,7. Die meisten Varianten werden scheitern.
  Ziel sind belastbar bessere oder wirklich eigenständige Strategien, nicht
  mehr Vorschläge.
- Pro Kandidat fallen zusätzliche Referenz-Backtests an: Elternstrategie,
  freigegebene Kandidaten und deren Holdout als Referenz. Sie werden je
  Code-Stand zwischengespeichert.
- Jede künftige Änderung einer Schwelle oder Berechnung ist eine neue
  Gate-Version mit eigener Vorregistrierung vor dem ersten Lauf.
