# Vorregistrierung `REGIME_EXPOSURE_V1` (D6): BTC nur in `RISK_ON` gegen risikogleiches passives BTC

> **Stand 2026-10-20: Fassung zum Einfrieren, Entscheidungen E1–E7 des
> Betreibers eingearbeitet (Abschnitt 12).**
>
> - Erstellt auf `claude/inspiring-noether-rjh92d`.
> - Kein Backtest, keine Renditeberechnung, keine Parameteroptimierung, kein
>   Download, kein KI-Lauf (0 USD). Aus der Historie stammen nur bereits
>   dokumentierte Zahlen und zwei beschreibende Zählungen ohne Renditen
>   (Abschnitt 9).
> - An `OFFICIAL_V1`, Champion, Challenger, Risk Engine, Arena, Gates, `main`
>   und VPS ändert sich nichts. Kein Shadow-Portfolio, kein Trading-Code.
> - **Registerstatus: vorregistriert, nicht ausgewertet.** Der
>   Mehrfachtest-Zähler bleibt **N = 57** (E6).
> - Der Entwurf [`RISK_BUDGET_V1` (D1)](2026-10-18-risk-budget-v1-preregistration.md)
>   bleibt unverändert.
> - Jede spätere inhaltliche Änderung ist eine V2. Sie wird nie mit V1
>   vermischt und darf sich nicht auf Forward-Daten stützen.
> - Keine Handels-, Anlage- oder Steuerberatung.

## Kurz und verständlich

- **Frage:** Ist BTC nur in `RISK_ON` zu halten, mit volatilitätsbasierter
  Größe, wirtschaftlich besser als passives BTC mit derselben
  Volatilitätssteuerung (R1) oder mit einem festen, vorab bestimmten
  BTC-Anteil (R2)?
- **Mehr Rendite durch mehr Risiko zählt nicht.** Entschieden wird über die
  Sharpe Ratio und über Verluste in Abwärtsphasen, nicht über die absolute
  Rendite.
- **Gezählt werden nur Daten und Entscheidungen ab dem 01.12.2026.**
  BTC/ETH 2018–2026 sind verbraucht und gelten nicht als Test.
- **Ehrliche Erwartung:**
  - Der Mechanismus, ein Trendfilter auf einem einzelnen Asset, ist bekannt.
  - Wahrscheinlich ist eine geringere Verlusttiefe ohne nachweisbar bessere
    risikobereinigte Rendite.
  - Eine vorläufige Aussage gibt es frühestens nach drei Jahren und zwei
    Abwärtsphasen. Statistisch belastbar wird sie voraussichtlich nie in
    einem praktisch relevanten Zeitraum (Abschnitt 9).
- **Aufwand:** später ein kleines, deterministisches Beobachtungsskript,
  danach ein lesender Lauf pro Quartal.

## 1. Abgrenzung

| | `RISK_BUDGET_V1` (D1) | `CRYPTO_REGIME_LONG_V1` (Challenger) | `REGIME_EXPOSURE_V1` (D6) |
|---|---|---|---|
| Frage | Verteilt ein portfolioweites Budget dieselben Trades besser? | Liefert das Gate als Trade-Strategie einen Vorteil? | Liefert das Gate als **Expositionsregel** einen Vorteil gegenüber passivem BTC? |
| Größe | Risiko je Trade (Stop-basiert) | 0,25 % Risiko je Trade, rund 2,8 % Notional | Zielvolatilität 20 %, höchstens 50 % BTC |
| Ausstieg | wie die Strategien | Regime, Stop, 4R-Ziel, 30 Tage | **nur** Regime oder Drawdown-Grenze |
| Daten und Form | Historie (Replay) | Forward in `OFFICIAL_V1` | **nur Forward**, eigenes Beobachtungsskript |

D6 nutzt dasselbe Gate wie der Challenger, aber ohne Stop, Kursziel und festes
Risiko je Trade. D6 misst also den Wert des Gates selbst.

## 2. Forschungsfrage und Hypothesen

**Frage:** Erzielt S (Abschnitt 3) nach allen Kosten eine höhere
risikobereinigte Rendite als R1 und R2 (Abschnitt 4)?

- **H0:** S ist nicht besser als R2 oder nicht besser als R1. Ein kleinerer
  Drawdown von S erklärt sich allein durch weniger Exposition.
