# Datenprüfung der Funding-Carry-Studie V1 (2026-10-17)

> **Ergebnis: `NICHT_AUSWERTBAR` nach §8.2 der Vorregistrierung.** Die
> Pflichtprüfung D4 scheitert bei BTCUSDT: In den Monatsarchiven der Mark- und
> der Indexpreis-Kerzen fehlen ganze Tage.
>
> Die Arbeit ist an dieser Stelle angehalten.
>
> - Es wurde **keine Rendite berechnet**; `evaluate` wurde nie gestartet.
> - Die Vorregistrierung und die Datenquelle sind unverändert.
> - Wie es weitergeht, entscheidet der Betreiber (Abschnitt 5).

- Vorregistrierung:
  [Funding-Carry V1](2026-10-16-funding-carry-feasibility-preregistration.md),
  eingefroren in Commit `248b739` (Blob `9b00cc92…`).
- Skript: [`scripts/research/funding-carry-v1/`](../../../scripts/research/funding-carry-v1/README.md),
  Befehl `check-data`.
- Freigabe des Downloads (Schritt 1.2): Betreiber am 2026-10-17, ausdrücklich
  mit der Auflage, bei einer gescheiterten Pflichtprüfung anzuhalten.

## 1. Download (Schritt 1.2)

| | Wert |
|---|---|
| Werkzeug | `scripts/research/funding-carry-v1/download_v1.sh` |
| Ziel | `data/market-snapshots/carry-v1/` im Hauptcheckout, gitignoriert, nur lokal (nicht auf dem VPS) |
| Zeitraum des Abrufs | 2026-10-17 09:06:05 – 09:27:03 UTC |
| Binance-Archiv | 648 Monatsarchive (BTCUSDT, ETHUSDT × `fundingRate`, `klines`, `markPriceKlines`, `indexPriceKlines` 1h × 81 Monate 2020-01 – 2026-09) plus 648 Prüfsummen |
| Prüfsummen | alle 648 gleich, kein Neuladen nötig |
| REST-Stichprobe | `GET /fapi/v1/fundingRate`, je Symbol 2020-01 und 2026-09 (4 Dateien) |
| FRED | `DTB3.csv` |
| Manifest | `manifest.sha256` mit 1 302 Einträgen; SHA-256 des Manifests `c1d349467279355b525a003c74371aab60457fe63bab7a7e4ff06d2f12138908` |
| Daten-Fingerprint (D1, über alle Archive) | `e43e486ab42855a71c0a9ca1264b45883cb441122a4ab7386c063713ad952309` |
| Umfang auf der Platte | 17 MB |
| Lizenz | CC BY-NC-SA 4.0 und `TERMS_AND_CONDITIONS` von `binance-public-data`: nur nicht-kommerzielle Forschung, keine Weitergabe |

Der vorhandene Spot-Snapshot `data/market-snapshots/real/` wurde nur gelesen,
nicht neu geladen. SHA-256 der 1h-Dateien: BTCUSDT `60045e64a5b58537…`,
ETHUSDT `98aca25762034c5f…`.

## 2. Ergebnis jeder Prüfung (Schritt 1.3)

Prüfbericht: `data/replay-research/carry-v1/datacheck.json` (gitignoriert).

