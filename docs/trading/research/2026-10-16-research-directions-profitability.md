# Forschungsrichtungen für zusätzliche risikobereinigte Nettorendite — Analyse (2026-10-16)

Stand: Branch `claude/inspiring-noether-rjh92d` @ `e635892` · Gates v4
(`8f55cf8e…`) · Mehrfachtest-Zähler N = 53 (Schwelle 2,82) · Familie
REGIME_PULLBACK_LONG geschlossen (F4) ·
[Bewertung des Startgenoms](2026-10-16-regime-pullback-seed-evaluation.md)

> Reine Analyse. Es wurde **keine Strategie implementiert**, **keine
> Risk-Regel und kein Limit geändert**, kein Forschungszyklus und kein
> KI-Aufruf gestartet (0 USD), nichts auf dem VPS und am offiziellen
> Forward-Test berührt. Die beschreibenden Statistiken in diesem Bericht
> stammen aus bereits analysierten Daten. Sie erzeugen Hypothesen, **keinen
> Erfolgsnachweis**. Keine Handelsempfehlung.

## Ergebnis in Kürze

1. **Der Engpass ist strukturell, nicht eine Frage der Parameter.** Jede
   neue Long-Familie unter R-020 auf BTC/ETH handelt in denselben
   `RISK_ON`-Phasen wie der Challenger und lädt auf dasselbe Krypto-Beta.
   `OWN_ALPHA` verlangt auf 69 Monaten ein jährliches Informationsverhältnis
   (IR) von rund **1,2** gegenüber dem Bestand. Innerhalb dieser drei Wände
   (nur Long, nur `RISK_ON`, nur BTC/ETH) ist das praktisch nicht
   erreichbar. Das hat die Pullback-Familie bestätigt (α t −0,34).
2. **R-020 kostet vor allem die `NEUTRAL`-Phasen, nicht die Bärenmärkte.**
   Brutto, ohne Kosten, 2018-04 bis 2023-12:
   - `NEUTRAL` (23 % der Tage): Long-Drift BTC +62 % p. a. (Sharpe 1,1) und
     ETH +117 % p. a. (Sharpe 1,5); positiv in 4 von 6 Jahren.
   - `RISK_OFF` (37 % der Tage): nahezu keine Drift (BTC −11 % p. a. bei
     77 % Volatilität). Dort liegt Schwankung, kein verlässlicher Short-Ertrag.
   - `MIXED` (10 %) ist stark negativ; R-020 schützt dort zu Recht.
   - Was in `NEUTRAL` verpasst wird, ist aber **dasselbe Beta zu anderer
     Zeit**, kein eigener Vorteil.
3. **Short, Mean-Reversion und Kurzfrist-Momentum sind auf BTC/ETH
   schwach belegt.**
   - Stundenweise Umkehr ist zu klein für die Kosten von rund 0,30 % je
     Round-Trip.
   - Nach Kursstürzen außerhalb von `RISK_ON` folgt im Mittel **weiterer
     Rückgang**, keine Erholung.
   - Ein Short in `RISK_OFF` hätte brutto nur Sharpe 0,15 (BTC) bzw. 0,38
     (ETH) erzielt, bei heftigen Gegenbewegungen (+33 % in 7 Tagen).
4. **Mehr Kryptowährungen diversifizieren eine Long-Strategie kaum.** Die
   mittlere paarweise Korrelation von neun Majors liegt bei 0,80, Altcoin-Betas
   bei 1,3–1,45. Mehr Coins bringen aber **Breite** (Querschnittsstreuung rund
   28 % p. a.). Das ist Rohstoff für relative Strategien.
5. **Fast jede einschränkende Grenze, die zusätzlichen Ertrag verhindert,
   ist eine harte Risk-Engine-Grenze**: R-004/R-015 (Universum), R-005
   (Richtung), R-006 (keine Derivate) und R-020 (Regime). Zwei Befunde sind
   neu:
   - **Der Short-Pfad ist doppelt gesperrt.** R-020 verlangt für SHORT
     `RISK_OFF` *und* einen Risk Mode außer `HIGH_RISK`. Jedes Regime-Modell
     setzt bei `RISK_OFF` aber `HIGH_RISK`. Ein SHORT kann R-020 deshalb nie
     bestehen, auch nicht mit allen Flags.
   - **Die geringe absolute Rendite kommt aus der Positionsgröße**, nicht
     aus fehlendem Vorteil. 0,25 % Risiko je Trade bei 2 × ATR(1d) Stop heißt
     rund 2,8 % des Kapitals in BTC; der Challenger erzielt so etwa 2,1 % p. a.
     Das ist eine Risiko-Entscheidung (R-009, über R-026 festgenagelt) und
     ändert die Sharpe nicht.
6. **Empfehlung:** Als nächsten Handelsansatz **marktneutrales
   Funding-/Basis-Carry** (Spot long, Perpetual short) erforschen.
   - Begonnen wird mit einer vorregistrierten Machbarkeitsstudie auf
     kostenlosen, für SignalPilot neuen Funding-Daten. Die Studie braucht
     keine Regeländerung.
   - Begründung: Es ist der einzige Ansatz mit plausibel hohem IR, nahezu
     ohne Beta zum Bestand und mit wenigen freien Parametern. Er wäre auch der
     einzige, der sich im Forward-Test in wenigen Jahren statt Jahrzehnten
     belegen ließe.
   - Rang 2: relative Stärke über ein erweitertes Spot-Universum. Das ist die
     Alternative, falls Derivate grundsätzlich ausgeschlossen bleiben.
   - Rang 3: Trendfolge-Short in `RISK_OFF`.

## 1. Ausgangslage: Wo heute Ertrag entsteht

**Bestand im gemeinsamen Portfoliomodell** (Vergleich A,
[Protokoll](2026-10-16-portfolio-replay-validation-and-gates-v4-counterprobe.md)),
Entdeckung + Validierung, 69 Monate, 60 000 USDT:

| | Netto | Σ R | Kill-Switch | Anmerkung |
|---|---:|---:|---:|---|
| Champion `CRYPTO_TREND_CORE_LONG_V1` | −543,57 USDT | −10,6 R | 24 | getrennt je Symbol etwa +15,8 R (Befund T1) |
| Challenger `CRYPTO_REGIME_LONG_V1` | +2 529,73 USDT | +48,4 R | 13 | ≈ **2,1 % p. a.** auf den 20 000-Platz |
| Gruppe | +3,31 % in 5¾ Jahren | – | – | max. DD 1,3–1,6 % (je nach Protokoll), Ø Kapitalbindung 0,75 % |