- **H1:** S hat eine höhere Sharpe Ratio als R2 **und** als R1. In jeder
  gezählten Abwärtsphase verliert S höchstens die Hälfte dessen, was R1
  verliert.

| Ergebnis | Bedeutung |
|---|---|
| S > R2 und S > R1, Schutz in Abwärtsphasen | Timing-Wert des Gates (Kandidat für einen Vorteil) |
| S ≈ R2 | **bekannte Marktexposition anders verpackt**: Ein fester BTC-Anteil leistet dasselbe |
| S ≈ R1 | Der Nutzen kommt aus der Volatilitätssteuerung, nicht aus dem Regime |
| S kleiner als R1 oder R2 | Das Gate kostet mehr, als es schützt |

## 3. Regel S (eingefroren)

Alle Werte sind aus eingefrorenen Bausteinen übernommen, vom Betreiber
entschieden (E1–E7) oder runde Standardwerte, die vor jedem Datenblick
feststanden. Keiner ist an 2018–2026 angepasst.

### 3.1 Zeitpunkte und Informationsstand

- **Entscheidung:** täglich an Tag D um 01:05 UTC.
- **Bekannte Informationen** zu diesem Zeitpunkt, und nur diese:
  - Tageskerzen BTCUSDT und ETHUSDT mit `closeTime` ≤ D 00:00 UTC, also bis
    einschließlich Tag D−1.
  - Der Zustand von S (Bestand, Kasse, Sperre) und die Equity zum
    Tagesschluss von D−1.
  - Für die Sensitivitätsrechnung nach Abschnitt 5 der letzte vor dem
    Entscheidungszeitpunkt veröffentlichte `DTB3`-Wert.
- **Ausführung:** Marktorder zum Open der 1h-Kerze D 02:00 UTC. Dieser Preis
  fließt in keine Entscheidung ein. Keine Stunden- oder Intraday-Daten dienen
  als Signal.
- **Rückschau vor Testbeginn:** Vorlaufdaten (200 Tage Regime, 20 Tage
  Volatilität) dürfen vor dem 01.12.2026 liegen. Es zählen aber nur
  Entscheidungen und Renditen ab dem Testbeginn (Abschnitt 7).

### 3.2 Gate, Größe, Anpassung

| Element | Festlegung | Herkunft |
|---|---|---|
| Instrument | BTCUSDT Spot, nur long, kein Hebel, keine Derivate. Mengen beliebig teilbar, ohne Mindestorder | wie `OFFICIAL_V1`; Vereinfachung gilt für alle Varianten gleich |
| Gate | `calculateCryptoNativeRegimeReport` aus `packages/market-regime` (`crypto-native-regime-v1/1.0.0`) auf den bekannten Tageskerzen nach 3.1. Offen, wenn `cryptoRegime = RISK_ON`, der Risk Mode nicht `DEFENSIVE`/`HIGH_RISK`/`UNKNOWN` ist und die Konfidenz ≥ 60. Das Skript rechnet das Regime selbst; produktive `MarketRegimeSnapshot`-Zeilen werden nicht verwendet | eingefroren (Challenger) |
| Volatilität σ_BTC | Stichproben-Standardabweichung der 20 letzten täglichen Log-Renditen der BTC-Schlusskurse (21 Schlusskurse bis D−1), × √365 | E1; bewusst **nicht** `volatility20` des Regime-Pakets, das mit √252 skaliert |
| Zielexposition | E_Ziel = min(0,5, 0,20 ÷ σ_BTC) als Anteil der Equity | E1 |
| Einstieg | Gate offen, S flach und nicht gesperrt: Kauf auf E_Ziel | – |
| Ausstieg | Gate geschlossen: Verkauf des gesamten Bestands. Kein Stop, kein Kursziel, keine Zeitgrenze | – |
| Anpassung | nur bei offenem Gate und Bestand > 0: handeln, wenn \|E_Ziel − E_ist\| > 0,25 × E_Ziel. E_ist ist der BTC-Wert ÷ Equity zum Schluss von D−1. Gehandelt wird auf E_Ziel | runder Wert, wirkt nur auf die Kosten |
| Außerhalb `RISK_ON` | 100 % Kasse | – |

