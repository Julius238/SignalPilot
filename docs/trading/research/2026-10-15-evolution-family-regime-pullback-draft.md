# Entwurf: Vorregistrierung der Strategiefamilie REGIME_PULLBACK_LONG („Regime-Rücksetzer“)

> **Festgeschrieben am 2026-10-16** in der
> [Vorregistrierung REGIME_PULLBACK_LONG](2026-10-16-evolution-family-regime-pullback-preregistration.md)
> (Hash `b96bcc97…`), F1–F6 wie empfohlen. Dieser Entwurf bleibt als
> Herleitung unverändert stehen.

> **Entwurf zur Prüfung durch den Betreiber, noch nicht festgeschrieben.**
> Stand 2026-10-15, dritte Fassung. Es gibt keinen Code, keinen Backtest,
> keinen KI-Lauf und keine Freigabe. Champion, Challenger, Risk Engine
> (einschließlich R-020), Arena V1 und der offizielle VPS-Forward-Test bleiben
> unberührt. Geprüft wird die Familie nach Gates v4, festgeschrieben in der
> [Vorregistrierung Gates v4](2026-10-16-evolution-gates-v4-preregistration.md)
> (Herleitung: [Entwurf Gates v4](2026-10-15-evolution-gates-v4-draft.md)). Die
> Familie selbst ist noch nicht implementiert; ihre
> Vorregistrierung wird vor ihrem ersten Experiment mit Hash
> festgeschrieben und in `FamilySpec.independence` eingetragen.

## 1. Entscheidungen

**Betreiberentscheidungen vom 2026-10-15:**

- Die Familie wird als eigenständige Familie weiterentwickelt.
- Geprüft wird sie nach einem neuen Gates v4. Gates v4 bewertet ihren
  zusätzlichen Nutzen in einer **chronologischen Simulation mehrerer
  Strategie-Portfolios**, mit gleichem Gesamtkapital, vorab festen
  Kapitalplätzen und doppelter Risikoprüfung.
- Die zuerst vorgeschlagene Variante, offene Challenger-Positionen bei der
  Überschneidung zu ignorieren, ist **abgelehnt** und kommt nicht vor.
- Die Schwellen sind nach der Kalibrierungsprüfung angepasst
  (v4-Entwurf, Abschnitt 6).
- Gates v1–v3 und das Paket `@signalpilot/risk-engine` bleiben unverändert.
- Die Familie erhält eine eigene, klar unterscheidbare Forschungsidentität.

**Noch offen (Empfehlung jeweils „ja“):**

| # | Entscheidung | Inhalt |
|---|---|---|
| F1 | Startgenom und Raster | Abschnitt 6: 240 Konfigurationen, nur Einstiegsparameter |
| F2 | eigenständige Logik | kein Regime-Vorfilter im Evaluator, kein Regime-Exit; R-020 wirkt allein in der Risk Engine (Abschnitt 5) |
| F3 | Stufen und Budget | Stufe 1 nur das Startgenom, ohne KI. Stufe 2 nur nach bestandenem Screening und eigener Freigabe; höchstens 4 Validierungsprüfungen je Monat und 9 insgesamt |
| F4 | Abbruch | Scheitert das Startgenom im Screening, ist die Familie unter dieser Vorregistrierung geschlossen |
| F5 | Identität | Forschungsidentität `RESEARCH:REGIME_PULLBACK_LONG_V1` mit eigener Engine-Version und eigenem Spezifikations-Hash; der Challenger-Schlüssel dient nur als Replay-Hülle (Abschnitt 5.3) |
| F6 | Gates v4 und Simulation | Prüfregeln und die offenen technischen Entscheidungen T1–T10 siehe [Entwurf Gates v4](2026-10-15-evolution-gates-v4-draft.md), Abschnitt 11 |

Kosten der Stufe 1: 0 USD API, lokal grob 10–20 CPU-Minuten.
Mehrfachtest-Zähler N = 52 → 53 (55, falls das Startgenom ins Finale kommt).

## 2. Ausgangslage

