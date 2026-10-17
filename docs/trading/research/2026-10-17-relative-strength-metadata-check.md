# Metadatenprüfung der Machbarkeitsstudie Relative Stärke (Schritt 1.2, 2026-10-17)

> **Nur Metadaten.** Abgerufen wurden Dateinamen, Dateigrößen und Prüfsummen-Namen
> des Binance-Archivs, die heutige Symbolliste (`exchangeInfo`), öffentliche
> Ankündigungen, die Gebührentabelle und die Archiv-Dokumentation.
>
> - Keine Kurs- oder Funding-Datei geladen, keine Rendite berechnet, kein
>   Backtest.
> - Vorregistrierung, Kriterien B1–B6, Risk Engine, Strategien, Gates, VPS
>   und offizieller Forward-Test unverändert.
> - Grundlage: [Vorregistrierung](2026-10-17-relative-strength-feasibility-preregistration.md)
>   (Text `c188c38`, Statusblock `6520f42`), Werkzeuge unter
>   [`scripts/research/relative-strength-v1/`](../../../scripts/research/relative-strength-v1/README.md).

## Ergebnis in Kürze

- **Die Datenbasis ist geeignet, mit einer formalen Einschränkung bei D0b.**
  - Das Archiv enthält delistete Paare aller Jahre. D0 ist bestanden; von 254
    heute nicht mehr gehandelten USDT-Paaren fehlt nur eines (D0c).
  - Jede Monatsdatei hat eine `.CHECKSUM`.
  - Die offizielle Gebühr bestätigt 10 bp je Seite.
- **D0b: Halt und Rückfrage (`check-listing` Exit 3).**
  - > **Korrektur 2026-10-17:** Die Stichprobe las zunächst nur die Kataloge
    > 49 und 161. Die Meldungen aus 2020 liegen aber im Katalog 48. Mit allen
    > drei Katalogen hat auch 2020 drei Ankündigungen (FTX-Hebel-Token,
    > BKRW/USDT, DAI/USDT; 12 von 12 Paaren gefunden). Nicht durchführbar
    > bleibt D0b dann nur wegen 2025. Einzelheiten:
    > [Präzisierung P7](2026-10-17-relative-strength-d0b-precision-p7.md),
    > Abschnitt 1.
  - Alle 25 Paare aus den 14 gefundenen Ankündigungen stehen im Archiv
    (100 %), nach der Korrektur alle 37 Paare aus 17 Ankündigungen.
  - Formal ist D0b aber nicht durchführbar: für 2025 nur zwei Ankündigungen
    statt drei. Die ursprüngliche Aussage, 2020 habe keine, ist überholt.
  - Arbeitet der Betreiber mit `--accept-halt D0b` weiter, kann nach §10.2
    Regel 4 kein positives Ergebnis mehr entstehen.
  - Optionen und Empfehlung stehen in Abschnitt 3.
- **Downloadplan 1.3:**
  - 27 818 Monatsdateien plus ebenso viele Prüfsummen, 48 MB, 55 636 Abrufe,
    2 bis 4 Stunden;
  - danach wenige hundert Tagesdateien (E1, D12).
- **Qualitätsprüfung (Abschnitt 7):**
  - Die Monats-Sharpe in B3(c) ist vereinbar, aber nicht eindeutig;
    Entscheidungsvorschlag in 7.1.
  - D3 erkennt lange Lücken.
  - Ein Kauf am letzten Handelstag ist kein inhaltlicher Fehler.

## 1. Quellen und Abrufe

