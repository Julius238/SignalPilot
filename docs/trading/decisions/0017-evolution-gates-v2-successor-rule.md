# ADR 0017 – Gates v2: Nachfolger-Regel der Evolution Engine

- Status: Accepted
- Datum: 2026-10-15

## Kontext

Der erste Forschungslauf auf echten Daten (2026-10-15) zeigte die
Regime-Familie als robusten Kern: Der Challenger erreicht über 2018–2023
Sharpe 1,07 bei unter 1 % Drawdown. Jede Ein-Schritt-Verfeinerung korrelierte
aber zu 0,98 mit ihm und wurde von der vorregistrierten Redundanz-Prüfung
(Gates v1) verworfen. Die Engine konnte erfolgreiche Strategien damit nur
kopieren, nie gezielt verbessern.

## Entscheidung

1. **Gates v2** ergänzt v1 um eine Nachfolger-Regel: Eine Fast-Kopie
   (Korrelation > 0,9) ausschließlich der **eigenen** eingefrorenen Wurzel
   wird nicht als redundant verworfen, sondern muss ihre Wurzel deutlich,
   in beiden Zeiträumen, gepaart signifikant (Newey–West, Student-t,
   Mehrfachtest-Schwelle) und ohne Verschlechterung übertreffen.
   Einzelheiten: [Vorregistrierung](../research/2026-10-15-evolution-gates-v2-preregistration.md).
2. **v1 bleibt unverändert** und wählbar (`EVOLUTION_GATES_VERSION=v1`);
   neue Durchläufe verwenden v2. Beide Versionen sind per Hash festgenagelt;
   jede Entscheidung trägt ihre Gate-Version.
3. **Keine rückwirkende Neubewertung**, Mehrfachtest-Zähler laufen weiter,
   bekannte Genome (auch frühere Nachbarvarianten) sind gesperrt, der
   bereits analysierte Holdout ist für Nachfolger nur Verschlechterungs-Schutz.
4. **Begrenzte Suchtiefe**: höchstens 8 Nachfolger-Prüfungen je Wurzel und
   Monat, höchstens ein Nachfolger-Finalist je Durchlauf.
5. Champion, Challenger, Arena V1 und der offizielle Forward-Test bleiben
   unberührt. Ein Nachfolger erhält erst nach Freigabe einen eigenen
   Shadow-Forward-Test und ersetzt nie automatisch seine Wurzel.

## Konsequenzen

- Verfeinerungen werden möglich, aber nur mit einem Nachweis, der auf
  denselben Daten deutlich strenger ist als für eigenständige Kandidaten.
- Mit 69 Monaten und einer Schwelle von derzeit etwa 2,7 werden die meisten
  Verfeinerungen weiterhin scheitern. Das ist gewollt: Ziel sind wirklich
  bessere Strategien, nicht mehr Vorschläge.
- Jede künftige Änderung der Schwellen ist eine neue Gate-Version mit eigener
  Vorregistrierung vor dem ersten Lauf.