- **Drei v3-Läufe am 2026-10-15** (siehe
  [Protokoll](2026-10-15-evolution-gates-v3-claude-runs.md)): 9 Kandidaten,
  alle verworfen.
  - Die Regime-Varianten teilen 98–100 % der Einstiege mit dem Challenger. Sie
    sind reine Ausstiegsvarianten.
  - Die Ausbruchsfamilie scheitert im Oktober 10 von 10 Mal, meist an
    2022-H2/2023.
  - Das Oktober-Validierungsbudget beider Familien ist ausgeschöpft.
  - N = 52, Schwelle √(2·ln 52) = 2,81.
- **R-020 bestimmt den Gelegenheitsraum jeder Long-Strategie.** Ein
  Long-Kandidat braucht `cryptoRegime = RISK_ON`, Risk Mode nicht
  `DEFENSIVE`/`HIGH_RISK`/`UNKNOWN` und Konfidenz ≥ 60.
- **Der Challenger nutzt diesen Raum fast vollständig.**
  - Er steigt bei offenem Gate beim nächsten Scan neu ein.
  - Er ist 25,5 % der Zeit im Markt (Entdeckung + Validierung, BTC + ETH),
    bei einem Gate-Anteil von rund 30 % (Regime-Studie 2018–2023).
- **Folge unter v3:** Jede Long-Familie hat rund 100 % „bespielte
  Einstiege“ (v3 zählt offene Referenzpositionen). Pfad B ist damit
  unerreichbar.
  - Das gilt für Pullback, Mean-Reversion und Volatilitätsausbruch
    gleichermaßen.
  - Pfad A misst gegen den Challenger Trade-Kennzahlen wie Ø R, PF und
    Trade-Zahl. Eine Strategie mit 72 h Haltedauer kann sie bauartbedingt nicht
    erreichen (Abschnitt 7).
  - Deshalb gibt es Gates v4.

## 3. Drei Ansätze im Vergleich

Alle drei Ansätze wurden nur strukturell und ökonomisch verglichen. Es wurde
keine Regel auf irgendeinem Zeitraum gerechnet.

| | Trend-Pullback | Mean-Reversion gegen den Trend | Volatilitätsausbruch |
|---|---|---|---|
| Einstieg | Rücksetzer mit Umkehrbestätigung | Kapitulation in `RISK_OFF`/`NEUTRAL` kaufen | Ausbruch nach Volatilitätskompression |
| Ertragsquelle | kurzfristige Umkehr (Liquiditätsprämie nach Zwangsverkäufen) zusätzlich zum Trend | Umkehr nach Überschießen, unabhängig vom Trend | Fortsetzung, also Trend und Momentum |
| Unter R-020 handelbar? | ja, die Risk Engine lässt nur Einstiege bei `RISK_ON` durch | **nein** außerhalb von `RISK_ON`; innerhalb wird der Ansatz zum Trend-Pullback | ja |
| Zeitpunkt gegenüber Champion | entgegengesetzt (kauft Schwäche statt eines 20h-Hochs) | – | ähnlich (kauft Stärke) |
| Ertragsquelle gegenüber Challenger | neu (Umkehr) auf geteiltem Trend-Beta | – | gleich (Trend) |
| Bekannte Schwäche | Regimewechsel: Der Rücksetzer ist der Beginn des Abschwungs | – | Ausbruchsfamilie scheitert wiederholt an 2022-H2/2023 |
| Urteil | **gewählt** | ausgeschlossen (Risk-Regel, siehe Abschnitt 12) | verworfen: gleiche Ertragsquelle wie beide Bestehenden |

Innerhalb von R-020 ergänzt nur der Trend-Pullback die bestehenden
Strategien mit einer **anderen Ertragsquelle** und einem **anderen Zeitpunkt**:

- Der Champion kauft Stärke.
- Der Challenger hält das Regime.
- Die neue Familie kauft vorübergehende Schwäche und ist nach spätestens drei
  Tagen wieder draußen.

## 4. Ökonomische Idee

**Warum es funktionieren könnte:**

- In Krypto-Aufwärtsphasen ist viel Hebel im Markt.
- Schnelle Rückgänge lösen Liquidationen und Margin-Verkäufe aus. Das sind
  Verkäufe unabhängig vom Informationsstand.
