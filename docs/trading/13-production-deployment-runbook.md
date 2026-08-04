# P9 – Production Deployment und sicherer Bootstrap

Stand: 2026-08-03. Dieses Runbook bereitet einen Shadow-Test vor. Es autorisiert kein Deployment und keine Exchange-, Demo- oder Echtgeldorder. `ENABLE_LIVE_TRADING=false` und die Build-Capability `SHADOW_ONLY` sind unveränderliche Grenzen. Mit „keine Exchange-Verbindung“ ist hier insbesondere gemeint: kein authentifizierter Trading-Adapter, kein Bitget-Konto und keine Order-API. Der bestehende Research Worker bezieht weiterhin ausschließlich öffentliche Marktdaten von Binance; ohne diesen Feed kann die geforderte Datenfrische nicht gehalten werden.

## 1. Verbindlich geprüfter Bestand

`docker-compose.prod.yml` definiert genau `postgres`, `redis`, `api`, `dashboard`, `worker-scheduler`, `trading-worker` und den nur im Profil `migration` verfügbaren Dienst `migrate`. Postgres ist nicht nach außen exponiert. API bindet an `127.0.0.1:3100`, Dashboard an Port 3000. Der Trading Worker hat keinen Port und prüft nur `/tmp/trading-worker-heartbeat`.

Die vier Dockerfiles verhalten sich wie folgt:

| Image           | Build                                                                 | Runtime/Start                   | Migration beim Start           |
| --------------- | --------------------------------------------------------------------- | ------------------------------- | ------------------------------ |
| API             | Vollständige Dependency-Closure der API (inkl. `apps/trading-worker`) | `node dist/index.js`            | nein; eigenes `migrate`-Target |
| Dashboard       | Next.js standalone                                                    | `node apps/dashboard/server.js` | nein                           |
| Research Worker | Vollständige Dependency-Closure des Workers                           | `node dist/scheduler.js`        | nein                           |
| Trading Worker  | Vollständige Dependency-Closure des Trading Workers                   | `node dist/index.js`            | nein                           |

Alle Images werden als Node 22 Alpine gebaut. Nur das API-Dockerfile besitzt das separate Migration-Target. Kein normaler `CMD` führt `prisma migrate`, Seed oder Bootstrap aus.

Der Research Worker startet den öffentlichen Crypto-Research-Pipeline-Scheduler immer; `CRYPTO_PIPELINE_CRON` steuert den Takt. Die optionalen Equity-, Radar-, Event-, Gap- und Discovery-Jobs haben eigene Flags. `WORKER_RUN_ON_START=false` verhindert nur den Sofortlauf, nicht den regulären Cron. Dieser Worker enthält keine Orderausführung.

Der Trading Worker schreibt alle 30 Sekunden sein Datei-Heartbeat. Bei `TRADING_WORKER_ENABLED=false`, ungültiger Basiskonfiguration oder `TRADING_SCHEDULER_ENABLED=false` bleibt er gesund, aber fachlich idle. Der Scheduler registriert nur explizit aktivierte Jobs:

| Job               |      UTC-Cron | zusätzlicher Scheduler-Flag            |
| ----------------- | ------------: | -------------------------------------- |
| Start Trading Day |   `5 0 * * *` | `TRADING_DAY_START_JOB_ENABLED`        |
| Candidate         |   `5 * * * *` | `TRADING_CANDIDATE_JOB_ENABLED`        |
| Risk              |   `* * * * *` | `TRADING_RISK_JOB_ENABLED`             |
| Order             |   `* * * * *` | `TRADING_ORDER_JOB_ENABLED`            |
| Fill              | `*/2 * * * *` | `TRADING_FILL_JOB_ENABLED`             |
| Position Monitor  | `*/2 * * * *` | `TRADING_POSITION_MONITOR_JOB_ENABLED` |
| Reconcile         | `*/5 * * * *` | `TRADING_RECONCILIATION_JOB_ENABLED`   |

Performance, Alert-Outbox und Retention sind nicht im Scheduler registriert. Sie bleiben manuelle Jobs. Leases liegen in PostgreSQL, laufen nach zehn Minuten ab und erhalten im Lauf einen Heartbeat. Entry-Jobs prüfen zusätzlich Session, Kill Switch, Portfolio, fünf Minuten Reconciliation-Frische und den aktuellen UTC-Start-of-Day-Snapshot. Monitor und Reconcile bleiben von diesem Entry-Guard unabhängig.