**Positionsgröße statt Vorteil.** Der Challenger hält bei offenem Gate eine
Position mit 0,25 % Risiko und einem Stop bei 2 × ATR(14, 1d). Der Stop liegt
im Median 9,0 % unter dem Einstieg (BTC, `RISK_ON`). Daraus folgt eine
Position von rund **2,8 % des Platzkapitals** (P10–P90: 1,8–4,2 %). Selbst ein
Halte-Filter mit Brutto-Sharpe um 2 bringt bei dieser Größe nur 1–2 % p. a.
auf das Kapital. Das Risikobudget wird kaum genutzt (max. Drawdown der Gruppe
1,3–1,6 % in 5¾ Jahren).

Das ist eine **Risiko-Entscheidung**: 0,25 % je Trade (R-009) ist über R-026
an den Hash des Limit-Sets gebunden. Eine größere Position ändert die Sharpe
nicht, sondern tauscht Drawdown 1 : 1 gegen Rendite. Sie ist deshalb kein
neuer Vorteil und nicht Teil der Empfehlung. Sie ist aber die mit Abstand
größte Stellschraube für die *absolute* Rendite; die Entscheidung liegt beim
Betreiber.

**Warum die Evolution bisher nichts Zusätzliches fand.** Alle bisherigen
Familien liegen innerhalb derselben drei Wände:

- nur Long (R-005);
- nur `RISK_ON` (R-020, zusätzlich in jeder registrierten Strategie intern
  geprüft);
- nur BTC/ETH (R-004, R-015, Split, Kostenmodell).

Darin teilt jede Long-Idee die Zeit im Markt und das Beta des Challengers:

- Regime-Varianten hatten 98–100 % gemeinsame Einstiege.
- Die Pullback-Familie hatte 100 % der Einstiege bei offener
  Challenger-Position oder binnen ±24 h.

Gates v4 verlangt zu Recht eigenes α mit t ≥ 2,82. Auf 69 Monaten entspricht
das einem IR von **1,18** gegenüber dem Bestand.

## 2. Was R-020 und die Beschränkung auf RISK_ON kosten (Frage 1)

Methode: `crypto-native-regime-v1` wurde auf Tagesschlusskursen
nachgebildet. Das Label eines Tages gilt für den Folgetag, es gibt also keinen
Vorgriff. Ausgewertet sind Tagesrenditen in Entdeckung + Validierung
(2018-04-01 – 2023-12-31), brutto und ohne Kosten.
Kontrollwert: 30,0 % `RISK_ON`-Tage gegenüber 29,9 % in der
[Regime-Studie](2026-10-14-training-results.md). Die Nachbildung stimmt also.
Alle Tabellen stehen in Anhang A.

### 2.1 Drift je Regime

| Regime | Anteil Tage | BTC Ø p. a. | BTC Sharpe | ETH Ø p. a. | ETH Sharpe | t (NW) BTC / ETH |
|---|---:|---:|---:|---:|---:|---:|
| `RISK_ON` | 30,0 % | +136 % | +2,08 | +150 % | +1,92 | +2,76 / +2,57 |
| `NEUTRAL` | 22,9 % | +62 % | +1,06 | +117 % | +1,49 | +1,18 / +1,82 |
| `MIXED` | 10,3 % | −189 % | −2,80 | −258 % | −2,63 | −2,11 / −1,92 |
| `RISK_OFF` | 36,8 % | −11 % | −0,15 | −40 % | −0,38 | −0,23 / −0,59 |
| alle Tage | 100 % | +31 % | +0,46 | +31 % | +0,34 | +1,10 / +0,82 |

(Log-Renditen × 365; Sharpe ohne risikofreien Zins.)

### 2.2 Was verpasst wird

- **`NEUTRAL` ist die eigentliche Lücke.** Dort liegt zusätzlich rund ein
  Drittel (BTC) bis knapp 60 % (ETH) dessen, was `RISK_ON` brutto liefert
  (Σ log +82 % gegen +235 % bzw. +154 % gegen +259 %). Die drei Unterfälle sind
  ähnlich positiv:
  - Aufwärtstrend mit kurzer Schwäche (BTC über SMA200, 20-Tage-Momentum
    negativ);
  - tiefer Rücksetzer im Aufwärtstrend (beide unter SMA50);
  - frühe Erholung unter der SMA200.
- **Der Anfang neuer Aufwärtstrends.** Vom 60-Tage-Tief bis zur Gate-Öffnung
  stieg BTC im Median um **+41,5 %** (20 Episoden). Das ist eine Obergrenze,
  weil das Tief erst im Nachhinein bekannt ist. Es ist der Preis der
  Bestätigung durch SMA200 und SMA50.
- **Die größten Kurssprünge außerhalb von `RISK_ON`** fallen in `NEUTRAL`
  (5 von 8, z. B. +38 % ab 2021-02-02, +36 % ab 2023-03-11) und in
  `RISK_OFF` (3 von 8, z. B. +33 % ab 2021-09-30).

**Warum das trotzdem kein zusätzlicher Vorteil ist:**

- `NEUTRAL`-Long verdient in denselben Jahren wie der Challenger (2019–2021,
  2023) und verliert in den Bärenjahren (2018 −13 %, 2022 **−55 %** BTC).
- Es ist zusätzliche Marktzeit mit demselben Krypto-Beta: die Rendite wird
  höher, nicht unabhängiger.
- Die Statistik ist schwach (t 1,2 / 1,8 ohne Mehrfachtest-Korrektur).
- Eine solche Erweiterung bräuchte eine Änderung von R-020 oder des
  Regime-Modells. Unter `OWN_ALPHA` hätte sie wenig Aussicht.

### 2.3 Was nicht verpasst wird

- **`RISK_OFF`: Schwankung, keine Drift.**
  - Für BTC stehen Plus-Tage mit Σ +956 % Minus-Tagen mit Σ −980 % gegenüber,
    bei 77 % Volatilität (ETH 104 %).
  - Ein Short über alle `RISK_OFF`-Tage hätte brutto nur Sharpe 0,15 (BTC)
    bzw. 0,38 (ETH) erzielt. Ohne Funding- und Leihkosten gerechnet ist das
    eher zu optimistisch.
  - Auch der Unterfall „Momentum negativ" ist kaum besser (0,16 / 0,52).
- **`MIXED`: das Gate schützt.** Wenn BTC und ETH auf verschiedenen Seiten
  ihrer SMA50 liegen, fällt der Markt im Mittel stark. R-020 hält Longs dort
  zu Recht heraus.
  - Für einen Short sieht das verlockend aus (brutto Sharpe ~2,7).
  - Die Basis sind aber nur 217 Tage, verteilt auf viele kurze Episoden mit
    Schwerpunkt 2018, 2019 und 2021.
  - Nach Mehrfachtest-Korrektur ist der Befund nicht signifikant. Unter R-020
    wäre ein SHORT in `MIXED` ohnehin nicht zulässig.

