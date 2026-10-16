# Vorregistrierung der Machbarkeitsstudie Funding-/Basis-Carry BTC/ETH (2026-10-16)

> **Status: Entwurf zur Freigabe (Phase 0).** Geschrieben, **bevor** irgendwelche
> Funding-, Perpetual-, Mark- oder Indexpreis-Daten abgerufen oder angesehen
> wurden. Nichts wurde heruntergeladen, kein Code geschrieben, keine
> Risk-Regel, kein Limit, kein Gate und kein Regime-Modell geändert, kein
> KI-Forschungslauf gestartet (0 USD). VPS, offizieller Forward-Test
> (`OFFICIAL_V1`), Arena, Champion und Challenger sind unberührt. Keine
> Handelsempfehlung, keine Anlage-, Rechts- oder Steuerberatung.

Grundlage ist die
[Analyse der Forschungsrichtungen](2026-10-16-research-directions-profitability.md),
Abschnitte 3.4 und 8 (Rang 1, Stufenplan Phase 0). Der Betreiber hat die
Studie am 2026-10-16 beauftragt. Er wünscht ausdrücklich, dass die
Vorregistrierung folgende Punkte festlegt:

- negative Funding-Phasen;
- sämtliche Kosten;
- Basis-, Margin- und Liquidationsrisiko;
- Kapitalbindung;
- Ausführungsrisiko, wenn nur ein Bein steht;
- Lookahead-Schutz;
- Verfügbarkeit für ein Konto in Deutschland;
- Vergleich mit Champion und Challenger.

| | Wert |
|---|---|
| Studienkennung | `FUNDING_CARRY_FEASIBILITY_V1` |
| Varianten | `CARRY_ALWAYS` (A), `CARRY_FUNDING_7D_POSITIVE` (B), keine weiteren |
| Märkte | BTC und ETH: Binance Spot long, gleiche Menge Binance USDⓈ-M Perpetual short |
| Bewertungsfenster | 2020-01-01T00:00Z – 2026-09-30T23:59:59.999Z (81 volle Monate) |
| Platzkapital | 20 000 USDT (Platzgröße wie Gates v4), je Asset 10 000 USDT |
| Mehrfachtest-Zähler | N = 53 bei Festschreibung, 55 nach Phase 1 (Abschnitt 11) |
| Gates | keine. Diese Studie ist **kein** Gates-Lauf; v1–v4 bleiben unverändert |

**Kein kanonischer Hash.** Im Projekt tragen nur Vorregistrierungen einen
`canonicalHash`, die der Code festnagelt (Gates, Familien). Studien ohne
Code, wie die [Vorregistrierung des Testzeitraums](2026-10-14-preregistration.md),
haben keinen. Diese Studie hat keinen Code. Eingefroren wird sie durch den
Commit, den der Betreiber freigibt (Abschnitt 12, Schritt 0.2). Der
Ergebnisbericht nennt diesen Commit und den Blob-Hash dieser Datei
(`git hash-object`). Jede spätere Änderung ist eine Version V2. Sie wird nie
mit V1 vermischt und darf sich nicht auf Daten stützen, die V1 gesehen hat.

## 1. Fragestellung und Hypothese

**Frage.** Liefert ein vollständig abgesichertes, ungehebeltes Paar aus Spot
long und Perpetual short auf BTC und ETH nach sämtlichen modellierten Kosten
einen Ertrag auf das eingesetzte Gesamtkapital? Er müsste drei Dinge
leisten:

- den risikolosen Zins **und** einen Abschlag für die im Shadow unsichtbaren
  Risiken übertreffen;
- seit 2024 noch bestehen;
- vom Bestand (Champion, Challenger) unabhängig sein.

**H1.** Ja, in mindestens einer der zwei vorab festgelegten Varianten
(Kriterien B1–B6, Abschnitt 8).

**H0.** Nein. Der Carry ist durch Kosten, negative Funding-Phasen oder
Kompression seit 2024 aufgezehrt. Oder er ist nur die Entschädigung für die
Randrisiken, die der Abschlag abbildet.

**Ökonomische Begründung.**

- Perpetuals haben kein Verfallsdatum. Ihr Kurs wird über das Funding an den
  Index gebunden. Liegt der Perp über dem Index, zahlen Longs an Shorts.
- Die Nachfrage nach gehebeltem Long-Engagement ist in Krypto strukturell
  größer als die nach gehebeltem Short. Wer die Gegenseite abgesichert stellt,
  bekommt eine Prämie für Kapital, Gegenpartei- und Margin-Risiko.
- Das ist eine **Risikoprämie, kein Arbitragegewinn**. Sie braucht keine
  Kursprognose, ist aber prozyklisch: hoch in Bullenphasen, null oder negativ
  in Bärenphasen. Große Basis-Strategien können sie dauerhaft drücken.
- Binance-Formel (USDⓈ-M, laut öffentlicher Dokumentation):
  Funding = Prämie + Begrenzung(Zinsanteil − Prämie, ±0,05 %), mit einem
  Zinsanteil von 0,01 % je 8 h.
  - Bei kleiner Prämie ergibt das genau 0,01 % je 8 h, also rund **11 % p. a.
    auf das Perp-Notional** als Grundwert.
  - Auf das Gesamtkapital ist es bei voller Deckung beider Beine ungefähr die
    Hälfte, also 5,5 % p. a. vor Kosten (Abschnitt 5).
  - Ob die Formel so in den Daten steht, prüft D7 (nur Bericht).
- Diese Größenordnung ist eine **Erwartung aus der Mechanik, kein Ergebnis**.

## 2. Datenquellen, Datenprüfung und Lookahead-Schutz

### 2.1 Quellen und Download-Liste (Freigabe in Schritt 1.2)

Alle Quellen sind öffentlich und kostenlos. Es braucht weder Konto noch
API-Schlüssel noch Zustimmung zu Bedingungen. Die Daten liegen gitignoriert
unter `data/market-snapshots/carry-v1/`, mit `sources.json` und einem
SHA-256-Manifest. Committet wird keine Datei mit Marktdaten.

| Datensatz | Quelle | Zeitraum | Zweck |
|---|---|---|---|
| Funding-Raten BTCUSDT, ETHUSDT | `data.binance.vision`, `data/futures/um/monthly/fundingRate/<SYM>/` | ab dem ersten Monat des Kontrakts (BTCUSDT 2019-09) bis 2026-09 | Ertrag, Filter der Variante B |
| Perp-Kerzen 1h (Handelspreis) | `…/futures/um/monthly/klines/<SYM>/1h/` | wie oben | Ausführungspreis des Perp-Beins |
| Mark-Price-Kerzen 1h | `…/futures/um/monthly/markPriceKlines/<SYM>/1h/` | wie oben | Bewertung, Funding-Betrag, Margin, Liquidation |
| Index-Price-Kerzen 1h | `…/futures/um/monthly/indexPriceKlines/<SYM>/1h/` | wie oben | Basis-Prüfung |
| `.CHECKSUM` je Datei | dieselben Verzeichnisse | – | SHA-256-Abgleich |
| Spot-Kerzen 1h BTCUSDT, ETHUSDT | **vorhandener** Snapshot `data/market-snapshots/real/` (`exportBinanceHistory`), kein neuer Download | 2019-09 – 2026-09 | Spot-Bein |
| 3-Monats-T-Bill `DTB3` | FRED (wie die vorhandenen Index-Proxys) | 2020-01 – 2026-09 | risikoloser Zins für B1/B2 |
| Stichprobe REST | `GET https://fapi.binance.com/fapi/v1/fundingRate` (öffentlich, ohne Schlüssel) | 2020-01 und 2026-09 je Symbol | Gegenprobe D6 |