| Quelle | Abruf | Stand | Ablage (gitignoriert) |
|---|---|---|---|
| S3-Verzeichnisliste `data.binance.vision`, Präfix `data/spot/monthly/klines/` und je USDT-Symbol `<SYM>/1d/` | rund 760 Listenabrufe, nur Dateinamen, Größen, Änderungsdatum | 2026-10-17 | `listing/spot-monthly-klines-1d.json` |
| `exchangeInfo` über `data-api.binance.vision` (öffentlich, ohne Schlüssel) | 1 Abruf, auf USDT-Symbole und Status reduziert, SHA-256 der Rohantwort `b620c83b…` | 2026-10-17 | `listing/exchangeInfo.json` |
| Binance-Ankündigungen, Kataloge 49 „Latest Binance News“ (4 452 Artikel, bis 2022 auch Delistings) und 161 „Delisting“ (441 Artikel, ab 2022-02) | 99 Listenseiten, 304 Einzeltexte, langsam und mit Zwischenspeicher (die Schnittstelle antwortet bei schnellen Abrufen mit HTTP 429) | 2026-10-17 | `listing/announcement-cache/`, `listing/announcements-d0b*.json` |
| Gebührentabelle `binance.com/en/fee/trading` | eingebauter Browser, Text gelesen | 2026-10-17 | – |
| Archiv-Dokumentation `binance/binance-public-data`, `README.md` | 1 Abruf | 2026-10-17 | – |

Alle Ablagen liegen unter `data/market-snapshots/relative-strength-v1/` im
Hauptcheckout, dem Datenverzeichnis des späteren echten Laufs.

## 2. Archivstruktur

| Prüfung | Befund |
|---|---|
| Spot-Symbole im Archiv (alle Quotes) | 3 745 |
| davon mit Quote USDT und Monatsdateien 1d | **756**, darunter heute nicht mehr gehandelte (Abschnitt 3) |
| mit Dateien im Fenster 2019-07 – 2026-09 | 753 |
| Monatsdateien ohne `.CHECKSUM` | **0** |
| Dateinamen außerhalb des Musters `<SYM>-1d-YYYY-MM.zip` | 0, nachdem zwei Symbole mit chinesischen Zeichen erkannt wurden (`币安人生USDT` ab 2026-01, `牛来USDT` ab 2026-09); das Muster ist korrigiert, der Download muss sie URL-kodieren |
| frühester Monat | 2017-08 (BTCUSDT); delistete Paare aus 2017–2020 sind enthalten (etwa `BCCUSDT` 2017-11 – 2018-11, `BCHABCUSDT` 2018-11 – 2019-11, `ERDUSDT` bis 2020-08) |
| Erzeugung | 3 896 Dateien tragen das Änderungsdatum 2021-06: Das Archiv wurde damals rückwirkend für die ganze Historie erzeugt, delistete Paare eingeschlossen. Seither kommt monatlich je Symbol eine Datei hinzu. Die Dokumentation führt eine Liste nachträglich ersetzter Dateien (z. B. 2022-08-08 „Fixed inconsistent data“ bei Klines) |
| Symbole mit Datenende vor 2026-09, je Jahr | 2020: 18 · 2021: 20 · 2022: 38 · 2023: 24 · 2024: 46 · 2025: 51 · 2026: 47 |

**Ganze fehlende Monate innerhalb einer Reihe** (keine Datei, obwohl davor und
danach Dateien existieren):

| Symbol | fehlende Monate | Einordnung |
|---|---|---|
| `FTTUSDT` | 2022-12 – 2023-08 | nach dem FTX-Zusammenbruch; plausibel eine echte Handelspause mit Wiederaufnahme. Für Uₜ-Mitglieder ein Fall für D11 (E3, E6 oder E7) |
| `CVCUSDT` | 2023-01 – 2023-04 | plausibel ein Delisting mit späterer Wiederaufnahme; ebenso D11 |
| `TUSDUSDT`, `USDCUSDT`, `USDPUSDT` | 2022-10 – 2023-02 | Stablecoins, ohnehin ausgeschlossen (X1) |
| `USDSUSDT` | 2020-07 – 2026-03 | nach Zeitraum vermutlich ein neu vergebenes Symbol (alter Stablecoin bis 2020-06, ein anderer ab 2026-04); beides X1 |
| `BCHUPUSDT`, `BCHDOWNUSDT` | 2020-12 – 2021-03 | Hebel-Token, ohnehin ausgeschlossen (X4) |
| `VENUSDT` | 2018-08 – 2018-09 | vor dem Fenster |

Kein liquides Paar zeigt eine Monatslücke, die nach einem Archivfehler aussieht.

