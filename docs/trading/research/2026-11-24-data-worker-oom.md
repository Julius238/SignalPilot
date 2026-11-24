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

## 6 Deployment (Vorschlag, Freigabe nötig)

Vorgehen nach [Runbook 18](../18-vps-24-7-shadow-runbook.md) § 2a, jeweils mit
Rollback-Tag und `docker save` vorher:

1. Commit nach `main` (CI grün), dann `git archive` dieses Commits.
2. **Stufe 1:** nur `worker-scheduler` bauen und mit `--no-deps` ersetzen. Der
   laufende Stand ist `16d6d0f`. Bis `main` änderte sich im Baum des
   Daten-Workers nur `packages/risk-engine` (Sicherheits-Hotfix `02f4362`). Es
   gelangt über `shadow-replay` ins Image, das nur das Testwerkzeug
   `src/dev/syntheticFeed.ts` nutzt; der Scheduler lädt es nicht.
3. VPS-Checkout per `git pull --ff-only` nachziehen: Host-Skripte für
   `healthcheck` und `watch` sind damit aktiv, ohne Neustart.
4. Prüfen: vier Läufe `analyzeCryptoSignals` `SUCCESS`, Speicher des Containers
   unter 300 MB, keine Neustarts, nächste hh:05-Bewertung ohne
   `SIGNAL_NOT_ANCHORED_TO_CANDLE`, `consistency-compare` grün.
5. **Stufe 2 (später, getrennt):** `api` ersetzen.
6. Trading-Worker, PostgreSQL und Redis bleiben unberührt;
   `TRADING_CODE_VERSION` bleibt `02f4362`.

Rollback: altes `worker-scheduler`-Image zurück auf `:latest` taggen und
`prod-up.sh --no-deps worker-scheduler`. Das alte Image stürzt dann wieder ab.
