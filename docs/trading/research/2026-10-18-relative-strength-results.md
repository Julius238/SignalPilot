# Ergebnis der Machbarkeitsstudie Relative Stärke V1 (2026-10-18)

> **Ergebnisklasse: `NICHT_BESTANDEN`, Unterfall `NUR_BETA`, in beiden
> Ereignislesarten gleich.**
>
> - Keine der zwei Varianten zeigt einen eigenen, statistisch belastbaren
>   Auswahlvorteil gegenüber der gleich investierten Kontrolle. Seit 2024 ist
>   der Auswahlvorteil in beiden Varianten negativ.
> - Was an Rendite entstand, kam aus dem Marktengagement in `RISK_ON`, nicht
>   aus der Auswahl der stärkeren Coins.
> - Nach §10.4 ist die relative Stärke in dieser Form damit **geschlossen**.
> - Mehrfachtest-Zähler: **N = 55 → 57** (Schwelle 2,84).
> - Genau ein echter Lauf, nach der ausdrücklichen Freigabe des Betreibers vom
>   2026-10-18, unverändert nach der Vorregistrierung V1 und der Präzisierung
>   P7.
> - Keine Echtgeldorder, keine Strategieimplementierung, keine Änderung an
>   Risk Engine, Gates oder VPS, kein Merge nach main, keine neuen Marktdaten.

## Kurz und verständlich

- **Frage:** Bringt es nach allen Kosten etwas, in Aufwärtsphasen (`RISK_ON`)
  die 10 Coins mit der stärksten 28-Tage-Rendite aus einem breiten,
  liquiden Binance-Universum zu halten, statt einfach alle Coins des
  Universums gleich gewichtet?
- **Antwort: nein, nicht belegbar.**
  - Variante A (wöchentlich) lag über 6¾ Jahre 3,6 Prozentpunkte p. a. über
    ihrer Kontrolle. Das ist statistisch nicht von Zufall zu unterscheiden
    (t = 0,61, nötig 2,84) und hängt fast ganz an 2020/2021 und an einem
    einzigen Coin (SOL).
  - Variante B (alle 4 Wochen) lag 14,2 pp p. a. unter ihrer Kontrolle.
  - Seit 2024 verlieren beide gegen die Kontrolle.
- **Einordnung:** Alle Altcoin-Körbe, ob ausgewählt oder nicht, blieben weit
  hinter BTC/ETH mit demselben Regime-Filter: 47,2 % p. a. gegenüber
  9–30 % p. a., bei kleinerem Drawdown für BTC/ETH.
- **Konsequenz:** Für SignalPilot rechtfertigt das Ergebnis keine
  Entwicklung dieser Strategie.

## 1. Lauf und Nachvollziehbarkeit

| Punkt | Wert |
|---|---|
| Aufruf | `relative_strength_v1.py evaluate --real --confirm RELATIVE_STRENGTH_FEASIBILITY_V1 --data data/market-snapshots/relative-strength-v1 --out data/replay-research/relative-strength-v1/evaluation` |
| Zeit | 2026-10-18 07:59:24 – 08:00:14 UTC (50 s), Exit 0 |
| Vorab geprüft | Vorregistrierung Blob `965256641b15…` (Text `c188c38`), P7 aktiv (`7914de6`, `138720e`), Konfigurations-Hash `800da68d…`, Manifest 56 544 Dateien `297ab134…`, D0–D12 ohne Halt, N = 55 |
| Skript | `relative-strength-v1/1.0.0`, SHA-256 `525e025f…` (Commit `c44de25`) |
| Ergebnis | `results.json` SHA-256 `a714fdb4…`, `results.md` `b2f53edf…`; `RUN.lock` bleibt, ein zweiter Lauf wird abgelehnt |
| Konfiguration | eingefroren: 28-Tage-Rückschau, Top 10, Puffer 20, Universum Top 50 (U1–U4, X1–X5), nur `RISK_ON`, Kostenstufen L1/L2/L3 = 14/25/40 bp je Seite, 20 000 USDT je Platz, 1 000 Zufallsportfolios |

**Vorbelastung:**

