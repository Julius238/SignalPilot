# Vorregistrierung `DELEVERAGING_EVENTS_V1` (D8): kurzfristige Überreaktion nach Deleveraging auf BTC/ETH-Perpetuals

> **Status: ENTWURF Phase 0, nicht eingefroren.** Erstellt am 2026-10-20 auf
> `claude/inspiring-noether-rjh92d`.
>
> - Kein Download, kein Code, kein Backtest, keine Parameteroptimierung,
>   kein KI-Lauf (0 USD).
> - Die Datenlage ist nur über die öffentlichen Verzeichnislisten von
>   `data.binance.vision` und über Dokumentation geprüft (Abschnitt 7).
> - Keine Börsenanbindung, kein Live-Handel. Bitget ist für Deutschland
>   gesperrt (ADR 0007, Abschnitt 11).
> - An `OFFICIAL_V1`, Champion, Challenger, Risk Engine, Arena, Gates, `main`
>   und VPS ändert sich nichts.
> - Mehrfachtest-Zähler unverändert **N = 57**. D8 zählt erst mit seiner
>   Auswertung.
> - D6 (eingefroren) und D7 (Entwurf) bleiben unverändert.
> - Keine Handels-, Anlage- oder Steuerberatung.

## Kurz und verständlich

- **Frage:** Kehrt sich eine abrupte Kursbewegung, die mit einem
  ungewöhnlich starken Abbau des Open Interest (OI) einhergeht, innerhalb
  einer Stunde stärker zurück als eine gleich große Bewegung **ohne**
  OI-Abbau? Und bleibt danach nach harten Kosten etwas übrig?
- **Ein OI-Rückgang beweist keine Zwangsliquidation.** Deshalb heißen die
  Ereignisse hier **Deleveraging-Ereignisse**.
- **Kern ist der Kontrolltest:** Erst wenn der OI-Auslöser mehr leistet als
  die einfache Kursumkehr gleich großer Schocks, ist der Befund neu.
  Leistet er das nicht, ist es die alte, verworfene Umkehr, und die Studie
  endet.
- **Ehrliche Erwartung:**
  - Unsicher.
  - Handelbar wäre die Strategie nur bei großen Ereignissen, und nur auf
    Perpetuals mit niedrigen Gebühren.
  - Für ein deutsches Konto gibt es dafür heute keinen nachgewiesenen
    Handelsplatz.
- **Aufwand bis zum Ergebnis:** rund ein bis zwei Wochen Arbeitssitzungen
  nach den Freigaben.

## 1. Platz in der Plattform

| Kriterium | Bewertung |
|---|---|
| Zeithorizont | **Daytrading**: Entscheidung im 5-Minuten-Takt, Haltedauer höchstens 60 Minuten |
| Marktphasen | jedes Regime, beide Richtungen: Long nach Abwärts-, Short nach Aufwärtsereignissen |
| Eigenständiges Modul | ja: ereignisgetrieben, unabhängig von Trend-Modulen, eigenes Budget denkbar |
| Engpass | Kosten je Trade und Zugang zu Perpetuals (Abschnitt 11) |

## 2. Abgrenzung von früherer Forschung

| | Bisher verworfen | D8 |
|---|---|---|
| Stundenumkehr | unbedingte Autokorrelation der 1h-Spotrenditen (−0,02 bis −0,04), an rund 30 bp Kosten gescheitert | **bedingt** auf ein seltenes Ereignis mit Positionsabbau; Kosten über Perpetuals |
| Schock-Ereignisse | 24h-Rendite jenseits ±2σ, Folgerendite über 72 h, Spot, nach Regime getrennt; keine Zelle ≥ 2,82 | 60-Minuten-Schock, Folgerendite über **60 Minuten**; Regime spielt keine Rolle |
| Kapitulationskäufe außerhalb `RISK_ON` | nach 24h-Abstürzen weitere Verluste über 72 h | anderer Horizont (60 min statt 72 h) und anderer Auslöser (OI-Abbau). **Risiko bleibt:** Die Fortsetzung nach großen Abstürzen kann auch kurzfristig wirken. Die Stop-Regel und der Kontrolltest messen das |
| Daten | 1h/4h/1d-Spotkerzen, verbraucht | 1m-Kerzen der Perpetuals und OI im 5-Minuten-Takt, **für SignalPilot unbenutzt** |

**Der faire Kontrolltest:**

- Kontrollereignisse sind Kursschocks gleicher Stärke und Richtung, **ohne**
  ungewöhnlichen OI-Abbau.
