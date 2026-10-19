# 18 — 24/7-Shadow-Betrieb auf dem VPS: offizieller Forward-Test

Dieses Runbook bringt den Shadow-Betrieb auf den VPS und startet dort den
**offiziellen Forward-Test** von Champion `CRYPTO_TREND_CORE_LONG_V1` und
Challenger `CRYPTO_REGIME_LONG_V1`.

Es gelten feste Grenzen:

- **Kein Echtgeld.** Es gibt keinen Exchange-Adapter, und es werden keine
  Bitget-Keys eingerichtet.
- **Strategien eingefroren.** Strategieparameter und Spezifikations-Hashes
  ändern sich nicht.
- **Arena eingefroren.** Policy, Fitness, Evidence Gate, Survival Floor und
  Lifecycle bleiben unverändert.

## Abgrenzung

| | Lokaler Mac | VPS |
|---|---|---|
| Phase | `LOCAL_SHAKEDOWN` (Systemtest) | `OFFICIAL` |
| Portfolio-Set | `LOCAL_SHAKEDOWN`: `SHADOW_V1`, `SHADOW_CHALLENGER_V1` | `OFFICIAL_V1`: `OFFICIAL_TREND_CORE_LONG_V1`, `OFFICIAL_REGIME_LONG_V1` |
| Arena-Kohorte | `ARENA_V1` | `ARENA_OFFICIAL_V1` |
| Alerts | nur aufgezeichnet, nicht zugestellt | über n8n zugestellt |
| Datenbank | Homebrew-Postgres des Mac | Compose-Postgres des VPS |

Die offiziellen Portfolios sind neu und haben nie etwas anderes gehalten. Sie
starten deshalb bei genau 10 000 USDT, egal was ein älteres Deployment
(z. B. P9 im August, `SHADOW_V1`) auf dem VPS hinterlassen hat. Die
Strategieversionen werden aus denselben Code-Definitionen angelegt und tragen
dieselben Hashes wie lokal:

| Strategie | Engine | Spezifikations-Hash |
|---|---|---|
| `CRYPTO_TREND_CORE_LONG_V1` | `crypto-mtf-breakout-v1/1.2.0` | `8bb3bb93798b2adc8ee33b64181b99d49961385e0bb733f611689322eca6c7dd` |
| `CRYPTO_REGIME_LONG_V1` | `crypto-regime-long-v1/1.0.0` | `4708eaf89a39a2db9cebfd20564fce2f912dd731da74c5f658eb76c1ed64df6c` |

**Genau ein Trading-Worker je Datenbank.** Der Compose-Service
`trading-worker` existiert genau einmal. Er wird nie skaliert und nie ein
zweites Mal in einem anderen Compose-Projekt gestartet; `preflight` prüft das.
Der Mac nutzt eine andere Datenbank und berührt den VPS-Zustand nie.

## Kostenprofil (eingefroren)

`BINANCE_SPOT_VIP0_ESTIMATE_V1`, gesetzt durch `calibrate-execution-profile`
als neue unveränderliche Profilversion:

| Posten | Wert |
|---|---|
| Gebühr | 10 bp je Seite |
| Spread | 2 bp (voll) |
| Slippage | 3 bp je Seite |
| Max. Participation | 1 % |

Der Spezifikations-Hash der BTCUSDT-Profilversion steht nach der Aktivierung
im Forward-Test-Protokoll. Ein anderes Profil wäre eine neue Version und ein
neuer Startzeitpunkt.

## Was du freigeben oder konfigurieren musst

1. **Zugang.** Entweder führst du die Befehle selbst auf dem VPS aus, oder du
   hinterlegst den öffentlichen Schlüssel des Entwicklungs-Mac
   (`~/.ssh/id_ed25519.pub`) für einen Deploy-Benutzer. Claude prüft dann
   zuerst read-only.
2. **`.env.production`**: die Werte unten. Secrets bleiben auf dem Server und
   gehen nie in Logs.
3. **Dashboard-Zugang:** Login-Daten (`ADMIN_*`), und ob das Dashboard nur
   über die IP oder später über HTTPS hinter Traefik laufen soll.
4. **Cron-Einträge** für Watch, Healthcheck und Backup (unten).

## 0. Ist-Zustand prüfen (read-only)

```bash
cd /opt/signalpilot
git status --short --branch
./scripts/ops/healthcheck.sh || true
./scripts/ops/trading-shadow.sh preflight      # nach dem Code-Update aus Schritt 2
```