- Die Zeiträume sind durch frühere Forschung teilweise bekannt: BTC/ETH
  vollständig, die Regime-Labels samt Zählung, die Champion/Challenger-
  Monatsrenditen und DTB3.
- Der Altcoin-Querschnitt ist durch öffentliches Vorwissen vorbelastet
  (§13).
- Ein positives Ergebnis wäre deshalb kein unabhängiger Forward-Nachweis
  gewesen. Für das negative Ergebnis spielt das keine Rolle.

## 2. Kriterien B1–B6

Lesart A (nur ausführbare Preise) und Lesart B (konservativ) ergeben dieselben
Werte.

| Kriterium | Variante A | Variante B |
|---|---|---|
| B1 Netto über Geldmarkt nach Abschlag (gesamt) | ✔ | ✔ |
| B2 dasselbe seit 2024 | ✘ | ✘ |
| B3 Auswahlvorteil gegen die eigene Kontrolle | ✘ (a ✘, b ✔, c ✘) | ✘ (a ✘, b ✘, c ✘) |
| B4 Drawdown und Calmar gegen die Kontrolle | ✔ | ✘ |
| B5 eigenes α gegen Champion/Challenger | ✘ | ✘ |
| B6 Robustheit (Jahre, ohne bestes Jahr, Stresstests) | ✘ (a ✘, b ✘, c ✔, d ✔, e ✔) | ✘ (alle ✘) |

- **Klasse:** Keine Variante erfüllt B3, eine Kontrolle erfüllt B1. Damit
  gilt `NICHT_BESTANDEN` mit Unterfall `NUR_BETA` (§10.2). „Der Ertrag kam aus
  dem Engagement, nicht aus der Auswahl.“
- **Sharpe-Definition:** Mit der Tages-Sharpe in B3(c) bliebe die Klasse
  gleich (`dependsOnSharpeDefinition: false`).

## 3. Auswahlvorteil gegen die Kontrolle (Kernfrage)

Die Kontrolle hält alle Mitglieder des Universums gleich gewichtet, mit
identischem Gate, Takt und Kosten. Investitionsquote in `RISK_ON` 99,7 % bzw.
99,5 %; der Unterschied zur Variante ist 0,25 pp, also fair.

| Größe (S1) | A | K_A | B | K_B |
|---|---|---|---|---|
| Netto p. a. | **30,3 %** | 26,7 % | **9,2 %** | 23,4 % |
| Variante − Kontrolle | **+3,6 pp** | | **−14,2 pp** | |
| Selektions-α je Monat (gegen die Kontrolle) | +0,55 % | | −0,65 % | |
| t-Wert (Newey-West, 81 Monate, 50 informativ) | **0,61** | | **−0,81** | |
| nötig | 2,84 | | 2,84 | |
| α 2020–2023 je Monat | +1,10 % | | −0,34 % | |
| α seit 2024 je Monat | **−0,56 %** | | **−1,19 %** | |
| β zur Kontrolle | 0,95 | | 0,87 | |
| β zu BTC | 0,49 | | 0,40 | |
| Positionen in `RISK_ON` | 10,0 | 43,1 | 10,0 | 42,8 |

**Auswahlvorteil je Kalenderjahr** (Jahresrendite der Variante minus
Kontrolle; Jahre mit mindestens 30 `RISK_ON`-Tagen; 2022 hatte keinen):

| Jahr | A − K_A | B − K_B |
|---|---|---|
| 2020 | +66,9 pp | −3,5 pp |
| 2021 | +37,9 pp | −55,3 pp |
| 2023 | −32,0 pp | −18,3 pp |
| 2024 | −9,0 pp | −24,5 pp |
| 2025 | +2,6 pp | −3,6 pp |
| 2026 (bis 09) | −9,6 pp | −6,5 pp |
| positive Jahre (nötig 4 von 6) | 3 | 0 |
| Summe ohne das beste Jahr | −10,0 pp | −108,2 pp |

**Weitere Belege, dass hier keine Auswahlfähigkeit steckt:**