- Sie haben dieselben Zeitregeln, Einstiege, Ausstiege, Stops und Kosten.
- Ein Vorteil gilt nur, wenn D-Ereignisse nach Kosten mehr verdienen als die
  Kontrolle (Abschnitt 9).

## 3. Daten zum Entscheidungszeitpunkt (kein Look-ahead)

- **Raster:** 5 Minuten (UTC). Entscheidungszeitpunkte c liegen auf
  :00, :05, … (Schluss der 5-Minuten-Kerze).
- **Kurs:** Schlusskurs der 5-Minuten-Kerze, aggregiert aus 1m-Klines des
  Perpetuals (letzter Handelspreis). Er gilt zum Kerzenschluss c als bekannt.
- **Open Interest:** `sum_open_interest` aus `metrics`.
  - Ein mit t gestempelter Wert gilt erst zu t + 5 Minuten als bekannt.
  - Zum Zeitpunkt c ist also höchstens OI(c − 5 min) verfügbar.
  - Die genaue Bedeutung von `create_time` prüft Schritt 0.2. Ist sie
    ungünstiger, wird die Verzögerung erhöht, nie gesenkt.
- **Normierung:** Die Verteilung jeder Größe wird nur aus den
  vorangegangenen 30 Tagen geschätzt, rollend, ohne den aktuellen Zeitpunkt.

## 4. Ereignisse (fest, wenige Parameter)

Parameter: Fenster W = 60 Minuten, Normierung 30 Tage, Schwellen 3 und 1.
Alles runde Standardwerte, festgelegt vor jedem Datenblick und nicht
optimiert.

| Größe | Definition zum Zeitpunkt c |
|---|---|
| Kursänderung | ΔP(c) = P(c) ÷ P(c − 60 min) − 1 |
| OI-Änderung | ΔOI(c) = OI(c − 5 min) ÷ OI(c − 65 min) − 1 |
| z-Werte | z_P = ΔP ÷ Standardabweichung von ΔP; z_OI = ΔOI ÷ Standardabweichung von ΔOI; beide über alle 5-Minuten-Punkte der vorangegangenen 30 Tage |

- **Deleveraging-Ereignis (D):** \|z_P\| ≥ 3 **und** z_OI ≤ −3.
- **Kontrollereignis (K):** \|z_P\| ≥ 3 **und** z_OI ≥ −1. Der OI ist dann
  stabil oder steigt.
- **Nicht zugeordnet:** −3 < z_OI < −1. Das wird nicht gehandelt und nur
  gezählt.
- **Richtung:**
  - z_P ≤ −3 ist ein Abwärtsereignis, danach **Long**.
  - z_P ≥ +3 ist ein Aufwärtsereignis, danach **Short**.
- **Auslösezeitpunkt** c₀: der erste Zeitpunkt, an dem die Bedingung gilt.

## 5. Handelsregeln (identisch für D und K)

| Element | Festlegung |
|---|---|
| Ereignis abgeschlossen | erste 5-Minuten-Kerze nach c₀, die das Extrem nicht erweitert. Bei Abwärtsereignissen liegt ihr Tief nicht unter dem Tief seit c₀ − 60 min, bei Aufwärtsereignissen ihr Hoch nicht über dem Hoch. Ihr Schluss ist der Entscheidungszeitpunkt c\* |
| Ohne Abschluss | kein Abschluss bis c₀ + 60 min: **kein Trade**, nur gezählt |
| Frühester Einstieg | Marktorder (Taker) zum Open der 1m-Kerze, die bei c\* + 1 min beginnt, also eine Minute Ausführungsverzögerung |
| Ausstieg | Marktorder zum Open der 1m-Kerze bei Einstieg + 60 min |
| Maximale Haltedauer | 60 Minuten |
| Stop | Abstand = \|ΔP(c₀)\|, also die Größe des auslösenden Schocks, vom Einstiegspreis aus. Geprüft auf jeder 1m-Kerze; ausgeführt zum Stoppreis oder, bei einer Lücke, zum schlechteren 1m-Open |
| Größe | fest 25 000 USD Notional, ungehebelt gerechnet. Rendite je Trade in % des Notionals, ohne Zinseszins |
| Überlappung je Symbol | Ab c₀ werden bis zum Ende des Trades (oder der Entscheidung „kein Trade“) plus 60 Minuten keine neuen Ereignisse desselben Symbols gezählt |
| Cluster über Symbole | Ereignisse von BTC und ETH, deren c₀ höchstens 60 Minuten auseinanderliegen, bilden ein Cluster. Statistik nur auf Cluster-Ebene, der Cluster-Wert ist der Mittelwert seiner Trades |

