# Vorregistrierung der Machbarkeitsstudie Relative Stärke im erweiterten Binance-Spot-Universum (2026-10-17)

> **Status: Entwurf zur Freigabe (Phase 0).** Geschrieben, **bevor**
> irgendwelche Kursdaten anderer Spot-Paare als BTCUSDT und ETHUSDT abgerufen
> oder angesehen wurden.
>
> - Nichts wurde heruntergeladen, auch keine Verzeichnisliste.
> - Kein Code geschrieben, kein Backtest, keine Strategie implementiert.
> - Keine Risk-Regel, kein Limit, kein Gate und kein Regime-Modell geändert.
> - Kein KI-Forschungslauf (0 USD).
> - VPS, offizieller Forward-Test (`OFFICIAL_V1`), Arena, Champion und
>   Challenger sind unberührt.
> - Keine Handelsempfehlung, keine Anlage-, Rechts- oder Steuerberatung.

Grundlage ist die
[Analyse der Forschungsrichtungen](2026-10-16-research-directions-profitability.md),
Abschnitte 3.6, 4 und 8 (Rang 2). Rang 1, der Funding-Carry, ist seit dem
2026-10-17 geschlossen (`KOMPRIMIERT`,
[Ergebnisbericht](2026-10-17-funding-carry-v2-results.md)). Form und Disziplin
folgen der
[Carry-Vorregistrierung](2026-10-16-funding-carry-feasibility-preregistration.md).

**Ziel des Betreibers:** nicht möglichst viele Strategien, sondern ein
langfristig robuster und wirtschaftlich relevanter Vorteil nach allen Kosten.
Er wünscht ausdrücklich, dass diese Vorregistrierung festlegt:

| Wunsch | Abschnitt |
|---|---|
| eigenständige Querschnitts-Momentum-Strategie innerhalb von `RISK_ON` | 1, 5 |
| grundsätzliche Wirtschaftlichkeit vorab: Mehrertrag gegenüber BTC/ETH, Kosten des Umschichtens | 2 |
| historisch korrektes Universum ohne Überlebens-Verzerrung | 3 |
| Mindestanforderungen an Volumen, Liquidität, Historie, Markttiefe; Ausschluss ungeeigneter Instrumente | 3, 7 |
| Einstieg, Ranking, Gewichtung, Rebalancing, Ausstieg, alle Parameter vorab | 5 |
| fairer Vergleich mit Champion, Challenger, BTC/ETH-Referenz, Geldmarkt | 6, 8 |
| Gates-v4-Architektur: was abbildbar ist, was später fehlt | 14 |
| R-004 nur BTC/ETH; Forschung nur isoliert, nie per Allowlist-Automatik | 14, 16 |
| vorbelastete Zeiträume, Mehrfachtest-Zähler, Erfolgs- und Stop-Kriterien, begrenzter Umfang | 10, 13 |
| Kontrollstrategie mit derselben `RISK_ON`-Exposition | 6 |
| Machbarkeits- und Aufwandseinschätzung, kritische Bewertung | 2, 15, 17 |

| | Wert |
|---|---|
| Studienkennung | `RELATIVE_STRENGTH_FEASIBILITY_V1` |
| Varianten | `XS_MOM_28D_WEEKLY` (A), `XS_MOM_28D_4WEEKLY` (B), keine weiteren |
| Kontrollen und Referenzen | Kontrolle K (gleichgewichtetes Universum in `RISK_ON`), BTC/ETH-Referenz R, Champion, Challenger, Geldmarkt (`DTB3`); sie werden nie „bestanden“ und zählen nicht für N |
| Markt | Binance Spot, alle Paare mit Quote USDT, inklusive delisteter Paare; **nur Referenzmarkt**, für ein deutsches Konto nicht erreichbar (Abschnitt 12) |
| Richtung, Regime | nur Long; investiert nur bei `crypto-native-regime-v1` = `RISK_ON` (R-020 unverändert) |
| Bewertungsfenster | 2020-01-01T00:00Z – 2026-09-30T23:59:59.999Z (81 volle Monate); Teilfenster 2020-01 – 2023-12 und 2024-01 – 2026-09 |
| Vorlauf | ab 2019-07-01, nur für Historie, Liquidität und Signal; geht in keine Kennzahl ein |
| Platzkapital | 20 000 USDT je Strategie (Platzgröße wie Gates v4), in `RISK_ON` voll investiert |
| Mehrfachtest-Zähler | N = 55 bei Festschreibung, 57 nach der Auswertung; Schwelle √(2·ln 57) = **2,84** |
| Gates | keine. Diese Studie ist **kein** Gates-Lauf; v1–v4 bleiben unverändert |

**Kein kanonischer Hash**, aus demselben Grund wie beim Carry: Nur
Vorregistrierungen, die Code festnagelt (Gates, Familien), tragen einen
`canonicalHash`. Eingefroren wird diese Studie durch den Commit, den der
Betreiber freigibt (Abschnitt 15, Schritt 0.2). Der Ergebnisbericht nennt
diesen Commit und den Blob-Hash dieser Datei (`git hash-object`). Jede
spätere inhaltliche Änderung ist eine V2. Sie wird nie mit V1 vermischt und
darf sich nicht auf Daten stützen, die V1 gesehen hat.

## 1. Fragestellung und Hypothese

**Frage.** Bringt es nach sämtlichen modellierten Kosten einen Vorteil, in
`RISK_ON`-Phasen nicht pauschal Krypto zu halten, sondern die **relativ
stärksten** Coins eines breiten, liquiden Spot-Universums? Der Vorteil müsste
vier Dinge leisten:

- aus der **Auswahl** kommen, nicht aus mehr Krypto-Engagement. Maßstab ist
  eine Kontrolle mit derselben `RISK_ON`-Exposition, die das ganze Universum
  gleichgewichtet hält (Abschnitt 6);
- den einfachen BTC/ETH-Bestand in denselben Phasen schlagen;
- über Geldmarkt plus Risikoabschlag liegen, gesamt und seit 2024;
- vom Bestand (Champion, Challenger) unabhängig sein.

**H1.** Ja, in mindestens einer der zwei vorab festgelegten Varianten
(Kriterien B1–B6, Abschnitt 10).

**H0.** Nein. Der Auswahleffekt ist in liquiden Coins zu klein, durch Kosten
aufgezehrt, nur in einzelnen Jahren vorhanden oder nicht von reinem
Altcoin-Beta zu unterscheiden.

**Ökonomische Begründung.**

- **Unterreaktion und Aufmerksamkeit.** Neue Information (Netzwerknutzung,
  Listings, Narrative) verbreitet sich in Krypto langsam und über
  Aufmerksamkeitswellen. Steigende Kurse ziehen Käufer an, die Trends
  verlängern. Das ist die übliche Erklärung für Momentum in allen
  Anlageklassen.
- **Fehlende Arbitrage.** Viele Privatanleger, kaum Leerverkäufer in kleineren
  Coins, teure Absicherung. Fehlbewertungen bleiben länger bestehen als in
  Aktien.
- **Befund in der Literatur** (Vorwissen, Abschnitt 13): Querschnitts-Momentum
  in Krypto ist dokumentiert, vor allem über 1–4 Wochen und in breiten
  Universen. In großen, liquiden Coins ist es schwächer und zeitlich instabil;
  nach etwa einem Monat wird teils Umkehr berichtet.
- **Warum Breite hilft:** Ein Auswahlvorteil wächst mit der Zahl unabhängiger
  Wetten (Fundamental Law: IR ≈ IC × √Breite). BTC/ETH allein bieten keine
  Breite. Die Analyse fand eine mittlere paarweise Korrelation von 0,80, aber
  Rest-Volatilitäten von 31–57 % p. a. Das ist der Rohstoff einer relativen
  Strategie.
- **Grenze der Long-only-Form:** Sie trägt Altcoin-Beta (1,3–1,45 zu BTC laut
  Analyse) und investiert in denselben Phasen wie der Challenger. Unabhängig
  ist nur der Auswahlanteil. Deshalb ist der Vergleich mit der Kontrolle das
  Kernkriterium (B3).

**Marktneutrale Variante: ausdrücklich nicht Teil dieser Studie.** Long die
Stärksten, Short die Schwächsten wäre eine eigene, spätere Frage mit eigener
Vorregistrierung. Sie bräuchte Shorts (R-005, R-020, siehe Analyse 5.2 und
den ADR-Entwurf 0020, der noch nicht auf diesem Branch liegt) und einen Handelsplatz,
der Altcoin-Shorts für ein deutsches Privatkonto erlaubt. Damit diese Frage
später unverbrauchte Daten hat, gilt hier:

- **Querschnittsrenditen außerhalb von `RISK_ON` werden nicht ausgewertet.**
  Weder Signale noch Folgerenditen dieser Tage gehen in eine Kennzahl ein.
- Ausnahme: Bewertung und Ausstieg am ersten Tag nach Ende einer
  `RISK_ON`-Phase.

## 2. Grundsätzliche Wirtschaftlichkeit vorab (Überschlag)

Alles in diesem Abschnitt ist eine **Erwartung aus Annahmen**, kein Ergebnis.
Es wurden keine Altcoin-Daten angesehen. Die einzigen Zahlen aus Daten sind
bereits bekannte Werte aus der Analyse und dem Carry-Bericht.

### 2.1 Woher ein Mehrertrag gegenüber BTC/ETH käme

Der Mehrertrag der Strategie gegenüber der BTC/ETH-Referenz R zerfällt in zwei
Teile:

**(Strategie − R) = (Kontrolle − R) + (Strategie − Kontrolle)**

| Teil | Bedeutung | Erwartung vorab |
|---|---|---|
| Kontrolle − R | Altcoin-Korb statt BTC/ETH in denselben Phasen: Größen- und Beta-Effekt, **kein** Auswahlvorteil | unbekannt. Vorwissen: Seit etwa 2023 stieg der BTC-Anteil an der Marktkapitalisierung deutlich, viele Altcoins blieben zurück. Seit 2024 eher negativ |
| Strategie − Kontrolle | die eigentliche **Selektionsrendite** | 0 bis wenige Prozent p. a. auf den Platz, je nach Signalgüte (2.3) |

Eine Erweiterung des Universums lohnt sich nur, wenn die Summe positiv ist
**und** der zweite Teil allein trägt. Sonst wäre der Mehrertrag nur ein
anderes Beta, und ob man mehr Beta will, ist eine Risiko-Entscheidung.