| Prüfung | Art | Ergebnis | Befund |
|---|---|---|---|
| D1 Dateien und Prüfsummen | Pflicht | **bestanden** | alle 8 Reihen 2020-01 – 2026-09 ohne fehlenden Monat; alle SHA-256 gleich `.CHECKSUM`; keine Datei nach 2026-09 |
| D2 Funding-Abrechnungen | Pflicht | **bestanden** | je Symbol 7 395 Abrechnungen von 2020-01-01 bis 2026-09-30; 0 fehlend, keine Duplikate, keine widersprüchlichen Slots, Intervall durchgehend 8 h; Teilstart nach §2.1 am **2020-01-08** |
| D3 Funding-Ausreißer | Bericht | – | keine Abrechnung mit \|Rate\| > 0,375 % |
| D4 Kerzen stündlich vollständig | Pflicht | **nicht bestanden** | BTCUSDT Mark- und Indexpreise, siehe Abschnitt 3 |
| D5 Basis-Plausibilität | Bericht | – | Perp ÷ Spot über 2 %: BTCUSDT 2020-03-13 00:00 und 02:00, 2021-02-11 03:00; ETHUSDT 2023-03-24 11:00. Mark ÷ Index über 1 %: beide Symbole 2021-05-19 12:00 |
| D6 REST-Abgleich | Pflicht | **bestanden** | REST gleich Archiv in beiden Monaten und für beide Symbole (93 bzw. 90 Abrechnungen, 0 Abweichungen) |
| D7 Formelanteil | Bericht | – | 33,7 % (BTC) bzw. 33,8 % (ETH) der 8h-Abrechnungen genau 0,0100 %; keine Intervallwechsel |
| D8 Spot-Snapshot | Pflicht | **bestanden** | je Symbol 32 fehlende Stunden (0,05 %), längste Lücke 5 h, keine fehlerhaften Kerzen |

Perp-Kerzen (`klines`): Beide Symbole sind lückenlos (58 992 Stunden ab
2020-01-08). Fehlerhafte Kerzen (Tief über Eröffnung oder Schluss, Hoch
darunter) gibt es in keiner Reihe.

## 3. Der Befund: ganze Tage fehlen in den Mark- und Indexpreis-Archiven

| Reihe | fehlende Stunden | Anteil (Grenze 0,5 %) | längste Lücke (Grenze 24 h) | D4 | fehlende UTC-Tage |
|---|---:|---:|---:|---|---|
| Markpreis BTCUSDT | 216 | 0,37 % | **96 h** | nein | 2021-07-01; 2021-07-24 – 07-27; 2022-07-31; 2022-10-02; 2023-02-24; 2026-06-29 |
| Indexpreis BTCUSDT | 312 | **0,53 %** | **48 h** | nein | 2022-04-27; 2022-07-24/25; 2022-07-27/28; 2022-07-30/31; 2022-10-02; 2023-02-13; 2023-02-24; 2023-04-07/08; 2026-06-29 |
| Markpreis ETHUSDT | 72 | 0,12 % | 24 h | ja | 2022-10-02; 2023-02-24; 2026-06-29 |
| Indexpreis ETHUSDT | 96 | 0,16 % | 24 h | ja | 2022-07-31; 2022-10-02; 2023-02-24; 2026-06-29 |

- **Kein Lesefehler des Skripts.** Eine unabhängige Gegenprobe direkt auf den
  Rohdateien, nur Zeilen und Zeitstempel, bestätigt die Lücken.
  - `markPriceKlines/BTCUSDT 2021-07` enthält 624 Stunden (26 Tage), es fehlen
    der 1. und der 24.–27. Juli.
  - `indexPriceKlines/BTCUSDT 2022-07` enthält 600 Stunden (25 Tage).
  - `klines/BTCUSDT 2021-07` ist mit 744 Stunden vollständig.
- **Ursache vermutlich im Archiv, nicht im Markt.**
  - Die Perp-Kerzen derselben Tage sind vollständig.
  - Mehrere Tage fehlen in allen vier Reihen zugleich (2022-10-02, 2023-02-24,
    2026-06-29).
- **ETHUSDT** hat dieselbe Art Lücken. Sie bleiben aber bei genau einem Tag
  und liegen damit innerhalb der Grenze von 24 h.
- **Regelfolge:**
  - §2.2 D4: „Bei Überschreitung `NICHT_AUSWERTBAR`.“
  - §8.4: „Die Arbeit endet vor jeder Renditeberechnung. Eine andere
    Datenquelle braucht eine neue Vorregistrierung.“

**Was die Lücken in der Auswertung bewirken würden (sachlich, keine
Entscheidung):**

