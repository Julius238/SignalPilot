# Ergebnis der Machbarkeitsstudie Funding-/Basis-Carry V2 (2026-10-17)

> **Ergebnisklasse: `KOMPRIMIERT` (§8.2).** Beide Varianten erfüllen B1 und
> B3–B6. Beide scheitern an **B2 „Wirtschaftlichkeit seit 2024“**.
>
> - Den Carry gab es historisch, und er war vom Bestand unabhängig.
> - Seit 2024 liegt sein Ertrag aber unter dem Geldmarktzins, schon vor dem
>   Abschlag für die Börsenrisiken.
> - Nach §8.4 ist der Carry in dieser Form damit **geschlossen**. Eine neue
>   Prüfung ist frühestens nach 12 Monaten Forward-Daten ab 2026-10-15
>   zulässig, mit neuer Vorregistrierung.
> - Ausgewertet wurde **ein einziger Lauf**, ohne Korrekturlauf.
> - Mehrfachtest-Zähler jetzt **N = 55**.
> - Keine Handelsempfehlung, keine Anlage-, Rechts- oder Steuerberatung. Ein
>   historisches Ergebnis ist kein Nachweis künftiger Erträge.

- Vorregistrierung:
  [V2](2026-10-17-funding-carry-feasibility-preregistration-v2.md), eingefroren
  in `2f75ef0`. Sie übernimmt
  [V1](2026-10-16-funding-carry-feasibility-preregistration.md) (`248b739`)
  mit allen Kosten, Regeln und Schwellen.
- Datenprüfung: [V2](2026-10-17-funding-carry-v2-data-check.md), alle
  Pflichtprüfungen bestanden.
- Freigabe der Auswertung (Schritte 1.4/1.5): Betreiber am 2026-10-17.

## Kurz und verständlich

1. **2020–2023 war der Carry attraktiv.**
   - Variante A („immer halten“) brachte **8,5 % p. a. auf das gesamte
     eingesetzte Kapital**, also Spot-Bein plus volle Deckung des Short-Beins.
   - Der größte Rückgang lag bei 0,7 %, der schlechteste Monat bei −0,3 %.
   - Der Ertrag war eigenständig: α-t 4,2, Korrelation mit dem Challenger
     nur 0,28.
2. **Seit 2024 ist er stark geschrumpft.**
   - A brachte 3,4 % p. a.: 2024 +6,2 %, 2025 +2,4 %, 2026 bis September
     +0,7 %, die letzten 12 Monate +1,2 %.
   - Der 3-Monats-T-Bill brachte im selben Zeitraum im Mittel **4,3 %**.
   - Nach dem vorab festgelegten Abschlag von 1,5 pp für Börsen- und
     Gegenparteirisiko bleibt ein **Minus von 2,4 pp gegenüber dem
     Geldmarkt**.
   - Das Funding selbst ist gefallen: 2026 im Mittel 2–3 % p. a. auf das
     Notional, mit einem Viertel bis einem Drittel negativer Abrechnungen.
3. **Gegenüber Champion und Challenger** sieht der Carry gut aus, aber der
   Vergleich täuscht.
   - Über alle 81 Monate auf je 20 000 USDT: Carry A **+10 380 USDT**,
     Challenger +3 906 USDT, Champion −710 USDT.
   - Der Carry bindet jedoch das **ganze** Kapital. Der Challenger bindet im
     Mittel 2 %; der Rest liegt im Shadow als Kasse zu 0 %.
   - Der faire Maßstab für den Carry ist deshalb der Geldmarkt, und gegen
     den verliert er seit 2024.
4. **Variante B** (nur bei positivem 7-Tage-Funding) ist in allen Punkten
   schlechter als A. Der Filter kostet mehr Handelskosten, als er an
   negativem Funding erspart.
5. **Urteil:** Funding-Carry zeigt **keinen belastbaren zusätzlichen
   Ertragsvorteil unter heutigen Bedingungen**. Die teure Weiterentwicklung
   lohnt sich derzeit nicht. Sie bräuchte:
   - Perpetuals im Shadow;
   - ein abgesichertes Paar als neue Positionsart;
   - einen eigenen Risk-Regelsatz und Gates v5;
   - einen für ein deutsches Konto erreichbaren Handelsplatz.

## 1. Lauf und Nachvollziehbarkeit

