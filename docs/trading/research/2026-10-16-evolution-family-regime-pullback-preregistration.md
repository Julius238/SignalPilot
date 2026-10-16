# Vorregistrierung der Strategiefamilie REGIME_PULLBACK_LONG („Regime-Rücksetzer“) (2026-10-16)

> **Status 2026-10-16: geschlossen (F4).** Das Startgenom EVO-RPB-0001 wurde im
> Screening verworfen (`OWN_ALPHA` t = −0,34, `INCREMENT_SIGNIFICANCE`
> t = 0,75, `PORTFOLIO_DRAWDOWN`). Bericht:
> [Bewertung des Startgenoms](2026-10-16-regime-pullback-seed-evaluation.md).
> Der Text unten bleibt als Festschreibung unverändert.

Festgeschrieben **vor** dem ersten Experiment der Familie. Bis zur
Festschreibung wurde keine Rücksetzer-Regel auf irgendeinem Zeitraum
gerechnet, kein KI-Lauf gestartet und nichts freigegeben. Champion,
Challenger, das Paket `@signalpilot/risk-engine` (einschließlich R-020 und der
Freigabeliste von R-005), Arena V1 und der offizielle VPS-Forward-Test bleiben
unverändert. Gates v1–v4 und ihre Hashes bleiben unverändert, der
Mehrfachtest-Zähler wird nicht zurückgesetzt.

- Entwurf und Herleitung: [Entwurf, dritte Fassung](2026-10-15-evolution-family-regime-pullback-draft.md).
  Der Betreiber hat am 2026-10-16 beauftragt, den abgestimmten Entwurf zu
  übernehmen; die offenen Punkte F1–F6 gelten damit wie empfohlen („ja“).
- Prüfregeln: [Vorregistrierung Gates v4](2026-10-16-evolution-gates-v4-preregistration.md),
  [ADR 0019](../decisions/0019-evolution-gates-v4-portfolio-value.md).
- Code: `packages/evolution/src/family-regime-pullback.ts` (alles, was der
  Hash umfasst), `packages/strategy-engine/src/crypto-regime-pullback-research-v1.ts`
  (Einstiegs-Evaluator).

| | Wert |
|---|---|
| Vorregistrierungs-Hash (`canonicalHash` von `REGIME_PULLBACK_LONG_V1_PREREGISTRATION`) | `b96bcc97c4d6d1f9e2af5d66c896a0f3e233125934401292e694961421cf1c44` |
| Gates (`evolution-gates-v4`) | `8f55cf8e14b9ca82923f2aae7bab4ed12c318e45c28f31c9f5e03e1ba054554c` |
| Daten-Split (`evolution-split-v1`) | `838ce3bfe2ee7740f053435c3300337a4a7b3c4fbd1cb0fbcfbba88388e22f00` |
| Genom-Hash des Startgenoms | `cb8e72d9d8c50422602193a50e10d27e3c6ee261d52b631379e52351be33c6b3` |
| Spezifikations-Hash des Startgenoms (Forschungsidentität) | `51e0480f3d99f323f958d7c18abd07cdf9929eca9ed533d3c1f8aea55fea24a2` |

Der Vorregistrierungs-Hash ist im Code festgenagelt
(`REGIME_PULLBACK_LONG_V1_PREREGISTRATION_PINNED_HASH`) und in
`packages/evolution/test/family-regime-pullback.test.ts` geprüft. Er steht in
`FamilySpec.independence.preregistrationHash` und im Manifest jedes
Durchlaufs (`independentFamilies`, beim Startgenom zusätzlich `seed`).
`evaluate-seed` verweigert den Lauf, wenn der Code nicht mehr zum
festgenagelten Wert passt.

Der Hash umfasst: Forschungsidentität und Engine-Version, Replay-Hülle,
Einstiegsregeln E1–E5, feste Regeln und Ausstiege, Parameterraum,
Startgenom, Nachbarn, Budget, Stufen, Positionsgröße, Kostenmodell,
Regime-Policy, Split und Gates (je mit Hash), den Zählerstand N = 52 und den
Datenstatus (Abschnitt 8). Wer davon etwas ändert, braucht eine neue
Vorregistrierung.

