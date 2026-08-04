# SignalPilot Shadow Trading

Status: Shadow-Long und synthetischer Shadow-Short sind intern durch Strategy, Risk, Simulation, Portfolio, Worker, API, Dashboard, Performance und Audit implementiert, Stand 2026-08-04. Alle Trading- und Direction-Flags sowie alle Assignments bleiben standardmäßig deaktiviert; es wurde nichts produktiv aktiviert.

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

Verbindlich ausgeschlossen sind Exchange-Zugangsdaten, Exchange-Schreibzugriffe, Demo- oder Echtgeld-Orders, Margin, Futures, Hebel und ein produktiver Handelsmodus. Ein `execution-service` und Exchange-Adapter gehören nicht zu Shadow v1. Short ist eine synthetische, vollständig ungehebelte interne Simulation mit reserviertem Quote-Collateral: keine Exchange-Position, kein Funding, Borrowing oder Liquidationsmodell.

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
13. [Production Deployment und sicherer Bootstrap](13-production-deployment-runbook.md)
14. [Aktivierung des ersten BTC-Shadow-Tests](14-shadow-test-activation-runbook.md)
15. [72-Stunden- und 60-Tage-Beobachtungsplan](15-shadow-observation-plan.md)
16. [Rollback und Not-Aus](16-shadow-rollback-and-emergency.md)

Architekturentscheidungen stehen unter [decisions](decisions/). Bei Konflikten gilt in dieser Reihenfolge: Sicherheitsgrenze dieses Dokuments, akzeptierte ADRs, Fachspezifikationen, Implementierungsplan.

## Leitentscheidungen

- Shadow v1 erhält eine eigene Domäne und ein eigenes Ledger. Die ungenutzten Legacy-Modelle `PaperAccount`, `PaperOrder` und `PaperPosition` werden weder erweitert noch migriert; `PaperSignalEvaluation` bleibt eine getrennte Research-Auswertung.
- Strategie, Risiko und Simulation sind reine, deterministische Bibliotheken. Datenbank, Uhr, Scheduler und vorhandene Pipelines werden nur im neuen `apps/trading-worker` orchestriert.
- Alle fachlichen Eingaben, Versionen, Entscheidungen und Zustandsübergänge werden nachvollziehbar persistiert. Wiederholungen müssen über fachliche Idempotenzschlüssel sicher sein.
- Der sichere Ausgangszustand ist mehrstufig: Build ohne Exchange-Adapter, `TRADING_MODE=DISABLED`, Shadow-Features aus, keine aktive Strategiezuweisung und eine gestoppte Trading Session mit aktivem Kill Switch.
- Legacy `CRYPTO_MTF_BREAKOUT_V1` bleibt replayfähig. Neue Zuweisungen verwenden `CRYPTO_MTF_BREAKOUT_LONG_V1` und `CRYPTO_MTF_BREAKDOWN_SHORT_V1`; die richtungsfreien Asset-Scopes verhindern gleichzeitige Gegenpositionen und Exposure wird nicht genettet.
- Bitget bleibt ein technisch bevorzugter Kandidat für eine spätere Demo-Phase, darf aber erst nach erneuter technischer, rechtlicher und regionaler Freigabe integriert werden. Für Deutschland besteht nach der am 2026-08-01 geprüften offiziellen Quellenlage ein regulatorisches Ausschlusskriterium.
- Eine spätere echte Short-Ausführung wäre eine neue Architektur mit separat freigegebenem Futures-/Margin-fähigem Adapter, Borrow-/Funding-/Liquidationsrisiko und eigener ADR. Spot-Adapter dürfen Short niemals akzeptieren.

## Implementierungsregel

Claude arbeitet die Pakete in `10-phased-implementation-plan.md` nacheinander ab. Ein Paket darf nur beginnen, wenn die Abnahmekriterien und das Rollback des vorherigen Pakets erfüllt sind. Die unabhängige Codex-Prüfung ist nach jedem Paket erforderlich. Keine Phase darf implizit einen Live-Modus oder Exchange-Credentials einführen.