**Fazit zu Frage 1:** R-020 kostet vor allem *Beta-Zeit* in `NEUTRAL` und
den Anfang von Trends. Einen verlässlichen Short-Ertrag in Bärenphasen
kostet es nicht. Wer die verpasste Long-Rendite holt, erhöht das Engagement
im selben Faktor; ein unabhängiger Ertrag entsteht dadurch nicht.

## 3. Short, Mean-Reversion, Momentum und andere Ansätze (Frage 2)

Kurzfristige Abhängigkeit auf 1h-Daten, Entdeckung + Validierung, brutto
(Anhang A.3). Schock = 24h-Rendite jenseits ±2σ der 30-Tage-Stundenvolatilität.
Die Folgerendite ist ab der nächsten Stunde gemessen; nach jedem Ereignis gilt
eine Sperre von 24 h.

### 3.1 Eigenständige Short-Strategien

| | Befund |
|---|---|
| Drift | `RISK_OFF` nahezu null (Abschnitt 2.3); ein Halte-Short hat kaum Ertrag |
| Nach Abstürzen in `RISK_OFF` | 72h-Folgerendite BTC −1,40 % (t −1,07), ETH −2,01 % (t −1,31): schwache Fortsetzung, also eher Trendfolge-Short als Halte-Short |
| Risiko | Gegenbewegungen bis +33 % in 7 Tagen; nur zwei echte Bärenphasen im Datenfenster (2018, 2022), also kaum Stichprobe |
| Modell | synthetisch und ungehebelt **ohne Funding** (ADR 0012), dadurch systematisch zu optimistisch |
| Stand | Domain und Strategie `CRYPTO_MTF_BREAKDOWN_SHORT_V1` vorhanden; Risk-Sizing, Simulation, Worker und API (S3–S8) offen |
| Sperren | R-005 (fester Schlüssel und zwei Flags) **und** R-020: Der Short-Pfad ist unerreichbar (Abschnitt 5.2) |

**Urteil:** Als Diversifikator ist ein Short konzeptionell der stärkste
Ansatz, weil er in der Gegenrichtung und im Gegenregime handelt. Erwartete
Nettorendite und Nachweisbarkeit sind aber gering. Krypto hat eine positive
Langfristdrift und heftige Short-Squeezes. → Rang 3.

### 3.2 Mean-Reversion

- **Stundenumkehr:** Die Autokorrelation der 1h-Renditen liegt bei −0,02 bis
  −0,04. Bei rund 0,6–0,8 % Stundenvolatilität ist der erwartbare Vorteil je
  Trade ein Bruchteil von 0,1 %. Kosten (VIP0: 10 bp Gebühr je Seite plus
  Spread und Slippage) liegen bei rund **0,30 % je Round-Trip**.
  → **K.O. durch Kosten.**
- **Mehrtägige Umkehr in `RISK_ON`:** Das Varianzverhältnis über 72 h liegt
  bei 0,72–0,79, es gibt also etwas Umkehr. Nach Abstürzen in `RISK_ON` folgt
  BTC +1,57 % in 72 h, bei einer normalen 72h-Drift in `RISK_ON` von rund
  +1,1 %. Der Mehrertrag ist klein, und die Pullback-Familie hat genau das
  ohne eigenes α gemessen. → gering.
- **Kapitulation außerhalb von `RISK_ON` kaufen** (Idee aus dem
  [Pullback-Entwurf, Abschnitt 12](2026-10-15-evolution-family-regime-pullback-draft.md)):
  - Nach Abstürzen in `RISK_OFF`, `MIXED` und `NEUTRAL` folgt im Mittel
    **weiterer Rückgang**: BTC −1,1 bis −1,8 % in 72 h, nur 35–41 % der Fälle
    positiv.
  - Die Daten stützen die Idee also nicht. → gering, und R-020 müsste
    geändert werden.
- **Strukturelle Hürde R-008:** Mindestens netto 2R erzwingt ein Ziel jenseits
  des 2,3-Fachen des Stopabstands. Mean-Reversion lebt aber von kleinen
  Zielen und hoher Trefferquote. Mit weitem Stop scheitert sie an R-008, mit
  engem Stop am Rauschen.

### 3.3 Kurzfristiges Momentum

- **Nach starken Anstiegen (+2σ)** folgt in `RISK_ON` und `NEUTRAL` im Mittel
  weiterer Anstieg: BTC +2,0 % bzw. +2,6 % in 72 h (t 2,6 / 2,3), ETH in
  `RISK_ON` +2,4 % (t 2,2). Das ist das Terrain der Ausbruchsfamilie
  (Champion).
- **Vorbehalt:** Von rund 40 berechneten Zellen besteht keine die Schwelle
  2,82. Der Befund ist ein Hinweis, kein Beleg.
- **Die Ausbruchsfamilie ist ausgereizt:**
  - 10 von 10 Validierungen scheiterten an 2022-H2/2023;
  - viele geprüfte Konfigurationen;
  - mechanische Lasten: Stop-Kappe 3 %/6 % (laut Bedingungsstudie
    kontraproduktiv) und R-021 über BTC und ETH im selben Portfolio (T1).
- → gering bis mittel; keine neue Familie, solange der Champion im
  Forward-Test läuft.

### 3.4 Funding-/Basis-Carry (marktneutral)

- **Mechanik:**
  - Spot long und gleich großer Perpetual short auf dasselbe Asset.
  - Die Kursrichtung hebt sich auf; Ertrag ist das Funding, das gehebelte
    Longs an Shorts zahlen.
  - Nach der veröffentlichten Binance-Formel für USDⓈ-M-Kontrakte beträgt das
    Funding bei kleiner Prämie genau den Zinsanteil von 0,01 % je 8 h, also
    rund **11 % p. a. als Grundwert**. In Bullenphasen ist es höher, in
    Bärenphasen null oder negativ. Die Formel ist in Phase 1 an den Daten zu
    prüfen.
- **Ökonomische Begründung:** Strukturelle Nachfrage nach gehebeltem Long.
  Die Gegenpartei ist bekannt und dauerhaft, es braucht keine
  Prognosefähigkeit.
- **Ertrag nach Kosten (Annahme, nicht gemessen):**
  - Beide Beine kosten zusammen rund 0,3–0,4 % je Round-Trip (Spot VIP0
    10 bp, Perp-Taker rund 5 bp je Seite, dazu Spread). Beim Grundwert von
    0,03 % je Tag ist das nach etwa 10–13 Tagen verdient.
  - Ungehebelt bindet die Strategie Kapital in beiden Beinen. Die Rendite auf
    das Platzkapital liegt dann grob bei der Hälfte der Funding-Rate, je nach
    Collateral-Modell.
