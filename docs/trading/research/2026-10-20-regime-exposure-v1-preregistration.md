# Vorregistrierung `REGIME_EXPOSURE_V1` (D6): BTC nur in `RISK_ON` gegen risikogleiches passives BTC

> **Status: ENTWURF Phase 0, nicht eingefroren.** Erstellt am 2026-10-20 auf
> `claude/inspiring-noether-rjh92d`.
>
> - Kein Backtest, keine Renditeberechnung, keine Parameteroptimierung, kein
>   Download und kein KI-Lauf (0 USD). Die einzigen Zahlen aus der Historie
>   sind bereits dokumentiert, oder es sind beschreibende Zählungen ohne
>   Renditen (Abschnitt 9).
> - An `OFFICIAL_V1`, Champion, Challenger, Risk Engine, Arena, Gates, `main`
>   und VPS wird nichts geändert. Es gibt kein neues Shadow-Portfolio und
>   keinen Trading-Code.
> - Der Mehrfachtest-Zähler bleibt **N = 57**, bis E6 entschieden ist.
> - Der Entwurf [`RISK_BUDGET_V1` (D1)](2026-10-18-risk-budget-v1-preregistration.md)
>   bleibt unverändert.
> - Keine Handels-, Anlage- oder Steuerberatung.

## Kurz und verständlich

- **Frage:** Ist BTC nur in `RISK_ON` zu halten, mit volatilitätsbasierter
  Größe, wirtschaftlich besser als eine passive BTC-Anlage mit demselben
  Risiko oder derselben Kapitalbindung?
- **Mehr Rendite durch mehr Risiko zählt nicht.** Verglichen wird gegen zwei
  passive Referenzen, die dasselbe Risiko bzw. dieselbe mittlere
  Kapitalbindung tragen. Nur was dann übrig bleibt, ist ein Vorteil des
  Timings.
- **Getestet wird nur auf künftigen Daten.** BTC/ETH 2018–2026 sind verbraucht
  und gelten nicht als Test.
- **Ehrliche Erwartung:**
  - Der Mechanismus (Trendfilter auf einem einzelnen Asset) ist bekannt.
  - Wahrscheinlich ist eine geringere Verlusttiefe ohne nachweisbar bessere
    risikobereinigte Rendite.
  - Eine vorläufige Aussage braucht mindestens drei Jahre und zwei
    Abwärtsphasen. Eine statistisch belastbare Aussage dauert voraussichtlich
    Jahrzehnte (Abschnitt 9).
- **Aufwand:** ein eingefrorenes Auswertungsskript, getestet nur mit
  synthetischen Daten; danach ein lesender Lauf pro Quartal.

## 1. Abgrenzung

| | `RISK_BUDGET_V1` (D1) | `CRYPTO_REGIME_LONG_V1` (Challenger) | `REGIME_EXPOSURE_V1` (D6, dieses Dokument) |
|---|---|---|---|
| Frage | Verteilt ein portfolioweites Budget dieselben Trades besser? | Liefert das Gate als Trade-Strategie einen Vorteil? | Liefert das Gate als **Expositionsregel** einen Vorteil gegenüber risikogleichem passivem BTC? |
| Größe | Risiko je Trade (Stop-basiert) | 0,25 % Risiko je Trade, rund 2,8 % Notional | Zielvolatilität des Portfolios |
| Ausstieg | wie die Strategien | Regime, Stop, 4R-Ziel, 30 Tage | **nur** Regime oder Drawdown-Grenze |
| Daten | Historie (Replay) | Forward in `OFFICIAL_V1` | **nur Forward**, eigene Auswertung |

D6 nutzt dasselbe Gate wie der Challenger, aber ohne Stop, Kursziel und festes
Risiko je Trade. Damit misst D6 den Wert des Gates selbst und nicht die
Trade-Regeln um ihn herum.

## 2. Forschungsfrage und Hypothesen

**Frage:** Erzielt die Regel S (Abschnitt 3) nach allen Kosten eine höhere
risikobereinigte Überschussrendite als die passiven Referenzen R1 und R2
(Abschnitt 4)?

- **H0:** S ist nicht besser als R2, gleiche mittlere Kapitalbindung, oder
  nicht besser als R1, gleiche Volatilitätssteuerung ohne Gate. Ein kleinerer
  Drawdown von S erklärt sich allein durch weniger Exposition.
- **H1:** S hat eine höhere Sharpe Ratio als R2 **und** als R1. In jeder
  gezählten Abwärtsphase verliert S höchstens die Hälfte dessen, was R1
  verliert.

**Was als Vorteil gilt und was nicht:**