**Zeitstempel:** Die Archiv-Dokumentation sagt wörtlich, Spot-Zeitstempel seien
ab dem 1. Januar 2025 in Mikrosekunden. Das Skript erkennt die Einheit je Zeile
(D2); geprüft wird das an den Dateien selbst erst nach dem Download.

## 3. D0, D0b, D0c

### D0: bekannte Fälle (bestanden)

| Paar | Monate im Archiv | Ereignisjahr vorhanden |
|---|---|---|
| `ERDUSDT` | 2019-07 – 2020-08 (Umstellung auf `EGLDUSDT` ab 2020-09) | ✔ 2020 |
| `LUNAUSDT` | 2020-08 – 2026-09, ohne Monatslücke: Das Symbol trägt nach dem Zusammenbruch die neue Münze; die alte heißt ab 2022-09 `LUNCUSDT` | ✔ 2022 |
| `FTTUSDT` | 2019-12 – 2026-09 mit Lücke 2022-12 – 2023-08 | ✔ 2022 |
| `XMRUSDT` | 2019-03 – 2024-02 | ✔ 2024 |
| `MATICUSDT` | 2019-04 – 2024-09 (`POLUSDT` ab 2024-09) | ✔ 2024 |

### D0c: Abgleich mit der heutigen Symbolliste (Bericht)

- `exchangeInfo` führt heute 765 USDT-Paare: 511 `TRADING`, 254 `BREAK`.
- Von den 254 nicht mehr gehandelten fehlt im Archiv genau eines
  (`USDSOLDUSDT`, 0,4 %).
- 11 gehandelte Paare haben noch keine Monatsdatei. Zwei davon sind die oben
  genannten Symbole mit chinesischen Zeichen; die übrigen sind Neulistungen nach
  dem Fenster.
- Die heutige Liste dient nur diesem Abgleich, nie als historisches Universum.

### D0b: Wiederfindung angekündigter Delistings

> **Korrektur 2026-10-17:** Dieser Abschnitt beschreibt den Stand vor der
> Korrektur, mit den Katalogen 49 und 161.
>
> - Binance hat die Meldungen aus 2020 im Katalog 48 („New Cryptocurrency
>   Listing“) abgelegt; zwei Entfernungen stehen in Meldungen über neue
>   Paare.
> - Mit den Katalogen 48, 49 und 161 gilt für 2020 nach V1: FTX-Hebel-Token
>   (2020-03-28), BKRW/USDT (2020-08-06) und DAI/USDT (2020-08-11), alle 12
>   Paare im Archiv.
> - 2021–2024 bleiben unverändert. 2025 hat weiter nur zwei Ankündigungen.
> - Die Aussagen unten zu „2020 leer“ und Option (b) sind damit überholt;
>   maßgeblich ist der Entwurf
>   [P7](2026-10-17-relative-strength-d0b-precision-p7.md).

**Auslegung, festgelegt vor dem Abgleich mit dem Archiv:**

- Eine Ankündigung zählt, wenn ihr Text das dauerhafte Ende des Spot-Handels
  mindestens eines **ausdrücklich genannten** Paars mit Quote USDT ankündigt.
- Nicht gezählt werden:
  - nur Margin- oder Futures-Paare;
  - Paare mit anderer Quote (etwa `USDT/BKRW`);
  - neu eröffnete Paare;
  - Handelsstopps mit Wiedereröffnung unter demselben Symbol
    (Redenominierungen);
  - Token-Delistings ohne genannte Paare.
- Migrationen auf ein neues Symbol zählen (NPXS, PAX, BZRX, BTT, ANY, PLA):
  Das alte USDT-Paar endet dauerhaft.
- Ob ein Paar Stablecoin ist (PAX, SUSD), spielt für D0b keine Rolle. D0b
  prüft nur, ob das Archiv angekündigte Enden enthält.

**Vorgehen:**

- Titelfilter über beide Kataloge, dann chronologisch je Jahr.
- Texte ohne ein Paar `X/USDT` gelten automatisch als „nein“. Jede übrige
  Ankündigung ist von Hand entschieden, mit Begründung in
  [`d0b-review-decisions.json`](../../../scripts/research/relative-strength-v1/d0b-review-decisions.json).
