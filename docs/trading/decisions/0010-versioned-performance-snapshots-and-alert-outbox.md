# ADR 0010 – Versionierte Performance-Snapshots und eine abgeleitete Alert-Outbox

- Status: Accepted
- Datum: 2026-08-03

## Kontext

P8 verlangt zwei Dinge, die sich mit dem P1-Schema nicht gleichzeitig erfüllen ließen:

1. **Segmentierte, reproduzierbare Performance.** Kennzahlen sollen nach StrategyVersion, Asset, Marktregime, UTC-Zeitraum und Exit-Grund vorliegen, und "keine historischen Ergebnisse überschreiben, wenn sich Berechnungslogik oder Version ändert". `StrategyPerformance` hatte aber genau einen Identitätsschlüssel: `@@unique([strategyVersionId, portfolioId, window, asOf])`. Darin ist weder Platz für mehrere Segmente desselben Fensters noch für zwei Engine-Versionen desselben Datenstands — eine Neuberechnung hätte den alten Stand zwangsläufig ersetzt.
2. **Eine transaktionale Alert-Outbox**, deren Ausfall Trading-Überwachung und risikoreduzierende Exits nicht blockieren darf.

## Entscheidung 1: `snapshotKey` statt Composite-Unique

`StrategyPerformance.snapshotKey` (gebaut von `buildStrategyPerformanceSnapshotKey` in `@signalpilot/trading-domain`) wird zur Identität einer Berechnung und umfasst Portfolio, Window, `asOf`, Segmenttyp, Segmentschlüssel, Engine-Version und Input-Hash. Der alte Composite-Unique-Index entfällt.

Zwei Folgeänderungen sind bewusst **nicht rein additiv**, aber beide erweitern statt einzuschränken und verlieren keine Zeile:

- `strategyVersionId` verliert `NOT NULL`. Ein Segment nach Asset, Regime oder Exit-Grund aggregiert über Strategy-Versionen hinweg und hat keine einzelne Version, auf die es zeigen könnte. `NULL` heißt hier "versionsübergreifend", nicht "unbekannt".
- Der alte Unique-Index wird durch `snapshotKey` ersetzt. Bestandszeilen werden in der Migration deterministisch mit ihrer eigenen `id` als `snapshotKey` gefüllt und bleiben unverändert erhalten.

Der vollständige Engine-Output inklusive aller `{ value, reason }`-Paare liegt in `metricsJson`; die typisierten Spalten sind eine abfragefreundliche Projektion davon, nie eine zweite Wahrheit. Eine nicht berechenbare Kennzahl ist `NULL` mit maschinenlesbarem Grund — nie `0`.

## Entscheidung 2: Die Outbox wird abgeleitet, nicht an zehn Stellen eingestreut

`enqueueTradingAlert` ist transaktionsfähig und schreibt Event und Outbox-Eintrag atomar. Gefüttert wird die Outbox aber nicht durch Aufrufe an den zehn Stellen, die eine der P8-Bedingungen auslösen können, sondern durch einen **Collector**, der aus dem persistierten Zustand ableitet: `RiskEvent`, `TradingSession`-Status, `ShadowPosition` ohne aktiven `ExitPlan`, `BotRun`-Historie. Jeder einzelne Enqueue läuft in derselben `$transaction` wie der Read, der die Bedingung beobachtet hat.

Begründung: Jeder P8-Trigger hat bereits eine dauerhafte Zeile mit einem stabilen Geschäftsschlüssel. Aus dieser Zeile abzuleiten liefert Exactly-once-Semantik *und* hält die heißen Trading-Pfade vollständig frei von Alerting-Code — das macht "ein Telegram-Ausfall verzögert keinen risikoreduzierenden Exit" zu einer strukturellen Eigenschaft statt zu einer Frage der Aufrufreihenfolge.

Eine Ausnahme: Ein offener Circuit Breaker hat keine eigene persistierte Zeile. Er wird dort gemeldet, wo der Scheduler ihn beobachtet — als Fire-and-forget-Insert, dessen Fehler geloggt und geschluckt wird.

Die Zustellung läuft in einem eigenen Job hinter einem eigenen Flag (`TRADING_ALERT_DELIVERY_ENABLED`). "Aufzeichnen ohne zu senden" ist der beabsichtigte Zwischenzustand während der Validierung des Alert-Katalogs.

## Folgen

- Eine Neuberechnung mit geänderter Engine-Version erzeugt neue Zeilen neben den alten; die Historie bleibt vollständig auditierbar.
- Die API muss Segmente eines Laufs über `inputHash` gruppieren, damit nie zwei Datenstände nebeneinander angezeigt werden (`GET /trading/performance/latest` tut genau das).
- Der Collector ist idempotent: ein zweiter Lauf über unveränderten Zustand schreibt nichts.
- `DEAD` ist terminal. Ein endgültig unzustellbarer Alert wird nie erneut versucht und blockiert stattdessen den Eligibility-Report.

## Verworfene Alternativen

- **Ein zweites Modell neben `StrategyPerformance`.** Hätte die Vorgabe "Nutze `StrategyPerformance` und vorhandene Snapshotmodelle" verletzt und zwei konkurrierende Performance-Wahrheiten erzeugt.
- **Den alten Unique-Index behalten und nur Gesamtwerte persistieren.** Hätte die geforderte Segmentierung nach Asset, Regime und Exit-Grund unmöglich gemacht.
- **`enqueueTradingAlert` an allen zehn `riskEvent.upsert`-Stellen aufrufen.** Invasiv in erprobten P4-Code und genau der Weg, auf dem Alerting doch wieder in einen Trading-Pfad gerät.
- **Fehlende Kennzahlen als `0` speichern.** Macht "kein Gewinn" und "nicht berechenbar" ununterscheidbar — bei einer Handelsauswertung der gefährlichste mögliche Fehler.
