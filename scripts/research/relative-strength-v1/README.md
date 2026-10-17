# Werkzeuge Relative Stärke V1 (`RELATIVE_STRENGTH_FEASIBILITY_V1`)

Setzt die eingefrorene
[Vorregistrierung](../../../docs/trading/research/2026-10-17-relative-strength-feasibility-preregistration.md)
um (Text `c188c38`, Blob `96525664…`, Statusblock `6520f42`). Abschnittsangaben
(§) beziehen sich auf sie.

**Stand 2026-10-17: Schritt 1.2, Präzisierung P7 freigegeben, Downloader für 1.3 bereit.**

- `relative_strength_v1.py` ist fertig und nur gegen synthetische Daten
  getestet. Es enthält keinen Netzwerkcode und hat nie Kursdaten gelesen.
- `fetch_metadata.py` (Schritt 1.2) ruft nur Metadaten ab: Verzeichnisliste
  des Archivs, `exchangeInfo`, öffentliche Ankündigungen. Ergebnis:
  [Metadatenprüfung](../../../docs/trading/research/2026-10-17-relative-strength-metadata-check.md).
- `download_archive.py` (Schritt 1.3) lädt die Tageskerzen samt `.CHECKSUM`
  und schreibt `manifest.sha256`; bisher nur offline getestet.
- [Präzisierung P7](../../../docs/trading/research/2026-10-17-relative-strength-d0b-precision-p7.md)
  zu D0b ist freigegeben (2026-10-17) und über `APPROVED_PRECISIONS = ("P7",)`
  aktiv. `check-listing` prüft D0b nach P7, die V1-Lesart steht als `v1`
  daneben.
- Download (1.3) und Auswertung (1.5) brauchen je eine eigene Freigabe.

## Aufruf

Nur Python-Standardbibliothek, immer mit `python3 -I`:

```bash
python3 -I scripts/research/relative-strength-v1/test_relative_strength_v1.py
```

```bash
python3 -I scripts/research/relative-strength-v1/relative_strength_v1.py verify
```

| Befehl | Zweck | Schritt |
|---|---|---|
| `synth --out DIR` | synthetische Daten im Archivformat, mit allen Sonderfällen (E2–E7, X1–X5, Stufen) | Tests, Probelauf |
| `verify [--data DIR]` | eingefrorene Vorregistrierung (Blob), Konfigurations-Hash, mit `--data` das Manifest | vor 1.2 und 1.5 |
| `check-listing --data DIR` | D0, D0b, D0c auf den Metadaten aus 1.2; Exit 3 bei einem Halt | 1.2 |
| `plan --data DIR` | fehlende Tage (E1), Sprungtage (D12, nur Uₜ-Mitglieder) und Ereignisfälle (D11) zum Nachladen | 1.3/1.4b/1.4c |
| `check-data --data DIR [--spot DIR]` | D0–D12 ohne jede Rendite; Exit 2 bei Pflichtverstoß, 3 bei einem Halt | 1.4 |
| `evaluate --data DIR --out DIR …` | der eine Lauf (§10.4): beide Lesarten, beide Kapital-Szenarien, alle Stresstests | 1.5 |

Metadaten (Schritt 1.2, Netzwerk; Ziel ist das Datenverzeichnis des echten Laufs):

```bash
python3 -I scripts/research/relative-strength-v1/fetch_metadata.py listing --out data/market-snapshots/relative-strength-v1/listing
```

| Befehl von `fetch_metadata.py` | Zweck |
|---|---|
| `listing --out DIR` | S3-Verzeichnisliste aller USDT-Spot-Symbole, Monatsdateien 1d mit Größe und `.CHECKSUM`; Strukturbericht (Monatslücken, fehlende Prüfsummen) |
| `exchange-info --out DIR` | heutige USDT-Symbole mit Status, nur für D0c, nie als historisches Universum |
| `announcements --out DIR` | Ankündigungen der Kataloge 49 und 161 und eine automatische Vorauswahl; langsam, mit Zwischenspeicher. Nur Hilfe, nicht die D0b-Stichprobe |
| `review-sheet --out DIR [--per-year N] [--years …]` | lädt die ersten N Kandidaten je Jahr und schreibt ein Prüfblatt mit Textauszug für die Durchsicht von Hand |
| `snapshots --out DIR` | archivierte Binance-`exchangeInfo` (Internet Archive), je Monat die erste brauchbare Aufnahme, auf USDT reduziert |
| `d0b-p7 --out DIR --decisions FILE` | D0b nach P7: Token-Delistings mit Nachweis aus archivierten Symbollisten, dazu ein Zusatzbericht über alle endenden Paare 2020–2025 → `listing/announcements-d0b-p7.json`, das `check-listing` liest |
| `gap-check --plan FILE --out FILE` | Stundendateien des Archivs in jeder langen Lücke eines Uₜ-Mitglieds (P7 c) → `events/long-gap-check.json` |
| `d0b-sample --out DIR --decisions FILE` | D0b-Stichprobe: Entscheidungen von Hand aus [`d0b-review-decisions.json`](d0b-review-decisions.json), dazu ein automatisches „nein“ für Texte ohne Paar `X/USDT`; bricht ab, wenn vor dem dritten Treffer eines Jahres ein Kandidat ungeprüft ist |
| `download-plan --listing FILE` | Dateien, Volumen, Abrufe und Dauer von Schritt 1.3 |

