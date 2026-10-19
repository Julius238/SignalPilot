# OFFICIAL_V1 – Sicherheits-Hotfix auf `16d6d0f` (ADR 0021, 0023, 0024 K, 0025 N3)

- Stand: 2026-10-19, **lokal integriert**. Gepusht ist nur der Zwischenstand
  `961dafc`. Der integrierte Stand ist nicht gepusht und nicht deployt.
- Branch: `hotfix/official-v1-security`, Basis `16d6d0f` (deployter VPS-Stand)
- Bezug: [ADR 0021](../decisions/0021-risk-limit-set-value-integrity.md) ·
  [ADR 0023](../decisions/0023-execution-profile-value-integrity.md) ·
  [ADR 0024](../decisions/0024-opening-position-after-entry-expiry.md) ·
  [ADR 0025](../decisions/0025-reconciliation-valuation-basis.md) ·
  [Offizieller Forward-Test V1](official-forward-test-v1.md) ·
  Hotfix-Vorbereitung und VPS-Bericht vom 2026-10-18 auf
  `claude/risk-directive-enforcement-draft` (`bb912bf`)

> Auf dem VPS wurde nichts ausgeführt. Es gibt keinen Merge und keine
> Datenbankänderung außerhalb lokaler Wegwerf-Datenbanken. Alle Tests sind
> synthetisch.

## Kurzfassung

- **Geschlossen:**
  - manipulierte Risikolimits (ADR 0021);
  - manipulierte Ausführungsprofile (ADR 0023);
  - die Strandung einer teilgefüllten, abgelaufenen Entry-Order in `OPENING`
    (ADR 0024, Option K);
  - falsche Sperren durch den Wettlauf von Reconciliation und Monitor (N3,
    ADR 0025, Option C).
- **Nur diese Korrekturen.** Dazu kommt ein reiner Testfix (`4a9f4c6`), ohne
  den die CI schon auf `16d6d0f` rot war. Strategien, Gates, Arena,
  Portfolio-, Simulations- und Replay-Pakete, DB-Schema, Migrationen, API,
  Dashboard, Lockfile, Compose und CI-Workflow sind bitgleich mit `16d6d0f`.
- **Gleiches Verhalten bei gültiger Konfiguration.**
  - Ausführung: 10 von 12 synthetischen Szenarien schreiben zeilengleiche
    Daten wie `16d6d0f`. Die zwei Szenarien mit offener Position haben
    zusätzlich nur ein Audit-Feld.
  - Risk-Job: Die Entscheidungen sind gleich. Nur die Kennung `1.3.0 → 1.4.0`
    und die davon abgeleiteten Hashes ändern sich.
- **Tests:** 1 765 von 1 765 in 28 Paketen bestehen, mit einer isolierten
  PostgreSQL. Build, Lint und Ops-Skripte sind grün.
- **Offen vor dem ersten Trade:**
  - R-003 erzeugt im selben Wettlauf falsche CRITICAL-Ereignisse (N3b). Ein
    Vorschlag liegt vor, umgesetzt ist er nicht.
  - Unabhängig davon setzt R-022 die Arena bei offener Position auf Hard Stop.
    Das ist ein Altbefund (ADR 0022).
  - N2 ist nur analysiert.

## 1. Bestandsaufnahme

Alle Commits liegen im gemeinsamen Repository und sind erreichbar.

