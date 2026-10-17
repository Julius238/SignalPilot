# Präzisierung P7 zu D0b der Machbarkeitsstudie Relative Stärke (Entwurf, 2026-10-17)

> **Status: Entwurf zur Freigabe durch den Betreiber.**
>
> - Die eingefrorene Vorregistrierung V1 bleibt unverändert: Text `c188c38`,
>   Statusblock `6520f42`, Blob `96525664…`.
> - P7 ergänzt sie wie P1–P6 als versionierte Präzisierung. Sie betrifft nur
>   D0b, die Wiederfindung angekündigter Delistings (§4.2), und dort nur die
>   Frage, wann ein Token-Delisting ohne Paarliste ein USDT-Paar beendet.
> - Unverändert bleiben Handelslogik, Kosten, Parameter, Universum, B1–B6,
>   Signifikanzschwellen, N und die D0b-Schwelle von 90 %.
> - Teile (c) und (d) sind schon umgesetzt: (c) als Verfahrenssicherung ohne
>   Regeländerung, (d) als festgehaltene Auslegung (Anweisung vom
>   2026-10-17).
> - Grundlage: [Vorregistrierung](2026-10-17-relative-strength-feasibility-preregistration.md),
>   [Metadatenprüfung 1.2](2026-10-17-relative-strength-metadata-check.md).

## 1. Anlass und Korrektur der Durchführung von 1.2

- **Fehler in meiner Durchführung von 1.2:** Die Stichprobe in 1.2 las nur
  die Binance-Kataloge 49 und 161. 2020 hat Binance Delistings und
  Paar-Entfernungen aber im Katalog 48 („New Cryptocurrency Listing“)
  abgelegt. Manche Entfernungen stehen zudem in Meldungen, die neue Paare
  ankündigen (2020: BKRW/USDT und DAI/USDT, ersetzt durch USDT/BKRW und
  USDT/DAI).
  - V1 schränkt die Quelle nicht ein („öffentliche Binance-Ankündigungen“).
    Die Lücke war also ein Durchführungsfehler, keine Regelfrage.
- **Korrigiert** (V1-Durchführung, keine Präzisierung):
  - Kataloge 48, 49 und 161 vollständig;
  - Titel mit „trading pair“ zusätzlich;
  - jede Meldung, die ein USDT-Paar nennt und ein mögliches Handelsende
    erwähnt, wird von Hand entschieden.
  - Rund 160 Texte kamen hinzu. In 2021–2024 ändert sich vor dem jeweils
    dritten Treffer nichts.
