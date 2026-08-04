# P9 – Rollback und Not-Aus

Stand: 2026-08-04. Sicherheit geht vor Verfügbarkeit. Das gilt identisch für Long und synthetische Shorts. Tradinghistorie wird nicht gelöscht, Migrationen werden nicht automatisch rückwärts ausgeführt und ein Datenbank-Restore ist der letzte, destruktive Ausweg.

## 1. Entscheidungsreihenfolge

Bei Unsicherheit zuerst neue Exposure in der Datenbank blockieren; erst danach Scheduler/Container ändern. Ein Containerstopp allein ist kein Kill Switch und würde zugleich das Exit-Monitoring entfernen.

### Sofortiger Not-Aus

```bash
./scripts/ops/trading-shadow.sh engage-kill-switch \
  <operator> <incident-kill-unique> <reason-code> ENGAGE_SHADOW_KILL_SWITCH
./scripts/ops/trading-shadow.sh pause-session \
  <operator> <incident-pause-unique> PAUSE_SHADOW_SESSION
./scripts/ops/trading-shadow.sh status
```

Falls der Sessionstatus bereits `PAUSED` oder `ERROR_LOCKED` ist und `pause-session` deshalb guard-konform fehlschlägt, wird nicht entsperrt. Kill Switch und deaktiviertes Assignment werden trotzdem geprüft. Der zusammengefasste idempotente Weg für den normalen aktiven/pausierbaren Zustand ist:

```bash
./scripts/ops/trading-shadow.sh rollback-disabled \
  <operator> <incident-prefix> ROLLBACK_SHADOW_DISABLED
```

`rollback-disabled` deaktiviert über den sicheren versionierten Service alle aktuell aktivierten `SHADOW_V1`-Assignments, unabhängig von Asset und Direction. Erwartet sind Kill Switch `true`, Session `PAUSED` oder `ERROR_LOCKED` und sämtliche Assignments `false`. Portfolio `ACTIVE` darf bestehen bleiben; rückwärts mutierte Portfoliohistorie wäre gefährlicher als ein aktives, aber vollständig gegatetes Portfolio.

Wenn ein DB-Kommando wegen Infrastruktur nicht erreichbar ist, gilt: keine weiteren Entry-Jobs, globalen Scheduler sofort über Flags/Recreate stoppen und Postgres-Verfügbarkeit wiederherstellen. Ein unbekannter DB-Zustand ist immer ein Incident.

## 2. Scheduler deaktivieren und neue Exposure blockieren

Nach dem DB-Not-Aus werden in `.env.production` vieräugig diese exakten Deaktivierungswerte gesetzt:

| Variable                                  | Not-Aus/disabled                                    |
| ----------------------------------------- | --------------------------------------------------- |
| `ENABLE_LIVE_TRADING`                     | `false`                                             |
| `PAPER_TRADING_ONLY`                      | `true`                                              |
| `TRADING_MODE`                            | `SHADOW`                                            |
| `TRADING_SHADOW_ENABLED`                  | `true`                                              |
| `TRADING_STRATEGY_V1_ENABLED`             | `false`                                             |
| `TRADING_STRATEGY_LONG_V1_ENABLED`        | `false`                                             |
| `TRADING_STRATEGY_SHORT_V1_ENABLED`       | `false`                                             |
| `TRADING_SHADOW_SHORT_ENABLED`            | `false`                                             |
| `TRADING_RISK_V1_ENABLED`                 | `false`                                             |
| `TRADING_BOOTSTRAP_ENABLED`               | `false`                                             |
| `TRADING_SHADOW_EXECUTION_ENABLED`        | `false`                                             |
| `TRADING_SHADOW_POSITION_MONITOR_ENABLED` | `true`                                              |
| `TRADING_SHADOW_RECONCILIATION_ENABLED`   | `true`                                              |
| `TRADING_WORKER_ENABLED`                  | `true`                                              |
| `TRADING_SCHEDULER_ENABLED`               | `false`                                             |
| alle sieben `TRADING_*_JOB_ENABLED`       | `false`                                             |
| `TRADING_API_ENABLED`                     | `true` für Read-only-Incidentansicht, sonst `false` |
| `TRADING_API_OPERATIONS_ENABLED`          | `false`                                             |
| `NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED`   | `false`                                             |
| `TRADING_PERFORMANCE_JOB_ENABLED`         | `false`                                             |
| `TRADING_ALERT_OUTBOX_ENABLED`            | `true`                                              |
| `TRADING_ALERT_DELIVERY_ENABLED`          | `false`                                             |
| `TRADING_RETENTION_ENABLED`               | `false`                                             |