- **Risiken:**
  - Funding-Phasen mit negativem Vorzeichen (2022).
  - Kompression des Funding durch große Basis-Strategien seit 2024 (genau das
    muss Phase 1 messen).
  - In der Realität dominieren Börsen- und Gegenparteirisiko (2022), Margin
    und Liquidation des Short-Beins sowie Auto-Deleveraging. Der Shadow
    zeigt sie nicht und muss sie als Abschlag ausweisen.
- **Unabhängigkeit:** nahezu kein Kurs-Beta.
  - Der Ertrag ist prozyklisch: hohes Funding fällt in Bullenphasen. Die
    Monatsrenditen sind trotzdem praktisch unabhängig vom Challenger.
  - `OWN_ALPHA` misst hier fast nur die eigene Sharpe.
- **Daten:** Lokal nichts vorhanden, aber kostenlos öffentlich (Binance
  Datenarchiv, Perpetuals seit 2019-09). Für SignalPilot sind die Daten
  **neu**: Noch keine Regel wurde daran angepasst.
- **Aufwand:** sehr hoch.
  - neue Instrumentart Perpetual;
  - Funding-Buchungen im Ledger;
  - abgesichertes Paar als eine Position;
  - Konflikte mit R-005, R-006 und ADR 0013;
  - passt nicht in das R-basierte Regelwerk (kein Stop, kein 2R-Ziel), braucht
    also einen eigenen Risk-Regelsatz;
  - Gates v5, weil der v4-Hash Symbole und Regime-Policy enthält.
- **Freie Parameter:** sehr wenige (halten oder nur bei positivem
  gleitendem Funding). Damit ist das Überanpassungsrisiko gering.

### 3.5 Funding, Open Interest und Liquidationen als Timing-Information

- Neue Information über Positionierung statt Preis. Die Pullback-Bewertung
  nennt sie ausdrücklich als „nicht widerlegt".
- Ließe sich **ohne Regeländerung** nutzen (Long, Spot, `RISK_ON`). Das ist
  der einzige neue Ansatz, für den das gilt.
- Bleibt aber im selben Beta und derselben Zeit wie der Challenger; der
  Pullback-Befund (α −0,34) zeigt, wie schwer das ist.
- Daten: Funding ab 2019 frei verfügbar, Open-Interest-Historie deutlich
  kürzer. → mittel bis gering.

### 3.6 Relative Stärke über ein breiteres Universum

- **Idee:** Im Querschnitt liquider Spot-Paare die relativ stärksten halten.
  Zuerst long-only in `RISK_ON`, später marktneutral.
- **Begründung:** Das Querschnitts-Momentum in Krypto ist dokumentiert; in
  großen, liquiden Coins ist es schwächer und zeitlich instabil.
- **Statistik:** Breite ist der einzige Hebel, der das nötige IR auf
  historischen Daten überhaupt erreichbar macht (Fundamental Law: IR ≈ IC ×
  √Breite).
- **Unabhängigkeit:**
  - Long-only trägt Altcoin-Beta von 1,3–1,45 und bleibt damit mittel.
  - Marktneutral wäre sie hoch, bräuchte aber Shorts.
- **Daten:** frei verfügbar und für SignalPilot neu. Die Dev-Datenbank hat
  schon 14 Monate für 8 Paare. Zwingend nötig ist ein Universum **ohne
  Überlebens-Verzerrung**, also mit delisteten Paaren wie MATIC, LUNA und FTT.
- **Aufwand:** hoch.
  - R-004 und R-015 sind fest auf BTC/ETH.
  - Kostenprofile je Symbol, Split und Gates v5 sind nötig.
  - Die Laufzeit des Replays wächst linear mit der Symbolzahl (rund 8 s je
    Symbol und Monat).

### 3.7 Übrige

- **Kalender- und Tageszeiteffekte:** wenig ökonomische Begründung, hohe
  Gefahr der Datensuche, kostenempfindlich. → nicht verfolgen.
- **Ereignisse und Nachrichten** (`events-intelligence`,
  `news-intelligence`): Es gibt keine belastbare Historie für einen Test.
  → später.

## 4. Weitere Kryptowährungen und andere Märkte (Frage 3)

**BTC/ETH (Entdeckung + Validierung):**

- Korrelation der Tagesrenditen 0,84 insgesamt, **0,90 in `RISK_OFF`**.
- ETH-Beta 1,1–1,2.
- Gerade im Stress verschwindet die Diversifikation. Die Live-Entscheidung,
  nur BTC zu handeln, kostet deshalb wenig Diversifikation.

**Weitere Majors** (Dev-Datenbank, 2025-07-29 – 2026-10-14):

- Gerechnet wurde nur die Struktur: Korrelation, Beta, Volatilität. Mittlere
  Renditen wurden bewusst **nicht** gerechnet, weil das Fenster im bereits
  analysierten Holdout-Zeitraum liegt.

| | Vol p. a. | Korr. mit BTC | Beta | Rest-Vol p. a. |
|---|---:|---:|---:|---:|
| ETH | 64 % | 0,88 | 1,32 | 31 % |
| SOL | 69 % | 0,85 | 1,36 | 37 % |
| XRP | 66 % | 0,86 | 1,31 | 34 % |
| BNB | 51 % | 0,76 | 0,90 | 33 % |
| ADA | 78 % | 0,79 | 1,45 | 48 % |
| DOGE | 74 % | 0,78 | 1,35 | 46 % |
| LINK | 76 % | 0,78 | 1,39 | 47 % |
| AVAX | 80 % | 0,71 | 1,33 | 57 % |

- Mittlere paarweise Korrelation aller neun Paare: **0,80**. Ein
  gleichgewichteter Korb korreliert mit BTC zu 0,89.
- **Für Long-Strategien:** Mehr Coins bringen mehr Volatilität und dasselbe
  Beta. Das ist keine echte Diversifikation.
- **Für relative Strategien:** Die Rest-Volatilität von 31–57 % p. a. und die
  Querschnittsstreuung von rund 28 % p. a. sind der Rohstoff. Erst dort hat
  ein breiteres Universum echten Wert, als Breite (Abschnitt 3.6).
- Die scheinbar niedrigere Korrelation an BTC-Verlusttagen ist ein bekannter
  Auswahleffekt bedingter Korrelationen und kein Abwärtsschutz.

**Aktienindizes** (FRED-Proxys, wöchentlich, Entdeckung + Validierung):

- Die Korrelation BTC–Nasdaq-100 liegt bei 0,25. Sie schwankt aber zwischen
  −0,07 (2019) und **0,42 (2022)**, ist also im Bärenmarkt am höchsten.
- Für ein Long-Engagement in Aktien gibt es keinen Live-Kursfeed (Finnhub
  `/stock/candle` liefert 403) und nur Schlusskurse als Proxy.
  → K.O. für jetzt.