| | Wert |
|---|---|
| Skript | `scripts/research/funding-carry-v2/funding_carry_v2.py`, `funding-carry-v2/2.0.0`, SHA-256 `823a1b8feeb9cc8ca620d9065a4f8dd4f2bc2331b13b78d4e05a0bba91f8e06e`, seit `e739bca` unverändert |
| Vorregistrierung | V2 `2f75ef0`, Blob `0bc948df…` (seit Freigabe nur Statusblock); V1 `248b739`, Blob `9b00cc92…` (unverändert) |
| Daten | `data/market-snapshots/carry-v2/`, Manifest `20011e4f…`, Daten-Fingerprint `0d83e384…` (identisch mit der Datenprüfung); Spot-Snapshot `data/market-snapshots/real/` |
| Benchmarks (Schritt 1.4) | `exportCarryBenchmarks.ts` auf Code `3160d13`, Spot-Datenstand `5c7459f3…` (derselbe wie in der Evolution) |
| | Vergleich A Entdeckung + Validierung: Output-Hash `39095a44…`, Champion 138 und Challenger 122 Trades. Gegenprobe: genau die Werte des [Validierungsprotokolls](2026-10-16-portfolio-replay-validation-and-gates-v4-counterprobe.md) |
| | Holdout: Output-Hash `2a8b05fb…`, 85 bzw. 80 Trades |
| Auswertung | genau ein Lauf am 2026-10-17, `--venue-status OFFEN`, Ergebnis in `data/replay-research/carry-v2/evaluation/` (gitignoriert); die Sperre gegen einen zweiten Lauf ist gesetzt. Kein Korrekturlauf: kein Implementierungsfehler gefunden |
| Fenster | 2020-01-01 – 2026-09-30, Teilstart 2020-01-08 (§2.1, erste Woche Kasse) |
| Mehrfachtest-Zähler | 53 → **55** (V2 §4, beide Varianten einmal) |

Der Zähler der Evolution Engine wird aus den 30 Vorforschungs-Konfigurationen
und ihrer Datenbank gebildet. Die zwei Carry-Varianten kennt er nicht. Sie
sind hier festgehalten und müssen in der nächsten Evolution-Vorregistrierung
ausdrücklich mitgezählt werden. Gates und Split wurden dafür nicht geändert.

## 2. Kriterien B1–B6

| Nr. | Kriterium | Schwelle | A `CARRY_ALWAYS` | B `CARRY_FUNDING_7D_POSITIVE` |
|---|---|---|---|---|
| B1 | Netto − 1,5 pp − Ø T-Bill, gesamt | > 0 | 6,39 − 1,50 − 2,85 = **+2,04 pp** ✔ | 5,52 − 1,50 − 2,85 = **+1,17 pp** ✔ |
| B2 | dasselbe seit 2024 | > 0 | 3,38 − 1,50 − 4,29 = **−2,41 pp** ✘ | 2,63 − 1,50 − 4,29 = **−3,16 pp** ✘ |
| B3 | positive Kalenderjahre / negative Monate | ≥ 5 von 7 / ≤ 30 % | 7 von 7 / 8,6 % ✔ | 5 von 7 / 22,2 % ✔ |
| B4 | max. Drawdown / schlechtester Monat / Liquidationen | ≤ 10 % / ≥ −3 % / 0 | 0,68 % / −0,33 % / 0 ✔ | 1,17 % / −0,40 % / 0 ✔ |
| B5 | α-t gegen Champion + Challenger | ≥ 2,83 | 4,22 ✔ | 3,21 ✔ |
| | α̂ > 0 in 2020–2023 und seit 2024 | beide > 0 | +0,51 % / +0,24 % je Monat ✔ | +0,43 % / +0,17 % je Monat ✔ |
| | Korrelation mit dem Challenger | ≤ 0,5 | 0,28 ✔ | 0,28 ✔ |
| B6 | Netto bei Kosten ×2 / unter Legging-Stress L1 | > 0 | 6,07 % / 4,21 % ✔ | 4,24 % / 0,95 % ✔ |
| | BTC- und ETH-Teil einzeln positiv | > 0 | 14 788 / 15 593 USDT ✔ | 13 838 / 14 904 USDT ✔ |

Alles außer B2 ist erfüllt, also `KOMPRIMIERT` (§8.2). Diese Klasse ist
unabhängig von Phase 1B endgültig. Die Auswahlregel aus §8.3 kommt nicht zur
Anwendung.

## 3. Rendite auf das gesamte gebundene Kapital