- Wer in diesen Momenten Liquidität stellt, wird für das Risiko bezahlt: Der
  Preis kehrt kurzfristig teilweise zurück.
- Diese Prämie für kurzfristige Umkehr und Liquiditätsbereitstellung ist umso
  größer, je erzwungener und schneller die Bewegung war.
- Deshalb misst die Familie den Rücksetzer **in Tagesvolatilität (ATR 1d)**
  und **über ein kurzes Fenster**. Optional verlangt sie ein Volumen, das
  nach Kapitulation aussieht.
- Die Familie kennt kein Regime. Dass sie nur bei `RISK_ON` handelt, erzwingt
  allein die Risk Engine.

**Warum es scheitern kann:**

- Der Rücksetzer ist der erste Schritt eines Abschwungs. Einen Regime-Exit
  gibt es nicht, also begrenzen nur Stop und 72 h den Verlust.
- Kaskaden laufen weiter, als die Umkehrkerze vermuten lässt.
- Die Prämie wird durch Wettbewerb kleiner.
- Kosten von 0,28 % je Round-Trip bei rund 7,7 % Stopabstand sind etwa
  0,04 R je Trade. Das ist tragbar, frisst aber einen kleinen Vorteil.

**Beitrag zum Portfolio:** Die Familie soll an Tagen, an denen der
Challenger nur Beta hält, einen eigenen kurzfristigen Ertrag liefern, bei
geringer Kapitalbindung. Ob das stimmt, prüft Gates v4 in der
chronologischen Portfolio-Simulation, Bestand ohne und mit der Familie:

- Netto-Zuwachs nach Kosten, Sharpe, Rendite je Drawdown;
- Risiko- und Kapitaleffizienz;
- ein statistisch belastbarer Zusatzertrag (P9);
- ein eigenes α gegenüber den bestehenden Strategien (P8).

## 5. Regeln

### 5.1 Einstieg (Bewertung zu jedem Schluss einer 1h-Kerze C0)

| Nr. | Bedingung | fest / suchbar |
|---|---|---|
| E1 | Rücksetzertiefe: (höchstes Hoch der `pullbackLookbackHours` 1h-Kerzen vor C0 − Schluss C0) ÷ ATR(14, 1d) ≥ `pullbackDepthAtr1d`. Bestehender Helfer `priorPeriodHigh`, C0 liegt nicht im Fenster | suchbar |
| E2 | Umkehrkerze, wenn `requireReversalCandle`: Schluss C0 > Eröffnung C0 **und** Schluss C0 > Schluss C−1 | suchbar |
| E3 | Kapitulationsvolumen, wenn `capitulationVolumeMinimum` > 0: höchstes relatives Volumen der letzten 6 geschlossenen 1h-Kerzen (C0 eingeschlossen, je gegen den Schnitt der 20 Kerzen davor) ≥ Minimum | suchbar |
| E4 | kritische bärische Kontext-Events blockieren (wie bei allen Long-Strategien) | fest |
| E5 | Gültigkeit 2 h, Einstiegslücke ≤ 0,5 × ATR(14, 1h) (Standard aller Long-Strategien) | fest |

**Kein Regime-Vorfilter.** Der Evaluator erzeugt einen Kandidaten auch
außerhalb von `RISK_ON`. Die Risk Engine lehnt ihn dort mit R-020 ab, wie
jeden anderen Long-Kandidaten. So bleibt die Einstiegslogik frei von der
Logik des Challengers, und R-020 wird weder umgangen noch dupliziert.

### 5.2 Preisplan und Ausstieg: fest, nicht suchbar

