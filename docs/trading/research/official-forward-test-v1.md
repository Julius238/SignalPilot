# Offizieller Forward-Test V1 (VPS, 24/7) — Champion gegen Challenger

**Phase `OFFICIAL`.** Das ist der offizielle Forward-Test.

Der lokale Mac-Betrieb ab 2026-10-14 ist `LOCAL_SHAKEDOWN`, ein Systemtest.
Seine Ergebnisse werden nie mit diesem Test verglichen oder zusammengeführt:

- [Shakedown TREND_CORE](forward-test-trend-core-long-v1.md)
- [Shakedown REGIME_LONG](forward-test-regime-long-v1.md)

Kein Echtgeldhandel. Ablauf: [Runbook 18](../18-vps-24-7-shadow-runbook.md).

## Startzeitpunkte

> **Gestartet am 2026-10-15 auf dem VPS. Diese Werte sind unveränderlich.**
> Maßgeblich ist das Audit-Event `SESSION_ACTIVATED` der jeweiligen Session.
> Ein Neustart dieses Tests ist eine neue Version mit neuem Startzeitpunkt.

| Teilnehmer | Portfolio | Forward-Start (UTC) | `SESSION_ACTIVATED` (Audit-ID) |
|---|---|---|---|
| Champion `CRYPTO_TREND_CORE_LONG_V1` | `OFFICIAL_TREND_CORE_LONG_V1` | **2026-10-15T07:32:30.879Z** | `cmv98177d0001ppd0k07m1bo7` |
| Challenger `CRYPTO_REGIME_LONG_V1` | `OFFICIAL_REGIME_LONG_V1` | **2026-10-15T07:32:33.559Z** | `cmv9819900001ppfbcphusicz` |

| | Champion | Challenger |
|---|---|---|
| Portfolio-ID | `cmv97zfol0001pp41xde29vrd` | `cmv97zg8n0001pp4s1zzmypl0` |
| Session-ID | `cmv97zfpx0007pp41k297pq4h` | `cmv97zg9z0007pp4ssoiney9a` |
| StrategyVersion-ID | `cmv97zgso000ipp5jlvogpnn3` | `cmv97zgta000rpp5j73ty3x8w` |
| Arena-Teilnehmer | `cmv98236n0002pph49h2xgnyq` (`CHAMPION`) | `cmv9823740006pph473r9jojz` (`ACTIVE`) |

Arena-Kohorte: `ARENA_OFFICIAL_V1` (`cmv98235r0000pph4ohz0mbp9`), Phase
`OFFICIAL`, Policy `arena-policy-v1`. Policy-Hash
`6a4d0e663255b80245e4c56ebc124a674981d105e55699c3f350350f4901e9de`, derselbe
wie in der lokalen Kohorte `ARENA_V1`. Die Policy ist also unverändert. Der
Forward-Start beider Teilnehmer entspricht exakt dem `SESSION_ACTIVATED`.

Aktiviert von `julius` nach Runbook 18, Schritte 7–9. Beide
Eligibility-Reports meldeten vor dem Start `READY`. Die einzige Warnung war
`KILL_SWITCH_STATE`, der Hinweis, dass der Kill Switch gelöst ist.

## Eingefrorene Konfiguration

