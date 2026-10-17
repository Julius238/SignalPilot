# Präzisierung P7 zu D0b der Machbarkeitsstudie Relative Stärke (Entwurf, 2026-10-17)

> **Status: Entwurf zur Freigabe durch den Betreiber.**
>
> - Die eingefrorene Vorregistrierung V1 bleibt unverändert: Text `c188c38`,
>   Statusblock `6520f42`, Blob `96525664…`.
> - P7 ergänzt sie wie P1–P6 als versionierte Präzisierung und betrifft nur
>   D0b, die Wiederfindung angekündigter Delistings (§4.2).
> - Unverändert bleiben Handelslogik, Kosten, Parameter, Universum, B1–B6,
>   Signifikanzschwellen und N.
> - Teil (c) ist eine Verfahrenssicherung ohne Regeländerung und schon
>   umgesetzt (Anweisung vom 2026-10-17).
> - Grundlage: [Vorregistrierung](2026-10-17-relative-strength-feasibility-preregistration.md),
>   [Metadatenprüfung 1.2](2026-10-17-relative-strength-metadata-check.md).

## 1. Anlass

- D0b nach V1 ist **nicht durchführbar**. Alle 25 Paare der gefundenen
  Ankündigungen stehen zwar im Archiv (100 %). Zwei Jahre haben aber keine
  drei Ankündigungen.
- **2020: keine.** Die offiziellen Binance-Kataloge sind für 2020
  unvollständig: Zu STORM, ERD, LEND, MCO und HC fehlt jede Meldung.
- **2025: nur zwei.** Ab April 2025 kündigen die Texte das Ende „aller
  Spot-Paare“ einzelner Token an, ohne die Paare zu nennen.
- Mit `--accept-halt D0b` wäre jedes positive Ergebnis `NICHT_BESTIMMBAR`
  (§10.2, Regel 4). P7 soll D0b prüfbar machen, ohne es zu erleichtern.

## 2. Gegenüberstellung

| Punkt | V1 (eingefroren) | P7 (Entwurf) |
|---|---|---|
| Was geprüft wird | ob das Archiv angekündigte Delistings enthält | unverändert |
| Stichprobe 2021–2025 | die ersten drei Ankündigungen je Jahr, chronologisch, die das Handelsende mindestens eines USDT-Spot-Paars ankündigen | unverändert, chronologisch über beide Arten von (a) |
| Ankündigung mit genannten Paaren | zählt, wenn ein Paar `X/USDT` endet (Auslegung aus 1.2) | unverändert. Neu: auch die Schreibweise `XUSDT` wird erkannt; das ändert an der Stichprobe nichts |
| Token-Delisting **ohne** Paarliste | zählt nicht, weil kein Paar genannt ist | **zählt (a)**, wenn zeitlich passende archivierte Binance-Symbollisten das USDT-Paar dieses Tokens belegen |
| Ankündigung, die Paare aufzählt, aber kein USDT-Paar | zählt nicht | unverändert: Die Aufzählung gilt, kein USDT-Paar wird ergänzt |
| Aktualisierungen, regionale Einschränkungen (EWR), Abstimmungsstarts, Monitoring-Tag | zählen nicht | unverändert |
| 2020 | wie andere Jahre; mangels Quelle nicht durchführbar | **Ersatznachweis (b):** jedes USDT-Paar, das laut archivierten Symbollisten 2020 endet |
| Gefunden | eine Archivdatei bis mindestens zum Monat vor dem Handelsende | unverändert. Für (b) strenger: Die Datei muss zwischen diesem Monat und dem Monat liegen, in dem das Ende sichtbar ist, damit ein später neu vergebenes Symbol nicht zählt |
| Schwelle | ≥ 90 % der Paare je Jahr, sonst Halt und Rückfrage | unverändert |
| Heutige `exchangeInfo` | nur D0c | unverändert: nur Plausibilisierung, nie Nachweis |
| Positive Klassen | setzen bestandenes D0b voraus | unverändert |

## 3. Regel im Wortlaut

**(a) Token-Delistings.**

- Eine Binance-Ankündigung, die das Ende des Spot-Handels aller Paare
  genannter Token ankündigt, ohne die Paare aufzuzählen, zählt für ein
  Paar `<TOKEN>USDT` nur, wenn zwei archivierte Symbollisten es belegen.
- **Vorher:** In der letzten archivierten `exchangeInfo` von Binance vor der
  Veröffentlichung steht das Paar mit Basis-Asset `<TOKEN>` und Status
  `TRADING`. Maßgeblich ist der `serverTime` der Binance-Antwort.
- **Nachher:** In der ersten archivierten `exchangeInfo` nach dem
  angekündigten Handelsende ist es nicht mehr `TRADING`.
