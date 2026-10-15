# ADR 0016 – Evolution Engine: KI-Forschung, isoliert von Trading und Forward-Evidenz

- Status: Accepted
- Datum: 2026-10-15

## Kontext

SignalPilot soll langfristig profitabel und risikobewusst handeln. Claude
soll dazu über die API selbstständig Strategien erforschen, testen und
verbessern. Gleichzeitig läuft seit dem 2026-10-15 der offizielle
Forward-Test auf dem VPS, der weder verändert noch unterbrochen werden darf,
und jeder historische Zeitraum bis 2026-10-14 wurde bereits analysiert.

## Entscheidung

1. **Die KI erzeugt Daten, keinen Code.** V1 lässt sie nur geschlossene
   Parametergenome zweier Strategiefamilien vorschlagen. Jeder Wert liegt auf
   einem festen Raster; unbekannte Parameter werden verworfen. Ein Genom
   läuft als Research-Identität eines bereits registrierten Evaluators
   (dasselbe Override-Prinzip wie die Replay-Forschung vom 2026-10-14) und ist
   damit garantiert backtestbar und nie live ausführbar.
2. **Der Backtest ist der unveränderte historische Shadow-Replay** mit
   produktiver Strategy-, Risk-, Fill-, Portfolio- und Performance-Engine,
   denselben Kosten wie der offizielle Forward-Test und vorregistriertem
   Split. Champion und Challenger bleiben eingefroren; der Regime-Evaluator
   und der Replay erhalten nur additive, standardmäßig wirkungslose
   Research-Hooks (Golden Fixtures unverändert).
3. **Forward-Daten sind für die Forschung unerreichbar.** Der Snapshot-Lader
   verwirft jede Kerze ab dem Start des offiziellen Forward-Tests; die KI
   sieht Entdeckungs-Kennzahlen, von der Validierung nur das Urteil und vom
   Holdout nichts. Jede Datensicht wird in einem Exposure-Ledger gezählt.
4. **Eigene App, eigene Tabellen, eigene Datenbankrolle.**
   `apps/evolution-worker` importiert weder Trading-Worker noch API, schreibt
   nur `Evolution*`-Tabellen (ohne Fremdschlüssel zu Trading oder Arena) und
   läuft auf dem VPS in einem eigenen, ressourcenbegrenzten Container ohne
   Root, ohne Docker-Zugriff, mit einer Rolle, die nur diese Tabellen
   schreiben darf. Der Trading-Worker kennt die Evolution Engine nicht.
5. **Budget vor jedem Aufruf, tatsächliche Kosten danach.** Ein KI-Aufruf
   startet nur, wenn sein schlechtester Fall in Monats- (20 USD) und
   Durchlaufbudget (1 USD) passt; Kosten werden aus den gemeldeten Tokens
   je Modell berechnet. Ein erschöpfter Monat pausiert den Agenten bis zum
   Monatswechsel. Kein Aufladen, unbepreiste Modelle werden nie aufgerufen.
6. **Vorschlagen ja, entscheiden nein.** Die Engine kann Kandidaten nur
   vorschlagen. Freigabe ist ein Operator-Kommando; sie registriert nichts.
   Strategieversion, Portfolio, Session und Arena-Eintrag bleiben bewusste,
   getrennt deployte Schritte. Arena V1 bleibt unverändert und bewertet
   allein Forward-Ergebnisse. Keine automatische Echtgeld- oder
   Kapitalentscheidung.
7. **KI-generierter Strategie-Code ist vorbereitet, aber gesperrt.** Ein
   Sandbox-Vertrag (eigener Container ohne Netz, Datenbank und Secrets,
   JSON über stdin/stdout, harte Limits) ist festgelegt; der Schalter
   `EVOLUTION_CODE_GENERATION_ENABLED` lässt den Prozess sonst nicht starten.

## Konsequenzen

- Die Suche ist auf zwei Familien beschränkt; wirklich neue Strategielogik
  braucht die Code-Erweiterung oder einen menschlich geschriebenen Evaluator.
- Weil der Holdout bereits analysiert ist, kann V1 keine historische
  Profitabilität beweisen. Ein Vorschlag ist eine begründete Wette, die erst
  ein eigener Forward-Test prüft.
- Backtests sind rechenintensiv (rund 24 s je Jahr und Symbol); ein Durchlauf
  braucht auf einem begrenzten VPS-Kern rund eine Stunde und läuft deshalb
  wöchentlich.
- Änderungen an Split, Gates oder Kosten sind neue Versionen und werden nie
  mit V1-Ergebnissen gemischt.
