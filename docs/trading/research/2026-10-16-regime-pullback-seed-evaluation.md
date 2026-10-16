# REGIME_PULLBACK_LONG — Bewertung des vorregistrierten Startgenoms (Stufe 1)

Datum: 2026-10-16 · lokal (Mac, Dev-Datenbank) · Lauf
`EVO-RUN-20261016T102124-0fdd6e` · Kandidat **EVO-RPB-0001** · Code
`a468d27` · Gates `evolution-gates-v4` (Hash `8f55cf8e…`) · Vorregistrierung
der Familie `b96bcc97…` ·
[Vorregistrierung](2026-10-16-evolution-family-regime-pullback-preregistration.md)

> Historische Simulation mit eingefrorenem Kostenmodell
> (BINANCE_SPOT_VIP0_ESTIMATE_V1). Kein Forward-Ergebnis, keine Prognose,
> keine Handelsempfehlung. Kein Claude-API-Aufruf, kein Echtgeld, keine
> Freigabe. Der offizielle VPS-Forward-Test, Champion, Challenger, Risk Engine
> und Arena blieben unberührt. Der Agent blieb pausiert.

## Ergebnis in einem Satz

Das Startgenom erhöht die Rendite des Gesamtportfolios bei gleichem Kapital
nur leicht (+0,51 Prozentpunkte über 5¾ Jahre, Sharpe +0,04). Dieser Zuwachs
ist aber **kein eigener Ertrag**: Er wird vollständig durch das gemeinsame
Long-Engagement im `RISK_ON`-Regime erklärt (eigenes α t = −0,34) und ist
statistisch nicht belastbar (Zuwachs-t = 0,75 bei Schwelle 2,82). Das
Startgenom ist **verworfen**; die Familie ist unter dieser Vorregistrierung
**geschlossen (F4)**.

## 1. Lauf

| | |
|---|---|
| Befehl | `evaluate-seed --family=REGIME_PULLBACK_LONG`, genau wie in der Vorregistrierung (Abschnitt 10), vorher `--check` (ok) |
| Genom | 72 h Fenster, Tiefe 1,5 × ATR(14, 1d), Umkehrkerze verlangt, Volumenfilter aus (Genom-Hash `cb8e72d9…`) |
| Daten | `data/market-snapshots/real`, Fingerprint `5c7459f3…`, Abschluss 2026-10-14T23:59:59.999Z, keine Forward-Daten |
| Fenster | Entdeckung 2018-04-01 – 2022-06-30, Validierung 2022-07-01 – 2023-12-31. Den Holdout hat der Kandidat nicht erreicht (kein Finalist) |
| Dauer | 19,7 min Wandzeit, 6 Prozesse. Neu gerechnet wurden 4 Benchmarks und 2 eigene Backtests sowie Vergleich A (11,2 min) parallel zu Vergleich B (14,1 min) |
| Kosten | 0 USD; es gab keinen KI-Anbieter |
| Betriebliche Grenzen | Job-Timeout 4 h, Lease 12 h, 3 GB Heap je Prozess. So konnte ein Timeout das einmalige Startgenom nicht technisch verbrauchen. Das sind keine Forschungsparameter |
| Mehrfachtest | N = 52 → **53** (Schwelle √(2·ln 53) = 2,82) |
| Familienbudget | 1 von 4 Prüfungen im Monat, 1 von 9 insgesamt; v4-Monatslimit 1 von 10 |
| Audit | Kette intakt, 74 Ereignisse |

## 2. Die Strategie allein (eigene Backtests, BTC und ETH je 10 000 USDT)

| | Entdeckung | Validierung | Entdeckung + Validierung | Challenger (E+V) | Champion (E+V) |
|---|---:|---:|---:|---:|---:|
| Trades | 57 | 23 | **80** (BTC 42, ETH 38) | 121 | 151 |
| Trefferquote | 49 % | 52 % | 50 % | – | – |
| Profit Factor | 1,35 | 1,94 | **1,46** | 2,35 | 1,16 |
| Ø R je Trade | +0,07 | +0,11 | **+0,08** (t = 1,13) | +0,42 | +0,11 |
| Nettorendite (auf 20 000) | +0,50 % | +0,33 % | **+0,83 %** (+165 USDT, 0,14 % p. a.) | +6,50 % | +1,97 % |
| Sharpe | 0,33 | 0,56 | **0,40** | 1,07 | 0,30 |
| Max. Drawdown | 0,55 % | 0,35 % | **0,55 %** | 0,94 % | 2,19 % |
| Zeit im Markt | 5,1 % | 6,2 % | 5,4 % | 25,5 % | 2,5 % |
| Ø Haltedauer | 68 h | 71 h | 69 h | 213 h | 17 h |
| Ø R bei doppelten Kosten | +0,05 | +0,07 | +0,05 | – | – |