Dokumentiere:

- welcher Branch und welcher Commit laufen;
- ob `SHADOW_V1` aktive Sessions oder aktivierte Zuweisungen hat;
- welche Migrationen angewendet sind.

## 1. Sicherung

```bash
./scripts/ops/backup-postgres.sh
```

## 2. Code

```bash
git fetch origin
git checkout claude/inspiring-noether-rjh92d
git pull --ff-only
git log -1 --oneline
```

## 3. `.env.production` ergänzen

Alle Werte sind nicht geheim. Bestehende Secrets (`DATABASE_URL`,
`N8N_WEBHOOK_SIGNAL_URL`, `ADMIN_*`, `AUTH_*`, `FINNHUB_API_KEY`) bleiben
unverändert.

```env
ENABLE_LIVE_TRADING=false
PAPER_TRADING_ONLY=true
TRADING_MODE=SHADOW
TRADING_SHADOW_ENABLED=true
TRADING_STRATEGY_V1_ENABLED=true
TRADING_STRATEGY_LONG_V1_ENABLED=true
TRADING_STRATEGY_SHORT_V1_ENABLED=false
TRADING_SHADOW_SHORT_ENABLED=false
TRADING_RISK_V1_ENABLED=true
TRADING_SHADOW_EXECUTION_ENABLED=true
TRADING_SHADOW_POSITION_MONITOR_ENABLED=true
TRADING_SHADOW_RECONCILIATION_ENABLED=true
TRADING_BOOTSTRAP_ENABLED=false
TRADING_RETENTION_ENABLED=false

TRADING_WORKER_ENABLED=true
TRADING_SCHEDULER_ENABLED=true
TRADING_DAY_START_JOB_ENABLED=true
TRADING_CANDIDATE_JOB_ENABLED=true
TRADING_RISK_JOB_ENABLED=true
TRADING_ORDER_JOB_ENABLED=true
TRADING_FILL_JOB_ENABLED=true
TRADING_POSITION_MONITOR_JOB_ENABLED=true
TRADING_RECONCILIATION_JOB_ENABLED=true
TRADING_PERFORMANCE_JOB_ENABLED=true
TRADING_PERFORMANCE_SCHEDULE_ENABLED=true
TRADING_ALERT_OUTBOX_ENABLED=true
TRADING_ALERT_DELIVERY_ENABLED=true
TRADING_ALERT_SCHEDULE_ENABLED=true
TRADING_ARENA_ENABLED=true
TRADING_ARENA_SCHEDULE_ENABLED=true
TRADING_PORTFOLIO_SET=OFFICIAL_V1
TRADING_WORKER_HEARTBEAT_FILE=/tmp/trading-worker-heartbeat

TRADING_API_ENABLED=true
TRADING_API_OPERATIONS_ENABLED=false
NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED=true
```

Den Code-Stand bei jedem Deploy setzen:

```bash
sed -i "s/^TRADING_CODE_VERSION=.*/TRADING_CODE_VERSION=$(git rev-parse --short HEAD)/" .env.production
```

Danach die Konfiguration validieren:

```bash
./scripts/ops/validate-prod-config.sh
```

## 4. Build, Migration, Start

```bash
./scripts/ops/prod-build.sh                   # alle Images, Dashboard mit Trading-UI
./scripts/ops/prod-up.sh postgres redis
./scripts/ops/prod-migrate-docker.sh          # 29 Migrationen, rein additiv
./scripts/ops/prod-up.sh
./scripts/ops/healthcheck.sh
./scripts/ops/trading-shadow.sh preflight     # genau ein trading-worker, Flags, DB-Zustand
```

## 5. Altbestand neutralisieren

Dieser Schritt ist nur nötig, wenn `preflight` eine aktive `SHADOW_V1`-Session
oder eine aktivierte Zuweisung ausweist (P9-Altlast). Andernfalls würde neben
dem offiziellen Test eine dritte Strategie handeln.

```bash
./scripts/ops/trading-shadow.sh rollback-disabled <actor> vps-legacy-$(date -u +%Y%m%d) ROLLBACK_SHADOW_DISABLED
```

## 6. Marktdaten

BTC und ETH brauchen mindestens 500 Stundenkerzen und 250 Tageskerzen. Das
Regime braucht SMA200, die Strategien brauchen ATR und SMA.