Platz 20 000 USDT, je Asset 10 000. Das Spot-Bein ist voll bezahlt, das
Short-Bein 1:1 gedeckt. Die Rendite bezieht sich auf **das ganze Kapital**,
nicht auf die Futures-Margin.

| | A `CARRY_ALWAYS` | B `CARRY_FUNDING_7D_POSITIVE` |
|---|---:|---:|
| Endwert (Liquidationswert inkl. Ausstiegskosten) | 30 380,39 USDT | 28 742,26 USDT |
| Gewinn | **+10 380,39 USDT** (+51,9 %) | **+8 742,26 USDT** (+43,7 %) |
| Netto p. a. gesamt | **6,39 %** | 5,52 % |
| Netto p. a. 2020–2023 | 8,51 % | 7,56 % |
| Netto p. a. seit 2024 | **3,38 %** | 2,63 % |
| letzte 12 Monate (2025-10 – 2026-09) | +1,24 % | +0,03 % |
| Funding erhalten (netto, inkl. negativer Zahlungen) | +11 063,32 USDT | +11 015,24 USDT |
| Ausführungskosten (Gebühren, Spread, Slippage, beide Beine) | −532,01 USDT | −2 146,75 USDT |
| Basis- und Bewertungsergebnis | −150,92 USDT | −126,23 USDT |
| Seit 2024: Funding / Kosten / Basis | +2 845 / −194 / +2 USDT | +2 777 / −806 / +6 USDT |
| Kapitalbindung | 100 % | 90 % |
| Perp-Maker statt Taker (nur Bericht) | 6,49 % p. a. | 5,91 % p. a. |

**Gesamt-Sharpe:** A 8,59 täglich bzw. 2,34 auf Monatsbasis; B 7,10 bzw.
1,95. Der Tageswert ist durch die gleichmäßige Funding-Gutschrift überhöht;
aussagekräftiger ist der Monatswert (Abschnitt 8).

## 4. Kalenderjahre

| Jahr | A Rendite | A Funding | A Kosten | A Basis | A max. DD | B Rendite | B Kosten |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2020 | +11,2 % | 2 427 | 109 | −77 | 0,68 % | +10,7 % | 238 |
| 2021 | +18,7 % | 4 321 | 117 | −52 | 0,21 % | +17,4 % | 370 |
| 2022 | +0,9 % | 343 | 84 | −10 | 0,43 % | **−0,6 %** | 592 |
| 2023 | +4,1 % | 1 127 | 28 | −13 | 0,03 % | +3,6 % | 142 |
| 2024 | +6,2 % | 1 800 | 81 | −1 | 0,07 % | +6,1 % | 143 |
| 2025 | +2,4 % | 762 | 48 | +2 | 0,05 % | +1,6 % | 244 |
| 2026 (bis Sept.) | +0,7 % | 283 | 65 | 0 | 0,30 % | **−0,4 %** | 419 |

Beträge in USDT auf das jeweilige Eigenkapital. Die Kosten 2026 enthalten die
Glattstellung am Fensterende.

**Mittleres Funding, annualisiert auf das Notional** (Mittel aus Tagessummen;
der Median steht in Klammern):

| Jahr | BTCUSDT | ETHUSDT | Anteil negativer Abrechnungen BTC / ETH |
|---|---:|---:|---:|
| 2020 | 17,2 % (11,0 %) | 27,4 % (11,0 %) | 14 % / 3 % |
| 2021 | 30,6 % (12,0 %) | 37,5 % (15,7 %) | 7 % / 4 % |
| 2022 | 4,2 % (5,0 %) | 0,8 % (3,6 %) | 22 % / 34 % |
| 2023 | 7,9 % (8,1 %) | 8,3 % (7,8 %) | 10 % / 9 % |
| 2024 | 11,9 % (11,0 %) | 13,0 % (11,0 %) | 8 % / 4 % |
| 2025 | 5,1 % (5,0 %) | 4,9 % (5,0 %) | 13 % / 16 % |
| 2026 | 2,9 % (3,7 %) | 1,9 % (2,8 %) | 26 % / 30 % |

- Der Grundwert der Binance-Formel, 0,01 % je 8 h oder 11,0 % p. a., war 2020
  und 2024 der Median.
- 2025 und 2026 lag der Median deutlich darunter. Das passt zur Kompression,
  die die Analyse als Risiko genannt hatte. Die Ursache wurde nicht
  untersucht.

