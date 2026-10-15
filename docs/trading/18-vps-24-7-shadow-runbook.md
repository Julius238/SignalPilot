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
docker compose --project-name signalpilot --env-file .env.production -f docker-compose.prod.yml --profile migration build migrate
./scripts/ops/prod-migrate-docker.sh          # 29 Migrationen, rein additiv
./scripts/ops/prod-up.sh --no-deps api dashboard worker-scheduler trading-worker
./scripts/ops/healthcheck.sh
./scripts/ops/trading-shadow.sh preflight     # genau ein trading-worker, Flags, DB-Zustand
```

`prod-build.sh` baut das Migrations-Image nicht mit, weil es hinter dem
Profil `migration` liegt. Deshalb steht der zweite Befehl extra.

**Immer `--no-deps` mit expliziten Diensten.** Postgres und Redis lesen
ebenfalls `.env.production`. Ein `up` ohne `--no-deps` erstellt sie nach
jeder Env-Änderung neu; das ist ein unnötiger Datenbank-Neustart.
Läuft Postgres noch nicht, startet `./scripts/ops/prod-up.sh postgres redis`
es vorher.

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

Die Backup-Zeile wird nach Freigabe durch `backup.sh nightly` und
`backup.sh check` ersetzt ([Abschnitt 13](#13-backups-rotation-prüfung-externe-kopie)).

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

## 11a. Dashboard über HTTPS (Traefik)

Das Dashboard läuft hinter dem Traefik des n8n-Stacks (Resolver
`mytlschallenge`, Netz `n8n_default`). Der n8n-Stack bleibt unverändert. Auf
diesem VPS (seit 2026-10-15) gilt:

- Host `signalpilot.srv1665708.hstgr.cloud`, über die Hostinger-Wildcard-DNS;
- Port 3000 nur noch auf Loopback;
- die API wie bisher nur über Loopback.

```bash
H=signalpilot.srv1665708.hstgr.cloud
sed "s/signalpilot\.example\.org/$H/" docker-compose.prod.override.example.yml > docker-compose.prod.override.yml
# in .env.production: DASHBOARD_ORIGIN=https://$H und AUTH_COOKIE_SECURE=true
./scripts/ops/prod-up.sh --no-deps api dashboard
```

Die Ops-Skripte nehmen das Overlay automatisch mit. Es ist per
`.gitignore` ausgeschlossen. Erst nach HTTPS einloggen, nie über
`http://<IP>:3000`.

## 12. Restart- und Downtime-Test

Am besten über eine volle Stunde hinweg, damit ein Pipeline-Lauf und ein
Scan-Tick ausfallen:

```bash
./scripts/ops/trading-shadow.sh consistency-snapshot /root/sp-before.json
docker compose --project-name signalpilot --env-file .env.production -f docker-compose.prod.yml stop worker-scheduler trading-worker
# 10 bis 15 Minuten warten, über eine volle Stunde
./scripts/ops/prod-up.sh --no-deps worker-scheduler trading-worker
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

## 13. Backups: Rotation, Prüfung, externe Kopie

**Vorbereitet, nicht angewendet.** Das ist Schritt 1 vor dem Go-live der
Evolution Engine ([20](20-evolution-engine.md#vps-betrieb-vorbereitet-nicht-deployt)).
Jeder Schritt unten braucht vorher deine Zustimmung. Jeder angewendete Schritt
kommt ins Änderungsprotokoll des
[offiziellen Forward-Tests](research/official-forward-test-v1.md).

Kein Schritt startet, stoppt oder erstellt einen laufenden SignalPilot-Dienst
neu. Es entstehen nur kurzlebige Container: zur Prüfung, für den Restore-Test
und den One-off-`opsWatch` für Alerts. Die Produktionsdatenbank wird nur von
`pg_dump` gelesen.

**Stand am 2026-10-15 (read-only geprüft).** Der 03:00-Cron schreibt nach
`/opt/signalpilot/backups`. Es gibt keine Rotation und keine externe Kopie.

- Plattenplatz: 76 GB frei, das Verzeichnis belegt 2,4 GB.
- Altbestand: die `pre-*.sql` vom Juli (2,2 GB), `signalpilot_20260805_165038.dump`
  und die Vollsicherung vor dem Deployment `signalpilot_20261015_064857.dump`.
- Werkzeuge: `gpg`, `rsync` und `sha256sum` sind installiert. `age` und
  `rclone` fehlen; beide gibt es in Ubuntu 24.04 per `apt`.

### Was die Skripte tun

| Befehl | Wirkung |
|---|---|
| `backup-postgres.sh` | Dump wie bisher. Danach prüft ein Wegwerf-Container das Archiv: Inhaltsverzeichnis mit `_prisma_migrations` und mindestens 10 Tabellen, dazu einmal alle Daten vollständig lesen. Der Container hat kein Netz, ein Nur-Lese-Dateisystem, die Datei nur lesend und 0,5 CPU. Erst dann entsteht `<name>.dump` mit `<name>.dump.sha256`. Schlägt die Prüfung fehl, bleibt der Dump als `<name>.dump.unverified` liegen und das Skript endet mit Exit 1. |
| `backup.sh nightly` | Für den 03:00-Cron. Ablauf: Dump und Prüfung, dann der Größenwächter, dann die Rotation, dann die externe Kopie. Jeder Fehler ergibt **einen** Alert über n8n. |
| `backup.sh nightly --dry-run` | Zeigt Konfiguration, Rotationsplan, ausstehende Uploads und die Frische. Kein Dump, nichts gelöscht, nichts hochgeladen, kein Alert. |
| `backup.sh rotate [--apply]` | Zeigt den Rotationsplan. Gelöscht wird nur mit `--apply`. |
| `backup.sh verify [<datei>…]` | Prüft Prüfsumme und Archiv. Ohne Argument alle verwalteten Backups. |
| `backup.sh offsite [--dry-run]` | Verschlüsselt ausstehende Backups und lädt sie hoch. |
| `backup.sh restore-test <datei>` | Spielt ein Backup in eine Wegwerf-Datenbank ein, **nie** in die Produktion. |
| `backup.sh check` | Totmannschalter: Alert, wenn das neueste Backup oder die neueste externe Kopie zu alt ist. |
| `backup.sh alert-test` | Sendet genau einen harmlosen `BACKUP_ALERT_TEST`. |

### Aufbewahrung

Verwaltet ist nur, was `signalpilot_YYYYMMDD_HHMMSS.dump` heißt **und** eine
`.sha256` hat. Behalten wird jeweils das neueste Backup der letzten 7 Tage,
der letzten 4 Wochen (ab Montag) und der letzten 3 Monate, **die ein Backup
haben**. Das entspricht `--keep-daily/-weekly/-monthly` von restic.

- Zeit allein löscht nichts. Fallen Backups aus, bleibt der alte Bestand
  stehen; nur neue Backups verdrängen alte.
- Bei rund 170 MB je Dump bleiben etwa 12 Dateien, also rund 2 GB.

Diese Dateien fasst die Rotation nie an:

- alles ohne `.sha256`. Dazu gehört der ganze Altbestand oben. Die
  Vollsicherung vor dem Deployment bleibt also automatisch erhalten.
- `*.unverified`.
- jedes Backup mit einer Datei `<name>.dump.keep` (`touch` genügt).

Ist der neue Dump mehr als 50 % kleiner als der vorige
(`BACKUP_MAX_SHRINK_PERCENT`), läuft keine Rotation. Stattdessen kommt
`BACKUP_SIZE_DROP`. Eine geleerte Datenbank verdrängt so keine guten Backups.

### Konfiguration `/etc/signalpilot/backup.env`

Root, `chmod 600`, Verzeichnis `700`. Die Skripte verweigern sonst den Start.
Die Datei enthält **kein Secret**, nur Pfade zu den root-eigenen Dateien, die
eines enthalten.

Sie wird als `KEY=VALUE` gelesen, nicht per `source`. Dabei gilt:

- Ein `$` bleibt wörtlich; es gibt keine Compose-Interpolation.
- Kommentare stehen auf eigenen Zeilen.
- Ein unbekannter Schlüssel ist ein Fehler.

Ohne Datei gilt: Rotation nur als Probelauf, keine externe Kopie.

| Schlüssel | Standard | |
|---|---|---|
| `BACKUP_ROTATION` | `dry-run` | `apply` erst nach geprüftem Plan |
| `BACKUP_KEEP_DAILY` / `_WEEKLY` / `_MONTHLY` | `7` / `4` / `3` | |
| `BACKUP_MAX_AGE_HOURS` | `26` | für `check` |
| `BACKUP_MAX_SHRINK_PERCENT` | `50` | `100` schaltet den Wächter ab |
| `OFFSITE_METHOD` | `none` | `rsync` (SSH) oder `rclone` (S3, B2 …) |
| `OFFSITE_ENCRYPTION` | `age` | oder `gpg`; unverschlüsselt gibt es nicht |
| `OFFSITE_AGE_RECIPIENT` | — | öffentlicher Schlüssel `age1…` |
| `OFFSITE_GPG_RECIPIENT`, `OFFSITE_GPG_HOMEDIR` | —, `/etc/signalpilot/gnupg` | Fingerprint (40 Hex); das Keyring darf keinen privaten Schlüssel enthalten |
| `OFFSITE_RSYNC_TARGET`, `OFFSITE_SSH_PORT` | —, `22` | `user@host:pfad` |
| `OFFSITE_SSH_KEY`, `OFFSITE_SSH_KNOWN_HOSTS` | `/etc/signalpilot/offsite_ed25519`, `/etc/signalpilot/offsite_known_hosts` | Host-Key fest hinterlegt |
| `OFFSITE_RCLONE_REMOTE`, `OFFSITE_RCLONE_CONFIG` | —, `/etc/signalpilot/rclone.conf` | `remote:bucket/pfad` |
| `OFFSITE_MAX_AGE_HOURS`, `OFFSITE_MAX_PER_RUN` | `30`, `3` | |

### Alerts

Alle Alerts nehmen den bestehenden Weg:

1. Ein One-off-Container `opsWatch`, derselbe Aufruf wie beim 10-Minuten-`watch`.
2. Von dort an `N8N_WEBHOOK_SIGNAL_URL`. Die Telegram-API wird nie direkt
   angesprochen.

Die Drossel liegt in `/var/lib/signalpilot/backup-alert.json`, getrennt von
der des Watch. Dasselbe Problem kommt höchstens alle 6 Stunden. Wird ein Alert
nicht zugestellt, steht das im Backup-Log.

| Code | Bedeutung |
|---|---|
| `BACKUP_FAILED` | Dump oder Archivprüfung fehlgeschlagen; kein neues verwaltetes Backup |
| `BACKUP_SIZE_DROP` | Dump deutlich kleiner als der vorige; Rotation ausgesetzt |
| `BACKUP_ROTATION_FAILED` | Rotation abgebrochen |
| `BACKUP_OFFSITE_FAILED` | Verschlüsselung, Upload oder Größenabgleich fehlgeschlagen; lokale Backups intakt |
| `BACKUP_CONFIG_INVALID` | Config abgelehnt; nur der Dump lief, mit sicheren Standards |
| `BACKUP_STALE` / `BACKUP_OFFSITE_STALE` | aus `check`: neuestes Backup oder neueste externe Kopie zu alt |

### Externe Kopie

- **Verschlüsselung mit einem öffentlichen Schlüssel.** Der VPS kann nur
  verschlüsseln, nie entschlüsseln. Der private Schlüssel liegt nur offline:
  auf dem Mac und in einer zweiten Kopie, z. B. Passwortmanager oder USB.
  Ohne ihn sind die externen Kopien wertlos.
- **Ablauf je Backup:**
  1. Prüfsumme prüfen.
  2. Verschlüsseln. Das Ergebnis muss sich vom Klartext unterscheiden; bei
     age muss es den age-Header tragen.
  3. `<name>.dump.age` (oder `.gpg`) hochladen, danach `<name>.dump.sha256`
     (Klartext-Prüfsumme).
  4. Die Größe am Ziel zurücklesen.
  5. Erst dann entsteht lokal `<name>.dump.offsite`.
- **Aufbewahrung am Ziel** regelt das Ziel selbst, nicht der VPS:
  Lifecycle-Regel bei S3/B2, Snapshots bei der Storage Box. Gib dem VPS
  möglichst einen Zugang **ohne Löschrecht**. Dann kann auch ein
  kompromittierter VPS die externen Kopien nicht löschen.
- **Volumen:** rund 170 MB je Nacht, im Jahr rund 60 GB ohne Lifecycle.

### Freigabeschritte

Alle Befehle auf dem VPS als root in `/opt/signalpilot`, außer wo „Mac“
steht. Ein Schritt nach dem anderen, jeweils nach Zustimmung.

**A. Code holen.** Das ändert nur Dateien und startet keinen Neustart. Der
Pull bringt auch die Evolution-Dateien mit; es wird kein Image gebaut.

```bash
git fetch origin
git status --short --branch        # muss sauber sein
git log --oneline HEAD..origin/claude/inspiring-noether-rjh92d
git pull --ff-only
bash scripts/ops/test-backup.sh    # Stub-Tests, startet keinen Container
```

Ab jetzt prüft schon der bestehende 03:00-Cron (`backup-postgres.sh`) jedes
Archiv und schreibt die `.sha256`. Er löscht nichts.

**B. Konfiguration anlegen.** Die Rotation ist zunächst nur ein Probelauf.

```bash
install -d -m 700 -o root -g root /etc/signalpilot
install -m 600 -o root -g root /dev/null /etc/signalpilot/backup.env
cat > /etc/signalpilot/backup.env <<'EOF'
# SignalPilot Backups (Runbook 18, Abschnitt 13). Keine Secrets in dieser Datei.
BACKUP_ROTATION=dry-run
BACKUP_KEEP_DAILY=7
BACKUP_KEEP_WEEKLY=4
BACKUP_KEEP_MONTHLY=3
OFFSITE_METHOD=none
EOF
ls -l /etc/signalpilot/backup.env  # -rw------- 1 root root
./scripts/ops/backup.sh nightly --dry-run
```

**C. Erste geprüfte Sicherung und Restore-Test.** Am besten nicht zur vollen
Stunde, wenn die Datenpipeline läuft.

```bash
./scripts/ops/backup-postgres.sh
./scripts/ops/backup.sh verify
ls -t backups/signalpilot_*.dump | head -n 1
./scripts/ops/backup.sh restore-test backups/signalpilot_<TS>.dump
```

`restore-test` legt eine eigene Datenbank in einem Wegwerf-Container an:

- Name `signalpilot-restore-test-…`, Label `signalpilot.restore-test=1`;
- `--network none`, 0,5 CPU, 1 GB RAM, eigenes anonymes Volume;
- Restore mit `--exit-on-error`;
- Prüfabfragen: Tabellen, Prisma-Migrationen, Zeilen der Kerntabellen.

Danach wird der Container samt Volume entfernt. Vor dem Restore prüft das
Skript Label und Netzwerk des Ziels; Compose wird dabei nicht benutzt. Reicht
1 GB nicht, setze `SIGNALPILOT_RESTORE_TEST_MEMORY=2g`. `--keep` lässt den
Container zur Ansicht stehen.

**D. Alert-Pfad testen.** Genau ein harmloser Test:

```bash
./scripts/ops/backup.sh alert-test
```

**E. Rotation scharf schalten**, nachdem der Plan aus B gestimmt hat:

```bash
./scripts/ops/backup.sh rotate
sed -i 's/^BACKUP_ROTATION=.*/BACKUP_ROTATION=apply/' /etc/signalpilot/backup.env
```

**F. Cron umstellen.** Eine Zeile wird geändert, eine kommt dazu:

```bash
B=/root/crontab.before-backup-rotation-$(date -u +%Y%m%d%H%M)
crontab -l > "$B"
{ sed 's#scripts/ops/backup-postgres.sh >>#scripts/ops/backup.sh nightly >>#' "$B"
  echo '0 7 * * *    cd /opt/signalpilot && ./scripts/ops/backup.sh check >> /var/log/signalpilot-backup.log 2>&1'
} > /root/crontab.new
diff "$B" /root/crontab.new
crontab /root/crontab.new && crontab -l
```

`diff` zeigt genau die geänderte 03:00-Zeile und die neue 07:00-Zeile. Zurück
geht es mit `crontab "$B"`.

**G. Externe Kopie: Ziel wählen und einrichten.**

Schlüssel auf dem Mac (age, empfohlen):

```bash
brew install age
mkdir -p ~/.config/signalpilot
age-keygen -o ~/.config/signalpilot/offsite-age.key
grep '^# public key:' ~/.config/signalpilot/offsite-age.key   # age1…, nur dieser Wert geht auf den VPS
```

Lege sofort eine zweite Offline-Kopie dieser Schlüsseldatei an.

Auf dem VPS:

```bash
apt-get install -y age             # alternativ OFFSITE_ENCRYPTION=gpg, ohne Installation
```

Variante **rsync über SSH**, z. B. eine Storage Box. Nimm ein eigenes
Unterkonto oder Verzeichnis, möglichst mit Snapshots:

```bash
ssh-keygen -t ed25519 -N '' -C signalpilot-offsite -f /etc/signalpilot/offsite_ed25519
cat /etc/signalpilot/offsite_ed25519.pub        # beim Ziel hinterlegen
ssh-keyscan -p <port> <host> > /etc/signalpilot/offsite_known_hosts
ssh-keygen -lf /etc/signalpilot/offsite_known_hosts   # Fingerprint mit dem Anbieter vergleichen
ssh -i /etc/signalpilot/offsite_ed25519 -p <port> -o UserKnownHostsFile=/etc/signalpilot/offsite_known_hosts <user>@<host> mkdir signalpilot
```

Variante **rclone**, z. B. S3 oder B2, mit einem Schlüssel ohne Löschrecht
und einer Lifecycle-Regel am Bucket:

```bash
apt-get install -y rclone
rclone config --config /etc/signalpilot/rclone.conf
chmod 600 /etc/signalpilot/rclone.conf
```

Dann die Config vervollständigen. Beispiel rsync, die Werte in spitzen
Klammern ersetzen:

```bash
cat > /etc/signalpilot/backup.env <<'EOF'
# SignalPilot Backups (Runbook 18, Abschnitt 13). Keine Secrets in dieser Datei.
BACKUP_ROTATION=apply
BACKUP_KEEP_DAILY=7
BACKUP_KEEP_WEEKLY=4
BACKUP_KEEP_MONTHLY=3
OFFSITE_METHOD=rsync
OFFSITE_ENCRYPTION=age
# öffentlicher Schlüssel vom Mac
OFFSITE_AGE_RECIPIENT=<age1…>
OFFSITE_RSYNC_TARGET=<user>@<host>:signalpilot
OFFSITE_SSH_PORT=<port>
EOF
```

Bei rclone stehen statt der beiden letzten Zeilen
`OFFSITE_METHOD=rclone` und `OFFSITE_RCLONE_REMOTE=<remote>:<bucket>/signalpilot`.

Danach testen:

```bash
./scripts/ops/backup.sh offsite --dry-run    # Werkzeuge, Rechte, was hochginge
./scripts/ops/backup.sh offsite              # bis zu 3 Backups verschlüsselt hochladen
./scripts/ops/backup.sh check
```

Ab jetzt lädt `nightly` jede Nacht hoch. `check` meldet um 07:00
`BACKUP_OFFSITE_STALE`, wenn die neueste externe Kopie älter als 30 h ist.

**H. Externe Kopie zurückspielen (Mac).** Der Mac braucht dafür einen eigenen
Lesezugang zum Ziel, nicht den Schlüssel des VPS:

```bash
mkdir -p ~/signalpilot-restore-drill && cd ~/signalpilot-restore-drill
rsync -e "ssh -p <port>" '<user>@<host>:signalpilot/signalpilot_<TS>.dump.*' .
age --decrypt --identity ~/.config/signalpilot/offsite-age.key \
  --output signalpilot_<TS>.dump signalpilot_<TS>.dump.age