| Teil | Wert | Bemerkung |
|---|---|---|
| Stop | Einstieg − 2 × ATR(14, 1d), auf den Tick abgerundet | üblicher Schutz-Stop für Tagesschwankungen; gleiches Risiko je Trade wie beim Challenger, damit der Vergleich in der Portfolio-Simulation nicht von der Stopgeometrie lebt |
| Ziel | Einstieg + 4 × Stopabstand, auf den Tick abgerundet, Mindest-CRV 2 brutto | R-008 (netto 2R) braucht einen Stop ≥ 0,42 %, das ist immer erfüllt. Bei 72 h praktisch nur Obergrenze |
| Zeit-Exit | 72 h | kurzfristige Umkehrprämie über ein bis drei Tage |
| Regime-Exit | **keiner** | Er wäre die Ausstiegslogik des Challengers. Im Replay wird er ausdrücklich abgeschaltet (`regimeExit.enabled = false`), weil die technische Hülle sonst die `exitPolicy` des Challengers erben würde |
| Größe, Kosten, Risk-Regeln | 0,25 % Risiko je Trade, `BINANCE_SPOT_VIP0_ESTIMATE_V1`, Risk Engine `SPEC` | unverändert |

### 5.3 Identität und was die Familie nicht ist

- Kein Hebel, kein Short, keine Derivate, keine neue Datenquelle.
- Keine Änderung an Stop, Ziel oder Haltedauer durch die KI.
- **Eigene Forschungsidentität**, maßgeblich in jeder Evolution-Zeile, jedem
  Bericht und im Dashboard:
  - Schlüssel `RESEARCH:REGIME_PULLBACK_LONG_V1`;
  - Engine-Version `crypto-regime-pullback-research-v1/1.0.0`;
  - Spezifikations-Hash über Familienspezifikation und Genom.
- **Replay-Hülle, nur technisch:**
  - Replay und Risk Engine verlangen einen registrierten, freigegebenen
    Schlüssel (`R-005`, `APPROVED_LONG_STRATEGY_KEYS`).
  - Innerhalb des Replays trägt der Kandidaten-Entwurf deshalb Schlüssel und
    Spezifikations-Hash des Challengers. Gespeichert wird das nur im Feld
    `replayHull`.
  - Das ist bei allen Evolution-Genomen so. Wiederverwendet wird dabei nur
    die Identität als Hülle, **nicht** der Evaluator des Challengers.
- **Schutz vor falscher Zuordnung und vor einer Umgehung der Freigabeliste**
  (v4-Entwurf, Abschnitt 7):
  - kein Registry-Eintrag;
  - keine Abhängigkeit des Live-Pfads von `@signalpilot/evolution`;
  - Zuordnung der Trades über das Portfolio, nie über den Schlüssel;
  - keine Forward-Freigabe unter dem Challenger-Schlüssel;
  - Regime-Exit der Hülle abgeschaltet.
- **Für einen Forward-Test** sind ein eigener registrierter Schlüssel und ein
  gesonderter Beschluss über die Freigabeliste nötig. Ohne diesen Beschluss
  lehnt die unveränderte Risk Engine den Schlüssel ab.

## 6. Geschlossener Parameterraum

| Parameter | Art | Werte | Anzahl |
|---|---|---|---:|
| `pullbackLookbackHours` | ganzzahlig, Werteliste | 24, 48, 72, 120, 168 | 5 |
| `pullbackDepthAtr1d` | dezimal | 0,75 bis 2,5 in Schritten von 0,25 | 8 |
| `requireReversalCandle` | boolesch | false, true | 2 |
| `capitulationVolumeMinimum` | dezimal, Werteliste | 0 (aus), 2, 3 | 3 |
| **Raster gesamt** | | | **240** |

- **Startgenom** (Generation 1, vorab festgelegt, nicht an Daten angepasst):
  Fenster 72 h, Tiefe 1,5 × ATR(1d), Umkehrkerze verlangt, Volumenfilter aus.
  - 72 h entspricht dem Haltehorizont: Einem Rücksetzer, der sich in höchstens
    drei Tagen gebildet hat, werden höchstens drei Tage zur Umkehr gegeben.
  - 1,5 ATR ist die übliche Konvention für einen „deutlichen“ Ausschlag.
  - Die Umkehrkerze ist die vorsichtige Wahl gegen das Greifen ins fallende
    Messer.
  - Der Volumenfilter bleibt aus, damit das Startgenom minimal bleibt.
- **Nachbarvarianten des Startgenoms** (Finale, vorab festgelegt): Tiefe 1,25
  und 1,75, alles andere gleich.
- **Je Hypothese** höchstens 3 Änderungen gegenüber genau einer
  Elternstrategie (unverändert).