### 2.2 Was Umschichten kostet

Bekannt aus Analyse und Carry-Bericht:

- `RISK_ON` an 829 von 2 465 Tagen des Fensters, also **33,6 %** der Zeit.
- 86 Wechsel `RISK_ON` ↔ nicht `RISK_ON` in 5¾ Jahren (2018-04 – 2023-12),
  rund 15 je Jahr. Die mittlere `RISK_ON`-Phase dauert damit nur gut zwei
  Wochen.

Kosten je Seite laut Abschnitt 7: 14 bp für die liquidesten Paare, 25 bp
bzw. 40 bp für weniger liquide. Angenommen wird ein Mittel von 25 bp.

| Kostenquelle | betrifft | Überschlag auf den Platz p. a. |
|---|---|---:|
| Gate-Wechsel: rund 7,5 volle Ein- und Ausstiege je Jahr | Strategie, Kontrolle und R gleichermaßen | 2,1 % (14 bp) bis 3,8 % (25 bp) |
| Wöchentliches Neuranking (A): Annahme 20 % des Portfolios je Woche getauscht, rund 17,5 Wochen in `RISK_ON` | nur Strategie A | ≈ 1,8 % |
| Neuranking alle 4 Wochen (B): Annahme 30 % je Termin, rund 4,4 Termine in `RISK_ON` | nur Strategie B | ≈ 0,7 % |
| Mitgliederwechsel der Kontrolle | nur Kontrolle | ≈ 0,2–0,5 % |

**Folgerung:** Die Gate-Kosten treffen alle `RISK_ON`-Strategien und
schmälern die Wirtschaftlichkeit (B1/B2). Für den Auswahlvorteil (B3) zählen
nur die **Zusatzkosten** des Neurankings: etwa 1,8 % p. a. (A) bzw. 0,7 % p. a.
(B) auf den Platz, in `RISK_ON`-Zeit gerechnet rund 5 % bzw. 2 % p. a.

### 2.3 Wie groß der Auswahlvorteil sein müsste: Trennschärfe

Überschlag für Variante A unter diesen Annahmen:

- Rest-Volatilität eines Coins gegenüber dem Korb 50 % p. a.;
- Auswahl der besten 10 von 50 (oberstes Fünftel, mittlerer z-Wert 1,40);
- wöchentliche Wetten, Rang-Informationskoeffizient (IC) je Woche;
- Tracking Error der Auswahl gegenüber der Kontrolle 14 % p. a. in
  `RISK_ON`-Zeit;
- Zusatzkosten 5,2 % p. a. in `RISK_ON`-Zeit;
- 33,6 % Zeit in `RISK_ON`, 81 Monate.

| IC je Woche | Selektion brutto (in `RISK_ON`, p. a.) | netto (in `RISK_ON`, p. a.) | netto auf den Platz p. a. | IR in `RISK_ON` | erwartetes t (81 Monate) |
|---:|---:|---:|---:|---:|---:|
| 0,01 | 5,0 % | −0,2 % | −0,1 % | −0,01 | ≈ 0,0 |
| 0,02 | 10,1 % | 4,9 % | 1,6 % | 0,35 | ≈ 0,5 |
| 0,03 | 15,1 % | 9,9 % | 3,3 % | 0,71 | ≈ 1,1 |
| 0,05 | 25,2 % | 20,0 % | 6,7 % | 1,43 | ≈ 2,2 |
| ≈ 0,063 | 31,6 % | 26,4 % | 8,9 % | 1,89 | 2,84 (Schwelle) |

- Formel: t ≈ IR in `RISK_ON` × √(Jahre in `RISK_ON`), mit
  2 465 × 0,336 ÷ 365,25 ≈ 2,27 Jahren, also t ≈ 1,51 × IR.
- **Nachweisbar ist erst ein IC um 0,06**, bei stärker korrelierten
  Gewinnern (Tracking Error 18 %) eher 0,08. Für liquide Großwerte wäre das
  außergewöhnlich hoch. Plausibler sind 0,01–0,04 (Annahme, nicht belegt).
- **Der Engpass ist die Zeit in `RISK_ON`.** Von 6¾ Jahren Fenster sind nur
  gut 2¼ Jahre informativ. Mehr Tage gäbe es nur mit der marktneutralen Frage
  (Abschnitt 1), die getrennt bleibt.
- Variante B wettet seltener. Bei gleichem IC je Termin halbiert sich ihr
  Bruttovorteil grob (√13 statt √52 Wetten je Jahr), dafür sinken die Kosten.
  Sie besteht nur, wenn das Signal beim Einstieg über die ganze Phase trägt.

**Konsequenz für die Deutung:** Ein mäßiger, echter Auswahlvorteil würde mit
hoher Wahrscheinlichkeit **nicht** bestehen. `NICHT_BESTANDEN` heißt deshalb
oft „nicht belegt“, nicht „wertlos“; dieselbe Grenze gilt seit Gates v4 für
jede Long-Familie (Gates v4, Abschnitt 9.1). Die Studie ist vor allem eine
günstige **Ausschlussprüfung für einen starken Effekt**. Abschnitt 17 bewertet,
ob sich das lohnt.

## 3. Universum ohne Überlebens-Verzerrung

### 3.1 Grundsatz

- **Kandidaten** sind alle Spot-Symbole mit Quote USDT, die das öffentliche
  Binance-Archiv (`data.binance.vision`, `data/spot/monthly/klines/`) je
  geführt hat, **auch delistete, umbenannte und zusammengebrochene**.
- Wer an einem Stichtag dazugehört, entscheiden **nur Daten bis zum Vortag**.
  Kein Coin wird nach Namen, heutiger Größe, heutigem Listing-Status oder
  späterer Wertentwicklung ausgewählt.
- **Jedes Symbol ist ein eigenes Instrument.** Umbenennungen und Migrationen
  (z. B. MATIC → POL) werden nicht zusammengeklebt: Das alte Symbol endet, das
  neue beginnt mit neuer Historie.
- Ob das Archiv delistete Paare tatsächlich enthält, prüft D0 vor dem Download
  (Abschnitt 4.2).

### 3.2 Ausschlüsse (fest, vor jedem Datenabruf)

| Nr. | Gruppe | Regel |
|---|---|---|
| X1 | Stablecoins und Fiat | Basis-Asset in der festen Liste: USDC, BUSD, TUSD, USDP, PAX, DAI, FDUSD, USDD, UST, USTC, SUSD, USDS, USDSB, VAI, AEUR, EURI, USD1, RLUSD, PYUSD, USDE, BFUSD, XUSD, EUR, GBP, AUD, BRL, TRY, RUB, UAH, BIDR, IDRT, NGN, ZAR, BKRW |
| X2 | unerkannte Stablecoins | mechanisch: Verhältnis von höchstem zu tiefstem Tagesschluss der letzten 90 Tage < 1,03. Greift nur zusätzlich zu X1; jeder Treffer wird gelistet (D5) |
| X3 | Rohstoff-Token | PAXG, XAUT (Gold, eigene Anlageklasse laut Analyse Abschnitt 4) |
| X4 | gehebelte Token | Basis endet auf UP, DOWN, BULL oder BEAR **und** der Rest ist selbst ein Basis-Asset mit USDT-Paar im Archiv (z. B. BTCUP, ETHBEAR); außerdem die Basis BULL und BEAR selbst |
| X5 | Ableitungen von BTC/ETH | WBTC, WBETH, BETH (verpackte oder gestakte Kopien; sie würden den Querschnitt doppeln) |

- Die Listen werden nach dem Download **nicht** ergänzt oder verfeinert. Trifft
  X4 erkennbar einen echten Projekt-Token, bleibt er trotzdem ausgeschlossen;
  der Bericht nennt ihn. Ein unvollständiger Ausschluss kostet wenig, eine
  Auswahl nach dem Datenblick kostet die Glaubwürdigkeit.
- BTCUSDT und ETHUSDT gehören zum Universum. Die Strategie darf sie wählen.

### 3.3 Mindestanforderungen (an jedem Stichtag D, nur Daten bis D−1)

| Nr. | Anforderung | Wert |
|---|---|---|
| U1 | Historie | Instrument seit mindestens **90 Tagen** gehandelt (Instrumentbeginn nach der Lückenregel 4.3). Schließt Listing-Phasen mit ihren typischen Ausschlägen aus |
| U2 | Vollständigkeit | in den letzten 30 Tagen jede Tageskerze vorhanden, an jedem Tag Volumen > 0 und Zahl der Trades > 0 (kein Handelsstopp) |
| U3 | Liquidität | L30 = Median des täglichen Quote-Volumens (USDT) der letzten 30 Tage **≥ 5 000 000 USDT** |
| U4 | Breite | Universum Uₜ = die **50** zulässigen Instrumente mit dem höchsten L30; Gleichstand nach Symbolname |
| U5 | Markttiefe | Für Spot gibt es im freien Archiv keine Orderbuch-Historie. Ersatz: L30 bestimmt die Kostenstufe (Abschnitt 7), dazu als Bericht die Amihud-Kennzahl (Median \|Tagesrendite\| ÷ Quote-Volumen) und die Kapazität (M22) |

- **Warum diese Werte:** 50 Instrumente und eine Auswahl von 10 sind übliche
  Größen (oberstes Fünftel). 5 Mio. USDT Tagesvolumen bedeuten bei Orders von
  rund 2 000 USDT eine Beteiligung von 0,04 %, weit unter der Grenze von 1 % im
  Kostenmodell (`maxParticipationRate`). 90 Tage sind eine übliche
  Mindesthistorie. Kein Wert wurde an Daten geprüft.
- Die Mindestanforderungen gelten für Strategie und Kontrolle gleich.

## 4. Datenquellen, Datenprüfung und Lookahead-Schutz

### 4.1 Quellen (Download erst nach Freigabe, Schritt 1.3)

Alle Quellen sind öffentlich und kostenlos, ohne Konto, API-Schlüssel oder
Zustimmung zu Bedingungen. Die Archivdaten stehen unter CC BY-NC-SA 4.0. Sie
bleiben lokal und gitignoriert unter `data/market-snapshots/relative-strength-v1/`,
mit `sources.json` und SHA-256-Manifest. Committet wird keine Datei mit
Marktdaten. Nichts wird auf den VPS übertragen.