## 5. Marktphasen

**Funding nach Regime** (`crypto-native-regime-v1`, annualisiert auf das
Notional, nur Bericht):

| Regime | Tage | BTCUSDT | ETHUSDT |
|---|---:|---:|---:|
| `RISK_ON` | 829 | 23,5 % | 28,9 % |
| `NEUTRAL` | 633 | 8,1 % | 9,2 % |
| `MIXED` | 275 | 9,5 % | 10,3 % |
| `RISK_OFF` | 728 | 2,4 % | 2,0 % |

- Das Funding ist **prozyklisch**: Am höchsten ist es genau dann, wenn auch
  der Challenger investiert ist (`RISK_ON`).
- Das erklärt die positive, aber mäßige Korrelation von 0,28 und das kleine
  BTC-Beta der Carry-Monatsrenditen (0,014, t 2,4).
- In Bärenphasen (`RISK_OFF`) verdient der Carry fast nichts, verliert aber
  auch kaum. Rendite und Drawdown 2022 belegen das: +0,9 % bei 0,43 % maximalem
  Rückgang.
- **Rollierende 12-Monats-Rendite von A:**
  - Spitze +22,0 % (2021);
  - niedrigster Wert +0,9 %;
  - zuletzt +1,2 % (2026-09).

## 6. Verhalten bei negativem Funding

- **Negative Funding-Monate** (Summe der Abrechnungen < 0): je Symbol 6 von
  81 Monaten (7,4 %).
  - BTC: 2020-03, 2021-07, 2022-11, 2026-02 bis 2026-04.
  - ETH: 2022-06, 2022-09, 2022-11, 2026-02 bis 2026-04.
- **Längste Phase ohne positives 7-Tage-Funding:**
  - ETH 2022: 35 Tage;
  - ETH 2026: 42 Tage;
  - BTC 2026: 30 Tage.
- **Schlechteste 30-Tage-Summe:** −1,8 % auf das Notional (ETH 2022), −1,3 %
  (BTC 2020).
- **Variante A** trägt negatives Funding einfach mit.
  - Sie hat 7 negative Monate, keiner schlechter als −0,33 % (2020-03).
  - 2022 blieb A mit +0,9 % positiv.
- **Variante B** steigt bei S₇ ≤ 0 aus.
  - Das ergab 31 Einstiege bei BTC und 27 bei ETH.
  - Die Kosten erreichten 21 % bzw. 18 % des Funding-Bruttoertrags.
  - Weil negative Phasen kurz waren und oft schnell kippten, zahlte B jeden
    Wechsel mit rund 0,46 % des Notionals.
  - Ergebnis: mehr negative Monate (18 statt 7) und Verluste in 2022 und
    2026.
  - **Der Filter schadet.**

## 7. Risiken: Margin, Liquidation, Basis, Ausführung

| | A | B |
|---|---:|---:|
| max. Drawdown auf Tageswerten / Stundenwerten | 0,68 % / 1,15 % | 1,17 % / 1,65 % |
| schlechtester Monat | −0,33 % | −0,40 % |
| Rebalancings BTC / ETH (±20-%-Band) | 55 / 98 | 50 / 88 |
| höchste Hebelung des Short-Beins BTC / ETH (Mark-Hoch je Stunde) | 1,75 / **2,50** | 1,63 / 2,50 |
| kleinster Abstand zur Binance-Liquidation BTC / ETH | 56 % / 39 % | 60 % / 39 % |
| kleinster Abstand zum EU-CFD-Close-out (2:1) BTC / ETH | 26 % / **12 %** | 29 % / 12 % |
| Liquidationen | 0 | 0 |

- **Die Spitzen stammen vom 13.03.2020.** Beim Rückprall nach dem
  Corona-Crash stieg der Markpreis innerhalb einer Stunde um 23–27 % über den
  Vorstundenschluss (BTC 02:00 UTC; ETH 02:00 und 03:00 UTC). Mark, Index und
  Spot stimmen überein; es ist kein Datenfehler.
- Das ±20-%-Band schützt nur zum Stundenschluss. Ein Ausschlag innerhalb der
  Stunde trieb die ETH-Hebelung auf 2,5.
- Unter EU-Privatkundenregeln (Close-out bei 50 % der Anfangsmarge) hätte
  noch ein weiterer Anstieg um 12 % gereicht, um das Short-Bein zwangsweise
  zu schließen.
