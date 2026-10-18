# Strategische Bestandsaufnahme für die nächste Entwicklungsphase (2026-10-18)

Stand: Branch `claude/inspiring-noether-rjh92d` @ `be7189d` · Gates v4 ·
Mehrfachtest-Zähler **N = 57** (Schwelle √(2·ln 57) = 2,84) · Champion und
Challenger im offiziellen Forward-Test `OFFICIAL_V1` seit 2026-10-15

> **Entscheidungsvorlage, reine Analyse.** Es gab keinen Download, keinen
> Backtest, keine neue Renditeberechnung und keinen KI-Forschungslauf
> (0 USD). An Risk Engine, Gates, Champion, Challenger, Arena, VPS und
> offiziellem Forward-Test wurde nichts geändert. Alle Messwerte stammen aus
> den verlinkten Berichten und aus dem Code. Rechnungen auf dokumentierten
> Parametern sind als **Überschlag** gekennzeichnet. Sie erzeugen Hypothesen,
> keinen Nachweis. Dies ist keine Handels-, Anlage-, Rechts- oder
> Steuerberatung.

## Ergebnis in Kürze

1. **Der Engpass ist die Kapitalnutzung, nicht die Zahl der Signale.**
   - Champion und Challenger binden im Mittel 0,9 % bzw. 2,1 % ihres Kapitals.
   - Das gleichzeitige Risiko der Gruppe lag im Mittel bei **0,048 %** des
     Kapitals.
   - Die Ursache ist die Stop-basierte Größe: 0,25 % Risiko je Trade bei einem
     Stop von rund 9 % ergibt rund 2,8 % Notional je Position.
   - Die Exposure-Grenzen (20/30/40 %) wurden nie erreicht.
2. **Eine größere Position ist kein größerer Vorteil.** Die Sharpe bleibt
   gleich. Vervielfacht wird nur, was die Strategie forward tatsächlich
   verdient, auch wenn das null oder negativ ist.
   - Belegt ist die Challenger-Sharpe nicht: Ihre Hypothese stammt aus Daten,
     die 2024–2026 enthalten.
   - Das Limit-Set ist nur für kleine Positionen in sich stimmig. Schon bei
     rund 25–30 % Exposure löst R-010 (1 % Tagesverlust, inklusive
     unrealisierter Verluste) an einem gewöhnlichen Tag aus.
   - Ein Drawdown-Limit für das Portfolio fehlt (Dokument 06: offene
     Entscheidung).
3. **Die einzige dokumentierte Ertragsquelle ist Marktengagement:** BTC/ETH
   in `RISK_ON`. Das Regelwerk ist dagegen auf einzelne Trades zugeschnitten
   (Stop, Mindest-CRV 2, fester Risikobetrag). Diese Spannung erklärt mehr als
   jedes fehlende Signal.
4. **Die BTC/ETH-Referenz R schlägt die relative Stärke seit 2024 aus einem
   einzigen Grund:** BTC/ETH liefen besser als Altcoins und sind billiger zu
   handeln.
   - Timing und Kapitalnutzung waren identisch (dasselbe Gate).
   - Gegenüber Kaufen und Halten senkte das Gate über das ganze Fenster vor
     allem das Risiko, nicht die Rendite.
   - R ist kein bewiesener, risikogleicher Ersatz.
5. **Fast jede neue „unabhängige“ Quelle scheitert an mindestens einer
   Grenze:** verbrauchte Daten, Kosten, fehlende Handelbarkeit für ein
   deutsches Konto oder Jahrzehnte bis zum Nachweis.
   - Für die marktneutrale Querschnittsfrage liegen unverbrauchte Daten
     bereits lokal vor: der Querschnitt außerhalb von `RISK_ON`.
   - Altcoin-Shorts sind für ein deutsches Privatkonto aber praktisch nicht
     umsetzbar.
6. **Der Forschungsprozess ist nicht zu streng, aber falsch sortiert.**
   - Alle drei Studien bestätigten ein Risiko, das *vorher* benannt war. Das
     entscheidende Kriterium wurde jeweils zuletzt geprüft.
   - Die Evolution Engine kann Größe, Risk-Regeln und Instrumente nicht
     ändern. Sie findet deshalb strukturell nur neu getimtes Beta.
   - Knapp sind unverbrauchte Daten, nicht N: Die Schwelle steigt nur
     logarithmisch.
7. **Empfehlung: Richtung D1, „Risikobudget statt Trade-Budget“.**
   - Es ist eine vorregistrierte Allokationsstudie für den bestehenden
     Regime-Ansatz, mit einem vom Betreiber vorab festgelegten Verlustbudget
     und dem risikogleichen Kaufen und Halten nach Kosten und Steuern als
     Maßstab.
   - Erster Schritt: eine Phase-0-Vorregistrierung, 0 USD, ohne Datenzugriff
     (Abschnitt 7.3).

## 1. Was geschlossen ist

### 1.1 Studien und Familien

| Familie | Ergebnis | Datum | N danach | Wiederaufnahme |
|---|---|---|---:|---|
| Ausbruch- und Regime-Familie in der Evolution | Ausbruch: 10 von 10 Validierungen scheiterten an 2022-H2/2023. Regime: EVO-REG-0004 vom Betreiber abgelehnt. Unter Gates v3 alle 9 Kandidaten beider Familien verworfen | 2026-10-15 | – | Oktober-Validierungsbudget ausgeschöpft; Champion und Challenger laufen in `OFFICIAL_V1` |
| `REGIME_PULLBACK_LONG` | F4 geschlossen: α t −0,34, Zuwachs nur Regime-Beta | 2026-10-16 | 53 | nein |
| Funding-/Basis-Carry V1/V2 | `KOMPRIMIERT`: seit 2024 3,38 % p. a. bei 4,29 % Geldmarkt, B2 verfehlt | 2026-10-17 | 55 | frühestens 2027-10-15, forward, neue Vorregistrierung |
| Relative Stärke V1 (long-only) | `NICHT_BESTANDEN` / `NUR_BETA`: Selektions-α t 0,61 bzw. −0,81, seit 2024 negativ | 2026-10-18 | **57** | frühestens 2027-10-15, forward; marktneutrale Frage ausdrücklich offen |