| Datensatz | Quelle | Zeitraum | Zweck |
|---|---|---|---|
| Verzeichnisliste aller Spot-Symbole | S3-Liste von `data.binance.vision`, Präfix `data/spot/monthly/klines/` | – | Kandidaten, D0 (nur Metadaten, keine Dateiinhalte) |
| Tageskerzen 1d aller USDT-Symbole | `data/spot/monthly/klines/<SYM>/1d/` mit `.CHECKSUM` | 2019-07 – 2026-09, je Symbol nur Monate seiner Handelszeit | Universum, Signal, Bewertung |
| fehlende Tage | `data/spot/daily/klines/<SYM>/1d/<SYM>-1d-YYYY-MM-DD.zip` mit `.CHECKSUM` | nur Tage nach Lückenregel 4.3 | Lückenfüllung |
| BTC/ETH für das Regime | **vorhandener** Snapshot `data/market-snapshots/real/`, kein neuer Download | ab 2018 | `RISK_ON`-Gate, wie in allen bisherigen Studien |
| `DTB3` | **vorhandene** Datei aus `carry-v2`, Abgleich gegen deren Manifest | 2020-01 – 2026-09 | Zinshürde B1/B2 |
| Champion/Challenger | **vorhandene** Benchmark-Datei aus Carry-Schritt 1.4 (Vergleich A, Output-Hashes `39095a44…` und `2a8b05fb…`), unverändert | 2020-01 – 2026-09 | B5 und Vergleich |

- **Umfang (Schätzung, nicht geprüft):** rund 600–800 USDT-Symbole, im Mittel
  rund 45 Monatsdateien je Symbol, also 50 000–70 000 Abrufe mit Prüfsummen,
  unter 200 MB. Bei höchstens 5 Abrufen je Sekunde dauert das einige Stunden.
  Die genaue Liste entsteht in Schritt 1.2 aus der Verzeichnisliste. Liegt der
  Umfang über dem Doppelten der Schätzung, wird vor dem Download nachgefragt.
- Kein Monat ab 2026-10 wird geladen. Alles ab 2026-10-15 bleibt dem Forward
  vorbehalten.
- **Zeitstempel:** Laut Archiv-Dokumentation sind Spot-Zeitstempel ab 2025 in
  Mikrosekunden statt Millisekunden. Vor dem Download an der Dokumentation zu
  bestätigen; D2 erkennt die Einheit je Datei.

### 4.2 Datenprüfung (vor jeder Renditeberechnung)

Die Prüfung läuft als eigener Schritt (1.4). Ihr Bericht enthält nur
Datenqualität: Zählungen, Lücken, Ausreißerlisten, Universumsgrößen. Renditen,
Signale, Rangfolgen oder Kennzahlen stehen nicht darin. Erst wenn die
blockierenden Prüfungen D0, D1, D2, D3, D6 und D7 bestanden sind, wird
gerechnet.

| Nr. | Prüfung | Toleranz | Behandlung |
|---|---|---|---|
| D0 | **Überlebens-Verzerrung**, schon an der Verzeichnisliste vor dem Download: Für jedes Paar der Kontrollliste existiert im Archiv mindestens eine Monatsdatei 1d im Jahr des Ereignisses. Kontrollliste (Ereignis laut Vorwissen, ungeprüft): ERDUSDT (Umstellung auf EGLD, 2020), LUNAUSDT (Zusammenbruch 2022), FTTUSDT (Zusammenbruch 2022), XMRUSDT (Delisting 2024), MATICUSDT (Migration zu POL, 2024). Die Liste prüft nur die Vollständigkeit des Archivs; sie bestimmt nicht das Universum | keine Abweichung | fehlt ein Paar, zuerst an öffentlichen Binance-Ankündigungen prüfen, ob es das USDT-Paar je gab. Gab es das Paar nie, wird es ohne Ersatz gestrichen und im Bericht genannt (Irrtum des Vorwissens). Fehlt ein nachweislich gelistetes Paar: Halt **vor** dem Download, `NICHT_AUSWERTBAR`; eine andere Quelle bräuchte eine neue Vorregistrierung. Bericht: Zahl aller USDT-Symbole, Zahl der Symbole mit Datenende vor 2026-09 |
| D1 | Jede erwartete Monats- und Tagesdatei vorhanden, SHA-256 gleich `.CHECKSUM` | BTCUSDT, ETHUSDT: keine Abweichung. Sonst ≤ 0,5 % der erwarteten Symbol-Monate | einmal neu laden. Bleibt die Abweichung, gilt der Monat als fehlend (Lückenregel). Bei Überschreitung `NICHT_AUSWERTBAR` |
| D2 | Format: Kopfzeile erkannt, 12 Spalten, Zeitstempel-Einheit je Datei (ms/µs) erkannt und vereinheitlicht, sortiert, keine Duplikate, Eröffnung um 00:00 UTC, Tief ≤ Eröffnung/Schluss ≤ Hoch, Volumen ≥ 0 | ≤ 0,1 % fehlerhafte Zeilen | Fehlerhafte Zeilen gelten als fehlender Tag. Bei Überschreitung `NICHT_AUSWERTBAR` |
| D3 | Lücken nach der Lückenregel 4.3, nach Ergänzung aus dem Tagesarchiv | ≤ 0,5 % fehlende Symbol-Tage innerhalb der Handelszeiten im Fenster; BTCUSDT und ETHUSDT ohne fehlenden Tag; kein Tag, der bei mehr als der Hälfte der aktiven Symbole fehlt | Behandlung nach 4.3. Bei Überschreitung `NICHT_AUSWERTBAR` |
| D4 | Instrumentbrüche und Sprünge: jede Lücke ≥ 7 Tage, jeder Tagessprung ≥ ×10 nach oben (beides beendet das Instrument, 4.3), jeder Tagesverlust ≤ −90 % (nicht entfernt) | – | gelistet |
| D5 | Ausschlüsse X1–X5 je Symbol mit Regel; alle Treffer von X2 und X4 | – | gelistet, nicht nachträglich geändert |
| D6 | Abgleich BTCUSDT/ETHUSDT: Tagesschluss im Archiv gleich dem Tagesschluss des vorhandenen Snapshots (\|relative Abweichung\| ≤ 10⁻⁸) | ≤ 0,1 % abweichende Tage | Abweichungen gelistet. Bei Überschreitung `NICHT_AUSWERTBAR` |
| D7 | Regime-Nachbildung `crypto-native-regime-v1` (Python wie in `funding-carry-v2`): Tage je Label im Fenster genau wie im Carry-Bericht, `RISK_ON` 829, `NEUTRAL` 633, `MIXED` 275, `RISK_OFF` 728 | exakt | sonst Halt und Fehlersuche, keine Rendite |
| D8 | Kostenstufen-Plausibilität (nur Bericht): Spread-Schätzer nach Abdi/Ranaldo (2017) aus Tagesschluss, -hoch und -tief, Median je Symbol und Monat, verglichen mit der angenommenen Spanne der Stufe | – | Liegt der Median einer Stufe über dem Doppelten der Annahme, wird das gemeldet. Die Kosten ändern sich nicht; den Schutz bietet der Kostenstress (B6) |
| D9 | Universum: Größe von Uₜ je Monat (Minimum, Median, Maximum), Zahl verschiedener Mitglieder, Anteil der Tage mit Uₜ < 20 | – | nur Bericht |
| D10 | Ergänzte Tage aus dem Tagesarchiv je Symbol; Kerzen außerhalb ihres Tages; Tage in beiden Quellen | – | nur Bericht |

### 4.3 Lückenregel (aus dem Carry gelernt: Monatsarchive lassen ganze Tage aus)

1. **Primärquelle** ist das Monatsarchiv.
2. **Fehlender Tag:** ein UTC-Tag zwischen der ersten und der letzten Kerze
   eines Symbols, für den die Monatsdatei keine Kerze enthält. Er wird aus
   **genau** der Tagesdatei dieses Tages ergänzt, wenn sie vorhanden ist und
   ihre Prüfsumme stimmt. Liegt ein Tag in beiden Quellen vor, gilt das
   Monatsarchiv.
3. **Restlücke von 1–6 Tagen** (Handelsunterbrechung):
   - Bewertung mit dem letzten Schlusskurs, kein Handel in diesem Symbol.
   - Ein nötiger Ausstieg erfolgt zur nächsten vorhandenen Eröffnung.
   - Das Symbol ist erst wieder zulässig, wenn U2 erfüllt ist.
4. **Lücke von 7 Tagen oder mehr** oder **Tagessprung ≥ ×10 nach oben:**
   - Das Instrument **endet** mit seiner letzten Kerze davor.
   - Was danach kommt, ist ein **neues Instrument** mit neuer Historie (U1).
   - So kann ein wiederverwendetes Symbol (etwa LUNAUSDT nach dem
     Zusammenbruch) nie eine scheinbare Rendite über den Bruch erzeugen.
   - Starke Verluste ohne Lücke sind echt und bleiben stehen.
5. **Keine Interpolation**, keine andere Quelle, kein Zusammenführen von
   Symbolen.

### 4.4 Lookahead-Schutz

- **Stichtag** D = täglich 00:00 UTC. Bekannt sind nur Tageskerzen, die vor D
  geschlossen haben.
- **Regime-Label** des Tages D aus den BTC/ETH-Tagesschlüssen bis D−1, genau wie
  in `regime_labels` der Carry-Werkzeuge.
- **Universum, Signal und Rang** aus Kerzen bis D−1.
- **Ausführung zur Eröffnung** der Tageskerze D, mit den Kosten aus
  Abschnitt 7.
  - Das ist die übliche Konvention für Tagesdaten.
  - Weil Signal und Ausführungskurs fast zusammenfallen, prüft B6 zusätzlich
    die Ausführung einen Tag später.
- **Bewertung** zum Tagesschluss.
- **Champion/Challenger** stammen aus der unveränderten Benchmark-Datei.
  Nichts aus den neuen Daten fließt dort ein.
- **Keine Parameterwahl auf Daten:** Alle Werte stehen in Abschnitt 5.4 und
  ändern sich nach dem Download nicht.

## 5. Strategie: genau zwei Varianten

### 5.1 Gemeinsame Mechanik

- **Gate:** investiert nur an Tagen mit Label `RISK_ON`. Bei
  `crypto-native-regime-v1` hat `RISK_ON` stets Risk Mode `NORMAL` oder
  `AGGRESSIVE` und Confidence 65 oder 90. Ein Long besteht R-020 an diesen
  Tagen also immer, an allen anderen nie.