### 3.3 Drawdown-Grenze (E2)

1. **Bewertung:** Die Equity von S wird täglich zum Tagesschluss bewertet
   (Bestand × BTC-Schlusskurs + Kasse). Die Referenz ist der Höchststand
   seit dem letzten Referenzbeginn; der erste Referenzbeginn ist der
   Testbeginn mit Equity 1,0.
2. **Auslösung:** Liegt die Equity zum Schluss von D−1 bei höchstens 80 % der
   Referenz, wird zur Ausführung D 02:00 der gesamte Bestand verkauft. S ist
   ab dann **gesperrt** und steigt nicht ein, auch wenn das Gate offen ist.
3. **Wiedereintritt**, automatisch und ohne Ermessen:
   - Die Sperre endet erst, wenn das Gate nach der Auslösung an mindestens
     einem Entscheidungstag geschlossen war.
   - Danach wird beim nächsten Entscheidungstag mit offenem Gate regulär
     eingestiegen (3.2).
   - Mit diesem Einstieg beginnt eine neue Referenz, Startwert ist die
     Equity zum Schluss von D−1.
   - Ein Wiedereintritt in derselben `RISK_ON`-Phase ist ausgeschlossen.
4. **Höchstens zwei Auslösungen im ganzen Test.** Nach der zweiten bleibt S
   bis zum Testende in Kasse. Alle Kennzahlen werden mit dem tatsächlichen
   Pfad von S weitergerechnet.
5. **Keine Anpassung:** Die Grenze, der Wiedereintritt und die Zahl der
   Auslösungen werden nie anhand von Ergebnissen geändert. Eine Änderung wäre
   V2.

Die Equity für die Auslösung enthält keine fiktiven Liquidationskosten
(Abschnitt 5). Weil die Kasse nicht sinkt, kann die Grenze nur mit Bestand
ausgelöst werden.

## 4. Referenzen (eingefroren)

Alle Referenzen nutzen dieselben Daten, Zeitpunkte, Kosten und denselben
Kassenzins wie S.

| Referenz | Regel | Wozu |
|---|---|---|
| **R1: Halten mit gleicher Volatilitätssteuerung** | immer investiert, E_Ziel und Anpassung wie S (3.2), kein Gate, **keine** Drawdown-Grenze; erster Kauf am 01.12.2026 um 02:00 | passives BTC mit vergleichbarem Risikobudget. **Isoliert den Wert des Gates** |
| **R2: fester BTC/Kasse-Mix** | **w = 10 % BTC, vor Testbeginn festgelegt und nie angepasst**. Zurückgesetzt wird monatlich zur Ausführung am 1. um 02:00 UTC, der erste Kauf ist am 01.12.2026 um 02:00 | passive Allokation mit vergleichbarer Kapitalbindung. **Isoliert den Timing-Wert** gegenüber bloß weniger Exposition |
| R0: 100 % BTC halten | einmal kaufen am 01.12.2026 um 02:00, nie verkaufen | nur Kontext |

**Herleitung von w ohne Renditedaten:**

- S ist erwartungsgemäß an rund 30 % der Tage investiert (beschreibende
  Zählung, Abschnitt 9).
- Bei üblicher BTC-Volatilität von 40–80 % liegt E_Ziel bei 0,25–0,5, im
  Mittel bei etwa einem Drittel.
- Daraus folgt w ≈ 0,30 × 0,33 ≈ 0,10.
- w wird **nicht** an die im Test beobachtete Kapitalbindung von S angepasst.
  Die Sharpe Ratio eines festen BTC/Kasse-Mix hängt bei 0 % Kassenzins kaum
  von w ab. P1 ist deshalb gegen eine abweichende Kapitalbindung robust; w
  bestimmt nur absolute Rendite und Drawdown von R2.

## 5. Kosten, Kasse, Steuern

- **Handelskosten:** Kostenprofil `BINANCE_SPOT_VIP0_ESTIMATE_V1` unverändert:
  10 bp Gebühr, 1 bp halber Spread und 3 bp Slippage, zusammen **14 bp je
  Seite** auf das gehandelte Notional. Das gilt für jede Transaktion von S,
  R1, R2 und R0.