Nur beschreibend gesehen, ohne Beitrag zu N
([Analyse 2026-10-16](2026-10-16-research-directions-profitability.md)):

- Long in `NEUTRAL`: mehr Beta, kein eigener Vorteil.
- Short in `MIXED`: nicht signifikant.
- Stundenumkehr: K.O. durch Kosten.
- Kapitulationskäufe außerhalb von `RISK_ON`: Es folgten weitere Verluste.
- Kurzfrist-Momentum nach +2σ: keine Zelle über 2,82.

### 1.2 Verbrauchte und unverbrauchte Daten

| Daten | Zeitraum | Status |
|---|---|---|
| BTC/ETH Spot 1h/1d | 2018-04 – 2026-10-14 | **verbraucht**: Vorforschung, Evolution (alle drei Split-Teile), Analyse, Carry, relative Stärke |
| Regime-Labels `crypto-native-regime-v1` | 2018-04 – 2026-09 | bekannt, samt Zählung |
| Funding, Perp-, Mark- und Indexkerzen BTC/ETH | 2019-09 – 2026-09 | verbraucht (Carry) |
| Altcoin-Querschnitt Binance Spot (inkl. delisteter Paare) **in `RISK_ON`** | 2020-01 – 2026-09 | verbraucht (relative Stärke), Rang-IC dort bekannt (−0,039) |
| Altcoin-Querschnitt **außerhalb von `RISK_ON`** | 2020-01 – 2026-09 | **unverbraucht**, lokal vorhanden (Manifest `297ab134…`). Folgerenditen bewusst nie ausgewertet; die Kurse flossen nur als Rückschau in Signale ein |
| Champion/Challenger-Monatsrenditen, `DTB3` | 2020-01 – 2026-09 | bekannt, nur Vergleichsgrößen |
| Aktienindex-Proxys (FRED, wöchentlich) | 2018-04 – 2023-12 | nur die Korrelation gesehen |
| Aktien, Anleihen, Gold, Devisen als Tageshistorie | Jahrzehnte | von SignalPilot **nie** abgerufen, aber durch öffentliches Vorwissen vorbelastet |
| Forward ab 2026-10-15 | laufend | unberührt; die **einzigen** unverbrauchten BTC/ETH-Daten |

## 2. Kapital- und Risikoeffizienz der bestehenden Strategien

### 2.1 Warum nur 1–2 % des Kapitals gebunden sind

| Faktor | Quelle | Wert | Wirkung auf die Bindung |
|---|---|---|---|
| Risiko je Trade | R-009, `policy-v1.ts:101`, über R-026 an den Limit-Set-Hash gebunden | 0,25 % des Kapitals | Grundbetrag |
| Stopabstand | Strategie: 2 × ATR(14, 1d) | Median 9,0 % (BTC, `RISK_ON`); Challenger-Replay Ø 7,7 % | Notional = Risiko ÷ Stop ≈ **2,8–3,2 %** je Position (P10–P90: 1,8–4,2 %) |
| Exposure-Grenzen | R-013/R-014/R-015, `position-sizing.ts` | 40 % brutto, 20 % je Asset, 30 % korreliert | **nie bindend**: höchste Auslastung 30–40 % der Grenze ([Vergleich A](2026-10-16-portfolio-replay-validation-and-gates-v4-counterprobe.md)). Sie würden erst ab rund 1,8 % Risiko je Trade greifen (Überschlag: 20 % × 9 %) |
| Regime-Sperre | R-020 und internes Gate jeder Strategie | `RISK_ON` an 30 % der Tage (2018–2023), 33,6 % (2020–2026) | rund 70 % der Zeit keine Position |
| Häufigkeit und Dauer | Challenger-Replay BTC 2018–2026 | 104 Trades, Ø rund eine Woche, Zeit im Markt 25–30 % | Bindung ≈ Notional × Zeit im Markt |
| Symbole | Gates-v4-Modell: ein Platz mit BTC und ETH; live nur BTC | 2 bzw. 1 | live halbiert sich die Bindung |
| **Ergebnis** | | Überschlag: 2,8–3,2 % × 0,25–0,30 × 2 ≈ 1,4–1,9 % | dokumentiert: Challenger **2,1 %**, Champion 0,9 %, Gruppe mit Reserveplatz 0,75 % |

**Bindend ist allein R-009 zusammen mit dem Stopabstand.** Die
Exposure-Grenzen liegen 7- bis 14-mal darüber. Das Gate senkt die Zeit im
Markt zusätzlich auf rund ein Drittel.

### 2.2 Was bei größeren Positionen zuerst bricht

Die Grenzen hängen voneinander ab. Eine höhere R-009 allein erzeugt deshalb
kein stimmiges Regelwerk.

- **R-010, Tagesverlust 1 % inklusive unrealisierter Verluste.**
  - Dokumentiert sind Jahresvolatilitäten von 64 % (ETH, 2025/26) und 77 %
    (BTC in `RISK_OFF`). Das sind rund 3,3–4 % je Tag (Überschlag: ÷ √365).
  - Ab etwa 25–30 % Exposure löst damit schon ein Tag mit einer
    Standardabweichung den Kill Switch aus.
  - Heute lag die höchste Auslastung von R-010 bei 28,5 %.
- **R-021: drei Verluste in Folge, dann Tagessperre.**
  - Ein Regime-Exit schließt BTC und ETH gleichzeitig. Bei einer Korrelation
    von 0,84 (in `RISK_OFF` 0,90) entstehen so oft zwei Verluste auf einmal.
  - In Vergleich A hatte der Champion 24 Auslösungen und −10,6 R statt rund
    +15,8 R in getrennten Konten (Befund T1). Der Challenger hatte 13
    Auslösungen und +48,4 R statt rund +52 R.
- **Gemeinsame Verlustserien.** BTC und ETH zusammen sind eher eine Wette als
  zwei.
  - Ein Risikobudget müsste deshalb für die korrelierte Gruppe gelten, nicht
    je Trade.
  - R-015 begrenzt nur das Exposure der Gruppe, nicht ihren Verlust.