- Das Pfadschema folgt der Archiv-Dokumentation (`binance/binance-public-data`).
  Es wird vor dem Download nur über die **Verzeichnisliste** bestätigt, ohne
  Dateiinhalte zu öffnen.
- Umfang (Schätzung, nicht geprüft): je Symbol rund 85 Monate × 4 Datensätze,
  mit Prüfsummen rund 1 350 Dateien, Größenordnung 20–50 MB.
- Kein Monat ab 2026-10 wird geladen. Wie im übrigen Projekt bleibt alles ab
  2026-10-15 dem Forward vorbehalten.
- Die Monate vor 2020-01 dienen nur als Vorlauf für den 7-Tage-Filter und für
  die Datenprüfung. Sie gehen in keine Kennzahl ein.
- Hat ein Asset vor 2020-01-01 keine 7 Tage Funding-Historie, beginnt sein
  Teil am ersten Tag mit 7 Tagen. Bis dahin liegt sein Kapital als Kasse
  (0 %).

### 2.2 Datenprüfung (vor jeder Renditeberechnung)

Die Prüfung läuft als eigener Schritt (1.3). Ihr Bericht enthält nur
Datenqualität: Zählungen, Lücken, Ausreißerlisten, Formelanteil. Renditen,
Kennzahlen oder Funding-Mittelwerte stehen nicht darin. Erst wenn die
blockierenden Prüfungen D1, D2, D4, D6 und D8 bestanden sind, wird
gerechnet.

| Nr. | Prüfung | Toleranz | Behandlung |
|---|---|---|---|
| D1 | Jede erwartete Monatsdatei vorhanden, SHA-256 gleich `.CHECKSUM` | keine Abweichung | einmal neu laden; bleibt sie, `NICHT_AUSWERTBAR` |
| D2 | Funding: sortiert, keine Duplikate, jede Abrechnung einem vollen Stundenslot zugeordnet (Zeitstempel auf die Stunde abgerundet). Das Intervall kommt aus der Spalte `funding_interval_hours`, sonst gilt 8 h. Ein erwarteter Slot ohne Abrechnung ist eine Lücke | je Symbol ≤ 0,5 % fehlende Abrechnungen, keine Lücke > 24 h | Fehlendes wird mit **0** gebucht, nie interpoliert. Bei Überschreitung `NICHT_AUSWERTBAR` |
| D3 | Funding-Ausreißer: \|Rate\| > 0,375 % je Abrechnung | – | gelistet, nicht entfernt |
| D4 | Kerzen (Perp, Mark, Index, Spot): jede Stunde vorhanden, Tief ≤ Eröffnung/Schluss ≤ Hoch | je Reihe ≤ 0,5 % fehlende Stunden, keine Lücke > 24 h | In einer Lücke wird nicht gehandelt. Beide Beine werden gemeinsam in die nächste vollständige Stunde verschoben, bewertet wird mit dem letzten Kurs. Bei Überschreitung `NICHT_AUSWERTBAR` |
| D5 | Basis-Plausibilität: \|Perp-Schluss ÷ Spot-Schluss − 1\| > 2 %, \|Mark ÷ Index − 1\| > 1 % | – | gelistet, nicht entfernt |
| D6 | REST-Stichprobe gleich Archiv (\|Δ\| ≤ 10⁻⁸) für 2020-01 und 2026-09. Die Monate sind objektiv gewählt: erster und letzter voller Monat | ≤ 1 % abweichende Abrechnungen | Abweichungen gelistet. Bei Überschreitung `NICHT_AUSWERTBAR` |
| D7 | Anteil der 8h-Abrechnungen mit genau 0,0100 %, Zahl der Intervallwechsel | – | nur Bericht |
| D8 | Fingerprint des vorhandenen Spot-Snapshots; Spot deckt das Fenster vollständig ab | wie D4 | wie D4 |

Datenausfälle in Perp-Kerzen werden zusätzlich als Hinweis auf
Börsenunterbrechungen gelistet (Abschnitt 9).

### 2.3 Lookahead-Schutz

- **Entscheidungszeitpunkt** d = täglich 00:00 UTC.
  - Bekannt sind nur Abrechnungen, deren Slot **vor** d liegt. Die
    Abrechnung um 00:00 des Tages gehört nicht dazu.
  - Die vorab angezeigte „nächste“ Funding-Rate wird nie verwendet. Es zählen
    nur realisierte Raten.
- **Ausführung** zur Eröffnung der 1h-Kerze ab d, beide Beine gleichzeitig.
  - Spot zum Spot-Eröffnungskurs, Perp zum Perp-Eröffnungskurs, jeweils mit
    den Kosten aus Abschnitt 4.
  - Die Ausführung gilt als *nach* der Abrechnung im selben Slot.
- **Funding-Zuordnung:** Eine Position erhält oder zahlt die Abrechnung im
  Slot t genau dann, wenn Einstieg < t ≤ Ausstieg gilt.
  - Ein Einstieg um 00:00 erhält die 00:00-Abrechnung also nicht.
  - Ein Ausstieg um 00:00 trägt sie noch, denn die Position war bei der
    Abrechnung offen.
  - So entsteht nie eine doppelte Gutschrift.
- **Betrag einer Abrechnung:** Rate × Menge × Mark-Preis zur Eröffnung des
  Slots. Positive Rate heißt: der Short erhält.
- **Rebalancing und Liquidation** nutzen nur abgeschlossene Stunden. Die
  Ausführung liegt immer in der Folgestunde.
- **Champion/Challenger** werden mit ihren unveränderten, eingefrorenen
  Spezifikationen bewertet (Abschnitt 7). Nichts aus den Carry-Daten fließt
  dort ein.
- **Keine Parameterwahl auf Daten:** Alle Werte stehen in Abschnitt 3.4 und
  ändern sich nach dem Download nicht.

## 3. Halteregel: genau zwei Varianten

### 3.1 Gemeinsame Mechanik

- **Je Asset ein eigener Teil** mit 10 000 USDT Startkapital. BTC und ETH
  werden nie gegeneinander verrechnet oder umgeschichtet. Bewertet wird die
  Summe beider Teile (20 000 USDT).
