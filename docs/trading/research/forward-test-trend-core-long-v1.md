# Forward-Test CRYPTO_TREND_CORE_LONG_V1 (Champion)

> **Phase `LOCAL_SHAKEDOWN`** (seit 2026-10-14, nachträglich so gekennzeichnet):
> lokaler Systemtest auf dem Entwicklungs-Mac, **kein offizielles
> Forward-Ergebnis**. Der offizielle Test läuft auf dem VPS
> ([official-forward-test-v1.md](official-forward-test-v1.md)); beide werden
> nie verglichen oder zusammengeführt. Der Mac schläft zeitweise — Ausfälle
> stündlicher Jobs sind hier erwartet.

Echter Shadow-Forward-Test auf unbekannten Live-Marktdaten (Binance Spot,
BTCUSDT). Alles nach dem Startzeitpunkt sind Forward-Daten, die beim Entwurf
der Strategie nicht bekannt waren. Kein Echtgeldhandel.

## Startzeitpunkt

**2026-10-14T13:59:19.759Z** — Aktivierung der Session
(`SESSION_ACTIVATED`, Audit-Event `cmv86esj70001itykupihtlgm`), in derselben
Sekunde Start des Trading-Workers (`de.jul1us.signalpilot-trading-worker`).
Die BTC-Zuweisung wurde um 2026-10-14T13:58:44.922Z aktiviert
(`STRATEGY_ASSIGNMENT_ENABLED`, `cmv86e1na0000ituouch2p0wu`).

Ausgewertet wird jede `TradeCandidate`/`ShadowPosition` der unten genannten
StrategyVersion mit `createdAt` ≥ Startzeitpunkt.

## Eingefrorene Konfiguration

| | |
|---|---|
| Strategie | `CRYPTO_TREND_CORE_LONG_V1`, StrategyVersion `cmv86cr4e000aitrktpz6ioh0` (v1) |
| Engine / Spezifikation | `crypto-mtf-breakout-v1/1.2.0`, Hash `8bb3bb93798b2adc8ee33b64181b99d49961385e0bb733f611689322eca6c7dd` |
| Regime | `crypto-native-regime-v1/1.0.0` (`MarketRegimeSnapshot.reportJson.cryptoNative`) |
| Zuweisung | BTCUSDT, 1h, `cmv86cr4f000citrkmvqshcpd`; ETH und LONG_V1 deaktiviert |
| Portfolio | `SHADOW_V1` (`cmssq3g6s000106dvosc5cz6f`), Startkapital 10 000 USDT |
| Risk | RiskLimitSet `SHADOW_V1` v1 (`ff9ab296…`), Regelwerk `risk-rules-v1/1.2.0` (ab 14:39 `1.3.0`, siehe Protokoll), 0,25 % Risiko je Trade |
| Kosten | InstrumentExecutionProfile BTCUSDT v2 (`cmv86cx7t0002its9urai7gi8`), siehe unten |
| Build bei Start | `400ed95` (Branch `claude/inspiring-noether-rjh92d`) |
| Daten | Binance Spot über den laufenden Daten-Worker (`de.jul1us.signalpilot-worker`), kein synthetischer Feed |

## Execution-Kosten

Profil `BINANCE_SPOT_VIP0_ESTIMATE_V1` (`shadowExecutionProfileCalibrate`):

| | Annahme | Begründung | Gemessen am 2026-10-14 (Binance-Orderbuch BTCUSDT) |
|---|---:|---|---|
| Gebühr | 10 bp je Seite | Spot-Taker-Gebühr der Basisstufe VIP 0 ohne BNB-Rabatt (mit BNB 7,5 bp) — die höchste reguläre Gebühr | — |
| Spread (voll) | 2 bp | Puffer; BTCUSDT handelt praktisch immer mit einem Tick (0,01 USDT) Spread | 0,0012 bp |
| Slippage | 3 bp je Seite | Puffer für die Zeit zwischen Entscheidung und Fill; die Shadow-Orders (≈ 400–1 500 USDT) liegen weit unter der Top-of-Book-Tiefe | 0 bp bei 1 500 und 25 000 USDT (Top-Ask-Tiefe 97 000–495 000 USDT) |