- **D0b nach V1, korrigiert:**

  | Jahr | Ankündigungen | Paare gefunden |
  |---|---|---|
  | 2020 | 3: [FTX-Hebel-Token](https://www.binance.com/en/support/announcement/360041613471) (2020-03-28), [BKRW/USDT](https://www.binance.com/en/support/announcement/5fc9dbef7ab444eca29095666419ede4) (2020-08-06), [DAI/USDT](https://www.binance.com/en/support/announcement/cf77f566c9b64cc791fc152679175de8) (2020-08-11) | 12 / 12 |
  | 2021–2024 | je 3, wie in 1.2 | 3/3, 3/3, 3/3, 7/7 |
  | 2025 | **2** | 9 / 9 |

  - D0b ist nach V1 **weiter nicht durchführbar**, jetzt nur noch wegen
    2025.
  - Ab April 2025 kündigt Binance das Ende „aller Spot-Paare“ einzelner Token
    an, ohne die Paare zu nennen. Für solche Ankündigungen hat V1 keine
    Regel.
- Mit `--accept-halt D0b` wäre jedes positive Ergebnis `NICHT_BESTIMMBAR`
  (§10.2, Regel 4). P7 macht D0b prüfbar, ohne es zu erleichtern.

## 2. Gegenüberstellung

| Punkt | V1 (eingefroren, Durchführung korrigiert) | P7 (Entwurf) |
|---|---|---|
| Was geprüft wird | ob das Archiv angekündigte Delistings enthält | unverändert |
| Quelle | öffentliche Binance-Ankündigungen, Kataloge 48, 49 und 161 | unverändert |
| Stichprobe | je Jahr 2020–2025 die ersten drei Ankündigungen, chronologisch, die das Handelsende mindestens eines USDT-Spot-Paars ankündigen | unverändert |
| Ankündigung nennt das USDT-Paar | zählt (Schreibweise `X/USDT` oder `XUSDT`) | unverändert |
| Ankündigung zählt Paare auf, aber kein USDT-Paar | zählt nicht | unverändert: Die Aufzählung gilt, kein USDT-Paar wird ergänzt |
| Token-Delisting **ohne** Paarliste („alle Paare von X“) | nicht geregelt; in 1.2 als „zählt nicht“ ausgelegt | **zählt (a)**, wenn zeitlich passende, archivierte Binance-Symbollisten das USDT-Paar dieses Tokens belegen |
| Aktualisierungen, regionale Einschränkungen (EWR), Abstimmungsstarts, Monitoring-Tag, vorübergehende Handelsstopps | zählen nicht | unverändert |
| Gefunden | eine Archivdatei bis mindestens zum Monat vor dem Handelsende | unverändert |
| Schwelle und Folge | ≥ 90 % der Paare je Jahr, sonst Halt und Rückfrage; positive Klassen setzen bestandenes D0b voraus | unverändert |
| Heutige `exchangeInfo` | nur D0c | unverändert: nur Plausibilisierung, nie Nachweis |

## 3. Regel im Wortlaut

**(a) Token-Delistings ohne Paarliste.**

- Kündigt eine Binance-Ankündigung das Ende des Spot-Handels aller Paare
  genannter Token an, ohne die Paare aufzuzählen, zählt sie für ein Paar
  `<TOKEN>USDT` nur, wenn alle drei Bedingungen gelten:
  1. **Vorher:** Die letzte archivierte Binance-`exchangeInfo` vor der
     Veröffentlichung führt das Paar mit Basis-Asset `<TOKEN>` und Status
     `TRADING`. Maßgeblich ist der `serverTime` der Binance-Antwort.
  2. **Nachher:** Die erste archivierte `exchangeInfo` nach dem angekündigten
     Handelsende führt es nicht mehr als `TRADING`.
  3. **Kein früheres Ende dazwischen:** Keine Binance-Ankündigung zwischen
     beiden Zeitpunkten hat das Paar schon entfernt. Geprüft wird das an den
     Texten der Kataloge 48, 49 und 161.
- Belegt eine solche Ankündigung mindestens ein Paar, konkurriert sie
  chronologisch mit den Ankündigungen mit Paarliste. Gezählt werden die
  ersten drei eines Jahres.
- **Quelle der Symbollisten:** Internet Archive (`web.archive.org`), Abruf
  der Rohantwort (`id_`). Je Monat zählt die erste vollständig lesbare
  Aufnahme der Adressen `www`/`api.binance.com/api/v1|v3/exchangeInfo`.

**(b) Zusatzbericht, kein Kriterium.**

- Jedes USDT-Paar, das in einer archivierten Liste `TRADING` ist und in der
  nächsten nicht mehr (2019-12 bis 2025-12), wird im Archiv gesucht.
- Gesucht wird eine Monatsdatei zwischen zwei Grenzen:
  - Untere Grenze: der Monat vor der letzten `TRADING`-Liste, frühestens der
    Monat der ersten.
  - Obere Grenze: der Monat der Liste, in der das Ende sichtbar ist.
- Ein Paar, das binnen 365 Tagen wieder `TRADING` ist, war nur pausiert.
- Der Bericht prüft die Vollständigkeit über die Stichprobe hinaus und ändert
  das D0b-Urteil nicht.

**(c) Lange Lücken (Verfahren, schon umgesetzt):**

- Eine Lücke von 7 oder mehr Tagen bei einem Mitglied von Uₜ, ohne belegte
  Handelspause, wird erst als E3 gebucht, wenn die Stundendateien des
  Archivs für die Lückentage geprüft sind (`fetch_metadata.py gap-check`).
- **Verdacht auf Archivfehler:** Liegen Stundendateien in der Lücke, die
  Tageskerzen aber fehlen, ist das ein Verdacht auf einen Archivfehler.
- **D11-Halt:** Eine solche Lücke, ebenso jede ungeprüfte, stoppt bei D11
  zur Rückfrage.
- **Nicht prüfbar:** Hat das Stundenarchiv um die Lücke herum gar keine
  Dateien, wird sie als „nicht prüfbar“ berichtet und nach §4.3 wie bisher
  behandelt.
- Die Regeln E2/E3, D3 und die Behandlung von Käufen am letzten Handelstag
  bleiben unverändert.

**(d) Festgehaltene Auslegung zu B3(c), keine Kriterienänderung:**

- **Monats-Sharpe:** Sie ist die primäre Berechnung, vom Betreiber am
  2026-10-17 bestätigt (M2: × √12, ohne Zins).
- **Konsistenz:** Sie nutzt dieselben Kalendermonats-Renditen wie alle
  α-Tests, auch für die Referenz R.
- **Tages-Sharpe:** Sie wird nur als Sensitivität ausgewiesen
  (`cWithDailySharpe`, `b3cSharpeDefinitionCheck`) und ersetzt die
  Hauptentscheidung nie.

## 4. Warum das keine Selbstbestätigung ist

- **Getrennte Quellen:** Welche Paare geprüft werden, bestimmen allein
  Binance-Quellen: Ankündigungstexte und Binances eigene Symbolliste
  `exchangeInfo`. Diese Listen hat das Internet Archive mit Zeitstempel
  gespeichert, ein unabhängiger Dritter. Das Kursarchiv
  `data.binance.vision` ist nur der Prüfgegenstand.
  - Ein Paar, das im Kursarchiv fehlt, fiele dadurch auf, statt still aus der
    Stichprobe zu verschwinden.
- **Zeitstempel:** Der `serverTime` jeder genutzten Liste stimmt auf die
  Sekunde mit dem Aufnahmezeitpunkt des Archivs überein. Die SHA-256 jeder
  Rohantwort ist abgelegt.
- **Wiederverwendete Symbole:**
  - (a) verlangt das Basis-Asset und `TRADING` **vor** der Ankündigung. Die
    heutige Liste reicht nicht.
  - Beispiel: `SKYUSDT` ist heute ein anderes Token als das 2021 delistete
    SKY. `USDSUSDT` hat Dateien bis 2020-06 und erneut ab 2026-04.
- **Die Daten widersprechen sich nicht:**
  - Bei 16 der 20 Hebel-Token der Ankündigung vom 2022-01-06 meldet die
    Symbolliste schon vor der Ankündigung `BREAK`, und das Archiv endet
    ebenso früher (2021-12). P7 zählt sie deshalb nicht.
  - Eine Regel, die nur auf Ankündigungen schaute, hätte sie gezählt und
    womöglich als „fehlend“ gewertet.

## 5. Ergebnis unter P7 (nur Metadaten)

Genutzt wurden 22 archivierte `exchangeInfo`-Listen von 2019-10-10 bis
2025-12-03. Neun weitere Aufnahmen sind bei 1 MiB abgeschnitten und wurden
verworfen.

| Jahr | die ersten drei Ankündigungen unter P7 | Paare gefunden |
|---|---|---|
| 2020 | FTX-Hebel-Token (2020-03-28, genannt); [STORM-Tausch](https://www.binance.com/en/support/announcement/360043990532) (2020-06-03, a); [USDS-Delisting](https://www.binance.com/en/support/announcement/52e0db956218405b8b5eda03012a0798) (2020-06-24, a). STORM und USDS sind `TRADING` am 2020-03-28 und `BREAK` am 2020-09-14 | 12 / 12 |
| 2021 | NPXS, PAX, BZRX (wie V1) | 3 / 3 |
| 2022 | [Hebel-Token](https://www.binance.com/en/support/announcement/83b0ed10abd646328bf104d871d03d70) (2022-01-06, a: BCHUP, BCHDOWN, FILUP, FILDOWN); BTT; ANY | 6 / 6 |
| 2023 | BEAM, KEY, AION (wie V1) | 3 / 3 |
| 2024 | ANT/MULTI/XMR, PLA, DREP/MOB/PNT (wie V1) | 7 / 7 |
| 2025 | AMB…, AERGO… (wie V1); [Vote-to-Delist](https://www.binance.com/en/support/announcement/fac9c3e401da4cc8b604566fd261d70c) (2025-04-08, a: 14 Paare) | 23 / 23 |

**Unter P7 wäre D0b in jedem Jahr mit 100 % bestanden.**

Belege zum Vote-to-Delist 2025:

- Alle 14 Paare sind `TRADING` am
  [2024-10-01](https://web.archive.org/web/20241001183136id_/https://www.binance.com/api/v3/exchangeInfo)
  und `BREAK` am
  [2025-04-26](https://web.archive.org/web/20250426005818id_/https://api.binance.com/api/v3/exchangeInfo).
- Alle 35 Binance-Texte dazwischen sind gelesen, keiner nennt eines der
  Paare.

**Zusatzbericht (b):**

| Jahr | endende USDT-Paare | im Archiv |
|---|---|---|
| 2020 | 18 | 18 |
| 2021 | 19 | 19 |
| 2022 | 40 | 40 |
| 2023 | 26 | 26 |
| 2024 | 70 | 70 |
| 2025 | 20 | 20 |

Kein einziges Paar fehlt (193 von 193).

**Einordnung:**

- Diese Ergebnisse sind bekannt, bevor P7 freigegeben ist. Sie betreffen nur
  die Vollständigkeit des Archivs, keine Rendite. Ermittelt wurden sie allein
  aus Dateilisten, Symbollisten und Ankündigungen.
- Die Regel (a) folgt der Quellenlage: Sie wird nur gebraucht, weil Binance
  ab 2025 keine Paare mehr nennt. Sie macht die Stichprobe nicht günstiger.
  Auch nach V1 (korrigiert) sind alle 37 Paare gefunden, und der
  Zusatzbericht ist ohne Ausnahme.

Nachvollziehen ohne Netz:

- Ergebnisse in `data/market-snapshots/relative-strength-v1/listing/`:
  `announcements-d0b-p7.json`, `announcements-d0b.json` (V1, korrigiert) und
  `wayback-exchangeInfo/`.
- Neu rechnen: `fetch_metadata.py d0b-p7` und `d0b-sample`, je mit
  `--decisions scripts/research/relative-strength-v1/d0b-review-decisions.json`.

## 6. Grenzen

- **Abstände zwischen den Aufnahmen:** Der Zusatzbericht (b) sieht kein Paar,
  das zwischen zwei Aufnahmen gelistet und wieder entfernt wurde (2020 etwa
  BKRW und DAI). Diese beiden sind aber über ihre Ankündigungen in der
  V1-Stichprobe.
- **2025, Abstand der Vorher-Liste:** Die letzte brauchbare Liste vor dem
  2025-04-08 stammt vom 2024-10-01. Spätere Aufnahmen sind gesperrt
  (HTTP 451). Die Lücke schließen die 35 gelesenen Texte und der Status
  `BREAK` 10 Tage nach dem Handelsende.
- **Dritte Partei:** Ein unvollständiges Internet-Archiv ist nicht
  auszuschließen. `serverTime`, Aufnahmezeit und Kursarchiv stimmen aber
  überein.
- **Kataloge:** Dass 48, 49 und 161 vollständig sind, bleibt unbeweisbar.
  - Kataloge für Fiat, API und Wartung wurden nicht durchsucht.
  - Von Binance gelöschte Artikel sind unsichtbar.
  - Für 2020 Januar bis Juni deckt sich der Katalog 48 mit den archivierten
    Zendesk-Adressen der damaligen Binance-Hilfeseiten (Abgleich über den
    CDX-Index des Internet Archive).
- **Prüfung:** Die Entscheidungen hat Claude allein getroffen, ohne
  Zweitprüfung. Jede ist am Text begründet
  ([`d0b-review-decisions.json`](../../../scripts/research/relative-strength-v1/d0b-review-decisions.json)).

## 7. Falls P7 nicht freigegeben wird

- D0b bleibt nach V1 nicht durchführbar, weil 2025 nur zwei Ankündigungen
  hat. Weiter ginge es nur als **eingeschränkte Forschung**:
  - mit `--accept-halt D0b`;
  - ein positives Ergebnis wäre dann `NICHT_BESTIMMBAR` und dürfte nur als
    Hinweis berichtet werden, nie als bestätigt;
  - es öffnet keinen Gate-v4-Pfad und keinen Shadow-Betrieb;
  - N steigt trotzdem auf 57, sobald Renditen berechnet sind.
- **Bewertung:** Bei 100 % Wiederfindung nach V1 und P7 und einem
  lückenlosen Zusatzbericht halte ich diesen Weg für unnötig.

## 8. Umsetzung

| Teil | Ort | Stand |
|---|---|---|
| Kataloge 48/49/161, Titel mit „trading pair“, Schreibweise `XUSDT`, automatische Entscheidung ohne Handelsende | `fetch_metadata.py` | fertig, getestet (V1-Durchführung) |
| Archivierte Symbollisten | `fetch_metadata.py snapshots` | fertig, getestet |
| P7-Stichprobe und Zusatzbericht | `fetch_metadata.py d0b-p7` | fertig, getestet; Ergebnis nur Bericht |
| Entscheidungen je Ankündigung, P7-Felder für Token-Delistings | `d0b-review-decisions.json` | fertig |
| D0b nach P7 im Studienskript, mit eigener Neuprüfung gegen die Liste; V1 bleibt als `v1` im Bericht | `relative_strength_v1.py`, `APPROVED_PRECISIONS` | vorbereitet. **Aktiv erst nach Freigabe**, dazu ein eigener Commit mit `("P7",)` |
| Lange Lücken (c) | `fetch_metadata.py gap-check`, D11 in `relative_strength_v1.py` | umgesetzt |
| B3(c) (d) | Auslegungstext im Ergebnis | umgesetzt |

**Freigabe bedeutet:**

1. Statusblock in diesem Dokument („freigegeben“, Datum, Commit).
2. `APPROVED_PRECISIONS = ("P7",)` in einem eigenen Commit.
3. `check-listing` erneut ausführen: D0b nach P7, kein Halt mehr.