- **Plausibilität:** Das Raster braucht höchstens 168 + 1 Stunden-Kerzen. Die
  Eingabe liefert 250 (mindestens 200). Kosten-Geometrie und Grenzen sind in
  allen 240 Konfigurationen gültig.

## 7. Warum v3 diese Familie nicht sinnvoll prüfen kann

Die Werte unten sind begründete Schätzungen. **Gemessen wurde nichts.**

**Pfad B von v3:**

- Gegenüber dem Challenger lägen die „bespielten Einstiege“ bei ≈ 100 %, weil
  er im Gate fast immer hält.
- Die Korrelation der Tagesrenditen läge grob bei √(Zeit im Markt der Familie
  ÷ Zeit im Markt des Challengers). Unter 0,5 bliebe sie nur bei weniger als
  6,4 % Zeit im Markt, also höchstens etwa 45 Trades je Symbol.

**Pfad A von v3 gegen den Challenger** (Entdeckung + Validierung: 121 Trades,
Ø R +0,42, PF 2,35, Sharpe 1,07, Drawdown 0,94 %, Ø R Validierung 0,48)
verlangt unter anderem:

- Ø R in der Validierung ≥ 0,43. Bei 2 × ATR(1d) (Ø 7,7 %) bräuchte jeder
  72-h-Trade im Schnitt rund +3,3 %.
- PF ≥ 2,12, obwohl Zeit-Exits den PF Richtung 1 ziehen.
- ≥ 97 Trades, was gegen die Selektivität für Pfad B steht.

Diese Werte messen vor allem die Haltedauer, nicht die Qualität. Gates v4
ersetzt beides durch den Vergleich in der chronologischen
Portfolio-Simulation. Die
Trade-Kennzahlen bestehender Strategien gelten dort nur bei vergleichbarer
Geometrie als Mindestwerte (v4, Abschnitt 5.2). Gegenüber dem Challenger
(Ø Haltedauer rund neun Tage gegen höchstens drei) ist das voraussichtlich
nicht der Fall. Gegenüber dem Champion entscheidet die gemessene Geometrie.

## 8. Prüfverfahren

- **Regeln:** [Gates v4](2026-10-15-evolution-gates-v4-draft.md), Abschnitt 5:
  - v1-Basisprüfungen mit absoluten Schwellen;
  - `INDEPENDENT_FAMILY` (einschließlich Identität) und `TRADE_GEOMETRY`;
  - Portfolio-Mehrwert P1–P7;
  - Statistik P8 (eigenes α) und P9 (belastbarer Zusatzertrag des
    Gesamtportfolios), beide mit Mehrfachtest-Schwelle;
  - Finale mit den Nachbarn aus Abschnitt 6, Walk-Forward und Holdout nur als
    Schutz.
- **Simulation:** chronologisch, mit gleichem Gesamtkapital und festen Plätzen
  à 20 000 USDT.
  - Vergleich A: Champion, Challenger, freigegebene Kandidaten und ein
    Reserveplatz als Kasse.
  - Vergleich B: die Familie auf dem Reserveplatz.
  - Jeder Einstieg wird in Stufe 1 vollständig von der unveränderten Risk
    Engine gegen das eigene Portfolio geprüft und in Stufe 2 nur begrenzend
    gegen die Gesamtsicht.
  - Das Startgenom ist keine Wurzel und nie Teil des Bestands.
- **Abstammung:** Das Startgenom ist der Familienstart (`SEED:REGIME_PULLBACK_LONG_V1`,
  Generation 1). Eine Bezugswurzel aus einer anderen Familie gibt es nicht.
- **Budget:** v3/v4 erlaubt 10 Validierungsprüfungen je Familie und Monat.
  Diese Vorregistrierung begrenzt die Familie strenger auf 4 je Monat und 9
  insgesamt, davon eine für das Startgenom. Weitere Hypothesen werden ohne
  Backtest verworfen (`FAMILY_PREREGISTRATION_LIMIT`).

### Stufen und Abbruch

