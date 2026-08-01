# ADR 0003 – Reine, deterministische und versionierte Engines

- Status: Accepted
- Datum: 2026-08-01

## Kontext

Bestehende Signale, Regeln und Regime sind deterministisch, aber teilweise adaptiv und verwenden bei fehlenden Daten neutrale Werte. Tradingentscheidungen müssen vollständig reproduzierbar und fail-closed sein. Ein LLM kann keine harte Freigabe oder Größenbestimmung verantworten.

## Entscheidung

Strategy, Risk, Simulation und Portfolio sind reine Pakete ohne DB, Env, Systemuhr oder Netzwerk. Inputs sind vollständig, immutable, kanonisch gehasht und enthalten Engine-/Code-/Parameter-/Quellversionen. Fehlende Pflichtinputs blockieren. Ab Freigabe sind StrategyVersion, RiskLimitSet und ExecutionProfile immutable. Kein LLM steuert Entry, Approval, Sizing oder Exit.

## Folgen

- Golden-/Replaytests und unabhängige Prüfung sind möglich.
- Der Worker muss umfangreiche Snapshots assemblieren und persistieren.
- Jede materielle Semantikänderung erzeugt eine neue Version statt historische Ergebnisse umzuschreiben.

## Verworfene Alternativen

- Engines lesen selbst aus Prisma: versteckte Zeit-/Queryabhängigkeit und schwer testbare Entscheidungen.
- „Latest config“ beim Replay: historische Ergebnisse wären nicht reproduzierbar.
- LLM-Freigabe: nicht deterministisch und für harte Risikoregeln ungeeignet.
