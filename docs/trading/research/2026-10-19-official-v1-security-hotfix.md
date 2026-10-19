# OFFICIAL_V1 – Sicherheits-Hotfix auf `16d6d0f` (ADR 0021, 0023, 0024 K)

- Stand: 2026-10-19, **lokal, nicht gepusht, nicht deployt**
- Branch: `hotfix/official-v1-security`, Basis `16d6d0f` (deployter VPS-Stand)
- Bezug: [ADR 0021](../decisions/0021-risk-limit-set-value-integrity.md) ·
  [ADR 0023](../decisions/0023-execution-profile-value-integrity.md) ·
  [ADR 0024](../decisions/0024-opening-position-after-entry-expiry.md) ·
  [Offizieller Forward-Test V1](official-forward-test-v1.md) ·
  Hotfix-Vorbereitung und VPS-Bericht vom 2026-10-18 auf
  `claude/risk-directive-enforcement-draft` (`bb912bf`)

> Auf dem VPS wurde nichts ausgeführt. Es gibt keinen Push, keinen Merge und
> keine Datenbankänderung außerhalb lokaler Wegwerf-Datenbanken. Alle Tests
> sind synthetisch.

## Kurzfassung

- **Geschlossen:** manipulierte Risikolimits (ADR 0021), manipulierte
  Ausführungsprofile (ADR 0023) und die Strandung einer teilgefüllten,
  abgelaufenen Entry-Order in `OPENING` (ADR 0024, Option K).
- **Nur diese drei Korrekturen.** Strategien, Gates, Arena, Portfolio-,
  Simulations- und Replay-Pakete, DB-Schema, Migrationen, API, Dashboard,
  Lockfile und Compose sind bitgleich mit `16d6d0f`. Keiner der 61
  Entwicklungs-Commits ist enthalten.
- **Gleiches Verhalten bei gültiger Konfiguration.** In 12 synthetischen
  Ausführungsszenarien schreiben alter und neuer Code zeilengleiche Daten. In
  5 Risk-Job-Fällen sind alle Entscheidungen gleich. Es ändern sich nur die
  Kennung `risk-rules-v1/1.3.0 → 1.4.0` und die daraus abgeleiteten Hashes.
- **Neuer bestätigter Befund N3:** Die Reconciliation kann eine normale offene
  Position fälschlich als `PORTFOLIO_EQUITY_MISMATCH` werten und die Session
  sperren. Das ist nicht durch den Hotfix entstanden und wird durch ihn nicht
  behoben. Für die Stabilität von OFFICIAL_V1 ist es der wichtigste offene
  Punkt.
- **N2 bestätigt:** Die Kerze, in der eine Entry-Order füllt, wird nie auf
  Exits geprüft. Live-Worker und Replay-Engine verhalten sich dabei gleich.
  N2 ist nur analysiert, nicht korrigiert.

## 1. Bestandsaufnahme

Alle Commits liegen im gemeinsamen Repository und sind erreichbar. Kein
Worktree hatte uncommittete Änderungen.

| Commit | Branch | Inhalt | Stand |
|---|---|---|---|
| `16d6d0f` | – | deployter OFFICIAL_V1-Build | Basis |
| `fbe858c`, `da5dc66` | `claude/risk-limit-integrity-draft` | ADR 0021 Entwurf und Umsetzung | gepusht, CI 39146689971 grün; liegt hinter 61 Entwicklungs-Commits |
| `1290a25` | `claude/risk-directive-enforcement-draft` | ADR 0022, nur Analyse | nicht übernommen |
| `c08fc2c`, `bb912bf` | dito | lesende VPS-Prüfung, Bericht, Hotfix-Vorbereitung | nicht übernommen (nur Doku und SQL) |
| `228a8da`, `0c55e52` | `claude/execution-profile-integrity-draft` | ADR 0023 Entwurf und Umsetzung, auf `da5dc66` | lokal |
| `a0a3961` | `claude/opening-after-partial-expiry-draft` | ADR 0024 Entwurf und lesende SQL, auf `0c55e52` | lokal, K nicht umgesetzt |

