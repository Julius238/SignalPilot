# Entwurf: Vorregistrierung der Strategiefamilie REGIME_PULLBACK_LONG („Regime-Rücksetzer“)

> **Entwurf, noch nicht festgeschrieben.** Stand 2026-10-15, Basis Commit
> `0ca95f8`. Es gibt keine Code-Änderung, keinen Backtest, keinen KI-Lauf und
> keine Freigabe. Champion, Challenger, Risk Engine, Arena V1 und der
> offizielle VPS-Forward-Test bleiben unberührt. Festgeschrieben (mit Hash)
> wird erst nach den Entscheidungen in Abschnitt 1 und **vor** dem ersten
> Experiment. Gilt für Gates `evolution-gates-v3` (Hash `250bf745…`) und Split
> `evolution-split-v1`. Beide bleiben in diesem Entwurf unverändert.

## 1. Entscheidungsvorlage

**Empfehlung.** Als neue Familie dient ein Trend-Pullback im offenen
Regime: kaufen nach einem schnellen, volatilitätsbereinigten Rücksetzer mit
Umkehrkerze, höchstens 72 h halten. Das ist eine neue Einstiegslogik. Die
Ausstiege sind eingefroren und vollständig aus bestehenden Strategien
übernommen. Die KI darf in dieser Familie nur Einstiegsparameter ändern.

**Harte Grenze, die jeder neue Long-Ansatz trifft.**

- Die Risk Engine lässt Long-Einstiege nur bei Krypto-`RISK_ON` zu
  (`R-020-REGIME`, `RISK_REGIME_POLICY`).
- In dieser Zeit ist der Challenger fast immer im Markt.
- Deshalb hat **jede** Long-Familie, ob Pullback, Mean-Reversion oder
  Volatilitätsausbruch, nach dem v3-Maß nahezu 100 % „bespielte Einstiege“.
  Pfad B (Diversifikation) ist für sie unerreichbar.
- Pfad A (Mehrwert) misst gegen den Challenger auch Pro-Trade-Kennzahlen
  (Ø R, Profit Factor, Trade-Zahl). Eine Strategie mit 72 h Haltedauer kann
  sie strukturell nicht erreichen, selbst wenn sie risikobereinigt besser
  wäre (Abschnitt 7).
- **Darum muss die Prüfregel vor dem ersten Experiment entschieden werden.**
  Ein Lauf unter einer ungeeigneten Regel verbraucht die Idee: Das Startgenom
  wäre danach bekannt und für jede spätere Regel kein Nachweis mehr.

| # | Entscheidung | Optionen | Empfehlung |
|---|---|---|---|
| E1 | Familie | annehmen · ablehnen | **annehmen** (Implementierung erst nach eigener Freigabe) |
| E2 | Prüfregel | **A** v3 unverändert · **B** Gates v4 mit genau einer eng begrenzten Methodenänderung (Abschnitt 8.2) · **C** zurückstellen | **B**. Wer keine Gate-Änderung will, sollte **C** statt A wählen |
| E3 | Referenzen | Challenger als Bezugswurzel; bester Vertreter über REGIME_LONG und die neue Familie | **ja** |
| E4 | Startgenom und Raster | wie Abschnitt 6 (240 Konfigurationen) | **ja** |
| E5 | Stufen und Budget | Stufe 1 nur das Startgenom, ohne KI. Stufe 2 nur nach bestandenem Screening und eigener Freigabe; höchstens 4 Prüfungen je Monat und 9 insgesamt | **ja** |
| E6 | Abbruch | Scheitert das Startgenom im Screening, ist die Familie unter dieser Vorregistrierung geschlossen | **ja** |

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
  - Stand des Mehrfachtest-Zählers: N = 52, Schwelle √(2·ln 52) = 2,81.
- **R-020 bestimmt den Gelegenheitsraum jeder Long-Strategie.**
  - Ein Long-Kandidat braucht `cryptoRegime = RISK_ON`, Risk Mode nicht
    `DEFENSIVE`/`HIGH_RISK`/`UNKNOWN` und Konfidenz ≥ 60. Genau das ist die
    Einstiegsregel des Challengers.
  - Auch `skipRegime` in der Ausbruchsfamilie umgeht das nicht, weil die Risk
    Engine im Modus `SPEC` denselben Filter erzwingt.