- **Positionsaufbau** bei Einstieg oder Rebalancing:
  - E = Eigenkapital des Teils (Kasse + Spot-Wert + Eigenkapital des
    Perp-Collaterals).
  - Spot-Notional N = E ÷ 2; Spot-Menge q = N ÷ Spot-Eröffnungskurs.
  - Perp short **dieselbe Menge q**. Damit ist das Paar in Stück
    deltaneutral, unabhängig vom Kurs.
  - Collateral = E − N, abzüglich der Kosten.
  - Mengen werden nicht auf Schrittgrößen gerundet. Bei 10 000 USDT ist das
    vernachlässigbar.
- **Bewertung:**
  - Spot-Bein: q × Spot-Schluss.
  - Perp-Bein: Collateral + q × (Perp-Einstiegskurs − Mark-Schluss) +
    aufgelaufenes Funding.
  - Tageswerte zum Schluss der Stunde 23:00–24:00 UTC.
- **Rebalancing:**
  - Liegt der Mark-Schluss einer Stunde mindestens 20 % über oder mindestens
    20 % unter dem Bezugskurs (Mark-Preis beim letzten Aufbau), werden beide
    Beine zur nächsten Stundeneröffnung wieder auf N = E ÷ 2 gebracht.
  - Spot und Perp ändern sich um dieselbe Menge.
  - Der Übertrag zwischen Spot- und Futures-Konto ist Binance-intern,
    kostenlos und sofort.
  - Bei +20 % liegt die effektive Hebelung des Short-Beins bei 1,5, bei
    −20 % bei 0,67 (Abschnitt 5).
- **Liquidation:**
  - Geprüft wird stündlich mit dem **Hoch** des Mark-Preises.
  - Fällt das Collateral-Eigenkapital auf höchstens 0,5 % × q × Mark-Hoch
    (Wartungsmarge, für beide Symbole gleich angenommen), gilt das Perp-Bein
    als liquidiert.
  - Folge: Das **gesamte** Collateral geht verloren, das Spot-Bein bleibt bis
    zur nächsten Entscheidung ungesichert.
  - Jede Liquidation in der Simulation verletzt B4.
- **Ende:** Alle offenen Positionen werden zum Schluss der letzten Stunde
  (2026-09-30 23:00–24:00) mit Ausstiegskosten beider Beine glattgestellt.
  Gerechnet wird mit dem Liquidationswert, nicht mit dem Buchwert.
- **Kasse** verzinst sich nicht, wie im Shadow-Ledger. Der risikolose Zins
  dient nur als Hürde (B1/B2).

### 3.2 Variante A — `CARRY_ALWAYS`

- Einstieg am 2020-01-01 um 00:00.
- Halten bis zum Ende, nur Rebalancing.
- Nach einer Liquidation neuer Aufbau zur nächsten Entscheidung.
- Keine freien Parameter.

### 3.3 Variante B — `CARRY_FUNDING_7D_POSITIVE`

- Täglich zu d, je Asset getrennt: S₇ = Summe der realisierten Raten aller
  Abrechnungen mit Slot in [d − 7 Tage, d).
  - Bei Intervallwechseln zählt jede Abrechnung. S₇ ist also das tatsächlich
    über 7 Tage gezahlte Funding je Einheit Notional.
- S₇ > 0 und ohne Position → Einstieg.
- S₇ ≤ 0 mit Position → Ausstieg beider Beine.
- Sonst keine Änderung.
- Ohne Position liegt das Kapital des Teils als Kasse.
- Nach einer Liquidation gilt zur nächsten Entscheidung dieselbe Regel; ein
  verbliebenes Spot-Bein wird dabei glattgestellt oder neu abgesichert.
- Keine Hysterese, keine Mindesthaltedauer.

### 3.4 Fest und nie variiert

7 Tage, Schwelle 0, Entscheidung täglich um 00:00 UTC, Rebalancing-Band
±20 %, Aufteilung 50/50 auf BTC und ETH, N = E ÷ 2, Wartungsmarge 0,5 %,
Kostenmodell aus Abschnitt 4.

- Keine weitere Rückschaulänge, Schwelle, Hebelung, Collateral-Quote,
  Münze oder Börse.
- Keine Sensitivitätsläufe über diese Werte, auch nicht „nur zur
  Information“. Jeder zusätzliche Lauf wäre ein Gabelungspfad.

## 4. Kostenmodell

| Bein | Gebühr je Seite | Spread (voll) | Slippage je Seite | je Seite | Round-Trip |
|---|---:|---:|---:|---:|---:|
| Spot: `BINANCE_SPOT_VIP0_ESTIMATE_V1`, unverändert wie im offiziellen Forward-Test | 10 bp | 2 bp | 3 bp | 14 bp | 28 bp |
| Perp: USDⓈ-M VIP0 **Taker** (Studienwert `BINANCE_USDM_VIP0_TAKER_ESTIMATE_V1`) | 5 bp | 2 bp | 3 bp | 9 bp | 18 bp |
| Perp **Maker** (nur Bericht, Untergrenze) | 2 bp | – | – | 2 bp | 4 bp |

- **Entscheidend ist Taker auf beiden Beinen.** Passive Maker-Ausführung
  würde ein Bein offen lassen, bis das andere gefüllt ist. Das ist genau das
  Legging-Risiko, das Abschnitt 6 (L1) getrennt misst.
- Die Gebühren gelten über das ganze Fenster konstant, ohne BNB-Rabatt und
  ohne historische Gebührenänderungen.
  - Vor dem Download werden die VIP0-Sätze an der offiziellen Gebührentabelle
    bestätigt.
  - Weicht die Tabelle ab, gilt der **höhere** Wert. Das ist keine
    Ermessensänderung.
- **Beide Beine zusammen:** Einstieg 23 bp des Notionals (11,5 bp des
  Kapitals), Round-Trip 46 bp des Notionals (23 bp des Kapitals). Beim
  Grundwert von 3 bp je Tag auf das Notional ist ein Round-Trip nach etwa
  **15 Tagen** verdient.
- **Rebalancing** kostet dieselben Sätze auf die bewegte Menge. Bei +20 %
  wird ein Zehntel des Kapitals je Bein bewegt, also etwa 2,3 bp des Kapitals.
- **Finanzierung:**
  - Es gibt keine Fremdfinanzierung, keinen Leihzins und keinen Hebel über
    die Deckung hinaus.
  - Die Opportunitätskosten des Kapitals erfasst die Zinshürde in B1/B2.
  - Funding ist **gemessen**, kein Kostenparameter.
- **Kostenstress:** alle Ausführungskosten beider Beine × 2 (wie
  `INCREMENT_COST_STRESS`), dieselben Handlungen. Die Entscheidungen von B
  hängen nicht von den Kosten ab.
- **Nicht modelliert:** Ein- und Auszahlungen zwischen Börsen, Gebühren und
  Laufzeiten von Überweisungen. Sie gehören zu Abschnitt 10 (andere
  Handelsplätze).

## 5. Kapital- und Collateral-Modell

- **Ungehebelt, beide Beine gedeckt.**
  - Das Spot-Bein ist voll bezahlt.
  - Das Short-Bein ist mit Collateral in Höhe seines Notionals unterlegt,
    effektive Hebelung 1,0 beim Aufbau.
  - Damit gilt Kapital = 2 × Notional. Die Rendite auf das Kapital liegt
    grob bei der **Hälfte** der Funding-Rate auf das Notional.