**Gold und Devisen über Binance-Spot-Token** (z. B. PAXGUSDT, EURUSDT):

- Erreichbar über dieselbe Datenquelle; das Kursverhalten ist weitgehend
  unabhängig von Krypto.
- Ertragschance gering: Trendfolge auf Gold liegt historisch bei Sharpe von
  rund 0,3–0,5. Die Kapazität ist klein, die Historie kurz (seit etwa 2020).
- Nötig wären R-004 und ein **anlagespezifisches** Regime. R-020 würde einen
  Gold-Long heute sperren, sobald *Krypto* nicht `RISK_ON` ist.
- → interessant für später, nicht jetzt.

## 5. Woher die Einschränkungen kommen (Frage 4)

### 5.1 Übersicht

| Einschränkung | Quelle | Art | Gemessene Wirkung |
|---|---|---|---|
| Long nur bei `RISK_ON` | R-020 (`policy-v1.ts:76-87`) **und** internes Gate jeder registrierten Strategie | Risk Engine hart; in Strategien doppelt | 70 % der Tage gesperrt; Pullback: 75 % der Signale (3 878) |
| Was `RISK_ON` heißt | `crypto-native-regime-v1` (SMA200/SMA50/20-Tage-Momentum/ETH-Breite), per `regimeSource` der Strategie gewählt | **Strategie-/Modellentscheidung** | definiert 30 % Marktzeit; `NEUTRAL` positiv, aber gesperrt |
| Short | R-005 (fester Schlüssel, zwei Flags) und R-020 (`RISK_OFF` + `HIGH_RISK` verboten) | Risk Engine hart; **logisch unerreichbar** (5.2) | kein Short möglich |
| Universum BTC/ETH | R-004, R-015 (`CRYPTO_MAJOR`) | Risk Engine hart | jedes andere Symbol wird abgelehnt |
| | Evolution-Split, Kosteninstrumente, v4-Hash | Forschungsentscheidung | neues Symbol braucht Gates v5 |
| | Snapshots nur BTC/ETH; Live nur BTC (ETH-Zuweisung aus) | Daten-/Betriebsentscheidung | – |
| Keine Derivate, kein Hebel | R-006, R-005 (Capability), ADR 0001/0012 | Risk Engine hart | kein Carry, kein Perp |
| Eine Position je Asset und Portfolio, kein Nachkauf | R-014, R-022, ADR 0013 | Risk Engine hart | Pullback: 22 % der Signale (1 135) |
| 0,25 % Risiko je Trade | R-009 | Limit-Set, **über R-026 festgenagelt** | ≈ 2,8 % Notional; Challenger ≈ 2,1 % p. a. |
| 1 % Tagesverlust, 3 Verluste in Folge → Kill Switch | R-010, R-021 | Limit-Set, festgenagelt | mit T1: Champion −10,6 R statt +15,8 R |
| Mindestens netto 2R | R-008 | Limit-Set, festgenagelt | erzwingt Ziele 2,5–4R, die selten erreicht werden; strukturelle Hürde für Mean-Reversion |
| Max. 2 offene Positionen, 4 Trades je Tag | R-011, R-012 | Limit-Set, festgenagelt | nicht gemessen; bei zwei Symbolen kaum bindend, bei breitem Universum sofort |
| Stop 2 × ATR(1d) bzw. 1,5 × ATR(1h) mit Kappe | Strategieparameter | Strategieentscheidung | Notional-Größe; Kappe 3 % beim Champion kontraproduktiv |
| Ein Platz je Strategie mit BTC und ETH (T1) | Gates-v4-Simulation | Forschungsentscheidung (Hash) | R-021 zählt über beide Symbole |
| 1h/4h/1d, nur Spot-Kerzen, kein Funding/OI/Orderbuch | `market-data` (`supportedBinanceIntervals`) | Daten-/Technikentscheidung | Liquidations- und Positionierungsideen nicht testbar |
| t ≥ √(2·ln N) = 2,82, ≥ 36 Monate, `OWN_ALPHA` | Gates v2–v4 | Forschungs-Governance | nötiges IR ≈ 1,2 |

**Kurz gesagt:**

- Was **zusätzlichen** Ertrag verhindert, sind fast nur harte Risk-Engine-Grenzen:
  Richtung, Regime, Universum und Instrument.
- Was die **absolute** Rendite des Bestands klein hält, sind die
  Positionsgröße (Limit-Set) und Strategieentscheidungen: Stop-Geometrie, T1
  und die enge `RISK_ON`-Definition.

### 5.2 Neuer Befund: Der Short-Pfad ist auch bei offenen Flags gesperrt

- **Was R-020 verlangt** (`rules.ts:1471-1548`): für SHORT
  `cryptoRegime = RISK_OFF` **und** einen Risk Mode außer
  `DEFENSIVE`/`HIGH_RISK`/`UNKNOWN`.
- **Was die Modelle liefern:** Beide Regime-Modelle setzen bei `RISK_OFF`
  den Risk Mode `HIGH_RISK`:
  - Krypto-nativ: `market-regime/src/index.ts:434-435`;
  - Produktion: `:237-238`;
  - Replay `CRYPTO_ONLY`: `shadow-replay/src/research.ts:229`.
- **Folge:** Ein SHORT kann R-020 nie bestehen.
- **Dieselbe Sperre in der Strategie:** `CRYPTO_MTF_BREAKDOWN_SHORT_V1`
  (`specification-v1.ts:376`) scheitert immer an
  `REGIME_RISK_MODE_BLOCKED`.
- **Warum es nicht auffiel:** Die Test-Fixture nutzt die Kombination
  `RISK_OFF` + `NORMAL`, die kein Klassifikator erzeugt
  (`risk-engine/test/support/build-risk-snapshot.ts:240,298`).
- Weder Dokument 06 noch ADR 0011–0014 erwähnen das.

Heute ist das harmlos, weil alle Short-Flags aus sind. Wer die Short-Seite
weiterführt, muss es aber bewusst entscheiden: eine Risk-Regel-Version oder
eine Regime-Modell-Version, jeweils mit ADR. **Nicht geändert.**

### 5.3 Governance-Lücke: Die Regime-Quelle verschiebt R-020

- R-020 liest nur das Label. Welches Modell es liefert, wählt die
  Strategieversion über `regimeSource` (`regimeSource.ts:45-91`).
- Eine neue Regime-Modell-Version, etwa mit breiterem `RISK_ON`, würde R-020
  faktisch lockern, ohne das Paket `risk-engine` zu ändern.
- **Empfehlung (nur Prozess):** Regime-Modell-Versionen, die R-020 speisen,
  wie eine Risk-Regel-Änderung behandeln, mit ADR und Betreiberbeschluss.

## 6. Bewertungsmatrix