- **Der Challenger ist der Dauerläufer dieses Raums.**
  - Er steigt bei offenem Gate beim nächsten Scan neu ein.
  - Er ist 25,5 % der Zeit im Markt (Entdeckung + Validierung, BTC + ETH),
    bei einem Gate-Anteil von rund 30 % (Regime-Studie 2018–2023). Grob ist er
    also während 85 % der offenen Gate-Zeit investiert.
  - Jede andere Long-Strategie steigt deshalb fast immer ein, während der
    Challenger eine Position hält oder binnen 24 h neu einsteigt. Das zählt
    v3 als „bespielte Gelegenheit“. Die Messung bestätigt es: Die
    Ausbruchs-Kandidaten lagen bei 100 %.
- **Folgerung:** „Wirklich eigenständig“ im Sinn von v3-Pfad B kann unter
  unveränderter Risk Engine keine Long-Familie sein.
  - Eigenständig sein kann nur der **Einstiegsauslöser**: wann innerhalb des
    erlaubten Raums gekauft wird und wie lange gehalten wird.
  - Der Gelegenheitsraum selbst kann nicht eigenständig sein.
  - Der Entwurf ist darauf ausgerichtet und benennt die Grenze offen.

## 3. Drei Ansätze im Vergleich

Alle drei Ansätze wurden nur strukturell und ökonomisch verglichen. Es wurde
keine Regel auf irgendeinem Zeitraum gerechnet.

| | Trend-Pullback | Mean-Reversion gegen den Trend | Volatilitätsausbruch |
|---|---|---|---|
| Einstieg | Rücksetzer im offenen Regime mit Umkehrbestätigung | Kapitulation in `RISK_OFF`/`NEUTRAL` kaufen | Ausbruch nach Volatilitätskompression |
| Ertragsquelle | kurzfristige Umkehr (Liquiditätsprämie nach Zwangsverkäufen) zusätzlich zum Trend | Umkehr nach Überschießen, unabhängig vom Trend | Fortsetzung, also Trend und Momentum |
| Unter R-020 zulässig? | ja | **nein**: Long außerhalb `RISK_ON` wird immer blockiert. Innerhalb `RISK_ON` wird der Ansatz zum Trend-Pullback | ja |
| Zeitpunkt gegenüber Champion | entgegengesetzt (kauft Schwäche statt eines 20h-Hochs) | – | ähnlich (kauft Stärke) |
| Ertragsquelle gegenüber Challenger | neu (Umkehr) auf geteiltem Trend-Beta | – | gleich (Trend) |
| Bekannte Schwäche | Regimewechsel: Der Rücksetzer ist der Beginn des Abschwungs | – | Ausbruchsfamilie scheitert wiederholt an 2022-H2/2023 |
| v3-Pfad B (≤ 50 % bespielt) | strukturell nein | – | strukturell nein |
| Urteil | **gewählt** | ausgeschlossen (Risk-Regel, siehe Abschnitt 12) | verworfen: wenig Ergänzung, gleiche Ertragsquelle wie beide Bestehenden |

Innerhalb von R-020 ergänzt nur der Trend-Pullback die bestehenden
Strategien mit einer **anderen Ertragsquelle** und einem **anderen Zeitpunkt**:

- Der Champion kauft Stärke.
- Der Challenger hält das Regime.
- Die neue Familie kauft vorübergehende Schwäche innerhalb des Regimes und ist
  nach spätestens drei Tagen wieder draußen.

## 4. Ökonomische Idee

**Warum es funktionieren könnte:**

- In Krypto-Aufwärtsphasen ist viel Hebel im Markt.
- Schnelle Rückgänge lösen Liquidationen und Margin-Verkäufe aus. Das sind
  Verkäufe unabhängig vom Informationsstand.
- Wer in diesen Momenten Liquidität stellt, wird für das Risiko bezahlt: Der
  Preis kehrt kurzfristig teilweise zurück, solange der übergeordnete Trend
  intakt ist.
- Das ist die klassische Prämie für kurzfristige Umkehr und
  Liquiditätsbereitstellung. Sie ist umso größer, je erzwungener und
  schneller die Bewegung war.
- Deshalb misst die Familie den Rücksetzer **in Tagesvolatilität (ATR 1d)**
  und **über ein kurzes Fenster**. Optional verlangt sie ein Volumen, das
  nach Kapitulation aussieht.

**Warum es scheitern kann:**

