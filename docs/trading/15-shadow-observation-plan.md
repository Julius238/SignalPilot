# P9 – Beobachtungsplan für BTC-Shadow-Trading

Stand: 2026-08-04. Beobachtet wird ausschließlich `SHADOW_V1`, zuerst BTCUSDT Long, anschließend in einem getrennten Lauf BTCUSDT Short. Gewinn ist weder ein technisches Stabilitätskriterium noch eine Freigabe für ETH, Demo oder Echtgeld. Short ist synthetisch und ungehebelt, ohne Börsenposition, Funding, Borrowing oder Liquidation.

## 1. Messoberflächen

Die kanonischen Operator-Befehle sind:

```bash
./scripts/ops/healthcheck.sh
./scripts/ops/trading-shadow.sh worker-health
./scripts/ops/trading-shadow.sh api-health
./scripts/ops/trading-shadow.sh scheduler-status
./scripts/ops/trading-shadow.sh status
./scripts/ops/trading-shadow.sh eligibility
./scripts/ops/prod-logs.sh trading-worker
```

`prod-logs.sh` folgt den Logs; nach der Prüfung wird es mit Strg-C beendet. Zusätzlich werden API- und Research-Worker-Logs geprüft, sobald Datenfrische, Auth oder n8n betroffen sind:

```bash
./scripts/ops/prod-logs.sh api
./scripts/ops/prod-logs.sh worker-scheduler
```

Beim ersten Lauf ist das Trading-Dashboard per Buildflag absichtlich aus. Deshalb sind CLI und authentifizierte Trading-Read-API die verbindlichen Tradingoberflächen. Wird die read-only Trading-Oberfläche später separat gebaut, muss sie Direction, StrategyVersion, Side, Collateral und „keine Exchange-Position“ genauso wie die API zeigen.

Pro Checkpoint werden mindestens festgehalten:

- Commit-SHA/`TRADING_CODE_VERSION`, Flag-Stufe, Operator, UTC-Zeit und Container-Health;
- Portfolio: Status, Cash, Reserve, Equity, Realized PnL, Fees, Ledgersequenz und `lastReconciledAt`;
- Session: Status, Kill Switch, Heartbeat, Reconciliation und letzter Zustandswechsel;
- aktives BTC-Assignment mit Direction, StrategyVersion/Engine/Hash, alle Short-Flags und Execution Profile;
- Candidates, Risk-Entscheidungen, Orders, Fills, Positionen und Ledgerbuchungen nach Status/Typ/Direction; Short-Collateral und richtungsabhängiges P&L;
- offene kritische Risk Events, Circuit Breaker, Job-Leases und Alert-Outbox nach Status;
- letzte `BotRun`-Ergebnisse und tatsächliche Jobdauer.

## 2. Erste 72 Stunden

### Takt

| Zeitraum          | Checkpoints                                                           | Bedienung                                                  |
| ----------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| vor Aktivierung   | direkt vor Kill-Switch-Release                                        | Health, Reconcile, Eligibility und Flag-Matrix vollständig |
| T+0 bis T+1h      | 0, 5, 15, 30 und 60 Minuten                                           | Operator bleibt verfügbar; Status nach jedem Jobtyp        |
| T+1h bis T+6h     | stündlich                                                             | Logs, Zähler, Reconcile, Exposure und Outbox               |
| T+6h bis T+24h    | alle 3 Stunden                                                        | zusätzlich Datenfrische und Job-Erfolgsquote               |
| T+24h bis T+72h   | alle 6 Stunden                                                        | zusätzlich UTC-Tageswechsel und Performance                |
| ereignisgetrieben | bei Candidate, APPROVE, Order, Fill, Exit, Restart, Alert oder Fehler | sofortiger zusätzlicher Checkpoint                         |

Performance wird bei T+6h, T+24h, T+48h und T+72h manuell aktualisiert. Die Alert-Outbox wird zunächst manuell und ohne Zustellung geprüft. Retention bleibt durchgehend aus.

### Jobs und Sollverhalten

| Job          | Soll in Stufe D        | Beobachtung                                                                    |
| ------------ | ---------------------- | ------------------------------------------------------------------------------ |
| Day Start    | 00:05 UTC              | ein logischer aktueller SOD, idempotenter Replay                               |
| Candidate    | Minute 05 jeder Stunde | nur aktivierte BTC-StrategyVersion, null oder höchstens ein Candidate je Anker |
| Risk         | minütlich              | jeder claimbare Candidate genau einmal final bewertet                          |
| Order        | minütlich              | nur APPROVE, höchstens eine Entryorder je Candidate                            |
| Fill         | alle zwei Minuten      | nur geschlossene Folgekerzen, eindeutige Fillsequenz                           |
| Monitor      | alle zwei Minuten      | ExitPlan vorhanden; Stop/TP/Time/Risk-Close risikoreduzierend                  |
| Reconcile    | alle fünf Minuten      | konsistent, Session-/Portfolio-Heartbeat frisch                                |
| Performance  | manuell                | reine, reproduzierbare Projektion                                              |
| Alert-Outbox | manuell                | Aufzeichnung unabhängig von Zustellung                                         |