- **Je Symbol** (E+V): BTC 42 Trades, +83 USDT, PF 1,45, Ø +0,08 R. ETH 38
  Trades, +82 USDT, PF 1,48, Ø +0,09 R.
- **Je Jahr:** 2019 elf Trades, +100 USDT. 2020 22 Trades, −26 USDT. 2021 24
  Trades, +26 USDT. 2023 23 Trades, +65 USDT. **2018 und 2022 gab es keinen
  Trade**: Das Regime war dort nicht `RISK_ON`.
- **Ausstiege:** 73 von 80 über den Zeit-Exit nach 72 h (zusammen +341 USDT),
  7 über den Stop (−175 USDT), **kein einziges 4R-Ziel**. Ø Gewinn +0,52 R,
  Ø Verlust −0,36 R.
- **Marktregime:** Alle 80 Trades wurden bei `RISK_ON` eröffnet; das ist
  die Wirkung von R-020.

Alle v1-Basisprüfungen sind bestanden (Tabelle in Abschnitt 4). Für sich
genommen ist das Startgenom also eine kleine, kostenfeste, robuste, aber sehr
schwache Strategie.

## 3. Portfolio-Vergleich A gegen B (chronologische Simulation, gleiches Kapital)

Gesamtkapital in beiden Vergleichen 60 000 USDT: drei Plätze à 20 000 USDT,
je Platz ein Portfolio mit BTCUSDT und ETHUSDT. Die Risk Engine prüft
unverändert in Stufe 1, Stufe 2 ist `group-risk-v1`.

- **A:** Champion + Challenger + Reserveplatz als Kasse.
- **B:** derselbe Bestand, der Kandidat auf dem Reserveplatz.

| Fenster | Netto A | Netto B | Δ Netto | Sharpe A | Sharpe B | Δ Sharpe | Max. DD A | Max. DD B | Rendite/DD A → B |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Entdeckung + Validierung | 3,31 % | 3,82 % | **+0,51 pp** | 0,50 | 0,54 | **+0,04** | 1,29 % | 1,52 % | 2,57 → 2,52 |
| Entdeckung | 3,07 % | 3,41 % | +0,34 pp | 0,59 | 0,62 | +0,03 | 1,29 % | 1,52 % | 2,39 → 2,24 |
| Validierung | 0,24 % | 0,40 % | +0,17 pp | 0,18 | 0,27 | +0,09 | 0,80 % | 0,90 % | 0,29 → 0,45 |

| Portfolio | Trades A | Trades B | Netto A (USDT) | Netto B (USDT) | Kill-Switch A / B | Gruppenablehnungen |
|---|---:|---:|---:|---:|---|---:|
| CRYPTO_TREND_CORE_LONG_V1 (Champion) | 138 | 138 | −543,57 | −543,57 | 24 / 24 | 0 |
| CRYPTO_REGIME_LONG_V1 (Challenger) | 122 | 122 | +2 529,73 | +2 529,73 | 13 / 13 | 0 |
| EVO-RPB-0001 (`RESEARCH:REGIME_PULLBACK_LONG_V1`, Hülle `CRYPTO_REGIME_LONG_V1`) | – | 79 | – | **+307,64** | – / 5 | 0 |

- **Zusätzliche Portfoliorendite:** +307,64 USDT auf 60 000 USDT, also
  +0,51 Prozentpunkte über 5¾ Jahre, rund **+0,09 pp p. a.** Im Mittel sind
  das +0,0074 % je Monat.
- **Bestand unverändert:** Champion und Challenger handeln in A und B
  identisch; die Ausgabe-Hashes sind gleich. Die Gruppenprüfung hat nie
  eingegriffen. Kein Kandidaten-Trade ist dem Challenger zugeordnet.
- **Kapitalbindung:** Ø 0,75 % → 0,84 % des Gesamtkapitals, Spitze 12,1 %
  bzw. 12,1 %.
- **Gleichzeitiges Risiko:** Ø 0,048 % → 0,057 %, Spitze 0,34 % → 0,50 %.
  Der Zuwachs verzinst beides ausreichend (Effizienz 60,3 gegen nötige 34,4
  beim Risiko, 5,76 gegen 2,21 beim Kapital).
- **Kosten:** Der Kandidat zahlt im Portfolio 117 USDT an Gebühren, Spread
  und Slippage, rund 28 % seines Bruttoergebnisses. Auch bei doppelten Kosten
  bleibt der Zuwachs positiv (+0,32 pp, Sharpe +0,03).