- **Zufallsportfolios (je 1 000, 10 zufällige Coins aus demselben Universum,
  gleicher Takt):**
  - 8,6 % sind besser als A. Median 19,4 % p. a., 5 % der Portfolios
    erreichen 8,1 % p. a. oder weniger, 5 % 33,3 % oder mehr.
  - Für B sind 92,6 % besser.
  - A liegt also im 91. Perzentil. Das ist unter vielen getesteten Ideen
    nicht ungewöhnlich (N = 57).
- **Signalgüte:** Der mittlere Rang-IC des 28-Tage-Signals zur Rendite bis
  zum nächsten Termin ist negativ: A −0,039 (t −2,14, 179 Termine), B −0,047
  (t −1,88, 91 Termine). Im Mittel kehrten starke Coins eher um, als dass sie
  weiterliefen. Nicht signifikant bei 2,84, aber die Richtung spricht gegen
  Momentum.
- **Konzentration:**
  - Der beste Coin von A, SOL, brachte 33 500 der 99 254 USDT Gewinn.
  - Ohne ihn bleiben 65 700 USDT, weniger als der Gewinn der Kontrolle ohne
    ihren besten Coin (69 100 USDT).
  - Der Vorsprung von A ist im Kern ein einzelner Glückstreffer 2020/2021.

## 4. Rendite, Gewinn und Risiko (S1, 20 000 USDT je Platz)

S1 ist die Shadow-Buchführung: Kasse zu 0 %, Fenster 2020-01-01 bis
2026-09-30 (6,75 Jahre, 829 `RISK_ON`-Tage = 33,6 %).

| Reihe | Endkapital | Gewinn | Netto p. a. | max. Drawdown | Calmar |
|---|---|---|---|---|---|
| Variante A (wöchentlich) | 119 254 | **+99 254** | 30,3 % | 54,9 % | 0,55 |
| Kontrolle K_A | 98 877 | +78 877 | 26,7 % | 54,2 % | 0,49 |
| Variante B (4-wöchentlich) | 36 186 | **+16 186** | 9,2 % | 59,8 % | 0,15 |
| Kontrolle K_B | 82 595 | +62 595 | 23,4 % | 52,5 % | 0,45 |
| BTC/ETH 50/50 mit demselben Gate (R) | 271 161 | +251 161 | **47,2 %** | – | – |
| BTC/ETH Kaufen und Halten | 323 274 | +303 274 | 51,0 % | 77,8 % | 0,66 |
| Champion `CRYPTO_TREND_CORE_LONG_V1` (Platz 20 000, Bindung 0,9 %) | – | – | −0,5 % | 7,7 % (Monatsende) | – |
| Challenger `CRYPTO_REGIME_LONG_V1` (Bindung 2,1 %) | – | – | +2,7 % | 1,4 % (Monatsende) | – |
| Geldmarkt (DTB3) | – | – | Ø 2,85 % (seit 2024 4,29 %) | – | – |

**Lesehilfe:**

- **Kapitalbindung:**
  - Variante, Kontrolle und R sind nur in `RISK_ON` investiert, an gut einem
    Drittel der Tage (Quote über alle Tage 33,5 %, in `RISK_ON` 99,7 %).
  - Kaufen und Halten ist immer voll investiert.
  - Champion und Challenger binden im Mittel nur 0,9 % bzw. 2,1 % ihres
    Platzes. Ihre Renditen sind deshalb klein und mit den anderen nicht
    gleich riskant.
- **Gleiches Risiko (S2, Überschussrendite bei 10 % Volatilität):**
  A 7,9 %, K_A 7,3 %, B 4,5 %, K_B 6,7 %, R 11,7 %, Kaufen und Halten 8,7 %,
  Challenger 8,0 %, Champion −6,6 %.
- **Drawdown:** Variante und Kontrolle verlieren in der Spitze mehr als die
  Hälfte. Die längste Erholung dauerte in S2 bei A 935, bei B 1 017 und bei
  Kaufen und Halten 1 368 Tage.

**Handel und Kosten (S1):**