- **Ein-Bein-Szenario L24 (M18):** größte 24-h-Bewegung BTC +46 %, ETH +48 %,
  ab 2020-03-12. Fehlt ein Bein 24 h lang, verliert der Teil damit 23 % bzw.
  24 % seines Kapitals. Das entspricht rund sieben Jahren Carry-Ertrag beim
  Niveau seit 2024 (3,4 % p. a.).
- **Legging-Stress L1:**
  - Folgt das zweite Bein eine Stunde später, sinkt A auf 4,21 % p. a. und B
    auf 0,95 % p. a.
  - Der größte Einzelverlust lag bei 208 USDT.
  - B ist wegen seiner vielen Wechsel besonders empfindlich.
- **Basis** (Perp ÷ Spot − 1, Stundenschlüsse):
  - Median −0,04 %, 1–99 %-Spanne −0,08 % bis +0,17 % (BTC);
  - Extremwerte −2,6 % und +2,1 % (BTC; größte Monatsspanne im März 2020);
  - Beitrag zum Ergebnis −151 USDT (A) über das gesamte Fenster, also klein.
- **Kostenstress ×2:** A 6,07 % p. a., B 4,24 % p. a. Die Kosten sind für A
  unkritisch, für B nicht.
- **Nicht modelliert und nur als Abschlag erfasst:**
  - Ausfall oder Insolvenz der Börse;
  - Auto-Deleveraging;
  - Abweichung von USDT;
  - regulatorische Zwangsschließung;
  - EUR/USD-Risiko für einen deutschen Anleger;
  - Steuern.

## 8. Vergleich mit Champion und Challenger

Je 20 000 USDT, Monatsrenditen aus dem unveränderten Vergleich A, 81 Monate.

| | Champion `CRYPTO_TREND_CORE_LONG_V1` | Challenger `CRYPTO_REGIME_LONG_V1` | Carry A | Carry B |
|---|---:|---:|---:|---:|
| Gewinn in USDT | −710 | +3 906 | **+10 380** | +8 742 |
| Netto p. a. gesamt | −0,53 % | +2,68 % | **+6,39 %** | +5,52 % |
| Netto p. a. 2020–2023 / seit 2024 | −1,18 % / +0,42 % | +2,77 % / +2,54 % | +8,51 % / +3,38 % | +7,56 % / +2,63 % |
| Sharpe (Monatsbasis) | −0,25 | 1,18 | 2,34 | 1,95 |
| max. Drawdown | 7,66 % (Monatsende) | 1,37 % (Monatsende) | 0,68 % (Tag) | 1,17 % (Tag) |
| schlechtester Monat | −1,66 % | −0,61 % | −0,33 % | −0,40 % |
| Ø Kapitalbindung | 0,9 % | 2,1 % | 100 % | 90 % |
| Netto ÷ Kapitalbindung | – | 126 % | 6,4 % | 6,1 % |
| Netto ÷ max. Drawdown | −0,07 | 1,96 | 9,44 | 4,73 |
| Korrelation mit dem Challenger | 0,41 | – | 0,28 | 0,28 |
| BTC-Beta (Monatsrenditen) | 0,007 | 0,020 | 0,014 | 0,015 |

- **Einordnung:** Der Carry ist auf Platzebene ertragreicher und ruhiger als
  beide Bestandsstrategien. Sein Ertrag ist eigenständig (B5).
- Der Grund ist aber vor allem die Kapitalnutzung. Der Challenger braucht im
  Mittel nur 2 % seines Platzes und verdient darauf sehr effizient. Der
  übrige Platz liegt im Shadow als Kasse zu 0 %.
- Der Carry füllt diese Kasse. Dieselbe Kasse brachte im Geldmarkt seit 2024
  aber im Mittel 4,3 % p. a., mehr als der Carry.
- **Gesamtportfolio (nur Bericht, nie entscheidend):**
  - Champion + Challenger + Kasse (60 000 USDT): +0,77 % p. a.
  - Mit Carry A auf dem Reserveplatz: +3,07 % p. a.
  - Sharpe 0,63 → 2,00; Drawdown 0,98 % → 0,32 % (Monatsende).
  - Auch das rechnet die Kasse mit 0 %, nicht mit dem Geldmarktzins.

## 9. Statistische Aussagekraft und Grenzen