## 1. Identität: eigene Familie, Hülle nur technisch

- **Forschungsidentität** `RESEARCH:REGIME_PULLBACK_LONG_V1`, Engine-Version
  `crypto-regime-pullback-research-v1/1.0.0`, Spezifikations-Hash je Genom
  über Forschungsidentität, Engine-Version, Vorregistrierungs-Hash und Genom.
  Kein Registry-Eintrag, keine StrategyVersion, kein Live-Pfad.
- **Replay-Hülle.** Replay und R-005 verlangen einen registrierten,
  freigegebenen Schlüssel. Der Replay läuft deshalb technisch unter
  `CRYPTO_REGIME_LONG_V1`: Der Eingabe-Snapshot wird gegen diese Hülle
  validiert, und der Kandidaten-Entwurf trägt ihren Schlüssel. Ihr Evaluator
  wird nie aufgerufen, ihr Regime-Exit ist abgeschaltet
  (`regimeExit.enabled = false`).
- **Präzisierung gegenüber dem Entwurf:** Engine-Version und
  Spezifikations-Hash jedes Ergebnisses und Kandidaten-Entwurfs sind die der
  Forschungsidentität, nicht die des Challengers. Der Indikator-Teil des
  Entwurfs nennt sie zusätzlich (`researchKey`, `researchEngineVersion`,
  `researchSpecificationHash`). Nur der Schlüssel ist Hülle. Die Risk Engine
  prüft davon nur, dass beide Felder gesetzt sind; R-005 bleibt unverändert.
- **Gespeicherte Zeilen:** Kandidaten tragen die Familie `REGIME_PULLBACK_LONG`
  und `rootStrategyKey = RESEARCH:REGIME_PULLBACK_LONG_V1`, die Kennzahlen
  `identity` mit Forschungsidentität und `replayHull`. In den gespeicherten
  Portfolio-Zusammenfassungen steht das Kandidaten-Portfolio unter seiner
  Forschungsidentität; der Hüllenschlüssel erscheint nur im Feld
  `replayHull`. Trades werden über das Portfolio zugeordnet, nie über den
  Schlüssel.
- **Kein Forward unter der Hülle.** Ein Forward-Test braucht einen eigenen
  registrierten Schlüssel und einen gesonderten Beschluss über
  `APPROVED_LONG_STRATEGY_KEYS`; ohne ihn lehnt die unveränderte Risk Engine ab.

## 2. Einstieg (zu jedem Schluss einer 1h-Kerze C0)

| Nr. | Bedingung | suchbar |
|---|---|---|
| E1 | (höchstes Hoch der `pullbackLookbackHours` geschlossenen 1h-Kerzen vor C0 − Schluss C0) ÷ ATR(14, 1d) ≥ `pullbackDepthAtr1d`; C0 liegt nicht im Fenster (`priorPeriodHigh`) | ja |
| E2 | wenn `requireReversalCandle`: Schluss C0 > Eröffnung C0 und Schluss C0 > Schluss C−1 | ja |
| E3 | wenn `capitulationVolumeMinimum` > 0: höchstes relatives Volumen der letzten 6 geschlossenen 1h-Kerzen (C0 eingeschlossen, je gegen den Schnitt der 20 Kerzen davor) ≥ Minimum | ja |
| E4 | ein kritisches bärisches Kontext-Ereignis blockiert | nein |
| E5 | Gültigkeit 2 h, Einstiegslücke ≤ 0,5 × ATR(14, 1h) | nein |

**Keine Regime-Regel im Evaluator.** Er liest das Regime für keine
Entscheidung und erzeugt Kandidaten auch außerhalb von `RISK_ON`. Dort lehnt
die unveränderte Risk Engine mit R-020 ab (`MARKET_REGIME_CONFLICT`), wie bei
jedem Long-Kandidaten. Der Evaluator ruft keinen anderen Einstiegs-Evaluator
und kein `regimeGateOpen` auf; ein Test prüft den Import-Graphen.

## 3. Preisplan und Ausstieg (fest)