Die Trading API registriert Lesepfade nur bei `TRADING_API_ENABLED=true`. Operations benötigen zusätzlich `TRADING_API_OPERATIONS_ENABLED=true` und die vollständige Shadow-Basis; Route und Dashboard delegieren ausschließlich an die auditierte Operations-Service-Schicht. Für den ersten Lauf bleiben API-Operations aus und Zustandswechsel erfolgen über die Container-CLI. Der Dashboard-Flag ist ein Build-Time-Flag und wird im Compose/Dockerfile mit sicherem Default `false` als Build-Argument durchgereicht; ein Flagwechsel verlangt einen neuen Dashboard-Build und aktiviert weder API noch Worker.

Die Alert-Outbox sammelt nur den geschlossenen Katalog sicherheitskritischer Ereignisse. `TRADING_ALERT_OUTBOX_ENABLED` erlaubt Aufzeichnung, `TRADING_ALERT_DELIVERY_ENABLED` zusätzlich Zustellung über die vorhandene `N8N_WEBHOOK_SIGNAL_URL`. Zustellfehler verändern keine Order, Position, Fills, Ledgerbuchung oder Session. Claims laufen ab, Backoff und Versuche sind begrenzt, `DEAD` ist terminal.

## 2. Additive Trading-Migrationen

Die Trading-Migrationen sind:

| Migration                                                | Inhalt                                                                              | Rollback-Eigenschaft                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `20260802090000_add_shadow_trading_domain`               | P1: additive Enums, 23 Tabellen, Indizes und FKs; keine Daten                       | keine Down-Migration                                       |
| `20260802120000_add_trade_candidate_plan_fields`         | P3: nullable, typisierte Planfelder und `maxQuantity`                               | additiv, keine erfundenen Defaults                         |
| `20260803090000_add_shadow_performance_and_alert_outbox` | P8: Performance-Segmente, Outbox und Attempts; Widening von `strategyVersionId`     | keine fachlichen Tradingdaten gelöscht                     |
| `20260804090000_add_short_direction`                     | additive `SHORT`-Enumwerte sowie richtungsfreie Entry-/Position-Scope-Constraints   | keine Daten gelöscht; bestehende Long-Werte bleiben gültig |
| `20260804100000_add_short_collateral`                    | typisiertes `ShadowPosition.reservedCollateral` und Performance-Segment `DIRECTION` | additiv; bestehende Positionen erhalten sicheren Wert 0    |

Die übrigen Strategy-, Risk-, Simulation-, API-, Dashboard- und Worker-Änderungen brauchen keine weitere Datenmigration. Vor P9 existieren außerdem alle älteren Research-Migrationen. Produktionsmigrationen werden ausschließlich mit `prisma migrate deploy` im gebauten `migrate`-Image ausgeführt. Es gibt keine automatische Migration beim Containerstart und keine fachliche Down-Migration.

## 3. Tatsächliche Operations-Befehle

Alle folgenden Scripts verwenden fest `COMPOSE_PROJECT_NAME=signalpilot`, `docker-compose.prod.yml` und `.env.production`, brechen bei Fehlern ab und geben keine Secrets aus.

