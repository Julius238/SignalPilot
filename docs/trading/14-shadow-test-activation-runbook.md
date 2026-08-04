# P9 – Aktivierung des ersten BTC-Shadow-Tests

Stand: 2026-08-04. Dieses Runbook ist eine spätere Operator-Anweisung, keine Freigabe zur Ausführung. Es verbindet sich mit keiner Exchange und erzeugt ausschließlich interne `ShadowOrder`-/`ShadowFill`-Datensätze. Demo-, Echtgeld-, Margin- und Futures-Orders sind ausgeschlossen. ETHUSDT-Assignments existieren nach Setup, bleiben aber bis zu ihrer späteren Einzelabnahme deaktiviert.

**Aktueller Status: nicht aktiviert.** Lokale Verifikation ersetzt weder Review, Backup, produktive Config-Prüfung noch Operatorfreigabe. Vor Schritt 1 müssen alle Checks dieses Runbooks gegen den freigegebenen Commit und die spätere VPS-`.env.production` wiederholt werden.

## 1. Bedienregeln

Alle Befehle werden auf dem VPS im ausgecheckten Repository ausgeführt. `<operator>` ist durch eine persönliche Operator-ID zu ersetzen; jeder `<p9-...>`-Wert muss pro beabsichtigter Zustandsänderung eindeutig und in einem Incident wiederauffindbar sein.

Nach jedem Schritt gilt ein hartes Go/No-Go:

- Nur bei exakt erwartetem Ergebnis zum nächsten Schritt gehen.
- Jeder Fehler, unbekannte Zustand oder abweichende Zähler bedeutet Stopp. Nicht durch Wiederholung „wegtesten“.
- Vor Schritt 13 genügt als Rückfall das Zurücksetzen auf die vorherige Flag-Stufe und ein gezieltes Recreate. Ab Schritt 13 wird zusätzlich `rollback-disabled` verwendet.
- `.env.production` wird nur nach Vier-Augen-Review gegen die exakte Matrix in [Dokument 13](13-production-deployment-runbook.md) geändert. Die Datei und Compose-Ausgaben mit Secrets gehören weder ins Terminalprotokoll noch in Tickets.
- `TRADING_CODE_VERSION` ist vor dem Build auf den vollständigen freigegebenen Commit-SHA festgelegt. `ENABLE_LIVE_TRADING=false` und `PAPER_TRADING_ONLY=true` bleiben in allen Stufen unverändert. Das Trading-Dashboard bleibt beim ersten Lauf mit Buildflag `false`; eine spätere read-only Freigabe ist ein separater Build und aktiviert nichts.

Der gezielte Recreate-Befehl nach einer geprüften Flag-Änderung lautet:

```bash
COMPOSE_PROJECT_NAME=signalpilot docker compose --project-name signalpilot \
  --env-file .env.production -f docker-compose.prod.yml \
  up -d --force-recreate trading-worker api
```

Für Stufe A wird dagegen `./scripts/ops/prod-up.sh` verwendet. Ein Dashboard-Rebuild gehört nicht in den ersten Lauf; sein korrekt verdrahtetes Buildflag bleibt `false`.

Noch vor Schritt 1 muss der read-only Preflight bestehen:

```bash
./scripts/ops/validate-prod-config.sh
```

Jede Compose-Warnung ist ein Abbruchkriterium. Das Script unterdrückt Warnungsdetails, weil Interpolationswarnungen Secret-Fragmente enthalten können. Erst nach lokaler Korrektur und Vier-Augen-Review der `.env.production` darf das Backup beginnen.

## 2. Kontrollierter Ablauf

### 1. Datenbank-Backup

```bash
./scripts/ops/backup-postgres.sh
```

- Erwartet: `Backup saved:` mit einer nicht leeren Datei `backups/signalpilot_<zeit>.dump`.
- Prüfung: ausgegebenen Pfad mit `ls -lh <ausgegebener-backup-pfad>` prüfen und Off-site-Kopie bestätigen.
- Abbruch: Postgres nicht gesund, `pg_dump` ungleich null, Datei leer oder Off-site-Kopie fehlt.
- Rückfall: keine Zustandsänderung; Fehler beheben und neues Backup erzeugen.

### 2. Freigegebenen Commit holen

```bash
git status --short
git pull --ff-only
git rev-parse HEAD
```