### Fehlerbudget

- Erlaubt sind **0** Sicherheits-, Scope-, Idempotenz-, Ledger-, Reconciliation-, Auth-, Live-/Exchange- oder Exitfehler.
- Erlaubt sind **0** ungeklärte Jobfehler und **0** unbestätigte kritische Risk Events am Ende eines Checkpoints.
- In 72 Stunden ist höchstens **ein** vorübergehender nicht kritischer Infrastruktur-/Providerfehler zulässig, wenn er beim unmittelbar nächsten geplanten Lauf vollständig heilt, keine Datenlücke hinterlässt und kein Tradingobjekt verändert. Ein zweites Ereignis pausiert den Lauf.
- Alert-Zustellung darf vor ihrer Freigabe nicht stattfinden. Nach Freigabe sind **0** verlorene kritische Alerts zulässig; ein einzelner retried Zustellversuch darf Positionsmonitor/Exit nie blockieren.
- Erwartete fachliche Ergebnisse wie `NO_BREAKOUT`/`NO_BREAKDOWN`, `ASSIGNMENT_MISSING` für deaktivierte Assignments, Risk-REJECT oder „keine fällige Arbeit“ zählen nicht als Fehler.

### Sofort pausieren

Session sofort pausieren, wenn noch keine unkontrollierte Exposure vermutet wird, insbesondere bei:

- irgendeinem ungeklärten `FAILED`/`ERROR` eines Entry-Jobs;
- stale Researchdaten, Signale, Regime, Quality oder Reconciliation;
- Worker-Restart-Schleife, verwaister Lease oder Scheduler-Doppelstart;
- API-/Dashboard-Abweichung, Alert-Retry-Sturm oder Performance-Nichtreproduzierbarkeit;
- fehlendem On-call-Operator, Wartungsfensterende oder Beobachtungslücke;
- Überschreiten des einen zulässigen transienten Fehlers.

Nach Pause laufen nur Monitor, Reconcile und erforderlichenfalls ein manueller Risk Close weiter.

### Kill Switch auslösen

Kill Switch sofort und zusätzlich zur Pause auslösen bei:

- neuer Exposure trotz Pause, Kill Switch, stale Reconciliation oder fehlendem SOD;
- mehr als einer Order je Candidate, doppeltem Fill, doppelter Ledgersequenz oder Replay-Duplikat;
- nicht aktivierter Direction/StrategyVersion, Nicht-BTC-Candidate/Order/Position oder einem Exchange-/Demo-/Live-/Margin-/Futures-Artefakt;
- Reconciliation-Differenz, `ERROR_LOCKED`, offenem Monitoring-Circuit-Breaker oder Position ohne ExitPlan;
- Fill mit unzulässiger Kerze, Menge, Preis, Profil oder Kostenannahme;
- gegensätzlichen/doppelten aktiven Scopes, falscher Side/Direction, fehlendem/überhöhtem Short-Collateral, falschem P&L-Vorzeichen, Exposure-Erhöhung im Monitor/Risk-Close oder blockiertem Stop/TP/Exit;
- Verdacht auf Datenkorruption, Credential-/Auth-Leak oder falsches Image/Commit.

Der genaue Not-Aus steht in [Dokument 16](16-shadow-rollback-and-emergency.md).

### Incident-Evidenz

Vor Reparatur oder Neustart werden, soweit dies keinen Exit verzögert, gespeichert:

- UTC-Zeitlinie, Operatoraktionen, Idempotency-Keys und alle betroffenen IDs;
- Commit-SHA, Image-/Container-IDs, Compose-Servicezustand und **nur die nicht geheimen Tradingflags**;
- Trading/API/Research-Logs vom letzten gesunden Checkpoint bis 15 Minuten nach dem Ereignis;
- `status`, `scheduler-status`, vollständiger Eligibility Report und Reconciliation-Ergebnis;
- unveränderte Rows/Exports zu Candidate, Evidence, Risk Assessment/Results/Events, Order, Fill, Position/Event/ExitPlan, Ledger/Snapshot, Session, JobCursor, Audit und Outbox/Attempts;
- Candle-/Signal-/Regime-/Quality-IDs, Zeitpunkte sowie Input-/Output-/Specification-Hashes;
- Backup-Pfad und Prüfsumme, ohne Backup-Inhalt oder Secrets in Tickets zu kopieren;
- erwartetes gegen tatsächliches Verhalten, Auswirkungen, Recovery und verbleibende Unsicherheit.