| Zweck                        | Befehl                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backup                       | `./scripts/ops/backup-postgres.sh`                                                                                                                                                                      |
| Compose-Config sicher prüfen | `./scripts/ops/validate-prod-config.sh`                                                                                                                                                                 |
| Produktions-Build            | `./scripts/ops/prod-build.sh`                                                                                                                                                                           |
| Migration Deploy             | `./scripts/ops/prod-migrate-docker.sh`                                                                                                                                                                  |
| Containerstart               | `./scripts/ops/prod-up.sh`                                                                                                                                                                              |
| allgemeine Healthchecks      | `./scripts/ops/healthcheck.sh`                                                                                                                                                                          |
| Prisma-Smoke in Images       | `./scripts/ops/prisma-smoke.sh`                                                                                                                                                                         |
| Trading Bootstrap            | `./scripts/ops/trading-shadow.sh bootstrap`                                                                                                                                                             |
| Eligibility                  | `./scripts/ops/trading-shadow.sh eligibility`                                                                                                                                                           |
| Trading-Worker-Health        | `./scripts/ops/trading-shadow.sh worker-health`                                                                                                                                                         |
| Trading-API-Health           | `./scripts/ops/trading-shadow.sh api-health`                                                                                                                                                            |
| Schedulerstatus              | `./scripts/ops/trading-shadow.sh scheduler-status`                                                                                                                                                      |
| Bootstrap-/Sessionstatus     | `./scripts/ops/trading-shadow.sh status`                                                                                                                                                                |
| einmalige Jobs               | `./scripts/ops/trading-shadow.sh job <name>`                                                                                                                                                            |
| kontrollierte Zustände       | `enable-assignment`/`disable-assignment` mit ID, erwarteter Version, Operator, Idempotency-Key und exakter Bestätigung; daneben Legacy-BTC-Alias sowie Portfolio-/Session-/Kill-/Manual-Close-Kommandos |
| deaktivierender DB-Rollback  | `rollback-disabled`                                                                                                                                                                                     |

`prod-run-worker-docker.sh` führt weiterhin die vorhandenen Research-Jobs aus, jetzt aber allowlisted im laufenden `worker-scheduler` statt per Host-pnpm/temporärer Dependency-Installation. Seed und Migration laufen im gebauten `migrate`-Image. Restore und Volume-Reset bleiben destruktive, separat bestätigte Notfallwerkzeuge und gehören nicht in den normalen P9-Ablauf.

## 4. Exakte Produktions-Flag-Matrix

Werte außerhalb dieser Matrix bleiben unverändert. In jeder Stufe gelten zusätzlich `ENABLE_LIVE_TRADING=false`, `PAPER_TRADING_ONLY=true`, `WORKER_RUN_ON_START=false`, `RUN_EQUITY_PIPELINE_ON_START=false` und ein nicht leerer, unveränderlicher `TRADING_CODE_VERSION=<vollständiger-deployter-git-sha>`. `.env.production` wird durch dieses Arbeitspaket nicht verändert. Jeder spätere Flagwechsel benötigt eine manuelle Review und ein gezieltes `docker compose ... up -d --force-recreate` der betroffenen Dienste.

| Variable                                  | A – alles aus | B – Bootstrap | C – BTC manuell | D – BTC automatisch                          |
| ----------------------------------------- | ------------- | ------------- | --------------- | -------------------------------------------- |
| `TRADING_MODE`                            | `DISABLED`    | `SHADOW`      | `SHADOW`        | `SHADOW`                                     |
| `TRADING_SHADOW_ENABLED`                  | `false`       | `true`        | `true`          | `true`                                       |
| `TRADING_STRATEGY_V1_ENABLED`             | `false`       | `false`       | `true`          | `true`                                       |
| `TRADING_STRATEGY_LONG_V1_ENABLED`        | `false`       | `false`       | `true`          | `true`                                       |
| `TRADING_STRATEGY_SHORT_V1_ENABLED`       | `false`       | `false`       | `false`         | `false`                                      |
| `TRADING_SHADOW_SHORT_ENABLED`            | `false`       | `false`       | `false`         | `false`                                      |
| `TRADING_RISK_V1_ENABLED`                 | `false`       | `false`       | `true`          | `true`                                       |
| `TRADING_BOOTSTRAP_ENABLED`               | `false`       | `true`        | `false`         | `false`                                      |
| `TRADING_SHADOW_EXECUTION_ENABLED`        | `false`       | `false`       | `true`          | `true`                                       |
| `TRADING_SHADOW_POSITION_MONITOR_ENABLED` | `false`       | `false`       | `true`          | `true`                                       |
| `TRADING_SHADOW_RECONCILIATION_ENABLED`   | `false`       | `false`       | `true`          | `true`                                       |
| `TRADING_WORKER_ENABLED`                  | `false`       | `true`        | `true`          | `true`                                       |
| `TRADING_SCHEDULER_ENABLED`               | `false`       | `false`       | `false`         | `true`                                       |
| `TRADING_DAY_START_JOB_ENABLED`           | `false`       | `false`       | `false`         | `true`                                       |
| `TRADING_CANDIDATE_JOB_ENABLED`           | `false`       | `false`       | `false`         | `true`                                       |
| `TRADING_RISK_JOB_ENABLED`                | `false`       | `false`       | `false`         | `true`                                       |
| `TRADING_ORDER_JOB_ENABLED`               | `false`       | `false`       | `false`         | `true`                                       |
| `TRADING_FILL_JOB_ENABLED`                | `false`       | `false`       | `false`         | `true`                                       |
| `TRADING_POSITION_MONITOR_JOB_ENABLED`    | `false`       | `false`       | `false`         | `true`                                       |
| `TRADING_RECONCILIATION_JOB_ENABLED`      | `false`       | `false`       | `false`         | `true`                                       |
| `TRADING_API_ENABLED`                     | `false`       | `true`        | `true`          | `true`                                       |
| `TRADING_API_OPERATIONS_ENABLED`          | `false`       | `false`       | `false`         | `false`                                      |
| `NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED`   | `false`       | `false`       | `false`         | `false`                                      |
| `TRADING_PERFORMANCE_JOB_ENABLED`         | `false`       | `false`       | `true`          | `true`                                       |
| `TRADING_ALERT_OUTBOX_ENABLED`            | `false`       | `false`       | `true`          | `true`                                       |
| `TRADING_ALERT_DELIVERY_ENABLED`          | `false`       | `false`       | `false`         | zunächst `false`, nach Outbox-Abnahme `true` |
| `TRADING_RETENTION_ENABLED`               | `false`       | `false`       | `false`         | `false`                                      |