Abhängigkeiten: ADR 0023 baut auf ADR 0021 auf und teilt dessen Sperrpfad.
Option K nutzt den Helfer, den ADR 0023 für den Profil-Stopp eingeführt hat.
Die Reihenfolge 0021 → 0023 → K ergibt deshalb keine doppelte und keine
widersprüchliche Umsetzung. Die 61 Entwicklungs-Commits berühren weder
`apps/trading-worker` noch `packages/risk-engine`.

## 2. Inhalt des Hotfix-Branches

| Commit | Inhalt | Nachweis |
|---|---|---|
| `545f34e` | ADR 0021: `git diff fbe858c da5dc66 -- apps packages docs/06` plus ADR | Patch-sha256 `109551fd…` und Tree `5b23706a…` genau wie in `bb912bf` vorbereitet |
| `0e7d943` | ADR 0023: `git diff da5dc66 0c55e52` plus ADR | `apps/trading-worker`, `packages/risk-engine`, Dokument 06 und beide ADRs bitgleich mit `0c55e52` |
| `fcfc965` | ADR 0024 Option K, Regressionstests, Korrektur des Test-Fakes, ADR 0024 mit lesender SQL aus `a0a3961` | siehe ADR 0024, Abschnitt „Umsetzung“ |
| `2d89170` | ein weiterer K-Test: Exit unter `ERROR_LOCKED` | – |
| dieser Commit | dieser Bericht | nur Doku |

Gegenüber `16d6d0f` sind 13 Quelldateien in `apps/trading-worker/src` und 4 in
`packages/risk-engine/src` geändert, dazu Tests, die Dokumente 06 und 18, drei
ADRs, eine lesende SQL-Datei und dieser Bericht. Arena, Scheduler,
Strategie-Code, Candidate-Erzeugung, Replay, Konfiguration und Safety-Gates
sind unverändert.

## 3. Geschlossene Lücken

| Lücke | Vorher (`16d6d0f`) | Jetzt |
|---|---|---|
| Limit-Set-Werte (ADR 0021) | R-026 prüft nur den Hash-Text und fünf Ganzzahlen. Eine DB-Zeile mit V1-Hash kann z. B. das Vierfache Risiko genehmigen lassen. | R-026, Assembler, Eligibility, Post-Fill-Recheck und Bootstrap vergleichen jedes Feld mit V1, Dezimalwerte als Wert. Eine Abweichung sperrt. |
| Ausführungsprofile (ADR 0023) | Gebühren, Spread, Slippage, Tick, Step, Mindestwerte und Teilnahme werden ungeprüft benutzt. | Registry der freigegebenen Profile. Einstiegspfade lehnen ab und sperren neue Entries. Exit und Bewertung rechnen mit dem freigegebenen Profil und blockieren nie. Die Kalibrierung schreibt nur das freigegebene Profil. |
| Teilfill und Ablauf (ADR 0024) | Die Position bleibt in `OPENING`, ohne Stop, TP, Zeit-Exit oder manuellen Close. | Der Ablauf öffnet die Position. Der Monitor wertet ab der Ablaufkerze aus. |

## 4. Tests

Alle lokal, ohne VPS. Die DB-Tests laufen gegen eine Wegwerf-PostgreSQL 16 im
Scratchpad (Socket-Port 55432) mit den 29 Migrationen von `16d6d0f`. Die
Dev-DB wurde nicht berührt.

### 4.1 Suiten (CI-Äquivalent)