- **Gemeinsame BTC-/ETH-Verlustserien:** Das Kandidaten-Portfolio löste 5-mal
  den Kill-Switch aus. Rücksetzer kommen in BTC und ETH oft gleichzeitig; im
  selben Portfolio zählen sie zusammen in die Verlustserie (R-021). Das ist in
  A und B dasselbe Modell und verzerrt den Vergleich nicht.
- **Eigener Ertrag (α):** Die Monatsrenditen des Kandidaten wurden auf
  Champion und Challenger regressiert.
  - Ergebnis: β = 0,08 (Champion) und β = 0,20 (Challenger), α̂ = −0,009 %
    je Monat, **t = −0,34**, 69 Monate, R² = 0,35.
  - α̂ ist in der Entdeckung (−0,012 %) und in der Validierung (−0,009 %)
    negativ.
  - Der gesamte Ertrag des Kandidaten erklärt sich also durch seine
    Ähnlichkeit mit dem Challenger. Das α macht −39 % seines mittleren
    Monatsertrags aus.
- **Korrelation der Tagesrenditen:** 0,43 mit dem Challenger, 0,00 mit dem
  Champion. Bei 100 % der Einstiege hielt der Challenger bereits eine
  Position oder stieg binnen ±24 h ein (Champion 13 %). Diese Werte sind nur
  Bericht.

## 4. Alle Prüfungen

| Prüfung | Ergebnis | Wert | Grenze |
|---|---|---|---|
| TECHNICAL | bestanden | deterministisch, keine Invarianten verletzt | – |
| DATA_INTEGRITY | bestanden | kein Datenleck | – |
| MIN_TRADES | bestanden | 57 / 23 | ≥ 20 / ≥ 6 |
| DISCOVERY_EDGE | bestanden | +0,07 R, PF 1,35 | ≥ 0,05 R, PF ≥ 1,15 |
| VALIDATION_EDGE | bestanden | +0,11 R, PF 1,94 | > 0 R, PF ≥ 1 |
| COST_STRESS | bestanden | +105,61 USDT | > 0 |
| DRAWDOWN | bestanden | 0,55 % | ≤ 10 % |
| FOLD_STABILITY | bestanden | 75 % positive Phasen, größte 52 % | ≥ 50 % / ≤ 65 % |
| REDUNDANCY | bestanden | Korrelation 0,45 | ≤ 0,9 |
| BENCHMARK | bestanden | Sharpe 0,39 | gegen Champion 0,30 |
| LINEAGE_BUDGET (v4) | bestanden | 1 | ≤ 10 |
| INDEPENDENT_FAMILY (v4) | bestanden | vorregistriert `b96bcc97…` | – |
| TRADE_GEOMETRY (v4) | bestanden (nur Bericht) | Haltedauer ×3,6 gegen Champion, ×0,33 gegen Challenger | Faktor 2 |
| PORTFOLIO_NET_GAIN (v4) | bestanden | +0,51 / +0,34 / +0,17 pp | > 0 |
| PORTFOLIO_SHARPE_GAIN (v4) | bestanden | +0,04 / +0,03 / +0,09 | > 0 |
| **PORTFOLIO_DRAWDOWN (v4)** | **nicht bestanden** | Rendite/DD 2,57 → 2,52 und 2,39 → 2,24 (nur Validierung besser); max. DD 1,52 % | in allen Fenstern ≥ A; DD ≤ 10 % |
| PORTFOLIO_RISK_EFFICIENCY (v4) | bestanden | 60,32 | ≥ 0,5 × 68,82 |
| PORTFOLIO_CAPITAL_EFFICIENCY (v4) | bestanden | 5,76 | ≥ 0,5 × 4,42 |
| INCREMENT_STABILITY (v4) | bestanden | 3 von 4 Phasen positiv, größte 55 % | ≥ 50 % / ≤ 65 % |
| INCREMENT_COST_STRESS (v4) | bestanden | +0,32 pp / Sharpe +0,03 | > 0 / > 0 |
| **OWN_ALPHA (v4)** | **nicht bestanden** | t = −0,34, α̂ < 0 in beiden Fenstern | t ≥ 2,82 |
| **INCREMENT_SIGNIFICANCE (v4)** | **nicht bestanden** | t = 0,75, 69 Monate, 35 mit Unterschied | t ≥ 2,82 |
| **PORTFOLIO_DECISION (v4)** | **nicht bestanden** | PORTFOLIO_DRAWDOWN, OWN_ALPHA, INCREMENT_SIGNIFICANCE | – |