| Größe | A | K_A | B | K_B | R |
|---|---|---|---|---|---|
| Trades | 1 768 | 6 848 | 1 582 | 6 520 | 280 |
| Tage mit Umschichtung | 79 | 88 | 19 | 19 | 0 |
| ausgetauschter Anteil je Umschichtung | 20,5 % | 5,2 % | 42,1 % | 9,1 % | – |
| Umschlag p. a. | 12,9 × | 11,5 × | 12,0 × | 11,1 × | 10,5 × |
| Kosten gesamt (USDT) | 47 034 | 31 660 | 16 146 | 25 313 | 26 671 |
| davon Gebühr / Spread / Slippage | 18 957 / 9 177 / 18 900 | | 6 501 / 3 151 / 6 494 | | |
| davon Gate-Wechsel / Umschichtung / Ereignisse | 36 094 / 10 466 / 474 | | 14 088 / 1 894 / 164 | | |
| Anteil am Bruttogewinn | 32 % | 29 % | **50 %** | 29 % | 10 % |
| Kosten je Seite | 24,8 bp | 26,2 bp | 24,8 bp | 26,0 bp | 14,0 bp |

- Der größte Kostenblock ist das Ein- und Aussteigen am Gate, nicht die
  Umschichtung.
- Bei B frisst der Handel die Hälfte des Bruttogewinns.

## 5. Seit 2024

- **Kriterium:** B2 ist in beiden Varianten verfehlt. Netto nach Abschlag
  lagen beide seit 2024 nicht über dem Geldmarkt.
- **Selektions-α seit 2024:** negativ, A −0,56 %, B −1,19 % je Monat.
- **Netto p. a. seit 2024 (nur in S2 ausgewiesen, mit Zins auf freie
  Kasse):**

  | Reihe | Netto p. a. |
  |---|---|
  | A | −3,1 % |
  | B | −10,8 % |
  | K_A | +1,2 % |
  | K_B | +2,0 % |
  | R | +35,9 % |
  | Kaufen und Halten | +12,3 % |
  | Geldmarkt | 4,29 % |

- **Auswahl je Jahr:** 2024 und 2026 negativ, 2025 knapp positiv nur bei A
  (+2,6 pp).

**Ein Vorteil ist seit 2024 nicht mehr vorhanden.**

## 6. Statistik: α, β, Korrelation

| Größe | A | B |
|---|---|---|
| eigenes α gegen Champion und Challenger, je Monat | −0,19 % (t −0,12) | −1,38 % (t −0,93) |
| α 2020–2023 / seit 2024, je Monat | +1,67 % / −2,56 % | +0,05 % / −3,22 % |
| Korrelation Auswahlrendite zu Challenger (Pearson) | −0,09 | −0,31 |
| Korrelation Rohrendite zu Challenger (Pearson / Spearman) | 0,57 / 0,54 | 0,53 / 0,61 |
| Korrelation Rohrendite zu Champion (Pearson) | 0,14 | 0,10 |
| schlechtester Monat / schlechteste Woche der Auswahl | −39,2 % / −23,9 % | −37,8 % / −23,8 % |

Die Rohrenditen gehen weitgehend mit dem Challenger, der dasselbe Regime
nutzt. Die Auswahl selbst bringt gegenüber Champion und Challenger nichts
Eigenes.

## 7. Stresstests (S1, Netto p. a. Variante gegen Kontrolle)

| Stresstest | A | K_A | B | K_B |
|---|---|---|---|---|
| Kosten × 2 | 21,8 % | 19,3 % | 2,8 % | 16,5 % |
| Delisting-Stress | 26,2 % | 22,8 % | 5,8 % | 20,1 % |
| Signal einen Tag später | 18,4 % | 13,6 % | −0,4 % | 10,1 % |
| M28: Kontrolle mit günstigen Ereignissen | 30,3 % | 26,7 % | 9,2 % | 23,3 % |
| M29: Abschlag auf E3-Ausstiege | 30,3 % | 26,7 % | 9,2 % | 23,4 % |

- A bleibt in jedem Stresstest über ihrer Kontrolle; der Vorsprung bleibt
  aber klein und unbelegt (Abschnitt 3).
- B fällt unter Stress auf etwa null.
- M29 ändert nichts, weil keine Reihe eine Position über eine lange Lücke
  hielt.

## 8. Ereignislesarten A und B, LUNA

