# Forward-Test CRYPTO_REGIME_LONG_V1 (Challenger)

Echter Shadow-Forward-Test des Challengers gegen den Champion
[`CRYPTO_TREND_CORE_LONG_V1`](forward-test-trend-core-long-v1.md). Die Regeln
wurden vor diesem Start festgeschrieben
([Regeln, Hypothese, Plausibilitätscheck](2026-10-14-challenger-regime-long-v1.md),
Commit `d7f5781`). Kein Echtgeldhandel.

## Startzeitpunkt

**2026-10-14T14:41:21.532Z** — Aktivierung der Challenger-Session
(`SESSION_ACTIVATED`, Audit-Event `cmv87wucc0001it56up3jdjlz`).

| Schritt | Zeit (UTC) | Audit-Event |
|---|---|---|
| Portfolio angelegt (Bootstrap) | 14:39:02.374 | `SHADOW_BOOTSTRAP_APPLIED` `cmv87tuz20008itj69lqvnuoi` |
| StrategyVersion + Zuweisung angelegt (deaktiviert) | 14:39:02.476 | `SHADOW_STRATEGY_SETUP_APPLIED` `cmv87tv20000bitj9q5mjuvip` |
| Portfolio aktiviert | 14:40:59.011 | `PORTFOLIO_ACTIVATED` `cmv87wcye0000it2xus4hxig6` |
| BTC-Zuweisung aktiviert | 14:41:15.681 | `STRATEGY_ASSIGNMENT_ENABLED` `cmv87wptn0000it45ydia6its` |
| Kill Switch gelöst | 14:41:15.781 | `SESSION_KILL_SWITCH_RELEASED` `cmv87wpw80001it4h833rr6e2` |
| **Session aktiv** | **14:41:21.532** | `SESSION_ACTIVATED` `cmv87wucc0001it56up3jdjlz` |

Ausgewertet wird jede `TradeCandidate`/`ShadowPosition` des Portfolios
`SHADOW_CHALLENGER_V1` mit `createdAt` ≥ Startzeitpunkt.

## Eingefrorene Konfiguration

| | |
|---|---|
| Strategie | `CRYPTO_REGIME_LONG_V1`, StrategyVersion `cmv87tv1x0008itj949l8uxgc` (v1) |
| Engine / Spezifikation | `crypto-regime-long-v1/1.0.0`, Hash `4708eaf89a39a2db9cebfd20564fce2f912dd731da74c5f658eb76c1ed64df6c` |
| Regime | `crypto-native-regime-v1/1.0.0` (`MarketRegimeSnapshot.reportJson.cryptoNative`) |
| Zuweisung | BTCUSDT, 1h, `cmv87tv1z000aitj9nn8eipef`; es gibt keine ETH-Zuweisung |
| Portfolio | **`SHADOW_CHALLENGER_V1`** (`cmv87tuyi0001itj69h03z1go`), Startkapital 10 000 USDT, Session `cmv87tuz10007itj6afy2g0lg` |
| Risk | dasselbe RiskLimitSet `SHADOW_V1` v1 (`ff9ab296…`) wie der Champion, Regelwerk `risk-rules-v1/1.3.0`, 0,25 % Risiko je Trade |
| Kosten | dasselbe InstrumentExecutionProfile BTCUSDT v2 wie der Champion (10 bp Gebühr, 2 bp Spread, 3 bp Slippage) |
| Build bei Start | `3ce22ac` (Branch `claude/inspiring-noether-rjh92d`) |
| Daten | derselbe Binance-Spot-Feed des Daten-Workers wie beim Champion, kein synthetischer Feed |

## Trennung von Champion und Challenger

Beide Strategien laufen im selben Trading-Worker auf denselben Kerzen,
Regime-Snapshots, Kosten und Limits, aber in getrennten virtuellen Portfolios:

- **Eigener Ledger.** Cash, Reservierungen, Gebühren, PnL, Equity und
  Drawdown jedes Portfolios stammen nur aus dessen eigenen Ledger-Einträgen.
- **Eigener Risk-Zustand.** Tagesverlust, Verlustserie (R-021), offene
  Positionen, Trades pro Tag und Exposure zählen je Portfolio. Ein Verlust des
  einen verkleinert nie die Position des anderen.
- **Eigene Session und Kill Switch.** Die Entry-Sperre des Schedulers bewertet
  jedes Portfolio einzeln (Commit `3ce22ac`). Ein pausierter Challenger oder
  ein gezogener Kill Switch blockiert den Champion nicht und umgekehrt.
- **Eigene Kennzahlen.** `StrategyPerformanceSnapshot` und das Dashboard
  rechnen je Portfolio und Strategie.

Gemeinsam bleibt die Infrastruktur: Daten-Worker, Scheduler-Prozess,
Circuit Breaker für Jobfehler und Datenfrische.

## Regeln während des Forward-Tests

Wie beim Champion: Die Strategie bleibt unverändert. Jede Regeländerung wäre
eine neue Version mit eigenem Startzeitpunkt. Bugfixes und Betrieb werden
unten getrennt protokolliert. Verglichen wird erst nach 30 geschlossenen
Trades je Strategie oder 6 Monaten (vorab festgelegt).

## Änderungsprotokoll (Bugfixes und Betrieb, keine Strategieänderungen)

| Datum (UTC) | Commit | Art | Beschreibung |
|---|---|---|---|
| 2026-10-14 16:00:25 | `7a74257` | Infrastruktur | Arena-Migration `20261014160000_add_arena` in die Dev-DB eingespielt (vorher Backup `backups/homebrew-dev-before-arena-20261014T160025Z.dump`). Rein additiv: nur neue Arena-Tabellen; keine bestehende Tabelle, kein Ledger, keine Session, keine Strategieversion geändert. |
| 2026-10-14 16:01 | `7a74257` | Betrieb | Als Teilnehmer der SignalPilot Arena registriert (`ARENA_V1:CRYPTO_REGIME_LONG_V1:v1`, Status `ACTIVE`). Forward-Start, Portfolio, Kapital, Ledger und Session unverändert; die Arena liest nur und empfiehlt ([17-arena.md](../17-arena.md)). |
| 2026-10-14 16:06:30.168–16:06:31.756 | `6dee3f4` | Betrieb | Trading-Worker neu gestartet, damit der stündliche Arena-Job `trading:arena-evaluate` (Minute 20) registriert wird. Unterbrechung 1,6 s, außerhalb jeder Job-Minute; der Kandidaten-Scan um 16:05 lief vorher regulär. Keine Änderung an Strategie, Risk Engine oder Ausführung. |