| Teil | Wert |
|---|---|
| Stop | Einstieg − 2 × ATR(14, 1d), auf den Tick abgerundet |
| Ziel | Einstieg + 4 × Stopabstand, auf den Tick abgerundet; Mindest-CRV 2 |
| Zeit-Exit | 72 h |
| Regime-Exit | keiner |
| Größe, Kosten, Risk | 0,25 % Risiko je Trade, `BINANCE_SPOT_VIP0_ESTIMATE_V1`, Risk Engine `SPEC`, alle Regeln unverändert |

## 4. Parameterraum, Startgenom, Nachbarn

| Parameter | Werte | Anzahl |
|---|---|---:|
| `pullbackLookbackHours` | 24, 48, 72, 120, 168 | 5 |
| `pullbackDepthAtr1d` | 0,75 bis 2,5 in Schritten von 0,25 | 8 |
| `requireReversalCandle` | false, true | 2 |
| `capitulationVolumeMinimum` | 0 (aus), 2, 3 | 3 |
| **Raster** | | **240** |

- Nur Einstiegsparameter; kein Name aus `EXIT_PARAMETER_NAMES`. Eine Hypothese
  mit Stop, Ziel oder Haltedauer wird als `UNSUPPORTED_PARAMETER` verworfen.
- **Startgenom** (Generation 1, `SEED:REGIME_PULLBACK_LONG_V1`): 72 h, 1,5 ×
  ATR(1d), Umkehrkerze verlangt, Volumenfilter aus.
- **Nachbarn des Startgenoms** im Finale: Tiefe 1,25 und 1,75, sonst gleich.
- Je Hypothese höchstens 3 Änderungen gegenüber genau einer Elternstrategie.

## 5. Prüfverfahren

- **Gates v4 mit genau dem oben genannten Hash.** Unter v1–v3 wird die
  Familie abgelehnt: `evaluate-seed` läuft nicht, Hypothesen der Familie
  werden ohne Backtest als `GATES_VERSION_UNSUITABLE` verworfen, und ein
  dennoch geprüfter Kandidat erhält `INDEPENDENT_FAMILY_REQUIRES_GATES_V4`.
- **Forschungszyklus, Schritt 5d.** Kandidaten einer Familie mit
  `independence` gehen nie durch die v3-Linienregel, sondern durch den
  Portfolio-Weg. Vergleich A (Champion, Challenger, freigegebene Kandidaten,
  Reserveplatz als Kasse) läuft einmal je Durchlauf und Fenster aus dem
  Cache des Laufs; Vergleich B (Kandidat auf dem Reserveplatz) je Kandidat.
  Beide sind chronologische Portfolio-Simulationen mit festen Plätzen à
  20 000 USDT, BTCUSDT und ETHUSDT je Portfolio, Stufe 1 = unverändertes
  `evaluateRisk`, Stufe 2 = `group-risk-v1`.
- **Screening:** v1-Basisprüfungen auf den eigenen Backtests, danach die
  v4-Prüfungen `LINEAGE_BUDGET` bis `PORTFOLIO_DECISION`. **Finale:**
  v1-Finalprüfungen, `PORTFOLIO_NEIGHBOURS`, `PORTFOLIO_HOLDOUT_GUARD`;
  höchstens ein Finalist der Familie je Durchlauf.
- **Integrität:** Jede Portfolio-Simulation wird wie ein Backtest auf
  Datenstand, Fenster, Forward-Sperre und Invarianten geprüft; ein Fehler
  macht den Kandidaten `TECHNICAL_FAILED`, nie „bestanden“.
- **Gespeichert** werden die `GateResultV4` im Prüfprotokoll, Vergleich A und
  B als kompakte Zusammenfassung, Bewertung, Entscheidung, Nachbarn und
  Holdout in `metricsJson.portfolio`, im Manifest `gatesVersion`, `gatesHash`
  und der Vorregistrierungs-Hash.

## 6. Stufen, Budget, Abbruch

