# ADR 0013 – Kein gleichzeitiges Long- und Short-Exposure je Portfolio und Asset

- Status: Accepted
- Datum: 2026-08-04

## Kontext

Sobald es zwei Richtungen gibt, kann dasselbe Portfolio theoretisch gleichzeitig BTC-Long und BTC-Short halten. Das ist aus mehreren Gründen unerwünscht: die Netto-Exposure wäre nahe null, während beide Positionen einzeln Risikobudget binden; die Limits (max. zwei offene Positionen, 0,25 % Risiko je Trade) würden faktisch umgangen; und Gebühren fielen doppelt an, ohne dass eine Marktmeinung dahinterstünde.

## Entscheidung

Für dasselbe Portfolio und dasselbe Asset darf **niemals** gleichzeitig Long- und Short-Exposure bestehen — weder als Position, noch als offene Entry-Order, noch als Umkehr vor vollständigem Schließen der Gegenposition.

Erzwungen wird das **auf Datenbankebene**, nicht durch einen Scheduler-Check. Der Mechanismus ist der bereits etablierte „nullbare Unique-Scope-Key" (docs/trading/03): eine Spalte trägt einen Schlüssel, solange die Zeile aktiv ist, und `NULL`, sobald sie terminal ist; PostgreSQL behandelt `NULL` in einem Unique-Index als distinkt.

Entscheidend ist dabei eine Eigenschaft, die leicht zu übersehen ist: **diese Scope-Keys enthalten die Richtung bewusst NICHT.**

- `ShadowPosition.openScopeKey` = `buildOpenPositionScopeKey({ portfolioId, assetId })`
- `ShadowOrder` bekommt analog einen `openEntryScopeKey` = `buildOpenEntryOrderScopeKey({ portfolioId, assetId, purpose: ENTRY })`

Weil die Richtung nicht Teil des Schlüssels ist, kollidiert ein Short mit einem bestehenden Long automatisch — dieselbe Unique-Constraint, die schon „kein Scale-in" garantiert, garantiert damit auch die Richtungs-Exklusivität. Würde man `direction` in den Schlüssel aufnehmen, wären Long und Short plötzlich erlaubt; beide Key-Builder tragen deshalb einen expliziten Kommentar, der das verbietet.

## Befund bei der Umsetzung

Der Positions-Schlüssel existierte bereits und war bereits richtungsfrei — die Positions-Exklusivität war damit **schon vor diesem Arbeitspaket transaktional garantiert**, ohne dass das jemand aufgeschrieben hatte.

Auf Orderebene bestand dagegen eine echte Lücke: `ShadowOrder.entryCandidateKey` ist pro _Candidate_ unique und verhindert nur eine doppelte Order zum selben Candidate. Zwei gleichzeitige Entry-Orders für dasselbe Asset aus _verschiedenen_ Candidates — etwa eine long und eine short — waren dadurch nicht ausgeschlossen. Der passende Helper `buildOpenEntryOrderScopeKey` lag seit P1 ungenutzt im Domain-Paket. Er wird jetzt an eine Spalte gebunden.

## Wo blockiert wird

Ein Candidate darf entstehen — die Strategie kennt den Portfoliozustand nicht und soll ihn nicht kennen. Blockiert wird spätestens fail-closed:

1. **Risk Engine:** eine eigene Regel refust einen Candidate, dessen Gegenrichtung im selben Asset offen ist.
2. **Order-Erzeugung:** die Unique-Constraint auf `openEntryScopeKey` lässt die zweite Order gar nicht erst entstehen, auch bei paralleler Ausführung.

Punkt 2 ist der eigentliche Schutz; Punkt 1 existiert, damit der Grund als Reason Code sichtbar wird statt als Constraint-Verletzung.

## Folgen

- Eine Richtungsumkehr braucht zwei Schritte: bestehende Position vollständig schließen, dann neu eröffnen. Es gibt keinen „Flip" in einem Schritt.
- Kein Netting von Long und Short bei der Exposure-Berechnung: beide Richtungen zählen konservativ absolut, damit Limits nicht künstlich kleingerechnet werden.
- Reconciliation muss gemischte Scopes als Inkonsistenz erkennen.

## Verworfene Alternativen

- **Nur ein Scheduler-Check:** zwei parallele Jobläufe könnten beide „frei" sehen und beide schreiben. Die Aufgabenstellung schließt das ausdrücklich aus.
- **Hedging erlauben und Exposure netten:** würde die Risikolimits aushebeln und ist für ein Testsystem ohne Hedging-Zweck sinnlos.
- **`direction` in den Scope-Key aufnehmen:** hätte Long und Short nebeneinander erlaubt — das genaue Gegenteil dieser Entscheidung.