- **R-008, netto mindestens 2R.** Die Regel erzwingt ein Kursziel. Beim
  Challenger endeten 14 von 104 Trades am 4R-Ziel, dazu 4 am
  30-Tage-Backstop, den die Strategie selbst gewählt hat. Ausgerechnet starke
  Trends werden also abgeschnitten, danach folgt ein kostenpflichtiger
  Wiedereinstieg.
- **Kurslücken.** Bewegungen dieser Größenordnung in 24 h sind dokumentiert:
  BTC +46 %, ETH +48 % ab 2020-03-12, aufwärts
  ([Carry-Bericht §7](2026-10-17-funding-carry-v2-results.md)). Für einen
  angenommenen Absturz um 45 %, bei dem der Stop erst nach der Lücke gefüllt
  wird, gilt (Überschlag):

  | Risiko je Trade | Notional bei 9 % Stop | Verlust einer Position bei −45 % | BTC + ETH zusammen |
  |---|---:|---:|---:|
  | 0,25 % (heute) | 2,8 % | 1,25 % | ≈ 2,5 % |
  | 1,0 % | 11 % | 5 % | ≈ 10 % |
  | 1,8 % (Asset-Grenze) | 20 % | 9 % | ≈ 18 % |

- **Kein Drawdown-Kill.** Dokument 06 nennt ihn ausdrücklich als offene
  Entscheidung. Vor jeder Skalierung wird er Pflicht.

### 2.3 Nicht investiertes Kapital und Opportunitätskosten

- **Shadow-Buchführung (S1):** Freie Kasse ist zu 0 % verbucht.
  - Challenger 2020-01 bis 2026-09: 2,68 % p. a. auf den Platz, gegenüber
    2,85 % `DTB3`, also −0,2 pp.
  - Liegt der ungenutzte Rest im Geldmarkt (S2), sind es +1,8 bis +2,6 pp
    ([Vorregistrierung relative Stärke §8.1](2026-10-17-relative-strength-feasibility-preregistration.md)).
- **Gruppe (Champion + Challenger + Reserve, 60 000 USDT):**
  - +0,77 % p. a. 2020–2026 ([Carry §8](2026-10-17-funding-carry-v2-results.md));
  - +3,31 % in 5¾ Jahren 2018-04 bis 2023-12 (Vergleich A).
- **Champion:** −0,5 % p. a. bei 0,9 % Bindung, also ein negativer Beitrag.
- **Folge:** Bei der heutigen Größe bestimmt der Zins auf die freie Kasse das
  wirtschaftliche Ergebnis stärker als jedes Signal. Eine neue Strategie mit
  einem IR von 0,3–0,5 gegenüber dem Bestand brächte bei dieser Größe einige
  Zehntel Prozentpunkte.
- **Für eine spätere Echtgeldstufe:** Freies Kapital gehört nicht als USDT
  auf einen Handelsplatz (Börsen- und Stablecoin-Risiko). Es gehört in EUR
  auf ein Konto; an der Börse liegt nur die Handelsreserve. Das ist eine
  Designfrage für später und keine Änderung am Shadow.

### 2.4 Allokation oder zusätzliche Signale?

- **Hebelverhältnis.** Absolute Rendite ≈ Sharpe × Volatilität des
  Portfolios.
  - Neue Signale verschieben die Sharpe um Bruchteile. Bisher hat keines sie
    nachweisbar verschoben.
  - Die Allokation verschiebt die Volatilität um eine Größenordnung. Heute
    hat der Challenger-Platz rund 2,3 % Volatilität (Überschlag: 2,68 %
    ÷ Sharpe 1,18); möglich wären 15–30 %.
  - **Für die absolute Rendite ist Allokation also um eine Größenordnung
    wirksamer.**
- **Sie skaliert aber nur, was wirklich da ist.**
  - Die Sharpe des Challengers (1,18 auf Monatsbasis) ist keine unabhängige
    Schätzung.
  - Bei einer angenommenen Forward-Sharpe von 0,3–0,6 und 15 % Volatilität
    wären es grob 4,5–9 % p. a. Überschuss vor Steuern (Überschlag).
  - Die Drawdowns lägen dann in der Größenordnung, die R bei voller
    Investition zeigte (32 %, in-sample).
- **Obergrenze nach Kelly.**
  - Der wachstumsoptimale Anteil ist Sharpe ÷ Volatilität. Bei einer Sharpe
    von 0,3–0,6 und 65 % Jahresvolatilität sind das rund 0,45–0,9 des
    Kapitals während investierter Phasen.
  - Vorsichtig (halbes Kelly) sind es 0,25–0,45.
  - **Ein Hebel lässt sich daraus nicht begründen.** Wer mehr als das
    Doppelte des optimalen Anteils einsetzt, hat langfristig negatives
    Wachstum. Bei unsicherer Sharpe ist das schnell erreicht.
- **Vollständiger Kapitalverlust:**
  - Ohne Hebel ist er über den Kurs praktisch ausgeschlossen.
  - Real bleiben drei Wege: Ausfall des Handelsplatzes, Stablecoin-Bruch und
    Betriebsfehler. Sie wachsen mit dem Kapital, das am Platz liegt, nicht mit
    der Strategie.
  - Mit Hebel kommt die Liquidation hinzu. Für Privatkunden gilt bei
    Perpetuals die CFD-Grenze 2:1 mit Close-out; im Carry-Fall lag dieser im
    März 2020 nur 12 % entfernt.

**Urteil:** Ja, eine bessere Kapitalallokation hat potenziell einen größeren
wirtschaftlichen Nutzen als zusätzliche Signale. Das gilt aber nur als
bewusst gewähltes Risikoniveau, das aus einem vorab festgelegten Verlustbudget
folgt, ohne Hebel und mit Drawdown-Grenze. Und nur, wenn der Regime-Ansatz
nach Kosten und Steuern mehr leistet als ein risikogleiches Kaufen und Halten
(Abschnitt 3).