| Ergebnis | Bedeutung |
|---|---|
| S > R2 und S > R1, Schutz in Abwärtsphasen | Timing-Wert des Gates (Kandidat für einen Vorteil) |
| S ≈ R2 | **bekannte Marktexposition anders verpackt**: Ein fester BTC-Anteil leistet dasselbe, billiger |
| S ≈ R1, beide > 100 % BTC | Nutzen kommt aus der Volatilitätssteuerung, nicht aus dem Regime |
| S kleiner als R1 oder R2 | Das Gate kostet mehr, als es schützt |

## 3. Regel S (fest, nicht optimiert)

Alle Werte sind entweder aus eingefrorenen Bausteinen übernommen oder runde
Standardwerte, die vor jedem Datenblick festgelegt wurden. Keiner wurde an
2018–2026 angepasst.

| Element | Festlegung | Herkunft |
|---|---|---|
| Instrument | BTCUSDT Spot, nur long, kein Hebel, keine Derivate | wie `OFFICIAL_V1` |
| Gate | `crypto-native-regime-v1/1.0.0` unverändert: `cryptoRegime = RISK_ON`, Risk Mode nicht `DEFENSIVE`/`HIGH_RISK`/`UNKNOWN`, Konfidenz ≥ 60 | eingefroren (Challenger) |
| Entscheidungszeit | täglich 01:05 UTC, auf dem Regime aus der Tageskerze, die um 00:00 UTC geschlossen hat | 1 h Puffer für den Daten-Worker |
| Ausführung | Marktorder zum Open der 1h-Kerze um 02:00 UTC, also der ersten vollen Stunde nach der Entscheidung | kein Lookahead, keine Fills innerhalb der Entscheidungskerze |
| Einstieg | Gate offen und S flach: Zielexposition aufbauen | – |
| Ausstieg | Gate geschlossen: alles verkaufen. Kein Stop, kein Kursziel, keine Zeitgrenze | – |
| Größe | Zielexposition E = min(E_max, σ\* ÷ σ_BTC) als Anteil der Equity | σ\*, E_max: E1 |
| Volatilität σ_BTC | Standardabweichung der 20 letzten täglichen Log-Renditen von BTC (Schlusskurse), × √365 | 20 Tage wie Momentum und Volatilität im Regime-Modell; **nicht** die Funktion `volatility20` des Regime-Pakets, denn sie skaliert mit √252 |
| Anpassung | täglich prüfen, nur handeln, wenn \|E_Ziel − E_ist\| > 25 % von E_Ziel | runder Wert, wirkt nur auf die Kosten |
| Drawdown-Grenze | Equity von S mindestens D_max unter ihrem Höchststand seit Testbeginn (Tagesschluss): flat, Pause bis zur dokumentierten Entscheidung des Betreibers. Der Verlust bleibt im Ergebnis | D_max: E2 |
| Außerhalb `RISK_ON` | 100 % Kasse, verzinst nach Abschnitt 5 | – |

## 4. Referenzen (vorab festgelegt)

Alle Referenzen werden mit denselben Daten, Ausführungszeiten, Kosten und
derselben Kassenverzinsung gerechnet.

| Referenz | Regel | Wozu |
|---|---|---|
| **R1: Halten mit gleicher Volatilitätssteuerung** | immer investiert, E = min(E_max, σ\* ÷ σ_BTC), gleiche Anpassungsregel, kein Gate | passives BTC mit vergleichbarem Risikobudget. **Isoliert den Wert des Gates** |
| **R2: konstanter BTC/Kasse-Mix** | fester BTC-Anteil w = mittlere Exposition von S im Testfenster (nachträglich angeglichen), monatlich am 1. um 02:00 UTC zurückgesetzt | passive Allokation mit gleicher Kapitalbindung. **Isoliert den Timing-Wert** gegenüber bloß weniger Exposition |
| R0: 100 % BTC halten | einmal kaufen, nie verkaufen | nur Kontext, keine Entscheidungsgrundlage |

R2 wird zusätzlich volatilitätsgleich zu S berichtet. Die Sharpe Ratio
hängt nicht vom Anteil ab; die Angleichung macht nur Rendite und Drawdown
vergleichbar.

## 5. Kosten, Kasse, Steuern

- **Handelskosten:** Kostenprofil `BINANCE_SPOT_VIP0_ESTIMATE_V1` unverändert,
  also 10 bp Gebühr, 1 bp halber Spread und 3 bp Slippage, zusammen 14 bp je
  Seite. Das gilt für jede Transaktion von S, R1, R2 und R0.