| Bereich | Ergebnis |
|---|---|
| `pnpm lint`, `pnpm ops:test:scripts` | grün |
| Trading-Worker, mit DB-Suiten | 412/412 |
| davon ADR-0024-Block | 10/10. Gegen den Code ohne K schlagen 7 fehl, die 3 Kontrollfälle bestehen auf beiden Ständen |
| Risk Engine | 114/114 |
| API (bindet den Trading-Worker ein) | 193/193 |
| Strategy Engine, Trading-Domain, Arena, Simulation, Portfolio, Shadow-Replay, Market-Regime | 151, 153, 16, 32, 30, 12, 11, alle grün |
| Worker, Dashboard, Backtesting und übrige Pakete | grün |
| `packages/database` | 53/54. Der Alert-Katalog-Test schlägt auf `16d6d0f` identisch fehl, ein Altbefund |
| Build | grün. Das Dashboard braucht wie in CI `SIGNALPILOT_API_INTERNAL_URL` |
| Typecheck der Worker-Tests | unverändert 83 Altfehler, kein neuer |

### 4.2 Differenztest gegen den alten VPS-Code

Dasselbe Skript lief in `16d6d0f` und im Hotfix: gleicher Fake, gleiche Seeds,
deterministische IDs, das freigegebene BTCUSDT-v2-Profil (10/2/3 bp, 1 %) und
das V1-Limit-Set. Verglichen wurden alle geschriebenen Zeilen.

| Szenario | Ergebnis |
|---|---|
| Voll-Fill mit Stop, TP, Zeit-Exit und Tagesstart; Intrabar-Konflikt; CRV-Shortfall mit Zwangs-Close; Teilfill mit Vervollständigung; Teilfill-Shortfall; Ablauf ohne Fill; Entry-Gap; manueller Close; SHORT Voll-Fill mit Stop; SHORT Teilfill mit TP; Bewertung; Reconciliation | **12/12 zeilengleich** |
| Teilfill und Ablauf, LONG und SHORT | Unterschied wie beabsichtigt. Alt: `OPENING`, Monitor `NOT_APPLICABLE`, Reconciliation sperrt per Equity-Mismatch. Neu: `OPEN`, ausgestoppt, konsistent |

Risk-Job, also Assembler, Engine und Persistenz, in den Fällen Freigabe,
R-008-Ablehnung, Kill Switch, inaktive Session und Verlustserie, jeweils mit
Wiederholungslauf: Status, Mengen, Regelergebnisse und Entscheidungen sind
gleich. Unterschiede gibt es nur bei `ruleSetVersion`/`ruleVersion` (130
Regelergebnisse) und bei Hashes und Schlüsseln, die davon abgeleitet sind.

### 4.3 Deploy-Simulation auf echtem PostgreSQL

Mit dem **alten** Code wurde der Aufbau aus Runbook 18, Abschnitte 7–9,
nachgestellt: Bootstrap, Kalibrierung (BTC/ETH v1 `RETIRED`, v2 `ACTIVE`,
Hashes `0fba0118…`/`fc2ec200…` wie auf dem VPS), Aktivierung beider
Teilnehmer, Tagesstart, Reconciliation, Arena-Bootstrap und Evaluierung.
Danach kamen `consistency-snapshot` mit altem Code und alle weiteren Schritte
mit dem Hotfix:

- `consistency-compare` sofort und nach den neuen Jobs: Exit 0, Arena-Ketten
  intakt.
- Eligibility: `EXECUTION_PROFILE` und `ACTIVE_RISK_LIMIT_SET` bestehen mit
  den echten Dezimalwerten der DB. Neu ist nur die erwartete Warnung
  `STRATEGY_VERSION_BUILD`. Die übrigen FAILs betreffen fehlende Marktdaten in
  der leeren DB und treten auf altem Code identisch auf.
- Kalibrierung: `UNCHANGED`. Risk-Job, Monitor und Arena: `SUCCESS`.
  Reconciliation 3/3 konsistent.
- Beide Sessions bleiben `SHADOW_ACTIVE`, kein RiskEvent, keine Sperre.