- Der Rücksetzer ist der erste Schritt eines Regimewechsels. Der feste
  Regime-Exit begrenzt das, verkauft aber dann in die Schwäche.
- Kaskaden laufen weiter, als die Umkehrkerze vermuten lässt.
- Die Prämie wird durch Wettbewerb kleiner.
- Die Kosten von 0,28 % je Round-Trip fressen einen kleinen Vorteil auf. Bei
  2 × ATR(1d) Stop sind das rund 0,04 R je Trade, das ist tragbar.

**Was die Familie zum Portfolio beitragen soll:** einen eigenen,
kurzfristigen Ertrag an Tagen, an denen der Challenger nur Beta hält. Dazu
geringe Kapitalbindung. Ob das ein echtes α ist, muss der α-Test gegen jede
bestehende Strategie einzeln zeigen.

## 5. Regeln

### 5.1 Einstieg (Bewertung zu jedem Schluss einer 1h-Kerze C0)

| Nr. | Bedingung | fest / suchbar |
|---|---|---|
| E1 | Regime-Gate offen wie beim Challenger (`RISK_ON`, Risk Mode erlaubt, Konfidenz ≥ 60). Spiegelt R-020, damit keine aussichtslosen Kandidaten entstehen | fest |
| E2 | Rücksetzertiefe: (höchstes Hoch der `pullbackLookbackHours` 1h-Kerzen vor C0 − Schluss C0) ÷ ATR(14, 1d) ≥ `pullbackDepthAtr1d`. Bestehender Helfer `priorPeriodHigh`, C0 liegt nicht im Fenster | suchbar |
| E3 | Umkehrkerze, wenn `requireReversalCandle`: Schluss C0 > Eröffnung C0 **und** Schluss C0 > Schluss C−1 | suchbar |
| E4 | Kapitulationsvolumen, wenn `capitulationVolumeMinimum` > 0: höchstes relatives Volumen der letzten 6 geschlossenen 1h-Kerzen (C0 eingeschlossen, je gegen den Schnitt der 20 Kerzen davor) ≥ Minimum | suchbar |
| E5 | kritische bärische Kontext-Events blockieren (wie bei allen Long-Strategien) | fest |
| E6 | Gültigkeit 2 h, Einstiegslücke ≤ 0,5 × ATR(14, 1h) (wie bei allen Long-Strategien) | fest |

### 5.2 Preisplan und Ausstieg: eingefroren, keine neue Wahl

| Teil | Wert | Herkunft |
|---|---|---|
| Stop | Einstieg − 2 × ATR(14, 1d), auf den Tick abgerundet | Challenger |
| Ziel | Einstieg + 4 × Stopabstand, auf den Tick abgerundet. Mindest-CRV 2 brutto. R-008 (netto 2R) braucht einen Stop ≥ 0,42 %, das ist immer erfüllt | Challenger |
| Zeit-Exit | 72 h | Champion |
| Regime-Exit | Market-Exit, sobald das Gate schließt (`regimeExit`-Hook) | Challenger |
| Größe, Kosten, Risk-Regeln | 0,25 % Risiko je Trade, `BINANCE_SPOT_VIP0_ESTIMATE_V1`, Risk Engine `SPEC` | unverändert |

Damit unterscheidet sich die Familie vom Challenger nur im
Einstiegsauslöser und im Haltehorizont, bei identischem Risiko je Trade. Das
Ziel ist bei 72 h praktisch eine Obergrenze. Maßgeblich sind Zeit-, Regime-
und Stop-Exit.

### 5.3 Was die Familie nicht ist

- Kein Hebel, kein Short, keine Derivate, keine neue Datenquelle.
- Keine Änderung an Stop, Ziel oder Haltedauer durch die KI.
- Kein neuer registrierter Strategie-Schlüssel. Die Familie läuft nur als
  Research-Identität im Replay, wie die Genome der beiden bestehenden
  Familien.

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
  - 1,5 ATR ist die übliche Konvention für einen „deutlichen“ Ausschlag;
    derselbe Faktor steckt schon im Stop des Champions.
  - Die Umkehrkerze ist die vorsichtige Wahl gegen das Greifen ins fallende
    Messer.
  - Der Volumenfilter bleibt aus, damit das Startgenom minimal bleibt.
- **Nachbarvarianten des Startgenoms** (Finale, vorab festgelegt): Tiefe 1,25
  und 1,75, alles andere gleich.