- Erwartet: kein lokaler Diff; HEAD entspricht `TRADING_CODE_VERSION`.
- Prüfung: `git status --short` bleibt leer; SHA im Change-Protokoll notieren.
- Abbruch: lokale Änderungen, Merge-Bedarf, falscher Branch oder SHA.
- Rückfall: nichts überschreiben; Repositoryzustand separat klären.

### 3. Produktionsimages bauen

```bash
./scripts/ops/validate-prod-config.sh
./scripts/ops/prod-build.sh
```

- Erwartet: Compose-Konfiguration ist warnungsfrei; alle Images inklusive Trading Worker und Migration-Target bauen; kein Containerstart.
- Prüfung: beide Exitcodes 0 und Abschlussmeldung, dass weder Container noch Migration gestartet wurden.
- Abbruch: jede Compose-Warnung oder TypeScript-, Next-, Prisma- beziehungsweise Image-Buildfehler. Insbesondere darf der in Dokument 13 festgehaltene API-Dockerfile-Blocker nicht mehr reproduzierbar sein.
- Rückfall: bisherige Container unverändert lassen; keine Migration.

### 4. Migration Deploy

```bash
./scripts/ops/prod-migrate-docker.sh
./scripts/ops/prisma-smoke.sh
```

- Erwartet: ausschließlich die dokumentierten additiven Trading-Migrationen einschließlich Direction und Short-Collateral beziehungsweise keine offenen Migrationen; drei Prisma-Smokes bestehen.
- Prüfung: beide Exitcodes 0.
- Abbruch: unbekannte Migration, Drift, P300x-/P10xx-Fehler oder Smoke-Fehler.
- Rückfall: keine Down-Migration; Container nicht umschalten, Backup bewahren.

### 5. Stufe A starten – alles aus

Stufe A aus Dokument 13 vieräugig setzen, dann:

```bash
./scripts/ops/prod-up.sh
./scripts/ops/trading-shadow.sh scheduler-status
```

- Erwartet: Container laufen, Trading Worker idle; `TRADING_MODE=DISABLED` und sämtliche Trading-/Scheduler-/API-/Dashboard-/Alert-/Retention-Flags aus.
- Prüfung: `scheduler-status` zeigt exakt Stufe A und keine neuen Trading-BotRuns.
- Abbruch: Tradingflag an, Live-Trading nicht `false`, Paper-only nicht `true` oder Job läuft.
- Rückfall: `./scripts/ops/prod-down.sh`; Flags korrigieren und erneut reviewen.

### 6. Healthchecks

```bash
./scripts/ops/healthcheck.sh
./scripts/ops/prisma-smoke.sh
./scripts/ops/trading-shadow.sh worker-health
./scripts/ops/trading-shadow.sh api-health
```

- Erwartet: sechs Servicechecks, drei Prisma-Smokes und Worker-Health bestehen; Trading-Read-Route ist `404`.
- Prüfung: alle vier Exitcodes 0.
- Abbruch: Restart-Schleife, unhealthy/missing, Prisma-Fehler oder Trading-Route trotz deaktivierter API.
- Rückfall: Stufe A; `./scripts/ops/prod-logs.sh -- -n 200` sichern.

### 7. Stufe B und Bootstrap

Stufe B setzen, Recreate aus Abschnitt 1 ausführen, dann:

```bash
./scripts/ops/trading-shadow.sh scheduler-status
./scripts/ops/trading-shadow.sh bootstrap
./scripts/ops/trading-shadow.sh bootstrap
./scripts/ops/trading-shadow.sh status
```

- Erwartet: Worker an, Scheduler aus; idempotent Portfolio/Risk/Profile/Session sowie Legacy Long, aktueller Long, aktueller Short und fünf deaktivierte BTC-/ETH-Assignments. `SHADOW_V1=DRAFT`, 10.000 USDT, `STOPPED`, Kill Switch `true`, alle Assignments `enabled=false`.
- Prüfung: zweiter Bootstrap erzeugt keine Duplikate; Status bestätigt alle Werte.
- Abbruch: immutable Konflikte, Hashabweichung, Aktivierung oder Duplikat.
- Rückfall: Stufe A und gezieltes Recreate; Kill Switch/STOPPED bleiben.

### 8. Portfolio prüfen

```bash
./scripts/ops/trading-shadow.sh status
```