- `fetch_metadata.py d0b-sample` bricht ab, wenn vor dem dritten Treffer
  eines Jahres ein Kandidat ungeprüft ist.
- 2020 und 2025 sind vollständig durchgesehen.

**Stichprobe** (Archiv: letzter Monat mit Datei, gefordert ist mindestens der
Monat vor dem Handelsende):

| Jahr | veröffentlicht (UTC) | Ankündigung | Handelsende | USDT-Paare | Archiv bis |
|---|---|---|---|---|---|
| 2021 | 2021-03-31 03:21 | [Pundi X (NPXS) Migration](https://www.binance.com/en/support/announcement/8bdcb060635b491d912247fb00603d4d) | 2021-04-05 | NPXS | 2021-04 ✔ |
| 2021 | 2021-08-30 08:11 | [PAX Rebrand zu USDP](https://www.binance.com/en/support/announcement/c313480177e4457bb1e1b848c88bbf78) | 2021-09-06 | PAX | 2021-09 ✔ |
| 2021 | 2021-12-16 13:30 | [BZRX Tausch zu OOKI](https://www.binance.com/en/support/announcement/dff27dc6bcbb432c902bcbea5e24ddfa) | 2021-12-20 | BZRX | 2021-12 ✔ |
| 2022 | 2022-01-10 11:15 | [BitTorrent (BTT) Migration](https://www.binance.com/en/support/announcement/2722e6da4f5141dd9b2fb07b5b1f3f75) | 2022-01-17 | BTT | 2022-01 ✔ |
| 2022 | 2022-03-24 10:00 | [Anyswap (ANY) Migration](https://www.binance.com/en/support/announcement/d14ebaed2c2d40d591ad377653009151) | 2022-03-30 | ANY | 2022-03 ✔ |
| 2022 | 2022-04-04 09:58 | [Delist HEGIC, RENBTC, SUSD](https://www.binance.com/en/support/announcement/da14a6dce7a64283b8d536ca1c97c026) | 2022-04-11 | SUSD | 2022-04 ✔ |
| 2023 | 2023-01-19 04:00 | [Delist BEAM](https://www.binance.com/en/support/announcement/a80d47617f1046b883b5ba237d2c75a7) | 2023-01-26 | BEAM | 2023-01 ✔ |
| 2023 | 2023-02-08 04:20 | [Removal of Trading Pairs 2023-02-10](https://www.binance.com/en/support/announcement/7ec33a2d62974c3490b92ff0780ba461) | 2023-02-10 | KEY | 2024-12 ✔ (siehe unten) |
| 2023 | 2023-02-20 04:03 | [Delist AION, MIR, ANC](https://www.binance.com/en/support/announcement/b461bf1f04d9456ea978f1549a31e174) | 2023-02-27 | AION | 2023-02 ✔ |
| 2024 | 2024-02-06 07:00 | [Delist ANT, MULTI, VAI, XMR](https://www.binance.com/en/support/announcement/f73b083ba6834771b07dbe5319917ae5) | 2024-02-20 | ANT, MULTI, XMR | 2024-02 ✔ |
| 2024 | 2024-02-22 05:40 | [PlayDapp (PLA) Tausch zu PDA](https://www.binance.com/en/support/announcement/f0fafa66fedf4e058aaacb57c206c597) | 2024-02-26 | PLA | 2024-02 ✔ |
| 2024 | 2024-03-20 06:00 | [Delist DREP, MOB, PNT](https://www.binance.com/en/support/announcement/1e531578a30c46eebf52c8dae3c56092) | 2024-04-03 | DREP, MOB, PNT | 2024-04 ✔ |
| 2025 | 2025-02-17 07:00 | [Delist AMB, CLV, STMX, VITE](https://www.binance.com/en/support/announcement/f3cc64a8758d4bb394e0830e5b31da97) | 2025-02-24 | AMB, CLV, STMX, VITE | 2025-02 ✔ |
| 2025 | 2025-03-21 05:50 | [Delist AERGO, AST, BURGER, COMBO, LINA](https://www.binance.com/en/support/announcement/db7ad1c7aa6248cda735102cdcdc4b8d) | 2025-03-28 | AERGO, AST, BURGER, COMBO, LINA | 2025-03 ✔ |

| Jahr | Ankündigungen | Paare gefunden | Anteil |
|---|---|---|---|
| 2020 | **0** | – | – |
| 2021 | 3 | 3 / 3 | 100 % |
| 2022 | 3 | 3 / 3 | 100 % |
| 2023 | 3 | 3 / 3 | 100 % |
| 2024 | 3 | 7 / 7 | 100 % |
| 2025 | **2** | 9 / 9 | 100 % |

**Ergebnis:** Kein angekündigtes Paar fehlt. D0b ist trotzdem **nicht
durchführbar**, weil 2020 und 2025 keine drei Ankündigungen haben. Nach §4.2
gilt dann „Halt und Rückfrage“; `check-listing` meldet `halts: ["D0b"]`.

**Warum 2020 leer blieb (überholt, siehe Korrektur oben):**

- Katalog 49 enthält 442 Artikel aus 2020, aber keinen, der ein endendes
  USDT-Paar nennt.
  - Die einzige Paar-Entfernung (2020-12-17) betrifft `/BNB`- und
    `/BUSD`-Paare.
  - DGD (2020-03-26) nennt nur `/BTC` und `/ETH`.
  - Die Token-Tausche öffnen unter demselben Symbol wieder oder nennen nur
    neue Paare (REPV2, STRAX).
- Das Archiv zeigt 2020 aber 18 endende USDT-Paare:
  - 10 Hebel-Token (Ende 2020-03);
  - BKRW und DAI;
  - sechs Münzen: STORM (2020-06), ERD (2020-08), LEND (2020-10), MCO
    (2020-10), HC (2020-11), STRAT (2020-11).
- Zu keiner der sechs Münzen enthält der Katalog eine Ankündigung (zu STRAT
  nur die STRAX-Paare). Drittquellen spiegeln einzelne Binance-Meldungen aus
  2020, sind aber keine Binance-Quelle und wurden nicht verwendet.
- **Schluss:** Die offiziellen Kataloge sind für 2020 unvollständig. Die
  „ersten drei Ankündigungen 2020“ sind aus der vorgesehenen Quelle nicht
  bestimmbar.

**Warum 2025 nur zwei hat:** Ab April 2025 kündigen die Texte das Ende „aller
Spot-Paare“ einzelner Token an, ohne Paare zu nennen. Das ganze Jahr 2025 ist
durchgesehen; unter der Auslegung oben zählt danach keine Ankündigung mehr.

**Auffälligkeit KEY:**

- `KEY/USDT` sollte am 2023-02-10 03:00 UTC enden. Das Archiv führt
  `KEYUSDT` aber ohne Monatslücke bis 2024-12.
- Die Datei 2023-02 ist klein (684 Byte, sonst rund 1 700), die von 2023-03
  ebenfalls (1 394 Byte). Das passt zu einer Entfernung und späteren
  Wiederaufnahme unter demselben Symbol. Endgültig delistet wurde KEY am
  [2024-12-10](https://www.binance.com/en/support/announcement/131b75b63a71490393034f36de70c92c).
- Für D0b ist das ohne Belang.
- Für die Studie ist es eine Lücke innerhalb eines Monats, die die Monatsliste
  nicht zeigt. Nach dem Download meldet D3 sie als lange Lücke; gehört KEY
  dann zu Uₜ, ist sie ein Fall für D11.

**Unsicherheiten:**

- **Vollständigkeit der Kataloge:** Für 2020 ist sie widerlegt, für 2021–2025
  nicht beweisbar. „Die ersten drei“ heißt: die ersten drei in den Katalogen
  49 und 161.
- **Zeitangaben:** Die Veröffentlichungszeit stammt aus `releaseDate` der
  Schnittstelle (UTC), das Handelsende aus dem Text.
- **Prüfung:** Die Entscheidungen hat Claude allein getroffen, ohne
  Zweitprüfung. Sie sind aber je Ankündigung begründet und am Text
  nachprüfbar.

> **Nachtrag 2026-10-17:** Der Betreiber will den Halt nicht mit
> `--accept-halt` umgehen. Statt Option (b) mit der heutigen `exchangeInfo`
> liegt jetzt der Entwurf
> [P7](2026-10-17-relative-strength-d0b-precision-p7.md) zur Freigabe vor.
> Er belegt die Paare von Token-Delistings mit zeitlich passenden, archivierten
> Binance-Symbollisten. 2020 braucht nach der Korrektur keinen Ersatznachweis
> mehr. Unter P7 sind alle Jahre zu 100 % gefunden.

**Optionen für den Betreiber** (die Vorregistrierung bleibt unverändert, bis
der Betreiber entscheidet):

| Option | Inhalt | Folge |
|---|---|---|
| (a) Halt annehmen, weiter mit `--accept-halt D0b` | nichts ändern | Jedes positive Ergebnis wird `NICHT_BESTIMMBAR` (Regel 4). Die Studie kann dann nur noch negativ ausgehen. Nicht empfohlen |
| **(b) Präzisierung P7 zu D0b vor dem Download** (empfohlen), als Nachtrag wie P1–P6 | 1. Ein Token-Delisting zählt, wenn der Text das Ende aller Spot-Paare eines Tokens ankündigt und `exchangeInfo` das Paar `<TOKEN>USDT` mit passendem Basis-Asset und Status `BREAK` führt. Das ist unabhängig vom Archiv. Der Status `BREAK` schützt vor neu vergebenen Tickern: `SKYUSDT` ist heute ein anderes Token als das 2021 delistete SKY und hat Status `TRADING`. 2. Für 2020 gilt ersatzweise: D0-Kontrolle `ERDUSDT` und die sechs 2020 endenden Münzpaare im Archiv. Das Restrisiko wird ausdrücklich angenommen | 2025 erhält als dritte Ankündigung das [Vote-to-Delist-Ergebnis vom 2025-04-08](https://www.binance.com/en/support/announcement/fac9c3e401da4cc8b604566fd261d70c) (14 Paare, alle `BREAK`, alle im Archiv bis 2025-04). 2021–2024 bleiben unverändert, auch SKY rückt wegen `TRADING` nicht nach. D0b wäre bestanden, mit dokumentierter Einschränkung für 2020 |
| (c) Studie beenden | `NICHT_AUSWERTBAR` | unverhältnismäßig bei 100 % Wiederfindung |

Das Ergebnis von (b) ist bekannt, bevor die Regel festgelegt ist. Es betrifft
nur die Vollständigkeit des Archivs, keine Rendite, und wurde aus Metadaten
ermittelt.

## 4. Gebührenreferenz (§7)

- Die offizielle Gebührentabelle (`binance.com/en/fee/trading`, gelesen am
  2026-10-17) nennt für „Regular User“ Spot **Maker / Taker 0,100 % /
  0,100 %**, mit BNB-Rabatt 0,075 %.
- Das entspricht den 10 bp Gebühr je Seite in `BINANCE_SPOT_VIP0_ESTIMATE_V1`
  und in allen Stufen L1–L3. Die Regel „gilt der höhere Wert“ greift nicht;
  am Kostenmodell ändert sich nichts.
- Grenze: Die Tabelle zeigt den heutigen Stand. Dass Regular User auch
  2019–2026 0,10 % zahlten, ist Vorwissen und nicht nachgeprüft. Zeitweise
  Null-Gebühr-Aktionen und BNB-Rabatte bleiben laut §7 unberücksichtigt; das
  rechnet eher zu teuer als zu billig.

## 5. Downloadplan für Schritt 1.3

| Größe | Wert |
|---|---|
| USDT-Paare mit Dateien im Fenster | 753 (heutige und delistete) |
| Monatsdateien 1d, 2019-07 – 2026-09 | **27 818** |
| Prüfsummen-Dateien | 27 818 |
| Abrufe | **55 636** |
| Datenmenge (Zip, laut Verzeichnisliste) | **48,0 MB** |
| Dauer bei 4 Abrufen je Sekunde | rund 3 ¾ Stunden; bei 8 je Sekunde knapp 2 Stunden. Im Hintergrund, Wiederaufnahme nach Abbruch über vorhandene Dateien |
| Verarbeitung (Datenprüfung D1–D12) | Größenordnung Minuten |
| danach, aus `plan` | Tagesdateien für fehlende Tage (E1) und höchstens 100 Sprungtage (D12), Anzahl erst nach dem Monatsdownload bekannt; erwartet wenige hundert Abrufe |
| ohne Download | `fred/DTB3.csv` und die Benchmark-Datei aus dem Carry, kopiert und gegen deren Manifest geprüft |
| Abschluss | `manifest.sha256` über alle Dateien; erst dann ist `evaluate --real` möglich |

**Mögliche Lücken und Einschränkungen:**

- Ganze Tage können in Monatsdateien fehlen (wie beim Carry). E1 ergänzt sie
  aus dem Tagesarchiv; was dort fehlt, bleibt eine Lücke (E2 oder E3).
- Lange Handelspausen und Symbol-Wiederverwendungen (FTT, CVC, LUNA) sind
  aus Kursdaten allein nicht eindeutig. Sie brauchen in 1.4b einen Nachweis
  aus Ankündigungen (D11), sonst gilt die konservative Lesart.
- Die letzte Kerze eines delisteten Paars ist oft ein angebrochener Tag.
- Nachträglich ersetzte Archivdateien (Dokumentation, Abschnitt „Updates“)
  sind über die `.CHECKSUM` des heutigen Stands abgedeckt.

## 6. Point-in-Time

- **Welche Dateien geladen werden**, bestimmt die Verzeichnisliste, also das
  Archiv mit allen je gehandelten Paaren.
- **Wer an einem Stichtag zum Universum gehört**, bestimmt allein das Skript
  aus den Tageskerzen bis zum Vortag: Historie, Vollständigkeit, Liquidität,
  Rang (§3.3, getestet).
- `exchangeInfo` wird nur für D0c gelesen und erreicht das Universum nie.
- Ankündigungen wirken nur ab ihrer Veröffentlichung (E5/E6) oder prüfen das
  Archiv (D0b).
- Die Ausschlussregel für Hebel-Token prüft nur Paare, die am Stichtag schon
  existierten (K5).

## 7. Qualitätsprüfung aus dem letzten Bericht

### 7.1 Ist die Monats-Sharpe in B3(c) eindeutig?

- **Wortlaut:** B3(c) verlangt „Netto p. a. ≥ R und Sharpe ≥ R“. M2 definiert
  drei Werte (täglich × √365, monatlich × √12, Überschuss über DTB3) und nennt
  als Rolle „B3“, ohne einen davon festzulegen. Die Vergleichstabelle (§8.3)
  spricht von „Sharpe (Monatsbasis)“; alle α-Tests rechnen mit
  Monatsrenditen.
- **Urteil:** Die Monats-Sharpe ist mit dem Text vereinbar, aber **nicht
  eindeutig** vorgegeben. Das ist eine Lücke der Vorregistrierung, kein
  Rechenfehler.
- **Umgesetzt (nur Bericht):** Das Ergebnis enthält jetzt
  `b3cSharpeDefinitionCheck`. Die Klasse wird zusätzlich mit der Tages-Sharpe
  in B3(c) bestimmt, und `dependsOnSharpeDefinition` zeigt, ob die Auslegung
  das Urteil ändert.
- **Vorschlag zur Entscheidung vor dem Download, ohne Kriterienänderung:**
  - Festhalten, solange noch keine Daten gesehen sind: Es gilt die
    Monats-Sharpe.
  - Hängt die Klasse an der Definition, gilt das wie ein unbestimmbares
    Ergebnis. Ein positives Urteil gibt es dann nur, wenn beide Definitionen
    übereinstimmen.
  - Alternative: nur die Monats-Sharpe, ohne Zusatzregel.

### 7.2 Erkennt D3 längere Lücken zuverlässig?

- **Regel:** D3 zählt Lücken von 1–6 Tagen nach der Ergänzung aus dem
  Tagesarchiv als fehlende Handelstage. Lücken von 7 Tagen oder mehr sind nach
  §4.3 eine lange Pause (E3) oder ungeklärt (E7) und zählen dort nicht als
  fehlend.
- **Was zuverlässig erkannt wird:**
  - Jeder fehlende Tag wird zuerst aus dem Tagesarchiv ergänzt (E1); der
    Downloadplan holt dafür alle Tage, die `plan` meldet.
  - Fehlt ein Tag bei mehr als der Hälfte der aktiven Symbole, stoppt D3.
  - BTC und ETH müssen lückenlos sein.
  - **Neu:** D3 listet jede lange Lücke (`longGaps`), `check-listing` jeden
    fehlenden Archivmonat (`interiorMonthHoles`). Keine Lücke bleibt stumm.
- **Grenze:** Fehlt ein Tag in Monats- und Tagesarchiv, sind Datenlücke und
  Handelspause nicht zu unterscheiden; §4.3 behandelt beide gleich. Ein reiner
  Archivfehler von 7 Tagen oder mehr würde als lange Pause gebucht: Ausstieg
  zum ersten ausführbaren Kurs, neue Historie. Das erzeugt keinen Scheingewinn,
  kann aber Rendite oder Zulassungstage kosten.
- **Befund der Metadaten:** Unter den nicht ausgeschlossenen Paaren fehlen
  ganze Archivmonate nur bei FTT und CVC, beides plausible echte
  Handelsunterbrechungen. Kein liquides Paar zeigt eine Archivlücke, die nach
  einem Fehler aussieht.
- **Grenze der Monatsliste:** Lücken innerhalb eines Monats sieht sie nicht.
  Beispiel KEY (Abschnitt 3): Das Paar wurde 2023-02-10 entfernt und später
  unter demselben Symbol wieder gehandelt, ohne dass ein Archivmonat fehlt.
  Solche Fälle findet erst D3 nach dem Download (`longGaps`).
- **Vorschlag:** keine Regeländerung. In 1.4 für jede lange Lücke eines
  Uₜ-Mitglieds prüfen, ob das Tagesarchiv Dateien hat (sie würden E1 füllen),
  und den Fall in D11 belegen.

### 7.3 Kauf am letzten Handelstag

- **Mechanik:**
  - Ein Paar ist am Tag D zulässig, wenn seine Kerzen bis D−1 vollständig
    sind. Ist D sein letzter Handelstag, kann es zur Eröffnung von D gekauft
    werden.
  - Ein Ausstieg ist frühestens am Folgetag erlaubt (E5); diesen Tag gibt es
    nicht.
  - Die Position fällt unter E7: Lesart A friert sie zum letzten Schluss ein,
    Lesart B setzt sie auf 0.
- **Ausführung:** Die Eröffnung von D ist ein tatsächlich gehandelter Preis;
  der Kauf selbst ist nicht unrealistisch. Die Kostenstufe stützt sich auf die
  Liquidität bis D−1 und unterschätzt die Kosten eines Delisting-Tags eher
  leicht.
- **Bewertung:** Lesart A ist hier eher zu günstig, weil der Wert nach dem
  Delisting unbekannt ist; Lesart B ist zu streng. Hängt das Urteil daran,
  greift die Bestimmbarkeitsregel (`NICHT_BESTIMMBAR`). Ein Blick in die
  Zukunft liegt nicht vor.
- **Häufigkeit:** Die Momentum-Varianten kaufen sterbende Paare selten. Die
  Kontrolle hält sie meist schon und kauft nur Neuzugänge. **Neu (nur
  Bericht):** `buysOnLastTradingDay` zählt solche Käufe je Reihe.
- **Urteil:** kein inhaltlicher Fehler. Ein Kaufverbot für Paare mit
  veröffentlichter Delisting-Ankündigung wäre eine Strategieänderung, also
  eine V2; nicht empfohlen.

## 8. Was unverändert blieb

- Vorregistrierung, B1–B6 und alle Schwellen.
- Risk Engine, Strategien, Gates, Arena.
- VPS, offizieller Forward-Test `OFFICIAL_V1`.
- Keine Kursdaten, keine Renditen, keine Order, kein Echtgeld.
