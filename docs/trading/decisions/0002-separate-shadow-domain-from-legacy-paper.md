# ADR 0002 – Neue Shadow-Domäne statt Erweiterung der Legacy-Paper-Modelle

- Status: Accepted
- Datum: 2026-08-01

## Kontext

`PaperAccount`, `PaperOrder` und `PaperPosition` existieren seit der initialen Migration, werden im untersuchten Laufzeitcode aber nicht erzeugt oder gelesen. Ihre Felder/Zustände decken weder Strategie/Risiko/Evidenz noch Fills, Partial Fills, Kosten, ExitPlan, Ledger, Idempotenz, Recovery oder Audit ab. `PaperSignalEvaluation` ist aktiv, wertet jedoch Signalbewegungen und keine Trades aus.

## Entscheidung

Neue `Shadow*`-/`Portfolio*`-Modelle werden side-by-side angelegt. Die drei ungenutzten Legacy-Modelle werden nicht erweitert, nicht backfilled und nicht automatisch konvertiert; dokumentarisch gelten sie als deprecated. `PaperSignalEvaluation` bleibt unverändert Research und wird strikt aus Shadow-Performance ausgeschlossen.

## Folgen

- Eindeutige Semantik und sichere Constraints ohne riskante Legacy-Kompatibilität.
- Vorübergehende Schema-Dopplung.
- Ein späterer Drop benötigt Daten-/Consumer-Audit und eigene Migration/ADR. Alte Zeilen können mangels Fill-/Fee-/Riskdaten nicht wahrheitsgetreu migriert werden.

## Verworfene Alternativen

- Bestehende Modelle schrittweise erweitern: vermischt ungenutzte Minimalobjekte mit der neuen fachlichen Wahrheit und erzwingt problematische Statusmigrationen.
- `PaperSignalEvaluation` als Trade behandeln: erzeugt falsche Cash-, Fill- und P&L-Aussagen.