Stufe B darf im Eligibility Report erwartbar `NOT_READY` zeigen: Assignment, Reconciliation und Outbox sind noch nicht freigegeben. Das ist ein Prüfresultat, kein Grund zum Überspringen eines Gates. Stufe C setzt funktionale Jobflags, aber alle Schedulerflags bleiben aus; nur explizite CLI-Aufrufe laufen. Die Matrix beschreibt den empfohlenen ersten BTC-Long-Lauf. Für einen später separat abgenommenen BTC-Short-Lauf wird Long-Assignment deaktiviert, vollständig geschlossen/reconciled und erst danach werden beide Short-Flags plus genau das BTC-Short-Assignment bewusst aktiviert. ETH folgt später. Niemals beide Richtungen desselben Assets gleichzeitig in Exposure.

## 5. Verbindliche Bootstrap-Daten

`shadowBootstrap` erzeugt idempotent:

- Portfolio `SHADOW_V1`, Basiswährung USDT, Startkapital `10000.000000000000`, Status `DRAFT`, Initial-Cash-Ledger und Eröffnungssnapshot.
- aktives `RiskLimitSet` `SHADOW_V1` v1 mit Specification Hash `ff9ab29699eafaa3c2a558271d7123c33cca7732cfe29ad3f6a48443dd889864`.
- aktive, konservativ modellierte Execution Profiles v1 für BTCUSDT und ETHUSDT. BTC: Tick `0.01`, Step/MinQty `0.00001`, MinNotional `10`, Fee/Spread/Slippage je 10 bp, Participation `0.01`, Quelle `MANUAL_CONSERVATIVE_V1`.
- Session im Modus `SHADOW`, Status `STOPPED`, `killSwitchEngaged=true`.

Der ergänzte idempotente `shadowStrategySetup` erzeugt getrennt:

- den unveränderten Legacy-Long `CRYPTO_MTF_BREAKOUT_V1` mit BTCUSDT-Assignment für Replay-Kompatibilität;
- `CRYPTO_MTF_BREAKOUT_LONG_V1` und `CRYPTO_MTF_BREAKDOWN_SHORT_V1` mit ihren exakten Engine-, Code-, Parameter- und Specification-Hashes;
- BTCUSDT- und ETHUSDT-Assignments für beide aktuellen Strategien;
- insgesamt fünf 1h-Assignments, ausnahmslos initial `enabled=false`, ohne automatische Aktivierung;
- Short-Konfiguration ausschließlich synthetisch/ungehebelt mit `leverageAllowed=false`, `marginAllowed=false`, `futuresAllowed=false`.

