# 11 – Offene Entscheidungen und Freigabegates

## Bereits entschieden

Nicht erneut zu erfinden sind: Shadow-only v1; eigene Shadow-Modelle side-by-side; BTCUSDT/ETHUSDT Spot-USDT Long; kein Hebel/Margin/Futures/LLM; reine versionierte Engines; Portfolio-Ledger; PostgreSQL-Idempotenz/Claims; Stop-first bei unbekannter Intrakerzenfolge; Session standardmäßig STOPPED/Kill aktiv; kein Execution Service/Adapter bis nach P9.

## Vor Implementierung zu entscheiden

| ID | Entscheidung | Vorgabe/Default | Spätestens | Blockiert |
| --- | --- | --- | --- | --- |
| OD-01 | initiales Shadow-Kapital | Vorschlag 10.000 USDT; einmaliges `INITIAL_CASH`, danach keine externen Cashflows | Setup in P5/P9 | Sessionaktivierung |
| OD-02 | belegte BTC-/ETH-Instrumentfilter | Tick/Step/MinQty/MinNotional dürfen nicht geraten werden; Source und `observedAt` dokumentieren | P5 Setup | Orderakzeptanz |
| OD-03 | initiales Fee-/Spread-/Slippage-Profil | Vorschlag 10/10/5 bp bei Limits 20/15; muss als Modellannahme genehmigt und versioniert werden | P4 Golden/P5 Setup | vergleichbare Performance |
| OD-04 | Indikator-Pinning | bevorzugt Wrapper/Golden-Vektor gegen `packages/indicators`, nicht unversionierte Direktabhängigkeit | P2 | Strategy-Abnahme |
| OD-05 | Deterministische High-Impact-News/Event-Taxonomie für Crypto | bis eine belegte Taxonomie existiert, News leer/neutral gibt keinen Bonus; nur bereits deterministisch klassifizierter negativer High-Impact-Konflikt blockiert | P2 Input Assembler | News als Risk Guard, nicht Kernentry |
| OD-06 | RiskLimitSet-Freigabeprozess | mindestens Ersteller + dokumentierte Codex-Prüfung; Dual Control im UI noch offen | P5 Setup | Sessionaktivierung |
| OD-07 | zusätzlicher Gesamt-Drawdown-Kill | v1 beobachtet Drawdown, setzt außer Tageslimit/Loss Streak keinen willkürlichen Grenzwert; z. B. 5 % erst nach Nutzerentscheidung | vor P9 | nur Demo-Promotion, nicht P1–P8 |
| OD-08 | Reconcile-Freshness für Aktivierung | Architekturvorschlag maximal 5 Minuten und erfolgreicher Startup-Reconcile | P5 | Sessionaktivierung |
| OD-09 | Admin-Korrekturen am Ledger | keine v1-UI; manueller, reviewed Command mit Gegenbuchung oder komplett außerhalb P1–P9 | P5 | Incident-Runbook |
| OD-10 | Alert-Outbox | fachliche Wahrheit bleibt RiskEvent; persistente Notification-Outbox vor unbeaufsichtigtem Betrieb empfohlen | P8/P9 | unbeaufsichtigter Soak |
| OD-11 | Audit-/Fill-/Ledger-Retention und Archivierung | keine Löschung in v1; Kapazitäts-/Backupplan festlegen | vor P9 | langer Soak |
| OD-12 | eine oder mehrere Sessions pro Portfolio | v1 exakt eine nicht geschlossene Session; Partial Unique Constraint festlegen | P1 | Schema |
| OD-13 | Umgang mit strategy-bedingter Seltenheit | keine Schwellen lockern, um 50 Trades zu erzwingen; Messfenster verlängern | P9 | Demo-Promotion |
| OD-14 | negative unrealized P&L beim Tageslimit | entschieden vorgeschlagen: einbeziehen; positive unrealized konservativ gegengerechnet. Fachlich bestätigen | P3 | Risk Golden |
| OD-15 | Worker-Claim-Technik | PostgreSQL Advisory Lock pro Job plus persistierte Claims/Unique Constraints; konkrete Lock-Key-Ableitung festlegen | P5 | Multi-Prozess-Tests |

## Vor Discovery-Erweiterung zu entscheiden

| ID | Frage | Mindestnachweis |
| --- | --- | --- |
| OD-20 | Welche weiteren Assets? | separate Allowlist/Assignment, USDT Spot, Liquidität, DQ, 60-Tage-Shadowprofil |
| OD-21 | Dynamische Korrelation statt fester Gruppe? | reproduzierbares Fenster, Missing-Data-Verhalten, keine Lockerung bei Unsicherheit |
| OD-22 | Beobachtete Spread-/Orderbuchdaten | Provider, Retention, Freshness, Ausfallmodus und Kalibrierung gegen Fills |
| OD-23 | Discovery -> Trading Governance | Discovery darf nur vorschlagen; wer genehmigt Execution Profile/StrategyAssignment und wie wird deaktiviert? |

## Blocker vor Bitget Demo oder Alternativadapter

| ID | Entscheidung/Gate | Aktueller Stand 2026-08-01 |
| --- | --- | --- |
| OD-30 | Region/Terms/Entity des tatsächlichen Nutzers | Bitget Terms nennen Deutschland als verboten; für deutschen Wohnsitz aktuell No-Go |
| OD-31 | schriftlich belegte Demo-/API-Berechtigung für Bestandskonto | offen; vorhandene Handelsnutzung reicht nicht |
| OD-32 | UTA V3 versus Classic V2 | V3 bevorzugt, konkreter Demo-Endpunktumfang muss in isoliertem Spike belegt werden |
| OD-33 | Spot Demo Account Mode | muss Spot-only ohne Margin/Futures zulassen und im Startup attestierbar sein |
| OD-34 | Key-Permissionsgranularität | Read + Spot Trade only; Transfer/Withdrawal/Copy/Futures nachweislich aus; unklar = No-Go |
| OD-35 | statische Egress-IP/Allowlist/Secret Store | Infrastruktur und Rotation offen |
| OD-36 | Venue-Datenkonsistenz | Shadow nutzt derzeit Binance-Candles; Bitget-Ausführung gegen Binance-Signale birgt Basis-/Spreadrisiko. Vor Demo entweder Bitget-Marktdaten integrieren oder Abweichung hart messen/blocken |
| OD-37 | Alternative bei regionalem Bitget-No-Go | Binance Demo/Testnet oder Bybit/Bybit EU nach eigener aktueller Regional-/API-Prüfung |
| OD-38 | Demo -> Live | ausdrücklich nicht entschieden und nicht Teil dieses Programms; neue Gesamtarchitektur/Threat Model erforderlich |

## Entscheidungsprotokoll

Jede Entscheidung erhält Datum, Entscheider, geprüfte Quellen/Codeversion, Ergebnis, betroffene Parameter/Dateien und Rollback. Materielle Architekturänderungen werden als ADR in `docs/trading/decisions` abgelegt. Externe Anbieterfakten werden unmittelbar vor Nutzung erneut über offizielle Dokumentation geprüft.