- **Je Hypothese** höchstens 3 Änderungen gegenüber genau einer
  Elternstrategie (unverändert).
- **Plausibilität:** Das Raster braucht höchstens 168 + 1 Stunden-Kerzen. Die
  Eingabe liefert 250 (mindestens 200). Kosten-Geometrie und Grenzen sind in
  allen 240 Konfigurationen gültig, `validateGenome` braucht keine
  Querprüfung.

## 7. Abgrenzung zu Challenger und Champion

Gates v3 verlangt für Pfad B gegenüber **jeder** bestehenden Strategie:
Korrelation ≤ 0,5 und höchstens 50 % bespielte Einstiege. Die Erwartungen
unten sind begründete Schätzungen. **Gemessen wurde nichts.**

| Kriterium | gegen Champion | gegen Challenger |
|---|---|---|
| Einstiegsauslöser | entgegengesetzt: Rücksetzer vom Hoch statt Schluss über dem 20h-Hoch mit SMA-Stapeln | anderer Auslöser im selben Gate |
| bespielte Einstiege (v3-Maß, Position zählt) | eher niedrig: Champion-Positionen sind kurz und werden bei einem Rücksetzer von 1,5 ATR(1d) meist ausgestoppt | **≈ 100 %**, weil der Challenger im Gate fast immer hält. v3-Pfad B damit unerreichbar |
| bespielte Einstiege (nur Einstiege ±24 h) | niedrig | grob 10–30 %: Im offenen Gate steigt der Challenger je Symbol etwa alle zehn Tage neu ein (121 Trades bei rund 630 offenen Gate-Tagen je Symbol). ±24 h decken damit rund ein Fünftel ab |
| Korrelation der Tagesrenditen | niedrig erwartet | grob √(Zeit im Markt RPB ÷ Zeit im Markt Challenger). Gleiches Gate, gleiche Assets, Haltezeit fast ganz in Challenger-Positionen |

**Folge für die Selektivität.** Korrelation ≤ 0,5 gegenüber dem Challenger
verlangt grob weniger als ein Viertel seiner Zeit im Markt. Das sind ≤ 6,4 %
der Zeit, also bei 72 h Haltedauer höchstens etwa 45 Trades je Symbol über
Entdeckung + Validierung. Höhere Volatilität nach Rücksetzern hebt die
Korrelation zusätzlich. Die Grenze ist daher eher optimistisch.

**Pfad A gegen den Challenger** (Disc + Val, BTC + ETH: 121 Trades, Ø R
+0,42, PF 2,35, Sharpe 1,07, Drawdown 0,94 %, Zeit im Markt 25,5 %, Ø R
Validierung 0,48). Das Startgenom müsste erreichen:

| Prüfung | Schwelle | Erreichbar mit 72 h Haltedauer? |
|---|---|---|
| `VALUE_RISK_ADJUSTED` | Sharpe ≥ 1,22 | offen |
| `VALUE_CONSISTENCY` | ΔSharpe > 0 in Entdeckung **und** Validierung | offen |
| `VALUE_SIGNIFICANCE` | gepaarter Monats-t ≥ 2,82 | offen, schwer |
| Toleranz Validierung | Ø R ≥ 0,43 | **praktisch nein**: Bei 2 × ATR(1d) (Ø 7,7 % beim Challenger) bräuchte jeder 72-h-Trade im Schnitt rund +3,3 % |
| Toleranz Profit Factor | ≥ 2,12 | kaum: Zeit-Exits ziehen den PF Richtung 1 |
| Toleranz Kosten | Ø R bei doppelten Kosten höchstens 0,05 R niedriger als der Challenger | an Ø R gekoppelt |
| Toleranz Stichprobe | ≥ 97 Trades | steht gegen die Selektivität für Pfad B |
| Toleranz Drawdown, Kapitalbindung, Phasen, Kosten | ≤ 1,03 %, ≤ 30,6 % Zeit im Markt, ≤ 1 Phase weniger, ≤ +10 Prozentpunkte | offen |

Die Pro-Trade-Toleranzen von Pfad A wurden für Varianten **innerhalb** einer
Linie mit gleicher Stop- und Haltegeometrie entworfen. Über Familien hinweg
messen sie vor allem die Haltedauer. Das ist eine konservative Verzerrung:
Sie lässt nichts Falsches durch, macht den Test für diese Familie aber nahezu
aussagelos. Deshalb ist E2 vor dem ersten Experiment zu entscheiden.