- **Signal:** Rendite über 28 Tage, r₂₈ = Schluss(D−1) ÷ Schluss(D−29) − 1.
  - Fehlt der Anfangskurs (Restlücke), gilt der letzte vorhandene Schlusskurs
    davor.
- **Rang:** innerhalb von Uₜ nach r₂₈ absteigend; Gleichstand nach Symbolname.
- **Anzahl Positionen** N = 10, **Puffer** 2N = 20.
- **Einstieg (Aufbau):** am ersten `RISK_ON`-Tag einer Phase.
  - Gekauft werden die 10 bestplatzierten Mitglieder von Uₜ, je 1/10 des
    Eigenkapitals.
  - Hat Uₜ weniger als 10 Mitglieder, werden alle gleichgewichtet gehalten.
    Die Strategie gleicht dann der Kontrolle.
- **Neuranking** an den Terminen der Variante, nur während `RISK_ON`:
  - Eine Position bleibt, solange ihr Instrument in Uₜ ist und Rang ≤ 20 hat.
  - Sonst wird sie verkauft.
  - Frei gewordene Plätze füllen die bestplatzierten nicht gehaltenen
    Mitglieder, bis 10 Positionen erreicht sind.
- **Gewichtung neuer Positionen:** je min(1/10 des Eigenkapitals; verfügbare
  Kasse ÷ Zahl der Neuzugänge).
  - Gehaltene Positionen werden **nie nachgewichtet**. Das entspricht dem
    Verbot des Nachkaufs (R-022) und spart Umschlag.
  - Übrige Kasse bleibt Kasse bis zum nächsten Termin.
- **Ausstieg:**
  - Endet `RISK_ON` (Label von D ≠ `RISK_ON`), wird alles zur Eröffnung von D
    verkauft.
  - Beim Neuranking: Rang > 20 oder nicht mehr in Uₜ.
  - **Instrumentende** (Delisting, Bruch nach 4.3): Zwangsschließung zum
    letzten vorhandenen Schlusskurs, Kostenstufe L3. Der Platz bleibt bis zum
    nächsten Termin Kasse.
  - **Kein Stop-Loss, kein Kursziel, keine Haltefrist.** Jede davon wäre ein
    weiterer Parameter.
- **Mindestorder** 10 USDT; kleinere Orders entfallen.
- **Mengen** werden nicht auf Schrittgrößen gerundet. Bei 2 000 USDT je Order
  ist das vernachlässigbar.
- **Kasse** verzinst sich nicht, wie im Shadow-Ledger. Der Geldmarkt dient als
  Hürde (B1/B2).
- **Ende:** Offene Positionen werden zum Schluss des 2026-09-30 mit
  Ausstiegskosten glattgestellt. Gerechnet wird mit dem Liquidationswert.

### 5.2 Variante A — `XS_MOM_28D_WEEKLY`

- Neuranking **jeden Montag** (Label-Tag Montag, Ausführung zur Eröffnung).
- Prüft, ob sich häufiges Umschichten nach dem kurzfristigen Signal lohnt.

### 5.3 Variante B — `XS_MOM_28D_4WEEKLY`

- Neuranking **jeden vierten Montag**, gezählt ab Montag, 2020-01-06.
- Weil `RISK_ON`-Phasen im Mittel nur gut zwei Wochen dauern, heißt das
  meist: **Auswahl beim Einstieg, halten bis zum Ende der Phase.**
- Prüft, ob die Auswahl beim Einstieg genügt und die Zusatzkosten von A sich
  sparen lassen.

### 5.4 Fest und nie variiert

28 Tage Rückschau, N = 10, Puffer 20, Universum 50, Liquiditätsschwelle
5 Mio. USDT (Median 30 Tage), Historie 90 Tage, Ausschlusslisten X1–X5,
Wochen- bzw. Vierwochentakt mit Montag als Termin, Gleichgewichtung beim
Einstieg ohne Nachgewichtung, Ausführung zur Tageseröffnung, Kostenstufen aus
Abschnitt 7, Lückenregel 4.3.

- Keine weitere Rückschaulänge, Positionszahl, Pufferbreite,
  Universumsgröße, Schwelle, Gewichtung oder Taktung.
- Keine Sensitivitätsläufe über diese Werte, auch nicht „nur zur
  Information“. Jeder zusätzliche Lauf wäre ein Gabelungspfad.
- Die Robustheitsprüfungen in B6 (Kosten ×2, Delisting, Ausführung +1 Tag)
  ändern keine Entscheidung der Strategie. Nur die +1-Tag-Prüfung verschiebt
  die Ausführung aller Strategien gleich.

## 6. Kontrolle und Referenzen

Die Kontrolle beantwortet die Kernfrage: **Kommt ein Vorteil aus der Auswahl
oder nur aus mehr Krypto-Engagement?**

| Kürzel | Reihe | Regeln | Rolle |
|---|---|---|---|
| K_A, K_B | **Kontrolle** `EW_UNIVERSE_RISK_ON` | dasselbe Gate, dasselbe Universum Uₜ, dieselbe Ausführung und dieselben Kosten wie die Variante. Hält **alle** Mitglieder von Uₜ gleichgewichtet, ohne Signal. Termine wie die jeweilige Variante (K_A wöchentlich, K_B alle vier Wochen): Wer Uₜ verlässt, wird verkauft; Neuzugänge erhalten je min(1/\|Uₜ\| des Eigenkapitals; Kasse ÷ Zahl der Neuzugänge); keine Nachgewichtung | B3, B4, B6 |
| R | **BTC/ETH-Referenz** `BTC_ETH_RISK_ON` | dasselbe Gate und dieselbe Ausführung; beim Einstieg 50 % BTCUSDT, 50 % ETHUSDT, keine Nachgewichtung; Kostenstufe L1 | B3 |
| – | BTC/ETH Kaufen und Halten | 50/50 ab 2020-01-01, ohne Gate und ohne Umschichtung, Kosten L1 bei Kauf und Schluss | nur Bericht |
| – | Champion `CRYPTO_TREND_CORE_LONG_V1`, Challenger `CRYPTO_REGIME_LONG_V1` | Monatsrenditen und Kapitalbindung aus der Benchmark-Datei (Vergleich A, 20 000 USDT je Platz, Kasse 0 %) | B5, Vergleich |
| – | Geldmarkt | `DTB3`, täglich verzinst auf den ganzen Platz | B1/B2, Vergleich |

- Kontrolle und Variante haben **dieselbe Exposition**: gleiche Tage, gleiche
  Investitionsquote, gleiches Universum, gleiche Kostenstufen-Logik. Der
  Unterschied ist allein die Auswahl der 10 aus bis zu 50.
- Die Kontrolle hat **mehr Positionen** (bis zu 50). Ihr Ertrag ist deshalb
  ruhiger, aber im Erwartungswert ohne Auswahl gleich. Die Konzentration auf
  10 Titel erhöht die Schwankung; B4 begrenzt das.
- **Zusätzliche Gegenprobe (nur Bericht):** 1 000 Zufallsportfolios mit
  derselben Mechanik (N, Puffer, Takt, Kosten). Statt des Signals entscheidet
  ein Zufallsrang je Termin, fester Seed 20261017. Ausgewiesen wird der Anteil
  der Zufallsportfolios mit höherer Selektionsrendite als die Variante. Das ist
  ein verteilungsfreier Abgleich für den t-Test in B3, kein Kriterium.

## 7. Kostenmodell (je Symbol)

**Basis ist `BINANCE_SPOT_VIP0_ESTIMATE_V1`**, unverändert wie im offiziellen
Forward-Test: 10 bp Gebühr je Seite, 2 bp Spread (voll), 3 bp Slippage je
Seite, also 14 bp je Seite. Es ist auf BTC/ETH kalibriert. Für weniger liquide
Paare wären Spread und Slippage zu optimistisch. Deshalb wird je Symbol und
Handelstag aus der eigenen Liquidität bis zum Vortag eine Stufe bestimmt:

| Stufe | Bedingung (L30 bis D−1) | Gebühr | Spread (voll) | Slippage | je Seite | Round-Trip |
|---|---|---:|---:|---:|---:|---:|
| L1 | ≥ 100 Mio. USDT | 10 bp | 2 bp | 3 bp | **14 bp** (= VIP0-Schätzung) | 28 bp |
| L2 | 20–100 Mio. USDT | 10 bp | 10 bp | 10 bp | **25 bp** | 50 bp |
| L3 | < 20 Mio. USDT, **oder** Kursschritt-Ersatz > 10 bp, **oder** Zwangsschließung | 10 bp | 20 bp | 20 bp | **40 bp** | 80 bp |

- **Kursschritt-Ersatz:** kleinste positive Differenz zwischen zwei Kursen
  (Eröffnung, Hoch, Tief, Schluss) der letzten 30 Tage, geteilt durch den
  letzten Schluss. Er überschätzt den echten Kursschritt eher und erfasst
  Münzen mit sehr kleinem Stückpreis, bei denen schon ein Kursschritt teuer
  ist.
- **Gebühr:** Die VIP0-Spotgebühr gilt für alle Paare, ohne BNB-Rabatt und
  ohne zeitweise Null-Gebühr-Aktionen. Vor dem Download wird sie an der
  offiziellen Gebührentabelle bestätigt. Weicht diese ab, gilt der **höhere**
  Wert.
- Die Stufen L2/L3 sind **Annahmen vor den Daten**. D8 vergleicht sie nur
  berichtend mit einem Schätzer aus Tageskursen. Geändert wird nichts; gegen zu
  niedrige Annahmen schützt der Kostenstress ×2 (B6).
- **Kostenstress:** alle Ausführungskosten aller Strategien × 2 (wie
  `INCREMENT_COST_STRESS`), dieselben Handlungen. Das entspricht grob 20 bp
  Gebühr je Seite, also eher dem Niveau eines erreichbaren EU-Handelsplatzes
  (Abschnitt 12).
- **Nicht modelliert:** Ein- und Auszahlungen, Überweisungen,
  EUR/USDT-Umtausch, Steuern.

## 8. Kapital, Kapitalbindung und fairer Vergleich

**Bezugsgröße.** Jede Strategie und Kontrolle erhält einen Platz von
20 000 USDT und ist in `RISK_ON` **voll investiert** (Exposure 1,0); sonst liegt
das Kapital als Kasse zu 0 %.

- Selektionsrendite, Sharpe, α-t und Korrelationen hängen von der
  Investitionsquote nicht ab. Für die Kernfrage ist die Quote deshalb gleich.