| | |
|---|---|
| Strategien | `CRYPTO_TREND_CORE_LONG_V1`: `crypto-mtf-breakout-v1/1.2.0`, Hash `8bb3bb93798b2adc8ee33b64181b99d49961385e0bb733f611689322eca6c7dd` |
| | `CRYPTO_REGIME_LONG_V1`: `crypto-regime-long-v1/1.0.0`, Hash `4708eaf89a39a2db9cebfd20564fce2f912dd731da74c5f658eb76c1ed64df6c` |
| Regime | `crypto-native-regime-v1/1.0.0` |
| Markt | Binance Spot BTCUSDT, 1h; ETH-Zuweisungen deaktiviert |
| Startkapital | je 10 000 USDT, eigenes Portfolio, eigenes Ledger, eigene Session, eigener Kill Switch |
| Risk | RiskLimitSet `SHADOW_V1` v1, `risk-rules-v1/1.3.0`, 0,25 % Risiko je Trade |
| Risk-Hash | `ff9ab29699eafaa3c2a558271d7123c33cca7732cfe29ad3f6a48443dd889864` |
| Kosten | `BINANCE_SPOT_VIP0_ESTIMATE_V1`: 10 bp Gebühr je Seite, 2 bp Spread, 3 bp Slippage je Seite |
| Kostenprofil BTCUSDT | v2 `cmv97zpa60002pp6hbjnkevrx`, Hash `0fba0118f710413a0b9811a15726f69ddb48131c26725775d1f0799de43eed13` |
| Daten | Binance über den Daten-Worker des VPS, kein synthetischer Feed |
| Build bei Start | `16d6d0f` (Branch `claude/inspiring-noether-rjh92d`), Images am 2026-10-15 auf dem VPS gebaut; `codeVersion` beider StrategyVersions `16d6d0f` |
| Host | VPS `191.101.2.236`, `/opt/signalpilot`, Compose-Projekt `signalpilot`, `TRADING_PORTFOLIO_SET=OFFICIAL_V1` |

## Regeln

1. **Strategien und Arena bleiben unverändert.** Jede Änderung an Regeln,
   Parametern, Regime, Kosten oder Arena-Policy ist eine neue Version mit
   neuem Startzeitpunkt.
2. **Bugfixes und Betrieb werden getrennt protokolliert**, mit Datum, Commit
   und Wirkung. Das gilt auch für jeden Worker-Neustart und jede Downtime.
3. **Ausfälle werden notiert, nicht aufgefüllt.** Verpasste Kerzen lädt der
   Daten-Worker nach. Einen verpassten Scan-Tick holt der 5-Minuten-Scan mit
   Anker-Cursor nach.
4. **Entscheidungen fallen nur auf Forward-Daten.** Historische Replays
   bleiben getrennt.

## Änderungsprotokoll (Bugfixes und Betrieb, keine Strategieänderungen)

| Datum (UTC) | Commit | Art | Beschreibung |
|---|---|---|---|
| 2026-10-15 06:48 | — | Betrieb | Vollsicherung vor dem Deployment: `/opt/signalpilot/backups/signalpilot_20261015_064857.dump` (164 MB, sha256 `7770b117…2f7cda1`). |
| 2026-10-15 07:25 | `16d6d0f` | Betrieb | Deployment: Images neu gebaut, vier additive Migrationen (29/29), API, Dashboard, Daten- und Trading-Worker neu erstellt. Vorher gab es keine Portfolios, also auch keinen Handel. |
| 2026-10-15 07:30 | — | Betrieb | Der Regime-Job verwendete zunächst noch den Snapshot des alten Codes von 06:30, ohne crypto-natives Regime, weil Snapshots bis 60 Minuten wiederverwendet werden. Aktiviert wurde erst nach dem ersten neuen Snapshot um 07:30:29 (`crypto-native-regime-v1/1.0.0`, MIXED/DEFENSIVE, Confidence 90). Keine Codeänderung. |
| 2026-10-15 07:36 | `ae9a0a5` | Betrieb | Lokaler Mac-Shakedown pausiert (Sessions `PAUSED`, Agent gestoppt und deaktiviert). Ab jetzt läuft genau ein Trading-Betrieb, der auf dem VPS. |
| 2026-10-15 07:37 | — | Betrieb | Cron eingerichtet: `watch` und `healthcheck` alle 10 min, Backup täglich 03:00. Genau ein `OPS_TEST` über n8n zugestellt (07:37:48, `SENT`). Das `WORKER_RESTARTED` vom Deployment (07:28) war bereits regulär zugestellt. |
| 2026-10-15 07:39 | `5c24876` | Betrieb | Dashboard über HTTPS (`signalpilot.srv1665708.hstgr.cloud`, Let's Encrypt). Port 3000 nur noch auf Loopback, `AUTH_COOKIE_SECURE=true`. Nur API und Dashboard neu erstellt, Trading- und Daten-Worker unberührt. |