- Erwartet: `SHADOW_V1`, `DRAFT`, Starting Cash/Available Cash/Equity 10.000, Reserve 0, konsistente Initial-Ledgersequenz.
- Prüfung: Ausgabe und Zähler sichern.
- Abbruch: anderes Kapital, `ACTIVE`/`ERROR_LOCKED`, negative Beträge oder Ledgerabweichung.
- Rückfall: nichts aktivieren; Stufe A und Incident.

### 9. StrategyVersion prüfen und BTC separat zuweisen

Die Statusausgabe muss Legacy Long, aktuellen Long und aktuellen Short mit den im Build gepinnten Engine-/Code-/Specification-Hashes sowie fünf deaktivierte BTC-/ETH-Assignments zeigen. Für den empfohlenen ersten Test wird exakt das BTCUSDT-Assignment von `CRYPTO_MTF_BREAKOUT_LONG_V1` über ID und aktuelle Version aktiviert:

```bash
./scripts/ops/trading-shadow.sh enable-assignment \
  <btc-long-assignment-id> <expected-version> <operator> <p9-btc-long-enable-unique> \
  'ENABLE_BTCUSDT_LONG_CRYPTO_MTF_BREAKOUT_LONG_V1_V<expected-version>'
./scripts/ops/trading-shadow.sh status
```

- Erwartet: exakt BTC Long ist `enabled=true`; BTC Short und beide ETH-Assignments bleiben `false`.
- Prüfung: Wiederholung mit gleichem Idempotency-Key ändert keine Zähler.
- Abbruch: anderer Hash/Engine/Timeframe, mehr als das gewählte Assignment aktiv oder eine unbekannte Direction/Capability.
- Rückfall: `disable-assignment` mit derselben ID, dann aktueller Version und exaktem `DISABLE_..._V<version>`-Text; danach Stufe A.

Der erste Short-Test ist ein späterer separater Lauf: Long-Assignment deaktivieren, alle Long-Orders/Positionen terminalisieren, Reconcile und Eligibility erfolgreich abschließen, dann `TRADING_STRATEGY_SHORT_V1_ENABLED=true` und `TRADING_SHADOW_SHORT_ENABLED=true` setzen und ausschließlich BTC Short mit dem generischen Kommando aktivieren. Nie Long und Short desselben Assets gleichzeitig. Short bleibt synthetisch und ungehebelt; es gibt keine Exchange-Position, kein Funding, Borrowing oder Liquidationsmodell.

### 10. Stufe C und Start-of-Day

Stufe C setzen, `TRADING_BOOTSTRAP_ENABLED=false` und alle Schedulerflags `false` lassen, Recreate aus Abschnitt 1, dann:

```bash
./scripts/ops/trading-shadow.sh scheduler-status
./scripts/ops/trading-shadow.sh job day-start
./scripts/ops/trading-shadow.sh job day-start
./scripts/ops/trading-shadow.sh status
```

- Erwartet: genau ein logischer Snapshot für den aktuellen UTC-Tag; zweiter Lauf ist idempotent.
- Prüfung: Jobs `SUCCESS`, Scheduler aus, Geld-/Ledgerwerte unverändert.
- Abbruch: falsches UTC-Datum, Cashabweichung, Jobfehler oder Scheduler an.
- Rückfall: Assignment aus und Stufe A; Kill Switch/STOPPED bleiben.

### 11. Reconciliation

```bash
./scripts/ops/trading-shadow.sh job reconcile
./scripts/ops/trading-shadow.sh status
```

- Erwartet: `SUCCESS`, `consistent=1`, `inconsistent=0`; frische Reconciliation-/Heartbeat-Zeitpunkte.
- Prüfung: unveränderte Geld-/Ledgerwerte und kein unbestätigter kritischer Risk Event.
- Abbruch: Verletzung, `ERROR_LOCKED`, kritischer Event oder Differenz.
- Rückfall: Kill Switch mit Grund `RECONCILIATION_FAILED`, Stufe A, Incident.

### 12. Eligibility Report

```bash
./scripts/ops/trading-shadow.sh eligibility
```