Skala 1–5, höher ist besser. „Risiko 5" heißt geringes Risiko, „Aufwand 5"
heißt geringer Aufwand.

| Kriterium | Gewicht | Bedeutung |
|---|---:|---|
| Ertragschance | 25 % | plausible zusätzliche Nettorendite nach Kosten |
| Unabhängigkeit | 20 % | vom Bestand: Beta, Zeit im Markt, Ertragsquelle |
| Nachweisbarkeit | 15 % | erreichbares IR, also Zeit bis zum Forward-Beleg (Zusatzkriterium) |
| Risiko | 15 % | Verlust- und Modellrisiko |
| Datenbasis | 10 % | vorhanden **und** unverbraucht |
| Aufwand | 15 % | Implementierung plus nötige Grundsatzentscheidungen |

| # | Ansatz | Ertrag | Risiko | Daten | Aufwand | Unabh. | Nachw. | **Score** | Nötige Grundsatzentscheidung |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| A | Funding-/Basis-Carry (Spot long + Perp short) | 4 | 3 | 3 | 1 | 5 | 4 | **3,50** | Perp-Instrument, abgesichertes Paar (ADR 0013), eigener Risk-Regelsatz (R-005/R-006/R-008), Gates v5 |
| B | Relative Stärke, erweitertes Spot-Universum | 3 | 2 | 4 | 2 | 3 | 2 | **2,65** | R-004/R-015-Universum, Kostenprofile, Gates v5; marktneutral zusätzlich Short |
| C | Trendfolge-Short in `RISK_OFF` | 2 | 2 | 2 | 3 | 5 | 1 | **2,60** | R-005 öffnen, R-020-Widerspruch (5.2) auflösen, S3–S8 |
| J | Gold/Devisen über Binance-Token | 2 | 4 | 3 | 1 | 4 | 1 | 2,50 | R-004, anlagespezifisches Regime statt R-020 |
| E | Funding/OI als Timing für Long in `RISK_ON` | 2 | 3 | 3 | 3 | 2 | 1 | 2,25 | keine (neue Datenart, Gates v5 für Daten) |
| D | Regime-Erweiterung: Long in `NEUTRAL` / früherer Wiedereinstieg | 3 | 2 | 2 | 4 | 1 | 1 | 2,20 | R-020 oder Regime-Modell (5.3) |
| F | Kurzfrist-Momentum / Ausbruch neu | 2 | 3 | 1 | 4 | 2 | 1 | 2,20 | keine |
| H | Kapitulations-Mean-Reversion außerhalb `RISK_ON` | 1 | 1 | 2 | 3 | 3 | 1 | 1,80 | R-020 |
| G | Mean-Reversion in `RISK_ON` mit neuer Mechanik | 1 | 3 | 1 | 4 | 1 | 1 | 1,75 | keine |
| I | Stunden-Umkehr | **K.O.** | | | | | | – | Vorteil ≪ 0,30 % Round-Trip-Kosten |
| K | Multi-Asset-Trend klassische Märkte | **K.O.** | | | | | | – | kein Live-Feed (Finnhub 403), nur Schlusskurs-Proxys |
| – | Risikobudget je Trade erhöhen | kein Ansatz | | | | | | – | R-009/R-026; hebt Rendite und Drawdown, nicht die Sharpe |

**Nachweisbarkeit.** Ein Forward-Test erreicht t ≈ IR × √Jahre. Bis t = 2,82
dauert es deshalb:

| IR gegenüber dem Bestand | 2,0 | 1,5 | 1,2 | 1,0 | 0,7 | 0,5 | 0,3 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Jahre | 2,0 | 3,5 | 5,5 | 8,0 | 16 | 32 | 88 |

- Gerichtete Krypto-Ansätze mit IR 0,3–0,7 gegenüber dem Bestand lassen sich
  in sinnvoller Zeit nicht belegen, weder historisch noch im Forward-Test.
- Ein marktneutraler Carry mit plausiblem IR von 1,5–2 ließe sich in 2–4
  Jahren belegen. Diese Werte sind eine Annahme und Gegenstand der Phase 1.

Die Gewichte sind eine Ermessensentscheidung. Die Rangfolge A > B ≈ C bleibt
auch bei gleichen Gewichten erhalten (A 3,33; B 2,67; C 2,50).

## 7. Drei Forschungsrichtungen mit dem größten Potenzial (Frage 5)

### Rang 1 — Marktneutrales Funding-/Basis-Carry

- **Warum:**
  - Die einzige Ertragsquelle ohne Kursrichtung.
  - Hat eine strukturelle Gegenpartei.
  - Kommt mit sehr wenigen freien Parametern aus.
  - Plausibles IR, das sich in Jahren statt Jahrzehnten belegen ließe.
  - Die Daten sind für SignalPilot neu.
- **Was dagegen spricht:**
  - Größter Bauaufwand.
  - Mehrere Grundsatzentscheidungen: Derivate im Shadow, Hedge-Paar und ein
    eigener Risk-Regelsatz.
  - Mögliche Kompression seit 2024.
  - Das Hauptrisiko in der Realität, die Börse als Gegenpartei, ist im Shadow
    unsichtbar.

### Rang 2 — Breite: relative Stärke über ein erweitertes liquides Spot-Universum

- **Warum:**
  - Bleibt bei Spot und darf zunächst long-only und unter R-020 bleiben.
  - Liefert Breite, also statistische Trennschärfe.
  - Arbeitet auf frischen Daten.
- **Was dagegen spricht:**
  - Long-only trägt hohes Altcoin-Beta; echte Unabhängigkeit erst
    marktneutral.
  - Überlebens-Verzerrung als Datenfalle.
  - Die Laufzeit des Replays wächst linear mit dem Universum.

### Rang 3 — Bärenmarkt-Seite: Trendfolge-Short in `RISK_OFF`

- **Warum:**
  - Der einzige gerichtete Diversifikator.
  - Das Fundament existiert (ADR 0011–0013, Domain, Strategie).
  - Abstürze in `RISK_OFF` setzen sich schwach fort.
- **Was dagegen spricht:**
  - Kaum Drift in `RISK_OFF`.
  - Nur zwei Bärenphasen in den Daten.
  - Funding fehlt im Modell.
  - Der R-020-Widerspruch (5.2) muss zuerst entschieden werden.
  - Geringe Nachweisbarkeit.

## 8. Empfehlung

**Als nächsten Handelsansatz das marktneutrale Funding-/Basis-Carry
entwickeln, in Stufen und mit einer vorregistrierten Machbarkeitsstudie als
erstem Schritt.**

### Begründung

1. **Es durchbricht die Wand, an der alle bisherigen Familien gescheitert
   sind.**
   - Kein Kurs-Beta, also keine Ladung auf den Challenger.
   - `OWN_ALPHA` misst hier tatsächlich einen eigenen Ertrag.