## 8. Prüfverfahren

### 8.1 Gilt in jedem Fall (unverändert aus v1/v3)

- **v1-Basisprüfungen** mit identischen Schwellen:
  - Technik und Datenintegrität;
  - ≥ 20 / ≥ 6 Trades;
  - Entdeckung Ø R ≥ 0,05 und PF ≥ 1,15;
  - Validierung Ø R > 0 und PF ≥ 1,0;
  - doppelte Kosten > 0;
  - Drawdown ≤ 10 %;
  - ≥ 50 % positive Phasen, keine Phase > 65 %;
  - Redundanz > 0,9 außerhalb der eigenen Linie;
  - Benchmark gegen den Champion.
- **Linienentscheidung** `LINEAGE_DECISION`: Pfad A oder Pfad B. Die
  Teilprüfungen des nicht entscheidenden Pfads werden informativ
  gespeichert.
  - Pfad-A-Referenzen nach E3: der Challenger als **Bezugswurzel**, die
    Elternstrategie, wenn sie ein Kandidat ist, und der beste Vertreter über
    REGIME_LONG und REGIME_PULLBACK_LONG (Wurzel + freigegebene Kandidaten).
  - Begründung: Jede Long-Familie arbeitet im Gelegenheitsraum des
    Challengers. Eine schwächere Referenz wäre die Lücke von EVO-REG-0004 in
    neuer Form.
  - Pfad B: bestehende Strategien wie bisher, also die Wurzeln und alle
    freigegebenen Kandidaten. Das Startgenom ist **keine** Wurzel und kommt
    nicht ins Vergleichsportfolio.
- **Finale:** die zwei Nachbarvarianten aus Abschnitt 6, rollierender
  Walk-Forward, Holdout nur als Schutz (Pfad A ΔSharpe ≥ −0,10 gegen jede
  Referenz, Pfad B Portfolio ΔSharpe ≥ −0,05). Der Holdout ist nie Nachweis.
- **Familienbudget:** v3 erlaubt 10 Validierungsprüfungen je Monat. Diese
  Vorregistrierung begrenzt die Familie strenger auf 4 je Monat und 9
  insgesamt, davon eine für das Startgenom.
  - Weitere Hypothesen werden ohne Backtest verworfen
    (`FAMILY_PREREGISTRATION_LIMIT`).
  - Höchstens ein Finalist je Durchlauf.

### 8.2 Option B: Gates v4 mit genau einer Methodenänderung (Skizze)

Nur wenn E2 = B. Die Änderung bekommt eine eigene Vorregistrierung, einen
eigenen ADR und einen eigenen Hash, **bevor** das Startgenom läuft.

- **Geltungsbereich:** nur Familien, deren Ausstiege in der Familienspezifikation
  eingefroren sind und die einen eigenen Einstiegs-Evaluator haben. Heute ist
  das nur REGIME_PULLBACK_LONG. Für BREAKOUT_LONG und REGIME_LONG verhält sich
  v4 exakt wie v3.
- **Änderung:** In `DIVERSIFICATION_INDEPENDENCE` zählt für diese Familien nur
  ein Referenz-**Einstieg** auf demselben Symbol binnen ±24 h als bespielte
  Gelegenheit, nicht eine schon offene Referenzposition.
- **Unverändert:**
  - Korrelation ≤ 0,5 gegen jede bestehende Strategie;
  - Portfolio ΔSharpe ≥ +0,10 über Entdeckung + Validierung und > 0 in
    **beiden** Zeiträumen, Drawdown nicht größer;
  - α gegen **jede** Strategie einzeln mit t ≥ max(2; √(2·ln N); t-Quantil),
    ≥ 36 Monate, davon 24 mit eigenem Ertrag;
  - Holdout-Schutz, Budget, Zähler;
  - Pfad A vollständig.
- **Warum das keine Hintertür für Parametervarianten öffnet:** v3 zählt
  offene Positionen, weil Ausstiegsvarianten sonst durch andere Haltedauern
  „unabhängig“ wirken. In dieser Familie kann die KI keine Ausstiege ändern,
  und der Einstieg kommt aus einem anderen Auslöser. Varianten innerhalb der
  neuen Familie bleiben über ihre Einstiege gegenseitig erkennbar, sobald
  eine von ihnen freigegeben und damit bestehende Strategie ist.