- **Die Zinshürde gilt auf das ganze Kapital**, wie beim Carry. Eine
  `RISK_ON`-Strategie muss jederzeit einsteigen können. Ihr Kapital liegt also
  dauerhaft an der Börse und verdient dort nichts. Dieselbe Summe brächte im
  Geldmarkt `DTB3`.
- **Skalierung ist eine spätere Risiko-Entscheidung.** Übertrüge man die
  heutigen Grenzen auf Altcoins, lägen höchstens 30 % in der
  Korrelationsgruppe (R-015) und 20 % je Asset (R-014). Bei voller Investition
  wäre der Drawdown erwartbar groß. Netto über Geldmarkt skaliert näherungsweise mit der Quote; das
  Vorzeichen von B1/B2 hängt von ihr nicht ab.
- **Kapitalbindung:** Die Varianten binden im Mittel rund 34 % des Platzes
  (Zeit in `RISK_ON`), der Challenger 2,1 %, der Champion 0,9 % (Carry-Bericht).

**Drei Sichten im Vergleich (Bericht):**

1. **Gleicher Platz:** 20 000 USDT je Reihe, jede mit ihrer eigenen Größe.
   Zeigt den absoluten Betrag in USDT.
2. **Gleiche Exposition:** Variante, Kontrolle und R mit identischem Gate und
   identischer Quote. Entscheidend für die Auswahlfrage (B3).
3. **Gleiches Risiko:** Überschussrendite über `DTB3` bei 10 % Volatilität p. a.
   (= 10 % × Sharpe der monatlichen Überschussrenditen). Dazu je Reihe die
   Investitionsquote, bei der der maximale Drawdown 10 % betragen hätte (die
   Gates-v4-Grenze `PORTFOLIO_DRAWDOWN`), und das Netto über Geldmarkt bei
   dieser Quote.

**Vergleichstabelle (Bericht):** A, B, K_A, K_B, R, BTC/ETH Kaufen und Halten,
Champion, Challenger, Geldmarkt. Spalten: Netto p. a. gesamt, 2020–2023 und
seit 2024; Netto − Ø `DTB3`; Sharpe (Monatsbasis); max. Drawdown;
schlechtester Monat; Ø Kapitalbindung; Netto ÷ Kapitalbindung; Netto ÷ max.
Drawdown; Überschuss bei 10 % Volatilität; Investitionsquote für 10 %
Drawdown; Korrelation mit dem Challenger; β zu BTC; Kosten ÷ Brutto.

## 9. Kennzahlen

Alle Kennzahlen gibt es je Variante und je Kontrolle. Monatswerte gelten für
volle Kalendermonate; Renditen sind Eigenkapitalverhältnisse. Die
**Selektionsrendite** ist die Rendite der Variante minus die Rendite ihrer
Kontrolle im selben Zeitraum.

| Nr. | Kennzahl | Definition | Rolle |
|---|---|---|---|
| M1 | Netto p. a. | CAGR des Eigenkapitals (Liquidationswert am Ende) über 365,25 Tage; Zerlegung in Brutto, Gebühr, Spread, Slippage | B1–B4 |
| M2 | Sharpe | tägliche Nettorenditen × √365 und monatliche × √12, ohne Zins (Projektkonvention); dazu Sharpe der Überschussrenditen über `DTB3` | B3, Bericht |
| M3 | max. Drawdown | auf Tageswerten; dazu längste Erholungsdauer | B4 |
| M4 | schlechtester Monat, schlechteste Woche | auch für die Selektionsrendite | Bericht |
| M5 | Anteil negativer Monate | nur Monate mit mindestens einem `RISK_ON`-Tag | Bericht |
| M6 | Kalenderjahre | 2020 … 2026 (2026 bis September): `RISK_ON`-Tage, Netto, Selektionsrendite, Kosten | B6 |
| M7 | seit 2024 | alle Hauptkennzahlen für 2024-01 – 2026-09 gegen 2020–2023 | B2, Bericht |
| M8 | Selektions-α | `spanningAlphaTest` der Variante auf ihre Kontrolle (Abschnitt 10): α, t, β, Monate, Teilfenster | B3 |
| M9 | Mehrertrag gegenüber R | Netto und Sharpe der Variante gegen R; Zerlegung nach 2.1 in (K − R) und (Variante − K) | B3 |
| M10 | eigener Ertrag gegenüber Bestand | `spanningAlphaTest` auf Champion und Challenger, wie `OWN_ALPHA` | B5 |
| M11 | Korrelationen | Pearson und Spearman der Monatsrenditen mit Challenger und Champion, roh und für die Selektionsrendite | B5 (Selektionsrendite gegen Challenger) |
| M12 | Umschlag | Termine, Ø getauschter Anteil je Termin, Umschlag p. a., Kosten ÷ Brutto, Kostenanteil aus Gate-Wechseln gegenüber Neuranking | Bericht (Abschnitt 2.2) |
| M13 | Kostenstufen | Anteil des gehandelten Volumens in L1/L2/L3, Ø Kosten je Seite, Zahl der L3-Fälle durch den Kursschritt-Ersatz | Bericht |
| M14 | Universum und Delistings | Uₜ je Monat, Zahl gehaltener Instrumente, Zwangsschließungen mit Datum, Symbol und Ergebnis | Bericht |
| M15 | Konzentration | Beitrag des besten Instruments und der besten 5 zur Gesamtrendite; Ergebnis ohne das beste Instrument | Bericht |
| M16 | Kapitalbindung | Ø investierter Anteil; Netto ÷ Kapitalbindung | Bericht |
| M17 | Kostenstress | alle Ausführungskosten × 2 | B6 |
| M18 | Delisting-Stress | jede Zwangsschließung mit Erlös 0 (Totalverlust der Position) | B6 |
| M19 | Ausführung +1 Tag | alle Ausführungen aller Strategien, auch des Gates, zur Eröffnung des Folgetags | B6 |
| M20 | Netto nach Abschlag, Überschuss über `DTB3` | M1 − 1,5 pp (pessimistisch auch − 3,0 pp) − Ø `DTB3` | B1, B2 |
| M21 | gleiche Risiko-Sicht | Abschnitt 8, Sicht 3 | Bericht |
| M22 | Kapazität | größter Platz, bei dem jede Order ≤ 1 % des Quote-Volumens ihres Tages geblieben wäre | Bericht |
| M23 | Signalgüte | mittlerer Rang-IC zwischen r₂₈ und der Rendite bis zum nächsten Termin, nur `RISK_ON`-Termine, mit t | Bericht (Abgleich mit 2.3) |
| M24 | Zufalls-Gegenprobe | Abschnitt 6 | Bericht |

## 10. Bestehens- und Abbruchkriterien

### 10.1 Harte Kriterien

Für jede Variante, Fenster 2020-01-01 bis 2026-09-30, sofern nichts anderes
steht. **Alle** müssen erfüllt sein.

| Nr. | Kriterium | Bestanden, wenn |
|---|---|---|
| B1 | Wirtschaftlichkeit gesamt | Netto p. a. − 1,5 pp (Abschlag) − Ø `DTB3` > 0 |
| B2 | Wirtschaftlichkeit seit 2024 | dasselbe für 2024-01-01 – 2026-09-30, mit Ø `DTB3` dieses Zeitraums |
| B3 | **Auswahlvorteil** | (a) Selektions-α gegen die eigene Kontrolle: t ≥ max(2; √(2·ln 57); t₀,₉₇₅ mit n − 2 FG) ≈ **2,84**, mindestens 24 Monate mit eigenem Ertrag, α̂ > 0 in 2020–2023 **und** in 2024–2026-09; **und** (b) Netto p. a. der Variante > Netto p. a. der Kontrolle; **und** (c) Netto p. a. ≥ R und Sharpe ≥ R |
| B4 | Verlustbegrenzung | max. Drawdown ≤ 1,25 × max. Drawdown der Kontrolle **und** Netto ÷ max. Drawdown ≥ dem Wert der Kontrolle |
| B5 | eigener Ertrag gegenüber dem Bestand | α-t gegen Champion und Challenger ≥ max(2; √(2·ln 57); t₀,₉₇₅ mit n − 3 FG) ≈ **2,84**, mindestens 24 Monate mit eigenem Ertrag, α̂ > 0 in beiden Teilfenstern; **und** Pearson-Korrelation der monatlichen **Selektionsrendite** mit dem Challenger ≤ 0,5 |
| B6 | Stetigkeit und Robustheit | (a) Selektionsrendite > 0 in mindestens zwei Dritteln (aufgerundet) der Kalenderjahre mit ≥ 30 `RISK_ON`-Tagen; (b) ohne das beste dieser Jahre bleibt die Summe der jährlichen Selektionsrenditen > 0; (c) bei Kosten × 2: Netto > Kontrolle und B1 erfüllt; (d) unter Delisting-Stress: Netto > Kontrolle; (e) bei Ausführung +1 Tag: Netto > Kontrolle |

**Methode `spanningAlphaTest`** wie in `packages/evolution/src/paired.ts` und
in der Carry-Studie nachgebildet:

- Monatsrenditen der Variante auf die Monatsrenditen der Faktoren
  regressiert;
- Standardfehler max(iid, Newey–West), Lag ⌊4·(n/100)^(2/9)⌋, bei n = 81
  also 3;
- Teilfenster nur mit dem Vorzeichen von α̂.

**Herkunft der Schwellen:**

- **B1/B2** wie beim Carry: Ein Ertrag, der nach dem Abschlag nicht über dem
  Geldmarkt liegt, ist kein zusätzlicher Ertrag.
- **B3** ist das Kernkriterium aus dem Auftrag (Kontrollstrategie). Seine
  Schwelle ist die von `OWN_ALPHA`, mit derselben Mehrfachtest-Korrektur.
- **B4** übersetzt `PORTFOLIO_DRAWDOWN` aus Gates v4 („Rendite ÷ Drawdown nicht
  schlechter, Drawdown begrenzt“). Die absolute 10-%-Grenze hängt hier an der
  Investitionsquote und ist deshalb relativ zur Kontrolle gefasst.
  1,25 ist ein Ermessenswert.
- **B5** wie `OWN_ALPHA`; die Korrelationsgrenze 0,5 stammt aus Gates v1
  („Gegen Champion“). Sie gilt hier für die **Selektionsrendite**, nicht für
  die Rohrendite. Die Rohrendite teilt Gate und Krypto-Beta mit dem
  Challenger und wäre konstruktionsbedingt höher korreliert (offener Punkt F2).
