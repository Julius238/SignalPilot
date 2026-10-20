# Werkzeuge Deleveraging-Ereignisse V1 (`DELEVERAGING_EVENTS_V1`, D8)

Setzt die eingefrorene
[Vorregistrierung](../../../docs/trading/research/2026-10-20-deleveraging-events-v1-preregistration.md)
um: Text `f04377f`, Blob `0afb5abb…`, Statusblock `fb8d094`. Abschnittsangaben
(§) beziehen sich auf sie.

**Stand 2026-10-20: Studie ausgewertet. Der Entdeckungslauf ergibt
`NICHT_BESTANDEN`, N = 58. Die Testperiode bleibt geschlossen.**
Ergebnis: [Ergebnisbericht](../../../docs/trading/research/2026-10-20-deleveraging-events-v1-discovery-results.md).

- Das Auswerteskript enthält keinen Netzwerkcode; nur `download_data.py`
  lädt, und zwar ausschließlich Entdeckungsdaten.
- Der echte Lauf wurde genau einmal ausgeführt (`primary`, Entdeckung).
- Der Testzeitraum öffnet nur nach einem Entdeckungsergebnis `HINWEIS` oder
  `BELASTBAR`. Mit `NICHT_BESTANDEN` bleibt er geschlossen.

## Aufruf

Nur Python-Standardbibliothek, immer mit `python3 -I`:

```bash
python3 -I scripts/research/deleveraging-events-v1/test_deleveraging_events_v1.py
```

```bash
python3 -I scripts/research/deleveraging-events-v1/deleveraging_events_v1.py verify
```

| Befehl | Zweck |
|---|---|
| `synth --out DIR [--seed N]` | synthetische 1m-Kerzen, 5-Minuten-OI und Funding im Archivformat, mit eingestreuten Schocks (abwechselnd mit und ohne OI-Abbau) |
| `verify [--data DIR]` | eingefrorene Vorregistrierung (Blob ohne Statusblock), Konfigurations-Hash, mit `--data` das Manifest |
| `check-data --data DIR --period P` | Gültigkeit der OI-Punkte (G7), Anteil fehlender OI-Punkte und 1m-Kerzen, Funding; **nie Renditen**; Exit 3 bei Datenabbruch (> 5 % fehlende OI-Punkte) |
| `check-assumptions --data DIR --period P` | zählt, wie oft die Zusatzannahmen (unten) auf den Daten greifen: verschobene Ein- und Ausstiege, unvollständige 5-Minuten-Kerzen, Gründe für „kein Trade“; **nie Renditen** |
| `cost-check --data DIR --period discovery` | §6: Preiswirkung von 25 000 USD aus `bookDepth` an den Einstiegen 2023 gegen die Annahme 5 bzw. 8 bp; Exit 3, wenn sie überschritten wird; **nie Renditen** |
| `evaluate --data DIR --out DIR --period P [--variant V]` | Ereignisse, Trades, Cluster, Klasse (§9); schreibt `result-*.json` und `events-*.csv` |
| `summarize --events FILE` | beschreibende Aufschlüsselung eines Laufs: Brutto, Netto, Trefferquote, Verluste, Kosten, Funding, Stop-Anteil, Schockgröße, Schichten; je Gruppe und Symbol |

Download (Schritt 1.2, Netzwerk), nur Entdeckungsperiode samt Vorlauf; die
Testperiode 2024–2026 lädt das Skript nicht:

```bash
python3 -I scripts/research/deleveraging-events-v1/download_data.py fetch --out data/market-snapshots/deleveraging-events-v1
```

- `download_data.py plan` zeigt die feste Dateiliste ohne Netzwerk:
  - 1m-Klines und Funding monatlich, BTC ab 2020-08, ETH ab 2021-11;
  - `metrics` täglich, BTC ab 2020-09-01, ETH ab 2021-12-01;
  - `bookDepth` 2023.
- `fetch` prüft jede Datei gegen ihr `.CHECKSUM` (SHA-256) und darauf, dass
  sie genau eine lesbare CSV enthält.
  - Fehlt eine Datei im Archiv (404), wird sie als fehlend vermerkt, nie
    ersetzt.
  - Ein Neustart behält geprüfte Dateien.
  - Am Ende stehen `download-report.json` und `manifest.sha256`.
- `check` prüft alles erneut gegen Prüfsummen und Manifest.

- **Echte Daten** (ohne Datei `SYNTHETIC`) brauchen `--real --confirm
  DELEVERAGING_EVENTS_V1`. Geprüft werden die eingefrorene Vorregistrierung
  und das Manifest.
- **Testzeitraum** zusätzlich: `--discovery-result FILE --confirm-test
  DELEVERAGING_EVENTS_V1`. Das Entdeckungsergebnis muss `primary` mit
  `HINWEIS` oder `BELASTBAR` sein.
- **Varianten:**
  - `primary` ist die einzige, die eine Klasse vergibt.
  - `oi-lag-20`, `delay-5` und `spot` sind nur beschreibend (§9). `spot`
    rechnet nur Long-Trades, mit 10 bp Gebühr je Seite plus dem
    Stresszuschlag.
- `--period-start/--period-end` gibt es nur für synthetische Daten.

## Umsetzung der Regeln

- **Raster:** 5 Minuten. P(c) ist der Schluss der 1m-Kerze ab c − 1 min.
- **Kurs- und OI-Fenster:** beide c₀ − 60 bis c₀ (§16). Für das OI zählt
  ausschließlich `sum_open_interest` (Basiseinheiten).