| Commit | Branch | Inhalt | Stand |
|---|---|---|---|
| `16d6d0f` | – | deployter OFFICIAL_V1-Build | Basis. CI-Run 38623043366 dort schon rot (Testschritt) |
| `fbe858c`, `da5dc66` | `claude/risk-limit-integrity-draft` | ADR 0021 Entwurf und Umsetzung | gepusht, CI 39146689971 grün; liegt hinter 61 Entwicklungs-Commits |
| `1290a25` | `claude/risk-directive-enforcement-draft` | ADR 0022, nur Analyse | nicht übernommen |
| `c08fc2c`, `bb912bf` | dito | lesende VPS-Prüfung, Bericht, Hotfix-Vorbereitung | nicht übernommen (nur Doku und SQL) |
| `228a8da`, `0c55e52` | `claude/execution-profile-integrity-draft` | ADR 0023 Entwurf und Umsetzung, auf `da5dc66` | lokal |
| `a0a3961` | `claude/opening-after-partial-expiry-draft` | ADR 0024 Entwurf und lesende SQL | lokal |
| `ed458eb`, `24552fd` | `claude/n3-reconciliation-race-draft` | ADR 0025 Entwurf und Umsetzung (N3) | lokal, per Fast-Forward übernommen |
| `4a9f4c6` | Entwicklungsstand | Schema-Test kennt die 24/7-Ops-Alarmtypen | als `ff78ead` übernommen |

Abhängigkeiten:
- ADR 0023 baut auf ADR 0021 auf.
- Option K nutzt den Helfer aus ADR 0023.
- N3 ändert die Bewertungsbasis der Equity-Schreiber und der Reconciliation.
  Die Integritätsmodule aus 0021 und 0023 und der K-Code bleiben
  unverändert.
- Die 61 Entwicklungs-Commits berühren weder `apps/trading-worker` noch
  `packages/risk-engine`.

## 2. Integrierte Commits

| Commit | Inhalt | Nachweis |
|---|---|---|
| `545f34e` | ADR 0021: `git diff fbe858c da5dc66 -- apps packages docs/06` plus ADR | Patch-sha256 `109551fd…` und Tree `5b23706a…` genau wie in `bb912bf` vorbereitet |
| `0e7d943` | ADR 0023: `git diff da5dc66 0c55e52` plus ADR | Trading-Worker, Risk Engine, Dokument 06 und beide ADRs bitgleich mit `0c55e52` |
| `fcfc965` | ADR 0024 Option K, Regressionstests, Korrektur des Test-Fakes, ADR 0024 mit lesender SQL | ADR 0024, „Umsetzung“ |
| `2d89170` | K-Test: Exit unter `ERROR_LOCKED` | – |
| `961dafc` | erster Stand dieses Berichts | gepusht, CI-Run 39277739973 (siehe 4.4) |
| `ed458eb` | ADR 0025, Entwurf zu N3 | nur Doku |
| `24552fd` | N3, Option C: gebuchte Bewertungsbasis, Snapshot-Reconciliation, 23 Tests | ADR 0025, „Umsetzung“ |
| `ff78ead` | `4a9f4c6` übernommen: erwartete Liste im Alert-Katalog-Test | eine Testdatei, 6 Zeilen. Die vier Typen stehen seit `49f6185` im Schema von `16d6d0f` |
| dieser Commit | dieser Bericht, aktualisiert | nur Doku |

## 3. Unterschiede zum deployten Stand `16d6d0f`

43 Dateien, alle in diesen Bereichen:

| Bereich | Dateien | Wirkung |
|---|---|---|
| Risk Engine (`packages/risk-engine/src`) | `limit-set-integrity.ts` (neu), `policy-v1.ts`, `rules.ts`, `index.ts` | R-026 prüft jedes Limit-Feld; Kennung `risk-rules-v1/1.4.0` |
| Trading-Worker, neu | `riskLimitSetIntegrity.ts`, `executionProfileIntegrity.ts` | gemeinsame Integritätsprüfungen |
| Trading-Worker, geändert | Jobs `shadowAssessRisk`, `shadowBootstrap`, `shadowExecutionProfileCalibrate`; Lib `riskInputAssembler`, `shadowEligibility`, `shadowFillPersistence`, `shadowOrderPersistence`, `shadowPortfolioValuation`, `shadowPositionMonitor`, `shadowReconciliation`, `shadowRiskPersistence`, `shadowSessionOps`, `shadowTradingDay` | 0021, 0023, K, N3 |
| Tests | Risk Engine, Trading-Worker (darunter ein neuer PostgreSQL-Test), Datenbank-Schema-Test | nur Tests |
| Doku und Ops | Dokumente 06 und 18, ADR 0021, 0023, 0024, 0025, dieser Bericht, `scripts/ops/opening-after-partial-expiry-check.sql` (nur lesend) | nichts davon läuft im Betrieb |