1. **Festschreiben.**
   - Diese Datei und der v4-Entwurf werden zu Vorregistrierungen.
   - Hashes über Familienspezifikation, Startgenom, Nachbarn und
     Budgetgrenzen werden im Code festgenagelt und im Manifest jedes
     Durchlaufs gespeichert. Dazu kommt ADR 0019.
2. **Stufe 1, nur das Startgenom.**
   - `evolution evaluate-seed --family=REGIME_PULLBACK_LONG`, ohne
     KI-Aufruf.
   - Backtest Entdeckung + Validierung für BTC und ETH, Gates v4,
     gegebenenfalls Finale.
   - Ergebnis: Bericht an den Betreiber.
3. **Abbruch nach F4.**
   - Scheitert das Startgenom im Screening, ist die Familie unter dieser
     Vorregistrierung geschlossen.
   - Es gibt keine KI-Suche im Raster, um doch noch eine passende
     Konfiguration zu finden. Ein neues Startgenom braucht eine neue
     Vorregistrierung.
4. **Stufe 2, nur nach bestandenem Screening und eigener Freigabe.**
   - Höchstens zwei KI-Durchläufe je Monat mit je höchstens zwei Hypothesen.
   - Elternstrategien sind das Startgenom und Kandidaten der Familie, die das
     Screening bestanden haben.
   - Kosten rund 0,19–0,22 USD je Durchlauf, schlechtester Fall 0,40 USD.
5. **Forward.** Ein Vorschlag ist nur ein bestandener historischer Test. Ein
   eigener Shadow-Forward-Test bräuchte eigene Freigaben: eigene
   Strategie-Identität, eigenes Portfolio, Arena-`CANDIDATE`. Er setzt
   außerdem voraus, dass der Betreiber vorher über den Eintrag in
   `APPROVED_LONG_STRATEGY_KEYS` entscheidet (v4-Entwurf, Abschnitt 11).

## 9. Nötige Erweiterungen (erst nach Freigabe)

| Bereich | Änderung |
|---|---|
| `packages/strategy-engine` | Neue Datei `crypto-regime-pullback-research-v1.ts` mit `evaluateRegimePullbackResearchV1(snapshot, identity)`. Die Identität ist `{ ...REGIME_LONG_V1_IDENTITY, pullbackResearch, researchIdentity }`: Die Challenger-Felder dienen nur als Replay-Hülle, `researchIdentity` trägt Schlüssel, Engine-Version und Spezifikations-Hash der Familie (gleicher Vertrag wie `regimeResearch`: nie registriert, nie als StrategyVersion angelegt). Sie nutzt `validateStrategyInput`, `refuse`, `buildEvidence`, `averageTrueRange`, `priorPeriodHigh`, `relativeVolume` und die Tick-Ausrichtung. Sie nutzt **nicht** `regimeGateOpen` und keinen anderen Einstiegs-Evaluator. Den Helfer für das höchste relative Volumen der letzten 6 Kerzen enthält die neue Datei selbst, nicht `indicators-v1.ts`. Reason-Codes für Tiefe, Umkehrkerze und Volumen sowie ein Indikator-Typ für den Kandidaten kommen additiv hinzu. `crypto-regime-long-v1.ts`, Registry, Spezifikations-Hashes und Golden Fixtures bleiben byte-gleich |
| `packages/evolution` | `genome.ts`: Familie `REGIME_PULLBACK_LONG` in `FAMILY_SPECS` mit Beschreibung `independence` (Evaluator, „nur Einstieg“, feste Ausstiege, Vorregistrierungs-Hash); `EVOLUTION_FAMILY_SEEDS` mit Startgenom, Nachbarn und Budgetgrenzen; Zweig in `genomeReplayPlan` (Hülle `CRYPTO_REGIME_LONG_V1`, `hooks.evaluate` auf den neuen Evaluator, `regimeExit: { enabled: false }`); `distanceFromRoot` misst bei Familien mit Startgenom gegen das Startgenom. `lineage.ts`: Präfix `RPB` (`EVO-RPB-0001`), Startgenom als Generation 1. `context.ts`/`prompt.ts`: Familie, feste Ausstiege, Restbudget. `mock-provider.ts`: deterministische Hypothesen für Tests. `EVOLUTION_ROOTS` bleibt unverändert. Gates: siehe v4-Entwurf, Abschnitt 9 |
| `packages/shadow-replay` | chronologische Portfolio-Simulation `runPortfolioReplay` und Gruppenprüfung `group-risk-v1` (v4-Entwurf, Abschnitte 3, 4 und 10) |
| `apps/evolution-worker` | Portfolio-Simulation A/B für eigenständige Familien in Schritt 5d; Forschungsidentität in allen gespeicherten Zeilen, Hülle nur in `replayHull`; `FAMILY_PREREGISTRATION_LIMIT` vor dem Backtest; `evaluate-seed`. Der Befehl ruft keine KI auf, verweigert einen zweiten Lauf desselben Startgenoms und verweigert den Lauf, wenn der Hash im Code nicht zur Vorregistrierung passt |
| `apps/dashboard` | Familien-, Reason-Code- und Prüfungsbeschriftungen, Vergleich A/B; nur lesend |
| Datenbank | keine Migration (`EvolutionCandidate.family` ist `String`, Ergebnisse liegen in JSON-Feldern) |