- **Signifikanz:** Der eigene Ertrag ist über 81 Monate klar von null
  verschieden: α-t 4,22 bei Schwelle 2,83, Newey-West mit Lag 3. Er ist auch
  in beiden Teilzeiträumen positiv.
  - Die Frage der Studie war aber nicht „größer als null“, sondern „größer
    als Geldmarkt plus Risikoabschlag“.
  - Diese Hürde nimmt der Carry nur dank 2020–2021.
- **Trend statt Zufall:** Der Ertrag fällt nahezu stetig, von 18,7 % (2021)
  über 6,2 % (2024) und 2,4 % (2025) auf 0,7 % (2026 bis September). Eine
  einzelne gute Phase sagt deshalb wenig über heute.
- **Sharpe:** Der Tageswert von 8,6 ist durch die gleichmäßige Gutschrift und
  die Autokorrelation überhöht. Der Monatswert von 2,3 ist realistischer, aber
  ebenfalls von den ruhigen Jahren getragen.
- **Datenbasis:**
  - Eine Börse (Binance), deren Derivate für ein deutsches Konto nicht
    erreichbar sind.
  - Zwei Assets mit stark gekoppeltem Funding.
  - 6¾ Jahre mit nur einer echten Bärenphase (2022).
  - 29 Tage Mark- und Indexpreise kommen aus dem Tagesarchiv (V2).
- **Vorkenntnis:** Allgemeine Aussagen über Funding-Phasen waren vorher
  bekannt und offengelegt (V1 §11, V2 §5). Schwellen und Regeln blieben
  unverändert.
- **Im Shadow unsichtbar:** Börsen- und Gegenparteirisiko, ADL und USDT sind
  nur als fester Abschlag von 1,5 pp erfasst. Er ist eine Annahme. Mit dem
  pessimistischen Abschlag von 3,0 pp läge auch der Gesamtzeitraum nur noch
  bei +0,5 pp über dem Geldmarkt (A).
- **Übertragbarkeit:** Erreichbare EU-Plätze haben andere Funding-Formeln und
  Gebühren und für Privatkunden 2:1-Grenzen mit Close-out. Phase 1B wurde
  nicht durchgeführt; sie ist nach diesem Ergebnis nicht mehr nötig.

## 10. Bewertung und Folgen

1. **Wirtschaftlich nicht attraktiv unter heutigen Bedingungen.**
   - Historisch hätte der Carry das Shadow-Portfolio deutlich verbessert.
   - Seit 2024 bringt er weniger als risikolose Anlagen. Seine Risiken sind
     zudem überwiegend solche, die der Shadow nicht abbildet: Börse, Margin
     im Crash, ADL.
2. **Nach den eingefrorenen Regeln ist der Carry in dieser Form
   geschlossen (§8.4).**
   - Kein zweiter Versuch auf derselben Historie: keine andere Rückschau,
     Schwelle, Deckung, Hebelung, Münze oder Börse.
   - Eine erneute Prüfung ist frühestens nach 12 Monaten Forward-Daten ab
     2026-10-15 (also ab 2027-10-15) zulässig, mit neuer Vorregistrierung.
   - Dafür genügt der monatliche Abruf des öffentlichen Archivs. Es braucht
     keinen Bau.
3. **Keine Phase 2:**
   - kein Perp-Instrument im Shadow, keine ADR-Änderung (0001, 0012, 0013);
   - kein Carry-Regelsatz, kein Gates v5;
   - kein Forward-Teilnehmer.
   - Phase 1B entfällt.
4. **Nächste Forschungsrichtung** laut
   [Analyse](2026-10-16-research-directions-profitability.md), Abschnitt 8:
   Rang 2, relative Stärke über ein breiteres Spot-Universum. Auch dort gilt
   dieselbe Disziplin: zuerst Vorregistrierung, mit einem Universum ohne
   Überlebens-Verzerrung, dann der Datenabruf.
5. **Mehrfachtest-Zähler N = 55.** Die nächste Evolution-Vorregistrierung
   muss die zwei Carry-Varianten ausdrücklich mitzählen (Abschnitt 1).

## 11. Was unverändert blieb

- Risk Engine, Strategien, Gates v1–v4, Split, Arena.
- Offizieller Forward-Test `OFFICIAL_V1`, VPS.
- Keine Order, kein Echtgeld, keine Derivateposition.
- Keine Freigabe für echten Handel.
- Die Marktdaten bleiben lokal und gitignoriert (Lizenz CC BY-NC-SA 4.0,
  nicht-kommerziell).
