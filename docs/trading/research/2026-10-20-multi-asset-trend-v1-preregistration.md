# Vorregistrierung `MULTI_ASSET_TREND_V1` (D7): veröffentlichte Trendregel auf Daten nach ihrer Veröffentlichung

> **Status: ENTWURF Phase 0 (Machbarkeit), nicht eingefroren.** Erstellt am
> 2026-10-20 auf `claude/inspiring-noether-rjh92d`.
>
> - Kein Download, kein Code, keine Auswertung, kein KI-Lauf (0 USD).
> - Die Datenlage ist nur über öffentliche Dokumentationsseiten geprüft
>   (Abschnitt 6), es wurde keine Datei bezogen.
> - An `OFFICIAL_V1`, Champion, Challenger, Risk Engine, Arena, Gates, `main`
>   und VPS ändert sich nichts.
> - Mehrfachtest-Zähler unverändert **N = 57**. D7 zählt erst mit seiner
>   Auswertung (wie D6).
> - D1 (Entwurf) und D6 (eingefroren, zurückgestellt) bleiben unverändert.
> - Keine Handels-, Anlage- oder Steuerberatung.

## Kurz und verständlich

- **Frage:** Schlägt eine vor 2007 veröffentlichte, einfache Trendregel über
  fünf Anlageklassen nach Kosten dasselbe Portfolio in statischer Gewichtung,
  gemessen an der Sharpe Ratio und nur auf den Jahren nach der
  Veröffentlichung?
- **Warum diese Regel:** Ein Dritter hat sie vor unserer Arbeit festgelegt. Wir
  wählen keinen Parameter, und die Zeit nach der Veröffentlichung ist
  unabhängig von unserer Entwicklung. Sie ist allerdings nicht frei von
  öffentlichem Vorwissen (Abschnitt 9).
- **Rolle in SignalPilot:** ein mögliches **Langfrist-Modul** einer
  Multi-Strategie-Plattform mit eigenem Budget und geringer Korrelation zu
  Krypto. Für Daytrading oder Swing bringt D7 nichts (Abschnitt 1).
- **Ehrliche Erwartung:**
  - Wahrscheinlich ist eine geringere Verlusttiefe bei ähnlicher Rendite.
  - Ein klarer Sharpe-Vorsprung ist möglich, aber nicht sicher.
  - Ein unklares Ergebnis ist realistisch, weil sich mit rund 19 Jahren
    Monatsdaten nur Vorsprünge ab etwa 0,4–0,5 Sharpe erkennen lassen.
- **Aufwand bis zum Ergebnis:** drei bis vier Arbeitssitzungen, also Wochen,
  nicht Jahre.

## 1. Einordnung in die Plattform

| Kriterium | Bewertung |
|---|---|
| Zeithorizont | lang (Monatsentscheidung, Haltedauer Monate) |
| Eigenständiges Modul mit eigenem Budget | ja: 12 Entscheidungen pro Jahr, wenig Betrieb |
| Unabhängigkeit von bestehender Exposition | hoch: keine Krypto-Assets |
| Beitrag zu Daytrading und Swing | **keiner** |
| Neue Infrastruktur für einen späteren Betrieb | Monatsdaten außerhalb von Krypto und ein Weg zu UCITS-ETFs (Broker, EUR). Für diese Forschung ist beides nicht nötig |
| Wirtschaftlicher Nutzen bei Erfolg | ein diversifizierendes Langfrist-Modul. Das Gesamtrisiko der Plattform würde sinken, auch wenn die Sharpe des Moduls allein nur mäßig ist |

## 2. Frage und Hypothesen

**Frage:** Erzielt die Regel T (Abschnitt 3) im Fenster nach der
Veröffentlichung nach Kosten eine höhere Sharpe Ratio als die statische
Referenz B (Abschnitt 4)?

- **H0:** Sharpe(T) ≤ Sharpe(B). Ein kleinerer Drawdown von T erklärt sich
  durch zeitweise weniger Exposition.
- **H1:** Sharpe(T) > Sharpe(B) und maximaler Drawdown(T) < maximaler
  Drawdown(B).