## 6. Kosten (Stress, nur Taker)

| Posten | Annahme je Seite |
|---|---|
| Gebühr | **6 bp**: höchster übliche Perp-Taker-Satz der untersten Stufe (Binance 5 bp, Bitget 6 bp) |
| Spread und Slippage im Ereignis | **BTC 5 bp, ETH 8 bp**: ein Mehrfaches des Normalwerts, weil nach Schocks gehandelt wird |
| Zuschlag bei Stop-Ausführung | weitere **5 bp** |
| Funding | tatsächliche Binance-Funding-Rate, falls ein Abrechnungszeitpunkt in die Haltedauer fällt; das Vorzeichen folgt der Richtung |
| Maker-Fills | **keine**; jeder Fill ist eine Marktorder, und jede Order gilt als ausgeführt, aber zum schlechteren Modellpreis |

- **Round-Trip mit Zeitausstieg:** BTC 22 bp, ETH 28 bp. Normal wären rund
  12 bp.
- **Kostenprüfung, nur in Richtung konservativer:**
  - Im Entdeckungsjahr 2023 wird mit `bookDepth` die Preiswirkung von
    25 000 USD während D- und K-Ereignissen geschätzt.
  - Liegt sie über der Annahme, wird die Annahme für beide Gruppen erhöht.
  - Sie wird nie gesenkt, und die Testperiode wird dafür nicht verwendet.
- **Spot-Sicht (nur beschreibend):** Long-Trades nach Abwärtsereignissen mit
  Spot-Kosten (28 bp Round-Trip plus Stresszuschlag). Das ist der Fall, falls
  nie ein Perp-Handelsplatz verfügbar wird.

## 7. Daten: konkret verfügbar (geprüft über Verzeichnislisten, ohne Download)

| Datentyp (`data.binance.vision`, USDⓈ-M) | Inhalt | BTCUSDT ab | ETHUSDT ab | Größe (Beispiel) | Rolle |
|---|---|---|---|---|---|
| `klines` 1m (monatlich) | OHLCV, Taker-Kaufvolumen | 2020-01 | 2020-01 | ~1,6–1,8 MB je Monat (2020) | Kurs, Ein- und Ausstieg, Stop |
| `metrics` (täglich) | 5-Minuten-Zeilen: `sum_open_interest`, Wert, Long/Short-Verhältnisse, Taker-Volumenverhältnis | **2020-09-01** | **2021-12-01** | klein | Auslöser |
| `aggTrades`, `trades` | jeder Handel mit Käufer/Verkäufer-Kennung | vorhanden | vorhanden | groß | nicht nötig im Primärtest |
| `bookDepth` (täglich) | **aggregierte** Orderbuchtiefe (Schema in 0.2 zu prüfen) | 2023-01-01 | 2023-01-01 | ~0,5 MB je Tag | Kostenprüfung 2023 |
| `bookTicker` (täglich) | bestes Bid/Ask je Änderung | 2023-05-16 | 2023-05-16 | ~47 MB je Tag (ETH) | nur Stichprobe, zu groß für die ganze Historie |
| `fundingRate` (monatlich) | Funding je Abrechnung | ab Kontraktstart | ab Kontraktstart | klein | Kosten |
| Liquidationsaufträge | **nicht im Archiv** | – | – | – | deshalb „Deleveraging“ statt „Liquidation“ |
| volles Orderbuch (L2-Snapshots/Diffs) | **nicht frei**, nur bei kommerziellen Anbietern | – | – | – | nicht verwendet |

- **Bewertung:** Für einen glaubwürdigen Test auf Ereignisebene reichen 1m-Kurse
  und 5-Minuten-OI.
- **Ausführung:** Sie ist für 2020–2022 nur mit festen Stresskosten
  modellierbar, ab 2023 mit Orderbuch-Aggregaten prüfbar. Echte
  Warteschlangen- oder Maker-Modelle sind mit freien Daten nicht möglich und
  werden deshalb nicht verwendet.
- **Lücken:** Ob `metrics` lückenlos ist, prüft Schritt 0.2 an den
  Verzeichnislisten. Stichproben (Oktober 2020, Januar 2021) waren
  vollständig.