- **Kasse:** Primär wird mit dem 3-Monats-T-Bill (FRED `DTB3`, täglich,
  act/360) verzinst, wie in den bisherigen Studien. Zusätzlich wird mit 0 %
  berichtet; das entspricht USDT auf der Börse und dem heutigen Shadow.
  Überschussrenditen beziehen sich auf `DTB3`.
- **Steuern (nur sekundär, beschreibend):**
  - S hält jede Position kürzer als ein Jahr; die Phasen dauern im Median 4,
    im Mittel 12 Tage.
  - Für ein deutsches Privatkonto wären Gewinne aus S damit voll steuerpflichtig.
  - R0 über mehr als ein Jahr gehalten wäre nach heutiger Rechtslage
    steuerfrei.
  - Der Bericht nennt deshalb immer auch eine Überschlagsrechnung nach
    Steuern. Ein Vorteil vor Steuern, der nach Steuern verschwindet, ist
    wirtschaftlich keiner.

## 6. Daten, Lücken, Verzögerungen

- **Daten:** BTCUSDT und ETHUSDT 1d und 1h von Binance Spot, wie
  `OFFICIAL_V1`. ETH dient nur dem Regime. Bezogen wird lesend aus der
  VPS-Datenbank oder aus dem öffentlichen Archiv, mit eigener Freigabe je
  Abruf.
- **Fehlende Entscheidungsdaten** (Tageskerze oder Regime fehlt oder ist
  älter als 26 h, wie `maxRegimeAgeMs`): Der Zustand bleibt. Die Prüfung wird
  stündlich bis 23:05 UTC wiederholt. Fehlen die Daten länger als 72 h,
  geht S flach (Fail-safe). Das wird protokolliert.
- **Fehlende 1h-Kerze bei der Ausführung:** Ausgeführt wird zum Open der
  nächsten vorhandenen Kerze. Es gibt keinen Fill zu einem vergangenen Preis.
- **Kurslücken:** Es gibt keine Stops innerhalb einer Kerze, Lücken wirken
  nur über den nächsten Open. Die Drawdown-Grenze wird auf Tagesschlüssen
  geprüft und zur nächsten Ausführungszeit umgesetzt. **N2 betrifft S
  deshalb nicht.**
- **Ausfälle:** Sie werden notiert, nicht aufgefüllt (Regel 3 des
  Forward-Tests). Verpasste Ausführungen holt der nächste mögliche Termin
  nach, ohne Rückdatierung.

## 7. Testdesign

- **Testbeginn:** 2026-12-01 00:00 UTC, wenn dieses Dokument und der Hash des
  Auswertungsskripts bis 2026-11-24 eingefroren sind. Sonst gilt der erste
  Monatserste, der mindestens 7 Tage nach beidem liegt. Vorher berechnete
  Werte zählen nie.
- **Bewertungseinheiten** (objektiv, vom Gate unabhängig):
  - Abgeschlossene `RISK_ON`-Phasen, also Einstieg und Ausstieg von S.
  - **Abwärtsphasen von BTC:** Der Tagesschluss liegt mindestens 35 % unter
    dem höchsten Tagesschluss der vorangegangenen 365 Tage. Eine Phase endet,
    wenn der Abstand wieder unter 20 % fällt. Sie zählt nur, wenn sie
    mindestens 30 Tage dauert **und nach Testbeginn beginnt**.
  - **Laufende Phase:** Seit 2026-01-31 läuft eine Abwärtsphase, die
    beschreibende Zählung zeigt bis −53 %. Sie zählt nicht als Einheit, auch
    wenn sie über den Testbeginn hinaus andauert. Ihr Rest wird ganz normal
    in die Kennzahlen eingerechnet.
- **Mindestdauer** für ein vorläufiges Urteil, alle Bedingungen zusammen:
  36 Monate, mindestens 2 abgeschlossene Abwärtsphasen von BTC und mindestens
  15 abgeschlossene `RISK_ON`-Phasen.
- **Kennzahlen:**
  - Sharpe Ratio der täglichen Überschussrenditen.
  - Maximaler Drawdown und Calmar Ratio.
  - Verlust je Abwärtsphase vom Höchst- zum Tiefststand, S gegen R1.
  - Kosten, Umschlag und Zeit im Markt.
  - Rendite nach Steuern (Überschlag).
- **Lange Phasen ohne Einstieg** sind kein Fehler, historisch bis 421 Tage.
  Sie sind auch kein Abbruchgrund. S verdient dann den Kassenzins und wird
  weiter gegen R1 und R2 gemessen. Es gibt keine Regeländerung, um
  Einstiege zu erzeugen.