Der Fill-Preis liegt damit je Seite 4 bp (halber Spread + Slippage) über bzw.
unter dem Referenzpreis, plus 10 bp Gebühr. Das ist exakt das
REALISTIC-Profil, unter dem die Strategie den vorregistrierten Test bestand.
Der frühere Platzhalter `MANUAL_CONSERVATIVE_V1` (10/10/10 bp) ist `RETIRED`.

## Regeln während des Forward-Tests

1. **Strategie unverändert.** Jede Änderung an Regeln, Parametern oder
   Regime-Modell ist eine neue StrategyVersion (anderer Hash) und beendet
   diesen Forward-Test; sie bekommt einen eigenen Startzeitpunkt.
2. **Bugfixes getrennt.** Fehlerbehebungen außerhalb der Strategie-Identität
   (Daten, Jobs, Betrieb) werden unten mit Datum, Commit und Wirkung
   eingetragen. Die StrategyVersion bleibt; ein späterer Build ist im
   Eligibility-Report als `STRATEGY_VERSION_BUILD`-Warnung sichtbar.
3. Der Test misst auch Betriebsausfälle: Zeiten ohne Scheduler (z. B.
   schlafender Mac) werden hier notiert, nicht nachträglich aufgefüllt.

## Änderungsprotokoll (Bugfixes und Betrieb, keine Strategieänderungen)

