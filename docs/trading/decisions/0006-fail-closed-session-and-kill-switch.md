# ADR 0006 – Mehrstufige Fail-Closed-Aktivierung und risikoreduzierender Kill Switch

- Status: Accepted
- Datum: 2026-08-01

## Kontext

Der Bestand lehnt nur `ENABLE_LIVE_TRADING=true` ab; `PAPER_TRADING_ONLY` ist keine wirksame Codebarriere. Für Shadow Trading darf weder ein einzelnes Flag noch ein Prozessfehler unbemerkt neue Exposure zulassen. Ein Kill darf aber Stops/Schließungen nicht verhindern.

## Entscheidung

Aktivierung verlangt gleichzeitig Shadow-only Build, gültige fail-closed Config, Master-/Job-/Strategyflags, aktive explizite Assignment, grünes Reconcile, aktives Portfolio/Limit/Profile und separat auditierte Sessionaktivierung. Default: `TRADING_MODE=DISABLED`, Flags false, Assignment false, Session STOPPED, Kill true. Unbekannte Konfiguration startet nicht.

STOPPED/PAUSED/KILLED/ERROR_LOCKED blockieren Kandidaten, Approval, Reservierung und Entry. Sie erlauben Reconcile, Cancel ungefüllter Entries, Monitoring sowie risikoreduzierende Exits. Kill liquidiert nicht automatisch; Default ist `MANAGE_EXISTING`. Entsperren zu STOPPED und erneutes Aktivieren sind getrennte Aktionen.

## Folgen

- Mehrere unabhängige Fehler müssten zusammentreffen, bevor neue Exposure entsteht.
- Betrieb/UX sind absichtlich expliziter.
- Der Trading Worker benötigt einen eigenen Startup-Guard und kann sich nicht auf den bisherigen Schedulercheck verlassen.

## Verworfene Alternativen

- Ein Masterflag allein: zu leicht fehlkonfigurierbar.
- Kill blockiert alle Aktionen: könnte Risikoreduktion verhindern.
- automatische Sofortliquidation: kann bei Datenproblemen zusätzliche simulierte Verluste/Fehlbewertungen erzeugen.