Bitgleich mit `16d6d0f`: `packages/strategy-engine`, `arena`, `shadow-replay`,
`portfolio`, `trading-simulation`, `trading-domain`, `market-regime`,
`database/prisma` und `database/src`, `apps/api`, `apps/worker`,
`apps/dashboard`, `pnpm-lock.yaml`, `docker-compose.prod.yml`, `.github`.
Einen Evolution-Worker gibt es auf `16d6d0f` nicht.

## 4. Tests

Alles lokal, ohne VPS. Isolierte PostgreSQL 16 im Scratchpad: Socket-Port
55432, eigene frische Datenbank, die 29 Migrationen von `16d6d0f`. Die
Dev-DB wurde nicht berührt.

### 4.1 Gesamtlauf wie in CI (integrierter Stand)

`pnpm install --frozen-lockfile`, `db:generate`, `db:migrate:deploy`,
`build`, `lint`, `ops:test:scripts`, `pnpm -r --no-bail test`: **alles grün,
1 765 von 1 765 Tests in 28 Paketen.** Auszug:

| Paket | Tests | Prüft unter anderem |
|---|---|---|
| Trading-Worker | 435/435, mit DB-Suiten | Integrität von Limits und Profilen, Teilfill und Ablauf (K), Stop und Exits unter Sperre, N3 in allen Reihenfolgen, Arena-, Lease- und JobRunner-DB-Tests |
| Risk Engine | 114/114 | Risikoentscheidungen, Positionsgrößen, R-026 |
| API | 193/193 | bindet den Trading-Worker ein |
| Arena | 16/16 | – |
| Shadow-Replay | 12/12 | – |
| Strategy Engine | 151/151 | Champion und Challenger |
| Portfolio, Simulation, Trading-Domain | 30, 32, 153 | – |
| Datenbank | 54/54 | mit `ff78ead` |

### 4.2 Gezielte Regressionstests

- **ADR 0024 (K):** 10 Fälle. Gegen den Code ohne K schlagen 7 fehl.
- **ADR 0025 (N3):** 21 Fälle im Speicher und 2 auf PostgreSQL.
  - Abgedeckt: alle sechs Scheduler-Reihenfolgen R1a–R6, der Ablauf nach
    ADR 0024, SHORT und zwei Assets.
  - Echte Abweichungen sperren weiter: Equity ±, Equity auf die neueste
    ungebuchte oder eine veraltete Kerze gesetzt, Cash, Reserve, Menge,
    geänderte Kerze, fremde Kerze, Collateral.
  - Ein Stop-Exit läuft unter der dadurch entstandenen Sperre.
  - Gegen `961dafc` schlagen 12 der 21 Fälle fehl.
  - Die Snapshot-Tests schlagen fehl, wenn die Reconciliation außerhalb des
    Snapshots liest.

### 4.3 Differenz gegen den alten Code und Deploy-Simulation

- **Ausführung:** dasselbe Szenario-Skript in `16d6d0f`, `961dafc` und im N3-Stand
  (der integrierte Hotfix ist in Trading-Worker, Risk Engine und API
  codegleich mit ihm).
  - 10 von 12 Normalszenarien sind zeilengleich, zwei unterscheiden sich nur
    im Audit-Feld `valuationBasis`.
  - Gewollte Unterschiede: Teilfill mit Ablauf (K) und zwei N3-Szenarien.
    Dort sperrte der alte Code fälschlich.
- **Risk-Job, 5 Fälle:** gegen `16d6d0f` nur Kennung und Hashes verschieden,
  gegen `961dafc` byte-gleich.
