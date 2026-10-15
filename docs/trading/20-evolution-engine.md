# 20 · SignalPilot Evolution Engine V1

Status: lokal implementiert und getestet (2026-10-15), **nicht auf dem VPS
deployt**. Der offizielle Forward-Test bleibt unberührt.

Die Evolution Engine erforscht mit Claude über die API Handelsstrategien auf
historischen Daten, testet sie mit dem bestehenden Backtest und schlägt die
robustesten zur Prüfung vor. Trading Engine, Risk Engine und Arena bleiben
die unabhängigen Instanzen für Ausführung und Leistungsbewertung.

Entscheidungen: [ADR 0016](decisions/0016-evolution-engine-isolated-research.md),
[ADR 0017](decisions/0017-evolution-gates-v2-successor-rule.md) (Gates v2) ·
Vorregistrierungen: [v1](research/2026-10-15-evolution-v1-preregistration.md),
[Gates v2](research/2026-10-15-evolution-gates-v2-preregistration.md)

## Bausteine

| Baustein | Aufgabe |
|---|---|
| `packages/evolution` | Rein, ohne I/O: Genome und Parameterraum, Daten-Split, Kennzahlen, Gates, Score, Walk-Forward, Marktbedingungs-Analyse, KI-Kontext mit Leak-Prüfung, Prompts und strenges Parsing, Preise und Budgetregeln, deterministischer Mock-Provider, Berichte, Sandbox-Vertrag |
| `apps/evolution-worker` | Orchestrierung: Anthropic-Provider, Budget-Schutz, Backtest-Pool (Kindprozesse), Forschungszyklus, Persistenz, Audit, CLI, Scheduler |
| `Evolution*`-Tabellen | Agent-Status und Lease, Durchläufe, KI-Aufrufe (Kosten-Ledger), Hypothesen, Kandidaten, Backtests, Daten-Exposure, hash-verkettetes Audit. Kein Fremdschlüssel zu Trading oder Arena |
| `GET /api/trading/evolution`, `…/candidates/:key` | Read-only, liest nur `Evolution*` |
| Dashboard `Trading → Evolution` | Agent, Budget, Kosten, Durchläufe, Hypothesen, Rangliste, Gründe, Abstammung, Freigaben; Forward-Ergebnisse nur als Verweis auf die Arena |

Zusätzlich, additiv und standardmäßig wirkungslos: Research-Overrides für
`evaluateCryptoRegimeLongV1` und ein `regimeExit`-Hook im Replay. Champion,
Challenger, ihre Spezifikations-Hashes und Golden Fixtures sind unverändert.

## Forschungszyklus

1. **Analyse** – Benchmarks (eingefrorener Champion und Challenger) und die
   letzten Kandidaten auf Entdeckungsdaten; Marktsegmente je Jahr.
2. **Bedingungen** – Trades nach Trendphase, Lage zum 200-Tage-Schnitt,
   Volatilitätsdrittel, Regime beim Einstieg, Ausstiegsart und Markt;
   „begünstigt / benachteiligt“-Befunde.
3. **Hypothesen** – Claude (stärkeres Modell) erhält den leak-geprüften
   Kontext und liefert strukturierte, falsifizierbare Hypothesen.
4. **Kandidaten** – jede Hypothese wird streng geparst, auf das Raster
   gebracht und zu einem versionierten Genom (`EVO-BRK-0007`) mit genau einer
   Elternstrategie — oder begründet verworfen (ungültig, Duplikat).
5. **Technischer Test und Backtest** – Determinismus, Invarianten, dann
   Entdeckung + Validierung für BTC und ETH.
6. **Automatisch verwerfen** – Screening-Gates mit konkreten Gründen.
7. **Finale und Vorschlag** – bis zu zwei Finalisten: Nachbarvarianten,
   rollierender Walk-Forward, Holdout. Wer alles besteht, wird mit Bericht
   vorgeschlagen. Ein günstigeres Modell fasst den Durchlauf zusammen.

## Schutz vor Überanpassung

- **Vorregistrierter Split** (Hash im Manifest jedes Durchlaufs): Entdeckung
  → Validierung → Holdout → Forward. Die Validierung meldet der KI nur das
  Urteil, den Holdout nie; finale Ergebnisse erscheinen im KI-Kontext nicht.
- **Forward-Daten unerreichbar**: Der Lader verwirft Kerzen ab 2026-10-15;
  jeder Backtest prüft Fingerprint, Fenster und Anker (sonst `DATA_LEAK`).
- **Exposure-Ledger**: jede Datensicht mit Zweck (Suche, Auswahl,
  Holdout-Prüfung, Referenz); der Holdout ist als „bereits analysiert“
  gekennzeichnet.
- **Mehrfachtest**: Evidenzgrad gegen √(2·ln N), N zählt die Vorforschung und
  jede geprüfte Konfiguration.