Append-only Tradinghistorie wird nicht „bereinigt“. Korrekturen erfolgen nur als dafür vorgesehene Gegenbuchung oder in einem später freigegebenen Fix.

### Technisch stabil nach 72 Stunden

BTC ist für die Fortsetzung technisch stabil, wenn gleichzeitig:

1. alle planmäßigen Day-start-, Candidate-, Risk-, Order-, Fill-, Monitor- und Reconcile-Läufe stattgefunden haben;
2. kein kritischer Fehler und höchstens der definierte, vollständig geheilte transiente Fehler vorlag;
3. kein Duplikat, keine ungeklärte Differenz, kein Nicht-BTC-Objekt und kein offener kritischer Risk Event existiert;
4. Worker/Leases/Restart-Verhalten stabil, Reconciliation immer innerhalb des Fünf-Minuten-Gates und alle UTC-Tageswechsel korrekt waren;
5. jede offene Position ExitPlan und fortlaufendes Monitoring besitzt;
6. Outbox-Aufzeichnung funktioniert und n8n-Unabhängigkeit für Exits nachgewiesen ist;
7. API/Auth korrekt sind und das Dashboard keine Börsenorder suggeriert;
8. Performance bei identischem Input reproduzierbar und nach Direction, StrategyVersion, Asset, Regime und Exitgrund vollständig segmentiert ist;
9. die Session am 72h-Reviewpunkt pausiert und der Review schriftlich freigegeben wurde.

Ein bestandener 72h-Test erlaubt nur die Fortsetzung des BTC-Shadow-Laufs. Er aktiviert weder ETH noch irgendeinen Exchange-Modus.

## 3. Mindestens 60 Tage Shadow-Test

Die Phase endet nicht allein nach 60 Kalendertagen. Zusätzlich müssen alle folgenden Mindestwerte und Qualitätskriterien erfüllt sein; andernfalls läuft BTC-Shadow weiter:

- mindestens **30** valide BTC-Candidates über unterschiedliche 1h-Anker;
- mindestens **20** vollständig abgeschlossene BTC-Shadow-Trades je tatsächlich freigegebener Direction, darunter positive und negative Exitpfade;
- **0** doppelte Candidate-, Decision-, Order-, Fill-, PositionEvent- oder Ledger-Keys/Sequenzen;
- **0** ungeklärte Reconciliation-Differenzen und **0** ungeklärte `ERROR_LOCKED`-Fälle;
- **0** offene unbestätigte kritische Risk Events am Reviewpunkt;
- mindestens **99,5 %** erfolgreiche planmäßige Jobläufe; jeder fehlgeschlagene Lauf erklärt, incident-erfasst und ohne Primärdatenverlust geheilt;
- kein Monitoring-/Reconcile-Ausfall länger als ein reguläres Folgeintervall plus Recovery; kein ungeklärter Leasekonflikt;
- 100 % der kritischen Alerts in der Outbox nachvollziehbar und nach Zustellfreigabe zugestellt oder bewusst quittiert; keine Zustellung blockiert einen Exit;
- Performanceprojektionen sind gegen Ledger/PositionEvents reproduzierbar, versioniert und ohne Überschreiben historischer Inputs;
- UTC-Tagesverlust, Drawdown, nicht genettete Brutto-Exposure, Collateral, Gebühren, R-Multiple, Stops, Take-Profit, Time-Exit und mindestens ein manueller Risk-Close sind je Direction fachlich nachvollziehbar;
- Betriebsrunbooks wurden mindestens einmal als Tabletop und der deaktivierende Rollback einmal im pausierten Zustand geprüft.

Die Review bewertet technische Korrektheit, Risikogrenzen, Datenqualität und Betriebssicherheit. Profit, Trefferquote oder kurzfristige Rendite allein sind kein Go-Kriterium; ein profitabler Lauf mit einem einzigen Konsistenzfehler ist nicht bestanden.

ETHUSDT darf erst nach bestandenem 72h- und 60-Tage-BTC-Review, eigenem Bootstrap-/Daten-Eligibility-Nachweis und gesonderter Freigabe zugewiesen werden. Demo-/Echtgeld oder ein Exchange-Adapter bleiben außerhalb dieses Plans.
