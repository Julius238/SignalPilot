# Ergebnis D8 `DELEVERAGING_EVENTS_V1`: Entdeckungslauf `NICHT_BESTANDEN`

> **Stand 2026-10-20.** Genau ein vorregistrierter Entdeckungslauf
> (`primary`, bis Ende 2023), nach der eingefrorenen
> [Vorregistrierung](2026-10-20-deleveraging-events-v1-preregistration.md)
> (Text `f04377f`, Blob `0afb5abb…`).
>
> - **Klasse `NICHT_BESTANDEN`.** Die Studie endet nach §9. Die Testperiode
>   2024–2026 bleibt unberührt; sie wurde nicht einmal heruntergeladen.
> - **Mehrfachtest-Zähler N = 58.** Nach G5 zählt D8 mit dieser Auswertung,
>   vorher N = 57.
> - Keine Regel, kein Parameter und keine Variante wurde nach dem Lauf
>   geändert oder zusätzlich gerechnet.
> - Keine Handels-, Anlage- oder Steuerberatung.

## Kurz und verständlich

- **Ereignisse:** 236 Deleveraging-Trades in 206 unabhängigen Clustern und
  1046 Kontroll-Trades in 878 Clustern. Die Mindestzahl von 40 Clustern ist
  weit überschritten.
- **Schon vor Kosten kein Vorteil:** Nach Deleveraging-Ereignissen bringen
  die 60 Minuten nach dem Ereignisende im Mittel **−7,5 bp** je Cluster
  (t −0,9).
- **Nach den Stresskosten (rund 25 bp)** bleiben **−32 bp** je Cluster
  (t −3,9). Das ist deutlich negativ und kein Zufall.
- **Gegenüber gleich großen Kursschocks ohne OI-Abbau** gibt es keinen
  Mehrwert: −5 bp (t −0,5). Der OI-Auslöser trägt nichts bei. Auch die
  Kontrolle selbst hat brutto keinen Ertrag.
- **Folge:** Kurzfristige Umkehr nach 60-Minuten-Schocks auf BTC/ETH-Perps
  gibt es in dieser Form weder mit noch ohne Deleveraging. Mit realistischen
  Kosten ist sie klar verlustbringend.

## 1. Daten und Integrität

| Prüfung | Ergebnis |
|---|---|
| Download (Schritt 1.2) | 2842 Dateien geplant, 2838 geladen, 0 beschädigt. Es fehlen nur `bookDepth` 2023-02-08/09 für beide Symbole, wie schon in den Verzeichnislisten. Rund 493 MB. Manifest `7f0ca9c4…` mit 5677 Einträgen; die erneute Prüfung fand 0 Probleme |
| Umfang | nur Entdeckung samt Vorlauf: Klines und Funding BTC ab 2020-08, ETH ab 2021-11; `metrics` BTC ab 2020-09-01, ETH ab 2021-12-01; `bookDepth` 2023. **Keine Daten aus 2024–2026** |
| 1m-Kerzen | BTC 1 709 280 und ETH 1 051 200 Minuten im Zeitraum, **0 fehlend**, keine Doppelungen |
| Open Interest (G7) | BTC fehlen 0,19 % der Punkte, ETH 0,07 % (Abbruchgrenze 5 %). Ungültig, weil ≤ 0: BTC 143, ETH 133. BTC hat 75 255 identische Doppelzeilen (einmal gezählt), widersprüchliche gibt es nicht |
| Zeitstempel | impliziter OI-Preis gegen den Handelspreis über die ganze Periode, Median der Abweichung: zu t 0,5–0,6 bp, zu t ± 5 min 7–10 bp. Das bestätigt den Snapshot bei t (15.4) |
| Funding | Kopf `calc_time, funding_interval_hours, last_funding_rate`, durchgehend im 8-Stunden-Takt; BTC −0,12 % bis +0,25 %, ETH −0,30 % bis +0,07 % je Abrechnung |
| Zusatzannahmen der README | greifen **nie**: 0 verschobene Einstiege, 0 verschobene Ausstiege, 0 unvollständige 5-Minuten-Kerzen, kein D/K-Kandidat ohne Ereignisende. Eine Ausführung zu einem späteren Preis kommt nicht vor |
| Kostenprüfung §6 (`bookDepth` 2023) | Preiswirkung von 25 000 USD: Median 0,03 bp (BTC) bzw. 0,06 bp (ETH), Maximum 0,11 bp, gegen 5 bzw. 8 bp angenommen. **Keine Anpassung**; 11 bzw. 10 Einstiege ohne nahen Snapshot |
| `verify` | eingefrorener Blob `0afb5abb…` bestätigt, Konfigurations-Hash `1337a362…`, Manifest bestätigt |

Laufdateien (lokal, nicht im Repository):
`data/replay-research/deleveraging-events-v1/result-discovery-primary.json`
(sha256 `493370f9…`) und `events-discovery-primary.csv` (sha256 `cc3e535d…`),
erzeugt am 2026-10-20 um 14:26:22 UTC.

## 2. Ereignisse

| Symbol | D (Trades) | K (Trades) | nicht zugeordnet | nicht einordenbar |
|---|---:|---:|---:|---:|
| BTCUSDT | 145 | 642 | 334 | 20 |
| ETHUSDT | 91 | 404 | 192 | 1 |
| **zusammen** | **236** (206 Cluster) | **1046** (878 Cluster) | 526 | 21 |