- **B6:** Zwei Drittel der Jahre und „ohne das beste Jahr“ sind
  Ermessenswerte gegen einen Effekt, der nur aus einer einzigen Altcoin-Saison
  stammt.
- Alle Werte wurden vor jedem Datenabruf gesetzt und nie an Daten geprüft.

### 10.2 Ergebnisklassen

| Klasse | Bedingung |
|---|---|
| `BESTANDEN` | mindestens eine Variante erfüllt B1–B6, **und** Phase 1B ergibt `VERFUEGBAR` (Abschnitt 12) |
| `BESTANDEN_REFERENZ` | B1–B6 erfüllt, Phase 1B aber nicht `VERFUEGBAR`: am Referenzmarkt plausibel, für das Konto nicht belegt. Phase 2 nur auf ausdrücklichen Beschluss als reine Forschung |
| `KOMPRIMIERT` | alles erfüllt außer B2 und/oder der Bedingung „α̂ > 0 seit 2024“ in B3 oder B5: Den Vorteil gab es, seit 2024 trägt er nicht mehr |
| `NICHT_BESTANDEN` | sonst |
| ↳ Unterfall `NUR_BETA` | keine Variante erfüllt B3, aber eine Kontrolle erfüllt B1: Der Ertrag kam aus dem Engagement, nicht aus der Auswahl. Das ist eine Information für eine Risiko-Entscheidung, **kein** Vorteil |
| `NICHT_AUSWERTBAR` | D0, D1, D2, D3, D6 oder D7 verletzt; es werden keine Renditen berechnet |

### 10.3 Auswahl bei zwei bestandenen Varianten

Es gilt **B**, weil sie weniger handelt. A gilt nur, wenn ihr Netto p. a.
mindestens 1,0 pp über dem von B liegt **und** ihr max. Drawdown nicht größer
ist.

### 10.4 Abbruch, Einmaligkeit und Umfang

- **`NICHT_BESTANDEN` (auch `NUR_BETA`) oder `KOMPRIMIERT`:** Die relative
  Stärke in dieser Form ist geschlossen.
  - Kein zweiter Versuch auf derselben Historie: keine andere Rückschau,
    Positionszahl, Puffer, Universumsgröße, Schwelle, Gewichtung, Taktung,
    Gate oder Börse.
  - Eine neue Prüfung ist nur auf Forward-Daten zulässig, frühestens 12 Monate
    nach 2026-10-15 und mit neuer Vorregistrierung.
  - Die marktneutrale Frage bleibt davon unberührt (Abschnitt 1).
- **`NICHT_AUSWERTBAR`:** Die Arbeit endet vor jeder Renditeberechnung. Eine
  andere Datenquelle braucht eine neue Vorregistrierung.
- **Stopp und Rückfrage beim Betreiber:**
  - sobald ein Abruf Geld, ein Konto, einen API-Schlüssel oder die Zustimmung
    zu Bedingungen verlangen würde;
  - wenn D0 an der Verzeichnisliste scheitert, noch vor dem Download;
  - wenn der Download-Umfang mehr als doppelt so groß ist wie geschätzt.
- **Keine Zwischenblicke.** Renditen werden erst berechnet, wenn die
  blockierenden Prüfungen bestanden sind, und dann in **einem** Lauf für beide
  Varianten, beide Kontrollen und alle Referenzen.
- **Fehlerkorrektur:** Findet sich nach dem Lauf ein reiner
  Implementierungsfehler gegenüber diesem Dokument, ist **ein** korrigierter
  Lauf zulässig. Der Bericht nennt beide Ergebnisse und den Fehler. Eine
  inhaltliche Änderung ist eine V2.
- **Begrenzter Umfang:** zwei Varianten, ein Lauf, 0 USD, kein
  KI-Forschungslauf, keine Änderung an Produktcode.

## 11. Im Shadow unsichtbare Realrisiken und Abschlag

Die Simulation kennt keine Börsenausfälle, keine Token-Hacks außerhalb der
Kursdaten und keine Abweichung von USDT. Deshalb gilt wie beim Carry ein
**fester Abschlag von 1,5 pp p. a. auf das gesamte Platzkapital** (B1, B2):

- 1,0 pp für Börsen- und Gegenparteirisiko: Das ganze Kapital liegt an der
  Börse, um jederzeit einsteigen zu können (Abschnitt 8).
- 0,5 pp für Ereignisrisiken: Delisting-Ankündigungen mit Kurssturz,
  Token-spezifische Hacks, USDT.

Pessimistisch werden 3,0 pp ausgewiesen (nur Bericht). Der Abschlag ist eine
**Annahme**, nicht gemessen. Er steht hier, damit er nicht nach dem Ergebnis
gewählt wird.

| Risiko | Im Shadow sichtbar? | Behandlung |
|---|---|---|
| Delisting, Zusammenbruch eines Tokens | teilweise: Kurse bis zum letzten Handelstag | Zwangsschließung (5.1), Delisting-Stress mit Totalverlust (B6) |
| Momentum-Crash: gehaltene Gewinner stürzen gemeinsam | ja | B4, M4, M15 |
| Liquiditätsengpass im Crash, breitere Spreads | nein, Kosten fest je Stufe | Kostenstufen, Kostenstress × 2 |
| Pump-and-Dump in kleineren Coins | teilweise | Universum 50, Schwelle 5 Mio., 90 Tage Historie |
| Börse oder Gegenpartei | nein | Abschlag 1,0 pp |
| Stablecoin: USDT weicht vom Dollar ab | nein | Abschlag. USDT ist in der EU nicht MiCA-konform; EU-Plätze rechnen in EUR oder USDC |
| Währung: Anleger in EUR | nein | nicht im Kriterium (Studie rechnet in USDT) |
| Steuer: In Deutschland sind Kursgewinne aus Krypto nach verbreiteter Auffassung nach einem Jahr Haltedauer steuerfrei (§ 23 EStG). Eine Strategie mit Haltedauern von Wochen realisiert fast alles steuerpflichtig, Kaufen und Halten nicht | nein | nicht Teil der Studie, keine Steuerberatung; vor Phase 2 zu klären |
| Übertragbarkeit: Binance ist für ein deutsches Konto nicht erreichbar | nein | Phase 1B |
| Marktwirkung bei größerem Kapital | bei 20 000 USDT vernachlässigbar | M22 |

## 12. Erreichbarkeit für ein Konto in Deutschland (Phase 1B)

**Kernbefund vorab: Binance ist auch hier nur Referenzmarkt.** Laut Carry-
Vorregistrierung (Abschnitt 10, Sekundärquellen) hat Binance keine
MiCA-Zulassung und ist für EU-Kunden seit 2026-07-01 stark eingeschränkt. Die
Studie misst, ob es den Auswahlvorteil am tiefsten Markt gab. Ob ein deutsches
Privatkonto ihn abschöpfen kann, ist eine eigene Frage:

- **Kleineres Universum.** EU-Plätze führen meist weniger Altcoins als Binance.
- **Höhere Gebühren.** Nach Kenntnisstand des Sprachmodells (ungeprüft)
  liegen die Taker-Gebühren der untersten Stufe auf EU-Plätzen deutlich über
  den 10 bp von Binance VIP0.

**Kandidaten** (alle ungeprüft, in 1B an Primärquellen zu bestätigen): Kraken
(EU), Bitvavo, Coinbase, Bitpanda, OKX Europe, Bybit EU. Bitget bleibt
ausgeschlossen ([ADR 0007](../decisions/0007-bitget-is-conditional-not-approved.md)).

**Prüffragen je Kandidat** (Primärquelle und Datum):

1. Zugang für Wohnsitz Deutschland als Privatkunde; Aufsicht, MiCA-Zulassung,
   Registereintrag.
2. Heute gelistete Spot-Paare. Welcher Anteil des gehandelten Volumens der
   Variante entfällt auf Coins, die dort heute handelbar sind? Das ist nur ein
   grober Ersatz: Delistete Coins fehlen dort ohnehin.
3. Gebühren der untersten Stufe für Maker und Taker.
4. Lesende API für Marktdaten ohne Konto.

**Ergebnis der Phase 1B:**

- **`VERFUEGBAR`** verlangt einen Kandidaten mit:
  - „ja“ bei Prüffrage 1;
  - mindestens 80 % des gehandelten Volumens in dort handelbaren Coins;
  - Netto der Variante > Netto der Kontrolle auch mit der dortigen
    Taker-Gebühr statt 10 bp. Das ist analytisch auf denselben Trades
    gerechnet, ohne neuen Lauf.
- **`NICHT_VERFUEGBAR`:** sonst.

**Wer prüft was:** Claude prüft nur öffentlich (Bedingungen, Register,
Gebührentabellen). Ob das eigene Konto berechtigt ist, prüft der Betreiber
selbst. Claude eröffnet kein Konto, erzeugt keinen API-Schlüssel, akzeptiert
keine Bedingungen und platziert keine Order. Regionale Sperren werden nie
umgangen.

## 13. Mehrfachtest-Zähler, vorbelastete Zeiträume und Vorwissen

**Mehrfachtest-Zähler.** Stand N = 55 (53 aus Vorforschung und Evolution,
plus die zwei Carry-Varianten, [Carry-Bericht](2026-10-17-funding-carry-v2-results.md),
Abschnitt 1). Die zwei Varianten dieser Studie werden konservativ mitgezählt:
**N = 55 → 57**, wenn ausgewertet wird, Schwelle √(2·ln 57) = 2,84. Wird nicht
ausgewertet (`NICHT_AUSWERTBAR`), bleibt N = 55. Kontrollen, Referenzen und die
Zufalls-Gegenprobe sind keine Kandidaten und zählen nicht. Der Zähler wird nie
zurückgesetzt. Die Evolution Engine kennt diese Varianten nicht; die nächste
Evolution-Vorregistrierung muss sie ausdrücklich mitzählen, ebenso die zwei
Carry-Varianten.

**Vorbelastete Zeiträume und Daten:**