2. **Überanpassung ist kaum möglich.**
   - Die Regel hat praktisch keine Parameter.
   - Die Daten (Funding ab 2019) wurden in SignalPilot noch nie befragt.
   - Sie sind öffentlich und dem Sprachmodell bekannt. Ein historischer
     Befund bleibt deshalb Plausibilisierung, aber auf viel saubererer Basis
     als jede weitere Befragung von BTC/ETH 2018–2023.
3. **Es ist in absehbarer Zeit forward belegbar.** Bei IR 1,5–2 genügen
   2–4 Jahre. Für eine weitere gerichtete Long-Familie wären es Jahrzehnte.
4. **Der erste Schritt kostet nichts und ändert keine Regel.**

### Stufenplan

| Phase | Inhalt | Kosten | Regeländerung |
|---|---|---|---|
| 0 | **Vorregistrierung** der Machbarkeitsstudie, *vor* jedem Datenabruf: Hypothese, Datenquelle, genaue Halteregel (höchstens zwei vorab festgelegte Varianten, z. B. „immer" und „nur bei positivem 7-Tage-Funding"), Kosten (Spot VIP0, Perp VIP0), Collateral-Modell, Kennzahlen, Abbruchkriterien | 0 USD | keine |
| 1 | Freigabe des Downloads öffentlicher Funding- und Perp-Kursdaten BTC/ETH ab 2019-09 (gitignorierte Snapshots), Studie **einmal** rechnen und berichten. Beispiele für Kriterien, festzulegen in Phase 0: Netto-Carry auf Platzkapital > 0 in den meisten Kalenderjahren, Anteil negativer Funding-Monate, schlechtester Monat, Korrelation der Monatsrenditen mit dem Challenger, Entwicklung seit 2024 | 0 USD | keine |
| 2 | Nur bei bestandener Phase 1 und nach Betreiberbeschluss: ADRs für das Perp-Instrument im Shadow mit **gemessenem** Funding (Abgrenzung zu ADR 0012, das nur *erfundene* Raten ausschließt), abgesichertes Paar als Ausnahme zu ADR 0013, eigener Risk-Regelsatz für Carry, Bewertungsprotokoll (Gates v5) | Bauaufwand | ja, per ADR |
| 3 | Eigener Shadow-Forward-Teilnehmer, strikt getrennt von `OFFICIAL_V1` | – | – |

Phase 0 liegt vor:
[Vorregistrierung der Machbarkeitsstudie](2026-10-16-funding-carry-feasibility-preregistration.md)
(2026-10-16, zur Freigabe durch den Betreiber).

Ergebnis der Phase 1 (2026-10-17): `KOMPRIMIERT`. Bis 2023 war der Carry
attraktiv; seit 2024 liegt er unter Geldmarkt plus Abschlag. Er ist damit
geschlossen, nächster Schritt ist Rang 2
([Ergebnisbericht](2026-10-17-funding-carry-v2-results.md)).

### Was die Empfehlung ändern würde

- **Phase 1 zeigt nach Kosten keinen tragfähigen Carry**, etwa wegen
  dauerhafter Kompression seit 2024 oder häufig negativem Funding. Dann ist
  Rang 2 der nächste Schritt, mit derselben Disziplin: zuerst Vorregistrierung
  inklusive Universum ohne Überlebens-Verzerrung, dann der Datenabruf.
- **Der Betreiber schließt Derivate im Shadow grundsätzlich aus.** Dann direkt
  Rang 2.
- **Rang 3 nur, wenn die Grundsatzfrage R-005/R-020 ohnehin entschieden
  wird.** Unabhängig davon sollte der Widerspruch aus 5.2 dokumentiert werden,
  damit das Short-Paket nicht stillschweigend ins Leere läuft.

### Ausdrücklich nicht empfohlen

- Weitere Long-Familien unter R-020 auf BTC/ETH: Pullback-, Mean-Reversion-
  und Momentum-Varianten. Das Ergebnis ist strukturell vorhersehbar.
- Eine Lockerung von R-020 zugunsten von `NEUTRAL`, *als Forschungsrichtung*:
  Das ist mehr Beta, kein neuer Vorteil. Ob man mehr Beta will, ist eine
  Risiko-Entscheidung, wie die Positionsgröße auch.
- Ein Zurücksetzen oder Umgehen des Mehrfachtest-Zählers.

## 9. Was unverändert blieb und welche Daten dieser Bericht berührt hat

**Unverändert:**

- Code, Risk Engine, Limit-Set, Regime-Modelle, Strategien und Gates;
- Arena, Champion, Challenger, VPS und der offizielle Forward-Test.

**Kein Forschungszyklus, keine Konfiguration geprüft.** Es wurde keine
Strategie- oder Genom-Konfiguration bewertet. **N bleibt 53.**

| Zugriff | Zeitraum | Art | zählt für N |
|---|---|---|---|
| Snapshots BTC/ETH 1h/1d: Drift, Volatilität, Autokorrelation, Varianzverhältnis, Schock-Folgerenditen, BTC/ETH-Korrelation, implizite Positionsgröße je Regime | 2018-04-01 – 2023-12-31 (Entdeckung + Validierung, bereits gesehen) | beschreibend, ohne Regel | nein |
| FRED-Proxys S&P 500 / Nasdaq-100: wöchentliche Korrelation | 2018-04 – 2023-12 | beschreibend | nein |
| Dev-Datenbank (`Candle`, nur lesend): 9 Majors 1d | 2025-07-29 – 2026-10-14 (im Holdout-Zeitraum) | **nur Struktur** (Korrelation, Beta, Volatilität), **keine** mittleren Renditen | nein |
| Holdout-Renditen BTC/ETH | – | nicht berechnet | – |
| Forward ab 2026-10-15 | – | nicht berührt | – |

Die beschreibenden Werte aus Entdeckung + Validierung sind ab jetzt
zusätzlich „gesehen". Jede Idee, die sich auf sie stützt (z. B. `NEUTRAL`,
`MIXED`-Short, Momentum nach Anstiegen), hat keinen unberührten historischen
Prüfzeitraum mehr auf BTC/ETH.

Die Auswertungsskripte (Python, nur Standardbibliothek) liegen außerhalb des
Repos. Die Methode ist in Anhang A vollständig beschrieben.

## Anhang A: Beschreibende Tabellen (Entdeckung + Validierung, brutto)

**Regime-Nachbildung:**

- SMA50 und SMA200 der Tagesschlüsse; Momentum = 20-Tage-Rendite
  (> +1 % positiv, < −1 % negativ).
- `RISK_ON`: BTC über SMA200 und SMA50, BTC-Momentum nicht negativ, ETH über
  SMA50.