Evidenzgrad nach Mehrfachtest: **schwach** (t der R-Werte 1,13 bei Schwelle
2,82). Forschungs-Score 67,5 (er entscheidet nicht). Finale, Nachbarn und
Holdout wurden nicht gerechnet, weil das Screening scheiterte.

## 5. Woran es lag

**Fehlende Trades: nein.**

- 80 Trades bestanden die Stichprobenprüfung (57/23 gegen 20/6).
- Für die Statistik ist die Stichprobe dennoch klein: 13,9 Trades pro Jahr
  und 35 Monate, in denen sich B von A unterscheidet. In 2018 und 2022 gab es
  keinen Trade.

**Risiko-Sperren: nicht die Ursache; sie wirken wie vorregistriert.**

- Die Einstiegslogik meldete in 5 146 Stunden einen Einstieg (BTC 2 588,
  ETH 2 558). Die meisten sind Folgestunden derselben Rücksetzer.
- Die unveränderte Risk Engine lehnte ab:
  - 75 % außerhalb von `RISK_ON` (R-020, `MARKET_REGIME_CONFLICT`: 3 878);
  - 22 % bei offener Position (`DUPLICATE_ASSET_POSITION`: 1 135);
  - 25-mal wegen eines aktiven Kill-Switches, 10-mal wegen
    Nachkaufens, einmal wegen der Verlustserie.
- 97 Freigaben ergaben 80 Fills.
- Die Gruppenprüfung lehnte nie ab, und der Bestand blieb unverändert.
- R-020 nimmt der Familie den größten Teil der Signale. Gerade die
  verbleibenden Signale liegen aber in der Zeit, in der der Challenger
  ohnehin investiert ist.

**Einstiegslogik: Sie liefert Einstiege, aber kaum eigenen Vorteil.**

- Ø +0,08 R je Trade, Trefferquote 50 %.
- 91 % der Trades enden am 72-h-Zeit-Exit mit einem Bruchteil von R. Das
  4R-Ziel wird nie erreicht, der Stop nur siebenmal. Der Stop liegt bei
  2 × ATR(1d), im Median 9,9 % unter dem Einstieg (Mittel 10,9 %, Spanne
  5,4–32 %). Das ist weiter als die 7,7 % aus dem Entwurf, weil Rücksetzer in
  volatile Tage fallen. Eine Bewegung von wenigen Prozent in drei Tagen ist
  damit nur ein kleiner Bruchteil von R.
- In dieser Geometrie ist der Trade faktisch „Rücksetzer kaufen, drei Tage
  halten“. Bei 0,25 % Risiko je Trade bindet er nur wenig Kapital (Ø 0,09 pp
  des Gesamtkapitals zusätzlich).
- Der Ertrag je Trade ist klein und folgt dem Markt der folgenden drei Tage.

**Statistische Anforderungen: Sie entscheiden — und das klar, nicht knapp.**

- Das eigene α ist negativ (t = −0,34). Was der Kandidat verdient, verdient er
  durch dasselbe Long-Engagement im `RISK_ON`-Regime wie der Challenger
  (β = 0,20, Korrelation 0,43). Das Rücksetzer-Timing fügt dem nichts Eigenes
  hinzu.
- Der Portfolio-Zuwachs entsteht vor allem, weil ein bisher als Kasse
  gehaltener Platz nun etwas Krypto-Beta trägt. Genau diesen Fall soll
  `OWN_ALPHA` aussortieren. Die Gegenprobe vor der Festschreibung von v4 hatte
  ihn bei Kopien des Challengers gezeigt.
- Auch ohne Mehrfachtest-Korrektur, bei t ≥ 2, wären α (t = −0,34) und Zuwachs
  (t = 0,75) weit gescheitert. Eine andere Schwelle hätte das Urteil nicht
  geändert.
- `PORTFOLIO_DRAWDOWN` scheitert zusätzlich knapp: In der Entdeckung fallen
  die Verluste des Kandidaten in dieselben Korrekturen wie die des Bestands.

## 6. Folgen

- **F4: Die Familie REGIME_PULLBACK_LONG ist unter der Vorregistrierung
  `b96bcc97…` geschlossen.**
  - Die KI-Suche (Stufe 2) öffnet sich nicht, auch nicht mit
    `EVOLUTION_INDEPENDENT_FAMILY_SEARCH`; der Code meldet „Abbruch nach F4“.
  - Ein zweiter `evaluate-seed` wird verweigert.
  - Die übrigen 239 Rasterkonfigurationen werden nicht durchsucht.