- **Gleiches Ergebnis:** Beide Lesarten ergeben auf die Nachkommastelle
  dieselben Renditen (A 30,29 %, B 9,18 % p. a.) und dieselbe Klasse. Die
  Bestimmbarkeitsregel greift nicht („beide Lesarten gleich“).
- **Die drei ungeklärten LUNA-Fälle wirken nicht:**
  - Keine Reihe hielt das alte LUNA an seinem Datenende (0 eingefrorene
    E7-Positionen in allen Reihen).
  - Je Reihe ist ein gehaltenes Instrument mit ungeklärtem Kurssturz
    darunter, das ist LUNA im Mai 2022. Abwärts-Sprünge bleiben nach §4.3 in
    beiden Lesarten echt; einen Vorteil für die Strategie gibt es dabei
    nicht.
- **Belegte Ereignisse in den gehaltenen Beständen:**
  - NPXS-Migration 2021 (A, B und beide Kontrollen): Die Position endete
    über den Nachfolger, mit Ereignis E6 am 2021-04-09, dem ersten Handelstag
    von PUNDIX.
  - LEND-Migration 2020 (beide Kontrollen): ebenso, über AAVE am 2020-10-15.
  - Abgerechnet wurde nach der vorregistrierten Regel E6. Die Einzeltrades
    stehen nicht im gespeicherten Ergebnis.
- **Käufe am letzten Handelstag:** je ein Kauf bei A (12 087 USDT) und B
  (6 115 USDT), 4 bzw. 2 bei den Kontrollen. Bei dieser Größenordnung haben
  sie keine Wirkung auf das Urteil.

## 9. Kapital-Szenarien S1 und S2

| Reihe | S1 Netto p. a. (Kasse 0 %) | S2 Netto p. a. (Kasse zu DTB3) | S2 Sharpe (Monat) | S2 max. DD |
|---|---|---|---|---|
| A | 30,3 % | 37,9 % | 0,85 | 45,7 % |
| K_A | 26,7 % | 31,0 % | 0,79 | 46,5 % |
| B | 9,2 % | 15,3 % | 0,51 | 55,2 % |
| K_B | 23,4 % | 27,8 % | 0,73 | 46,1 % |
| R | 47,2 % | 50,5 % | 1,25 | 30,3 % |

- **Wirkung von S2:**
  - Der Zins auf die freie Kasse und der Transfertag beim Aufbau ändern den
    Pfad. S2 liegt deshalb mehr als nur um den Zins über S1.
  - Die Rangfolge ändert sich nicht.
  - Das Urteil hängt nur an S1; S2 ist Bericht.
- **Nicht gespeichert:** Die S1-Sharpe und die Kalenderjahresrenditen der
  Varianten selbst schreibt das Skript nicht in `results.json` (Abschnitt 11).
  Die Sharpe-Werte oben sind daher aus S2.

## 10. Welche Variante ist besser, und warum

- **A ist klar besser als B:**
  - +21,1 pp p. a.;
  - kleinerer Drawdown;
  - Calmar 0,55 statt 0,15;
  - in jedem Stresstest vor B.
- **Warum B schlechter ist:**
  - Die Information des 28-Tage-Signals hält nicht vier Wochen. Der mittlere
    IC ist schon zum nächsten Termin leicht negativ.
  - Wer nur alle vier Wochen umschichtet, hält Gewinner in die Umkehr
    hinein. B verliert in jedem Jahr gegen die Kontrolle.
  - Die Kosten sind bei B relativ zum Bruttogewinn doppelt so schwer.
- **Auswahlregel:** Nach der vorregistrierten Regel (B, außer A ist ≥ 1 pp
  besser und nicht riskanter) wäre A die maßgebliche Variante gewesen. Da
  keine besteht, hat das keine Folge.

## 11. Grenzen und offener technischer Punkt

