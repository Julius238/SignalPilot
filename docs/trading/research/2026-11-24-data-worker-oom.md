# Daten-Worker: Absturzschleife ab 2026-11-20 (Ursache, Datenlücke, Korrektur)

> **Stand 2026-11-24, 11:00 UTC.** Korrektur lokal fertig und getestet, **nicht
> deployt**. Bis zum Deployment wächst die Datenlücke weiter.
>
> - Kein Eingriff in Datenbank, Container oder Konfiguration des VPS.
> - Nichts wird nachgetragen: Fehlende Signale und Bewertungen bleiben fehlend,
>   abgebrochene Läufe bleiben als `RUNNING` in `BotRun` stehen.
> - Strategien, Kosten, Portfolios, Limits und Arena-Regeln von `OFFICIAL_V1`
>   sind unverändert. Der Trading-Worker ist nicht betroffen (0 Neustarts).

## 1 Ursache

- `loadPerformanceReport()` in `analyzeCryptoSignals` (und gleich in
  `analyzeEquitySignals`) las mit `paperSignalEvaluation.findMany()` die ganze
  Tabelle: 398 625 Zeilen mit allen Spalten, je Lauf, alle 15 Minuten. Die
  Tabelle wächst um rund 18 000 Zeilen pro Woche.
- Nachgestellt mit dem VPS-Dump vom 2026-11-24 03:00 UTC:
  - direkt nach dem Laden 2 036 MB Heap und 4,3 GB RSS;
  - der unveränderte Job bricht mit 2 000 MB Heap-Limit mit derselben Meldung
    ab (`Reached heap limit Allocation failed`).
- Das Node-Limit auf dem VPS (8 GB RAM) liegt bei rund 2 GB. Ab 2026-11-20
  reichte der Platz nicht mehr immer, mit jedem Tag seltener.
- Mehr Heap wäre keine Lösung: Mit 4 GB Heap läge der Prozess bei 5 GB RSS und
  gefährdete PostgreSQL und den Trading-Worker auf demselben Host.

## 2 Warum niemand alarmiert wurde

| Prüfung | Warum sie grün blieb |
|---|---|
| `healthcheck.sh` | prüfte nur „läuft der Container“. Docker startet ihn nach einem Absturz in etwa einer Sekunde neu |
| `watch` / `opsHealth` | überwacht `fetchCryptoCandles` und `calculateMarketRegime`. Beide laufen **vor** dem Absturz und waren erfolgreich. `analyzeCryptoSignals` fehlte in der Liste |
| Fehlerprotokoll | Ein Heap-Abbruch beendet den Prozess ohne Ausnahme. Der Lauf bleibt als `RUNNING` stehen, es gibt keinen `FAILED`-Eintrag |

## 3 Datenlücke (belegt bis 2026-11-24 09:31 UTC)

79 Abstürze, 79 abgebrochene Analyseläufe (Docker-Zähler und `BotRun` stimmen
überein):

| Tag (UTC) | Läufe | abgebrochen | davon zur vollen Stunde |
|---|---|---|---|
| 2026-11-20 | 96 | 1 | 0 |
| 2026-11-21 | 96 | 1 | 0 |
| 2026-11-22 | 96 | 10 | 1 |
| 2026-11-23 | 96 | 40 | 13 |
| 2026-11-24 bis 09:31 | 38 | 27 | 8 |

**Wirkung auf `OFFICIAL_V1`:** Die Bewertung um hh:05 braucht ein 1h-Signal aus
der Stunde nach Kerzenschluss. Brach der Lauf zur vollen Stunde ab, fehlte es;
beide Teilnehmer lehnten mit `SIGNAL_NOT_ANCHORED_TO_CANDLE` ab (je
**22 von 963** Bewertungen):

- 2026-11-22: 12
- 2026-11-23: 06, 08, 10, 11, 12, 13, 15, 17, 19, 20, 21, 22, 23
- 2026-11-24: 01, 03, 04, 05, 06, 07, 08, 09

(jeweils Stunde der Bewertung, hh:05 UTC)

**Einordnung:**

- Das crypto-native Regime stand in allen 22 Stunden auf `RISK_OFF` (seit
  2026-11-13 00:00). Beide Strategien verlangen `RISK_ON`. Ein Handel war in
  diesen Stunden ausgeschlossen, das Ergebnis (0 Trades) ist unverändert.
- Die 22 Bewertungen sagen nur „Signal fehlte“. Für sie liegen **keine**
  Ablehnungsgründe der Strategie vor. Auswertungen über Ablehnungsgründe müssen
  sie als fehlend führen, nicht als abgelehnt.