## 3. Regel T (wie veröffentlicht, ohne eigene Parameter)

Grundlage ist Faber, M. T. (2007), *A Quantitative Approach to Tactical
Asset Allocation*, Journal of Wealth Management, Frühjahr 2007. Die Regel ist
die dort beschriebene; keine Variante, keine Optimierung.

| Element | Festlegung |
|---|---|
| Anlageklassen | US-Aktien, Aktien entwickelter Märkte außerhalb der USA, 10-jährige US-Staatsanleihen, US-REITs, Rohstoffe |
| Gewichtung | je 20 % des Portfolios, monatlich auf 20 % zurückgesetzt |
| Signal | am Monatsende je Klasse: Gesamtrendite-Index über seinem einfachen Durchschnitt der letzten 10 Monatsendwerte → Klasse halten; sonst diesen 20-%-Anteil in T-Bills |
| Informationsstand | Die Position für Monat m+1 entsteht nur aus Werten bis Ende Monat m. Die Rendite von m+1 fließt nie ins Signal |
| Ausführung | zum Monatsendwert m. Das ist die Konvention der Veröffentlichung, eine Idealisierung, weil der Wert, der das Signal bestimmt, nicht exakt handelbar ist. Sie wird durch die Kosten in Abschnitt 5 nur teilweise abgedeckt und im Bericht als Grenze genannt |
| Kasse | 3-Monats-T-Bill (FRED `TB3MS`), Monatsertrag = Satz ÷ 12 |

**Offener Punkt für Schritt 0.2:** Signal auf dem Gesamtrendite-Index oder
auf dem Kursindex? Maßgeblich ist der Wortlaut der Originalfassung; er wird
vor dem Einfrieren nachgelesen und übernommen. Bis dahin gilt der
Gesamtrendite-Index als Platzhalter.

## 4. Referenzen

| Referenz | Regel | Wozu |
|---|---|---|
| **B: statisch gleichgewichtet** | dieselben fünf Klassen, je 20 %, immer investiert, monatlich zurückgesetzt, gleiche Kosten | **isoliert den Wert des Timings** gegenüber bloßer Streuung |
| B0: nur US-Aktien | immer investiert | Kontext |
| B60: 60 % US-Aktien, 40 % Staatsanleihen | monatlich zurückgesetzt | Kontext (übliches Mischportfolio) |

## 5. Kosten und Steuern

- **Handelskosten je Seite auf das gehandelte Volumen**, einheitlich für T und
  B, vor der Auswertung festgelegt (F3):
  - Aktien und Anleihen 10 bp;
  - REITs 15 bp;
  - Rohstoffe 20 bp.

  Die Werte enthalten Spread und eine Brokergebühr für Orders ab rund
  2 000 EUR.
- **Laufende Kosten (TER) je Jahr auf den Bestand**, für T und B gleich:
  - Aktien und Anleihen 0,10 %;
  - REITs 0,40 %;
  - Rohstoffe 0,30 %.
- **Währung:** primär in USD wie die Indizes. Eine EUR-Sicht ist sekundär und
  entscheidet nichts.
- **Steuern (sekundär, offen benannte Annahmen):**
  - Abgeltungsteuer 25 % plus Solidaritätszuschlag;
  - Teilfreistellung 30 % für Aktienfonds, 0 % für Anleihe- und
    Rohstoffprodukte; die Einstufung von REIT-ETFs wird je Produkt genannt;
  - Vorabpauschale;
  - Sparerpauschbetrag 1 000 EUR.

  Die Abgeltungsteuer hängt nicht von der Haltedauer ab. Der Nachteil
  häufigen Umschichtens ist deshalb kleiner als bei Krypto (D6), er entsteht
  vor allem durch den früheren Steuerzeitpunkt.

## 6. Daten: Machbarkeit (nur Dokumentation geprüft)