- **Kapitalbindung:** Variante A bindet 100 % des Platzes, Variante B
  100 % während der gehaltenen Zeit. Zum Vergleich: Der Challenger bindet im
  Mittel 0,75 % (Analyse, Abschnitt 1).

**Margin und Liquidation** (Short mit Collateral C = Notional beim Aufbau,
Kursänderung x seit dem Aufbau):

| Größe | Formel | bei x = +20 % | bei x = −20 % |
|---|---|---:|---:|
| Collateral-Eigenkapital ÷ Aufbau-Notional | 1 − x | 0,80 | 1,20 |
| effektive Hebelung | (1 + x) ÷ (1 − x) | 1,50 | 0,67 |
| Binance-Liquidation (Wartungsmarge 0,5 %) | x ≥ 2 ÷ 1,005 − 1 ≈ **+99 %** | – | – |
| EU-CFD-Close-out bei 2:1 (50 % der Anfangsmarge, Abschnitt 10) | x ≥ 2 ÷ 1,25 − 1 = **+60 %** | – | – |

- Zu jedem Stundenschluss ohne Rebalancing-Anlass liegt die Hebelung unter
  1,5. Mit Anlass wird sie zur nächsten Eröffnung auf 1,0 zurückgeführt.
- Eine Liquidation verlangt deshalb innerhalb **einer** Stunde einen weiteren
  Anstieg des Mark-Hochs um rund 66 % (bis zum EU-Close-out rund 33 %).
- Der Bericht weist den kleinsten Abstand zu beiden Schwellen aus.
- **Effizientere Deckung wird nicht gerechnet** (Portfolio-Margin mit Spot
  als Sicherheit oder 2:1 mit 50 % Collateral). Ein Beispiel zeigt warum:
  - 50 % Collateral hebt die Rendite auf das Kapital rechnerisch um ein
    Drittel.
  - Dafür läge der EU-Close-out schon bei **+20 %**, also auf dem
    Rebalancing-Band.
  - Das ist eine eigene Risikoentscheidung für Phase 2, keine Variante dieser
    Studie.

## 6. Kennzahlen

Alle Kennzahlen gibt es je Variante, je Asset und für die Summe. Monatswerte
gelten für volle Kalendermonate; Renditen sind Eigenkapitalverhältnisse.

| Nr. | Kennzahl | Definition | Rolle |
|---|---|---|---|
| M1 | Netto p. a. auf Platzkapital | CAGR des Eigenkapitals (Liquidationswert am Ende) über 365,25 Tage; dazu die Zerlegung in Funding brutto, Ausführungskosten, Basis-/Bewertungsergebnis | B1, B2 |
| M2 | Sharpe | tägliche Nettorenditen, Mittel ÷ Standardabweichung × √365, ohne risikolosen Zins (Projektkonvention); dazu Monats-Sharpe × √12 | Bericht |
| M3 | max. Drawdown | auf Tageswerten; dazu auf Stundenwerten | B4 (Tag) |
| M4 | schlechtester Monat | kleinste Monatsrendite | B4 |
| M5 | Anteil negativer Monate | Monate mit Nettorendite < 0 | B3 |
| M6 | Anteil negativer Funding-Monate | je Asset: Monate mit Summe der realisierten Raten < 0, unabhängig von der Variante | Bericht |
| M7 | Kalenderjahre einzeln | 2020 … 2026 (2026 bis September): Netto, Funding, Kosten, Drawdown | B3 |
| M8 | Entwicklung seit 2024 | Netto p. a. 2024-01 – 2026-09 gegen 2020–2023; rollierende 12-Monats-Rendite; je Jahr Median und Mittel der annualisierten Funding-Rate, Anteil der Tage mit S₇ > 0 | B2 und Bericht |
| M9 | Korrelation mit dem Challenger | Pearson (Kriterium) und Spearman der Monatsrenditen gegen `CRYPTO_REGIME_LONG_V1`; ebenso gegen den Champion | B5 (Pearson Challenger) |
| M10 | eigener Ertrag | α aus `spanningAlphaTest` (Abschnitt 7) mit t, Freiheitsgraden und Teilfenstern | B5 |
| M11 | Kursneutralität | β und t der Monatsrenditen gegen BTC-Spot-Monatsrenditen | Bericht |
| M12 | Funding-Schwankung | je Asset und Jahr: Mittel, Median, Standardabweichung der annualisierten Raten, Anteil negativer Abrechnungen, längste Phase mit S₇ ≤ 0, schlechteste 30-Tage-Summe | Bericht |
| M13 | Basis | Verteilung (Perp ÷ Spot − 1) zu Stundenschlüssen: Median, P1, P99, Extremwerte; Beitrag des Basis-Ergebnisses zum Netto; größte Basis-Bewegung innerhalb eines Monats | Bericht |
| M14 | Margin | höchste effektive Hebelung (Stunde, Mark-Hoch), kleinster Abstand zur Binance-Liquidation und zum EU-Close-out, Zahl und Kosten der Rebalancings | B4 (Liquidation) und Bericht |
| M15 | Umschlag | Variante B: Ein- und Ausstiege, Zeit im Markt; Kosten ÷ Funding brutto | Bericht |
| M16 | Kostenstress | M1 bei doppelten Ausführungskosten | B6 |
| M17 | Legging-Stress L1 | Bei **jeder** Ausführung (Einstieg, Ausstieg, Rebalancing) folgt das zweite Bein eine Stunde später, zur Eröffnung der Folgestunde, in der jeweils **ungünstigeren** Reihenfolge. Zusatzverlust je Ausführung = bewegte Menge × \|Kursänderung der Stunde\|. Ausgewiesen: M1 unter L1, größter Einzelverlust | B6 (M1), Bericht |
| M18 | Ein-Bein-Szenario L24 | je Asset die größte \|24h-Kursänderung\| im Fenster (aus Stundenschlüssen) × Beinanteil 0,5, als Verlust in % des Teilkapitals, mit Datum. Bildet ein Bein ab, das 24 h fehlt (Ausfall, ADL, Zwangsschließung) | Bericht |
| M19 | Netto nach Abschlag | M1 − 1,5 pp und zusätzlich M1 − 3,0 pp (pessimistisch) | B1, B2 (1,5 pp) |
| M20 | Überschuss über den risikolosen Zins | M19 − Ø `DTB3` desselben Zeitraums | B1, B2 |
| M21 | Funding nach Regime | annualisiertes Funding je `crypto-native-regime-v1`-Label (`RISK_ON`, `NEUTRAL`, `MIXED`, `RISK_OFF`) | Bericht |

## 7. Vergleich mit Champion und Challenger

