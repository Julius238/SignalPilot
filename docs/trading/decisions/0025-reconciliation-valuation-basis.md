# ADR 0025 – Reconciliation und Positionsmonitor bewerten auf verschiedenen Kerzen (N3)

- Status: Proposed
- Datum: 2026-10-19
- Entscheidung: Betreiber (offen)
- Bezug: ADR 0004, ADR 0022 (Entwurf), ADR 0024 ·
  [Dokument 06](../06-risk-engine-specification.md) („Portfolio-Konsistenz
  und Toleranz“) · [Hotfix-Bericht](../research/2026-10-19-official-v1-security-hotfix.md),
  Abschnitt 6.1

> **Nur Analyse und Entwurf.** Kein Produktivcode ist geändert, auf dem VPS
> wurde nichts ausgeführt. Der Branch `claude/n3-reconciliation-race-draft`
> baut auf `hotfix/official-v1-security` (`961dafc`) auf. Zeilenangaben
> beziehen sich auf diesen Stand. Die betroffenen Stellen sind in `16d6d0f`
> gleich.

## Kurzantwort

- **Befund:** Der Equity-Cache trägt den Mark der letzten Buchung. Die
  Reconciliation bewertet mit der neuesten geschlossenen Kerze. Liegt eine
  Kerze vor, die noch niemand gebucht hat, meldet sie
  `PORTFOLIO_EQUITY_MISMATCH`, obwohl Ledger und Portfolio stimmen.
- **Folge:** Ein CRITICAL-`RiskEvent`, Session und Portfolio `ERROR_LOCKED`
  ohne Rückweg im Code, der ENTRY-Breaker offen (24 h, solange nicht
  quittiert), Hard Stop in der Arena. Exits laufen weiter.
- **Betroffen** ist jede offene Position, nicht nur der Fall aus ADR 0024.
  OFFICIAL_V1 hatte noch nie eine. Der erste Trade kann die Sperre auslösen.
- **Empfehlung: Option S.** Die Reconciliation liest aus einem einheitlichen
  Snapshot und prüft gegen den gebuchten Bewertungsstand statt gegen die
  neueste Kerze, bei unveränderter Toleranz. Echte Abweichungen sperren
  weiter. Geändert wird nur `shadowReconciliation.ts`, dazu ein optionaler
  Parameter der Bewertung. Risk Engine, Strategien und Schema bleiben, wie
  sie sind.

## 1. Warum zwei Bewertungsstände entstehen

Die Prüfung (`packages/portfolio/src/invariants.ts:101-104`) verlangt
`cache.equity = cache.availableCash + cache.reservedCash + Marktwert`, mit
der Toleranz 1e-8. Den Marktwert berechnet `loadShadowPortfolioValuation`
mit der neuesten 1h-Kerze, deren `closeTime ≤ asOf` ist
(`shadowPortfolioValuation.ts:77-84`).

| Schreiber von `Portfolio.equity` | Bewertet mit | Setzt den Monitor-Cursor (`lastProcessedCandleId`) |
|---|---|---|
| Entry-Fill (`shadowFillPersistence.ts:986-1003`) | neueste Kerze zum Fill-Zeitpunkt | Fill-Kerze |
| Monitor ohne Trigger (`shadowPositionMonitor.ts:851-889`) | neueste Kerze zum Laufzeitpunkt | verarbeitete Kerze |
| Monitor-Exit (`:782-800`) | neueste Kerze | verarbeitete Kerze |
| Tagesstart (`shadowTradingDay.ts`) | neueste Kerze um 00:05 | – |
| Reserve, Ablauf, Freigabe | Equity unverändert (Cash wandert nur zwischen `available` und `reserved`) | – |
| **Reconciliation** (`shadowReconciliation.ts:163-178`) | **neueste Kerze zum eigenen Zeitpunkt** | – |

Der Cache ist also auf die neueste Kerze **zum Zeitpunkt seiner letzten
Buchung** bewertet. Die Reconciliation bewertet mit der neuesten Kerze **zu
ihrem eigenen Zeitpunkt**. Dazwischen kann der Daten-Worker eine Kerze
schreiben. Für diese Lücke gibt es zwei Ursachen:

1. **Keine Ordnung.** Monitor (`*/2`) und Reconciliation (`*/4`) haben je
   einen eigenen `cron.schedule` und eigene Leases (`scheduler.ts:249-257`).
   Um :00, :04, :08 … starten sie gleichzeitig.
2. **Kein gemeinsamer Lesezeitpunkt.** Die Reconciliation liest Portfolio,
   Positionen, Kerzen und Ledger in getrennten Abfragen ohne Transaktion
   (`:82-127`, `:163`). Ein Monitor-Commit dazwischen ergibt einen
   gemischten Stand.

