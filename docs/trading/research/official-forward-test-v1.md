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
| 2026-10-15 07:52:34–08:03:26 | `387fb7b` | Betrieb (geplante Downtime) | Restart-/Downtime-Probe nach Runbook 18, Schritt 12: Daten- und Trading-Worker etwa 10 min gestoppt, dann mit `--no-deps` neu erstellt (neue Env-Werte, gleiche Images `16d6d0f`). <br>**Was ausfiel:** die Datenpipeline um 08:00 und die Scans um 07:55 und 08:00. <br>**Monitoring:** Der Cron-`watch` meldete um 08:00 `CONTAINER_DOWN` direkt an n8n. Nach dem Start kamen `WORKER_RESTARTED` und drei `SCHEDULED_JOB_STALE` (Risk/Order/Fill, 11 min alt). <br>**Nachholen:** Die Kerze 07:00–08:00 wurde um 08:15 nachgeladen und um 08:20 genau einmal je Strategie entschieden; davor und danach wurde nur übersprungen. <br>**`consistency-compare`:** alle 23 Prüfpunkte bestanden. Startzeitpunkte unverändert, keine Orders. |
| 2026-10-17 14:02–14:38 (nachgetragen am 2026-10-20) | — | Betrieb (ungeplante Downtime) | Neustart des VPS-Hosts mit Kernel-Wechsel (`6.8.0-111` → `6.8.0-147`, laut `last -x reboot`). Die Ursache ist nicht protokolliert. Alle Container, auch n8n und Traefik, liefen ab 14:38:45 wieder. Das erklärt den zweiten `tradingWorkerStartup`, der hier bisher fehlte (Befund B1). Laut lesender Prüfung vom 2026-10-20 fehlt keine Kerze, und jede der 121 Stundenkerzen seit dem Start wurde genau einmal je Strategie bewertet. |
| 2026-10-20 06:31–06:35 | — | Betrieb | Sicherung vor dem Hotfix: `backups/signalpilot_20261020_063145.dump` (174 MB, 613 Einträge, per `pg_restore --list` geprüft) und eine Kopie von `.env.production` unter `/root/signalpilot-env-backups/` (600, bytegleich geprüft). Die laufenden Images sind als `signalpilot-trading-worker:16d6d0f` (`f23565d69e1f`) und `signalpilot-api:16d6d0f` (`49dbe5615cc2`) getaggt. Zusätzlich liegen sie per `docker save` in `/root/signalpilot-rollback-images/signalpilot-16d6d0f-images.tar` (sha256 `479dbed9…`), weil der Host-Cron `docker image prune -af --filter until=24h` ungenutzte Images trotz Tag löscht. |
| 2026-10-20 07:21:32–07:21:54 | `02f4362` | Bugfix (Sicherheits-Hotfix, keine Strategieänderung) | Hotfix `hotfix/official-v1-security`: ADR 0021 (Limit-Set-Integrität, `risk-rules-v1/1.4.0`), ADR 0023 (Execution-Profile-Integrität), ADR 0024 Option K, ADR 0025 Option C und der R-022-Kandidatenschutz. CI-Run 39376648348 grün. <br>**Build:** aus einem exakten `git archive` von `02f4362` (sha256 `19abdbaa…`, Commit per `git get-tar-commit-id` geprüft) in `/opt/signalpilot-releases/signalpilot-02f4362`. Gebaut wurden nur `trading-worker` und `api`, im Compose-Projekt `signalpilot` mit `--env-file /opt/signalpilot/.env.production`. Ergebnis: `signalpilot-trading-worker` `d0bca831cd3f` und `signalpilot-api` `f961d96cd358`, zusätzlich als `:02f4362` getaggt. <br>**Umschalten:** D5 um 07:21:09 ergab 0 offene Positionen und 0 offene Orders. Einzige Env-Änderung war `TRADING_CODE_VERSION=02f4362`. Danach `consistency-snapshot` und `prod-up.sh --no-deps trading-worker api` aus dem Checkout `681a882`. Die Downtime betrug etwa 10 s (07:21:33–07:21:43), beide Container waren um 07:21:54 `healthy`. <br>**Prüfung:** `consistency-compare` 23/23 bestanden. Eligibility beider Portfolios `READY`, nur mit den Warnungen `KILL_SWITCH_STATE` und `STRATEGY_VERSION_BUILD`. Im Worker ist nur `risk-rules-v1/1.4.0` enthalten. Die erste Reconciliation um 07:24 war konsistent, alle Jobs liefen mit `SUCCESS`, es gab keine RiskEvents und keine Sperren, die Arena-Ketten sind intakt (120/120). Alle übrigen Container (Dashboard, Daten-Worker, Postgres, Redis, n8n, Traefik) sowie Netzwerke und Volumes sind unverändert, das Dashboard ist per HTTPS erreichbar. <br>**Unverändert:** Strategien und ihre Regeln, Risk-Limits, Kostenprofile, Arena-Policy, Kapital und Historie. <br>**Rollback** ohne Git-Wechsel: `:16d6d0f` auf `:latest` taggen, `TRADING_CODE_VERSION=16d6d0f`, dann `prod-up.sh --no-deps trading-worker api`. |
| 2026-10-20 08:05–08:20 | `02f4362` | Betrieb (Nachprüfung) | Erste volle Stundenkerze mit neuem Code: Die Kerze 07:00–08:00 wurde um 08:00:13 geladen und um 08:05:00 genau einmal je Strategie entschieden. Beide lehnten ab, mit `REGIME_NOT_RISK_ON` bzw. `TREND_FILTER_1H_FAILED`. Die Anker-Cursor rückten vor. Seit dem Umschalten liefen alle Jobs ohne Fehler (45 Risk-Läufe, 11 Reconciliations), es gab keine RiskEvents und keine Sperren. Die Arena bewertete um 08:20 beide Teilnehmer mit `HOLD`, ohne Hard Stop, die Ketten sind lückenlos (121/121). Der Alert `WORKER_STARTED` ging um 07:22:00 über n8n raus (`SENT`). Die Warnungen des Daten-Workers zu Kerzenqualität und Radar treten seit dem Start täglich in gleicher Zahl auf und haben mit dem Hotfix nichts zu tun. |
| 2026-10-20 09:19:57 | `82e5845` | Betrieb (Git) | Produktionslinie vereinheitlicht. `release/official-v1` entstand aus `681a882` mit dem Merge-Commit `46a63be` (deployter Hotfix `02f4362`, `--no-ff`) und `82e5845` (`cherry-pick -x b6345a9`, die Deployment-Doku). Anwendungscode, Lockfile, Dockerfiles und Compose sind bytegleich zu `02f4362`. Lokal liefen 1780/1780 Tests, CI-Run 39396347750 grün. `main` wurde per Fast-Forward von `488869a` auf `82e5845` gesetzt (kein Force, kein Rebase), CI-Run 39399894731 auf `main` grün. Ab jetzt ist `main` die Produktion und `claude/inspiring-noether-rjh92d` die Entwicklung. |
| 2026-10-20 09:20:42 | `82e5845` | Betrieb (Git, kein Deploy) | VPS-Checkout von `681a882` (Branch `claude/inspiring-noether-rjh92d`) auf `main` = `82e5845` umgestellt, nur per `git fetch origin main:main` und `git switch main`. Der Checkout war vorher sauber, ohne Stashes. Kein Build, kein Neustart, keine Env-Änderung: `.env.production` und Traefik-Override sind hashgleich, Container, Images, Startzeiten, Netze und Volumes unverändert, der Dry-Run meldet `Running`. `TRADING_CODE_VERSION` bleibt `02f4362` (laufende Images `d0bca831cd3f`/`f961d96cd358`). <br>**Prüfung 09:26:** Sessions `SHADOW_ACTIVE`, Portfolios unverändert bei 10 000 USDT und ledgerkonsistent, Reconciliation um 09:24 konsistent. Keine RiskEvents und keine Sperren, Arena `HOLD` (122/122), `healthcheck` 6/6, Dashboard per HTTPS und n8n erreichbar. Seit dem Deploy um 07:21 liefen 578 Jobs ohne Fehler. |