- **Kein früheres Ende dazwischen:** Keine Binance-Ankündigung zwischen
  beiden Zeitpunkten hat das Paar schon vorher entfernt. Geprüft wird das an
  den Texten der Kataloge 49 und 161.
- Ankündigungen dieser Art konkurrieren chronologisch mit den Ankündigungen
  mit Paarliste. Gezählt werden die ersten drei eines Jahres.

**(b) Ersatznachweis 2020.**

- Für 2020 gibt es keine vollständige amtliche Ankündigungsliste. Deshalb
  gilt dort statt der Ankündigungsstichprobe eine Vollerhebung.
- Gezählt wird jedes USDT-Paar, das in einer archivierten Binance-
  `exchangeInfo` mit Zeitstempel zwischen 2019-12-01 und 2020-12-31 `TRADING`
  ist und in der nächsten archivierten Liste nicht mehr. Wird es binnen
  365 Tagen wieder `TRADING`, war das eine Pause und zählt nicht.
- **Gefunden** heißt: Das Archiv hat für das Paar eine Monatsdatei zwischen
  zwei Grenzen.
  - Untere Grenze: der Monat vor der letzten `TRADING`-Liste, frühestens der
    Monat der ersten `TRADING`-Liste.
  - Obere Grenze: der Monat der Liste, in der das Ende sichtbar ist.
- Schwelle wie in V1: ≥ 90 %.

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

- **Getrennte Quellen:** Welche Paare geprüft werden, bestimmt allein Binance:
  durch Ankündigungen oder durch seine eigene Symbolliste `exchangeInfo`.
  Diese Listen hat das Internet Archive mit Zeitstempel gespeichert, ein
  unabhängiger Dritter. Das Kursarchiv `data.binance.vision` ist nur der
  Prüfgegenstand.
  - Ein Paar, das im Kursarchiv fehlt, fiele dadurch auf, statt still aus der
    Stichprobe zu verschwinden.
- **Zeitstempel:** Jede archivierte Liste trägt den `serverTime` von Binance.
  Er stimmt bei allen genutzten Listen auf die Sekunde genau mit dem
  Aufnahmezeitpunkt des Archivs überein. Die SHA-256 jeder Rohantwort ist
  abgelegt.
- **Wiederverwendete Symbole:**
  - (a) verlangt das Basis-Asset und `TRADING` **vor** der Ankündigung. Die
    heutige Liste reicht nicht.
  - (b) verlangt eine Archivdatei **im** Zeitraum des Endes.
  - Beispiele: `SKYUSDT` ist heute ein anderes Token als das 2021 delistete
    SKY. `USDSUSDT` hat Dateien bis 2020-06 und erneut ab 2026-04; gezählt
    wird nur der Teil bis 2020-06.
- **Die Daten widersprechen sich nicht:** Bei den Hebel-Token aus 2022
  meldet die Symbolliste schon vor der Ankündigung `BREAK`, und das Archiv
  endet ebenso früher. Diese Paare zählt P7 deshalb nicht; sie haben nicht
  durch diese Ankündigung geendet.

## 5. Ergebnis unter P7 (nur Metadaten)

Genutzt wurden 22 archivierte `exchangeInfo`-Listen von 2019-10-10 bis
2025-12-03. Neun weitere Aufnahmen sind bei 1 MiB abgeschnitten und wurden
verworfen.