## 5. Wirkung auf OFFICIAL_V1

Beobachtbare Änderungen, auch wenn sie bei der heutigen Konfiguration nicht
eintreten:

1. **Kennung `risk-rules-v1/1.4.0`** statt `1.3.0` in jeder Bewertung, dazu
   neue Policy-, Input- und Output-Hashes. Die Entscheidungen bleiben gleich.
   Laut VPS-Prüfung vom 2026-10-18 gab es noch keine Bewertung. Kommt der
   Hotfix vor dem ersten Candidate, gibt es keine gemischten Kennungen.
2. **Neue Sperrpfade**, aber nur bei abweichenden DB-Zeilen: Limit-Set (R-026
   CRITICAL, Post-Fill, Eligibility, Bootstrap) und Ausführungsprofil
   (Eligibility, Aktivierung, Risk, Order, Fill). Die VPS-Prüfung fand keine
   Abweichung. Eine solche Sperre hat im Code keinen Rückweg (ADR 0022), sie
   müsste von Hand gelöst werden.
3. **Exit und Bewertung** rechnen mit dem freigegebenen Profil statt mit der
   Zeile. Bei den heutigen Zeilen ist das wertgleich.
4. **Eligibility** prüft strenger: genau ein `ACTIVE`-Profil je Asset, jeder
   Wert gleich. Das besteht mit den heutigen Zeilen. Neu ist die Warnung
   `STRATEGY_VERSION_BUILD`, das Runbook erwartet sie (H3).
5. **Kalibrierungsjob** schreibt nur noch das freigegebene Profil.
6. **Option K:** Bei Teilfill und Ablauf wird die Position `OPEN` und ab der
   Ablaufkerze überwacht, statt zu stranden. Das tritt nur bei dünnem
   Volumen ein (Teilnahme 1 %).
7. **Rollout:** Trading-Worker- und API-Image neu bauen, denn die API bindet
   den Trading-Worker ein. Keine Migration, keine Datenänderung. Rollback
   über die Images `:16d6d0f`.

Unverändert bleiben Champion `CRYPTO_TREND_CORE_LONG_V1` und Challenger
`CRYPTO_REGIME_LONG_V1` (Strategy Engine bitgleich, Versionen werden
anerkannt), Gates, Arena-Policy und -Kette, Portfolio- und Ledger-Logik,
Kosten- und Risikowerte. Die Evolution Engine ist auf `16d6d0f` gar nicht
enthalten.

## 6. Offene Befunde, priorisiert

| Prio | Befund | Stand | Wirkung auf OFFICIAL_V1 |
|---|---|---|---|
| 1 | **N3 – Reconciliation gegen Monitor** | neu, synthetisch bestätigt | Siehe 6.1. Kann die erste offene Position per `ERROR_LOCKED` stoppen |
| 2 | **K1 – Sperre während `PARTIALLY_FILLED`** | ADR 0024, F2 | Bei Kill Switch oder Sperre bleibt eine teilgefüllte Position unüberwacht, bis entsperrt wird. Selten |
| 3 | **ADR 0022 – `ERROR_LOCK` allgemein, kein Rückweg** | nur Analyse | Jede Sperre braucht SQL von Hand |
| 4 | **N2 – Fill-Kerze ohne Exitprüfung** | analysiert, Abschnitt 7 | betrifft jeden Trade; Forschung und Forward-Test gleich |
| 5 | **N1 – Fill-Fenster nach Teilfill** | ADR 0024, F2 | selten |
| 6 | **Option R** (Reconciliation-Befund für `OPENING` mit terminaler Order) | ADR 0024 | zweite Verteidigungslinie |
| 7 | **B1** – nicht protokollierter Worker-Start | VPS-Bericht | nur Protokoll |
| 8 | Alert-Katalog-Test in `packages/database` | Altbefund auf `16d6d0f` | keiner |

### 6.1 N3 im Detail

