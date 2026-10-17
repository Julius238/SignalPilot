# Datenprüfung der Funding-Carry-Studie V2 (2026-10-17)

> **Ergebnis: alle Pflichtprüfungen bestanden (D1, D2, D4, D6, D8).**
>
> - Die 29 im Monatsarchiv vollständig fehlenden Tage sind aus dem
>   Tagesarchiv ergänzt: je 24 Stunden, ohne Auffälligkeit.
> - Datenseitig ist die Studie bereit für ihre einmalige Auswertung.
> - Es wurde **keine Rendite berechnet**; `evaluate` lief nicht.
> - Die Auswertung (Schritte 1.4/1.5) braucht die gesonderte Freigabe des
>   Betreibers.
>
> **Nachtrag 2026-10-17:** Die Auswertung ist mit Freigabe gelaufen. Das
> Ergebnis ist `KOMPRIMIERT`
> ([Ergebnisbericht](2026-10-17-funding-carry-v2-results.md)).

- Vorregistrierung:
  [V2](2026-10-17-funding-carry-feasibility-preregistration-v2.md),
  eingefroren in Commit `2f75ef0`. Sie übernimmt
  [V1](2026-10-16-funding-carry-feasibility-preregistration.md) (`248b739`)
  wörtlich.
- Vorgeschichte: [Datenprüfung V1](2026-10-17-funding-carry-data-check.md)
  (D4 gescheitert, V1 endgültig `NICHT_AUSWERTBAR`).
- Werkzeuge: [`scripts/research/funding-carry-v2/`](../../../scripts/research/funding-carry-v2/README.md)
  (`e739bca`).
- Freigabe des Downloads (V2-Schritt 1.2): Betreiber am 2026-10-17.

## 1. Download (V2-Schritt 1.2)

| | Wert |
|---|---|
| Werkzeug | `scripts/research/funding-carry-v2/download_v2.sh` |
| Ziel | `data/market-snapshots/carry-v2/` im Hauptcheckout, gitignoriert, nur lokal |
| Zeitraum des Abrufs | 2026-10-17 13:53:18 – 13:54:18 UTC |
| V1-Dateien | 1 302 aus `carry-v1/` kopiert, nicht neu geladen. Vorher wurde das V1-Manifest gegen den eingefrorenen SHA-256 `c1d34946…` geprüft (gleich); danach wurde jede Kopie bestätigt |
| Tagesdateien | 29 Archive plus 29 Prüfsummen von `data.binance.vision/data/futures/um/daily/`, genau nach Plan (`plan-daily`) |
| Prüfsummen | alle gleich, kein Neuladen nötig |
| Manifest | `manifest.sha256` mit 1 362 Einträgen, SHA-256 `20011e4f91af7156fbc8dae5c8bd3113a7b18b696896f39f85fc0b7038ad2cc8`; V1-Manifest und V1-Quellen liegen daneben als `manifest-v1.sha256` und `sources-v1.json` |
| Daten-Fingerprint V2 (Monats- und Tagesdateien) | `0d83e38401d9f28fc263cb778e0c87105260eaaa39d776b8137433044498710b` |
| Fingerprint der Monatsarchive | `e43e486ab42855a7…`, **gleich V1**: die übernommenen Daten sind unverändert |
| Lizenz | CC BY-NC-SA 4.0 und Binance-Bedingungen: nur nicht-kommerzielle Forschung, keine Weitergabe |

## 2. Ergebnis jeder Prüfung (V2-Schritt 1.3)

Prüfbericht: `data/replay-research/carry-v2/datacheck.json` (gitignoriert).