- Keine Schwelle, kein Parameter, keine Gate-Version wurde nach dem Ergebnis
  geändert. Es lief keine Variante, kein Nachbar, kein Holdout.
- Mehrfachtest-Zähler N = 53. Ab der nächsten geprüften Konfiguration jeder
  Familie gilt die Schwelle 2,82.
- Datenstand: Entdeckung und Validierung sind für diese Idee jetzt zusätzlich
  „gesehen“. Den Holdout 2024–2026 hat EVO-RPB-0001 nicht berührt; er bleibt
  wie bisher `PREVIOUSLY_ANALYZED` durch frühere Forschung.

## 7. Was das Ergebnis bedeutet und was nicht

**Belegt** ist eine enge Aussage: Mit **diesen** eingefrorenen Regeln trägt
das Rücksetzer-Timing keinen eigenen Ertrag über das hinaus, was das
Challenger-Portfolio mit seinem Regime-Engagement ohnehin verdient. Die
Regeln sind:

- Rücksetzer ≥ 1,5 × ATR(1d) unter dem 72-h-Hoch, mit Umkehrkerze;
- 72 h Haltedauer, Stop 2 × ATR(1d), Ziel 4R;
- nur BTC und ETH, nur `RISK_ON`, 0,25 % Risiko je Trade.

Gemessen ist das über 2018–2023 bei gleichem Kapital und nach Kosten.

**Nicht widerlegt** ist damit die Idee kurzfristiger Umkehrprämien insgesamt.
Das Ergebnis sagt nichts über:

- Rücksetzer, die in Stunden-Volatilität und über Stunden statt Tage gemessen
  werden;
- Ausstiege, die zur Umkehrprämie passen: ein Ziel am vorherigen Hoch oder
  an einem Mittelwert, kürzere Haltedauer. Hier lief der Trade fast immer
  einfach aus;
- Signale aus Liquidations-, Funding- oder Orderbuchdaten; diese Daten hat
  SignalPilot nicht;
- andere Märkte als BTC und ETH;
- Rücksetzer außerhalb von `RISK_ON`. Dafür bräuchte es einen
  Grundsatzbeschluss über R-020; er ist ausgeschlossen.

Jede dieser Ideen bräuchte eine **neue Vorregistrierung** mit eigener
ökonomischer Begründung. Sie würde auf denselben, bereits mehrfach gesehenen
Daten 2018–2023 und gegen die steigende Mehrfachtest-Schwelle geprüft.

## 8. Einschätzung des Potenzials

- **Unter den heutigen Grenzen sehe ich in dieser Familie wenig Potenzial.**
  - Die Grenzen sind: Long-only, R-020, BTC/ETH, 1h-Daten, feste Positionsgröße.
  - Der Kern des Befunds ist strukturell, nicht eine Frage der Parameter:
    Unter R-020 handelt jede Long-Familie in denselben `RISK_ON`-Phasen, in
    denen der Challenger bereits investiert ist. Ihr Ertrag lädt deshalb
    zuerst auf denselben Faktor.
  - Ein eigenes α müsste aus dem Timing *innerhalb* dieser Phasen kommen. Beim
    Startgenom ist es negativ, nicht nur zu klein.
  - Andere Tiefen oder Fenster desselben Rasters würden daran
    voraussichtlich wenig ändern. Sie systematisch zu durchsuchen, wäre die
    Datensuche, die F4 verbietet.
- **Am ehesten lohnend** wäre eine Variante mit anderer Ertragsmechanik statt
  anderer Parameter:
  - Ausstieg auf die Umkehr selbst, also kurze Haltedauer, Ziel am Ausgangsniveau;
  - Rücksetzer in Stunden-Volatilität.
  - Auch dafür schätze ich die Chance, `OWN_ALPHA` bei t ≥ 2,82 zu bestehen,
    als gering ein. Es fehlt schlicht an Stichprobe: wenige Dutzend
    `RISK_ON`-Monate.
- **Größeres Diversifikationspotenzial** liegt dort, wo der Bestand nicht
  investiert ist: außerhalb von `RISK_ON`, auf der Short-Seite, in anderen
  Anlagen.
  - Das alles berührt Grundsatzentscheidungen: R-020, R-005, neue Daten.
  - Diese Entscheidungen trifft der Betreiber, nicht die Evolution Engine.
- **Belastbare Evidenz** für irgendeine dieser Ideen kann nur ein eigener
  Forward-Test ab 2026-10-15 liefern, nach ausdrücklicher Freigabe. Die
  Historie 2018–2023 ist dafür zu oft befragt worden.