| Datum (UTC) | Commit | Art | Beschreibung |
|---|---|---|---|
| 2026-10-14 13:55 | — | Betrieb | Daten-Worker mit dem aktuellen Build neu gestartet (schreibt das crypto-native Regime); Migrationen 26/27 angewendet; alte LONG_V1-Zuweisung deaktiviert, Session vor der Umstellung pausiert. |
| 2026-10-14 14:39 | `d7f5781` | Bugfix | **R-024** (keine Risikoerhöhung nach Verlust) verglich mit dem vorherigen *genehmigten Betrag* statt mit dem vorherigen *Budget* (Spezifikation). Rundungsreste der Menge hätten nach dem ersten Verlust eine kritische Risikoerhöhung mit `ERROR_LOCK` ausgelöst und den Champion gesperrt. Regelwerk jetzt `risk-rules-v1/1.3.0`. Positionsgröße unverändert; bis hierhin gab es keinen geschlossenen Trade, also keine betroffene Entscheidung. |
| 2026-10-14 14:39 | `d7f5781` | Infrastruktur | Regime-Exit (`exitPolicy: EXIT_ON_REGIME_GATE_CLOSED`) im Positions-Monitor. Greift nur für Versionen, die ihn im gehashten Parametersatz deklarieren; der Champion tut das nicht und ist nicht betroffen. |
| 2026-10-14 14:39 | `3ce22ac` | Infrastruktur | Champion/Challenger-Trennung: Die Entry-Sperre bewertet jedes Portfolio einzeln, der Circuit Breaker zählt Risk-Events je Portfolio. Für den Champion ändert sich keine Entscheidung; ein Problem im Challenger-Portfolio kann ihn nicht mehr blockieren. |
| 2026-10-14 14:39:25–14:39:50 | `21cb2b2` | Betrieb | Trading-Worker mit Build `3ce22ac` neu gestartet. Der erste Versuch scheiterte an launchd (`Bootstrap failed: 5`) und ließ den Worker etwa 25 s entladen; im Fenster lag kein Kandidaten-Scan (der läuft zur Minute 05). Das Ops-Skript wartet jetzt auf das Entladen. |
| 2026-10-14 14:41 | — | Betrieb | Challenger-Portfolio `SHADOW_CHALLENGER_V1` angelegt und aktiviert ([eigener Forward-Test](forward-test-regime-long-v1.md)). Eigener Ledger und eigene Session; die Champion-Zuweisung blieb unverändert aktiv. |
| 2026-10-14 16:00:25 | `7a74257` | Infrastruktur | Arena-Migration `20261014160000_add_arena` in die Dev-DB eingespielt (vorher Backup `backups/homebrew-dev-before-arena-20261014T160025Z.dump`). Rein additiv: nur neue Arena-Tabellen; keine bestehende Tabelle, kein Ledger, keine Session, keine Strategieversion geändert. |
| 2026-10-14 16:01 | `7a74257` | Betrieb | Als Teilnehmer der SignalPilot Arena registriert (`ARENA_V1:CRYPTO_TREND_CORE_LONG_V1:v1`, Status `CHAMPION` per Operator-Designation). Forward-Start, Portfolio, Kapital, Ledger und Session unverändert; die Arena liest nur und empfiehlt ([17-arena.md](../17-arena.md)). |
| 2026-10-14 16:06:30.168–16:06:31.756 | `6dee3f4` | Betrieb | Trading-Worker neu gestartet, damit der stündliche Arena-Job `trading:arena-evaluate` (Minute 20) registriert wird. Unterbrechung 1,6 s, außerhalb jeder Job-Minute; der Kandidaten-Scan um 16:05 lief vorher regulär. Keine Änderung an Strategie, Risk Engine oder Ausführung. |
| 2026-10-14 18:41 | `49f6185` | Infrastruktur | Migration `20261014190000_ops_monitoring_and_arena_phase` (additiv: neue Alert-Typen, Kohorten-Phase). Kohorte `ARENA_V1` als `LOCAL_SHAKEDOWN` gekennzeichnet (Audit `ARENA_PHASE_CHANGED`). Lokale Alerts werden ab jetzt nur aufgezeichnet, nicht mehr zugestellt; zugestellt wird nur noch vom VPS. |
| 2026-10-14 18:41:13.005–18:41:14.191 | `49f6185` | Betrieb | Trading-Worker-Neustart (1,2 s) mit 24/7-Monitoring und Nachhol-Scan: Der Kandidaten-Scan läuft alle 5 Minuten mit Anker-Cursor, weiterhin genau eine Entscheidung je geschlossener Stundenkerze. Keine Strategieänderung. |
| 2026-10-14 18:41:28 | `49f6185` | Betrieb | Ende-zu-Ende-Test des Alert-Pfads: genau ein `OPS_TEST`-Alert über n8n zugestellt (`SENT`), keine Handelsaktion. |
| 2026-10-14 18:57–19:07 | `9932852` | Betrieb (geplante Downtime) | Restart-/Downtime-Probe: Daten- und Trading-Worker 10 min gestoppt; dadurch fielen die Daten-Pipeline um 19:00 und der Scan um 19:05 aus. Ergebnis von `opsConsistency compare`: alle 17 Prüfpunkte bestanden. Ledger = Cache, keine Doppelverarbeitung, Sessions und Kill Switches erhalten, Teilnehmer getrennt, Arena-Kette intakt, Kerzenlücken (auch 16:00–18:00 vom Mac-Schlaf) beim Start nachgeladen. Der verpasste Scan wurde um 19:10 genau einmal je Strategie nachgeholt. |
| 2026-10-14 16:20–18:41 | — | Betriebsausfall | Der Mac schlief zeitweise. Stündliche Jobs um 17:00 und 18:00 entfielen (Daten-Pipeline, Scan, Performance, Arena), Minuten-Jobs liefen nur in Wachphasen. Nicht nachträglich aufgefüllt; Anlass für den VPS-Betrieb. |
| 2026-10-14 19:21:38.439–19:21:39.827 | `fdf797c` | Bugfix (Monitoring) | Trading-Worker-Neustart (1,4 s): Die Job-Überwachung erwartete den Performance-Refresh unter falschem Namen und hätte einen Stillstand nicht gemeldet. Betrifft nur das Monitoring, nicht Strategie, Risk oder Ausführung. |