Dann nur Worker/API recreaten:

```bash
COMPOSE_PROJECT_NAME=signalpilot docker compose --project-name signalpilot \
  --env-file .env.production -f docker-compose.prod.yml \
  up -d --force-recreate trading-worker api
./scripts/ops/trading-shadow.sh scheduler-status
./scripts/ops/trading-shadow.sh status
```

Der Trading Worker bleibt gesund, aber ohne Scheduler. Entry ist unabhängig mehrfach blockiert: Long-/Short-Strategy, Short-Capability, Risk und Execution aus, alle Entry-Schedulerjobs aus, Session nicht aktiv, Kill Switch an, Assignments aus.

## 3. Offene Positionen weiter überwachen

Vor einem Containerstopp wird anhand `status` entschieden, ob Positionen oder ausstehende Exitorders existieren. Solange Exposure besteht:

```bash
./scripts/ops/trading-shadow.sh job monitor
./scripts/ops/trading-shadow.sh job fill
./scripts/ops/trading-shadow.sh job reconcile
./scripts/ops/trading-shadow.sh status
```

Im Not-Aus-Matrixzustand ist `fill` durch `TRADING_SHADOW_EXECUTION_ENABLED=false` absichtlich gegatet. Wenn eine bereits erzeugte risikoreduzierende Exitorder noch simuliert gefüllt werden muss, wird `TRADING_SHADOW_EXECUTION_ENABLED=true` nur als zeitlich begrenzte, vieräugige Ausnahme gesetzt; Session/Kill/Assignment und sämtliche Schedulerflags bleiben wie oben. Nach gezieltem Recreate werden ausschließlich `fill`, `monitor` und `reconcile` manuell ausgeführt, danach Execution wieder `false` und Worker erneut recreatet.

Ein manueller vollständiger Risk Close für eine vorhandene Shadow-Position:

```bash
./scripts/ops/trading-shadow.sh manual-risk-close \
  <position-id> <operator> <incident-risk-close-unique> "<reason>" MANUAL_RISK_CLOSE
./scripts/ops/trading-shadow.sh job monitor
./scripts/ops/trading-shadow.sh job reconcile
```

Der Request erhöht keine Exposure und bleibt auch bei Kill Switch/`ERROR_LOCKED` sowie deaktivierten Short-Flags zulässig. Bei Short ist der Close weiterhin rein intern `BUY-to-close`; es gibt keine Exchange-Position. Jede Abweichung oder ein fehlerhafter Monitor bedeutet: keine Container stoppen, Incident-Evidenz sichern und einen geprüften Forward-Fix vorbereiten.

## 4. Container kontrolliert stoppen

Trading Worker erst stoppen, wenn:

- keine offene/öffnende/teilgeschlossene Position existiert;
- keine ausstehende Entry- oder Exitorder existiert;
- Reconciliation konsistent und frisch ist;
- Kill Switch an, Session nicht aktiv und alle Assignments aus sind;
- Incident-Evidenz vollständig gesichert ist.

Dann:

```bash
COMPOSE_PROJECT_NAME=signalpilot docker compose --project-name signalpilot \
  --env-file .env.production -f docker-compose.prod.yml \
  stop trading-worker
```

API kann separat gestoppt werden, ohne Researchdaten zu unterbrechen:

```bash
COMPOSE_PROJECT_NAME=signalpilot docker compose --project-name signalpilot \
  --env-file .env.production -f docker-compose.prod.yml \
  stop api
```

Alle Container werden nur bei einem vollständigen Wartungs-/Disaster-Recovery-Fenster gestoppt:

```bash
./scripts/ops/prod-down.sh
```

Volumes bleiben dabei erhalten. `prod-reset-db-volume.sh` gehört ausdrücklich nicht in einen normalen Rollback.

## 5. Vorheriges Image oder Commit wiederherstellen

Compose definiert keine versionierten `image:`-Tags. Ein altes lokales Image kann deshalb vorhanden sein, ist aber kein belastbarer Rollbackanker. Der reproduzierbare Weg ist ein zuvor getesteter Commit.

