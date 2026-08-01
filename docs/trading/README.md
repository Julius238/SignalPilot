# SignalPilot Shadow Trading

Status: Architektur- und Implementierungsspezifikation, Stand 2026-08-01. In diesem Arbeitspaket wurde keine Trading-Funktion implementiert.

## Ziel und Sicherheitsgrenze

Die erste Trading-Stufe verarbeitet reale, bereits in SignalPilot gespeicherte Marktdaten, führt Entscheidungen und Ausführung jedoch vollständig intern und simuliert aus:

```text
Asset Discovery / feste Zuweisung
  -> Signale, Radar, News, Marktregime, Datenqualität
  -> versionierte Strategy Engine
  -> Trade Candidate mit unveränderlichem Evidenz-Snapshot
  -> deterministische Risk Engine
  -> Shadow Order und Shadow Fill
  -> Shadow Position und Exit
  -> Portfolio-, Performance- und Audit-Auswertung
```

Verbindlich ausgeschlossen sind Exchange-Zugangsdaten, Exchange-Schreibzugriffe, Demo- oder Echtgeld-Orders, Margin, Futures, Hebel und ein produktiver Handelsmodus. Ein `execution-service` und Exchange-Adapter gehören nicht zu Shadow v1.

## Dokumente

1. [Bestand und Gap-Analyse](01-current-state-and-gap-analysis.md)
2. [Shadow-Zielarchitektur](02-shadow-trading-target-architecture.md)
3. [Domänenmodell](03-domain-model.md)
4. [Zustandsmaschinen](04-state-machines.md)
5. [Strategy-v1-Spezifikation](05-strategy-v1-specification.md)
6. [Risk-Engine-v1-Spezifikation](06-risk-engine-specification.md)
7. [Shadow-Ausführungsmodell](07-shadow-execution-model.md)
8. [Dashboard und Betrieb](08-dashboard-and-operations.md)
9. [Spätere Demo-Adapter-Analyse](09-bitget-demo-adapter-analysis.md)
10. [Phasenplan für Claude](10-phased-implementation-plan.md)
11. [Offene Entscheidungen](11-open-decisions.md)
12. [Test- und Abnahmeplan](12-test-and-acceptance-plan.md)

Architekturentscheidungen stehen unter [decisions](decisions/). Bei Konflikten gilt in dieser Reihenfolge: Sicherheitsgrenze dieses Dokuments, akzeptierte ADRs, Fachspezifikationen, Implementierungsplan.

## Leitentscheidungen

- Shadow v1 erhält eine eigene Domäne und ein eigenes Ledger. Die ungenutzten Legacy-Modelle `PaperAccount`, `PaperOrder` und `PaperPosition` werden weder erweitert noch migriert; `PaperSignalEvaluation` bleibt eine getrennte Research-Auswertung.
- Strategie, Risiko und Simulation sind reine, deterministische Bibliotheken. Datenbank, Uhr, Scheduler und vorhandene Pipelines werden nur im neuen `apps/trading-worker` orchestriert.
- Alle fachlichen Eingaben, Versionen, Entscheidungen und Zustandsübergänge werden nachvollziehbar persistiert. Wiederholungen müssen über fachliche Idempotenzschlüssel sicher sein.
- Der sichere Ausgangszustand ist mehrstufig: Build ohne Exchange-Adapter, `TRADING_MODE=DISABLED`, Shadow-Features aus, keine aktive Strategiezuweisung und eine gestoppte Trading Session mit aktivem Kill Switch.
- Bitget bleibt ein technisch bevorzugter Kandidat für eine spätere Demo-Phase, darf aber erst nach erneuter technischer, rechtlicher und regionaler Freigabe integriert werden. Für Deutschland besteht nach der am 2026-08-01 geprüften offiziellen Quellenlage ein regulatorisches Ausschlusskriterium.

## Implementierungsregel

Claude arbeitet die Pakete in `10-phased-implementation-plan.md` nacheinander ab. Ein Paket darf nur beginnen, wenn die Abnahmekriterien und das Rollback des vorherigen Pakets erfüllt sind. Die unabhängige Codex-Prüfung ist nach jedem Paket erforderlich. Keine Phase darf implizit einen Live-Modus oder Exchange-Credentials einführen.