- **Deploy-Simulation:**
  - Runbook 18, Abschnitte 7–9, mit altem Code aufgebaut, danach
    `consistency-snapshot`.
  - Dann der neue Code: `consistency-compare` Exit 0, Arena-Ketten intakt.
  - Eligibility `EXECUTION_PROFILE` und `ACTIVE_RISK_LIMIT_SET` PASS.
  - Kalibrierung `UNCHANGED`, Reconciliation 3 von 3 konsistent, keine
    Sperre.

### 4.4 GitHub-CI

- **Run 39277739973 auf `961dafc`:** Install, Migrationen, Build, Lint und
  Ops-Checks sind grün, der Testschritt ist rot.
- **Ursache:** Logs und Job-Summary sind ohne Login nicht sichtbar. Schon
  `16d6d0f` scheiterte im selben Schritt (Run 38623043366). Lokal scheitert
  auf `961dafc` nur der Alert-Katalog-Test. `ff78ead` behebt ihn.
- Der integrierte Stand ist lokal vollständig grün. Ein Lauf auf GitHub steht
  noch aus.

## 5. Wirkung auf OFFICIAL_V1

1. **Kennung `risk-rules-v1/1.4.0`** in jeder Bewertung, dazu neue Hashes.
   Die Entscheidungen bleiben gleich.
2. **Neue Sperrpfade, nur bei abweichenden DB-Zeilen:** Limit-Set und
   Ausführungsprofil. Die VPS-Prüfung vom 2026-10-18 fand keine Abweichung.
3. **Exit und Bewertung** rechnen mit dem freigegebenen Profil. Bei den
   heutigen Zeilen ist das wertgleich.
4. **Eligibility** prüft strenger. Neu ist die erwartete Warnung
   `STRATEGY_VERSION_BUILD`.
5. **Kalibrierung** schreibt nur das freigegebene Profil.
6. **Option K:** Teilfill und Ablauf öffnen die Position, statt sie zu
   stranden.
7. **N3:**
   - Der Equity-Cache wird auf der gebuchten Kerze jeder Position bewertet.
   - Im Normalbetrieb ändert sich nichts. Bei Verzögerung hinkt er bis zum
     nächsten Monitorlauf hinterher.
   - Die Reconciliation sperrt nur noch bei echten Abweichungen.
   - Sie protokolliert die geprüfte Kerze.
   - Ein Lauf, während dessen der Monitor bucht, wird verworfen: kein Befund,
     keine Sperre, fehlgeschlagener BotRun.
   - Ein hängender Monitor sperrt nicht mehr; der Alert dafür bleibt.
8. **Rollout:** Trading-Worker- und API-Image neu bauen, denn die API bindet
   den Trading-Worker ein. Keine Migration, keine Datenänderung. Rollback
   über die Images `:16d6d0f`.

## 6. Offene Risiken

### 6.1 R-003 (N3b): falsche CRITICAL-Ereignisse im Risk-Job

- **Befund:**
  - Der Assembler übergibt den gecachten Equity-Wert (gebuchte Kerze) und
    Marks zur neuesten Kerze.
  - Am echten Assembler und an der echten Engine, mit offener Position und
    einer ungebuchten Kerze, gilt R-003 CRITICAL („Equity does not equal …“).
  - Mit gebuchter Kerze im Assembler besteht R-003. Die Probe-Änderung ist
    nicht committet.
- **Wann:** nur bei offener Position und nur, wenn der Risk-Job einen
  Candidate bewertet, bevor der Monitor die neue Kerze gebucht hat. Bei
  Kerzen um hh:00 und Candidates ab hh:05 ist das Fenster schmal. Nach Ausfall
  oder Rückstand ist es breit.