- **Quartalsberichte** sind nur beschreibend. Sie tragen den Vermerk
  „vorläufig, keine Aussage“, bis die Mindestdauer erreicht ist.

## 8. Kriterien, Klassen, Abbruch

Geprüft wird in dieser Reihenfolge; das entscheidende Kriterium kommt zuerst.

1. **P1 Timing gegen bloße Exposition:** Sharpe(S) > Sharpe(R2).
2. **P2 Gate gegen Volatilitätssteuerung:** Sharpe(S) > Sharpe(R1).
3. **P3 Schutz:** In jeder gezählten Abwärtsphase ist der Verlust von S
   höchstens 50 % des Verlusts von R1.

| Klasse | Bedingung |
|---|---|
| `TIMING_VORTEIL_VORLÄUFIG` | P1, P2 und P3 bestanden |
| `NUR_SCHUTZ` | P3 bestanden, P1 oder P2 nicht: weniger Verlust, aber keine bessere risikobereinigte Rendite, also bekannte Exposition anders verpackt |
| `NUR_VOLATILITÄTSSTEUERUNG` | P1 bestanden, P2 nicht |
| `KEIN_VORTEIL` | P1 nicht bestanden und P3 nicht bestanden |
| `BELASTBAR` (Zusatz) | nur zusätzlich zu `TIMING_VORTEIL_VORLÄUFIG`: Information Ratio S gegen R1 mit t ≥ 2,84 (Schwelle für N = 57; bei geändertem N neu berechnet), tägliche Differenzrenditen, stationärer Block-Bootstrap mit mittlerer Blocklänge 20 Tage |

**Abbruch und Halt:**

- **Technischer Fehler:** pausieren und als versionierter Bugfix beheben,
  ohne jede Regeländerung. Die Pause wird protokolliert.
- **Drawdown-Grenze erreicht:** S geht flat. Die Fortsetzung entscheidet der
  Betreiber dokumentiert; der Verlust bleibt im Ergebnis.
- **Aussichtslosigkeit:** Ist nach 24 Monaten Sharpe(S) um mindestens 0,5
  kleiner als Sharpe(R2) **und** liegt mindestens eine Abwärtsphase vor, in
  der P3 verfehlt wurde, endet der Test vorzeitig mit `KEIN_VORTEIL`.
- **Kein vorzeitiger Erfolg:** Vor der Mindestdauer gibt es weder eine
  Echtgeldentscheidung noch eine Aussage über Profitabilität.

## 9. Wie lange bis zu einer Aussage (Überschlag, keine Messung)

- **Häufigkeit der Phasen** (beschreibende Zählung auf den lokalen
  Tageskerzen, ohne Renditen, bereits bekannt):
  - `RISK_ON` an 30 % der Tage, rund 9 Phasen pro Jahr, Dauer im Median 4,
    im Mittel 12 Tage.
  - Pausen ohne `RISK_ON` bis 421 Tage.
  - Abwärtsphasen von BTC im Sinne von Abschnitt 7 (beschreibende Zählung
    nur auf BTC-Schlusskursen, 2018-08 bis 2026-10):
    - sechs Phasen: 2018/19, 2019/20, 2021, 2021 (nur 14 Tage, zählt künftig
      nicht), 2022/23 und eine seit 2026-01-31 noch offene;
    - das sind fünf zählbare in rund acht Jahren, also etwa eine alle 1,5
      Jahre;
    - zwei zählbare Phasen nach Testbeginn sind deshalb realistisch erst nach
      drei bis fünf Jahren erreicht.
- **Statistik:** Die t-Statistik einer Information Ratio IR wächst mit √T.
  Für t ≥ 2,84 braucht es T ≈ (2,84 ÷ IR)² Jahre.
  - Bei IR 1,0: rund 8 Jahre.
  - Bei IR 0,5: rund 32 Jahre.
  - Bei IR 0,3: rund 90 Jahre.

  Ein IR von 1,0 gegen eine risikogleiche passive Anlage wäre außergewöhnlich
  hoch.
- **Folge:** Vorläufig ist eine Aussage frühestens nach rund drei Jahren und
  zwei Abwärtsphasen, realistisch nach drei bis fünf Jahren. Statistisch
  belastbar wird sie in einem praktisch relevanten Zeitraum voraussichtlich
  nicht. Ein schnellerer Nachweis wird nicht versprochen.

## 10. Ist das ein Handelsvorteil oder verpackte BTC-Exposition?