- **Kandidat:** nur aus dem Kurs, |z_P| ≥ 3.
- **Einordnung:** zu c₀ + 10 min, mit genau OI(c₀) und OI(c₀ − 60). Es gibt
  vier Fälle: D, K, nicht zugeordnet, nicht einordenbar. Fehlende Werte oder
  weniger als 80 % gültige Normierungswerte ergeben „nicht einordenbar“, nie
  K.
- **Normierung:** Stichproben-Standardabweichung über die 8640 Rasterpunkte
  von c − 30 Tage bis c − 5 min. Der aktuelle Punkt geht nie ein.
- **Ereignisende:** die erste **vollständige** 5-Minuten-Kerze ab c₀ + 10,
  die das Extrem seit c₀ − 60 nicht erweitert. Eine Kerze mit fehlender
  Minute zählt nicht, ihre vorhandenen Minuten aktualisieren aber das Extrem.
  Ohne Ereignisende bis c₀ + 70 gibt es keinen Trade.
- **Einstieg und Ausstieg:**
  - Einstieg zum Open der 1m-Kerze ab c\* + 1 min. Fehlt sie, gilt die
    nächste vorhandene, höchstens bis c\* + 60.
  - Stop = |ΔP(c₀)| vom Einstieg aus, geprüft ab der Einstiegskerze. Liegt
    eine spätere Kerze schon beim Open jenseits des Stops, wird zum Open
    geschlossen (`STOP_GAP`).
  - Zeitausstieg zum Open der 1m-Kerze bei Einstieg + 60 min, sonst zur
    nächsten vorhandenen.
- **Kosten:**
  - Je Seite 6 bp Gebühr plus 5 bp (BTC) bzw. 8 bp (ETH); 5 bp zusätzlich
    bei einem Stop.
  - Funding: tatsächlicher Satz je Abrechnung in (Einstieg, Ausstieg]. Ein
    Long zahlt einen positiven Satz.
- **Sperre je Symbol:** ab c₀ bis zum Trade-Ende bzw. zur Feststellung
  „kein Trade“, plus 60 min. Das gilt für jede Einordnung.
- **Periodensperre:** Kerzen ab dem Periodenende gelten als fehlend.
  Kandidaten, deren Horizont c₀ + 131 min das Ende überschreitet, werden
  nicht gebildet. Vor dem Periodenbeginn liegen nur Normierungsdaten.
- **Cluster:** je Gruppe (D, K) Verkettung über beide Symbole bei höchstens
  60 min Abstand der c₀. Wert ist der Mittelwert der Trades, Schicht die des
  Trades mit dem größten |z_P|.
- **Primärer Test und Klassen** in der Reihenfolge von §9:
  - Die Kontrolle wird auf die Schichtverteilung von D umgewichtet
    (3–4, 4–6, > 6).
  - Fehlen in einer D-Schicht mindestens zwei K-Werte, ist der Vergleich
    nicht möglich: `UNZUREICHEND`.
  - Die Vorzeichenprüfung je Symbol rechnet dieselbe Umgewichtung auf
    Trade-Ebene. Ist sie dort nicht möglich, gilt die Differenz als nicht
    positiv: `UNEINHEITLICH`.
  - `BELASTBAR` verlangt t ≥ √(2·ln 58).

**Im Text der Vorregistrierung nicht ausdrücklich geregelt**, hier
konservativ umgesetzt und vor dem echten Lauf zur Kenntnis zu nehmen:

- Für die Kursnormierung gibt es keine Mindestquote, nur mindestens zwei
  Werte. `check-data` berichtet den Anteil fehlender 1m-Kerzen.
- Unvollständige 5-Minuten-Kerzen zählen nicht als Ereignisende.
- Die Suche nach einer Einstiegskerze ist auf 60 min begrenzt; danach gibt
  es keinen Trade.
- Für das Funding-Archiv werden die Spalten `calc_time` und
  `last_funding_rate` erwartet. Weicht der Kopf ab, bricht der Lauf mit einer
  Meldung ab, statt zu raten.

## Tests (nur synthetisch)

Insgesamt 34 Tests:

| Bereich | Geprüft |
|---|---|
| G7 | Raster, nicht numerisch, ≤ 0, identische und widersprüchliche Doppelungen, Anteil fehlender Punkte |
| Zeitlogik | Einordnung zu c₀ + 10 mit OI(c₀ − 60) und OI(c₀); spätere OI- und Kurswerte ändern nichts; Normierung ohne aktuellen und künftigen Wert; Einstieg erst nach allen Signaldaten |
| Kontrollgruppe | fehlendes OI(c₀) oder OI(c₀ − 60) sowie dünne Normierung → „nicht einordenbar“, nie K; „nicht zugeordnet“ zwischen den Schwellen; identische Handelsregeln für D und K |
| Überlappung | ein Kandidat je Schock; der zweite Schock erst nach der Sperre; kein Ereignisende bis zur Frist → kein Trade samt Sperre |
| Kosten und Ausstiege | 22 bp bzw. 28 bp Round-Trip; Stop mit Zuschlag; Kurslücke über den Stop; Vorzeichen des Funding für Long und Short |
| Periodensperre | Daten nach dem Ende ändern nichts; ein Kandidat zu nah am Ende wird nicht gebildet |
| Klassen | Cluster über Symbole; `UNZUREICHEND`, `NICHT_BESTANDEN`, `NUR_KURSUMKEHR`, `UNEINHEITLICH`, `HINWEIS`, `BELASTBAR` |
| Befehle | `synth` bis `check-data`, `check-assumptions`, `cost-check`, `evaluate` und `summarize`; Prüfungen vor der Auswertung zeigen nie Renditen; Sperre für echte Daten ohne Bestätigung; Periodenüberschreibung nur synthetisch; Sperre des Testzeitraums; `verify` gegen den eingefrorenen Blob; eingefrorene Werte |