## 3. Einfachere BTC/ETH-Strategien und Regime-Modelle

### 3.1 Warum R seit 2024 so viel besser ist als die relative Stärke

S1, 2024-01 bis 2026-09
([Ergebnisbericht relative Stärke](2026-10-18-relative-strength-results.md)):
R +30,3 % p. a., Kontrolle K_A −5,7 %, Variante A −10,8 %.

| Komponente | R gegenüber relativer Stärke | Anteil an der Lücke |
|---|---|---|
| Allgemeine Marktrendite (Zusammensetzung) | BTC/ETH gegen einen gleich gewichteten Altcoin-Korb. 2024: R +45,8 % gegen K_A −4,6 %; 2025: +33,8 % gegen −23,1 % | **dominant** (≈ 36 pp p. a. R − K_A) |
| Auswahl | A − K_A seit 2024 −5,1 pp; Selektions-α −0,56 % je Monat | klein, negativ |
| Timing | identisches Gate, identischer Takt | **null** |
| Kapitalnutzung | alle rund 33,5 % der Tage investiert | **null** |
| Kosten | R 14 bp je Seite, 10 % des Bruttogewinns; Altcoins 25 bp, 29–50 % des Bruttogewinns | spürbar |
| Risikoreduzierung | max. Drawdown R 32,3 % gegen 54–60 %; schlechtester Monat −13,7 % gegen −24,5 % | Folge der Zusammensetzung |

### 3.2 Was R ist und was nicht

- **Gegenüber Kaufen und Halten derselben Assets** (2020-01 bis 2026-09):

  | | R (mit Gate) | Kaufen und Halten |
  |---|---:|---:|
  | Netto p. a. | 47,2 % | 51,0 % |
  | Sharpe (Monat) | 1,14 | 0,91 |
  | max. Drawdown | 32,3 % | 77,8 % |

  - Über das ganze Fenster hat das Gate **das Risiko gesenkt, nicht die
    Rendite erhöht**.
  - Seit 2024 lag R vorn (+30,3 % gegen +12,3 %). Genau dieser Zeitraum
    floss aber in die Hypothese des Regime-Ansatzes ein
    ([Challenger-Spezifikation](2026-10-14-challenger-regime-long-v1.md)).
- **Risikogleich ist R nicht vergleichbar.**
  - R ist in `RISK_ON` voll investiert, der Challenger zu rund 3 %.
  - Bei gleicher Volatilität (S2, 10 %) lagen R bei 11,7 %, Kaufen und Halten
    bei 8,7 % und der Challenger bei 8,0 % Überschuss. Das ist in-sample und
    setzt eine konstante Sharpe voraus.
- **Gründe, R nicht als bewiesene Alternative zu behandeln:**
  1. Das Regime-Modell entstand mit Kenntnis von 2024–2026.
  2. Im Fenster liegt nur ein vermiedener Bärenmarkt: 2022 hatte keinen
     `RISK_ON`-Tag. Der Wert des Gates hängt an einem Ereignis.
  3. R hat keinen Stop, keine Risk Engine und eine vereinfachte Ausführung.
  4. Bei 86 Gate-Wechseln in 5¾ Jahren ist das Ergebnis kostenempfindlich.
  5. Der Regime-Halteansatz ist der Bestwert unter mehreren verglichenen
     Filter- und Einstiegsregeln: Er war „robuster als jede
     Breakout-Einstiegsregel“
     ([Echtdaten-Research](2026-10-14-real-data-results.md)). Eine solche
     Auswahl überschätzt den künftigen Wert.

### 3.3 Sind wir durch Einstieg, Ausstieg oder Größe eingeschränkt?

| Entscheidung | Befund | Einschränkung |
|---|---|---|
| Einstieg | Challenger: Gate offen, keine weitere Regel. Champion: Ausbruch plus Stop-Kappe 3 % (laut Bedingungsstudie kontraproduktiv) | beim Challenger keine |
| Ausstieg | Challenger-Exits (Replay, 104 Trades): 71 Regime, 15 Stop, 14 Ziel, 4 Zeit. Ziel und Backstop schneiden die rechte Flanke ab, aus der Trendfolge ihren Ertrag zieht. Danach folgen Wiedereinstieg und neue Kosten. Das Ziel erzwingt R-008, den Backstop hat die Strategie selbst gewählt | **plausibel**, aber nicht belegt: Der Abstand R ↔ Challenger bei gleicher Volatilität ist durch Gewichtung, Ausführung und Kill Switch verzerrt |
| Größe | rund 2,8 % Notional: etwa Faktor 10 unter halbem Kelly, Faktor 35 unter voller Investition | **dominant** |

**Kern:** Das Regelwerk ist trade-zentriert, die dokumentierte Ertragsquelle
expositions-zentriert. Eine Halte-Strategie mit Gate, volatilitätsbasierter
Größe und Drawdown-Grenze passte besser zur Ökonomie. Jede so abgeleitete
Variante ist aber in-sample. Prüfen lässt sie sich nur forward.

## 4. Neue, möglichst unabhängige Ertragsquellen