- **Was dann die eigentliche Hürde ist:** Korrelation ≤ 0,5 und ein
  signifikantes α gegen den Challenger. Das ist die richtige Frage für eine
  Ergänzung: Verdient die Familie etwas, das der Challenger nicht schon
  verdient?
- **Zeitpunkt:** v4 darf nur vor dem Startgenom-Lauf festgeschrieben werden.
  Wird B erst nach einem v3-Ergebnis beschlossen, ist das Startgenom samt
  Nachbarn bekannt und zählt nie als Nachweis.

### 8.3 Stufen und Abbruch

1. **Festschreiben.**
   - Diese Datei wird (ggf. mit v4) zur Vorregistrierung.
   - Der Hash über Familienspezifikation, Startgenom, Nachbarn und
     Budgetgrenzen wird im Code festgenagelt und im Manifest jedes
     Durchlaufs gespeichert.
2. **Stufe 1, nur das Startgenom.**
   - Läuft ohne KI-Aufruf über einen neuen CLI-Befehl.
   - Backtest Entdeckung + Validierung für BTC und ETH, Screening,
     Linienentscheidung, gegebenenfalls Finale.
   - Ergebnis: Bericht an den Betreiber.
3. **Abbruch nach E6.**
   - Scheitert das Startgenom im Screening, ist die Familie unter dieser
     Vorregistrierung geschlossen.
   - Es gibt keine KI-Suche im Raster, um doch noch eine passende
     Konfiguration zu finden. Ein neues Startgenom braucht eine neue
     Vorregistrierung.
4. **Stufe 2, nur nach bestandenem Screening und eigener Freigabe.**
   - Höchstens zwei KI-Durchläufe je Monat mit je höchstens zwei Hypothesen
     für diese Familie.
   - Elternstrategien sind nur das Startgenom und Kandidaten der Familie, die
     das Screening bestanden haben (bestehende Regel `allowedParents`).
   - Kosten nach den bisherigen Läufen: rund 0,19–0,22 USD je Durchlauf,
     schlechtester Fall 0,40 USD.
5. **Forward.** Ein Vorschlag ist nur ein bestandener historischer Test. Nach
   ausdrücklicher Freigabe läuft ein eigener Shadow-Forward-Test:
   - eigene Strategie-Identität mit Spezifikations-Hash und Tests;
   - eigenes Portfolio;
   - Arena-`CANDIDATE` mit `--parent` auf den Challenger;
   - Bewertung nur nach Arena V1 (≥ 30 Trades und ≥ 30 Tage oder ≥ 182 Tage
     und ≥ 10 Trades), im selben Zeitraum gegen den Challenger.
   - Der VPS bleibt dabei unberührt, bis das gesondert entschieden ist.

## 9. Nötige Erweiterungen (erst nach Freigabe)