- **Downloadumfang für den späteren Lauf:**
  - 1m-Klines beider Symbole 2020–2026: rund 0,3 GB;
  - `metrics`: < 0,1 GB;
  - `bookDepth` 2023 für beide Symbole: rund 0,4 GB.
  - Je Abruf ist eine Freigabe nötig.

## 8. Zeiträume

| | BTC | ETH |
|---|---|---|
| Normierungsvorlauf | 2020-09-01 bis 2020-09-30 | 2021-12-01 bis 2021-12-31 |
| **Entdeckung** | 2020-10-01 bis 2023-12-31 | 2022-01-01 bis 2023-12-31 |
| **Test (Holdout)** | 2024-01-01 bis 2026-09-30 | 2024-01-01 bis 2026-09-30 |

- **Parameter:** Alle stehen in diesem Dokument und werden nicht aus der
  Entdeckung gewählt.
- **Was die Entdeckung leistet:**
  - Prüfung der Datenqualität;
  - Kostenprüfung, nur in Richtung konservativer;
  - eine erste Auswertung mit derselben Regel.
- **Gesperrter Test:** Die Testperiode bleibt bis zum Abschluss der
  Entdeckung vollständig gesperrt, auch für das bloße Zählen von Ereignissen.
- **Änderungen:** Jede Änderung nach der Entdeckung ist eine V2. Sie wird vor
  dem Öffnen des Tests neu vorregistriert und darf sich nur auf
  Entdeckungsdaten stützen.

## 9. Primärer Test, Klassen, Abbruch

**Ein primärer Test, nur auf Cluster-Ebene:**

1. **Wirtschaftliche Bedingung:** Der mittlere Nettoertrag der D-Trades nach
   Stresskosten ist größer als 0.
2. **Statistische Prüfung:** Die Differenz Ø Netto(D) − Ø Netto(K) ist
   größer als 0.
   - K wird auf die Verteilung der Schockstärke von D umgewichtet, in drei
     Klassen \|z_P\|: 3–4, 4–6, > 6.
   - t aus einem Welch-Test auf Cluster-Mittelwerten, einseitig.

Beide Symbole gehen gemeinsam ein. Zusätzlich muss die Differenz in BTC und
ETH jeweils dasselbe, positive Vorzeichen haben.

| Klasse | Bedingung |
|---|---|
| `UNZUREICHEND` | weniger als **40 D-Cluster** oder weniger als 40 K-Cluster im Zeitraum. Die Schwellen werden dann **nicht** gesenkt |
| `NICHT_BESTANDEN` | Ø Netto(D) ≤ 0 |
| `NUR_KURSUMKEHR` | Ø Netto(D) > 0, aber die Differenz zu K ist ≤ 0 oder hat t < 2,0. Das ist die bekannte Umkehr, nicht spezifisch für Deleveraging |
| `UNEINHEITLICH` | Ø Netto(D) > 0, Differenz > 0 mit t ≥ 2,0, aber in BTC oder ETH ist die Differenz nicht positiv |
| `HINWEIS` | Ø Netto(D) > 0, Differenz > 0 mit t ≥ 2,0, gleiches positives Vorzeichen in BTC und ETH |
| `BELASTBAR` | wie `HINWEIS`, mit t ≥ √(2·ln N_neu); heute wären das N = 58 und 2,85 |

Geprüft wird in der Reihenfolge der Tabelle. Die erste zutreffende Klasse
gilt; jede Kombination führt so zu genau einer Klasse. Für ETH ist die
Entdeckung kürzer (OI erst ab 2021-12), deshalb sind dort weniger Ereignisse
zu erwarten.

**Ablauf und Abbruch:**

- Die Entdeckung wird zuerst klassifiziert. Nur bei `HINWEIS` oder
  `BELASTBAR` wird der Test geöffnet, mit unveränderter Regel.
- Bei `UNZUREICHEND`, `NICHT_BESTANDEN`, `NUR_KURSUMKEHR` oder `UNEINHEITLICH` endet die
  Studie. Der Test bleibt unberührt.
- Ein Vorzeichenwechsel im Test führt zu `NICHT_BESTANDEN`.
- **Datenabbruch vor jeder Renditeauswertung:** mehr als 5 % fehlende
  5-Minuten-OI-Punkte in einem Symbol, oder `create_time` ist nicht
  eindeutig bestimmbar.

**Weitere Berichte, nur beschreibend:** Long und Short getrennt, Anteil der
Stop-Ausstiege, Anteil „kein Trade“, Spot-Sicht sowie eine Variante mit 5
Minuten Ausführungsverzögerung. Sie entscheiden nichts.