1. **Stufe 1: nur das Startgenom, ohne KI** — `evolution evaluate-seed
   --family=REGIME_PULLBACK_LONG` (Abschnitt 10).
   - Es gibt keinen KI-Anbieter in diesem Befehl; jeder Aufruf schlüge fehl.
   - Der Befehl läuft auch bei pausiertem Agenten.
   - Er verweigert einen zweiten Lauf desselben Startgenoms. Auch ein
     technisch gescheiterter Lauf zählt als Bewertung, weil Validierungsdaten
     gesehen wurden.
2. **Abbruch (F4).** Scheitert das Startgenom im Screening, ist die Familie
   unter dieser Vorregistrierung geschlossen. Es gibt keine Rastersuche, um
   doch noch eine passende Konfiguration zu finden; ein neues Startgenom
   braucht eine neue Vorregistrierung.
3. **Stufe 2: KI-Suche in der Familie.** Sie ist nur offen, wenn alle
   Bedingungen gelten:
   - das Startgenom hat das Screening bestanden;
   - der Betreiber hat sie freigegeben (`EVOLUTION_INDEPENDENT_FAMILY_SEARCH=REGIME_PULLBACK_LONG`,
     Standard leer);
   - die Gates sind genau die vorregistrierten v4-Gates;
   - das Budget reicht: höchstens 2 Hypothesen je Durchlauf, 4 Prüfungen je
     Monat und 9 insgesamt, das Startgenom eingeschlossen. Das ist strenger
     als die v4-Grenze von 10 je Familie und Monat.
   - Sonst sieht die KI die Familie nicht, und ihre Hypothesen werden ohne
     Backtest verworfen (`FAMILY_STAGE_CLOSED`, `FAMILY_PREREGISTRATION_LIMIT`).
   - Elternstrategien sind nur Kandidaten der Familie, die das Screening
     bestanden haben.
4. **Forward:** siehe Abschnitt 1. Nichts wird automatisch freigegeben,
   nichts handelt Echtgeld.

## 7. Mehrfachtest-Zähler

Unverändert und nie zurückgesetzt: 30 Trainingskonfigurationen plus jede auf
Entdeckung + Validierung geprüfte Konfiguration (Kandidaten und Nachbarn,
alle Familien und Gate-Versionen). Bei der Festschreibung N = 52.

| Stand | N | √(2·ln N) |
|---|---:|---:|
| Festschreibung | 52 | 2,81 |
| nach Stufe 1, Startgenom verworfen | 53 | 2,82 |
| nach Stufe 1, Startgenom im Finale (+2 Nachbarn) | 55 | 2,83 |
| Höchstwert unter dieser Vorregistrierung (9 Kandidaten, höchstens 5 Finalisten mit je 2 Nachbarn) | 71 | 2,92 |

Die α-Schwelle (v4 `OWN_ALPHA`) ist max(2; √(2·ln N); t-Quantil).
`evaluate-seed --check` zeigt den aktuellen Stand vor dem Lauf.

## 8. Bereits gesehene Daten

| Daten | Zeitraum | Status |
|---|---|---|
| Entdeckung | 2018-04-01 – 2022-06-30 | durch Vorforschung (Training 2018-03 – 2023-12, 30 Konfigurationen, Regime-Studie) und 22 Evolution-Konfigurationen analysiert; keine Rücksetzer-Regel gerechnet |
| Validierung | 2022-07-01 – 2023-12-31 | wie oben; die KI sieht nur Urteile |
| Holdout | 2024-01-01 – 2026-10-14 | `PREVIOUSLY_ANALYZED`: kann nur stoppen, nie belegen |
| Forward | ab 2026-10-15 | nie simuliert; einzige saubere Evidenz |
| Vorwissen des Sprachmodells | bis etwa Mitte 2026 | nicht ausschließbar |

Zwei Befunde der Vorforschung passen zur Idee und waren beim Entwurf bekannt
(Entwurf, Abschnitt 11). Sie sind kein Beleg. Ein bestandener historischer
Test heißt nur „nicht widerlegt“.

## 9. Gemeinsame Verlustserien und Kapitalzuordnung