| Daten | Zeitraum | Status |
|---|---|---|
| BTC/ETH Spot 1h/1d | 2018-04 – 2026-10-14 | **verbraucht**: Vorforschung, Evolution (Entdeckung + Validierung), Holdout als `PREVIOUSLY_ANALYZED` markiert, Analyse vom 2026-10-16, Carry |
| Regime-Labels `crypto-native-regime-v1` | 2020-01 – 2026-09 | **bekannt**, auch die Zählung (829 Tage `RISK_ON`) |
| Champion/Challenger-Monatsrenditen | 2020-01 – 2026-09 | **bekannt** (Carry-Bericht); nur Vergleichsgröße |
| `DTB3` | 2020-01 – 2026-09 | **bekannt** (Carry); ohne Bezug zu einer Strategieregel |
| Funding, Perp-, Mark- und Indexkerzen | 2019-09 – 2026-09 | verbraucht (Carry); hier nicht verwendet |
| Dev-Datenbank, 8 Altcoins 1d (ETH, SOL, XRP, BNB, ADA, DOGE, LINK, AVAX) | 2025-07-29 – 2026-10-14 | **vorbelastet in der Struktur** (Korrelation, Beta, Volatilität laut Analyse), keine mittleren Renditen berechnet |
| alle übrigen Binance-Spot-Paare | 2019-07 – 2026-09 | von SignalPilot **nie** abgerufen oder ausgewertet; durch öffentliches Vorwissen vorbelastet (unten) |
| Querschnitt außerhalb von `RISK_ON` | – | wird **nicht** ausgewertet; bleibt für die marktneutrale Frage unverbraucht |
| Forward ab 2026-10-15 | – | wird nicht geladen |

**Folge für später:** Nach dieser Studie gibt es für den Altcoin-Querschnitt
in `RISK_ON` 2020–2026 keinen unberührten historischen Prüfzeitraum mehr. Ein
späteres Gates v5 könnte darauf nur noch wiederholen. Unabhängige Evidenz
liefert nur ein Forward-Test.

**Vorwissen, offen benannt** (Sprachmodell, öffentliche Quellen bis etwa
Mitte 2026, aus dem Gedächtnis und nicht nachgeprüft):

- **Marktgeschichte:**
  - Altcoin-Boom 2020/2021, Meme-Coins 2021 und 2024;
  - Zusammenbrüche von LUNA (Mai 2022) und FTX/FTT (November 2022);
  - deutlich steigender BTC-Anteil an der Marktkapitalisierung seit etwa 2023;
  - einzelne starke Gewinner (etwa SOL 2021 und 2023/24).
- **Literatur:**
  - Liu, Tsyvinski und Wu (2022): Querschnitts-Momentum über 1–4 Wochen in
    einem breiten Krypto-Universum;
  - Grobys und Sapkota (2019): kein signifikantes Querschnitts-Momentum
    2014–2018;
  - Dobrynskaya: kurzfristiges Momentum, Umkehr nach etwa einem Monat.
- **Was davon geprägt wurde:**
  - die **Fragen**: Kontrolle, Delisting-Behandlung, „seit 2024“, „ohne das
    beste Jahr“;
  - die **Wahl der Rückschau** (28 Tage, in der Literatur-Spanne).
- **Was davon nicht abhängt:** Kein Coin ist namentlich gewählt. Universum,
  Ausschlüsse und Schwellen sind mechanisch.
- Ein historisches Ergebnis bleibt deshalb **Plausibilisierung, kein
  Beweis**.

**Recherche für dieses Dokument:** Repository-Dokumente und Code
(Kostenmodell, Gates v4, `spanningAlphaTest`, `crypto-native-regime-v1`,
Risk-Regeln, Carry-Werkzeuge und -Bericht). Keine Websuche, kein Abruf von
Kurs- oder Listendaten.

## 14. Gates v4: was abbildbar ist und was fehlt

Diese Studie läuft **ohne** Gates und außerhalb der Produktpakete, als reines
Python-Skript unter `scripts/research/` (Standardbibliothek, `python3 -I`,
kein Import aus `apps/` oder `packages/`). Die Frage ist nur, was ein späterer
formaler Weg bräuchte.

**Schon vorhanden und wiederverwendbar:**

- `spanningAlphaTest` (`OWN_ALPHA`) mit Newey–West und Mehrfachtest-Schwelle;
- feste Plätze à 20 000 USDT, Vergleich A/B, `PORTFOLIO_NET_GAIN`,
  `PORTFOLIO_DRAWDOWN`, `INCREMENT_COST_STRESS`;
- das Kostenmodell als Basis (L1 = VIP0-Schätzung);
- Regime-Modell und R-020 unverändert.

**Nicht abbildbar in v4** (jede Änderung braucht laut v4-Vorregistrierung ein
Gates v5 mit eigener Vorregistrierung):

| Lücke | Heute | Nötige rein technische Erweiterung |
|---|---|---|
| Symbole | BTCUSDT, ETHUSDT fest im v4-Hash | Universum als gehashtes Artefakt: Regeln plus Mitgliedsliste je Stichtag |
| Strategie-Schnittstelle | `evaluateStrategy` bewertet einen `StrategyInputSnapshotV1`, also ein Symbol | Querschnitts-Eingabe: alle Mitglieder je Stichtag, Rangfolge als Ergebnis |
| Portfolio-Simulation | `portfolio-replay-v1` stündlich, eine Position je Asset, keine Rangwechsel | Mehrpositions-Buch mit Ein- und Ausstiegen je Termin, Zwangsschließung bei Delisting; Tagestakt statt Stundentakt |
| Kosten | `EVOLUTION_COST_MODEL_V1` einheitlich, `EVOLUTION_INSTRUMENTS` nur BTC/ETH | Kostenstufen je Symbol und Tag, Instrumentdaten je Symbol |
| Daten | Snapshot-Lader nur BTC/ETH; `market-data` holt per REST, das delistete Paare nicht liefert | Archiv-Lader mit Lückenregel und Instrumentbrüchen |
| Maßstab | `OWN_ALPHA` misst nur gegen den Bestand. Ein Altcoin-Korb in `RISK_ON` könnte ihn allein durch Beta bestehen | Pflicht-Kontrolle `EW_UNIVERSE_RISK_ON` als zusätzlicher Faktor (`SELECTION_ALPHA`) |
| Laufzeit | Vergleich A rund 17 Minuten für 2 × 2 Portfolio-Symbole | stündlich bei 50+ Symbolen viele Stunden; nötig ist ein eigener Tagestakt-Simulator oder ein Vorab-Cache |
| Daten-Split | `evolution-split-v1` mit Holdout 2024–2026 | Für Altcoins ist nach dieser Studie kein Holdout mehr unberührt (Abschnitt 13) |

**R-004 und die Allowlist.** R-004 lässt heute nur BTCUSDT und ETHUSDT zu
(`allowedSymbols` in `risk-engine/src/policy-v1.ts`), R-015 kennt nur die
Gruppe `CRYPTO_MAJOR` mit genau diesen beiden. Für diese Studie gilt:

- Weitere Assets werden **ausschließlich isoliert** untersucht:
  - im Skript unter `scripts/research/relative-strength-v1/`;
  - Daten gitignoriert unter `data/market-snapshots/relative-strength-v1/`;
  - Ergebnisse unter `data/replay-research/relative-strength-v1/`.
- Nichts davon gelangt in die Datenbank, auf den VPS oder in einen Worker.
- **Keine automatische Änderung der produktiven Allowlist.** Kein Code leitet
  aus Studienergebnissen eine Allowlist, eine Gruppe oder ein Kostenprofil ab.
- Eine Erweiterung ginge nur über ADR, Betreiberbeschluss und eine neue
  Risk-Policy-Version (Abschnitt 16).

## 15. Untersuchungsplan, Machbarkeit und Aufwand

| Schritt | Inhalt | Wer | Freigabe | Kosten |
|---|---|---|---|---|
| 0.1 | Diese Vorregistrierung committen | Claude | – | 0 |
| 0.2 | Review; offene Punkte F1–F8 entscheiden. Der freigegebene Commit friert V1 ein | Betreiber | **ja** | 0 |
| 1.1 | Skript `scripts/research/relative-strength-v1/` schreiben und **vor** jedem Abruf gegen synthetische Daten testen: Ausschlüsse, Lückenregel, Instrumentbrüche, Universum, Rang und Puffer, Ein- und Ausstiege, Gate, Kostenstufen, Stresse, Kontrolle, Referenzen, `spanningAlphaTest`, Kennzahlen, Ergebnisklassen | Claude | mit 0.2 | 0 |
| 1.2 | Verzeichnisliste lesen (nur Metadaten), D0 prüfen, Download-Plan mit genauer Dateizahl und Größe | Claude | mit 0.2 | 0 |
| 1.3 | Download nach Plan, Prüfsummen, Manifest; vorhandene `DTB3`- und Benchmark-Dateien kopieren und gegen ihre Manifeste prüfen | Claude | **ja, ausdrücklich** | 0 USD |
| 1.4 | Datenprüfung D1–D10; Bericht nur zur Datenqualität; bei einer gescheiterten Pflichtprüfung Halt und Meldung | Claude | – | 0 |
| 1.5 | ein Lauf: beide Varianten, beide Kontrollen, alle Referenzen, M1–M24, B1–B6 | Claude | **ja, gesondert** (wie beim Carry) | 0 |
| 1.6 | Phase 1B: Primärquellen; Konto prüft der Betreiber | Claude und Betreiber | – | 0 |
| 1.7 | Ergebnisbericht `docs/trading/research/<Datum>-relative-strength-feasibility-results.md` mit Ergebnisklasse; N auf 57 | Claude | – | 0 |
| 2 | Nur bei `BESTANDEN` (oder bewusst bei `BESTANDEN_REFERENZ`) und nach Betreiberbeschluss: Grundsatzentscheidungen aus Abschnitt 16 | – | **ja**, je ADR | Bauaufwand |
| 3 | Eigener Shadow-Forward-Teilnehmer, strikt getrennt von `OFFICIAL_V1` | – | **ja** | – |

- Der Bericht nennt den SHA-256 des Skripts, die Daten-Fingerprints, den
  Commit und den Blob-Hash dieser Datei.
- Zu keinem Zeitpunkt werden Echtgeld, Exchange-Adapter, Konto-Anbindung,
  `ENABLE_LIVE_TRADING`, VPS oder Forward-Test berührt.

**Machbarkeit der Phase 1:** hoch.

- Alle Daten sind frei. Die Methode ist in 1d-Kerzen vollständig rechenbar.
- Die Carry-Werkzeuge liefern erprobte Bausteine: Archiv-Abruf mit
  Prüfsummen, Lückenfüllung aus dem Tagesarchiv, Regime-Nachbildung,
  `spanningAlphaTest`, Benchmark-Datei.