**Tests:**

- Evaluator: kein Rücksetzer, Umkehr fehlt, Volumen fehlt, Preisplan,
  Determinismus.
- Außerhalb von `RISK_ON` lehnt die Risk Engine ab (R-020), und der Evaluator
  selbst prüft kein Regime.
- Kein Regime-Exit im Replay.
- Import-Graph ohne fremden Einstiegs-Evaluator.
- Identität:
  - jede gespeicherte Zeile trägt `RESEARCH:REGIME_PULLBACK_LONG_V1`;
  - die Hülle steht nur in `replayHull`;
  - kein Kandidaten-Trade wird dem Challenger zugeordnet;
  - die Registry-Zuordnung des Challenger-Schlüssels ist unverändert.
- Genom: 240 Konfigurationen, Startgenom gültig und normalisiert, Hash
  festgenagelt, Hashes bestehender Genome unverändert.
- Bestehende Hash-Tests für Challenger, Champion und Gates v1–v3 bleiben
  unverändert grün.

## 10. Mehrfachtest-Zähler

Der Zähler wird nie zurückgesetzt. Er zählt die 30 Trainingskonfigurationen
der Vorforschung plus jede auf Entdeckung + Validierung geprüfte
Konfiguration (Kandidaten und Nachbarn, alle Familien und Gate-Versionen).
Für die neue Familie gilt dieselbe Zählung, ohne Sonderregel.

| Stand | N | √(2·ln N) |
|---|---:|---:|
| heute | 52 | 2,81 |
| nach Stufe 1, Startgenom verworfen | 53 | 2,82 |
| nach Stufe 1, Startgenom im Finale (+2 Nachbarn) | 55 | 2,83 |
| Höchstwert unter dieser Vorregistrierung (9 Kandidaten, höchstens 5 Finalisten mit je 2 Nachbarn) | 71 | 2,92 |
| theoretische Obergrenze des Rasters (alle 240, nur mit weiteren Vorregistrierungen) | 292 | 3,37 |

Die Werte gelten, wenn keine andere Familie läuft; jede andere Prüfung
erhöht N zusätzlich. Die Schwelle des α-Tests (v4 P8) ist
max(2; √(2·ln N); t-Quantil).

## 11. Welche Daten die Idee bereits gesehen haben