- Wie jede Strategie läuft die Familie als **ein Portfolio mit BTC und ETH**
  (T1). R-021 (Verlustserie) und die übrigen Portfolio-Regeln wirken also über
  beide Symbole zusammen. Gleichzeitige Rücksetzer in BTC und ETH öffnen zwei
  Positionen im selben Portfolio und zählen zusammen in dessen Verlustserie.
  Vergleich A und B nutzen dasselbe Modell, der Vergleich bleibt also fair.
  Der Bericht zeigt Trades, Netto und Kill-Switch-Auslösungen je Portfolio in
  A und B.
- **Keine künstliche Verbesserung durch Kapital oder Zuordnung:**
  `checkComparisonFrame` verweigert jede Bewertung, deren Vergleiche nicht
  dasselbe Gesamtkapital, dieselben Bestandsportfolios in derselben
  Reihenfolge, gleich große Plätze und den Kandidaten zuletzt haben. Gewichte
  werden nie optimiert. Ein Portfolio, dessen Bezeichnung nicht zur Identität
  seines Genoms passt, wird abgelehnt.

## 10. Bereit zur Freigabe: ein Befehl

Vorbereitet und getestet, **nicht ausgeführt**. Der Betreiber gibt den Lauf
gesondert frei:

```bash
EVOLUTION_AI_PROVIDER=mock EVOLUTION_GATES_VERSION=v4 EVOLUTION_CODE_VERSION=$(git rev-parse HEAD) EVOLUTION_SNAPSHOT_DIR=/Users/juliuseggert/Dev/SignalPilot/data/market-snapshots/real EVOLUTION_BACKTEST_CONCURRENCY=6 corepack pnpm --filter @signalpilot/evolution-worker exec tsx --env-file=/Users/juliuseggert/Dev/SignalPilot/.env src/cli.ts evaluate-seed --family=REGIME_PULLBACK_LONG
```

- Datenbank aus der Root-`.env` der Entwicklungsumgebung. Ein KI-Anbieter
  wird nie erzeugt; `EVOLUTION_AI_PROVIDER=mock` hält nur die
  Konfigurationsprüfung frei vom API-Schlüssel.
- Mit `--check` druckt derselbe Befehl nur die Vorprüfung, ohne Backtest und
  ohne Schreibzugriff: Hash-Abgleich, Gates, frühere Bewertung, Budget, N vor
  und nach dem Lauf, Datenstand.
- **Vorprüfung am 2026-10-16** gegen die Entwicklungsdatenbank und
  `data/market-snapshots/real`: `ok`, keine Probleme. Startgenom noch nie
  bewertet, Familie 0 von 4 Prüfungen im Monat und 0 von 9 insgesamt, Gates
  v4 mit vorregistriertem Hash. N = 52 → 53 (Schwelle 2,82), Agent `PAUSED`,
  Datenstand `5c7459f3…` mit Abschluss 2026-10-14T23:59:59.999Z.
- Kosten: 0 USD API.
- Erwartete Dauer lokal mit 6 Prozessen:
  - Screening etwa 30–40 min: Benchmarks aus dem Cache oder neu, eigene
    Backtests, Vergleich A ≈ 17 min parallel zu B ≈ 25 min.
  - Im Finale etwa 1 h mehr: zwei Nachbarn mit Backtests und eigenem
    Vergleich B, Holdout-Backtests und Holdout-Vergleiche.

## 11. Laufzeit und T7 (Vorab-Cache der Bestandsbewertungen)

**Entscheidung: T7 wird für diesen Schritt nicht gebaut.**

- **Stufe 1 lokal:** Der Lauf braucht genau einen Vergleich A je Fenster. Er
  kommt schon aus dem Cache des Laufs, ist also nur einmal zu rechnen.
- **VPS:** Auf dem VPS läuft die Evolution Engine nicht. Er bleibt
  unverändert.