| Bereich | Änderung |
|---|---|
| `packages/strategy-engine` | Neue Datei `crypto-regime-pullback-research-v1.ts` mit der Research-Identität `{ ...REGIME_LONG_V1_IDENTITY, pullbackResearch }` (gleicher Vertrag wie `regimeResearch`: nie registriert, nie als StrategyVersion angelegt). Sie nutzt `validateStrategyInput`, `refuse`, `buildEvidence`, `regimeGateOpen`, `averageTrueRange`, `priorPeriodHigh`, `relativeVolume` und die Tick-Ausrichtung. Der Helfer für das höchste relative Volumen der letzten 6 Kerzen kommt in die neue Datei, nicht in `indicators-v1.ts`. Neue Reason-Codes (additiv) für Tiefe, Umkehrkerze und Volumen; additiver Indikator-Typ für den Kandidaten. `crypto-regime-long-v1.ts`, Registry, Spezifikations-Hashes und Golden Fixtures bleiben byte-gleich |
| `packages/evolution` | `genome.ts`: Familie `REGIME_PULLBACK_LONG` in `FAMILY_SPECS` (4 Parameter, Ausstiege als fest beschrieben); neues `EVOLUTION_FAMILY_SEEDS` mit Startgenom, Nachbarn, Bezugswurzel `ROOT:CRYPTO_REGIME_LONG_V1`, Budgetgrenzen und Vorregistrierungs-Hash; Zweig in `genomeReplayPlan` (Schlüssel `CRYPTO_REGIME_LONG_V1`, `hooks.evaluate` auf den neuen Evaluator, `regimeExit` an); `distanceFromRoot` misst für Familien mit Startgenom gegen das Startgenom (sonst gäbe es keine Wurzel derselben Familie). `lineage.ts`: Präfix `RPB` (`EVO-RPB-0001`), Generation des Startgenoms = 1. `context.ts`/`prompt.ts`: Familie, eingefrorene Ausstiege, Restbudget. `mock-provider.ts`: deterministische Hypothesen für Tests. `EVOLUTION_ROOTS` bleibt unverändert |
| `apps/evolution-worker` | `researchCycle.ts`: Bezugswurzel als `rootKey` der neuen Familie; „bester Vertreter“ über die Bezugsfamilie (E3); `FAMILY_PREREGISTRATION_LIMIT` vor dem Backtest. `cli.ts`: `evolution evaluate-seed --family=REGIME_PULLBACK_LONG --actor=…`. Der Befehl ruft keine KI auf, verweigert einen zweiten Lauf desselben Startgenoms und verweigert den Lauf, wenn der Hash im Code nicht zur Vorregistrierung passt |
| `apps/dashboard` | Familien- und Reason-Code-Beschriftungen in `evolution-labels.ts`, kein Layout-Umbau |
| Datenbank | keine Migration (`EvolutionCandidate.family` ist `String`) |
| Gates | Option A: keine Änderung. Option B: neue Datei für v4 und Eintrag in `gate-versions.ts`; v1 bis v3 und ihre Hashes bleiben unverändert |
| Tests | Evaluator-Fälle: kein Rücksetzer, Gate zu, Umkehr fehlt, Volumen fehlt, Preisplan gleich dem des Challengers, Determinismus. Genom: 240 Konfigurationen, Startgenom gültig und normalisiert, Hash festgenagelt, Hashes bestehender Genome unverändert. Kontext ohne Leck. Ende-zu-Ende mit Mock-Daten über `evaluate-seed`. Bestehende Hash-Tests für Gates v1 bis v3, Challenger und Champion müssen unverändert grün bleiben |

**Unberührt:**

- Risk Engine (R-020, R-008 und alle anderen Regeln);
- Kostenmodell, Split, Daten-Lader, Arena V1;
- Champion und Challenger mit ihren Portfolios und Sessions;
- offizieller VPS-Forward-Test.

## 10. Mehrfachtest-Zähler

Der Zähler (`trials`) wird nie zurückgesetzt. Er zählt die 30
Trainingskonfigurationen der Vorforschung plus jede auf Entdeckung +
Validierung geprüfte Konfiguration (Kandidaten und Nachbarn, alle Familien
und Gate-Versionen). Für die neue Familie gilt dieselbe Zählung, ohne
Sonderregel.

| Stand | N | √(2·ln N) |
|---|---:|---:|
| heute | 52 | 2,81 |
| nach Stufe 1, Startgenom verworfen | 53 | 2,82 |
| nach Stufe 1, Startgenom im Finale (+2 Nachbarn) | 55 | 2,83 |
| Höchstwert unter dieser Vorregistrierung (9 Kandidaten, höchstens 5 Finalisten mit je 2 Nachbarn) | 71 | 2,92 |
| theoretische Obergrenze des Rasters (alle 240, nur mit weiteren Vorregistrierungen) | 292 | 3,37 |

Die Werte gelten, wenn keine andere Familie läuft; jede andere Prüfung
erhöht N zusätzlich. Die Schwelle der gepaarten und der α-Tests ist
max(2; √(2·ln N); t-Quantil) und liegt damit bei mindestens 2,82.

## 11. Welche Daten die Idee bereits gesehen haben