Jeder D- und K-Kandidat fand ein Ereignisende und wurde gehandelt. 30 der D-
und 166 der K-Cluster umfassen BTC und ETH gleichzeitig.

## 3. Ergebnisse je Trade

| | D gesamt | K gesamt | D BTC | D ETH | K BTC | K ETH |
|---|---:|---:|---:|---:|---:|---:|
| Ø brutto (bp) | −6,5 | −6,7 | −12,3 | +2,8 | −7,9 | −4,8 |
| Ø Kosten (bp) | 24,7 | 24,9 | 22,4 | 28,3 | 22,6 | 28,5 |
| Ø Funding (bp) | −0,1 | 0,0 | 0,0 | −0,2 | 0,0 | +0,1 |
| **Ø netto (bp)** | **−31,3** | **−31,6** | −34,8 | −25,8 | −30,5 | −33,2 |
| Median netto (bp) | −18,8 | −22,6 | −21,0 | −17,9 | −23,8 | −21,6 |
| Trefferquote brutto | 53 % | 50 % | 52 % | 55 % | 49 % | 53 % |
| Trefferquote netto | 35 % | 37 % | 30 % | 42 % | 38 % | 36 % |
| Ø Verlust (bp) | −84 | −100 | −78 | −94 | −100 | −100 |
| schlechtester / bester Trade (bp) | −672 / +1094 | −464 / +845 | −672 / +345 | −523 / +1094 | −453 / +747 | −464 / +845 |
| Stop-Anteil | 7 % | 12 % | 8 % | 7 % | 12 % | 10 % |

- Kosten (Gebühr, Spread, Slippage, Stop-Zuschlag) machen den Unterschied
  zwischen leicht negativ und klar negativ. Funding ist bei 60 Minuten
  Haltedauer bedeutungslos.
- Selbst ganz ohne Kosten wäre der Bruttoertrag nicht positiv.

## 4. Primärer Test und Klasse (§9)

| Schritt | Wert | Urteil |
|---|---|---|
| Cluster D / K | 206 / 878 | ≥ 40, nicht `UNZUREICHEND` |
| Ø netto D, Cluster-Ebene | −32,2 bp (t −3,9) | ≤ 0: **`NICHT_BESTANDEN`** |

Nach §9 gilt die erste zutreffende Klasse: **`NICHT_BESTANDEN`**.

Beschreibend, ohne Einfluss auf die Klasse:
- **Differenz D − K**, auf die Schockstärke von D umgewichtet: −5,0 bp
  (t −0,5).
- **Je Symbol auf Trade-Ebene:** BTC −11,4 bp (t −0,9), ETH −6,0 bp
  (t −0,3).
- **Bruttoertrag je Cluster:** D −7,5 bp (t −0,9), K −7,7 bp (t −1,8).

## 5. Ist die Kontrolle vergleichbar?

| | D | K |
|---|---:|---:|
| Ø Schockgröße \|ΔP(c₀)\| | 2,43 % | 2,39 % |
| Median \|z_P\| | 3,75 | 3,32 |
| Schichten 3–4 / 4–6 / > 6 (Trades) | 138 / 67 / 31 | 896 / 130 / 20 |
| Anteil Long (nach Abwärtsschock) | 57 % | 46 % |

- **Absolute Kursbewegung:** im Mittel praktisch gleich.
- **Normierte Stärke:** D-Ereignisse sind normiert etwas stärker und
  häufiger Abwärtsschocks. Die vorregistrierte Umgewichtung nach Schichten
  gleicht die Stärke aus.
- **Brutto- und Nettowerte:** innerhalb jeder Gruppe liegen sie so nah
  beieinander, dass auch eine andere Gewichtung das Urteil nicht drehen
  würde.

## 6. Einordnung

- **Kein Vorteil, wirtschaftlich klar negativ:**
  - Die Hypothese „Zwangsabbau erzeugt eine handelbare Überreaktion“ findet
    in den 60 Minuten nach dem Ereignisende keinen Rückhalt.
  - Weder mit OI-Abbau noch ohne gibt es eine Umkehr, die die Kosten auch nur
    annähernd deckt.
  - Das Ergebnis ist mit t −3,9 netto deutlich und kein Stichprobenproblem.
- **Schließt die Familie für diese Datenlage:** kurzfristige Umkehr nach
  Schocks auf BTC/ETH, auf 1h-Spotkerzen (2026-10-16) wie jetzt auf
  1m-Perps mit OI-Auslöser.
  - Varianten wie andere Haltedauern, Schwellen oder Wartezeiten wären
    nachträgliche Suche auf denselben Daten.
  - Sie würden nach den Regeln dieses Programms eine neue Vorregistrierung
    mit unverbrauchten Daten brauchen. Die Entdeckungsdaten 2020–2023 sind
    jetzt für diese Frage verbraucht.
- **Unberührt:** Die Testperiode 2024–2026 bleibt für diese Frage
  unverbraucht, weil nach §9 nicht geöffnet wurde.

## 7. Was unverändert bleibt

- `OFFICIAL_V1`, `main`, VPS, Champion, Challenger, Risk Engine, Arena,
  Gates.
- D6 (eingefroren, zurückgestellt), D7 (Entwurf).
- Die eingefrorene D8-Vorregistrierung.