1. Not-Aus und Reconciliation wie oben.
2. Aktuellen Incident-Commit, Container-/Image-IDs und Backup sichern.
3. Kompatibilität des vorherigen Codes mit dem **vorwärts migrierten** Schema in einer DB-Kopie prüfen.
4. Nur wenn kompatibel:

```bash
git status --short
git switch --detach <approved-previous-commit-sha>
git rev-parse HEAD
./scripts/ops/prod-build.sh
./scripts/ops/prod-up.sh
./scripts/ops/healthcheck.sh
./scripts/ops/prisma-smoke.sh
./scripts/ops/trading-shadow.sh scheduler-status
./scripts/ops/trading-shadow.sh status
```

Alle Tradingflags bleiben zunächst in Stufe A oder im Not-Aus-Matrixzustand. Kein Bootstrap, keine Sessionaktivierung und kein Scheduler werden durch den Code-Rollback freigegeben.

Kann alter Code das aktuelle additive/widened Schema nicht sicher lesen, wird nicht zurückgeschaltet. Stattdessen folgt ein vorwärts gerichteter Fix auf dem aktuellen Schema.

## 6. Migrationen nicht destruktiv zurückrollen

Für die gesamte Shadow-Domäne einschließlich der additiven Direction-/Collateral-Migrationen werden keine automatischen Down-Migrationen erstellt oder ausgeführt. Insbesondere werden Tradingtabellen, Append-only Audit-/Ledger-/Fill-/Event-Daten und Performance-/Outbox-Historie nicht gedroppt oder umgeschrieben.

Bei einem Migrationsproblem:

1. Trading deaktiviert und Containerzustand stabil halten.
2. `_prisma_migrations` und DB-Schema read-only untersuchen.
3. Backup und DB-Klon anlegen.
4. Korrektur als geprüfte neue Forward-Migration entwickeln.
5. Erst auf DB-Klon, dann in einem neuen Change-Fenster ausführen.

Ein Code-Rollback und ein Schema-Rollback sind getrennte Entscheidungen. „Altes Image“ autorisiert niemals ein `migrate reset`, Tabellen-Drop oder manuelles Löschen fachlicher Rows.

## 7. Datenbank-Restore nur als letzter Schritt

Ein Restore ist nur zulässig, wenn die aktuelle Datenbank nachweislich nicht reparierbar ist und die Folgen des Verlusts aller seit dem Backup entstandenen Daten explizit akzeptiert wurden. Vorher:

- alle Application-Container stoppen, Postgres verfügbar halten;
- ein zusätzliches forensisches Backup der beschädigten DB erstellen;
- ausgewähltes Backup auf Integrität und Zeitpunkt prüfen;
- Restore auf separatem DB-Klon vollständig testen;
- Vier-Augen-/Incident-Commander-Freigabe dokumentieren.

Erst dann:

```bash
./scripts/ops/restore-postgres.sh <geprüfter-backup-pfad>
```

Das Script fordert `yes` und ersetzt bestehende DB-Objekte per `pg_restore --clean --if-exists`. Danach werden Migrationen nur vorwärts deployed, Container mit Stufe A gestartet, Health/Prisma/Status/Eligibility geprüft und Trading bleibt deaktiviert:

```bash
./scripts/ops/prod-migrate-docker.sh
./scripts/ops/prod-up.sh
./scripts/ops/healthcheck.sh
./scripts/ops/prisma-smoke.sh
./scripts/ops/trading-shadow.sh status
./scripts/ops/trading-shadow.sh eligibility
```

Ein Restore darf niemals verwendet werden, um schlechte Shadow-Performance, abgelehnte Candidates oder normale Tradinghistorie „zurückzusetzen“.

## 8. Wiederfreigabe

Nach jedem Not-Aus beginnt die Freigabe wieder bei Stufe A und Dokument 14, nicht beim unterbrochenen Schritt. `ERROR_LOCKED` wird nur mit behobener Ursache, frischer Reconciliation, vollständiger Evidenz und dem expliziten Befehl `unlock-session ... UNLOCK_CAUSE_RESOLVED` verlassen. Danach ist die Session `STOPPED` und der Kill Switch bleibt aktiv; Release und Aktivierung bleiben zwei separate Gates.