Der Setup-Befehl verlangt `TRADING_BOOTSTRAP_ENABLED=true` und eine nicht leere `TRADING_CODE_VERSION`. Bei bestehender abweichender StrategyVersion oder Code-Version, doppeltem erwarteten Assignment oder einem bereits aktivierten neu anzulegenden Assignment bricht er ab; er korrigiert keine immutable Historie. Portfolio, Assignment, Kill Switch und Session werden niemals automatisch freigegeben.

## 6. BTCUSDT-Datenvoraussetzungen

Eligibility v3 prüft direkt und read-only:

- alle aktivierten Assignments gehören zu `SHADOW_V1`, einer gepinnten Long-/Short-Strategie und BTCUSDT/ETHUSDT; für den empfohlenen Erstlauf ist exakt BTCUSDT Long aktiv;
- aktuelle aktive Strategy/StrategyVersion samt Engine-, Code- und Specification Hash;
- mindestens 500 geschlossene 1h-, mindestens 200 geschlossene 4h- und mindestens 200 geschlossene 1d-Kerzen;
- die letzten 200 Kerzen jedes Timeframes ohne Zeitlücke und ohne leere/`UNKNOWN`-Quelle;
- je Timeframe frische `CandleDataQuality`, null Gaps/Missing/Provider-/Entitlement-/NoData-Fehler und keinen `lastErrorKind`;
- Kerzenfrische: 1h höchstens 2h15, 4h höchstens 8h15, 1d höchstens 48h15;
- Market Regime höchstens 26 Stunden alt und mit endlicher Confidence;
- frische Signale 1h/4h/1d; daraus ist die deterministische MTF-Ableitung möglich;
- vollständiges aktives BTC Execution Profile mit positiven Filtern, nicht negativen Kosten, Quelle und 64-stelligem Hash;
- Reconciliation höchstens fünf Minuten alt, konsistente Ledger-Sequenz und aktuellen UTC-Start-of-Day-Snapshot;
- keine offene kritische Risk Events, kein `ERROR_LOCKED`, geschlossene Monitoring-Circuit-Breaker, ExitPlan für jede offene Position und gesunde Outbox.

`READY` ist nur ein technischer Gate-Bericht. Er löst weder Kill Switch noch Session und ersetzt die manuellen Prüfungen in Dokument 14 nicht.

## 7. Bekannte, bewusst nicht kaschierte Grenzen

- **Behoben (Buildreihenfolge):** Alle App-Dockerfiles bauen jetzt `pnpm --filter "<app>..." build`, also die vollständige Workspace-Dependency-Closure in topologischer Reihenfolge, statt „`packages/**`, dann die App". Damit wird `apps/trading-worker` vor der API gebaut und die früheren `TS2307`-Fehler in API- und Migration-Image treten nicht mehr auf. `scripts/ops/test-ops-scripts.sh` erzwingt diese Form und schlägt fehl, sobald ein Dockerfile auf das alte Muster zurückfällt.
- `validate-prod-config.sh` unterdrückt Compose-Warnungsdetails weiterhin vollständig und behandelt jede Warnung als Blocker. Neu ist eine sichere Diagnose: der Validator nennt jetzt die betroffenen **Variablennamen** aus `.env.production` (niemals Werte) und die Ursache. Siehe Abschnitt 8.
- **Behoben (Dashboard-Flag):** `NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED` wird jetzt als Build-Arg an das Dashboard-Image durchgereicht (Default `false`). Zusätzlich war die Operations-Seite im aktivierten Build nicht baubar — ein Server Component reichte Funktions-Props an ein Client Component; das ist jetzt ein serialisierbares Body-Spec. Beide Buildvarianten (`false` und `true`) sind nachgewiesen. Ob das Dashboard für den Shadow-Test eingeschaltet wird, bleibt eine bewusste Betriebsentscheidung.
- `/trading/worker-status` ordnet Normalerfolge über Scheduler-Jobkeys zu, während die Jobfunktionen ihre fachlichen Namen in `BotRun` schreiben. `scheduler-status` fragt deshalb die tatsächlichen Namen ab und ergänzt Containerflags. Der API-Wert allein ist kein Freigabegate.
- Candidate Generation iteriert den strategischen Codescope BTCUSDT und ETHUSDT. Bei deaktivierten ETH-Assignments entsteht kein ETH-Candidate; ein entsprechender Skip im BTC-first-Lauf ist erwartet.
- Compose besitzt keine versionierten `image:`-Tags. Vorherige Images sind deshalb nicht garantiert dauerhaft adressierbar; der verlässliche Rollbackpfad ist ein getesteter Commit plus Neubuild. Details stehen in Dokument 16.