## 10. Wie viele Beobachtungen nötig sind (Überschlag)

- **Unbekannt sind:** die Zahl der Ereignisse (die früher genannten
  100–300 sind **keine** gesicherte Größe) und die Streuung der
  60-Minuten-Nettorenditen nach Schocks. Grob geschätzt liegt die Streuung
  bei 1,2–1,5 %; normal sind 0,6 % je Stunde.
- **Nachweisbare Differenz D − K** bei einer Streuung von 1,3 % und t = 2
  (gleich viele Cluster je Gruppe):
  - **50 bp** brauchen rund 55 Cluster je Gruppe;
  - **30 bp** rund 150;
  - **20 bp** rund 340.
- **Folge:** Realistisch prüfbar sind nur große, wirtschaftlich relevante
  Vorteile. Die stehen bei 22–28 bp Round-Trip ohnehin im Mittelpunkt. Ein
  kleiner Vorteil bleibt bei dieser Datenlage unentscheidbar. Die
  Mindestzahl von 40 Clustern ist eine Untergrenze für überhaupt eine
  Aussage, keine Garantie für Teststärke.

## 11. Handelsplatz

- **Bitget:** gesperrt für Deutschland (ADR 0007). Laut Sekundärquellen im
  Oktober 2026: „Prohibited Country“, Neuregistrierungen seit 2026-01-16
  geschlossen, keine MiCA-Lizenz.
- **Forschung:** Sie nutzt Binance-Daten nur als Marktdatenquelle und braucht
  keinen Handelsplatz.
- **Umsetzung:** Jede spätere Umsetzung setzt einen gesondert nachgewiesenen,
  für ein deutsches Konto legal und praktisch nutzbaren Perp-Handelsplatz
  voraus, mit seinen tatsächlichen Gebühren. Ohne ihn gilt nur die Spot-Sicht
  (Abschnitt 6).
- **Nicht geplant:** keine Börsenanbindung, kein Live-Handel, kein
  Shadow-Portfolio.

## 12. Ablauf

1. **0.1 dieser Entwurf** (erledigt).
2. **0.2 Datenprüfung**, mit Freigabe für je eine Beispieldatei (`metrics`
   und `bookDepth`, zusammen < 1 MB) und vollständige Verzeichnislisten:
   - Bedeutung von `create_time`;
   - Lücken;
   - Schema von `bookDepth`.
3. **0.3 Entscheidungen G1–G5**, danach Einfrieren (Commit und Blob-Hash).
4. **1.1 Auswertungsskript**, getestet nur mit synthetischen Reihen.
5. **1.2 Download** (rund 0,7 GB, Freigabe) und **Entdeckungslauf** mit
   Klasse.
6. **1.3 Testlauf**, nur bei `HINWEIS` oder `BELASTBAR`, mit eigener
   Freigabe.

Aufwand: rund eine bis zwei Wochen Arbeitssitzungen.

## 13. Entscheidungen des Betreibers vor dem Einfrieren

| # | Entscheidung | Vorschlag | Alternative |
|---|---|---|---|
| G1 | Haltedauer und Fenster | **60 min / 60 min** | 30 min / 30 min (mehr Ereignisse, mehr Kostenanteil) |
| G2 | Schwellen | **\|z_P\| ≥ 3, z_OI ≤ −3, Kontrolle z_OI ≥ −1** | z_OI ≤ −2,5 (mehr D-Ereignisse, weniger trennscharf) |
| G3 | Stresskosten | **wie Abschnitt 6** | Gebühr 5 bp (Binance) statt 6 bp |
| G4 | Mindestzahl Cluster | **40 je Gruppe und Zeitraum** | 60 (strenger, häufiger `UNZUREICHEND`) |
| G5 | Mehrfachtest-Zähler | **N bleibt 57, D8 zählt mit der Auswertung** | N 57 → 58 beim Einfrieren |

## 14. Was unverändert bleibt

- `OFFICIAL_V1`, Champion, Challenger, Risk Engine (`risk-rules-v1/1.4.0`),
  Arena, Gates v1–v4, Evolution, D1-Entwurf, D6 (eingefroren), D7 (Entwurf).
- `main`, VPS, Datenbanken.
- Dieser Entwurf hat nur öffentliche Verzeichnislisten und Dokumentation
  gelesen. Er hat keine Marktdaten bezogen und nichts ausgewertet.