- Erwartet: Exitcode 0 und `READY`; aktiver Kill Switch nur als Warnhinweis.
- Prüfung: alle BLOCKER PASS, besonders Assignment/Direction/Hashes, Short-Flags und Shadow-only-Capability, BTC zuerst, 1h/4h/1d-Historie, Gap/Quality/Freshness, MTF, Regime, Execution Profile, gegensätzliche Scopes, Collateral, SOD und Reconciliation.
- Abbruch: jeder FAIL/ERROR, unbekannte Warning, stale Daten oder alter Hash.
- Rückfall: nicht freigeben; Daten-/Ops-Ursache beheben und Schritte 10–12 wiederholen.

### 13. Portfolio aktivieren

```bash
./scripts/ops/trading-shadow.sh activate-portfolio \
  <operator> <p9-portfolio-activate-unique> ACTIVATE_SHADOW_V1
./scripts/ops/trading-shadow.sh status
```

- Erwartet: nur `DRAFT -> ACTIVE`; Session `STOPPED`, Kill Switch aktiv.
- Prüfung: Status und Audit-ID sichern.
- Abbruch: Session-/Kill-Switch-Nebenwirkung oder anderes Portfolio.
- Rückfall: keine fachliche Rückwärtsmutation; `rollback-disabled` blockiert alle Entries.

### 14. Kill Switch kontrolliert lösen

```bash
./scripts/ops/trading-shadow.sh job reconcile
./scripts/ops/trading-shadow.sh release-kill-switch \
  <operator> <p9-kill-release-unique> RELEASE_SHADOW_KILL_SWITCH
./scripts/ops/trading-shadow.sh status
```

- Erwartet: Session weiterhin `STOPPED`, Kill Switch `false`; auditierter Release.
- Prüfung: Reconciliation höchstens fünf Minuten alt.
- Abbruch: Guard verweigert, Reconciliation stale oder Session weicht ab.
- Rückfall: `./scripts/ops/trading-shadow.sh engage-kill-switch <operator> <p9-kill-reengage-unique> P9_ABORT ENGAGE_SHADOW_KILL_SWITCH`.

### 15. Session aktivieren

```bash
./scripts/ops/trading-shadow.sh activate-session \
  <operator> <p9-session-activate-unique> ACTIVATE_SHADOW_SESSION
./scripts/ops/trading-shadow.sh status
```

- Erwartet: ausschließlich `STOPPED -> SHADOW_ACTIVE`; keine Order durch Aktivierung.
- Prüfung: Candidate-/Order-/Fill-Zähler unverändert, Scheduler aus.
- Abbruch: Guard-Fehler, Zähleränderung, nicht exakt gewähltes BTC-Assignment oder Scheduler an.
- Rückfall: `./scripts/ops/trading-shadow.sh rollback-disabled <operator> <p9-step15-rollback> ROLLBACK_SHADOW_DISABLED`.

### 16. Candidate einmal manuell

```bash
./scripts/ops/trading-shadow.sh job candidate
./scripts/ops/trading-shadow.sh status
```

- Erwartet: `SUCCESS`; BTC höchstens ein Candidate je aktivierter StrategyVersion und geschlossenem 1h-Anker oder keiner ohne Breakout/Breakdown. Für deaktivierte ETH-/Gegenrichtungs-Assignments ist `ASSIGNMENT_MISSING` erwartet und es entsteht kein Datensatz.
- Prüfung: nur Candidate-Zähler kann steigen; Order/Fill/Ledger unverändert.
- Abbruch: ETH-Candidate, Duplikat, ERROR, Order/Fill oder mehrere Candidates je Anker.
- Rückfall: Session pausieren; bei Scope-/Idempotenzfehler zusätzlich Kill Switch.

### 17. Risk einmal manuell

```bash
./scripts/ops/trading-shadow.sh job risk
./scripts/ops/trading-shadow.sh status
```

- Erwartet: genau ein deterministischer Risk-Verdict je prüfbarem Candidate; Ablehnung erzeugt keine Order.
- Prüfung: noch keine neue Order; kritische Risk Events sind erklärt.
- Abbruch: fehlende/mehrfache Entscheidung, Freigabe trotz Gate-Verletzung oder Order.
- Rückfall: Session pausieren; bei unsicherem Risk-Zustand Kill Switch.

### 18. Order einmal manuell

```bash
./scripts/ops/trading-shadow.sh job order
./scripts/ops/trading-shadow.sh status
```