- **Bestandsreihen:** Monatsrenditen von Champion `CRYPTO_TREND_CORE_LONG_V1`
  (Hash `8bb3bb93…`) und Challenger `CRYPTO_REGIME_LONG_V1` (Hash
  `4708eaf8…`). Sie stammen je aus ihrem Platz in **Vergleich A** der
  unveränderten Portfolio-Simulation `portfolio-replay-v1/1.0.0`:
  - 20 000 USDT je Platz, BTCUSDT und ETHUSDT, Regime
    `crypto-native-regime-v1`;
  - Kosten `BINANCE_SPOT_VIP0_ESTIMATE_V1`;
  - Fenster wie in Gates v4: Entdeckung, Validierung und Holdout;
  - verwendet werden die Monate 2020-01 bis 2026-09, gebildet mit derselben
    Funktion `monthlyReturns`.
- Diese Reihen sind bereits gesehen. Sie zu rechnen braucht keine neuen Daten
  und zählt nicht für N.
- **Eigener Ertrag (B5):**
  - Methode `spanningAlphaTest` (`packages/evolution/src/paired.ts`), wie
    `OWN_ALPHA`.
  - Die Carry-Monatsrenditen werden gemeinsam auf Champion und Challenger
    regressiert.
  - Standardfehler: max(iid, Newey–West mit Lag ⌊4·(n/100)^(2/9)⌋), bei
    n = 81 also Lag 3.
  - Kritischer Wert: max(2; √(2·ln N); t₀,₉₇₅ mit n − 3 FG).
  - Zusätzlich je eine Schätzung für 2020–2023 und für 2024-01 – 2026-09
    (nur das Vorzeichen von α̂ zählt).
- **Vergleichstabelle (Bericht):** Champion, Challenger, Carry A und Carry B
  mit Netto p. a. auf den 20 000-Platz, Sharpe, max. Drawdown, schlechtestem
  Monat, Ø Kapitalbindung, Netto ÷ Ø Kapitalbindung, Netto ÷ max. Drawdown,
  Korrelation mit dem Challenger und β zu BTC.
- **Gesamtportfolio (nur Bericht, nie entscheidend):**
  - A = Champion + Challenger + Reserveplatz als Kasse (60 000 USDT).
  - B = derselbe Bestand mit Carry auf dem Reserveplatz.
  - Ausgewiesen werden Δ Netto, Δ Sharpe und Δ max. Drawdown.
  - Gates v4 kann einen Carry-Platz nicht formal bewerten. Sein Hash enthält
    Symbole, Regime-Policy und Gruppenregeln für Spot-Long. Eine formale
    Bewertung bräuchte Gates v5 (Abschnitt 13).

## 8. Bestehens- und Abbruchkriterien

### 8.1 Harte Kriterien

Für jede Variante, auf der Summe beider Assets, Fenster 2020-01-01 bis
2026-09-30, sofern nichts anderes steht. **Alle** müssen erfüllt sein.

| Nr. | Kriterium | Bestanden, wenn |
|---|---|---|
| B1 | Wirtschaftlichkeit gesamt | Netto p. a. − 1,5 pp (Abschlag) − Ø `DTB3` > 0 |
| B2 | Wirtschaftlichkeit seit 2024 | dasselbe für 2024-01-01 – 2026-09-30, mit Ø `DTB3` dieses Zeitraums |
| B3 | Stetigkeit | Netto > 0 in mindestens 5 der 7 Kalenderjahre 2020–2026 (2026 bis September) **und** höchstens 30 % der Monate negativ |
| B4 | Verlustbegrenzung | max. Drawdown (Tageswerte) ≤ 10 % **und** schlechtester Monat ≥ −3 % **und** keine Liquidation |
| B5 | eigener Ertrag, Unabhängigkeit | α-t ≥ max(2; √(2·ln 55); t₀,₉₇₅) ≈ **2,83** **und** α̂ > 0 in 2020–2023 und in 2024–2026-09 **und** Pearson-Korrelation der Monatsrenditen mit dem Challenger ≤ 0,5 |
| B6 | Robustheit | Netto p. a. > 0 bei doppelten Ausführungskosten **und** unter Legging-Stress L1; der BTC- und der ETH-Teil sind einzeln netto > 0 |

Herkunft der Schwellen:

- **B1/B2** folgen aus der Ökonomie. Ein Ertrag, der nach dem Abschlag nicht
  über dem Geldmarktzins liegt, ist kein zusätzlicher Ertrag. Dafür bindet
  die Strategie das ganze Kapital an einer Börse.
- **10 % Drawdown** ist der Wert aus Gates v4 (`PORTFOLIO_DRAWDOWN`).
- **0,5 Korrelation** ist der Wert aus Gates v1 („Gegen Champion“).
- **α-Schwelle** wie `OWN_ALPHA`.
- **5 von 7 Jahren, 30 % negative Monate, −3 % schlechtester Monat** sind
  Ermessenswerte für eine marktneutrale Prämie. Sie wurden vor jedem
  Datenabruf gesetzt und nie an Daten geprüft.

### 8.2 Ergebnisklassen

| Klasse | Bedingung |
|---|---|
| `BESTANDEN` | mindestens eine Variante erfüllt B1–B6, **und** Phase 1B ergibt `VERFUEGBAR` (Abschnitt 10) |
| `BESTANDEN_REFERENZ` | B1–B6 erfüllt, Phase 1B aber nicht `VERFUEGBAR`. Der Carry ist am Referenzmarkt historisch plausibel, für das Konto aber nicht belegt. Phase 2 nur auf ausdrücklichen Beschluss als reine Forschung |
| `KOMPRIMIERT` | alles außer B2 erfüllt: Den Carry gab es, seit 2024 trägt er nicht mehr |
| `NICHT_BESTANDEN` | sonst |
| `NICHT_AUSWERTBAR` | D1, D2, D4, D6 oder D8 verletzt; es werden keine Renditen berechnet |

### 8.3 Auswahl bei zwei bestandenen Varianten

Es gilt **A**, weil sie weniger Parameter und weniger Handel hat. B gilt nur,
wenn ihr Netto p. a. mindestens 1,0 pp über dem von A liegt **und** ihr max.
Drawdown nicht größer ist.

### 8.4 Abbruch und Einmaligkeit

- **`NICHT_BESTANDEN` oder `KOMPRIMIERT`:** Der Carry in dieser Form ist
  geschlossen.
  - Kein zweiter Versuch auf derselben Historie: keine andere Rückschau,
    Schwelle, Deckung, Hebelung, Münze oder Börse.
  - Nächster Schritt laut Analyse ist Rang 2 (relative Stärke) mit eigener
    Vorregistrierung.
  - Nach `KOMPRIMIERT` ist eine neue Prüfung nur auf Forward-Daten zulässig:
    frühestens 12 Monate nach 2026-10-15 und mit neuer Vorregistrierung.
- **`NICHT_AUSWERTBAR`:** Die Arbeit endet vor jeder Renditeberechnung. Eine
  andere Datenquelle braucht eine neue Vorregistrierung.
- **Stopp und Rückfrage beim Betreiber,** sobald ein Abruf Geld, ein Konto,
  einen API-Schlüssel oder die Zustimmung zu Bedingungen verlangen würde.