- **Liquidation zum Bewertungstag:** Zu jedem Bewertungstag wird für alle
  Varianten ein fiktiver Verkauf zu 14 bp abgezogen. So tragen R0 und die
  Varianten mit Bestand vergleichbare Kosten.
- **Kasse, primär (E3):** 0 % Verzinsung. Das entspricht USDT auf der Börse
  und dem heutigen Shadow.
- **Kasse, Sensitivität (E3):** Die Kasse wird mit `DTB3` verzinst (FRED,
  act/360), mit dem letzten zum Entscheidungszeitpunkt veröffentlichten Wert.
  Das wird getrennt berichtet, mit Überschussrenditen gegenüber `DTB3`.
- **Getrennter Ausweis:** Je Variante werden Bruttoertrag aus BTC,
  Handelskosten, Umschlag, Zeit im Markt und Kassenzins (nur in der
  Sensitivität) einzeln ausgewiesen. Es gibt keine Finanzierungskosten, weil
  kein Hebel eingesetzt wird.
- **Steuern (E7):** Primär wird vor Steuern bewertet. Zusätzlich gibt es eine
  Überschlagsrechnung für ein deutsches Privatkonto mit offen genannten
  Annahmen:
  - private Veräußerungsgeschäfte nach § 23 EStG;
  - Haltedauer über ein Jahr steuerfrei;
  - innerhalb eines Jahres zum persönlichen Grenzsteuersatz, den der
    Betreiber zum Bewertungstag nennt;
  - Freigrenze 1 000 EUR je Jahr;
  - FIFO;
  - Verluste nur mit Gewinnen nach § 23 verrechenbar;
  - Wechselkurs USDT/EUR vereinfacht als 1:1 oder mit Tageskurs, je nach
    Nennung.

  Unterschiedliche Haltedauern und damit Steuerfolgen von S, R1, R2 und R0
  werden ausdrücklich gezeigt. Die Steuersicht entscheidet keine Klasse.

## 6. Datenquellen, Lücken, Verzögerungen

- **Primärquelle:** Binance-Spot-Klines BTCUSDT und ETHUSDT in 1d und 1h aus
  dem öffentlichen Archiv `data.binance.vision` (tägliche oder monatliche
  Dateien).
- **Ersatzquelle:** dieselben Kerzen lesend aus der VPS-Datenbank
  (Binance-Daten-Worker von `OFFICIAL_V1`). Jeder Lauf vergleicht die Quellen
  auf überlappenden Tagen. Abweichungen über 0,1 % im Schlusskurs werden
  markiert, maßgeblich bleibt die Primärquelle.
- **Kassenzins:** FRED `DTB3`, nur für die Sensitivität.
- **Freigaben:** Jeder Abruf braucht eine Freigabe. Jeder Lauf hält die
  Hashes aller verwendeten Datendateien fest.
- **Bekanntheit:** Eine Tageskerze gilt um 01:05 UTC des Folgetags als
  bekannt, wenn sie in der Quelle vorhanden ist. Binance-Klines sind nach
  ihrem Schluss endgültig. Spätere Korrekturen einer Quelle werden über die
  Hashes sichtbar.
- **Fehlende Entscheidungsdaten**, also eine fehlende Tageskerze BTC oder ETH
  oder weniger als 200 bzw. 21 nutzbare Schlusskurse:
  - Der Zustand bleibt, es gibt weder Einstieg noch Ausstieg noch Anpassung.
  - Fehlen die Daten an drei aufeinanderfolgenden Entscheidungstagen, geht S
    am dritten flat (Fail-safe).
  - Das wird protokolliert.
  - Für R1 und R2 gilt nur: ohne Daten keine Anpassung. Es gibt für sie kein
    Fail-safe, sie bleiben passiv.
- **Fehlende 1h-Kerze bei der Ausführung:** Ausgeführt wird zum Open der
  nächsten vorhandenen 1h-Kerze. Es gibt keinen Fill zu einem vergangenen
  Preis.
- **Kurslücken:** Es gibt keine Stops innerhalb einer Kerze. Lücken wirken
  nur über den nächsten Open; die Drawdown-Grenze wirkt auf Tagesschlüssen
  (3.3). **N2 betrifft D6 nicht.**
- **Ausfälle** werden notiert, nicht aufgefüllt. Rückdatierte Ausführungen
  gibt es nicht.