## 8. Env-Interpolation: `$` in Secrets sicher schreiben

Docker Compose interpoliert `.env.production`. Ein **unescaptes `$`** wird als Variablenreferenz gelesen und **stillschweigend durch einen Leerstring ersetzt** — der Wert ist dann nicht nur „mit Warnung", sondern **abgeschnitten**. Ein bcrypt-Hash (`$2b$10$…`) ist genau die betroffene Form: aus ihm wird `$2b$10`, und der Admin-Login schlägt anschließend unerklärlich fehl.

Nachgewiesenes Verhalten (synthetische Werte, Compose v2):

| Schreibweise in der Env-Datei | Warnung | Ergebnis          |
| ----------------------------- | ------- | ----------------- |
| `KEY=$2b$10$abcdef`           | ja      | **abgeschnitten** |
| `KEY="$2b$10$abcdef"`         | ja      | **abgeschnitten** |
| `KEY='$2b$10$abcdef'`         | nein    | korrekt           |
| `KEY=$$2b$$10$$abcdef`        | nein    | korrekt           |

**Doppelte Anführungszeichen escapen nicht.** Empfohlen sind einfache Anführungszeichen: der Wert bleibt byte-identisch zu dem, was der Generator ausgegeben hat, und lässt sich ohne Neu-Escaping vergleichen und rotieren.

`scripts/ops/_common.sh` druckt niemals den Warnungstext von Compose — der zitiert nämlich genau das Fragment, das er fälschlich für einen Variablennamen hält. Stattdessen scannt der Validator die Datei lokal und nennt ausschließlich die **Schlüsselnamen**:

```
ERROR: Docker Compose emitted a production configuration warning.
Affected variable(s) in .env.production (names only, values never shown): ADMIN_PASSWORD_HASH
```

### Manueller Korrekturschritt (nicht automatisierbar)

`.env.production` enthält echte Secrets und wird von keinem Skript und keinem Werkzeug dieses Arbeitspakets verändert. Der Schritt gehört auf den Zielhost, vieräugig:

1. `./scripts/ops/validate-prod-config.sh` ausführen und die genannten Variablennamen notieren.
2. `.env.production` lokal öffnen. Für jede genannte Variable **nur die Anführungszeichen** ergänzen — den Wert selbst nicht anfassen, nicht neu erzeugen und nicht anzeigen:
   `KEY=<wert>` wird zu `KEY='<wert>'`.
   Enthält der Wert selbst ein einfaches Anführungszeichen, stattdessen jedes `$` verdoppeln.
3. Validator erneut ausführen, bis er warnungsfrei durchläuft.
4. Da ein zuvor abgeschnittener `ADMIN_PASSWORD_HASH` nie ein gültiger Hash war: nach der Korrektur einmal den Admin-Login testen. Schlägt er fehl, war der gespeicherte Hash bereits beschädigt und muss mit `pnpm auth:hash-password` neu erzeugt werden.

## 9. Dashboard-Buildflag

`NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED` ist eine **Build-Time**-Variable: Next.js backt jeden `NEXT_PUBLIC_*`-Wert beim Bauen in das Client-Bundle. Ein Neustart des Containers mit geänderter Env ändert daran nichts — das Image muss neu gebaut werden.

```bash
# Dashboard ohne Trading-Oberfläche (Default)
./scripts/ops/prod-build.sh dashboard

# Dashboard mit Shadow-Trading-Oberfläche
NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED=true ./scripts/ops/prod-build.sh dashboard
```

`docker-compose.prod.yml` reicht den Wert explizit als Build-Arg weiter und setzt `false` als Default, sodass eine nicht gesetzte Variable immer den konservativen Build erzeugt. Nur browser-sichere Werte gehören in Build-Args; Secrets niemals.

Das Flag schaltet ausschließlich die Oberfläche. Es aktiviert kein Trading: die API braucht weiterhin `TRADING_API_ENABLED`, der Trading Worker seine eigenen Flags.