| Prüfung | Art | Ergebnis | Befund |
|---|---|---|---|
| D1 Dateien und Prüfsummen | Pflicht | **bestanden** | Monatsarchive wie V1 vollständig und gleich ihrer Prüfsumme. Jede der 29 benötigten Tagesdateien ist vorhanden und besteht ihre Prüfsumme |
| D2 Funding-Abrechnungen | Pflicht | **bestanden** | wie V1: je Symbol 7 395 Abrechnungen, 0 fehlend, Intervall durchgehend 8 h; Teilstart 2020-01-08 |
| D3 Funding-Ausreißer | Bericht | – | keine Abrechnung mit \|Rate\| > 0,375 % |
| D4 Kerzen stündlich vollständig | Pflicht | **bestanden** | alle sechs Kerzenreihen (Perp, Mark, Index × BTC, ETH) ohne fehlende Stunde ab 2020-01-08, keine fehlerhaften Kerzen |
| D5 Basis-Plausibilität | Bericht | – | unverändert gegenüber V1, auch keine neue Markierung an den ergänzten Tagen. Perp ÷ Spot über 2 %: BTCUSDT 2020-03-13 00:00 und 02:00, 2021-02-11 03:00; ETHUSDT 2023-03-24 11:00. Mark ÷ Index über 1 %: beide 2021-05-19 12:00 |
| D6 REST-Abgleich | Pflicht | **bestanden** | wie V1, keine Abweichung |
| D7 Formelanteil | Bericht | – | wie V1: 33,7 % (BTC) bzw. 33,8 % (ETH), keine Intervallwechsel |
| D8 Spot-Snapshot | Pflicht | **bestanden** | wie V1: je 32 fehlende Stunden (0,05 %), längste Lücke 5 h |
| D9 Ergänzte Tage | Bericht | – | Abschnitt 3 |

## 3. Ergänzte Tage (D9)

| Reihe | ergänzte Tage | Stunden je Tag | Auffälligkeiten |
|---|---|---|---|
| Markpreis BTCUSDT | 2021-07-01; 2021-07-24, -25, -26, -27; 2022-07-31; 2022-10-02; 2023-02-24; 2026-06-29 (9) | je 24 | keine |
| Indexpreis BTCUSDT | 2022-04-27; 2022-07-24, -25, -27, -28, -30, -31; 2022-10-02; 2023-02-13; 2023-02-24; 2023-04-07, -08; 2026-06-29 (13) | je 24 | keine |
| Markpreis ETHUSDT | 2022-10-02; 2023-02-24; 2026-06-29 (3) | je 24 | keine |
| Indexpreis ETHUSDT | 2022-07-31; 2022-10-02; 2023-02-24; 2026-06-29 (4) | je 24 | keine |
| Perp-Kerzen BTC/ETH | keine nötig | – | – |

„Keine Auffälligkeiten“ heißt:

- keine Kerze außerhalb ihres Tages;
- keine Duplikate;
- keine widersprüchlichen Stunden;
- keine Überschneidung mit dem Monatsarchiv;
- keine fehlende, fehlerhafte oder überzählige Tagesdatei.

Die Tage entsprechen genau der Liste aus der V1-Datenprüfung.

## 4. Was gesehen wurde und was nicht

- **Gesehen:** Datenqualität (Zählungen, Lücken, Zeitstempel, D9) sowie
  dieselben Berichtswerte D3, D5 und D7 wie bei V1, die V2 §5 offenlegt.
- **Nicht gesehen und nicht berechnet:**
  - keine Rendite;
  - keine Funding-Mittelwerte, -Summen oder -Verteilungen;
  - keine Kennzahl M1–M21, kein Kriterium B1–B6.
  - Die Sperre für den einmaligen Lauf ist nicht gesetzt.
  - Der Export von Champion und Challenger (Schritt 1.4) lief nicht.
- **Mehrfachtest-Zähler** unverändert N = 53; er steigt erst mit der
  Auswertung auf 55 (V2 §4).
- Unberührt: offizieller Forward-Test, VPS, Risk Engine, Strategien.

## 5. Bereit für die erste Auswertung?

**Datenseitig ja.** Offen sind nur noch Schritte, die laut V2 §6 eine
gesonderte Freigabe brauchen:

1. **Schritt 1.4, Export von Champion und Challenger:** Vergleich A
   unverändert, auf dem bereits analysierten Spot-Snapshot, rund 25 min, zählt
   nicht für N. Er liefert `benchmarks.csv` für die Auswertung.
2. **Schritt 1.5, einmalige Auswertung** beider Varianten mit allen
   Kennzahlen M1–M21 und Kriterien B1–B6.
   - Ein Lauf, höchstens ein korrigierter Lauf.
   - N steigt dabei auf 55.
   - Phase 1B ist noch offen. Erfüllt eine Variante B1–B6, meldet der Lauf
     deshalb `AUSSTEHEND_PHASE_1B` statt `BESTANDEN`.
   - Die Klassen `KOMPRIMIERT` und `NICHT_BESTANDEN` sind unabhängig von
     Phase 1B endgültig.
3. **Phase 1B:** Verfügbarkeit für ein deutsches Konto, nach V1 §10.
