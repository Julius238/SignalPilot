# Werkzeuge Funding-Carry V2 (`FUNDING_CARRY_FEASIBILITY_V2`)

Setzt die eingefrorene
[Vorregistrierung V2](../../../docs/trading/research/2026-10-17-funding-carry-feasibility-preregistration-v2.md)
um (Commit `2f75ef0`, Blob `0bc948df…`). V2 übernimmt V1 wörtlich und ändert
nur die Quelle der Kerzen: Ein UTC-Tag, der in einer Monatsdatei vollständig
fehlt, kommt aus der Tagesdatei desselben Tages im Binance-Tagesarchiv.

V1 ist endgültig `NICHT_AUSWERTBAR`. Ihre Werkzeuge unter
[`../funding-carry-v1/`](../funding-carry-v1/README.md) bleiben unverändert.

**Stand: V2-Schritt 1.1.** Das Skript ist nur synthetisch getestet; ein
Probelauf auf den echten V1-Daten lief ohne Download. Download (1.2) und
Auswertung (1.5) brauchen je eine gesonderte Freigabe.

## Was gegenüber V1 neu ist

`funding_carry_v2.py` ist eine Kopie von `funding_carry_v1.py` mit genau
diesen Änderungen:

```bash
diff scripts/research/funding-carry-v1/funding_carry_v1.py scripts/research/funding-carry-v2/funding_carry_v2.py
```

- **Kennung und Referenz:** `FUNDING_CARRY_FEASIBILITY_V2`,
  `funding-carry-v2/2.0.0`, Vorregistrierung V2 (`2f75ef0`) mit Verweis auf
  V1 (`248b739`).
- **Fehlender Tag** (`missing_days`): ein UTC-Tag ab dem Start des Teils
  (2020-01-08) bis 2026-09-30 ohne eine einzige Kerze in der Monatsdatei. Die
  Regel gilt für Perp-, Mark- und Indexpreis-Kerzen, für beide Symbole.
  Teilweise gefüllte Tage zählen nicht als fehlend.
- **Ergänzung** (`fill_missing_days`, `merge_day`):
  - Nur die Tagesdatei des fehlenden Tages wird gelesen, und nur, wenn ihr
    SHA-256 gleich `.CHECKSUM` ist.
  - Übernommen werden nur Kerzen, die in diesem Tag eröffnen.
  - **Vorhandene Kerzen werden nie überschrieben**; das Monatsarchiv hat
    immer Vorrang.
  - Gleiche Duplikate werden verworfen. Eine Stunde mit widersprüchlichen
    Kerzen in der Tagesdatei wird nicht übernommen; sie fehlt dann, und D4
    zählt sie.
  - Zeitstempel in Milli- oder Mikrosekunden werden wie in V1 erkannt.
- **D1** gilt zusätzlich für jede benötigte Tagesdatei: Sie muss vorhanden
  sein und ihre Prüfsumme bestehen, sonst gilt `NICHT_AUSWERTBAR`. Der
  Daten-Fingerprint umfasst Monats- und Tagesdateien.
- **D4** bewertet die zusammengeführte Reihe mit den Grenzen aus V1.
- **D9 (nur Bericht):** Je Reihe werden ausgewiesen:
  - benötigte Tage;
  - ergänzte Stunden je Tag;
  - Kerzen außerhalb des Tages;
  - Duplikate, Widersprüche und Überschneidungen;
  - fehlende oder fehlerhafte Tagesdateien;
  - vorhandene, aber nicht benötigte Tagesdateien.
- **`plan-daily`:** listet die benötigten Tagesdateien und liest dafür nur
  die Zeitstempel der Monatsdateien.
- Alles andere ist bitgleich mit V1: Halteregeln, Kosten, Kennzahlen,
  Kriterien, Ergebnisklassen, Auswertungssperre.

## Downloader `download_v2.sh`

```bash
scripts/research/funding-carry-v2/download_v2.sh /Users/juliuseggert/Dev/SignalPilot/data/market-snapshots/carry-v1 /Users/juliuseggert/Dev/SignalPilot/data/market-snapshots/carry-v2 --dry-run
```

1. Prüft das V1-Manifest gegen den eingefrorenen SHA-256 (`c1d34946…`, V2
   §3). Danach kopiert er nur die Dateien, die das Manifest nennt, und prüft
   jede Kopie dagegen. Nichts wird neu geladen.
2. Bestimmt die benötigten Tagesdateien mit `plan-daily`.
3. Ohne `--dry-run` lädt er genau diese Dateien mit Prüfsumme, nacheinander
   mit Pause.
   - Eine vorhandene Datei wird nie überschrieben.
   - Bei einer Prüfsummenabweichung lädt er die gerade geladene Datei einmal
     neu (D1).
4. Schreibt `sources.json` und `manifest.sha256`; V1-Manifest und V1-Quellen
   bleiben als `manifest-v1.sha256` und `sources-v1.json` erhalten.

Er verweigert ein nicht leeres Ziel. Er läuft mit der Bash 3.2 von macOS.

## Prüfungen

```bash
python3 -I scripts/research/funding-carry-v2/test_funding_carry_v2.py
```

39 Tests, rund 90 s, nur synthetische Daten:

- die 26 V1-Tests unverändert gegen den V2-Code;
- 9 Tests der Lückenfüllung:
  - ganze und teilweise Tage;
  - kein Überschreiben;
  - Duplikate und Widersprüche;
  - Kerzen außerhalb des Tages;
  - Mikrosekunden;
  - fehlende Tagesdatei;
  - Prüfsummenfehler;
  - Plan;
  - Auswertung als V2;
- 4 Tests des Downloaders ohne Netz:
  - Kopie, Abgleich und Plan;
  - falscher Manifest-Hash;
  - veränderte V1-Datei;
  - nicht leeres Ziel.

**Probelauf auf den echten V1-Daten (2026-10-17, ohne Download):**

- `download_v2.sh … --dry-run` in ein Scratch-Verzeichnis: V1-Manifest gleich
  dem eingefrorenen Hash; 1 302 Dateien kopiert und bestätigt.
- Der Plan ergibt **29 Tagesdateien**, genau die Tage aus der
  [V1-Datenprüfung](../../../docs/trading/research/2026-10-17-funding-carry-data-check.md):
  - BTCUSDT Markpreis: 9;
  - BTCUSDT Indexpreis: 13;
  - ETHUSDT Markpreis: 3;
  - ETHUSDT Indexpreis: 4.
- Laut Verzeichnisliste sind alle 29 Archive und 29 Prüfsummen vorhanden: je
  920–1 197 B, zusammen 33 KB. Ob sie 24 Stunden enthalten, zeigen D4 und D9
  nach dem Download.