| Ansatz | Hypothese und Mechanismus | Warum nicht nur Beta | Daten | Kosten, Kapazität | DE-Konto, ESMA | Urteil |
|---|---|---|---|---|---|---|
| Marktneutraler Querschnitt außerhalb `RISK_ON` | Long stark / Short schwach (oder umgekehrt) in liquiden Altcoins; Breite statt Richtung | Netto-Exposure null | **lokal, unverbraucht** (2020–2026, ohne Überlebens-Verzerrung); Funding und Leihe der Altcoins fehlen | 25–40 bp je Seite, wöchentlicher Umschlag; Leihkosten der Short-Seite in Bärenphasen | Altcoin-Shorts für Privatkunden praktisch nicht verfügbar; Perps = CFD 2:1 | Wissensfrage, kaum umsetzbar → **D4** |
| Pair Trading BTC/ETH | Mean-Reversion des ETH/BTC-Verhältnisses | marktneutral | verbraucht; ein Paar ohne Breite | gering | Short-Bein nötig | **verworfen**: ETH/BTC ist seit Ende 2021 über Jahre gefallen (öffentliches Vorwissen); das wäre eine Gegenwette auf einen bekannten Trend |
| Mean-Reversion | Umkehr nach Ausschlägen | kurzfristig | verbraucht | Stundenumkehr ≪ 0,30 % Round-Trip | Spot möglich | **verworfen**: Stundenebene K.O., Mehrtages-Umkehr = Pullback (geschlossen), Kapitulation ohne Erholung, R-008 als Hürde. Der negative Querschnitts-IC in `RISK_ON` wird nur als Hypothese für D4 genutzt |
| Short-Trendfolge | Fortsetzung von Abstürzen in `RISK_OFF` | Gegenrichtung und Gegenregime | verbraucht, nur zwei Bärenphasen | Funding/Leihe fehlen im Modell (ADR 0012) | inverse ETPs oder regulierte Derivate, teuer; CFD 2:1 | schwach → **D5** |
| Alternative Zeitfenster | andere Rückschauen für Trend/Momentum | – | auf BTC/ETH verbraucht | – | – | **keine eigene Richtung**: Das wäre eine Neuoptimierung derselben Idee. Zulässig nur als vorab festes Ensemble von Standard-Rückschauen, und nur forward |
| Weitere Anlageklassen (Trend über ETFs/ETCs) | Zeitreihen-Trend über Aktienindizes, Anleihen, Gold | BTC–Nasdaq-Korrelation 0,25, schwankt bis 0,42 (2022) | Jahrzehnte, für SignalPilot nie abgerufen; kein Live-Feed (Finnhub 403) | sehr gering an Xetra; hohe Kapazität | **gut handelbar**; Abgeltungsteuer unabhängig von der Haltedauer | strategisch stark, Infrastruktur teuer → **D3** |
| Funding/OI als Timing | Positionierung statt Preis | bleibt im selben Beta | BTC/ETH-Funding verbraucht | – | – | gering, schon 2026-10-16 bewertet |

**Gemeinsamer Befund:** Jede unabhängige Quelle verlangt mindestens eines von
drei Dingen:

- Shorts: R-005, die R-020-Sperre aus ADR 0020 und die Handelbarkeit für ein
  deutsches Konto;
- eine neue Datenquelle und Anlageklasse;
- Jahre an Forward-Daten.

Keine ist billig. Funding-Carry und long-only relative Stärke werden hier
weder umbenannt noch neu optimiert.

## 5. Forschungsprozess und Evolution Engine

### 5.1 Befund

| Größe | Wert |
|---|---|
| Text der Vorregistrierungen, Präzisierungen und Datenprüfungen (Pullback, Carry, relative Stärke) | rund 4 000 Zeilen |
| Ergebnisberichte derselben drei Studien | rund 1 040 Zeilen (Verhältnis ≈ 4 : 1) |
| Gates v2–v4 mit ADRs und Gegenprobe | rund 1 700 Zeilen |
| Commits auf dem Branch seit 2026-10-14 | 77 |
| Dauer je Studie | 1–2 Tage |
| KI-Kosten | 0,60 USD für die drei Evolution-Läufe unter Gates v3; Studien 0 USD |
| Suchraum der Evolution Engine | Genome in geschlossenen Rastern bestehender Familien. Kosten, Ausführung, **Größe**, Risk-Regeln und Hebel sind nicht änderbar ([Dokument 20](../20-evolution-engine.md)) |

### 5.2 Was die Disziplin gebracht hat

- **Zwei teure Bauvorhaben verhindert:**
  - Perpetual-Instrument, abgesichertes Paar und Gates v5 für den Carry;
  - Universum-Erweiterung an R-004, R-011, R-012 und R-015 für die relative
    Stärke.
- **Zwei Fallen erkannt:**
  - Der Carry sah gegenüber dem Challenger glänzend aus, verlor aber gegen
    den Geldmarkt.
  - Der Vorsprung von Variante A (+3,6 pp) war ein einzelner Coin (SOL).
- Ohne Vorregistrierung wären beide als Erfolg durchgegangen.

### 5.3 Wo Aufwand verloren ging

1. **Das entscheidende Risiko war jeweils vorher benannt und wurde zuletzt
   geprüft.**
   - Pullback: Ertrag „auf geteiltem Trend-Beta“
     ([Entwurf 2026-10-15](2026-10-15-evolution-family-regime-pullback-draft.md)).
   - Carry-Kompression seit 2024: Analyse 2026-10-16, §3.4.
   - Gegenwind der Altcoins seit 2024: Vorregistrierung relative Stärke,
     „Gegen hohe Erwartungen“, Punkt 3.
2. **Eine Hypothese nach der anderen.** Es gab keinen Vergleich vieler Ideen,
   bevor eine davon eine Vorregistrierung von 700–1 250 Zeilen bekam.
3. **Die Allokationsfrage wurde nie gestellt.** In der Evolution Engine ist
   die Größe gesperrt, in den Studien galt sie als Betreiberentscheidung. So
   blieb der größte Hebel ohne Analyse.
4. **Der Suchraum der Engine liegt innerhalb der drei Wände** (Long, `RISK_ON`,
   BTC/ETH). Mehr KI-Läufe darin finden mehr Varianten desselben Betas.
   Zusätzliches Budget hilft dort nicht.

### 5.4 Wie Claude mehr verschiedene Ideen entwickeln kann, ohne die Disziplin aufzugeben

1. **Ideenkarten vor jeder Vorregistrierung** (kein Datenzugriff, zählt
   nicht zu N).
   - Claude schreibt je Runde 10–20 Karten von je einer halben Seite.
   - Jede Karte enthält: Mechanismus und Gegenpartei, Unabhängigkeit vom
     Bestand, Handelbarkeit für das DE-Konto, Kostenobergrenze, verfügbare
     unverbrauchte Daten, das eine entscheidende Kriterium, die Zeit bis zum
     Nachweis.
   - Bewertet wird nach festen Punkten. Der Betreiber wählt eine oder zwei
     Karten.