Daneben gilt: Der Cache ist nicht immer auf dem Cursor bewertet. Ein
verspäteter Fill oder ein Monitor mit Rückstand bewertet mit einer neueren
Kerze als der, die er als verarbeitet markiert (R4, R5 unten).

## 2. Reihenfolgen, die einen falschen Befund erzeugen

Synthetisch geprüft gegen `961dafc`, mit In-Memory-Prisma. Die Probe ist
nicht committet. „Basis“ heißt: die Kerze, deren Bewertung den Cache exakt
reproduziert.

| Fall | Ablauf | Basis / Cursor | Heute |
|---|---|---|---|
| R1a | C2 kommt, die Reconciliation läuft vor dem Monitor | C1 / C1 | **Mismatch, Sperre** |
| R1b | C2 kommt, der Monitor bucht vor der Reconciliation | C2 / C2 | konsistent |
| R2 | Die Reconciliation liest den Cache (Basis C2), dann bucht der Monitor C3, dann liest sie Positionen und Kerzen | C2 / C3 | **Mismatch** (gemischter Stand) |
| R3 | Monitor gestoppt (Breaker, Lease, Fehler, Neustart), drei Kerzen kommen | C1 / C1 | **Mismatch bei jedem Lauf** |
| R4 | Fill-Job hinkt nach: Fill auf C1, C2 ist schon sichtbar. Danach kommt C3 | C2 / C1 | **Mismatch** |
| R5 | Monitor arbeitet einen Rückstand ab: verarbeitet C2, bewertet mit C3. Danach kommt C4 | C3 / C2 | **Mismatch** |
| R6 | Die Reconciliation committet zwischen Lesen und Schreiben des Monitors | – | Monitor bricht ab („version conflict“), BotRun `FAILED`, nächster Lauf holt nach |

Nach ADR 0024 gilt dasselbe für eine Position, die der Ablauf geöffnet hat:
Basis C1, Cursor C1, die Ablaufkerze C2 ist sichtbar.

**Wie wahrscheinlich ist das auf dem VPS?** Das hängt davon ab, wann der
Daten-Worker die BTCUSDT-1h-Kerze schreibt. Erscheint sie um hh:00 wenige
Sekunden nach der Stunde, bucht der Monitor sie um hh:02, vor der
Reconciliation um hh:04. Kritisch sind spätere Schreibzeitpunkte in einem
Fenster (hh:02, hh:04], (hh:10, hh:12] usw., Neustarts (R3) und
Nachholläufe (R4, R5). Die Verteilung lässt sich lesend messen
(`Candle.createdAt − closeTime`, BotRun-Zeiten). Dafür braucht es eine eigene
Freigabe. Eine offene Position bleibt bis zu 72 Stunden, das sind bis zu 72
Gelegenheiten.

Abfrage für F3, nicht ausgeführt. Sie liest nur und schreibt nichts:

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- Minute der Stunde, in der BTCUSDT-1h-Kerzen geschrieben wurden, seit dem Forward-Start
SELECT extract(minute FROM c."createdAt")::int AS minute_written,
       count(*) AS candles,
       min(extract(epoch FROM c."createdAt" - c."closeTime"))::int AS min_delay_s,
       max(extract(epoch FROM c."createdAt" - c."closeTime"))::int AS max_delay_s
FROM "Candle" c
JOIN "Asset" a ON a."id" = c."assetId"
WHERE a."symbol" = 'BTCUSDT' AND c."timeframe" = '1h'
  AND c."closeTime" >= TIMESTAMPTZ '2026-10-15 07:32:00+00'
