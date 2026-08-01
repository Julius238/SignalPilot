# ADR 0004 – PostgreSQL-Workflow, append-only Ledger und atomarer Trading-Audit

- Status: Accepted
- Datum: 2026-08-01

## Kontext

Der bestehende Scheduler schützt nur im Prozess gegen Überlappung. `BotRun`/`BotLog` sind Observability; `AuditLog` wird best effort und oft asynchron geschrieben. Geld-/Positionszustände benötigen prozessübergreifende Idempotenz, Recovery und atomare Belege. Redis ist vorhanden, aber nicht als bestehende App-Queue etabliert.

## Entscheidung

PostgreSQL ist v1 Queue-/Claim-/Lock- und Wahrheitssystem. Advisory Locks verhindern reguläre Doppelstarts; Unique Constraints, Claims, compare-and-swap und fachliche Keys garantieren Idempotenz. Portfolio-Cash/P&L wird durch append-only `PortfolioLedgerEntry` belegt. Status-/Geldtransaktion und append-only `TradingAuditEvent` committen atomar. Projektionen sind rebuildbar.

## Folgen

- Keine zusätzliche Queue-Infrastruktur für v1.
- Geldmutation erfordert Serialisierung/Row Lock und mehr DB-Integrationstests.
- Unklare Ledgerdifferenzen locken die Session; Caches werden nicht blind repariert.
- Externe Alerts erfolgen nach Commit und benötigen für garantierte Zustellung später eine Outbox.

## Verworfene Alternativen

- Nur In-Memory-Locks: wirkungslos über Prozessgrenzen/Restarts.
- Redis als alleinige Wahrheit: unnötige zweite Zustandsquelle.
- `currentBalance` ohne Ledger: nicht replaybar/auditierbar.
- bestehendes Best-effort-Audit allein: kann fachliche Wirkung ohne Beleg hinterlassen.
