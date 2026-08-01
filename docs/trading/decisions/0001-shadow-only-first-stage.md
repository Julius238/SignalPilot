# ADR 0001 – Shadow-only als erste Trading-Stufe

- Status: Accepted
- Datum: 2026-08-01

## Kontext

SignalPilot besitzt Analyse-, Discovery-, Signal-, Research- und Alertfunktionen, aber keine ausgeführte Trading-Domäne. Eine direkte Demo-/Exchange-Integration würde Strategie-, Risiko-, Portfolio-, Reconciliation- und Credentialrisiken gleichzeitig einführen.

## Entscheidung

Die erste Stufe ist ausschließlich interne Shadow-Simulation auf persistierten realen Marktdaten. Es gibt keinen Exchange-Adapter, Execution Service, API-Key, Demo-/Live-Orderpfad, Futures, Margin oder Hebel. Das Build-Artefakt soll technisch keine Exchangeorder senden können.

## Folgen

- Strategy/Risk/Simulation/Portfolio können isoliert und reproduzierbar validiert werden.
- Demo-Realismus wird zunächst nicht getestet; Candle-/Kostenannahmen werden explizit gespeichert.
- Ein späterer Adapter ist eine neue Sicherheitsgrenze mit eigener ADR, Threat Model, Freigabe und separatem Auftrag.

## Verworfene Alternativen

- Bitget Demo sofort integrieren: zu viele unvalidierte Grenzen und aktuell offenes/regional kritisches Eligibility-Gate.
- Execution Service als leeren Stub anlegen: schafft unnötige Adapterfläche und eine spätere Fehlkonfigurationsmöglichkeit ohne Shadow-v1-Nutzen.