2. **Gestufte Vorregistrierung: das entscheidende Kriterium zuerst.**
   - Stufe A: höchstens zwei Seiten, ein entscheidendes Kriterium, ein bis
     zwei Varianten, ein Lauf, zählt zu N.
   - Erst wenn A besteht, folgt die volle Vorregistrierung mit Robustheit,
     Ereignisregeln und Stresstests.
   - Beim Carry hätte eine Stufe A mit B2 allein dasselbe Urteil geliefert,
     ohne Legging-, Liquidations- und Ereignisregeln.
   - Bei der relativen Stärke wäre der Aufwand für das Universum ohne
     Überlebens-Verzerrung geblieben; die Vorregistrierung wäre aber deutlich
     kürzer gewesen.
3. **Risikoentscheidungen von Vorteilsbehauptungen trennen.**
   - Eine Allokation braucht ein Verlustbudget und Stresstests, kein
     t ≥ 2,84.
   - Wer Varianten anhand historischer Renditen auswählt, zählt sie
     trotzdem zu N.
4. **Forward-Daten als Prüfmenge nutzen.**
   - Neue Shadow-Teilnehmer in einer eigenen Arena-Kohorte erzeugen die
     einzigen unverbrauchten BTC/ETH-Daten. `OFFICIAL_V1` bleibt davon
     getrennt.
   - Das lohnt sich nur bei hohem IR: t ≈ IR × √Jahre, also IR 1,0 → rund
     8 Jahre, IR 0,5 → rund 32 Jahre.
   - Das ist ein späterer Schritt mit eigener ADR, keine Änderung jetzt.
5. **N bleibt, und mehr Tests sind bezahlbar.** Die Schwelle wächst
   logarithmisch:

   | N | 57 | 80 | 100 | 200 |
   |---|---:|---:|---:|---:|
   | Schwelle | 2,84 | 2,96 | 3,03 | 3,26 |

   Knapp sind unverbrauchte Daten und Zeit in einem Regime, nicht N.

## 6. Entscheidungsmatrix

| # | Richtung | Bereich |
|---|---|---|
| D1 | Risikobudget statt Trade-Budget: Allokation des Regime-Ansatzes mit Verlustbudget, Drawdown-Grenze, ohne Hebel | 1 + 2 |
| D2 | Forschungsprozess: Ideenkarten und gestufte Vorregistrierung | 4 (begleitend) |
| D3 | Zeitreihen-Trend über weitere Anlageklassen (ETFs/ETCs, DE-handelbar) | 3 |
| D4 | Marktneutraler Querschnitt außerhalb `RISK_ON` (Wissensfrage) | 3 |
| D5 | Short-Trendfolge unter eigenem Risikomodell (nach ADR 0020) | 3 |

Skala 1–5, höher ist besser („Aufwand 5“ heißt wenig Aufwand, „Risiko 5“
heißt wenig Verlustrisiko). Grobe Einschätzung, keine Messung.

| Kriterium | D1 | D2 | D3 | D4 | D5 |
|---|:-:|:-:|:-:|:-:|:-:|
| Potenzial risikobereinigte Nettorendite | 2 (absolut 5) | indirekt | 3 | 2 | 1 |
| Unabhängigkeit vom Marktrisiko | 1 | – | 4 | 5 | 4 |
| Technischer Aufwand | 4 | 5 | 1 | 3 (Studie) / 1 (Umsetzung) | 2 |
| Daten: Verfügbarkeit und Qualität | 4 (vorhanden; für Risiko tauglich, für Rendite verbraucht) | – | 3 (lang, aber neuer Anbieter) | 4 (lokal und sauber; Leihkosten fehlen) | 1 |
| Zeit bis zu belastbaren Erkenntnissen | 4 (Risikobild in Tagen; Vorteil nur forward) | 5 | 2 | 4 | 1 |
| Risiken und mögliche Verluste | 2 | 5 | 4 | 2 | 2 |
| Umsetzbarkeit für ein deutsches Konto | 3 (Spot ja; Steuer-Nachteil) | – | 5 | 1 | 3 |
| Nötige Infrastruktur-Änderungen | 4 (Limit-Set-Version, Sizing-Policy, Teilnehmer) | 5 | 1 | 1 | 2 |
| Grobe Erfolgsaussicht | mittel (Entscheidung sicher, Mehrwert offen) | hoch | gering bis mittel | gering | gering |

### D1 — Risikobudget statt Trade-Budget

- **Hypothese:** Bei einem vorab festgelegten Verlustbudget lässt sich der
  Regime-Ansatz so groß machen, dass er wirtschaftlich zählt. Die Größe folgt
  dabei aus Volatilität und Portfolio-Drawdown statt aus 0,25 % je Trade, ohne
  Hebel. Offene Frage: Leistet er nach Kosten und Steuern mehr als ein
  risikogleiches Kaufen und Halten?
- **Kein neuer Vorteil.** Es ist dasselbe Beta in größerer Menge. Ein Mehrwert
  entstünde nur aus Risikoreduktion (Gate) und weniger Reibung (Ziel,
  Backstop, Kill-Switch-Artefakte).
- **Daten:** vorhanden. Für Volatilität und Lückengrößen, die sich deutlich
  stabiler schätzen lassen als Mittelwerte, sind sie tauglich. Für
  Mittelwerte sind sie verbraucht; Renditen auf diesen Daten sind kein
  Beleg.
- **Kosten und Kapazität:** BTC/ETH sind die liquidesten Krypto-Märkte, die
  Kapazität reicht weit über das Betreiberkapital hinaus. Die Kosten wachsen
  linear, ihr Anteil bleibt gleich.
- **Deutsches Konto:** Spot über EU-zugelassene Anbieter ist möglich.
  Steuerlich gilt nach allgemeinem Kenntnisstand (§ 23 EStG, vor jeder
  Echtgeldstufe fachlich zu prüfen):
  - Verkäufe innerhalb eines Jahres sind mit dem persönlichen Satz
    steuerpflichtig (Freigrenze 1 000 EUR je Jahr). Nach einem Jahr sind sie
    steuerfrei.
  - Bei Haltedauern um eine Woche ist praktisch jeder Gewinn steuerpflichtig.
  - Überschlag bei 42 % Grenzsteuersatz, ohne Soli und Verlustverrechnung:
    Vor Steuern braucht die Strategie das 1,7-Fache der Rendite eines
    steuerfreien Haltens.
  - Dieser Nachteil kann den ganzen Timing-Vorteil aufzehren.