- Kerzen und Regime sind lückenlos (960 von 960 Stundenkerzen BTC/ETH).
- In abgebrochenen Läufen entstanden außerdem keine Signale, Paper-Evaluations
  und Signal-Alerts der übrigen Symbole.
- Ohne Korrektur wäre der Test bei `RISK_ON` in den meisten Stunden blind.

**Andere Forward-Beobachtungen** laufen getrennt vom VPS und sind nicht
betroffen.

## 4 Korrektur

- **Aggregation in PostgreSQL** (`packages/performance-intelligence/src/paper-aggregate.ts`):
  eine Abfrage, ein sequenzieller Durchlauf, rund 40 Ergebniszeilen. Beide
  Analysejobs und die drei API-Routen `/paper/stats`, `/performance/report`,
  `/performance/buckets` nutzen sie. Die API hatte denselben Fehler: Das Öffnen
  der Performance-Seite lud dieselbe Tabelle in den API-Prozess.
- **Wertgleichheit:** Fließkommasummen hängen von der Reihenfolge ab. Die
  Abfrage hält die Reihenfolge der alten Abfrage fest (kein Parallelplan, kein
  Index, keine Sortierung, nur transaktionslokale Schalter), ordnet Gruppen nach
  ihrem ersten Auftreten und überträgt Summen als Text, weil Prisma Zahlen auf
  16 Stellen rundet.
- **Healthcheck und Alarm** (`scripts/ops/_worker-health.sh`, nur Host-Skripte,
  kein neues Trading-Worker-Image):
  - `CONTAINER_CRASH_RESTART`: Docker-Neustart nach Absturz in den letzten 60 min;
  - `SIGNAL_ANALYSIS_ABORTED`: mehr als ein nicht erfolgreicher Lauf in 2 h;
  - `SIGNAL_ANALYSIS_STALE`: letzter Erfolg älter als 75 min;
  - `SIGNAL_ANALYSIS_UNKNOWN`: Status nicht lesbar.
  - Meldung über den vorhandenen `watch`-Weg nach n8n, Drosselung 6 h je Meldungsart.
    Am 2026-11-20 07:16 UTC hätte das beim ersten Absturz alarmiert.

## 5 Nachweise (lokal, Wegwerf-Datenbank mit dem VPS-Dump)

| Prüfung | alt | neu |
|---|---|---|
| Bericht über 398 625 Zeilen | 11–15 s, 2 036 MB Heap | 0,5 s, 10 MB Heap, **bytegleich** |
| `analyzeCryptoSignals`, gleiche Daten und Uhrzeit | 10,7 s, bei 2 000 MB Abbruch | 0,9 s, 22 MB Heap; 27 Signale, 27 Ausgaben, 27 Regelanwendungen und alle Alert-Zustände **identisch** |
| 96 Läufe hintereinander (ein Tag) bei 256 MB Limit | – | 96/96 erfolgreich, 8 MB nach GC |
| 1,6 Mio. Zeilen (vierfach) | – | 10/10 erfolgreich, 2,3 s, 30 MB Spitze |
| 16 API-Aufrufe | bis 6,7 GB RSS | 102 MB RSS, **14 bytegleich**; Ausnahmen `assetType` und Zeitraum `from`/`to`, siehe unten |

### Abweichungen bei zwei Anzeigefiltern

`GET /performance/report` liefert mit `assetType` oder mit einem Zeitraum
(`from`/`to`) nicht bitgleiche Mittelwerte. Ursache ist beide Male die
Summierreihenfolge, die früher vom Ausführungsplan abhing.

| | `assetType` | `from`/`to` |
|---|---|---|
| alter Plan | Join, parallel | Index auf `openedAt`, abhängig von Statistik und Zeitraum |
| alter Wert fest? | **nein**: zwei identische Aufrufe unterschieden sich in 235 von 285 Zahlen (bis 6,2e-14) und in der Reihenfolge zweier punktgleicher Status-Gruppen | nur solange der Plan gleich bleibt; mit sequenziellem Plan andere Werte (226 von 283, bis 9,7e-14) |
| neuer Wert | Filter im Scan, immer gleich; für `CRYPTO` (alle 398 625 Zeilen) bytegleich mit dem ungefilterten Bericht | immer gleich; **bytegleich mit der alten Logik bei sequenziellem Plan** |
| größter relativer Abstand alt/neu | 7,3e-13 | 9,7e-14 |

In beiden Fällen gilt:

- **Trefferquoten, Anzahlen, Konfidenzklassen, Texte und die Reihenfolge der
  Signaltypen, Zeitebenen und Assets sind identisch.** Die Trefferquote ist ein
  Quotient ganzer Zahlen und hängt nicht von der Reihenfolge ab.