- `RISK_OFF`: BTC nicht über SMA200 und unter SMA50.
- `MIXED`: BTC und ETH auf verschiedenen Seiten der SMA50.
- sonst `NEUTRAL`.
- Abstände auf zwei Nachkommastellen gerundet wie im Code; das Label gilt für
  den Folgetag.

### A.1 `NEUTRAL`, `MIXED` und `RISK_OFF` nach Unterfall

| Unterfall | Tage | BTC Ø p. a. | BTC Sharpe | ETH Ø p. a. | ETH Sharpe |
|---|---:|---:|---:|---:|---:|
| `NEUTRAL` a: Aufwärtstrend, BTC-Momentum negativ | 82 | +55 % | +0,91 | +217 % | +2,40 |
| `NEUTRAL` b: Aufwärtstrend, beide unter SMA50 | 171 | +65 % | +1,23 | +101 % | +1,61 |
| `NEUTRAL` c: unter SMA200, beide über SMA50 | 228 | +63 % | +1,00 | +93 % | +1,10 |
| `MIXED`, BTC über SMA200 | 141 | −223 % | −2,98 | −225 % | −2,05 |
| `MIXED`, BTC unter SMA200 | 76 | −125 % | −2,45 | −321 % | −4,37 |
| `RISK_OFF`, Momentum negativ | 575 | −13 % | −0,16 | −57 % | −0,52 |
| `RISK_OFF`, Momentum nicht negativ | 198 | −6 % | −0,12 | +12 % | +0,14 |

### A.2 Σ Log-Rendite je Jahr und Regime (BTC / ETH, Tage)

| Jahr | `RISK_ON` | `NEUTRAL` | `MIXED` | `RISK_OFF` | alle |
|---|---:|---:|---:|---:|---:|
| 2018 (ab April) | – | −13 / +2 % (29) | −27 / −76 % (52) | −23 / −36 % (194) | −63 / −110 % |
| 2019 | +69 / +39 % (103) | +30 / +16 % (104) | −41 / −53 % (42) | +8 / −4 % (116) | +66 / −2 % |
| 2020 | +92 / +123 % (187) | +52 / +73 % (91) | +2 / −16 % (39) | −7 / −6 % (49) | +139 / +174 % |
| 2021 | +24 / +58 % (160) | +30 / +81 % (68) | −36 / +1 % (50) | +28 / +21 % (87) | +47 / +161 % |
| 2022 | – | −55 / −40 % (75) | −12 / −6 % (7) | −36 / −66 % (283) | −103 / −112 % |
| 2023 | +50 / +40 % (180) | +37 / +22 % (114) | +2 / −3 % (27) | +5 / +6 % (44) | +94 / +65 % |

Gate-Wechsel `RISK_ON` ↔ nicht `RISK_ON`: 86 in 5,75 Jahren (15 je Jahr).

### A.3 Kurzfristige Abhängigkeit (1h-Daten)

Autokorrelation (AC) nicht überlappender Renditen und Varianzverhältnis (VR;
1 = Zufallspfad, < 1 Umkehr, > 1 Fortsetzung):

| Regime | BTC AC 1h | BTC AC 24h | BTC VR 72h | ETH AC 1h | ETH AC 24h | ETH VR 72h |
|---|---:|---:|---:|---:|---:|---:|
| `RISK_ON` | −0,041 | −0,056 | 0,79 | −0,025 | −0,082 | 0,72 |
| `NEUTRAL` | +0,014 | +0,005 | 0,72 | +0,001 | −0,091 | 0,75 |
| `MIXED` | +0,018 | −0,035 | 0,93 | +0,030 | −0,011 | 1,02 |
| `RISK_OFF` | −0,031 | −0,169 | 0,86 | −0,014 | −0,150 | 0,89 |

Schock-Ereignisse (24h-Rendite jenseits ±2σ, 24 h Sperre), Folgerendite 72 h:

| Regime | Richtung | BTC n | BTC Ø 72h (t) | BTC positiv | ETH n | ETH Ø 72h (t) | ETH positiv |
|---|---|---:|---:|---:|---:|---:|---:|
| `RISK_ON` | Absturz | 32 | +1,57 % (+1,61) | 69 % | 38 | +1,79 % (+1,62) | 58 % |
| `RISK_ON` | Anstieg | 63 | +2,01 % (+2,62) | 63 % | 61 | +2,38 % (+2,19) | 56 % |
| `NEUTRAL` | Absturz | 27 | −1,08 % (−1,20) | 41 % | 27 | −0,39 % (−0,27) | 44 % |
| `NEUTRAL` | Anstieg | 29 | +2,56 % (+2,25) | 62 % | 38 | +0,34 % (+0,36) | 50 % |
| `MIXED` | Absturz | 21 | −1,79 % (−1,36) | 38 % | 22 | −3,62 % (−1,40) | 45 % |
| `MIXED` | Anstieg | 14 | −0,35 % (−0,40) | 64 % | 17 | +0,94 % (+0,63) | 53 % |
| `RISK_OFF` | Absturz | 57 | −1,40 % (−1,07) | 35 % | 69 | −2,01 % (−1,31) | 42 % |
| `RISK_OFF` | Anstieg | 46 | −0,78 % (−0,95) | 43 % | 55 | −1,16 % (−0,89) | 45 % |

Rund 40 Zellen, keine erreicht t ≥ 2,82. Alles hier sind Hypothesen.

### A.4 Implizite Positionsgröße bei 0,25 % Risiko und Stop 2 × ATR(14, 1d)

| Symbol | Regime | Median Stopabstand | Median Notional | P10–P90 |
|---|---|---:|---:|---:|
| BTC | `RISK_ON` | 9,0 % | 2,8 % | 1,8–4,2 % |
| BTC | `RISK_OFF` | 10,2 % | 2,4 % | 1,4–4,5 % |
| ETH | `RISK_ON` | 10,9 % | 2,3 % | 1,5–3,6 % |
| ETH | `RISK_OFF` | 14,7 % | 1,7 % | 1,1–3,4 % |

ATR hier als einfacher 14-Tage-Mittelwert der True Range. Die Engine kann
anders glätten; die Größenordnung bleibt.

### A.5 Wöchentliche Korrelation BTC/ETH mit Aktienindex-Proxys

| Jahr | BTC ~ S&P 500 | BTC ~ Nasdaq-100 | ETH ~ Nasdaq-100 |
|---|---:|---:|---:|
| 2018 | 0,14 | 0,14 | 0,14 |
| 2019 | −0,11 | −0,07 | −0,08 |
| 2020 | 0,27 | 0,25 | 0,38 |
| 2021 | 0,40 | 0,30 | 0,31 |
| 2022 | 0,46 | 0,42 | 0,50 |
| 2023 | 0,05 | 0,21 | 0,22 |
| gesamt | 0,24 | 0,25 | 0,30 |