| Klasse | Quelle (frei) | Abdeckung laut Dokumentation | Status |
|---|---|---|---|
| US-Aktien | Kenneth-French-Datenbibliothek, US-Marktportfolio (Mkt-RF + RF), Gesamtrendite | monatlich ab 1926 | ✓ |
| Aktien außerhalb der USA | Kenneth-French-Datenbibliothek, Developed ex US (Mkt-RF + RF), USD, mit Dividenden | monatlich ab 07/1990 | ✓ |
| US-Staatsanleihen 10 J. | FRED `GS10`, Rendite der 10-jährigen Anleihe. Gesamtrendite **konstruiert** (F2): Par-Anleihe mit Kupon y_{m−1}, halbjährlich, bewertet zu y_m bei 10 Jahren Restlaufzeit, plus Kupon ÷ 12 | monatlich ab 1953 | ✓, mit Konstruktion statt Index |
| US-REITs | Nareit, FTSE Nareit All Equity REITs, monatliche Index- und Renditewerte | 1972–2026 | ✓ wahrscheinlich; Dateiformat ungeprüft |
| Rohstoffe | Für S&P GSCI Total Return keine freie Indexhistorie gefunden. Ersatz: Produkte, die ihn nachbilden (ETN `GSP` bzw. ETF `GSG`, beide ab 2006) | ab 2006 | ⚠ nur Produkt-Ersatz (F1) |
| Kasse | FRED `TB3MS` | monatlich ab 1934 | ✓ |

- **Urteil:** machbar. Höchstens eine Klasse ist nur über einen Produkt-Ersatz
  verfügbar, das Abbruchkriterium (≥ 2 Klassen unbrauchbar) greift nicht.
- **Grenzen:** Die Anleihen sind konstruiert, und Rohstoffe beginnen erst
  2006. Mit 10 Monaten Vorlauf ist der erste gemeinsame Signalmonat damit
  etwa 2007-04.
- **Schritt 0.2** prüft das an den Dateien selbst, mit eigener
  Download-Freigabe, aber noch ohne Auswertung:
  - Format und Lücken;
  - Gleichlauf der Ersatzreihen mit ihren Indizes, soweit beschreibend
    möglich;
  - Wortlaut der Originalregel.

## 7. Testfenster

- **Beginn:** der erste Monatsultimo nach der frühesten nachweisbaren
  öffentlichen Fassung der Regel.
  - Nachweisbar ist bisher die Journal-Fassung vom Frühjahr 2007; eine
    frühere SSRN-Fassung wird vermutet und in Schritt 0.2 geprüft.
  - Liegt die Rohstoff-Ersatzreihe später, beginnt das Fenster mit dem ersten
    Monat, in dem alle fünf Signale bestimmbar sind.
- **Ende:** der letzte vollständige Monat vor dem Auswertungslauf.
- **Ausgeschlossen:** Daten vor dem Fensterbeginn dienen nur als Vorlauf für
  den 10-Monats-Durchschnitt. Ergebnisse daraus zählen nie, auch nicht die
  Ergebnisse späterer Aktualisierungen des Autors.

## 8. Kennzahlen, Kriterien, Klassen

- **Kennzahlen (monatlich):**
  - Sharpe Ratio der Überschussrendite über T-Bills, annualisiert mit √12;
  - maximaler Drawdown, Calmar Ratio, Umschlag, Kosten, Zeit im Markt je
    Klasse;
  - Information Ratio T gegen B mit t-Statistik aus einem stationären
    Block-Bootstrap (mittlere Blocklänge 6 Monate, 10 000 Ziehungen, Seed
    20070401).
- **Nur beschreibend:** die Korrelation der Monatsrenditen von T mit BTC
  (BTCUSDT ab 2017-09, lokale Kerzen). Sie beantwortet die Diversifikation
  für die Plattform und entscheidet keine Klasse.