- **Kein Aufrufer:** Das Dashboard ruft die Route ohne Parameter auf
  (`apps/dashboard/src/app/dashboard/performance/page.tsx`). Im Repository gibt
  es keinen weiteren Aufruf.
- **Keine Wirkung auf Handel, Risiko oder Leistungsbewertung:** Beide
  Analysejobs laden ohne Filter (bytegleich). Trading-Worker, Strategie-, Risk-
  und Arena-Code importieren diesen Weg nicht; sie nutzen nur
  `performance-intelligence/shadow`, das unverändert ist.
- Tests sichern Reihenfolge, Plan, Filterwirkung und Parameterbindung ab.

**Korrektur:** Ein früherer Zwischenbericht nannte 15 bytegleiche Aufrufe. Die
Vergleichsausgabe war abgeschnitten; richtig sind 14.

## 6 Deployment-Plan (vorbereitet, Freigabe nötig)

Grundsätze: Runbook 18 § 2a, nur `worker-scheduler`, immer `--no-deps`.
Trading-Worker, API, Dashboard, PostgreSQL und Redis werden nicht neu erstellt;
`TRADING_CODE_VERSION` bleibt `02f4362`. Keine Migration, keine Env-Änderung,
`docker-compose.prod.yml` ist unverändert.

Der laufende Daten-Worker stammt aus `16d6d0f`. Bis `main` änderte sich in seinem
Abhängigkeitsbaum nur `packages/risk-engine` (Sicherheits-Hotfix `02f4362`). Es
gelangt über `shadow-replay` ins Image, das nur das Testwerkzeug
`src/dev/syntheticFeed.ts` nutzt; der Scheduler lädt es nicht.

### 6.1 Rollback-Image (erledigt am 2026-11-24, 10:26 UTC)

- Tag `signalpilot-worker-scheduler:rollback-7d3e1773` (= laufendes Image).
- `/root/signalpilot-rollback-images/signalpilot-worker-scheduler-7d3e1773.tar`,
  151 MB, sha256 `b4619f02…f70611f`; Kopie auf dem Mac mit gleicher Prüfsumme,
  dort geladen und geprüft (amd64, alter Code enthalten).
- Das Tar ist nötig: Der nächtliche `docker image prune -af` löscht ungenutzte
  Images trotz Tag.

### 6.2 Vorbedingungen (alle müssen gelten, sonst kein Start)

| Nr. | Bedingung |
|---|---|
| V1 | Commit ist auf `origin/main`, GitHub-CI grün |
| V2 | VPS-Checkout sauber auf `main` = `a9baa2c`, keine Stashes |
| V3 | beide Sessions `SHADOW_ACTIVE`, Kill Switch aus, keine offenen Orders oder Positionen, keine kritischen Risk-Events |
| V4 | `consistency-snapshot` geschrieben; Backup von heute vorhanden |
| V5 | Platte > 20 GB frei; verfügbarer Speicher > 4 GB unmittelbar vor dem Build |
| V6 | Rollback-Tar vorhanden, Prüfsumme stimmt |

### 6.3 Ablauf

Zeitfenster: Beginn **hh:02**, weil der alte Worker um hh:00, hh:15, hh:30 und
hh:45 bis zu 4 GB belegt. Build fertig bis hh:12, sonst abbrechen.

```bash
# 1  Mac: exakter Export des Commits auf main
git archive --format=tar --prefix=signalpilot-<sha>/ -o signalpilot-<sha>.tar <sha>
scp signalpilot-<sha>.tar root@<vps>:/root/

# 2  VPS: Inhalt prüfen, auspacken
git get-tar-commit-id < /root/signalpilot-<sha>.tar          # muss <sha> sein
tar -xf /root/signalpilot-<sha>.tar -C /opt/signalpilot-releases
tar -df /root/signalpilot-<sha>.tar -C /opt/signalpilot-releases   # keine Ausgabe

# 3  Host-Skripte (Alarm) aktivieren; kein Container wird berührt
cd /opt/signalpilot && git fetch origin && git merge --ff-only origin/main
./scripts/ops/healthcheck.sh      # muss jetzt CONTAINER_CRASH_RESTART melden
                                  # = Nachweis des Alarms am echten Fehler

# 4  Build nur des Daten-Workers (hh:02)
cd /opt/signalpilot-releases/signalpilot-<sha>
docker compose --project-name signalpilot --env-file /opt/signalpilot/.env.production \
  -f docker-compose.prod.yml build worker-scheduler

# 5  Probe im neuen Image, nur lesend, ohne den Scheduler zu starten
cd /opt/signalpilot
docker compose --project-name signalpilot --env-file .env.production -f docker-compose.prod.yml \
  run --rm --no-deps -T worker-scheduler node --max-old-space-size=256 --input-type=module -e '
import { prisma } from "@signalpilot/database";
import { loadPaperPerformanceAggregate } from "@signalpilot/performance-intelligence/paper-aggregate";
const t = performance.now(); const a = await loadPaperPerformanceAggregate(prisma);
const n = await prisma.paperSignalEvaluation.count();
console.log(a.overall.total, n, Math.round(performance.now() - t) + "ms", Math.round(process.memoryUsage().rss / 2 ** 20) + "MB");
process.exit(a.overall.total === n ? 0 : 1);'

# 6  Trockenlauf: darf ausschließlich worker-scheduler neu erstellen
docker compose --project-name signalpilot --env-file .env.production -f docker-compose.prod.yml \
  -f docker-compose.prod.override.yml up --dry-run -d --no-deps worker-scheduler

# 7  Umschalten zwischen hh:06 und hh:13 (nach der Bewertung um hh:05)
./scripts/ops/prod-up.sh --no-deps worker-scheduler
```