- **Infrastruktur:**
  - Neue Limit-Set-Version mit ADR; R-009, R-010, R-013 bis R-015 und R-021
    gemeinsam neu kalibriert, dazu ein Drawdown-Kill;
  - eine Sizing-Policy-Version für volatilitätsbasierte Größe;
  - ein eigener Shadow-Teilnehmer in getrennter Kohorte.
  - `OFFICIAL_V1` bleibt unverändert.
- **Risiken:** Der Drawdown steigt linear mit der Größe. Dazu kommen
  Kurslücken (Abschnitt 2.2), gemeinsame BTC/ETH-Verluste und das Risiko des
  Handelsplatzes.

### D2 — Ideenkarten und gestufte Vorregistrierung

Inhalt wie in Abschnitt 5.4. Diese Richtung ist keine Ertragsquelle, sondern
senkt die Kosten je Entscheidung. Sie lässt sich ohne Code als Arbeitsregel
einführen. Ihre Wirkung hängt davon ab, dass es außerhalb der drei Wände
überhaupt gute Karten gibt.

### D3 — Trend über weitere Anlageklassen

- **Hypothese:** Zeitreihen-Trend über mehrere, wenig korrelierte
  Anlageklassen ist die am breitesten dokumentierte unabhängige Ertragsquelle.
  Sie entsteht aus der Streuung über Märkte, nicht aus einem einzelnen Markt.
- **Einzeln schwach:** Gold-Trend hatte eine Sharpe von 0,3–0,5 (Analyse
  2026-10-16). Erst die Diversifikation trägt.
- **Daten:** jahrzehntelang, für SignalPilot unverbraucht, aber stark durch
  Literatur vorbelastet. Ein Live-Feed fehlt.
- **Deutsches Konto:** Am besten von allen Richtungen. ETFs und ETCs an
  Xetra, geringe Kosten, hohe Kapazität. Bei ETFs fällt die Abgeltungsteuer
  unabhängig von der Haltedauer an; aktives Umschichten erzeugt dort also
  keine Steuer-Asymmetrie wie bei Krypto.
- **Infrastruktur:** die größte Änderung.
  - neuer Datenanbieter mit Handelskalendern statt 24/7;
  - R-004 erweitern;
  - ein anlagespezifisches Regime statt R-020, das heute jeden Long sperrt,
    sobald Krypto nicht `RISK_ON` ist.
  - Das widerspricht dem Ziel, keine umfangreiche neue Infrastruktur zu
    bauen. Deshalb mittelfristig.

### D4 — Marktneutraler Querschnitt außerhalb `RISK_ON`

- **Hypothese:** Ein einziges, vorab gewähltes Querschnittssignal liefert
  marktneutral einen Ertrag über den Kosten. Kandidat ist die Umkehr, auf die
  der negative IC in `RISK_ON` hindeutet: 28-Tage-Gewinner liefen in der
  Folgewoche schlechter. Getestet wird nur auf den nie ausgewerteten Tagen
  außerhalb von `RISK_ON`.
  - Dass die Wahl des Signals von gesehenen Daten beeinflusst ist, muss die
    Vorregistrierung offenlegen.
  - Momentum *und* Umkehr zu testen, wäre ein Nachjustieren am Vorzeichen.
- **Warum attraktiv:** null Netto-Exposure; die Daten liegen lokal vor und
  sind ohne Überlebens-Verzerrung; eine Studie wäre in wenigen Sitzungen
  machbar.
- **Warum nur Rang 4:**
  - Die Kosten der Short-Seite (Leihe, Funding der Altcoins) fehlen und
    bräuchten einen neuen Download.
  - Ein Erfolg wäre für ein deutsches Privatkonto praktisch nicht handelbar.
  - Für SignalPilot bräuchte es Shorts (R-005, ADR 0020), ein breites
    Universum (R-004, R-011, R-015) und Gates v5.
  - Das Ergebnis wäre Wissen, kein Umsetzungsweg.

### D5 — Short-Trendfolge

- ADR 0020 ist als Entwurf „Proposed“ committet, aber nur lokal und nicht
  auf diesem Branch (`cc76f6e`, Branch `claude/xenodochial-solomon-ef3adf`).
- Die Drift in `RISK_OFF` ist nahezu null: Brutto-Sharpe 0,15 (BTC) bzw.
  0,38 (ETH), mit Gegenbewegungen bis +33 % in 7 Tagen.
- Im Fenster liegen nur zwei Bärenphasen, deshalb ist ein Nachweis praktisch
  nur über Jahrzehnte möglich.
- Wert hätte sie vor allem als Krisenschutz, nicht als Ertrag.
- Erst sinnvoll, wenn der Betreiber ADR 0020 entscheidet und ein Modell für
  Funding- und Leihkosten existiert.

## 7. Empfehlung

### 7.1 Rangfolge

1. **D1, Risikobudget statt Trade-Budget.** Empfohlen.
2. D2, Prozess. Begleitend: Die Arbeitsregeln „entscheidendes Kriterium
   zuerst“ und „kurze Stufe A“ gelten schon für D1.
3. D3, Trend über weitere Anlageklassen. Der strategisch richtige nächste
   Ertragsbaustein, sobald neue Infrastruktur vertretbar ist.
4. D4, marktneutraler Querschnitt. Nur als billige Wissensfrage, wenn der
   Betreiber das Ergebnis auch ohne Umsetzungsweg will.
5. D5, Short-Trendfolge. Erst nach ADR 0020.

### 7.2 Warum D1

1. **Größter wirtschaftlicher Hebel bei kleinstem Bau.** Die Allokation
   ändert die absolute Rendite um eine Größenordnung. Kein Signal hat bisher
   die Sharpe nachweisbar bewegt.