## Laufender Code und VPS-Checkout

Welcher Code läuft, bestimmen die Images und `TRADING_CODE_VERSION`. Der
Git-Checkout unter `/opt/signalpilot` sagt das nicht zuverlässig.

| Zeitraum (UTC) | Trading-Worker und API | Dashboard und Daten-Worker | Checkout `/opt/signalpilot` |
|---|---|---|---|
| 2026-10-15 07:25 bis 2026-10-20 07:21 | Images aus `16d6d0f` | Images aus `16d6d0f` | `16d6d0f`, ab 2026-10-15 07:38–08:26 per Fast-Forward `681a882` (nur Doku und Ops, kein Rebuild) |
| 2026-10-20 07:21 bis 09:20 | Images aus `02f4362` (Export, nicht im Checkout) | unverändert Images aus `16d6d0f` | unverändert `681a882` |
| ab 2026-10-20 09:20 | unverändert Images aus `02f4362` | unverändert Images aus `16d6d0f` | `main` = `82e5845`; Anwendungscode bytegleich zu `02f4362` |

Seit 2026-10-20 09:20 sind die Stände zusammengeführt. `main` (`82e5845`)
enthält `681a882` und per Merge-Commit `46a63be` den deployten Hotfix
`02f4362`. Darin sind `apps/`, `packages/`, Lockfile, Dockerfiles und Compose
bytegleich zu `02f4362`. Der Checkout zeigt `82e5845`, die Images und
`TRADING_CODE_VERSION` weisen weiter `02f4362` aus. Beides beschreibt
denselben Anwendungscode. Ein `prod-build.sh` von `main` baut wieder genau
diesen Code. Prüfen lässt sich der laufende Stand so:

```bash
docker inspect --format '{{.Image}}' signalpilot-trading-worker-1
docker exec signalpilot-trading-worker-1 printenv TRADING_CODE_VERSION
git -C /opt/signalpilot rev-parse --short HEAD   # nur der Checkout
```