- **Wirkung in OFFICIAL_V1:**
  - Keine Entscheidung kippt, keine Sperre, kein Breaker.
  - Jeder Teilnehmer handelt nur BTCUSDT, und bei offener Position lehnt R-022
    jeden Candidate ohnehin ab.
  - Es entsteht ein zusätzliches CRITICAL-Ereignis `PORTFOLIO_INCONSISTENT`.
    Es sieht wie ein Integritätsalarm aus, löst einen Alert aus und zählt in
    der Arena.
- **Arena beim ersten Trade:**
  - Den Hard Stop `CRITICAL_RISK_EVENTS` löst schon R-022 aus. R-022 ist
    CRITICAL, und der Candidate-Scan läuft auch bei offener Position.
  - Er entsteht, sobald während der offenen Position ein Candidate bewertet
    wird. Das ist ein Altbefund aus der ADR-0022-Analyse und bleibt mit und
    ohne R-003-Korrektur.
  - Die Arena empfiehlt nur. Status, Kapital und Handel ändert sie nicht.
- **Kleine Korrektur, vorgeschlagen, nicht umgesetzt:**
  - Der Assembler bewertet mit `basis: "BOOKED_CANDLE"`, eine Zeile plus
    Tests.
  - Die Regeln und ihre Schwellen bleiben, wie sie sind. Equity, Tages-P&L,
    R-003 und die Exposure-Limits stehen dann auf demselben Stand.
  - Solange eine Kerze ungebucht ist, rechnen die Exposure-Limits mit dem
    gebuchten statt dem neuesten Preis.
  - In OFFICIAL_V1 ändert das keine Entscheidung, siehe R-022.
  - Empfehlung: aufnehmen, als eigener Commit mit Risk-Differenzlauf. Nötig
    für die Sicherheit ist es nicht. Es verhindert irreführende
    Integritätsalarme, nicht aber den Arena-Hard-Stop durch R-022.

### 6.2 Weitere offene Punkte

| Prio | Befund | Stand | Wirkung auf OFFICIAL_V1 |
|---|---|---|---|
| 1 | **R-022 als Arena-Hard-Stop** | Altbefund (ADR 0022) | Beim ersten Trade erwartbar, sobald ein Candidate bei offener Position bewertet wird. Quittieren der Ereignisse oder Neueinstufung von R-022 ist eine eigene Entscheidung |
| 2 | **R-003 (N3b)** | siehe 6.1 | irreführende CRITICAL-Ereignisse |
| 3 | **ADR 0022 – kein Rückweg aus `ERROR_LOCKED`** | nur Analyse | Jede echte Sperre braucht SQL von Hand |
| 4 | **K1 – Sperre während `PARTIALLY_FILLED`** | ADR 0024, F2 | selten |
| 5 | **N2 – Fill-Kerze ohne Exitprüfung** | Abschnitt 7, durch N3 unverändert | betrifft jeden Trade; Forschung und Forward-Test gleich |
| 6 | **N1 – Fill-Fenster**, **Option R** | ADR 0024 | selten, beziehungsweise zweite Verteidigungslinie |
| 7 | **N3c** – Versionskonflikt des Monitors | ADR 0025 | selbstheilend |
| 8 | **B1** – nicht protokollierter Worker-Start | VPS-Bericht | nur Protokoll |

## 7. N2 – Die Fill-Kerze wird nie auf Exits geprüft

Rein analytisch und mit synthetischen Proben gegen den Hotfix-Code. Die
Proben sind nicht committet. Kein Produktivcode wurde geändert.

### 7.1 Befund

- **Wird die Einstiegskerze je geprüft? Nein.** Der Fill setzt
  `lastProcessedCandleId` der Position auf die Fill-Kerze
  (`shadowFillPersistence.ts`, Positions-Update). Der Monitor beginnt bei der
  nächsten Kerze. Selbst ein direkter Aufruf des Monitors mit der Fill-Kerze
  liefert `ALREADY_PROCESSED` (Probe P1b). Das gilt auch für die Kerze, die
  den Rest einer Teilfüllung füllt (P4).