### 6.4 Abnahme

| Zeitpunkt | Prüfung | Soll |
|---|---|---|
| + 2 min | Container | läuft, `RestartCount` 0, fünf Scheduler gestartet, kein `FATAL` |
| + 2 min | übrige Container | Image-ID und `StartedAt` von Trading-Worker, API, Dashboard, PostgreSQL, Redis unverändert |
| nächster Lauf (hh:15) | `analyzeCryptoSignals` | `SUCCESS`, Dauer unter 60 s, 27 Signale wie zuvor |
| + 1 h | vier Läufe | 4 von 4 `SUCCESS`; Spitze des Containers unter 400 MB |
| nächste hh:05 | Bewertung | genau eine je Teilnehmer, **ohne** `SIGNAL_NOT_ANCHORED_TO_CANDLE` |
| + 1 h | Trading | `consistency-compare` grün, Sessions unverändert |
| + 2 h | `healthcheck.sh` | alles PASS; `watch` ohne Container-Problem |
| + 24 h | Dauerlauf | 96 von 96 Läufen, `RestartCount` 0, kein Speicheranstieg |

### 6.5 Abbruchkriterien

**Vor dem Umschalten abbrechen** (Produktion bleibt wie sie ist):

- eine Vorbedingung fehlt;
- Build nicht bis hh:13 fertig oder verfügbarer Speicher fällt unter 1 GB;
- Probe (Schritt 5): Fehler, Anzahl ungleich, länger als 10 s oder über 300 MB;
- Trockenlauf nennt einen anderen Container als `worker-scheduler`.

**Nach dem Umschalten zurückrollen**, sobald eines eintritt:

- `RestartCount` > 0 oder `FATAL` in den ersten 60 min;
- zwei Analyseläufe in Folge nicht `SUCCESS`, oder ein Lauf über 120 s;
- Container über 800 MB;
- `fetchCryptoCandles` oder `calculateMarketRegime` schlägt fehl, oder eine
  BTC-/ETH-Stundenkerze fehlt;
- ein anderer Container wurde neu erstellt oder neu gestartet;
- `ERROR_LOCKED`, Kill Switch, kritisches Risk-Event oder `consistency-compare`
  nicht grün.

### 6.6 Rollback (unter 2 min)

```bash
docker image inspect signalpilot-worker-scheduler:rollback-7d3e1773 >/dev/null 2>&1 ||
  docker load -i /root/signalpilot-rollback-images/signalpilot-worker-scheduler-7d3e1773.tar
docker tag signalpilot-worker-scheduler:rollback-7d3e1773 signalpilot-worker-scheduler:latest
cd /opt/signalpilot && ./scripts/ops/prod-up.sh --no-deps worker-scheduler
```

Der Daten-Worker stürzt danach wieder ab wie bisher; der Trading-Worker ist
nicht betroffen. Die Host-Skripte bleiben, sie melden den Zustand korrekt.

### 6.7 Danach

- Änderungsprotokoll von `OFFICIAL_V1`: Ende der Störung, Commit, Image-ID.
- **Stufe 2, eigene Freigabe:** `api` nach demselben Muster (eigenes
  Rollback-Image, `consistency-snapshot`/`-compare`).
- Hinweis zur Auswertung: In den abgebrochenen Läufen entstanden keine
  Paper-Evaluations. Die Performance-Statistik der Signalregeln hat für diese
  Stunden dauerhaft weniger Zeilen; sie wird nicht aufgefüllt.