Tests ohne Netz: `python3 -I scripts/research/relative-strength-v1/test_fetch_metadata.py`.

Echter Lauf, erst nach ausdrücklicher Freigabe:

```bash
python3 -I scripts/research/relative-strength-v1/relative_strength_v1.py evaluate --real --confirm RELATIVE_STRENGTH_FEASIBILITY_V1 --data data/market-snapshots/relative-strength-v1 --out data/replay-research/relative-strength-v1/evaluation
```

## Sicherungen des echten Laufs

- `--real` verlangt `--confirm RELATIVE_STRENGTH_FEASIBILITY_V1`.
- Es gilt nur die eingefrorene Konfiguration (`FROZEN`), inklusive 1 000
  Zufallsportfolios.
- Pfade: genau `data/market-snapshots/relative-strength-v1` und
  `data/replay-research/relative-strength-v1/evaluation`.
- Die Vorregistrierung wird geprüft: Der Dateiinhalt ohne Statusblock muss den
  Blob `965256641b15…` ergeben.
- `manifest.sha256` muss jede Datei abdecken und stimmen.
- Ein Datenverzeichnis mit der Datei `SYNTHETIC` wird abgelehnt. Umgekehrt
  läuft ohne `--real` nur synthetische Daten.
- **Einmaligkeit:** `RUN.lock` wird exklusiv angelegt, `results.json`
  geschrieben. Ein zweiter Lauf wird abgelehnt, erlaubt ist genau ein
  `--correction GRUND`.
  - Endet der Lauf vor der ersten Rendite (Halt, fehlende Eingabe), wird die
    Sperre wieder frei.
  - Stürzt er danach ab, bleibt sie stehen; dann ist eine Rückfrage beim
    Betreiber nötig.
- **Halt** (D0, D0b, D9, D11): Der Lauf stoppt ohne Ergebnis. Weiter nur mit
  `--accept-halt PRÜFUNG`, das im Ergebnis vermerkt wird. Nach D0/D0b wird ein
  positives Ergebnis zu `NICHT_BESTIMMBAR` (§10.2, Regel 4).
- **Mehrfachtest-Zähler:** synthetisch bleibt er bei 55 (`countsForN: false`),
  ebenso bei `NICHT_AUSWERTBAR`. Erst ein echter Lauf mit berechneten
  Renditen meldet 57. Die Schwelle ist in jedem Fall √(2·ln 57) = 2,84.

## Was verbindlich ist und was nicht

- **Ergebnisklasse** aus B1–B6 je Variante, in Lesart A und B, dann die
  Bestimmbarkeitsregel (§10.2). B1–B6 stehen wörtlich wie in der
  Vorregistrierung.
- **Nur Bericht**, ohne Einfluss auf die Klasse:
  - Kapital-Szenario S2 (M21, M25);
  - Pflichtberichte M16 und M27;
  - Stresstests M28 und M29;
  - Zufallsportfolios (M24), Signalgüte (M23), Fairness-Ausweis (M26),
    Kapazität (M22).
- **S1 ist die Shadow-Buchführung:** Kasse zu 0 %. Zins fließt nur in die
  getrennten S2-Läufe.

## Auslegungen, die das Skript ausweist (`interpretations` im Ergebnis)

1. B3(c) vergleicht die Monats-Sharpe aus denselben Monatsrenditen wie die
   α-Tests; vom Betreiber am 2026-10-17 bestätigt. Die Tages-Sharpe ist nur
   Sensitivität (`cWithDailySharpe`).