## 7. Testdesign

- **Testbeginn (E4):** 2026-12-01 00:00 UTC, fest.
  - Erste Entscheidung am 01.12.2026 um 01:05, erste Ausführung um 02:00.
  - Nur Daten und Entscheidungen ab diesem Zeitpunkt zählen als unabhängige
    Forward-Beobachtung.
- **Beobachtungsskript (E5):**
  - Es entsteht erst später, mit eigener Freigabe, und wird nur mit
    synthetischen Kursreihen getestet.
  - Vor seinem ersten Lauf auf echten Daten ab Testbeginn wird es
    eingefroren (Commit und Hash).
  - Bis dahin wertet niemand S, R0, R1 oder R2 auf echten Kursen aus.
  - Ein Lauf auf 2018–2026 ist ausgeschlossen, auch als Plausibilitätscheck.
- **Bewertungseinheiten** (objektiv, vom Gate unabhängig):
  - **`RISK_ON`-Phasen des Gates:** Öffnen und Schließen, gezählt am Gate,
    nicht an S, damit eine Sperre nichts verzerrt.
  - **Abwärtsphasen von BTC:**
    - Der Tagesschluss liegt mindestens 35 % unter dem höchsten Tagesschluss
      der vorangegangenen 365 Tage. Die Phase endet, sobald der Abstand unter
      20 % fällt.
    - Sie zählt nur, wenn sie mindestens 30 Tage dauert und nach Testbeginn
      beginnt.
    - Die seit 2026-01-31 laufende Abwärtsphase zählt nicht als Einheit.
      Ihr Rest geht aber ganz normal in die Kennzahlen ein.
- **Mindestdauer** für ein vorläufiges Urteil, alle Bedingungen zusammen:
  36 Monate, mindestens 2 gezählte Abwärtsphasen und mindestens 15
  abgeschlossene `RISK_ON`-Phasen. Fehlen die Abwärtsphasen, bleibt das
  Ergebnis `OFFEN`. Spätestens nach 10 Jahren folgt ein Abschlussbericht mit
  dem vorhandenen Material.
- **Lange Phasen ohne Einstieg** sind kein Fehler (historisch bis 421 Tage)
  und kein Abbruchgrund. Es gibt keine Regeländerung, um Einstiege zu
  erzeugen.
- **Quartalsberichte**, zu den Stichtagen 1. März, Juni, September und
  Dezember:
  - Sie sind beschreibend und zeitgestempelt.
  - Sie enthalten Laufzeit in UTC, Skript-Hash, Commit, Daten-Hashes und die
    Kennzahlen aus Abschnitt 8.
  - Bis zur Mindestdauer tragen sie den Vermerk „vorläufig, keine Aussage“.

## 8. Kennzahlen, Kriterien, Klassen, Abbruch

### 8.1 Kennzahlen (je Variante, ab Testbeginn, Tagesschlüsse)

- **Tagesrendite:** r_t = Equity_t ÷ Equity_{t−1} − 1.
- **Sharpe Ratio:** Mittel(r_t − c_t) ÷ Standardabweichung(r_t − c_t) × √365.
  Dabei ist c_t = 0 primär und der `DTB3`-Tageszins in der Sensitivität.
- **Weitere Kennzahlen:** maximaler Drawdown; Calmar Ratio (annualisierte
  Rendite ÷ maximaler Drawdown); Zeit im Markt; Umschlag; Kosten.
- **Verlust je gezählter Abwärtsphase:** der größte Rückgang der Equity von
  einem Höchststand zu einem späteren Tiefststand, beide innerhalb des
  Phasenfensters.
- **Information Ratio S gegen R1:** Mittel(r_S − r_R1) ÷
  Standardabweichung(r_S − r_R1) × √365.
  - Die t-Statistik kommt aus einem stationären Block-Bootstrap mit
    mittlerer Blocklänge 20 Tage, 10 000 Ziehungen und Seed 20261201.

### 8.2 Kriterien in fester Reihenfolge, das entscheidende zuerst

1. **P1, Timing gegen bloße Exposition:** Sharpe(S) > Sharpe(R2).
2. **P2, Gate gegen Volatilitätssteuerung:** Sharpe(S) > Sharpe(R1).
3. **P3, Schutz:** In jeder gezählten Abwärtsphase ist der Verlust von S
   höchstens 50 % des Verlusts von R1.