```bash
CRYPTO_BACKFILL_LOOKBACK_DAYS=420 ./scripts/ops/prod-run-worker-docker.sh worker:backfill-candles
./scripts/ops/prod-run-worker-docker.sh worker:calculate-market-regime
./scripts/ops/trading-shadow.sh monitor
```

`monitor` muss frische `BINANCE`-Kerzen zeigen. Prüfe auch, dass der VPS
Binance erreicht.

## 7. Offizielle Portfolios, Strategien, Kosten

```bash
./scripts/ops/trading-shadow.sh official-bootstrap OFFICIAL_BOOTSTRAP
./scripts/ops/trading-shadow.sh calibrate-execution-profile CALIBRATE_EXECUTION_PROFILE
./scripts/ops/trading-shadow.sh preflight
```

`preflight` muss zeigen:

- beide `OFFICIAL_*`-Portfolios als `DRAFT` mit 10 000 USDT;
- die Spezifikations-Hashes aus der Tabelle oben;
- das Kostenprofil 10/2/3 als `ACTIVE`.

`calibrate-execution-profile` schreibt nur das im Code freigegebene Profil
([ADR 0023](decisions/0023-execution-profile-value-integrity.md)). `UNCHANGED`
heißt: Das aktive Profil ist bereits das freigegebene. `REFUSED` heißt: Das
aktive Profil weicht ab oder ist mehrfach aktiv. Dann nicht aktivieren,
sondern den Befund klären.

## 8. Aktivierung je Teilnehmer

Für jedes Portfolio gilt dieselbe Reihenfolge. Der Startzeitpunkt ist
`SESSION_ACTIVATED`.

```bash
A=<actor>; D=$(date -u +%Y%m%d)
for P in OFFICIAL_TREND_CORE_LONG_V1 OFFICIAL_REGIME_LONG_V1; do
  ./scripts/ops/trading-shadow.sh portfolio-op $P activate-portfolio $A $P-activate-$D ACTIVATE_PORTFOLIO_$P
done
./scripts/ops/trading-shadow.sh enable-strategy OFFICIAL_TREND_CORE_LONG_V1 CRYPTO_TREND_CORE_LONG_V1 BTCUSDT $A trend-core-btc-$D ENABLE_CRYPTO_TREND_CORE_LONG_V1_BTCUSDT_IN_OFFICIAL_TREND_CORE_LONG_V1
./scripts/ops/trading-shadow.sh enable-strategy OFFICIAL_REGIME_LONG_V1 CRYPTO_REGIME_LONG_V1 BTCUSDT $A regime-long-btc-$D ENABLE_CRYPTO_REGIME_LONG_V1_BTCUSDT_IN_OFFICIAL_REGIME_LONG_V1
./scripts/ops/trading-shadow.sh job day-start
./scripts/ops/trading-shadow.sh job reconcile
for P in OFFICIAL_TREND_CORE_LONG_V1 OFFICIAL_REGIME_LONG_V1; do
  ./scripts/ops/trading-shadow.sh portfolio-op $P release-kill-switch $A $P-release-$D RELEASE_KILL_SWITCH_$P
  ./scripts/ops/trading-shadow.sh portfolio-op $P activate-session $A $P-session-$D ACTIVATE_SESSION_$P
  ./scripts/ops/trading-shadow.sh eligibility-for $P
done
```

Beide Eligibility-Reports müssen `READY` melden. ETH bleibt deaktiviert.

## 9. Arena

```bash
./scripts/ops/trading-shadow.sh arena bootstrap-official-v1 --actor=<actor>
./scripts/ops/trading-shadow.sh arena evaluate
```

Damit entsteht die Kohorte `ARENA_OFFICIAL_V1` (Phase `OFFICIAL`):

- Champion `CRYPTO_TREND_CORE_LONG_V1` per Designation;
- Challenger `CRYPTO_REGIME_LONG_V1` als `ACTIVE`;
- Forward-Start ist jeweils die Session-Aktivierung.

Sichtbar im Dashboard unter `Trading → Arena`.

## 10. Startzeitpunkte festhalten

```bash
./scripts/ops/trading-shadow.sh status    # oder die Abfrage:
docker compose --project-name signalpilot --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT p.key, s.\"startedAt\", e.id FROM \"TradingSession\" s JOIN \"Portfolio\" p ON p.id = s.\"portfolioId\" JOIN \"TradingAuditEvent\" e ON e.\"aggregateId\" = s.id AND e.\"eventType\" = '\''SESSION_ACTIVATED'\'' WHERE p.key LIKE '\''OFFICIAL_%'\'' ORDER BY s.\"startedAt\";"'
```