- **Überwiegend verpackte Exposition, bis das Gegenteil gezeigt ist.**
  - Trendfilter wie „Kurs über dem 200-Tage-Schnitt“ sind öffentlich
    bekannt.
  - Ihr dokumentierter Nutzen ist vor allem eine geringere Verlusttiefe in
    langen Abwärtsphasen, kein Mehrertrag bei gleichem Risiko.
  - Unsere eigenen Zahlen sind in-sample. Das Gate senkte den Drawdown von
    BTC etwa auf die Hälfte, bei ähnlicher Rendite wie Kaufen und Halten. Es
    gab nur einen vollständig vermiedenen Bärenmarkt (2022).
- **Was D6 trotzdem leistet:** D6 trennt sauber zwischen Timing-Wert,
  Volatilitätssteuerung und bloß weniger Exposition (P1–P3). Das ist die
  Frage, an der jede weitere Arbeit am Regime-Ansatz hängt.
- **Wirtschaftlich gilt nach Steuern:** Für ein deutsches Privatkonto ist ein
  gehaltener BTC-Anteil strukturell im Vorteil. S muss vor Steuern
  deutlich vorn liegen, um nach Steuern gleichzuziehen.
- **Empfehlung für den Aufwand:** D6 als günstige Langzeitbeobachtung
  einfrieren, mit Skript, Synthetik-Tests und Quartalslauf, aber **nicht**
  als Forschungsrichtung, an der monatelang aktiv gearbeitet wird. Die
  Zwischenzeit gehört Fragen mit eigenem, unabhängigem Ertragsmechanismus.

## 11. Spätere Umsetzung (jeweils eigene Freigabe)

1. **Auswertungsskript**, Version `regime-exposure-eval-v1`:
   - rechnet S, R0, R1 und R2 täglich aus Kerzen und `DTB3`;
   - deterministisch, ohne Zugriff auf Handelssysteme;
   - Tests nur mit synthetischen Kursreihen;
   - **kein Lauf auf 2018–2026**, auch nicht als Plausibilitätscheck, damit
     nichts nachjustiert werden kann;
   - Hash vor Testbeginn festhalten.
2. **Quartalslauf:** Daten lesend beschaffen (je Abruf freigegeben),
   Skript ausführen, Bericht als „vorläufig“ ablegen.
3. **Shadow-Portfolio (optional, später):** Dafür bräuchte S eine eigene,
   expositionsbasierte Risikologik. Die bestehende Risk Engine verlangt Stop
   und Mindest-CRV, sie passt nicht. Es ist für die Forschungsfrage nicht
   nötig.

Der Aufwand für Schritt 1 liegt bei rund einer bis zwei Arbeitssitzungen,
danach etwa eine Stunde pro Quartal.

## 12. Entscheidungen des Betreibers vor dem Einfrieren

| # | Entscheidung | Vorschlag | Alternative |
|---|---|---|---|
| E1 | Zielvolatilität σ\* und Obergrenze E_max | **σ\* = 20 % p. a., E_max = 0,5**: bei 50–80 % BTC-Volatilität rund 25–40 % Exposition | σ\* = 30 %, E_max = 1,0 (mehr Exposition, gleiche Sharpe) |
| E2 | Drawdown-Grenze D_max | **20 %** vom Höchststand | 30 % (greift seltener, mehr Verlust) |
| E3 | Kassenzins | **`DTB3` primär, 0 % zusätzlich** | nur 0 % (heutiger Shadow) |
| E4 | Testbeginn | **2026-12-01 nach der Regel aus Abschnitt 7** | 2027-01-01 fest |
| E5 | Form der Bewertung | **eingefrorenes Skript** | zusätzlich ein Shadow-Portfolio (deutlich mehr Aufwand) |
| E6 | Mehrfachtest-Zähler | **N 57 → 58 beim Einfrieren**: eine neue Hypothese, auch wenn sie nur forward geprüft wird | N bleibt 57, weil kein historischer Test stattfindet |
| E7 | Steuerausweis | **Überschlag nach Steuern immer mitberichten** | nur vor Steuern |

## 13. Was unverändert bleibt

- `OFFICIAL_V1`, Champion, Challenger, Risk Engine (`risk-rules-v1/1.4.0`),
  Arena, Gates v1–v4, Evolution.
- `RISK_BUDGET_V1` (D1) als eigener Entwurf.
- `main`, VPS, Datenbanken.
- Dieser Entwurf hat nur Code und Berichte genutzt, dazu zwei beschreibende
  Zählungen auf den lokalen Tageskerzen: Regime-Phasen und BTC-Abwärtsphasen,
  ohne Strategie- oder Referenzrenditen. Er hat keine Forward-Daten
  ausgewertet.