- **Keine Zwischenblicke.** Renditen werden erst berechnet, wenn D1, D2, D4,
  D6 und D8 bestanden sind, und dann in **einem** Lauf für beide Varianten.
- **Fehlerkorrektur:** Findet sich nach dem Lauf ein reiner
  Implementierungsfehler gegenüber diesem Dokument, ist **ein**
  korrigierter Lauf zulässig. Der Bericht nennt beide Ergebnisse und den
  Fehler. Eine inhaltliche Änderung ist dagegen V2 (siehe oben).

## 9. Im Shadow unsichtbare Realrisiken und Abschlag

Die Simulation rechnet mit einer Börse, die immer erreichbar und zahlungsfähig
ist, mit stabilem USDT und mit Positionen, die nur durch den eigenen
Margin-Zustand enden. Die Realität kennt mehr. Deshalb gilt ein **fester
Abschlag von 1,5 pp p. a. auf das gesamte Platzkapital** (B1, B2):

- 1,0 pp für Börsen- und Gegenparteirisiko;
- 0,5 pp für Ereignisrisiken.

Pessimistisch werden 3,0 pp ausgewiesen (nur Bericht). Der Abschlag ist eine
**Annahme**, nicht gemessen. Er steht hier, damit er nicht nach dem Ergebnis
gewählt wird. Die Größenordnung:

- Unter den großen Krypto-Handelsplätzen gab es mehrere Zusammenbrüche mit
  eingefrorenem oder verlorenem Kundenvermögen (Mt. Gox 2014, QuadrigaCX
  2019, FTX 2022). Rückzahlungen kamen, wenn überhaupt, erst nach Jahren.
- Die Basisrate liegt nach grober Schätzung bei 1–2 % je Börse und Jahr.
- Beim Carry liegt **das gesamte Kapital** an der Börse.

| Risiko | Im Shadow sichtbar? | Behandlung |
|---|---|---|
| Börse oder Gegenpartei: Insolvenz, Hack, eingefrorene Auszahlungen | nein | Abschlag 1,0 pp; Bericht: 100 % des Kapitals an einer Stelle |
| Regulatorische Zwangsschließung (z. B. Binance-Derivate für Deutschland 2021 mit Abwicklungsfrist) | nein | Abschlag (Ereignis); Phase 1B |
| Margin und Liquidation des Short-Beins | teilweise: Simulation mit Rebalancing und Liquidationsprüfung | M14, B4 |
| Auto-Deleveraging (ADL): Die Börse schließt den gewinnenden Short zwangsweise, das Spot-Bein bleibt offen | nein, es gibt keine öffentliche ADL-Historie | Abschlag (Ereignis); L24 (M18) |
| Ausführung: ein Bein gefüllt, das andere nicht; Teilausführung; Börsenunterbrechung im Crash | teilweise | L1 (B6), L24 (Bericht), Datenlücken aus D4 |
| Stablecoin: USDT als Collateral und Quote weicht vom Dollar ab | nein | Abschlag (Ereignis). Hinweis: USDT ist in der EU nicht MiCA-konform, EU-Plätze rechnen in EUR oder USDC |
| Währung: Ein Anleger in EUR trägt EUR/USD auf das ganze Kapital | nein | Bericht; nicht im Kriterium (Studie rechnet in USDT) |
| Steuern: mögliche Asymmetrie zwischen Spot- und Derivate-Bein (Abschnitt 10) | nein | nicht Teil der Studie; vor Phase 2 klären |
| Übertragbarkeit: Binance-Funding ist nicht das Funding des erreichbaren Handelsplatzes | nein | Phase 1B |
| Marktwirkung bei größerem Kapital | bei 20 000 USDT vernachlässigbar | nicht modelliert |

## 10. Verfügbarkeit für ein Konto in Deutschland (Phase 1B)

**Kernbefund vorab: Binance ist hier nur Referenzmarkt, kein erreichbarer
Handelsplatz.** Die Studie misst, ob es den Carry am tiefsten und am besten
dokumentierten Markt nach Kosten gab. Ob ein deutsches Privatkonto ihn
überhaupt abschöpfen kann, ist eine eigene Frage. Phase 1B beantwortet sie.
Ohne positive Antwort lautet das Ergebnis höchstens `BESTANDEN_REFERENZ`.

**Kenntnisstand 2026-10-16.** Quelle ist eine Websuche nur zu Regulierung und
Produktverfügbarkeit; die Treffer enthielten keine Funding-Daten. Es sind
überwiegend **Sekundärquellen**. Alles hier ist **ungeprüft** und in Phase 1B
an Primärquellen zu bestätigen: Bedingungen der Anbieter, BaFin, ESMA-Register.