| Daten | Zeitraum | gesehen von | Bezug zu dieser Idee |
|---|---|---|---|
| Vorforschung, Training: 30 Konfigurationen, Regime- und Bedingungsstudie ([Training](2026-10-14-training-results.md)) | 2018-03 → 2023-12 | Betreiber, frühere Sitzungen, dieser Entwurf | **direkt.** Zwei Befunde passen zur Idee und waren beim Entwurf bekannt: RSI(1h) im Band 50–72 hatte einen negativen 24h-Spread, Stunden mit sehr hoher Volatilität (Stop über der Kappe) eine deutlich höhere Folgerendite. Beides gilt für alle Stunden, nicht nur für `RISK_ON`, und ist kein Beleg |
| Regime-Studie Training und Test | 2018-03 → 2026-10-14 | wie oben | direkt: Über R-020 handelt die Familie nur, wenn das Gate offen ist |
| Evolution-Entdeckung: Kennzahlen von 2 Wurzeln und 19 Kandidaten, Marktbedingungs-Analysen | 2018-04 → 2022-06 | Claude (Hypothesen-KI), Betreiber, dieser Entwurf | indirekt: keine Rücksetzer-Kennzahl, aber Regime- und Volatilitätsbefunde |
| Evolution-Validierung: Urteile (KI) und Kennzahlen (Protokolle) von 21 Konfigurationen | 2022-07 → 2023-12 | Betreiber, dieser Entwurf | indirekt: 2022-H2/2023 ist als schwierig für Ausbrüche bekannt |
| Holdout: Test von K1/K2, Regime-Studie, Holdout-Werte von EVO-REG-0004 | 2024-01 → 2026-10-14 | Betreiber, frühere Sitzungen | `PREVIOUSLY_ANALYZED`, nie Nachweis |
| Vorwissen des Sprachmodells, das diesen Entwurf schreibt | bis etwa Mitte 2026 | dieser Entwurf | nicht ausschließbar: Der Kursverlauf von BTC und ETH, etwa die Rücksetzer im Bullenmarkt 2021, ist Teil des Trainingswissens |
| Forward | ab 2026-10-15 | niemand | die einzige saubere Evidenz |

**Folgerung:**

- Kein Zeitraum vor dem 2026-10-15 ist für diese Idee unberührt.
- Ein bestandener historischer Test heißt nur „nicht widerlegt“.
- Die Wahl Trend-Pullback statt Volatilitätsausbruch beruht auf strukturellen
  Gründen (R-020, Zustand der Ausbruchsfamilie). Sie beruht nicht auf
  Kennzahlen einer Rücksetzer-Regel, denn keine wurde gerechnet.
- Auch die Entscheidung gegen den Regime-Vorfilter und den Regime-Exit
  beruht nur auf der Vorgabe der Eigenständigkeit, nicht auf Ergebnissen.

## 12. Was echte Eigenständigkeit außerhalb von RISK_ON bräuchte (nicht Teil dieses Entwurfs)

Das größte ungenutzte Diversifikationspotenzial liegt außerhalb von
`RISK_ON`, wo heute keine Strategie handelt:

- **Mean-Reversion nach Kapitulation in `NEUTRAL`/`RISK_OFF`:** braucht eine
  andere Regime-Regel als R-020.
- **Synthetischer Short in `RISK_OFF`:** braucht das Öffnen von
  `R-005-LONG-ONLY` (ADR 0011–0013).

Beides ändert die Risk Engine. Das ist nach der Vorgabe des Betreibers
ausgeschlossen und bräuchte eine eigene Grundsatzentscheidung.

## 13. Einschätzung

- Unter v4 ist die Hürde hoch, aber sachgerecht. Die Familie muss in der
  chronologischen Simulation, bei gleichem Kapital und festen Plätzen,
  - das Gesamtportfolio nach Kosten in beiden Zeiträumen verbessern;
  - Rendite je Drawdown halten;
  - ihr zusätzliches Risiko und Kapital ausreichend verzinsen;
  - einen statistisch belastbaren Zusatzertrag (P9) mit eigenem α (P8)
    liefern.
- Die Erfolgsaussicht des Startgenoms schätze ich trotzdem als gering ein,
  eher 1 zu 10 als 1 zu 2. Kurzfristige Umkehrprämien sind klein, und
  t ≥ 2,82 verlangt ein jährliches Informationsverhältnis von rund 1,2 (bei
  IR 1,0 liegt die Chance bei 34 %).
- **Warum es sich trotzdem lohnt:** Stufe 1 kostet keine API-Gebühren und
  erhöht N um 1 bis 3. Das Ergebnis beantwortet die Frage, ob
  Einstiegs-Timing innerhalb des Regimes etwas Eigenes verdient.
- **Was dieser Entwurf nicht tut:** Er gibt keine Strategie frei, startet
  keinen Lauf, berührt keinen VPS und handelt kein Echtgeld.