| Klasse | Bedingung |
|---|---|
| `VORTEIL_BELASTBAR` | Sharpe(T) > Sharpe(B), maximaler Drawdown(T) < maximaler Drawdown(B) und t der Information Ratio ≥ √(2·ln N_neu); heute wären das N = 58 und 2,85 |
| `VORTEIL_VORLÄUFIG` | Sharpe(T) > Sharpe(B) und maximaler Drawdown(T) < maximaler Drawdown(B), t unter der Schwelle |
| `NUR_SCHUTZ` | maximaler Drawdown(T) < maximaler Drawdown(B), aber Sharpe(T) ≤ Sharpe(B) |
| `SHARPE_OHNE_SCHUTZ` | Sharpe(T) > Sharpe(B), aber maximaler Drawdown(T) ≥ maximaler Drawdown(B). H1 ist nicht bestätigt |
| `KEIN_VORTEIL` | Sharpe(T) ≤ Sharpe(B) und maximaler Drawdown(T) ≥ maximaler Drawdown(B) |

Jede Kombination führt zu genau einer Klasse. Es gibt genau einen
Auswertungslauf. Weitere Varianten (andere Durchschnitte, andere
Gewichtungen, andere Klassen) sind ausgeschlossen. Sie wären neue Hypothesen
mit eigener Vorregistrierung.

## 9. Ehrliche Grenzen

- **Öffentliches Vorwissen:** Dass Trendregeln 2008 und 2022 halfen und in den
  2010er-Jahren hinter Mischportfolios zurückblieben, ist allgemein bekannt.
  Die Regel ist fest, aber das Ergebnis ist nicht völlig überraschungsfrei.
  Das schwächt die Aussagekraft, ohne sie aufzuheben.
- **Teststärke:** Mit rund 230 Monaten ist nur ein Sharpe-Vorsprung ab etwa
  0,4–0,5 vom Zufall zu unterscheiden. `VORTEIL_BELASTBAR` ist möglich, aber
  nicht wahrscheinlich.
- **Konstruktion und Ersatz:** konstruierte Anleihen, Rohstoffe über ein
  Produkt, Ausführung zum Signalwert (Abschnitt 3).
- **Für die Plattform:** D7 liefert bei Erfolg ein Langfrist-Modul. Den
  Engpass für profitable kurzfristige Strategien, die Kosten je Trade, löst es
  nicht.

## 10. Ablauf

1. **0.1 dieser Entwurf** (erledigt).
2. **0.2 Datenprüfung an den Dateien**, mit Download-Freigabe, ohne
   Auswertung: fünf bis sechs kleine öffentliche Dateien. Dazu der Wortlaut
   der Originalregel und das Datum der frühesten Fassung.
3. **0.3 Entscheidungen F1–F6**, danach Einfrieren (Commit und Blob-Hash).
4. **1.1 Auswertungsskript**, getestet nur mit synthetischen Reihen.
5. **1.2 genau ein Auswertungslauf** mit eigener Freigabe, danach ein Bericht
   mit Klasse.

## 11. Entscheidungen des Betreibers vor dem Einfrieren

| # | Entscheidung | Vorschlag | Alternative |
|---|---|---|---|
| F1 | Rohstoffe | **ETN `GSP`**, bildet S&P GSCI Total Return nach | ETF `GSG`; oder Rohstoffe weglassen (dann vier Klassen, Abweichung vom Original) |
| F2 | Anleihen | **Konstruktion aus `GS10`** (fest, Abschnitt 6) | ETF `IEF` ab 2002 als Kursreihe mit Ausschüttungen |
| F3 | Kosten und TER | **wie Abschnitt 5** | doppelte Kosten als Sensitivität zusätzlich |
| F4 | Fensterbeginn | **Regel aus Abschnitt 7** | fest 2007-04 |
| F5 | Mehrfachtest-Zähler | **N bleibt 57, D7 zählt mit der Auswertung** | N 57 → 58 beim Einfrieren |
| F6 | Sekundäre Sichten | **EUR und Steuer als Überschlag berichten** | nur USD vor Steuern |

## 12. Was unverändert bleibt

- `OFFICIAL_V1`, Champion, Challenger, Risk Engine (`risk-rules-v1/1.4.0`),
  Arena, Gates v1–v4, Evolution, D1-Entwurf, D6 (eingefroren).
- `main`, VPS, Datenbanken.
- Dieser Entwurf hat nur öffentliche Dokumentationsseiten gelesen. Er hat
  keine Daten bezogen und nichts ausgewertet.