GROUP BY 1 ORDER BY 1;
ROLLBACK;
```

Kritisch sind Zeilen mit `minute_written` 2–3, 6–7, 10–11 usw. (also vor einer
gemeinsamen Minute von Monitor und Reconciliation) und große
`max_delay_s`.

**Verwandt, nicht Teil dieser Entscheidung:**

- **N3b:** R-003 in der Risk Engine (`rules.ts:370-383`) prüft dieselbe
  Gleichung. Der Assembler übergibt den gecachten Equity-Wert und frische
  Marks (`riskInputAssembler.ts:254-278`). Bei offener Position kann ein
  Candidate deshalb zusätzlich an R-003 scheitern. Folge: ein weiteres
  CRITICAL-Event. Den ENTRY-Breaker öffnet es nicht (`RISK_RULE_BLOCK`),
  gesperrt wird nicht (ADR 0022). In OFFICIAL_V1 lehnt R-022 einen solchen
  Candidate ohnehin ab. Eine Korrektur gehörte in den Assembler und würde
  Risk-Inputs ändern. Das ist eine eigene Entscheidung.
- **N3c:** R6. Selten, selbstheilend. Den MONITORING-Breaker öffnen erst drei
  aufeinanderfolgende Fehlläufe.

## 3. Anforderungen

- Keine höhere Toleranz, die Reconciliation bleibt an, kein RiskEvent wird
  unterdrückt.
- Echte Ledger- und Portfoliofehler sperren weiter, wie heute.
- Risk Engine, Strategien, Kosten- und Risikowerte bleiben unverändert. Keine
  Migration.
- Jeder Reconciliation-Lauf weist aus, gegen welchen Bewertungsstand er
  geprüft hat.

## 4. Optionen

### Option S – gebuchter Bewertungsstand aus einem Snapshot (empfohlen)

1. **Ein Lesezeitpunkt.** Alle Lesezugriffe der Reconciliation laufen in
   einer Transaktion `REPEATABLE READ`: Portfolio, Positionen, Orders, Fills,
   Ledger, Kerzen, Profile. Jeder Schreiber bucht Cursor und Equity in einer
   Transaktion. Damit sieht die Reconciliation entweder beides alt oder beides
   neu (behebt R2). Die Schreibphase (Sperre oder `lastReconciledAt`) bleibt
   wie heute.
2. **Gebuchter Stand statt neuester Kerze.** Der Cache ist zulässig, wenn er
   exakt (Toleranz 1e-8 wie bisher) der Bewertung zu einem Stand entspricht,
   den das System tatsächlich gesehen haben kann. Für jede offene Position
   liegt dieser zwischen ihrem Cursor und der neuesten sichtbaren Kerze:
   - Kandidaten je Position sind die 1h-Kerzen ihres Assets mit
     `closeTime ≥ closeTime(Cursor)` und `closeTime ≤ asOf`.
   - Die Stände werden in der Reihenfolge erzeugt, in der die Kerzen
     sichtbar wurden (`createdAt`). Begonnen wird mit allen Cursorn, jede
     neue Kerze rückt ihre Position vor. Der letzte Stand ist die heutige
     Prüfung. Bei einer Position pro Portfolio (OFFICIAL_V1) sind das meist
     ein bis zwei Stände.
   - Passt keiner, gilt `PORTFOLIO_EQUITY_MISMATCH` mit Sperre wie heute.
   - Untergrenze ist der Cursor, weil jeder Schreiber mindestens mit der
     Kerze bewertet, die er als verarbeitet markiert (Tabelle in Abschnitt 1).
     Obergrenze ist die neueste sichtbare Kerze, weil Kerzen nur hinzukommen.
3. **Nachvollziehbar.** Das Audit `SHADOW_RECONCILE_SUCCESS` bekommt im
   `afterState` den gefundenen Stand je Position (Kerzen-ID, `closeTime`)
   und die Zahl der noch nicht gebuchten Kerzen. Ein Mismatch nennt die
   geprüften Stände.

Code: `shadowReconciliation.ts` und ein optionaler Parameter
`markCandleByPositionId` in `loadShadowPortfolioValuation`. Ohne ihn
verhält sich die Funktion wie heute, für Risk, Arena, Fill und Monitor ändert
sich also nichts. Geschätzt 120–180 Zeilen plus Tests.

### Option C – überall mit dem Cursor bewerten

Alle Schreiber und die Reconciliation bewerten jede Position mit ihrem
Cursor. Das ist am saubersten, ändert aber Equity-Werte in Fill, Monitor und
Tagesstart. Damit verschieben sich Tages-P&L, Kill-Switch und Equity-Punkte in
den Fällen R4 und R5, also beobachtbares Verhalten des Forward-Tests. Das
gehört in eine spätere Version, nicht in einen Bugfix.

### Option P – Bewertungsstand speichern

Jeder Schreiber speichert die Mark-Kerze je Position, die Reconciliation
prüft genau diese. Das ist exakt, braucht aber eine Migration. Verworfen für
den Hotfix-Rahmen, als langfristige Variante möglich.

### Option D – Equity-Prüfung bei offenem Mark aufschieben

Ist eine Kerze ungebucht, entfällt in diesem Lauf die Equity-Prüfung, und
`lastReconciledAt` wird nicht gesetzt. Das ist einfach, lässt aber Läufe ohne
Equity-Prüfung zu. Hängt der Monitor (R3), wird nie geprüft. Gegenüber S
schwächer.

### Verworfen

- **Höhere Toleranz:** verdeckt echte Abweichungen, vom Betreiber
  ausgeschlossen.
- **Nur gegen den Cursor prüfen:** erzeugt in R4 und R5 neue falsche Befunde.
  Das präzisiert die erste Lösungsrichtung aus dem Hotfix-Bericht,
  Abschnitt 6.1.
- **Die Reconciliation schreibt den Mark selbst:** Sie würde den Cache aus
  der Projektion überschreiben, das verbietet ADR 0004.
- **Nur Scheduler-Reihenfolge erzwingen:** hilft nicht, wenn die Kerze nach
  dem Monitor-Lauf kommt (R1a), und nicht bei R3 bis R5.

## 5. Echte Fehler werden weiter erkannt

| Fehler | Erkannt durch | mit S |
|---|---|---|
| Cash, Reserve, realisierter P&L, Gebühren weichen vom Ledger ab | Ledger-Replay, unabhängig vom Mark | unverändert, sperrt |
| Reservierungssumme, Ledger-Sequenz, verwaiste Referenzen, doppelte Scopes, Richtung, Collateral | eigene Invarianten | unverändert, sperrt |
| `equity` manipuliert oder falsch berechnet | Equity-Invariante | sperrt, denn kein zulässiger Stand trifft den Wert exakt |
| Positionsmenge (bei SHORT auch Einstandspreis) nach der letzten Buchung verändert | Equity-Invariante | sperrt wie heute, denn die Bewertung mit den geänderten Werten trifft den Cache nicht. Der LONG-Einstandspreis geht in die Equity nicht ein, also auch heute nicht |
| Kerze nachträglich geändert (Datenkorrektur) | Equity-Invariante | sperrt wie heute |
| Monitor bucht nicht mehr (R3) | `POSITION_MONITOR_STALE` (Alert) | **keine Sperre** durch die Reconciliation. Das ist ein Ausfall, kein Ledgerfehler, und er wird im Audit als offene Kerzen ausgewiesen |

Den letzten Punkt muss der Betreiber bewusst entscheiden. Heute sperrt ein
hängender Monitor die Session indirekt über den Mismatch. Mit S bleibt der
Alert, die Session nicht.

## 6. Regressionstests (bei Umsetzung)

Synthetisch, In-Memory. Für die Snapshot-Garantie zusätzlich ein DB-Test, der
in CI läuft.

1. R1a: Reconciliation vor dem Monitor → konsistent, Stand C1, eine offene
   Kerze. Heute: Sperre.
2. R1b: Monitor vor der Reconciliation → konsistent, Stand C2. Gleiche Zeilen
   wie heute.
3. R2: Monitor-Commit zwischen den Lesezugriffen → konsistent. DB-Test mit
   zwei Verbindungen; im Fake prüft ein Spy, dass alle Lesezugriffe in einer
   `REPEATABLE READ`-Transaktion liegen.
4. R3: drei offene Kerzen → konsistent, Audit weist 3 offene Kerzen aus. Die
   Sperre unterbleibt, der Alert `POSITION_MONITOR_STALE` bleibt.
5. R4, verspäteter Fill → konsistent, Stand C2.
6. R5, Monitor-Rückstand → konsistent, Stand C3.
7. ADR-0024-Ablauf vor dem Monitor → konsistent.
8. SHORT: R1a und R4.
9. Zwei Positionen auf zwei Assets, Kerzen zu verschiedenen Zeiten →
   konsistent. Je ein manipulierter Wert → Sperre.
10. Echte Fehler mit offener Kerze: `equity` ±0,01, `availableCash` +1,
    `openQuantity` geändert → jeweils der bisherige Befund und die Sperre,
    in beiden Reihenfolgen.
11. Nachträglich geänderte Kerze im Fenster → Sperre.
12. Ohne offene Position und ohne offene Kerze: zeilengleich mit `961dafc`
    (Differenzlauf wie im Hotfix-Bericht).
13. Bewertung ohne den neuen Parameter: Risk-, Arena-, Fill- und
    Monitor-Pfade zeilengleich.

## 7. Wirkung auf OFFICIAL_V1

- Kein Trade, kein Exit, keine Risikoentscheidung ändert sich. Strategien,
  Gates, Arena-Policy und Risk Engine sind unberührt.
- Es entfallen falsche Sperren durch R1 bis R5. Echte Abweichungen sperren
  wie bisher.
- Neu ist nur der Bewertungsstand im Audit der Reconciliation.
- Bei hängendem Monitor sperrt die Reconciliation nicht mehr (Abschnitt 5).
- Einordnung: protokollierter Bugfix nach Regel 2, keine neue Version.

## 8. Zu entscheiden

- **F1:** Option S, C, P oder D.
- **F2:** Kommt die Korrektur vor dem ersten Deployment in den Hotfix (B),
  oder wird der Hotfix unverändert ausgerollt und N3 folgt getrennt (A)?
- **F3:** Soll die Schreibzeit der Kerzen auf dem VPS lesend gemessen
  werden? Das braucht eine Freigabe.
- **F4:** N3b (R-003) und N3c getrennt oder gar nicht behandeln?