- **Fehlende S1-Kennzahlen:**
  - Die Kennzahlen der Varianten, Kontrollen und der Referenz in S1 werden
    im Ergebnis nicht vollständig gespeichert. Das Skript entfernt den Block
    `metrics` aus den Kriterien.
  - Rekonstruierbar sind daraus exakt: Netto p. a. (Calmar × Drawdown),
    Gewinn, Drawdown, Calmar, Auswahl je Jahr, Stresstests.
  - Nicht verfügbar sind: S1-Sharpe, Kalenderjahresrenditen der Varianten
    selbst (Kaufen und Halten: 2020 +385 %, 2021 +259 %, 2022 −67 %, 2023
    +104 %, 2024 +65 %, 2025 −9 %, 2026 −8 %), Netto p. a. seit 2024 in S1.
  - Klasse und Kriterien sind davon nicht berührt. Sie wurden im Lauf aus
    den vollständigen Kennzahlen berechnet.
  - Nachholen ließe sich das nur mit dem einen zulässigen Korrekturlauf
    (`--correction`, §10.4), nach einer Skriptänderung, die den Block
    speichert. Der Lauf ist deterministisch, die Klasse bliebe gleich. **Das
    ist nicht geschehen und braucht die Entscheidung des Betreibers.**
- **Aussagekraft:**
  - Nur gut 2¼ Jahre sind informativ (`RISK_ON`).
  - Ein mäßiger echter Vorteil wäre deshalb schwer nachzuweisen (§2.3:
    „nicht belegt“ heißt nicht „wertlos“).
  - Hier zeigt aber nicht einmal die Richtung seit 2024 einen Vorteil, und
    der IC ist negativ.
- **Vorbelastung:** wie in Abschnitt 1.

## 12. Wirtschaftliche Einschätzung

1. **Hat die Auswahl stärkerer Coins einen eigenen messbaren Vorteil
   gegenüber einer fairen Kontrolle?**
   - Nein.
   - A schlägt die Kontrolle um 3,6 pp p. a., aber nicht unterscheidbar von
     Zufall (t 0,61), getragen von 2020/2021 und SOL.
   - B verliert 14,2 pp p. a.
   - Zufallsportfolios schlagen A in 8,6 % der Fälle; der Rang-IC ist
     negativ.
2. **Wie hoch ist der Vorteil nach Kosten?**
   - Bestenfalls etwa +20 000 USDT über 6¾ Jahre auf 20 000 USDT bei A
     (99 254 gegen 78 877 USDT). Nach Bereinigung um den einen besten Coin
     ist er weg.
   - Bei B ist er mit −46 400 USDT deutlich negativ.
3. **Ist er seit 2024 noch vorhanden?**
   - Nein. Selektions-α seit 2024 negativ; A verliert seit 2024 auch
     absolut (S2 −3,1 % p. a.).
4. **Welche Variante ist besser?**
   - A (wöchentlich), weil das Signal schnell verfällt und B Gewinner in die
     Umkehr hält.
   - Bestanden hat aber auch A nicht.
5. **Rechtfertigen die Ergebnisse eine Entwicklung für SignalPilot?**
   - Nein. Nach §10.4 ist die Familie geschlossen: kein zweiter Versuch auf
     derselben Historie, also keine andere Rückschau, Positionszahl,
     Taktung, kein anderes Universum und kein anderes Gate.
   - Eine neue Prüfung wäre frühestens 12 Monate nach 2026-10-15 auf
     Forward-Daten und mit neuer Vorregistrierung zulässig.
   - **Nebenbefund, ausdrücklich keine Handlungsempfehlung:**
     - In denselben `RISK_ON`-Phasen lag ein gleich gewichteter Altcoin-Korb
       rund 20 pp p. a. unter BTC/ETH, bei größerem Drawdown.
     - Für SignalPilot spricht das eher gegen breite Altcoin-Engagements als
       für sie.
     - Diese Zeiträume sind aber verbraucht; eine Aussage darüber wäre nur
       forward belastbar.
   - Die marktneutrale Querschnittsfrage bleibt unberührt (§1).

## 13. Was unverändert blieb

- Vorregistrierung V1, P7, B1–B6 und alle Schwellen;
- Parameter, Datenfilter, Handelsregeln: nach Kenntnis der Renditen nichts
  geändert;
- Risk Engine, Strategien, Gates, Arena;
- VPS, offizieller Forward-Test `OFFICIAL_V1`;
- main;
- keine Order, kein Echtgeld, keine neuen Marktdaten, keine weiteren
  Varianten oder Läufe.