- **Spezifikation:** Dokument 07 verlangt das Gegenteil: „Für eine in `C1` am
  Open eröffnete Position wird der gesamte OHLC-Range von `C1` danach als
  potenzieller Exitpfad behandelt.“
- **Replay gleich:** `packages/shadow-replay/src/replay.ts` (`16d6d0f`) und
  `replay-core.ts` (Entwicklungsstand, Basis der Gates- und
  Evolution-Evidenz) setzen beim Fill `lastProcessedCloseMs` auf die
  Fill-Kerze und überspringen sie im Monitor-Schritt. Forward-Test und
  Forschung sind sich also einig, beide weichen aber von Dokument 07 ab.
- **Kleiner Unterschied bei Teilfills:** Das Replay überwacht eine
  teilgefüllte Position schon ab der nächsten Kerze, auch wenn diese den Rest
  füllt. Der Worker überspringt diese Kerze (P4). Nach Option K wertet der
  Worker im Ablauffall die Ablaufkerze aus, wie das Replay.

### 7.2 Synthetische Proben

| Probe | Ablauf | Ergebnis heute | Erwartet (Dokument 07, bei P5 Vorschlag) |
|---|---|---|---|
| P1 | Voll-Fill am Open 24 110. C1 fällt auf 23 500, unter den Stop 23 600, und schließt bei 24 800. Danach erreicht C3 den TP | Position überlebt, **Gewinn +142,04 USDT** | Stop in C1, Verlust |
| P3 | C1 erreicht nur den TP, C2 fällt auf den Stop | **Verlust −57,68 USDT** | TP in C1, Gewinn |
| P4 | Teilfill auf C1, C2 füllt den Rest und läuft durch den Stop | Stop verpasst, Position bleibt offen | Stop in C2 |
| P5 | Teilfill auf C1, C2 eröffnet bei 23 400, unter dem Stop | Rest füllt **unter dem Stop** (23 409), denn die Entry-Gap-Prüfung gilt nur für C1. Der Post-Fill-Recheck markiert das als Shortfall für den Zwangs-Close; in der Probe löst in C3 vorher der Stop per Gap aus | kein Fill unter dem Stop: Rest verfällt, Position öffnet (wie K) |

### 7.3 Antworten

1. **Wird die Einstiegskerze nie geprüft?** Ja, nie. Das gilt für jeden
   Voll-Fill und für die Kerze, die einen Teilfill vervollständigt.
2. **Kann eine offene Position ihren Stop verpassen?** Ja (P1, P4). Ein
   verpasster Stop ist optimistisch, wenn sich der Kurs erholt, und
   pessimistisch, wenn er später mit Gap schlechter auslöst. Ein verpasster TP
   ist pessimistisch (P3). Weil der Stop (1R) näher liegt als der TP (≥ 2R),
   berührt C1 den Stop häufiger als den TP. Netto ist die Verzerrung
   vermutlich optimistisch. Das ist nicht quantifiziert.
3. **Was weiß das Modell über die Reihenfolge in der Kerze?** Nur OHLCV der
   1h-Kerze, keine Ticks, keine kleineren Timeframes. Der Entry füllt per
   Modell am Open von C1. Damit liegt jeder andere Preis von C1 zeitlich
   danach, High und Low eingeschlossen. Unbekannt ist nur die Reihenfolge von
   Stop und TP innerhalb von C1. Dafür gilt schon `STOP_FIRST`. Die Gap-Regeln
   greifen in C1 nicht, weil die Entry-Gap-Prüfung den Open ohnehin im
   geplanten Bereich hält. Eine Vereinfachung des Modells: Die Füllmenge nutzt
   das Volumen der ganzen Kerze, obwohl der Fill am Open liegt.