| Jahr | Methode | Stichprobe | Paare gefunden |
|---|---|---|---|
| 2020 | (b) Vollerhebung aus Symbollisten (2019-12-23, 2020-03-28, 2020-09-14, 2020-11-09, 2020-12-02, 2021-02-10) | 18 endende USDT-Paare: 10 Hebel-Token, ERD, STORM, USDS, LEND, MCO, HC, STRAT, XZC | **18 / 18** |
| 2021 | Ankündigungen | NPXS, PAX, BZRX (wie V1) | 3 / 3 |
| 2022 | Ankündigungen | [Hebel-Token 2022-01-06](https://www.binance.com/en/support/announcement/83b0ed10abd646328bf104d871d03d70) (a: BCHUP, BCHDOWN, FILUP, FILDOWN; die übrigen 16 waren schon vorher `BREAK`), BTT, ANY | 6 / 6 |
| 2023 | Ankündigungen | BEAM, KEY, AION (wie V1) | 3 / 3 |
| 2024 | Ankündigungen | ANT/MULTI/XMR, PLA, DREP/MOB/PNT (wie V1) | 7 / 7 |
| 2025 | Ankündigungen | AMB…, AERGO… (wie V1), [Vote-to-Delist 2025-04-08](https://www.binance.com/en/support/announcement/fac9c3e401da4cc8b604566fd261d70c) (a: 14 Paare; `TRADING` am [2024-10-01](https://web.archive.org/web/20241001183136id_/https://www.binance.com/api/v3/exchangeInfo), `BREAK` am [2025-04-26](https://web.archive.org/web/20250426005818id_/https://api.binance.com/api/v3/exchangeInfo); keine Entfernung dazwischen) | 23 / 23 |

**Unter P7 wäre D0b in jedem Jahr mit 100 % bestanden.**

- Dieses Ergebnis ist bekannt, bevor P7 freigegeben ist.
- Es betrifft nur die Vollständigkeit des Archivs, keine Rendite. Es wurde
  allein aus Dateilisten, Symbollisten und Ankündigungen ermittelt.
- Die Regel entstand aus der Quellenlage. Mit dem Ergebnis abgestimmt ist sie
  nicht: Die strengere Regel für (b) und der Ausschluss der 16 Hebel-Token
  verkleinern die Stichprobe eher.

Nachvollziehen ohne Netz:

- Ergebnisse: `data/market-snapshots/relative-strength-v1/listing/announcements-d0b-p7.json`
  und `wayback-exchangeInfo/`.
- Neu rechnen:
  `fetch_metadata.py d0b-p7 --out <data>/listing --decisions scripts/research/relative-strength-v1/d0b-review-decisions.json`.

## 6. Grenzen

- **Lücken zwischen den Aufnahmen:** Ein Paar, das zwischen zwei Aufnahmen
  gelistet und wieder entfernt wurde, sieht (b) nicht. Für 2020 betrifft das
  BKRW und DAI (Juli bis August 2020); beide sind im Archiv. Die Abstände
  2020 betragen bis zu 5½ Monate.
- **2025, Abstand der Vorher-Liste:** Die letzte brauchbare Liste vor dem
  2025-04-08 stammt vom 2024-10-01. Aufnahmen aus 2024-11 bis 2025-03 sind
  im Internet Archive gesperrt (HTTP 451). Dass die 14 Paare bis zur
  Ankündigung gehandelt wurden, zeigen zwei Dinge:
  - Alle 35 Binance-Texte dazwischen sind gelesen (Titelfilter der Kataloge
    49 und 161). Keiner nennt eines der Paare.
  - 10 Tage nach dem Handelsende steht jedes der Paare auf `BREAK`.
- **Dritte Partei:** Ein unvollständiges oder manipuliertes Internet-Archiv
  ist nicht auszuschließen, aber unwahrscheinlich. `serverTime`,
  Aufnahmezeit und der Abgleich mit dem Kursarchiv stimmen überein.
- **Kataloge 2021–2025:** Dass sie vollständig sind, bleibt unbeweisbar.
  „Die ersten drei“ heißt weiter: die ersten drei in den Katalogen.
- **2020, amtliche Ankündigungen:** ANNOUNCEMENTS_2020

## 7. Falls P7 nicht freigegeben wird

- **Rückfallebene: eingeschränkte Forschung.**
  - Weiter mit `--accept-halt D0b`. Nach Regel 4 ist ein positives Ergebnis
    dann `NICHT_BESTIMMBAR`.
  - Ein gutes Ergebnis darf nur als Hinweis berichtet werden, nie als
    bestätigt. Es öffnet keinen Gate-v4-Pfad und keinen Shadow-Betrieb.
  - N steigt trotzdem auf 57, sobald Renditen berechnet sind.
- **Bewertung:** Diese Variante kostet die Aussagekraft der Studie. Wegen des
  unabhängigen Nachweises oben halte ich sie für unnötig.

## 8. Umsetzung

| Teil | Ort | Stand |
|---|---|---|
| Archivierte Symbollisten laden (je Monat die erste brauchbare Aufnahme) | `fetch_metadata.py snapshots` | fertig, getestet |
| P7-Stichprobe, Ersatznachweis 2020, Archivabgleich | `fetch_metadata.py d0b-p7` | fertig, getestet; Ergebnis nur Bericht |
| Entscheidungen je Ankündigung, mit P7-Feldern für die zwei Token-Delistings | `d0b-review-decisions.json` | fertig |
| D0b nach P7 im Studienskript, mit eigener Neuprüfung gegen die Liste; V1 bleibt als `v1` im Bericht | `relative_strength_v1.py`, `APPROVED_PRECISIONS` | vorbereitet. **Aktiv erst nach Freigabe**, dazu ein eigener Commit mit `("P7",)` |
| Lange Lücken (c) | `fetch_metadata.py gap-check`, D11 in `relative_strength_v1.py` | umgesetzt |
| B3(c) (d) | Auslegungstext im Ergebnis | umgesetzt |

**Freigabe bedeutet:**

1. Statusblock in diesem Dokument („freigegeben“, Datum, Commit).
2. `APPROVED_PRECISIONS = ("P7",)` in einem eigenen Commit.
3. `check-listing` erneut ausführen: D0b nach P7, kein Halt mehr.