- Erwartet: nur nach Risk-APPROVE höchstens eine interne BTC-`ShadowOrder`.
- Prüfung: höchstens eine Order je `entryCandidateKey`; keine Fill-/Exchange-ID.
- Abbruch: Duplikat, Nicht-BTC, Order ohne APPROVE oder echte Exchangeorder.
- Rückfall: Session pausieren und Kill Switch; keine Datensätze löschen.

### 19. Fill einmal manuell

```bash
./scripts/ops/trading-shadow.sh job fill
./scripts/ops/trading-shadow.sh status
```

- Erwartet: nur anhand geschlossener Folgekerzen und BTC-Profil ein simulierter Fill; sonst null.
- Prüfung: Fill, Order, Position und Ledgersequenz konsistent; Replay ohne zweiten Fill.
- Abbruch: unzulässige Kerze/Menge/Profil oder Ledgerabweichung.
- Rückfall: Session pausieren, Kill Switch, dann Reconciliation.

### 20. Position Monitor

```bash
./scripts/ops/trading-shadow.sh job monitor
./scripts/ops/trading-shadow.sh status
```

- Erwartet: keine offene Position ohne ExitPlan; Stop/TP/Time-/Risk-Close nur risikoreduzierend.
- Prüfung: offene Menge steigt nicht, Positionsevents gapless, kein unerklärter kritischer Event.
- Abbruch: fehlender ExitPlan, Exposure-Erhöhung, Circuit Breaker oder Fehler.
- Rückfall: Kill Switch und Sessionpause; bestehende Exposure weiter monitoren.

### 21. Reconciliation nach Ausführung

```bash
./scripts/ops/trading-shadow.sh job reconcile
./scripts/ops/trading-shadow.sh status
```

- Erwartet: `consistent=1`, `inconsistent=0`; Cash, Reserve, Position, Fill und Ledger replaybar.
- Prüfung: keine ungeklärten Risk Events, frische Zeitpunkte.
- Abbruch: jede Differenz oder `ERROR_LOCKED`.
- Rückfall: Kill Switch und Pause; keine Entries, Exit-Monitoring fortführen.

### 22. Performance Refresh

```bash
./scripts/ops/trading-shadow.sh job performance
./scripts/ops/trading-shadow.sh status
```

- Erwartet: `SUCCESS`; idempotente Projektionen, bei wenig Historie nachvollziehbar leere Kennzahlen.
- Prüfung: keine Änderung an Portfolio-/Ledger-/Order-/Fill-Zählern.
- Abbruch: Primärdatenänderung, fremde Engineversion überschrieben oder nicht reproduzierbar.
- Rückfall: Performance-Flag aus; Trading pausiert lassen.

### 23. API und Dashboard prüfen

```bash
./scripts/ops/trading-shadow.sh api-health
./scripts/ops/healthcheck.sh
./scripts/ops/trading-shadow.sh status
```

- Erwartet: API `200`, geschützte Trading-Read-Route `401`/`403`, API-Operations aus. Dashboard gesund, aber keine Tradingansicht.
- Prüfung: authentifizierte Read-API enthält nur Shadowobjekte und keinen Exchange-/Bitget-Identifier; DB-Zähler stimmen.
- Abbruch: Operations freigegeben, Tradingdaten ohne Auth oder Darstellung echter Börsenorders.
- Rückfall: API-Flag aus und API recreaten; Pause, bei Sicherheitsabweichung Kill Switch.

### 24. Session wieder pausieren

```bash
./scripts/ops/trading-shadow.sh pause-session \
  <operator> <p9-session-pause-unique> PAUSE_SHADOW_SESSION
./scripts/ops/trading-shadow.sh status
./scripts/ops/trading-shadow.sh job monitor
./scripts/ops/trading-shadow.sh job reconcile
```

- Erwartet: `PAUSED`, keine neue Exposure; offene Positionen bleiben überwacht und konsistent.
- Prüfung: Candidate/Risk/Order/Fill nicht erneut ausführen; Monitor/Reconcile erfolgreich.
- Abbruch: Pause verweigert, neue Entryorder oder Differenz.
- Rückfall: Kill Switch sofort aktivieren und Dokument 16 anwenden.

Der manuelle Lauf ist erst bestanden, wenn Schritt 24 abgeschlossen, die Session pausiert und die Evidenz aller 24 Gates gesichert ist.

## 3. Operative Testfälle

Produktionsdaten werden nie künstlich verbogen. Deterministische Fehler-/Preisfälle laufen in der vorhandenen Testsuite; auf dem VPS werden natürliche Fälle oder ausdrücklich risikoreduzierende Aktionen beobachtet.