2. **Sie beantwortet die Grundfrage, die alle anderen Studien offenließen:**
   Ist SignalPilots Beitrag ein Handelsvorteil, oder ist er
   Risikosteuerung? Wenn das Gate nach Kosten und Steuern nicht mehr leistet
   als ein risikogleiches Halten, ist das beste „System“ eine kleine,
   risikogesteuerte Kernposition und keine Trading-Maschine. Das zu wissen
   ist selbst wirtschaftlich wertvoll.
3. **Sie braucht keine neuen Daten und keine neue Anlageklasse,** nur
   vorhandene Bausteine: Limit-Set-Versionen, Sizing-Policy, Arena-Teilnehmer.
4. **Das Hauptrisiko ist vorab steuerbar,** über ein Verlustbudget des
   Betreibers, den Ausschluss von Hebel und einen Drawdown-Kill.

### 7.3 Kleinster sinnvoller erster Schritt: Phase-0-Vorregistrierung „Risikobudget V1“

0 USD, kein Datenzugriff, kein Code. Höchstens zwei Seiten, nach der Regel
„entscheidendes Kriterium zuerst“.

**a) Fünf Vorgaben des Betreibers** (Eingabe, nicht Ergebnis der Studie):

| # | Frage | Vorschlag zur Auswahl |
|---|---|---|
| F1 | Größter tolerierter Drawdown des Shadow-Kapitals | 10 / 20 / 30 % |
| F2 | Größter Verlust aus einer einzelnen 24-h-Lücke (BTC und ETH zusammen) | 5 / 10 % |
| F3 | Hebel | ausgeschlossen, brutto ≤ 100 % (empfohlen) |
| F4 | Maßstab | Geldmarkt (S1 **und** S2) und risikogleiches Kaufen und Halten nach Kosten; Steuerszenario DE als Bericht (empfohlen: beides) |
| F5 | Folge eines Erfolgs | eigener Shadow-Teilnehmer in getrennter Kohorte, `OFFICIAL_V1` unberührt (empfohlen) |

**b) Inhalt der Vorregistrierung:**

- **Frage:** Welche von höchstens drei vorab festgelegten Allokationsregeln
  hält das Verlustbudget ein, und was bleibt nach Kosten gegenüber den
  Maßstäben aus F4?
- **Regeln, nicht optimiert:**
  - A0: Status quo, 0,25 % je Trade.
  - A1: Dieselben Trades, Risiko je Trade so skaliert, dass das Lückenszenario
    F2 gerade hält. Damit wird geprüft, wo R-010 und R-021 brechen.
  - A2: Halten bei offenem Gate mit einer Zielvolatilität, die aus F1 folgt.
    Nur Regime-Exit und Drawdown-Kill, kein 4R-Ziel, kein 30-Tage-Backstop.
- **Entscheidendes Kriterium zuerst:** Hält A1 oder A2 F1 und F2 in den
  dokumentierten Stressphasen ein? Wenn nein, endet die Studie dort.
- **Danach, als Bericht:** Gate gegenüber risikogleichem Halten, Häufigkeit
  der Kill Switches, Kosten, S1/S2, Steuerszenario.
- **Ergebnisklassen:**
  - `TRAGFÄHIG`: Budget hält, Gate leistet mehr als risikogleiches Halten.
  - `NUR_BETA_SKALIERUNG`: Budget hält, aber kein Mehrwert gegenüber
    risikogleichem Halten. Das ist eine Anlage-, keine Trading-Entscheidung.
  - `NICHT_TRAGFÄHIG`: Budget bricht.
- **Mehrfachtest:** Vergleicht die Studie Renditen der Regeln, zählen A1
  und A2 zu N (57 → 59); A0 ist der Bestand. Ausdrücklich gilt: Renditen auf
  verbrauchten Daten sind kein Vorteilsnachweis. Der Nachweis kommt nur
  forward.
- **Folgeschritte, jeweils mit eigener Freigabe:**
  1. Phase 1, ein Lauf auf vorhandenen lokalen Reihen;
  2. ADR für Limit-Set v2, Sizing-Policy und Drawdown-Kill;
  3. ein getrennter Shadow-Teilnehmer.

### 7.4 Was die Empfehlung ändern würde

- **Der Betreiber will auch im Shadow kein nennenswertes Krypto-Beta
  tragen** (F1 ≤ 5 %): Dann ist D1 wirtschaftlich bedeutungslos, und D3 ist
  der einzige Weg zu relevanter Rendite.
- **Der Steuer-Nachteil gilt als ausschlaggebend:** Dann verschiebt sich D1
  zu einer Frage nach seltenerem Umschichten. D3 gewinnt, weil ETFs keine
  Haltefrist-Asymmetrie haben.
- **Der Forward-Test zeigt nach 6 Monaten oder 30 Trades** (frühestens
  2027-04) eine klar negative Challenger-Bilanz: Dann sinkt die Erwartung an
  das Gate. D1 schrumpft auf die Frage, ob ein risikogesteuertes Halten
  überhaupt gewollt ist.

## 8. Was unverändert blieb und welche Daten berührt wurden

- **Unverändert:**
  - Code, Risk Engine, Limit-Set, Regime-Modelle, Strategien, Gates;
  - Arena, Champion, Challenger, VPS, `OFFICIAL_V1`;
  - main.
- **Gelesen:**
  - die verlinkten Berichte;
  - `packages/risk-engine/src/policy-v1.ts` und `position-sizing.ts`;
  - Dokumente 06, 17 und 20, ADR 0015;
  - den ADR-Entwurf 0020 (`cc76f6e`, nur lesend).
- **Nicht berührt:**
  - keine Marktdaten, kein Datenverzeichnis, keine Datenbank;
  - keine Forward-Daten.
- **Mehrfachtest:** Es wurde keine Konfiguration geprüft. **N bleibt 57.**
- **Überschläge** (Notional aus Risiko und Stop, Lückenverlust, Kelly-Anteil,
  Steuerfaktor, Schwellen für N) sind Arithmetik auf dokumentierten oder
  ausdrücklich angenommenen Parametern, keine neuen Renditeberechnungen.