4. **Korrekte Lösung ohne Lookahead:**
   - Die Fill-Kerze wird nach dem Fill wie jede andere Kerze ausgewertet:
     Stop, TP, `STOP_FIRST`, Referenzpreise unverändert. Technisch bleibt der
     Positions-Cursor auf der Kerze vor dem ersten Fill. Der Monitor bleibt der
     einzige Schreiber für Exits.
   - Das ist kein Lookahead: Bewertet wird nur der Pfad nach dem Entry, und
     nur zum Zeitpunkt nach dem Schluss von C1, wie bei jeder Kerze. Verboten
     bleibt, mit Wissen über C1 zu entscheiden, *ob* gefüllt wird.
   - Für Teilfills sind zwei Wege denkbar. (a) Eine Fortsetzungskerze, die
     jenseits des Stops eröffnet, füllt nicht mehr. Der Rest verfällt, die
     Position öffnet wie bei K. (b) Einfacher: Nach dem ersten Fill wird der
     Rest sofort beendet. Das berührt N1 und ADR 0005.
   - Offen: Entry und Exit teilen sich in C1 dasselbe Volumen, bei je 1 %
     Teilnahme.
   - Das Replay muss im selben Schritt angepasst werden, sonst laufen
     Forward-Test und Forschung auseinander.
5. **Wirkung auf Replays und OFFICIAL_V1:**
   - Jedes historische Ergebnis (Gates v2–v4, Evolution, Studien) ist mit der
     N2-Semantik gerechnet. Eine Korrektur ändert jeden Trade, dessen
     Fill-Kerze Stop oder TP berührt. Eingefrorene Ergebnisse dürfen nicht
     überschrieben werden; eine Neubewertung wäre eine neue Version.
   - OFFICIAL_V1 testet heute konsistent das erforschte Modell. Eine
     Korrektur nur im Worker würde den Forward-Test strenger machen als seine
     Evidenz und die Vergleichbarkeit brechen. Eine Korrektur in Worker und
     Replay ist eine Modelländerung (Ausführungsmodell v1.1). Nach Regel 1 des
     Forward-Tests gehört sie in eine neue Version mit eigenem Start, nicht in
     einen Bugfix.
   - Empfehlung: OFFICIAL_V1 unverändert lassen. Die Größe der Verzerrung
     zuerst offline auf vorhandenen Kerzen messen, ohne Download und nur mit
     Freigabe. Dann als versionierte Änderung zusammen mit dem Replay
     entscheiden.


## 8. Bereitschaft und Entscheidungen

**Einschätzung:** Der integrierte Stand ist bereit für den abschließenden
CI-Lauf.
- Lokal ist der vollständige Lauf grün, mit isolierter PostgreSQL und
  denselben Befehlen wie in CI.
- Der einzige bekannte rote Test ist behoben.
- Die Differenzprüfungen zeigen keine unbeabsichtigte Verhaltensänderung.

Vor Push, CI und Deployment zu entscheiden:

1. **R-003-Korrektur** (6.1) vor dem Push aufnehmen oder bewusst später
   machen. Mit Korrektur kommt ein Commit dazu, sonst bleibt der jetzige
   Stand.
2. **Push** des integrierten Branches. Danach soll die CI vollständig grün
   sein. Logs und Job-Summary braucht ein GitHub-Login.
3. **Einordnung** als protokollierter Bugfix nach Regel 2 (empfohlen). Dazu
   der Status der ADRs 0021, 0023, 0024 und 0025.
4. **Lesende VPS-Prüfung direkt vor dem Deploy**, mit eigener Freigabe:
   keine offene Entry-Order (D5), ADR 0024 Q1–Q5 und die Limit- und
   Profilzeilen unverändert.
5. **Umgang mit R-022 in der Arena** beim ersten Trade (6.2). Eine
   Betriebsanweisung reicht, eine Codeänderung ist es nicht.
6. **Deployment** nach H3 mit Backup, Rollback-Tags, beiden Images,
   `TRADING_CODE_VERSION` und Konsistenz-Snapshot und -Vergleich. Danach der
   Eintrag ins Änderungsprotokoll.