- **Mechanik:** Die Reconciliation (`*/4`) bewertet jede offene Position mit
  der neuesten geschlossenen Kerze. Der Equity-Cache trägt den Mark der
  letzten Buchung (Fill, Monitor, Tagesstart). Die Toleranz liegt bei 1e-8.
  Ist eine neue Kerze geschrieben, aber noch nicht vom Monitor (`*/2`)
  gebucht, meldet sie `PORTFOLIO_EQUITY_MISMATCH`. Folge: CRITICAL-RiskEvent,
  Session und Portfolio `ERROR_LOCKED`, Kill Switch. In der Arena zählt das als
  Hard Stop.
- **Nachweis:** synthetisch, mit einem normalen Voll-Fill. Vor dem Monitorlauf
  ist der Stand inkonsistent und gesperrt, danach konsistent. Der Code ist in
  `16d6d0f` identisch.
- **Wahrscheinlichkeit:** Jeder Job hat seinen eigenen `cron.schedule`. In den
  Minuten :00, :04, :08 … starten Monitor und Reconciliation gleichzeitig, eine
  Reihenfolge ist nicht erzwungen. Kritisch ist eine Kerze, die zwischen einem
  Monitor-Lauf und der nächsten gemeinsamen Minute geschrieben wird. Wann der
  Daten-Worker auf dem VPS schreibt, ist unbekannt (`CRYPTO_PIPELINE_CRON`,
  Laufzeit). Das ließe sich lesend klären über `Candle.createdAt` gegen die
  Stundengrenze und die BotRun-Zeiten. Dafür braucht es eine neue Freigabe.
- **Warum bisher unauffällig:** OFFICIAL_V1 hatte noch nie eine offene
  Position.
- **Lösungsrichtung, zu entscheiden:** Die Reconciliation bewertet mit der
  Kerze, die der Monitor zuletzt gebucht hat, statt mit der neuesten. Oder
  sie wertet einen noch nicht gebuchten Mark nicht als Befund. Beides ändert
  keine Handelsentscheidung, braucht aber einen eigenen ADR.

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

## 8. Entscheidungen vor Push, CI und Deployment

1. **Push** von `hotfix/official-v1-security` freigeben. Danach läuft CI. `gh`
   ist lokal nicht installiert, Job-Logs brauchen einen GitHub-Login.
2. **Einordnung:** protokollierter Bugfix nach Regel 2 (empfohlen) oder neue
   Version. Dazu den Status von ADR 0021 und ADR 0023 (beide „Proposed“, die
   Optionen A und W sind freigegeben) und von ADR 0024 F3 festlegen.
3. **Lesende VPS-Prüfung direkt vor dem Deploy**, mit neuer Freigabe. Ein
   konkreter Grund liegt vor: H3 verlangt „keine offene Entry-Order“ (D5),
   ADR 0024 Q1–Q5 lief noch nie, und seit dem 2026-10-18 können Orders
   entstanden sein. Optional dazu die N3-Abfrage (Schreibminute der Kerzen).
4. **N3:** vor oder nach dem Deploy entscheiden. Der Hotfix ändert N3 nicht.
   Ohne Korrektur sollte der Betreiber wissen, dass eine Sperre durch N3 nur
   per SQL zu lösen ist.
5. **Deployment-Fenster und Ablauf** nach der Hotfix-Vorbereitung (H3):
   Backup, Rollback-Tags `:16d6d0f`, Trading-Worker- und API-Image,
   `TRADING_CODE_VERSION`, `consistency-snapshot`/`-compare`, Eligibility.
6. **Protokoll:** B1 klären, den Eintrag ins Änderungsprotokoll von
   `official-forward-test-v1.md` schreiben, später den Hotfix in den
   Entwicklungsstand übernehmen. Dort sind 0021 und 0023 schon enthalten,
   K und die Fake-Korrektur kommen dazu.