- Der Markpreis trägt in der Simulation vier Dinge: Funding-Betrag, Bewertung
  des Perp-Beins, Liquidationsprüfung und Rebalancing-Auslöser. Außerdem ist
  er Bedingung jeder Ausführung (§3.1).
  - Eine Lücke von 96 h würde Ausführungen um bis zu vier Tage verschieben.
  - Ebenso lange würde die Liquidationsprüfung ausfallen.
  - Genau dagegen steht die 24-h-Grenze.
- Der Indexpreis dient nur der Plausibilitätsprüfung D5 (Bericht). In die
  Simulation geht er nicht ein.

## 4. Was gesehen wurde und was nicht

- **Gesehen:**
  - Kennzahlen zur Datenqualität (Zählungen, Lücken, Zeitstempel);
  - D3 (keine Ausreißer);
  - die markierten Zeitpunkte aus D5;
  - der Formelanteil aus D7 (33,7 % bzw. 33,8 %).
- **Nicht gesehen und nicht berechnet:**
  - keine Rendite;
  - keine Funding-Mittelwerte, -Summen oder -Verteilungen;
  - keine Kennzahl M1–M21, kein Kriterium B1–B6.
  - `evaluate` lief nie, die Sperre für den einmaligen Lauf ist also nicht
    gesetzt.
  - Der Export von Champion und Challenger (Schritt 1.4) lief nicht.
- **Mehrfachtest-Zähler** unverändert N = 53. Er steigt erst mit einer
  Auswertung (§11).
- Unberührt: offizieller Forward-Test, VPS, Risk Engine, Strategien.

## 5. Mögliche Wege (Entscheidung des Betreibers)

Jeder Weg außer dem ersten verlangt nach §8.4 eine **neue Vorregistrierung
(V2)** vor jeder Renditeberechnung. Eine V2 wäre noch sauber: Bisher sind nur
Datenqualität und die Berichtswerte D3/D5/D7 bekannt, keine Rendite. Sie
müsste diese Kenntnis offenlegen.

1. **V1 als `NICHT_AUSWERTBAR` abschließen.** Für V1 ist die Carry-Frage dann
   unbeantwortet, nicht verneint.
2. **V2 mit Lückenfüllung aus dem Binance-Tagesarchiv** (Empfehlung).
   - Laut Verzeichnisliste sind alle 29 fehlenden Tage als Tagesdateien mit
     Prüfsumme vorhanden (`data/futures/um/daily/{markPriceKlines,indexPriceKlines}/<SYM>/1h/`).
     Ihr Inhalt ist ungeprüft.
   - Gleicher Anbieter, gleiches Format.
   - Nur die im Monatsarchiv fehlenden Tage würden ergänzt. D4 bliebe danach
     unverändert Pflicht, alles andere ebenfalls.
   - Das ist die kleinste Abweichung von V1.
3. **V2 mit den REST-Endpunkten** `/fapi/v1/markPriceKlines` und
   `/fapi/v1/indexPriceKlines` für die fehlenden Tage. Gleicher Zweck, aber
   ohne Prüfsummen.

Eine Lockerung der D4-Grenze oder das Herausnehmen der Indexpreise aus D4 nach
diesem Befund wäre eine Regeländerung im Licht der Daten. Sie wird hier nicht
empfohlen.

## 6. Stand des Untersuchungsplans

| Schritt | Stand |
|---|---|
| 1.1 Skript, synthetisch getestet | fertig (`8f71ffd`, `32ad7bb`) |
| 1.2 Download | fertig (dieser Bericht) |
| 1.3 Datenprüfung D1–D8 | fertig: **D4 nicht bestanden → `NICHT_AUSWERTBAR`** |
| 1.4 Export Champion/Challenger | vorbereitet (`2ad7d05`), nicht ausgeführt |
| 1.5 Auswertung | gesperrt (Regel §8.4 und Auflage des Betreibers) |
| 1.6 Phase 1B Verfügbarkeit | offen |
| 1.7 Ergebnisbericht | entfällt unter V1 |