2. Ein positives Ergebnis vor Phase 1B heißt wie beim Carry
   `AUSSTEHEND_PHASE_1B`.
3. D3 zählt nur Lücken von 1–6 Tagen als fehlend; lange Lücken sind keine
   Handelszeit und stehen in D4. Eine lange Lücke eines Uₜ-Mitglieds ohne
   belegte Pause braucht die Prüfung des Stundenarchivs (`gap-check`), sonst
   oder bei Verdacht auf Archivfehler hält D11 an.
4. Die Mindestorder von 10 USDT gilt für Käufe und reguläre Verkäufe.
   Erzwungene Ausstiege (E2–E7) und die Glattstellung am Ende entfallen nie.
5. S2-Zins: DTB3/365 je Tag an Nicht-`RISK_ON`-Tagen außer dem Ausstiegstag.
6. Lesart B rechnet bei einem ungeklärten Sprung nach oben den gemessenen
   Faktor (Schluss zu Vorschluss) heraus. Die Eröffnung des Sprungtags bleibt
   in alten Einheiten, wenn der Sprung im Tagesverlauf lag.
7. Ein Ankündigungsnachweis gehört zu einem Ereignis, wenn sein `day`
   höchstens drei Tage vom Datenende abweicht (bei Umstellungen ein Tag). Der
   früheste Ausstieg ist die Eröffnung des Tags nach der Veröffentlichung.

## Download (Schritt 1.3, erst nach Freigabe)

```bash
python3 -I scripts/research/relative-strength-v1/download_archive.py monthly --data data/market-snapshots/relative-strength-v1 --dry-run
```

| Befehl von `download_archive.py` | Zweck |
|---|---|
| `monthly --data DIR [--rate 4] --confirm DOWNLOAD_RELATIVE_STRENGTH_V1` | alle Monatsdateien der Liste im Fenster, je mit `.CHECKSUM`; behält nur Dateien mit passender SHA-256, setzt nach Abbruch fort |
| `daily --data DIR --plan FILE --confirm …` | Tagesdateien aus `plan` (E1, D12); fehlende Tagesdateien sind erlaubt und werden gelistet |
| `manifest --data DIR` | `manifest.sha256` über alle Dateien, zuletzt, nach Belegen und Lückenprüfung |

Reihenfolge: `monthly` → `plan` → `daily` → `plan` (Lücken) →
`fetch_metadata.py gap-check` → Belege D11 → `manifest`.

## Eingaben für Schritt 1.3

- Schritt 1.2 hat Verzeichnisliste, `exchangeInfo`, D0b-Stichprobe, Gebühr
  und Zeitstempel-Dokumentation erledigt (siehe Metadatenprüfung).
- **Offen vor 1.3:** Freigabe des Downloads.
- **Für 1.3 fehlen:**
  - Kopie von `fred/DTB3.csv` und der Benchmark-Datei aus dem Carry, je gegen
    deren Manifest geprüft;
  - `events/evidence.json` aus 1.4b.
- Der echte Lauf findet im Checkout statt, in dem die Daten liegen, also im
  Hauptcheckout des gemeinsamen Branches.

## Testabdeckung (synthetisch)

`test_relative_strength_v1.py`, 47 Tests (dazu `test_fetch_metadata.py` mit 12 und `test_download_archive.py` mit 7 Tests, alle ohne Netz):

- Universum Point-in-Time (U1–U4, X1–X5);
- kein Blick in die Zukunft bei Universum, Rang und Regime;
- Aufbau, Puffer 20, Gate-Ausstieg, +1 Tag;
- Kontrolle, BTC/ETH-Referenz;
- Kosten L1/L2/L3, Kostenstress ×2, Kursschritt-Ersatz, Mindestorder;
- S1 ohne Zins und S2 mit Transfertag;
- Buchhaltungsidentität, Investitionsquote, M27;
- Ereignisse E2–E7 in beiden Lesarten mit den Stresstests M18, M28, M29;
- Datenprüfungen D0–D3 und D12, Mikrosekunden, Kopfzeile, E1-Ergänzung;
- Sperre gegen Forward-Daten;
- `spanningAlphaTest`, Schwelle 2,84;
- Klassen und Bestimmbarkeit;
- Laufsperre, Korrekturlauf, Halt, Mehrfachtest-Zähler;
- Vorregistrierungs-Prüfung;
- ein Ende-zu-Ende-Lauf auf `synth`-Daten.