- **Robustheit**: Marktphasen-Stabilität, keine Phase trägt das Ergebnis,
  Nachbarvarianten, rollierender Walk-Forward, doppelte Kosten,
  Komplexitätsabzug, höchstens drei Änderungen je Hypothese.
- **Unrealistisches fällt automatisch**: Kosten, Ausführung, Größe, Risk-Regeln
  und Hebel sind nicht änderbar; unmögliche Kosten-Geometrie und
  inkonsistente Grenzen werden vor dem Backtest verworfen.

## Gate-Versionen

| Version | Seit | Inhalt |
|---|---|---|
| `evolution-gates-v1` | 2026-10-15 (`efe4df8`) | Screening- und Finalprüfungen; jede Fast-Kopie einer bestehenden Strategie ist redundant |
| `evolution-gates-v2` | 2026-10-15 | v1 mit identischen Schwellen plus Nachfolger-Regel: eine Fast-Kopie nur der eigenen Wurzel muss diese deutlich, in beiden Zeiträumen, gepaart signifikant (Newey–West, Student-t, Mehrfachtest) und ohne Verschlechterung übertreffen; höchstens 8 Versuche je Wurzel und Monat, ein Nachfolger-Finalist je Durchlauf |

Neue Durchläufe verwenden v2 (`EVOLUTION_GATES_VERSION`, Standard `v2`; `v1`
bleibt für Reproduktionen wählbar). Beide Versionen sind per Hash
festgenagelt; das Manifest jedes Durchlaufs enthält `gatesVersion` und
`gatesHash`. Entscheidungen werden nie rückwirkend neu bewertet, und ein
bereits als Kandidat oder Nachbarvariante geprüftes Genom wird als Duplikat
verworfen.

## Bewertung

Je Fenster (BTC + ETH, je 10 000 USDT): Nettorendite nach allen Kosten,
Profit Factor, Erwartungswert und Ø R je Trade, Trefferquote, maximaler
Drawdown, Sharpe, Sortino, Calmar, Exposition (Kapitalbindung),
Haltedauer, Trades pro Jahr, Kostenanteil, Ergebnis bei doppelten Kosten,
Verteilung über Marktphasen, Korrelation mit Champion und Challenger,
Buy & Hold. Gates und Score: siehe Vorregistrierung.

## KI-Anbindung

- Schnittstelle `ResearchAiProvider`; Implementierungen `AnthropicResearchProvider`
  (offizielles SDK `@anthropic-ai/sdk` 0.131.0) und `MockResearchProvider`.
- Modelle konfigurierbar: Hypothesen `claude-opus-5-5` (Effort medium),
  Zusammenfassung `claude-haiku-5-5` (Effort low).
- Structured Output (JSON-Schema), danach strenges eigenes Parsing.
- Jeder Aufruf streamt (keine HTTP-Zeitüberschreitung bei langem Denken).
- Eigene Retry-Schleife: 429, Überlast und 5xx mit Backoff und `retry-after`.
  Timeout und Verbindungsabbruch werden nicht wiederholt, weil der Aufruf
  bereits abgerechnet sein kann; ohne gemeldete Tokens wird er mit seinem
  schlechtesten Fall gebucht. Bad Request, Auth und Refusal nie.
- Refusal: serverseitiger Fallback (`fallbacks: "default"`, nicht für Haiku);
  Kosten je Versuch aus `usage.iterations` mit dem Preis des jeweiligen
  Modells.
- Budget: 20 USD/Monat, 1 USD/Durchlauf, schlechtester Fall wird vor dem
  Aufruf reserviert, tatsächliche Kosten danach gebucht. Erschöpft →
  `PAUSED_BUDGET` bis Monatsanfang. Mock-Aufrufe werden zum Listenpreis
  protokolliert, aber nie abgerechnet.
- Audit: jeder Aufruf als `EvolutionAiCall` (Modell, Tokens, Kosten, Dauer,
  Versuche, Fehlerart) und als Ereignis in der Hash-Kette.
- Schlüssel ausschließlich als `ANTHROPIC_API_KEY` in der Umgebung; nie im
  Code, nie im Log (pino-Redaction, Konfigurationsbeschreibung ohne Schlüssel,
  Backtest-Kindprozesse ohne Secrets).

### Echten Schlüssel hinterlegen (lokal)

1. In der Anthropic Console einen API-Key anlegen und ein Ausgabenlimit von
   20 USD setzen (zusätzliche Sicherung neben dem Engine-Budget).
2. `bash scripts/ops/set-anthropic-key.sh` im Repo-Root ausführen und den Key
   genau einmal einfügen (jedes Zeichen erscheint als `*`). Das Skript schreibt
   `ANTHROPIC_API_KEY` und `EVOLUTION_AI_PROVIDER=anthropic` in die gitignorte
   Root-`.env` (Rechte 600), verweigert nicht ignorierte Dateien und doppelt
   eingefügte Keys und zeigt nur Typ und Länge. Alternativ beide Zeilen von Hand
   eintragen.