| Test                   | Aktion und erwartetes Ergebnis                                                                                                                    | Evidenz / Abbruch                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Kein Breakout          | Candidate-Job: kein Candidate.                                                                                                                    | Status vor/nach; jede Order ist Abbruch.                            |
| Candidate abgelehnt    | Risk ergibt REJECT/BLOCK, Order-Job erzeugt nichts.                                                                                               | Candidate-/Risk-/Orderzähler.                                       |
| Risk-Freigabe          | APPROVE, Order-Job zweimal.                                                                                                                       | Höchstens eine Order je Candidate; zwei lösen Kill Switch aus.      |
| Replay                 | Alle manuellen Jobs am unveränderten Datenanker wiederholen.                                                                                      | Keine zweite fachliche Key-/Sequenz-/Ledgerbuchung.                 |
| Session pausiert       | Entry-Aufruf muss am Guard scheitern.                                                                                                             | Keine neue Exposure; sonst Kill Switch.                             |
| Kill Switch aktiv      | Entry-Job kontrolliert aufrufen.                                                                                                                  | Entry verweigert; Monitor/Reconcile möglich.                        |
| Reconciliation stale   | Nicht künstlich altern; Guard-Test plus natürlich >5 Minuten vor Aktivierung.                                                                     | Aktivierung/Entry verweigert.                                       |
| Stop/Take-Profit       | Automatisierte Intrabar-Tests; natürliche Fälle per Monitor.                                                                                      | Eine Exitorder, `STOP_FIRST`, konsistentes Ledger.                  |
| Manueller Risk Close   | `./scripts/ops/trading-shadow.sh manual-risk-close <position-id> <operator> <unique-key> "<reason>" MANUAL_RISK_CLOSE`, danach Monitor/Reconcile. | Auditierter Request, keine Exposure-Erhöhung; Replay ohne Duplikat. |
| `ERROR_LOCKED`         | Nicht absichtlich produktiv; automatisierter Reconciliation-/State-Test.                                                                          | Entry blockiert, Kill aktiv, Unlock nur nach Ursachenbehebung.      |
| Outbox ohne Zustellung | Stufe C: `job alerts` bei Outbox an, Delivery aus.                                                                                                | Aufgezeichnet, keine Attempts/SENT.                                 |
| n8n-Ausfall            | DB-Klon/isolierter Test: n8n unerreichbar, Delivery und Exit getrennt.                                                                            | Backoff; Exit erfolgreich.                                          |
| Worker-Neustart        | Nur pausiert/Kill aktiv: tatsächlichen Compose-Dienst neu starten, dann Health/Status.                                                            | Keine Autoaktivierung/Duplikate.                                    |
| Lease-Recovery         | Automatisierter Test; VPS nur nach natürlichem Abbruch zehn Minuten warten, dann pausiert wiederholen.                                            | Kein Takeover vor Ablauf, danach genau ein Lauf.                    |
| UTC-Tageswechsel       | Day-start um 00:05 UTC und Replay.                                                                                                                | Genau ein logischer SOD pro UTC-Tag.                                |
| Dashboard              | Dashboard/API-Datenmodell prüfen.                                                                                                                 | Nur Shadow, keine Exchange-/Bitget-/Demo-/Liveorder.                |

## 4. Freigabe von Stufe D

Stufe D erfordert nach bestandenem manuellen Lauf eine neue Vier-Augen-Freigabe. Zunächst bleiben Alert-Zustellung, Retention und Trading-Dashboard aus. Performance und Outbox bleiben manuell.

Vor dem Recreate:

1. Session `PAUSED`, Kill Switch aktiv, exakt ein BTC-Direction-Assignment aktiv.
2. Reconciliation frisch und Eligibility `READY`.
3. Stufe-D-Matrix exakt geprüft.
4. Nach Recreate zeigt `scheduler-status` genau sieben Schedulerjobs aktiv.
5. Reconcile, Kill-Switch-Release und Sessionaktivierung erneut getrennt.

Alert-Zustellung folgt erst nach Outbox- und n8n-Abnahme. ETHUSDT wird erst nach erfolgreicher, getrennt ausgewerteter BTC-Long-/Short-Beobachtung einzeln freigegeben; keine automatische Aktivierung.