Maßgeblich ist der primäre Fall (0 % Kasse, vor Steuern). Sensitivität und
Steuersicht werden berichtet, entscheiden aber keine Klasse.

| Klasse | Bedingung |
|---|---|
| `OFFEN` | Mindestdauer nicht erreicht |
| `TIMING_VORTEIL_VORLÄUFIG` | P1, P2 und P3 bestanden |
| `NUR_SCHUTZ` | P3 bestanden, P1 oder P2 nicht: weniger Verlust ohne bessere risikobereinigte Rendite, also bekannte Exposition anders verpackt |
| `SHARPE_OHNE_SCHUTZ` | P1 und P2 bestanden, P3 nicht: bessere risikobereinigte Rendite, aber der vorhergesagte Schutzmechanismus fehlt. H1 ist nicht bestätigt |
| `NUR_VOLATILITÄTSSTEUERUNG` | P1 bestanden, P2 und P3 nicht |
| `KEIN_VORTEIL` | P1 und P3 nicht bestanden, oder die Aussichtslosigkeitsregel greift |
| `BELASTBAR` (Zusatz) | nur zusätzlich zu `TIMING_VORTEIL_VORLÄUFIG`: t der Information Ratio S gegen R1 ≥ √(2·ln N_neu). N_neu ist der Zähler einschließlich D6 zum Auswertungstag (E6); heute wären das N = 58 und 2,85 |

Fälle, die die Tabelle nicht erfasst, werden mit Begründung als `OFFEN`
berichtet. Es gibt keine nachträgliche Klasse.

### 8.3 Abbruch und Halt

- **Technischer Fehler:** pausieren und als versionierter Bugfix des Skripts
  beheben, ohne Regeländerung. Die Pause wird protokolliert.
- **Drawdown-Grenze:** Sie folgt ausschließlich 3.3; ein Betreiberermessen
  gibt es nicht.
- **Aussichtslosigkeit:** Der Test endet vorzeitig mit `KEIN_VORTEIL`, wenn
  nach mindestens 24 Monaten beides zutrifft:
  - Sharpe(S) liegt um mindestens 0,5 unter Sharpe(R2);
  - in mindestens einer gezählten Abwärtsphase wurde P3 verfehlt.
- **Kein vorzeitiger Erfolg:** Vor der Mindestdauer gibt es weder eine
  Echtgeldentscheidung noch eine Profitabilitätsaussage.

## 9. Wie lange bis zu einer Aussage (Überschlag, keine Messung)

- **Beschreibende Zählungen** auf den lokalen Tageskerzen, ohne Renditen von
  Strategien oder Referenzen:
  - `RISK_ON` an 30 % der Tage, rund 9 Phasen pro Jahr. Dauer im Median 4,
    im Mittel 12 Tage. Pausen ohne `RISK_ON` bis 421 Tage.
  - Abwärtsphasen von BTC nach Abschnitt 7, 2018-08 bis 2026-10:
    - sechs Phasen: 2018/19, 2019/20, 2021, 2021 (nur 14 Tage, zählt künftig
      nicht), 2022/23 und eine seit 2026-01-31 noch offene;
    - das sind fünf zählbare in rund acht Jahren, etwa eine alle 1,5 Jahre;
    - zwei gezählte Phasen nach Testbeginn sind realistisch erst nach drei
      bis fünf Jahren erreicht.
- **Statistik:** Die t-Statistik einer Information Ratio IR wächst mit √T.
  Für t ≥ 2,85 braucht es T ≈ (2,85 ÷ IR)² Jahre.
  - Bei IR 1,0: rund 8 Jahre.
  - Bei IR 0,5: rund 32 Jahre.
  - Bei IR 0,3: rund 90 Jahre.

  Eine IR von 1,0 gegen eine risikogleiche passive Anlage wäre
  außergewöhnlich hoch.
- **Folge:** Eine vorläufige Aussage gibt es frühestens nach drei, realistisch
  nach drei bis fünf Jahren. `BELASTBAR` ist in einem praktisch relevanten
  Zeitraum voraussichtlich nicht erreichbar. Ein schnellerer Nachweis wird
  nicht versprochen.

## 10. Handelsvorteil oder verpackte BTC-Exposition?