- **Vor regelmäßigen Läufen von Stufe 2 auf dem VPS ist T7 Voraussetzung.**
  - Bei 0,75 CPU und einem Prozess wären es grob 45 min für A und 60 min für
    jeden B.
  - Mit Finale kämen mehrere Stunden je Lauf zusammen; die Lease-Grenze liegt
    bei 6 h.
  - Ein laufübergreifender Cache von Vergleich A würde je Lauf rund 17 min
    lokal sparen. Schlüssel: Code-Version, Datenstand, Bestandsportfolios,
    Fenster, Simulations-Kennungen.
  - Ein Vorab-Cache der Stufe-1-Bewertungen der Bestandsportfolios würde B
    etwa auf ein Drittel verkürzen.
  - Beides ändert keine Entscheidung. Es braucht aber einen Nachweis
    bitgleicher Ergebnisse gegen den ungecachten Weg.

## 12. Umsetzung und Tests

| Bereich | Änderung |
|---|---|
| `packages/strategy-engine` | neue Datei `crypto-regime-pullback-research-v1.ts`; additive Reason-Codes (`PULLBACK_*`, `REVERSAL_CANDLE_*`, `CAPITULATION_VOLUME_*`) und der Indikator-Typ `PullbackResearchIndicatorSnapshotV1`. `crypto-regime-long-v1.ts`, Registry, Spezifikations-Hashes und Golden Fixtures sind byte-gleich |
| `packages/evolution` | `family-regime-pullback.ts`. In `genome.ts`: Familie, `FamilySpec.independence`, `EVOLUTION_FAMILY_SEEDS`, Replay-Plan mit Hülle ohne Regime-Exit, Abstand zum Startgenom. Außerdem `RPB`-Schlüssel, KI-Kontext nur für offene Familien, Portfolio-Bezeichnung und -Zusammenfassung mit `replayHull` und ein Berichtsabschnitt „Portfolio-Prüfung (Gates v4)“. `EVOLUTION_ROOTS` und alle Gate-Versionen sind unverändert |
| `apps/evolution-worker` | Schritt 5d (Portfolio-Weg), Finale, Startgenom-Modus `options.seed`, Stufe-2-Prüfung, `cycle/seed.ts`, CLI `evaluate-seed [--check]`, `EVOLUTION_INDEPENDENT_FAMILY_SEARCH` |
| `apps/dashboard` | Beschriftungen der v4-Prüfungen, der Familie und der neuen Hypothesen-Ergebnisse; Forschungsidentität im Kandidatendetail; nur lesend |
| Datenbank | keine Migration |

Tests:

- Evaluator: Rücksetzer, Fenster und Tiefe, Umkehrkerze, Volumen im
  6-Kerzen-Fenster, Preisplan, kritisches Ereignis, gleiches Urteil in
  `RISK_OFF`, Determinismus, fremde Identität, Import-Graph.
- Familie: Hash festgenagelt; Gates-, Split- und Kosten-Hash stimmen;
  240 Konfigurationen; Ausstiege unerreichbar; Startgenom und Nachbarn;
  Root-Genome unverändert; Hülle ohne Regime-Exit; Portfolio-Bezeichnung.
- Replay auf synthetischen Kerzen: R-020 lehnt außerhalb von `RISK_ON` ab, kein
  Regime-Exit, höchstens 72 h. KI-Kontext geschlossen oder offen.
- Ende zu Ende gegen PostgreSQL auf synthetischen Kerzen
  (`apps/evolution-worker/test/regimePullback.e2e.test.ts`):
  - Ablehnung unter v1–v3 und unter nicht vorregistrierten Gates;
  - saubere Vorprüfung;
  - Startgenom ohne KI über den v4-Portfolio-Weg, mit Manifest, Identität,
    Zuordnung, Exposition, Bericht und Audit-Kette;
  - kein Zweitlauf, F4-Sperre;
  - Finale mit den vorregistrierten Nachbarn und Holdout-Schutz;
  - Stufe 2 nur mit Freigabe und unter v4, dann eine KI-Hypothese über
    Replay bis zur v4-Entscheidung.
  - Der Testmarkt umfasst nur rund einen Monat, weil jede
    Portfolio-Simulation jede Stunde ihres Fensters bewertet und die CI-Zeit
    begrenzt ist. `OWN_ALPHA` verlangt 36 Monate. Deshalb erzwingt ein Test das
    Screening-Urteil über eine nur in Tests vorhandene Injektion, um das
    Finale zu erreichen. In Produktion entscheiden immer die echten
    Funktionen.