Die Zeitpunkte und Audit-IDs kommen in
`docs/trading/research/official-forward-test-v1.md`.

## 11. Monitoring und Alerts

| Signal | Quelle |
|---|---|
| Binance-Kerzen frisch und echt | `MARKET_DATA_STALE` (Outbox), `monitor`, Dashboard „Betrieb (24/7)“ |
| Daten-Worker läuft | Job-Frische `fetchCryptoCandles` / `calculateMarketRegime` → `SCHEDULED_JOB_STALE` |
| Trading-Worker läuft | Docker-Healthcheck (Heartbeat-Datei), `watch` meldet einen toten Worker direkt an n8n |
| Candidate-Scan, Risk, Fill, Monitor, Reconcile, Performance, Arena | `SCHEDULED_JOB_STALE` je Job mit eigener Schwelle |
| Scheduler-Verzögerung | dieselben Schwellen; Circuit Breaker → `CIRCUIT_BREAKER_OPEN` |
| Worker-Neustarts | `WORKER_RESTARTED` (je Start ein Alert) |
| Datenbank erreichbar | `watch` → `DATABASE_UNREACHABLE` direkt an n8n |
| Kill Switch, Session-Sperre | `KILL_SWITCH_ENGAGED`, `SESSION_ERROR_LOCKED` |
| Kritische Risk-Events | `CRITICAL_RISK_EVENT` u. a. |

Cron auf dem VPS (`crontab -e`):

```cron
*/10 * * * * cd /opt/signalpilot && ./scripts/ops/trading-shadow.sh watch >> /var/log/signalpilot-watch.log 2>&1
*/10 * * * * cd /opt/signalpilot && ./scripts/ops/healthcheck.sh >> /var/log/signalpilot-health.log 2>&1
0 3 * * *    cd /opt/signalpilot && ./scripts/ops/backup-postgres.sh >> /var/log/signalpilot-backup.log 2>&1
```

`watch` sendet nur, wenn der Worker es selbst nicht kann. Das ist der Fall bei:

- einem gestoppten oder ungesunden Container;
- einer unerreichbaren DB;
- einer veralteten Alert-Outbox.

Derselbe Zustand wird höchstens alle 6 Stunden erneut gesendet.

**Test des Alert-Pfads.** Genau ein harmloses `OPS_TEST`, sonst nichts, auch
wenn andere Alerts offen sind:

```bash
./scripts/ops/trading-shadow.sh alert-test
```

## 12. Restart- und Downtime-Test

Am besten über eine volle Stunde hinweg, damit ein Pipeline-Lauf und ein
Scan-Tick ausfallen:

```bash
./scripts/ops/trading-shadow.sh consistency-snapshot /root/sp-before.json
docker compose --project-name signalpilot --env-file .env.production -f docker-compose.prod.yml stop worker-scheduler trading-worker
# 10 bis 15 Minuten warten, über eine volle Stunde
./scripts/ops/prod-up.sh worker-scheduler trading-worker
# nach dem nächsten Daten-Lauf (CRYPTO_PIPELINE_CRON) und dem Scan (alle 5 min)
./scripts/ops/trading-shadow.sh consistency-compare /root/sp-before.json
```

`consistency-compare` muss in allen Punkten bestehen:

- Ledger nur fortgeschrieben, und Ledger = Cash-Cache;
- keine doppelt verarbeitete Kerze;
- Sessions und Kill Switches erhalten;
- dieselben Strategieversionen, Teilnehmer getrennt;
- Arena-Kette intakt;
- keine Kerzenlücke.

Der Kandidaten-Scan läuft alle 5 Minuten mit Anker-Cursor. Ein verpasster
Tick wird nachgeholt; jede Kerze wird genau einmal entschieden.

## Not-Aus

Je Portfolio, die Arena führt selbst nie etwas aus:

```bash
./scripts/ops/trading-shadow.sh portfolio-op <P> engage-kill-switch <actor> <key> ENGAGE_KILL_SWITCH_<P> OPERATOR_STOP
./scripts/ops/trading-shadow.sh portfolio-op <P> pause-session <actor> <key> PAUSE_SESSION_<P>
```

Offene Positionen werden weiter überwacht und regulär geschlossen. Siehe auch
[16 Rollback und Not-Aus](16-shadow-rollback-and-emergency.md).