| Anbieter | Perpetuals für Privatkunden in DE | Spot | Einordnung |
|---|---|---|---|
| Binance | seit 2021 eingestellt ([The Block](https://www.theblock.co/post/113068/binance-crypto-derivatives-trading-europe-shut-down), [Decrypt](https://decrypt.co/77224/binance-pulls-futures-derivatives-offerings-european-market)) | keine MiCA-Zulassung. Laut Fachpresse seit 2026-07-01 für EU-Kunden, auch in DE, stark eingeschränkt: keine Neukäufe und Einzahlungen ([finanzwissen](https://finanzwissen.de/news/binance-und-bitget-weiter-ohne-mica-lizenz-das-solltest-du-als-kunde-jetzt-tun/), [Rankia](https://rankia.de/binance-mica-lizenz/), [Trending Topics](https://www.trendingtopics.eu/binance-to-pull-back-from-eu-markets-as-mica-deadline-hits-july-1/)) | nur Datenreferenz |
| Bitget | nein | nein | Terms vom 2026-06-16: Deutschland ist „Prohibited Country“ ([ADR 0007](../decisions/0007-bitget-is-conditional-not-approved.md)); No-Go, keine Umgehung |
| Bybit (global) | EEA-Einschränkungen angekündigt am 2026-06-29 ([Dok. 09](../09-bitget-demo-adapter-analysis.md)) | – | Bybit EU getrennt prüfen |
| One Trading | laut Anbieter BTC/EUR- und ETH/EUR-Perpetuals, MiFID-II-OTF (AFM), Privatkunden u. a. in DE ([Anbieter](https://www.onetrading.com/blog/a-cheaper-and-safer-way-to-invest-in-crypto-perpetual-futures-are-now-live-in-europe-for-retail), [The TRADE](https://www.thetradenews.com/one-trading-expands-retail-access-for-crypto-perpetual-futures-venue/)) | prüfen | Kandidat |
| Kraken (EU) | laut Fachpresse Perpetuals für EWR-Privatkunden über eine CySEC-lizenzierte Gesellschaft ([Finance Magnates](https://www.financemagnates.com/cryptocurrency/european-retail-gains-regulated-access-to-leveraged-crypto-trading/)) | prüfen | Kandidat |
| OKX Europe | laut Fachpresse MiFID-Derivate für EU-Privatkunden ([Cointelegraph](https://cointelegraph.com/news/okx-targets-eu-retail-mica-mag-7-stock-perps)) | prüfen | Kandidat |

**Regulatorischer Rahmen (laut Fachpresse, Primärtext prüfen):**

- Die ESMA stellte am 2026-02-24 fest, dass Perpetuals für Privatkunden
  unter die bestehenden CFD-Maßnahmen fallen (ESMA35-243228190-8024). Die
  Folgen ([Finance Magnates](https://www.financemagnates.com/forex/regulation/esma-tells-firms-perpetual-futures-fall-under-eu-cfd-rules)):
  - Hebel höchstens **2:1**;
  - Close-out bei 50 % der Anfangsmarge;
  - Schutz vor negativem Saldo;
  - Risikowarnung, enger Zielmarkt.
- Die CySEC hat das am 2026-06-10 an ihre Lizenznehmer weitergegeben.
- Die ungehebelte Deckung dieser Studie (1:1) liegt innerhalb der 2:1-Grenze.
  Den Close-out-Abstand weist M14 aus.

**Steuer (keine Steuerberatung, nur Prüfauftrag):**

- Nach verbreiteter Auffassung fallen bei Privatpersonen Spot-Gewinne unter
  § 23 EStG (private Veräußerungsgeschäfte, Haltefrist ein Jahr) und
  Derivate-Ergebnisse unter § 20 EStG.
- Dann wären Gewinne und Verluste der beiden Beine womöglich nicht
  miteinander verrechenbar.
- Ein marktneutrales Paar könnte so Steuer auf den Gewinn eines Beins
  auslösen, obwohl es netto nichts verdient.
- Das ist vor Phase 2 durch Steuerberatung zu klären.

**Prüffragen der Phase 1B** (je Kandidat mit Primärquelle und Datum):

1. Zugang für Wohnsitz Deutschland als Privatkunde; zuständige Aufsicht,
   juristische Einheit, Registereintrag; Angemessenheitsprüfung nötig?
2. BTC- und ETH-Perpetual verfügbar, Abrechnungswährung, Kontraktgröße.
3. Funding-Mechanik: Formel, Intervall, Begrenzungen, öffentliche Historie
   (ab wann, Format, kostenlos?).
4. Gebühren VIP0 Maker und Taker.
5. Margin-Regeln: 1:1-Deckung zulässig? Close-out, Liquidation, ADL- oder
   Ausgleichsmechanismus.
6. Spot-Bein am selben Ort oder anderswo? Kann Spot als Sicherheit dienen,
   und gibt es Übertragswege und -dauern?
7. Lesende API für Marktdaten ohne Konto.

**Wer prüft was:**

- Claude prüft nur öffentlich: Bedingungen, Register, Dokumentation.
- Ob **das eigene Konto** berechtigt ist, prüft der Betreiber selbst.
- Claude eröffnet kein Konto, erzeugt keinen API-Schlüssel, akzeptiert keine
  Bedingungen und platziert keine Order. Regionale Sperren werden nie
  umgangen (ADR 0007).

**Ergebnis der Phase 1B:**

- **`VERFUEGBAR`** verlangt einen Kandidaten, für den alle drei Punkte
  gelten:
  - „ja“ bei den Prüffragen 1, 2, 3 (Formel), 5 (1:1-Deckung) und 6
    (Spot-Bein beschaffbar);
  - eine öffentliche Funding-Historie mit mindestens 6 Monaten
    Überlappung zum Bewertungsfenster;
  - einen **Übertragungsfaktor** ≥ 0,5. Er ist Ø Funding des Kandidaten ÷ Ø
    Binance-Funding derselben Monate.
- Der Abruf dieser Historie braucht eine eigene Download-Freigabe. Der
  Bericht rechnet B1 und B2 zusätzlich mit dem Faktor und den Gebühren des
  Kandidaten (nur Bericht).
- **`VERFUEGBAR_OHNE_HISTORIE`:** Zugang ja, aber keine nutzbare Historie
  oder ein Faktor unter 0,5. Das zählt **nicht** als `VERFUEGBAR`. Der
  Betreiber kann es in Phase 2 bewusst anders entscheiden.
- **`NICHT_VERFUEGBAR`:** sonst.

## 11. Mehrfachtest-Zähler, gesehene Daten und Vorwissen

- **N:** Die Studie liegt außerhalb der Evolution Engine. Ihre zwei
  Varianten werden trotzdem **konservativ mitgezählt**: N = 53 → 55 mit
  Phase 1, Schwelle √(2·ln 55) = 2,83. Der Zähler wird nie zurückgesetzt.

**Gesehene Daten:**

| Daten | Status |
|---|---|
| Binance-Funding, Perp-, Mark- und Indexkerzen | von SignalPilot **nie** abgerufen oder ausgewertet; neu |
| Spot BTC/ETH 2018–2026-10-14 | verbraucht (Vorforschung, Evolution, Analyse vom 2026-10-16) |
| Champion/Challenger-Monatsrenditen | aus bereits analysierten Läufen; nur Vergleichsgröße |
| `DTB3` | nie abgerufen; ohne Bezug zu einer Strategieregel |
| Forward ab 2026-10-15 | wird nicht geladen |

- **Vorwissen, offen benannt:**
  - Das Sprachmodell kennt aus öffentlichen Quellen bis etwa Mitte 2026
    allgemeine Aussagen: hohes Funding in Bullenphasen (etwa 2021, Anfang
    2024), negative Phasen 2022, Wachstum großer Basis-Strategien seit 2024.
  - Die Analyse vom 2026-10-16 nennt dieselben Punkte.
  - Dieses Wissen hat die **Fragen** geprägt (Kriterium B2 „seit 2024“,
    Kennzahlen zu negativen Phasen). Die **Schwellen** stammen aus Ökonomie
    und Projektkonventionen (Abschnitt 8.1).
  - Ein historisches Ergebnis bleibt deshalb **Plausibilisierung, kein
    Beweis**. Unabhängige Evidenz liefert nur ein Forward-Test (Phase 3).
- **Recherche für dieses Dokument:**
  - Repository-Dokumente und Code (Kostenmodell, Gates, `spanningAlphaTest`,
    ADRs).
  - Eine Websuche zur Regulierung (Abschnitt 10).
  - Keine Funding-, Perp-, Mark- oder Indexdaten, keine Funding-Statistik.

## 12. Untersuchungsplan

| Schritt | Inhalt | Wer | Freigabe | Kosten |
|---|---|---|---|---|
| 0.1 | Diese Vorregistrierung committen | Claude | – | 0 |
| 0.2 | Review; offene Punkte F1–F6 entscheiden. Der freigegebene Commit friert V1 ein | Betreiber | **ja** | 0 |
| 1.1 | Auswertungsskript schreiben und **vor** dem Download gegen synthetische Daten testen (Ort nach F6). Geprüft werden Lookahead-Regel, Funding-Zuordnung (Einstieg < t ≤ Ausstieg), Rebalancing, Liquidation, Kosten, Legging-Stress, Monatsrenditen, Ergebnisklassen | Claude | mit 0.2 | 0 |
| 1.2 | Download der Liste aus 2.1, Prüfsummen, Manifest | Claude | **ja, ausdrücklich** | 0 USD |
| 1.3 | Datenprüfung D1–D8; Bericht nur zur Datenqualität | Claude | – | 0 |
| 1.4 | Monatsrenditen von Champion und Challenger aus dem unveränderten Vergleich A (Abschnitt 7) | Claude | – | 0 |
| 1.5 | Ein Lauf beider Varianten, alle Kennzahlen M1–M21, Kriterien B1–B6 | Claude | – | 0 |
| 1.6 | Phase 1B: Primärquellen prüfen; Konto prüft der Betreiber; Übertragungsfaktor nur nach eigener Download-Freigabe | Claude und Betreiber | **ja** (Download) | 0 |
| 1.7 | Ergebnisbericht `docs/trading/research/<Datum>-funding-carry-feasibility-results.md` mit Ergebnisklasse; Mehrfachtest-Zähler auf 55 | Claude | – | 0 |
| 2 | Nur bei `BESTANDEN` (oder bewusst bei `BESTANDEN_REFERENZ`) und nach Betreiberbeschluss: Grundsatzentscheidungen aus Abschnitt 13 | – | **ja**, je ADR | Bauaufwand |
| 3 | Eigener Shadow-Forward-Teilnehmer, strikt getrennt von `OFFICIAL_V1` | – | **ja** | – |

- Das Auswertungsskript nutzt nur die Python-Standardbibliothek, Aufruf
  `python3 -I`. Es importiert nichts aus `apps/` oder `packages/`.
- Der Bericht nennt den SHA-256 des Skripts, die Daten-Fingerprints, den
  Commit und den Blob-Hash dieser Datei.
- Zu keinem Zeitpunkt werden Echtgeld, Exchange-Adapter, Konto-Anbindung,
  `ENABLE_LIVE_TRADING`, VPS oder Forward-Test berührt.

## 13. Grundsatzentscheidungen erst nach bestandener Studie

Keine davon wird jetzt getroffen oder vorbereitet. Sie stehen hier, damit
klar ist, was ein „bestanden“ auslösen würde und was nicht.

| Thema | Heutiger Stand | Warum betroffen | Art der Entscheidung |
|---|---|---|---|
| Perpetual-Bein im Shadow | [ADR 0001](../decisions/0001-shadow-only-first-stage.md): keine Futures, keine Margin. [ADR 0012](../decisions/0012-synthetic-unleveraged-shadow-shorts.md): keine **erfundenen** Funding-Raten | Ein simuliertes Perp-Bein mit **gemessenem** Funding ist neu. Es braucht eine Abgrenzung zu 0012 und eine Ergänzung zu 0001 | neue ADR |
| Abgesichertes Paar | [ADR 0013](../decisions/0013-no-simultaneous-long-and-short-exposure.md): nie Long und Short auf dasselbe Asset im selben Portfolio; Scope-Keys bewusst ohne Richtung | Der Carry *ist* Long Spot + Short Perp auf dasselbe Asset | ADR: Paar als eigene Positionsart oder getrenntes Instrument, ohne die Exklusivität für gerichtete Strategien aufzuweichen |
| R-005 | Short nur synthetisch, fünf Flags, ohne Futures-Capability | Das Short-Bein ist ein Derivat | Risk-Regel-Version |
| R-006 | Hebel 1, keine Margin | Ein Perp ist ein Margin-Produkt, auch bei 1:1 | carry-eigene Regel (Deckungsquote, Liquidationsabstand) |
| R-008, R-009, R-010, R-021 | 2R-Mindestziel, 0,25 % Risiko je Trade, Tagesverlust, Verlustserie (Limit-Set, über R-026 festgenagelt) | Der Carry hat weder Stop noch Ziel noch R | eigener Regelsatz und eigenes Limit-Set |
| R-011, R-014 | höchstens 2 offene Positionen; Asset-Exposure ≤ 20 % | 2 Assets × 2 Beine; 25 % des Platzes je Spot-Bein | eigener Regelsatz |
| R-020 | Long nur bei `RISK_ON` | Der Carry ist regimeunabhängig gedacht; das Spot-Bein würde außerhalb von `RISK_ON` abgelehnt | Ausnahme im Carry-Regelsatz, nicht R-020 lockern |
| Bewertung | Gates v4: Hash mit Symbolen, Regime-Policy, Spot-Gruppenregeln | Ein Carry-Platz ist darin nicht abbildbar | Gates v5 mit eigener Vorregistrierung |
| Daten | `market-data` kennt nur Spot-Kerzen 1h/4h/1d | Funding, Mark- und Indexpreis fehlen | Datenpipeline-Erweiterung |
| Arena | [ADR 0015](../decisions/0015-arena-survival-on-own-capital.md), `arena-policy-v1` | neuer Teilnehmer mit eigenem Portfolio | Beschluss nach Arena-Regeln |
| Handelsplatz, Recht, Steuer | ADR 0007, OD-30, OD-37; Abschnitt 10 | Erreichbarkeit für ein deutsches Konto; steuerliche Asymmetrie | Phase 1B, Steuerberatung; eine echte Ausführung bleibt außerhalb des Projekts (Shadow-only) |

## 14. Offene Punkte zur Freigabe

| Nr. | Frage | Empfehlung |
|---|---|---|
| F1 | Risikoloser Zins (`DTB3`) als Hürde in B1/B2? | **Ja.** Ohne Hürde wäre ein Carry auf Geldmarktniveau „bestanden“, obwohl er gegenüber Kasse nichts bringt. Alternative: Hürde 0 wie im Shadow-Ledger |
| F2 | Abschlag 1,5 pp p. a. (pessimistisch 3,0 pp nur Bericht)? | **Ja**, als Annahme vor den Daten |
| F3 | Die zwei Varianten zählen für N (53 → 55)? | **Ja**, konservativ |
| F4 | Binance als Referenzmarkt, `BESTANDEN` nur mit Phase 1B `VERFUEGBAR`? | **Ja** |
| F5 | Download-Liste aus 2.1 inklusive FRED und REST-Stichprobe | Freigabe gesondert in Schritt 1.2 |
| F6 | Ort des Auswertungsskripts | Im Repo unter `scripts/research/funding-carry-v1/`, damit Review und Reproduktion möglich sind; reine Standardbibliothek, ohne Bezug zu Produktcode |

## 15. Was unverändert bleibt

- Code, Datenbank, Risk Engine mit allen 26 Regeln, Limit-Set, Regime-Modelle,
  Strategie-Registry, Gates v1–v4 mit ihren Hashes, Daten-Split, Kostenmodell
  der Evolution.
- Champion, Challenger, Arena V1, offizieller Forward-Test `OFFICIAL_V1`, VPS,
  lokaler Shakedown.
- `ENABLE_LIVE_TRADING=false`, `PAPER_TRADING_ONLY=true`; kein
  Exchange-Adapter, kein API-Schlüssel, keine Order, kein Echtgeld.