shasum -a 256 -c signalpilot_<TS>.dump.sha256
cd ~/Dev/SignalPilot && ./scripts/ops/backup.sh restore-test ~/signalpilot-restore-drill/signalpilot_<TS>.dump
```

Danach den Klartext auf dem Mac löschen: `rm -r ~/signalpilot-restore-drill`.
Wiederhole die Probe monatlich, und nach jeder Änderung am Ziel oder am
Schlüssel.

**I. Protokollieren.** Eine Zeile im Änderungsprotokoll des offiziellen
Forward-Tests, z. B.:

> Backup-Rotation und externe Sicherung nach Runbook 18, Abschnitt 13. Cron
> 03:00 → `backup.sh nightly`, neu `backup.sh check` 07:00. Rotation 7/4/3.
> Externe Kopie `<Ziel>`, age-verschlüsselt. Restore-Test bestanden
> (`<Datei>`, `<n>` Tabellen). Kein Container neu erstellt.

### Ernstfall

`restore-postgres.sh` überschreibt die **Produktionsdatenbank**. Das ist nur
für den echten Notfall, nie zum Testen, und erst nach Not-Aus
(unten).

Spiele das gewählte Backup vorher mit `backup.sh restore-test` probeweise
ein. Ein Restore der Produktion setzt den Forward-Test auf einen älteren
Stand zurück und gehört ins Änderungsprotokoll.

## Not-Aus

Je Portfolio, die Arena führt selbst nie etwas aus:

```bash
./scripts/ops/trading-shadow.sh portfolio-op <P> engage-kill-switch <actor> <key> ENGAGE_KILL_SWITCH_<P> OPERATOR_STOP
./scripts/ops/trading-shadow.sh portfolio-op <P> pause-session <actor> <key> PAUSE_SESSION_<P>
```

Offene Positionen werden weiter überwacht und regulär geschlossen. Siehe auch
[16 Rollback und Not-Aus](16-shadow-rollback-and-emergency.md).