- Hauptrisiko ist D0: ob das Archiv delistete Paare vor 2021 vollständig
  enthält.

**Aufwand der Phase 1 (Schätzung):**

| Teil | Aufwand |
|---|---|
| 1.1 Skript und Tests | etwa eine Arbeitssitzung; größer als beim Carry wegen Universum und Lückenregel |
| 1.2/1.3 Liste und Download | Minuten Arbeit, einige Stunden Laufzeit im Hintergrund |
| 1.4/1.5 Prüfung und Lauf | jeweils unter einer Stunde |
| 1.6/1.7 Phase 1B und Bericht | etwa eine Arbeitssitzung |
| Geld | 0 USD, kein KI-Forschungslauf |

**Aufwand einer Phase 2** (nur nach `BESTANDEN`, grob, ±50 %):

| Baustein | Aufwand |
|---|---|
| Archiv-Datenpipeline mit Universum, Lückenregel und Delistings | 3–5 Tage |
| Querschnitts-Schnittstelle in `strategy-engine`, neue Strategie | 3–5 Tage |
| Mehrpositions-Simulation im Tagestakt mit Rebalancing | 5–10 Tage |
| Kostenstufen je Symbol, Instrumentdaten | 1–2 Tage |
| ADRs und neue Risk-Policy-Version (Abschnitt 16) | 3–5 Tage plus Beschlüsse |
| Gates v5 mit Vorregistrierung, Validierung und Gegenprobe | 3–5 Tage |
| Forward-Teilnehmer, Arena, Dashboard | 2–4 Tage |
| **Summe** | **etwa 4–7 Wochen** konzentrierter Arbeit |

## 16. Grundsatzentscheidungen erst nach bestandener Studie

Keine davon wird jetzt getroffen oder vorbereitet. Sie stehen hier, damit
klar ist, was ein „bestanden“ auslösen würde und was nicht.

| Thema | Heutiger Stand | Warum betroffen | Art der Entscheidung |
|---|---|---|---|
| R-004 Universum | nur BTCUSDT/ETHUSDT | Die Strategie braucht bis zu 50 Symbole je Stichtag, wechselnd | neue Risk-Policy-Version mit **regelbasiertem** Universum (Regeln und Liste gehasht), ADR; nie automatisch |
| R-015 Korrelationsgruppe | `CRYPTO_MAJOR` = BTC/ETH, Summe ≤ 30 %, fehlende Gruppe = Fehler | Altcoins brauchen eine Gruppe; die 30-%-Grenze begrenzt die Investitionsquote | Gruppenmodell und Grenze, Risiko-Entscheidung |
| R-011 offene Positionen | ≤ 2 | Die Strategie hält 10 | eigener Wert im Regelsatz der Strategie |
| R-012 Einstiege je Tag | < 4 | Ein Aufbau braucht bis zu 10 Käufe an einem Tag | dito |
| R-014 Asset-Exposure | ≤ 20 % je Asset, keine zweite Position | mit 10 % je Position verträglich; Kursdrift kann über 20 % führen | bestätigen, Verhalten bei Drift festlegen |
| R-008, R-009 | 2R-Mindestziel, 0,25 % Risiko je Trade mit Stop | Die Strategie hat weder Stop noch Ziel | portfolio-basierter Risiko-Regelsatz statt R-Logik |
| R-010, R-021 | Tagesverlust, Verlustserie → Kill-Switch | Bei 10 Positionen löst die Verlustserie viel häufiger aus | Zählweise je Strategie festlegen |
| R-022 | kein Nachkauf | bereits berücksichtigt: keine Nachgewichtung | keine |
| R-020 | Long nur bei `RISK_ON` | unverändert genutzt | keine |
| Kostenprofile | ein Profil, kalibriert auf BTC | Stufen je Symbol und Tag | neues Kostenmodell, Kalibrierung im Shadow |
| Strategie-Schnittstelle, Daten, Simulation | Abschnitt 14 | – | technische Erweiterung |
| Bewertung | Gates v4 | Abschnitt 14 | Gates v5 mit eigener Vorregistrierung |
| Arena | [ADR 0015](../decisions/0015-arena-survival-on-own-capital.md) | neuer Teilnehmer mit eigenem Portfolio | Beschluss nach Arena-Regeln |
| Handelsplatz, Steuer | Binance nicht erreichbar; § 23 EStG | Abschnitte 11, 12 | Phase 1B, Steuerberatung; echte Ausführung bleibt außerhalb des Projekts (Shadow-only) |

## 17. Kritische Bewertung: Lohnt sich diese Richtung?

**Für die Studie (Phase 1) spricht:**

- Sie ist **billig und entscheidend**: 0 USD, zwei bis drei Arbeitssitzungen,
  keine Regeländerung. Sie schließt Rang 2 sauber oder öffnet ihn.
- Die Altcoin-Daten sind für SignalPilot **frisch**. Kein Parameter wurde
  daran angepasst.
- Sie liefert auch bei Misserfolg verwertbares Wissen:
  - die echten Kosten des Umschichtens (M12/M13);
  - ob mehr Altcoin-Engagement in `RISK_ON` gegenüber BTC/ETH überhaupt
    etwas gebracht hätte (K − R). Das ist eine Information für eine
    Risiko-Entscheidung, kein Vorteil;
  - ein Universum ohne Überlebens-Verzerrung, das spätere Fragen (auch die
    marktneutrale) wiederverwenden können.

**Gegen hohe Erwartungen spricht:**

1. **Geringe Trennschärfe.** Nur gut 2¼ Jahre `RISK_ON`-Zeit sind
   informativ. Bestehen kann nur ein starker Auswahleffekt (IC um 0,06 oder
   mehr, Abschnitt 2.3). Ein mäßiger, echter Effekt würde meist als „nicht
   belegt“ enden.
2. **Wenig Unabhängigkeit.** Die Long-only-Form investiert in denselben
   Phasen wie der Challenger und trägt Altcoin-Beta. Unabhängig ist nur der
   Auswahlanteil.
3. **Gegenwind seit 2024 (Vorwissen):** Ein breiter Altcoin-Korb dürfte BTC
   unterlegen gewesen sein. B2 und B3(c) sind damit hohe Hürden.
4. **Umsetzbarkeit.** Binance ist nicht erreichbar. EU-Plätze haben ein
   kleineres Universum und höhere Gebühren. Für Privatanleger in Deutschland
   kommt die Steuer-Asymmetrie gegenüber Kaufen und Halten hinzu.
5. **Hoher Folgeaufwand.** Eine Umsetzung berührt die Risk-Regeln R-004,
   R-008 bis R-012, R-015 und R-021, die Strategie-Schnittstelle, die
   Simulation und die Datenpipeline, etwa 4–7 Wochen. Ein Forward-Beleg
   bräuchte bei realistischem IR Jahre.

**Einschätzung:** Die Studie ist als günstige Ausschlussprüfung
gerechtfertigt; ihr Ergebnis wird die Frage für Rang 2 klären. Die
Wahrscheinlichkeit für `BESTANDEN` schätze ich gering ein, deutlich unter
einem Viertel. Der Implementierungsaufwand ist nur nach einem klaren
`BESTANDEN` gerechtfertigt, nicht nach einem knappen oder „vielversprechenden“
Ergebnis.

**Einordnung in das Gesamtziel:** Der Carry-Bericht hat gezeigt, dass auch der
Bestand nach fairer Rechnung unter dem Geldmarkt liegt (Challenger
2,7 % p. a. gegen Ø `DTB3` 2,85 %, 2020-01 – 2026-09). Die größte Stellschraube für die
**absolute** Rendite bleibt die Positionsgröße (Analyse, Abschnitt 1). Das ist
eine Risiko-Entscheidung des Betreibers, keine Forschungsfrage, und nicht
Gegenstand dieser Studie.

## 18. Offene Punkte zur Freigabe

| Nr. | Frage | Empfehlung |
|---|---|---|
| F1 | Bezugsgröße: volle Investition in `RISK_ON`, Zinshürde `DTB3` plus 1,5 pp auf den ganzen Platz (wie Carry)? | **Ja.** Sonst wäre B1 von der späteren Positionsgröße abhängig |
| F2 | Korrelationsgrenze 0,5 auf die **Selektionsrendite** statt auf die Rohrendite; die Rohkorrelation nur als Bericht? | **Ja.** Die Rohkorrelation ist durch das gemeinsame Gate konstruktionsbedingt hoch und würde die Studie vorab entscheiden. Alternative: Grenze auf die Rohrendite, dann ist `NICHT_BESTANDEN` sehr wahrscheinlich |
| F3 | Die zwei Varianten zählen für N (55 → 57); Kontrollen, Referenzen und Zufalls-Gegenprobe nicht? | **Ja** |
| F4 | Kostenstufen L1/L2/L3 mit 14/25/40 bp je Seite? | **Ja.** Einheitlich 14 bp wäre für Altcoins zu optimistisch |
| F5 | Binance als Referenzmarkt; `BESTANDEN` nur mit Phase 1B `VERFUEGBAR`? | **Ja** |
| F6 | Download nach Abschnitt 4.1 | Freigabe gesondert in Schritt 1.3, nach dem Plan aus 1.2 |
| F7 | Ort des Skripts | `scripts/research/relative-strength-v1/`, Standardbibliothek, ohne Bezug zu Produktcode |
| F8 | Die Studie trotz geringer Trennschärfe durchführen (Abschnitte 2.3 und 17)? | **Ja**, als günstige Ausschlussprüfung mit der ausdrücklichen Erwartung, dass `NICHT_BESTANDEN` wahrscheinlich ist und nur ein klares `BESTANDEN` Bauaufwand auslöst |

## 19. Was unverändert bleibt

- Code, Datenbank, Risk Engine mit allen 26 Regeln (insbesondere die
  Allowlist in R-004 und die Gruppe in R-015), Limit-Set, Regime-Modelle,
  Strategie-Registry, Gates v1–v4 mit ihren Hashes, Daten-Split, Kostenmodell
  der Evolution.
- Champion, Challenger, Arena V1, offizieller Forward-Test `OFFICIAL_V1`, VPS,
  lokaler Shakedown.
- `ENABLE_LIVE_TRADING=false`, `PAPER_TRADING_ONLY=true`; kein
  Exchange-Adapter, kein API-Schlüssel, keine Order, kein Echtgeld.