3. `corepack pnpm evolution ai-smoke` macht je einen winzigen, budgetgeprüften
   Aufruf mit beiden Modellen (zusammen unter 0,01 USD) und zeigt Tokens,
   Kosten und Request-IDs.

## Freigabe und Arena

`PROPOSED` → Operator: `evolution approve|reject --candidate=… --actor=…`.
Eine Freigabe (`APPROVED_FOR_FORWARD_TEST`) ist ein dokumentierter
Beschluss. Danach, bewusst und getrennt:

1. Genom als eigene, registrierte Strategie-Identität mit Spezifikations-Hash
   und Tests aufnehmen (wie K2 → `CRYPTO_TREND_CORE_LONG_V1`).
2. Eigenes Portfolio, StrategyVersion, Assignment, Session (Runbook 14/18).
3. In der Arena als `CANDIDATE` mit `--parent` registrieren; Forward-Start.

Die Arena V1 bleibt unverändert und bewertet ausschließlich Forward-Daten.

## Betrieb lokal

```bash
corepack pnpm evolution status
corepack pnpm evolution resume --actor=julius
corepack pnpm evolution run-cycle --force
corepack pnpm evolution report --candidate=EVO-BRK-0001
corepack pnpm evolution approve --candidate=EVO-BRK-0001 --actor=julius --note="…"
corepack pnpm evolution verify-audit
```

Eine neue Installation startet `PAUSED`. `EVOLUTION_ENABLED=true` aktiviert
den Scheduler (`EVOLUTION_SCHEDULE_CRON`, Standard Montag 01:15 UTC).

## VPS-Betrieb (vorbereitet, nicht deployt)

VPS: 2 vCPU, 7,9 GB RAM (rund 6 GB frei). Grenzen im Overlay
`docker-compose.evolution.yml`: 0,75 CPU, CPU-Gewicht 256, 1,5 GB RAM ohne
Swap, 64 Prozesse, OOM-Vorrang, Nur-Lese-Dateisystem, nicht-root, keine
Capabilities, kein Docker-Socket, eigenes `.env.evolution`.

Freigabeschritte (in dieser Reihenfolge, jeweils nach Zustimmung):

1. Backup-Rotation und externe Sicherung einrichten (bisher fehlt beides).
2. Vollsicherung, dann die additive Migration `20261015120000_add_evolution_engine`
   (`migrate`-Image vorher bauen).
3. `scripts/ops/evolution-db-role.sql` mit eigenem Passwort ausführen.
4. Snapshots nach `/opt/signalpilot/data/market-snapshots/real` kopieren.
5. `.env.evolution` anlegen (`chmod 600`), zuerst `EVOLUTION_AI_PROVIDER=mock`.
6. Nur den Dienst bauen und mit `--no-deps` starten (Befehl im Overlay).
7. API und Dashboard neu bauen, damit `Trading → Evolution` erscheint
   (`--no-deps api dashboard`; Trading- und Daten-Worker bleiben unberührt).
8. Einträge im Änderungsprotokoll des offiziellen Forward-Tests.

## Kosten

Ein Durchlauf: ein Hypothesen-Aufruf mit Opus 5.5 (rund 10–15 k
Eingabe-Tokens, 3–8 k Ausgabe-Tokens inklusive Denken) und eine
Zusammenfassung mit Haiku 5.5. Erwartet etwa 0,10–0,25 USD, schlechtester
Fall 0,40 USD (vor jedem Aufruf reserviert). Wöchentlich unter 1 USD im
Monat, täglich etwa 3–7 USD.

## Gemessene Laufzeit

Erster Lauf auf echten Daten (2026-10-15, lokal, 6 Prozesse): 9 min Wandzeit,
38 CPU-Minuten, 12 Backtests; zweiter Lauf mit Referenzen aus dem Cache:
4 min, 22 CPU-Minuten. Mit 0,75 CPU auf dem VPS entspricht das grob 50 bzw.
30 Minuten je Durchlauf, bei 0,55 GB Spitzen-RAM je Backtest-Prozess.
Protokoll: [research/2026-10-15-evolution-v1-e2e-mock.md](research/2026-10-15-evolution-v1-e2e-mock.md).

## Grenzen von V1

- Nur zwei Familien und ein Parameterraster; neue Logik erst mit
  Code-Erweiterung oder menschlichem Evaluator.
- Kein unberührter historischer Zeitraum: Beweiskraft nur durch Forward-Tests.
- Kostenstress analytisch (gleiche Trades); zusätzliche Risk-Ablehnungen
  bei höheren Kosten würden nur Trades entfernen.
- Ein Durchlauf ist rechenintensiv; Backtests werden je Code-Stand,
  Datenstand und Genom gecacht.