| Daten | Zeitraum | gesehen von | Bezug zu dieser Idee |
|---|---|---|---|
| Vorforschung, Training: 30 Konfigurationen, Regime- und Bedingungsstudie ([Training](2026-10-14-training-results.md)) | 2018-03 → 2023-12 | Betreiber, frühere Sitzungen, dieser Entwurf | **direkt.** Zwei Befunde passen zur Idee und waren beim Entwurf bekannt: RSI(1h) im Band 50–72 hatte einen negativen 24h-Spread, Stunden mit sehr hoher Volatilität (Stop über der Kappe) eine deutlich höhere Folgerendite. Beides gilt für alle Stunden, nicht nur für `RISK_ON`, und ist kein Beleg |
| Regime-Studie Training und Test | 2018-03 → 2026-10-14 | wie oben | direkt: Die Familie nutzt dasselbe Gate |
| Evolution-Entdeckung: Kennzahlen von 2 Wurzeln und 19 Kandidaten, Marktbedingungs-Analysen | 2018-04 → 2022-06 | Claude (Hypothesen-KI), Betreiber, dieser Entwurf | indirekt: keine Rücksetzer-Kennzahl, aber Regime- und Volatilitätsbefunde |
| Evolution-Validierung: Urteile (KI) und Kennzahlen (Protokolle) von 21 Konfigurationen | 2022-07 → 2023-12 | Betreiber, dieser Entwurf | indirekt: 2022-H2/2023 ist als schwierig für Ausbrüche bekannt |
| Holdout: Test von K1/K2, Regime-Studie, Holdout-Werte von EVO-REG-0004 | 2024-01 → 2026-10-14 | Betreiber, frühere Sitzungen | `PREVIOUSLY_ANALYZED`, nie Nachweis |
| Vorwissen des Sprachmodells, das diesen Entwurf schreibt | bis etwa Mitte 2026 | dieser Entwurf | nicht ausschließbar: Der Kursverlauf von BTC und ETH, etwa die Rücksetzer im Bullenmarkt 2021, ist Teil des Trainingswissens |
| Forward | ab 2026-10-15 | niemand | die einzige saubere Evidenz |

**Folgerung:**

- Kein Zeitraum vor dem 2026-10-15 ist für diese Idee unberührt.
- Ein bestandener historischer Test heißt nur „nicht widerlegt“.
- Die Wahl Trend-Pullback statt Volatilitätsausbruch beruht auf strukturellen
  Gründen (R-020, Überschneidung, Zustand der Ausbruchsfamilie). Sie beruht
  nicht auf Kennzahlen einer Rücksetzer-Regel, denn keine wurde gerechnet.

## 12. Was echte Eigenständigkeit bräuchte (nicht Teil dieses Entwurfs)

Das größte ungenutzte Diversifikationspotenzial liegt außerhalb von
`RISK_ON`, wo heute keine Strategie handelt:

- **Mean-Reversion nach Kapitulation in `NEUTRAL`/`RISK_OFF`:** braucht eine
  eigene Regime-Policy für Research-Identitäten statt R-020.
- **Synthetischer Short in `RISK_OFF`:** braucht das Öffnen von
  `R-005-LONG-ONLY`. Das Fundament existiert (ADR 0011–0013), ist aber
  bewusst gesperrt.

Beides ändert Risk-Regeln. Das ist nach den Grundregeln der Evolution Engine
ausgeschlossen und bräuchte eine eigene Grundsatzentscheidung (ADR). Erst
dort wären Pfad-B-Werte nahe null Überschneidung überhaupt möglich.

## 13. Einschätzung

- **Unter Option A** wird das Startgenom mit hoher Wahrscheinlichkeit an
  den Pro-Trade-Toleranzen von Pfad A scheitern, unabhängig von seinem
  wirklichen Wert. Das Ergebnis wäre für die Frage „ergänzt die Familie
  das Portfolio?“ kaum aussagekräftig und verbraucht die Idee.
- **Unter Option B** ist die Hürde hoch, aber sachgerecht: Korrelation
  ≤ 0,5, signifikantes α gegen den Challenger und den Champion einzeln und
  Portfolio-Gewinn in beiden Zeiträumen.
  - Die Erfolgsaussicht für das Startgenom schätze ich trotzdem als gering
    ein, eher 1 zu 10 als 1 zu 2.
  - Kurzfristige Umkehrprämien sind klein, und die Selektivität für
    Korrelation ≤ 0,5 lässt wenige Trades.
- **Warum es sich trotzdem lohnt:** Stufe 1 kostet keine API-Gebühren und
  erhöht N um 1 bis 3. Ein Scheitern unter B ist eine klare Antwort: Dann
  bringt Einstiegs-Timing innerhalb des Regimes nichts Belastbares. Weiterer
  Fortschritt hinge an der Grundsatzfrage aus Abschnitt 12, nicht an mehr
  Parametersuche.
- **Was dieser Entwurf nicht tut:** Er gibt keine Strategie frei, startet
  keinen Lauf, berührt keinen VPS und handelt kein Echtgeld.