- **Überwiegend verpackte Exposition, bis das Gegenteil gezeigt ist.**
  - Trendfilter wie „Kurs über dem 200-Tage-Schnitt“ sind öffentlich bekannt.
  - Ihr dokumentierter Nutzen ist vor allem eine geringere Verlusttiefe in
    langen Abwärtsphasen.
  - Unsere eigenen Zahlen sind in-sample: Das Gate senkte den Drawdown von
    BTC etwa auf die Hälfte, bei ähnlicher Rendite. Nur ein Bärenmarkt
    (2022) wurde vollständig vermieden.
- **Was D6 leistet:** D6 trennt Timing-Wert, Volatilitätssteuerung und bloß
  weniger Exposition (P1–P3) und beantwortet damit die Frage, an der jede
  weitere Arbeit am Regime-Ansatz hängt.
- **Nach Steuern** ist für ein deutsches Privatkonto gehaltenes BTC
  strukturell im Vorteil.
- **Entscheidung des Betreibers:** D6 läuft als kostengünstige
  Langzeitbeobachtung und wird bewusst zurückgestellt. Es ist keine aktive
  Forschungsrichtung.

## 11. Spätere Umsetzung (jeweils eigene Freigabe)

1. **Beobachtungsskript** `regime-exposure-eval-v1`:
   - rechnet S, R0, R1 und R2 täglich nach den Abschnitten 3–8;
   - deterministisch, ohne Zugriff auf Handelssysteme;
   - Tests nur mit synthetischen Kursreihen;
   - Einfrieren vor dem ersten echten Lauf (7).
2. **Quartalslauf:** Daten lesend beschaffen (je Abruf freigegeben), Skript
   ausführen, zeitgestempelten Bericht ablegen.
3. **Nicht vorgesehen (E5):** Shadow-Portfolio und Integration in die
   produktive Trading-Engine.

Aufwand: eine bis zwei Arbeitssitzungen für das Skript, danach etwa eine
Stunde pro Quartal.

## 12. Entscheidungen des Betreibers (2026-10-20)

| # | Entscheidung | Festlegung |
|---|---|---|
| E1 | Zielvolatilität und Exposition | **20 % p. a., höchstens 50 % BTC.** Annualisierung täglicher BTC-Renditen mit √365 |
| E2 | Drawdown | **20 %**, Auslösung, Sperre und Wiedereintritt nach 3.3, höchstens zwei Auslösungen. Keine Anpassung anhand von Ergebnissen |
| E3 | Kassenzins | **primär 0 %**; Sensitivität mit `DTB3`. Kosten, Umschlag und Zinsertrag getrennt ausgewiesen |
| E4 | Testbeginn | **2026-12-01 00:00 UTC**, fest. Nur Daten und Entscheidungen ab dann zählen |
| E5 | Umsetzung | **kein Shadow-Portfolio, keine Integration in die Trading-Engine.** Ein kleines, deterministisches Beobachtungsskript mit zeitgestempelten Ergebnissen |
| E6 | Mehrfachtest-Zähler | **N bleibt 57.** D6 ist vorregistriert, nicht ausgewertet. Erst mit seiner Auswertung zählt es zu N (N_neu für `BELASTBAR`) |
| E7 | Steuern | **primär vor Steuern**; zusätzlich ein Überschlag für ein deutsches Privatkonto mit offenen Annahmen (5) |
| – | R2 | **w = 10 %**, vor Testbeginn festgelegt, nie angepasst (4) |
| – | Informationsstand | Entscheidungen nur aus Daten, die um 01:05 UTC bekannt sind (3.1) |

## 13. Was unverändert bleibt

- `OFFICIAL_V1`, Champion, Challenger, Risk Engine (`risk-rules-v1/1.4.0`),
  Arena, Gates v1–v4, Evolution.
- `RISK_BUDGET_V1` (D1) als eigener Entwurf.
- `main`, VPS, Datenbanken.
- Dieser Entwurf hat nur Code und Berichte genutzt, dazu zwei beschreibende
  Zählungen auf den lokalen Tageskerzen: Regime-Phasen und BTC-Abwärtsphasen,
  ohne Strategie- oder Referenzrenditen. Er hat keine Forward-Daten
  ausgewertet.
