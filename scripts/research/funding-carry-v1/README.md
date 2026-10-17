# Auswertungsskript Funding-Carry V1 (`FUNDING_CARRY_FEASIBILITY_V1`)

Setzt die eingefrorene
[Vorregistrierung](../../../docs/trading/research/2026-10-16-funding-carry-feasibility-preregistration.md)
um (Commit `248b739`, Blob `9b00cc92…`). Jede Konstante im Skript ist ein Wert
aus diesem Dokument; Abschnittsangaben (§) im Code verweisen darauf.

**Stand: Schritt 1.1.** Das Skript ist nur gegen synthetische Daten getestet.
Es wurden keine Funding-, Perp-, Mark- oder Indexdaten geladen oder angesehen.
Der Download (Schritt 1.2) braucht eine eigene, ausdrückliche Freigabe.

- Nur Python-Standardbibliothek, Aufruf immer mit `python3 -I`.
- **Kein Netzwerkcode.** Das Skript liest nur Dateien und schreibt nie ins
  Datenverzeichnis.
- Kein Import aus `apps/` oder `packages/`, kein Bezug zu Produktcode.

## Befehle

```bash
python3 -I scripts/research/funding-carry-v1/test_funding_carry_v1.py
```

```bash
python3 -I scripts/research/funding-carry-v1/funding_carry_v1.py synth --out <scratch>/synth
```

```bash
python3 -I scripts/research/funding-carry-v1/funding_carry_v1.py check-data --data <daten> --spot <spot> --out <bericht.json>
```

```bash
python3 -I scripts/research/funding-carry-v1/funding_carry_v1.py evaluate --data <daten> --spot <spot> --benchmarks <benchmarks.csv> --out <ergebnis> --venue-status OFFEN
```

- `synth` erzeugt deterministische Zufallsdaten im Archivformat, markiert mit
  der Datei `SYNTHETIC`. Jeder Bericht darauf trägt den Hinweis
  „SYNTHETISCHE DATEN“.
- `check-data` führt D1–D8 aus (§2.2). Der Bericht enthält nur Datenqualität,
  nie Renditen. Rückgabewert 2 heißt `NICHT_AUSWERTBAR`.
- `evaluate` prüft zuerst die Daten und rechnet dann **einmal** beide
  Varianten (§8.4).
  - Ein zweiter Lauf in dasselbe Verzeichnis wird verweigert.
  - Genau ein korrigierter Lauf ist mit `--correction "<Grund>"` erlaubt.
  - `--venue-status` ist das Ergebnis der Phase 1B. Solange sie offen ist
    (`OFFEN`), meldet ein Lauf mit erfüllten Kriterien
    `AUSSTEHEND_PHASE_1B` statt einer Ergebnisklasse aus §8.2.
- Die Tests brauchen etwa 25 s. Die CI führt sie nicht aus; sie laufen lokal.

## Erwartete Eingaben

| Datei | Herkunft |
|---|---|
| `<daten>/binance/futures/um/monthly/fundingRate/<SYM>/<SYM>-fundingRate-YYYY-MM.zip` + `.CHECKSUM` | Schritt 1.2, Pfade wie auf `data.binance.vision` |
| `<daten>/binance/futures/um/monthly/{klines,markPriceKlines,indexPriceKlines}/<SYM>/1h/<SYM>-1h-YYYY-MM.zip` + `.CHECKSUM` | Schritt 1.2 |
| `<daten>/binance/rest/fundingRate-<SYM>-{2020-01,2026-09}.json` | Schritt 1.2, Antwort von `GET /fapi/v1/fundingRate` (D6) |
| `<daten>/fred/DTB3.csv` | Schritt 1.2 (FRED) |
| `<spot>/<SYM>-1h.csv.gz`, `<SYM>-1d.csv.gz` | vorhandener Snapshot `data/market-snapshots/real/` |
| `benchmarks.csv`: `month,champion,challenger[,champion_binding,challenger_binding]` | Schritt 1.4: Monatsrenditen 2020-01 – 2026-09 der Plätze aus Vergleich A (`portfolio-replay-v1/1.0.0`); optional die mittlere Kapitalbindung je Monat |

Für Schritt 1.4 gibt es noch keinen Exportbefehl. Vergleich A läuft heute nur
innerhalb der Evolution (`apps/evolution-worker/src/cycle/portfolioAssessment.ts`).
Der Export ist ein kleines, rein lesendes Skript auf `runPortfolioReplay`. Es
wird in Schritt 1.4 gebaut und braucht keine neuen Daten.

**Vor dem Download zu prüfen (nur Verzeichnisliste, ohne Dateiinhalte):** In
welchem Monat beginnen Mark- und Indexpreis-Kerzen je Symbol? Beginnen sie nach
dem Start des jeweiligen Teils (2020-01-01, bzw. 7 Tage nach der ersten
Funding-Abrechnung), scheitert D4. Die Studie wäre dann nach §8.2
`NICHT_AUSWERTBAR`. Das ist dem Betreiber vor dem Download zu melden.

## Präzisierungen der Umsetzung

Hier hat die Vorregistrierung keinen Wert festgelegt. Die Entscheidungen
wurden vor jedem Datenabruf getroffen. Keine davon ändert einen eingefrorenen
Wert.

- **Ausführungskosten** werden als Anteil des gehandelten Notionals zum
  Eröffnungskurs gebucht, ohne den Kurs zu verschieben. Je Seite gilt
  Gebühr + halber Spread + Slippage: Spot 14 bp, Perp-Taker 9 bp.
- **Aufbau:** Das Eigenkapital zum Aufbau bewertet das Perp-Bein mit dem
  Mark-Eröffnungskurs. Danach liegt die gesamte Spot-Kasse im Futures-Konto,
  Überträge sind kostenlos und sofort (§3.1).
- **Bezugskurs** für das Rebalancing ist der Mark-Eröffnungskurs beim letzten
  Aufbau.
- **Funding-Betrag:** Rate × Menge × Mark-Eröffnungskurs des Slots. Fehlt die
  Mark-Kerze, gilt der letzte Mark-Schluss.
- **Datenlücken:**
  - Eine anstehende Ausführung wartet bis zur ersten Stunde, in der Spot-,
    Perp- und Mark-Kerze vorliegen.
  - Bewertet wird mit dem letzten Kurs.
  - Ohne Mark-Kerze entfällt die Liquidationsprüfung dieser Stunde.
- **Funding-Duplikate:** Gleiche Duplikate werden verworfen. Widersprüchliche
  Abrechnungen im selben Slot werden entfernt, also mit 0 gebucht, und zählen
  als fehlend.
- **Kerzen** mit Tief > Eröffnung/Schluss oder Hoch < Eröffnung/Schluss zählen
  als fehlende Stunde (D4).
- **Liquidation:** Bis zur nächsten Entscheidung gibt es kein Rebalancing.
  Der Wiederaufbau aus einem verbliebenen Spot-Bein zählt als `rehedge`.
- **Legging-Stress L1:**
  - Zusatzverlust = bewegte Menge × |Spot-Eröffnung der Folgestunde −
    Spot-Eröffnung|. Fehlt die Folgestunde, gilt der Spot-Schluss.
  - Die Glattstellung am Fensterende ist eine Bewertung, kein Handel. L1
    erfasst sie nicht, die Kosten werden aber gebucht.
- **Ende:** Zum Schluss der letzten Stunde wird zum Spot- und
  Perp-Schlusskurs glattgestellt. Der letzte Tageswert ist dieser
  Liquidationswert.
- **Renditen:**
  - Die CAGR rechnet mit Kalendertagen (2 465 im Fenster, 1 004 seit 2024).
  - Monatsrenditen folgen `monthlyReturns` aus `packages/evolution/src/paired.ts`.
  - Die Sharpe-Werte sind ohne risikolosen Zins gerechnet.
- **Zinshürde:** Mittel aller `DTB3`-Beobachtungen im Zeitraum, in Prozent
  p. a. Fehlende Werte (`.`) werden übersprungen.
- **α-Test:** Er entspricht `spanningAlphaTest` und `studentT975`. Die Tests
  vergleichen ihn gegen Werte, die mit der TypeScript-Implementierung
  berechnet wurden.
- **Regime je Tag (M21, nur Bericht):** Nachbildung von
  `crypto-native-regime-v1/1.0.0` auf den Tageskerzen vor dem Tag, mit
  JavaScript-Rundung auf zwei Nachkommastellen.
- **Auswahl bei zwei bestandenen Varianten (§8.3):** „mindestens 1,0 pp“ wird
  mit einer Toleranz von 10⁻¹² geprüft, damit genau 1,0 pp nicht an der
  Gleitkommarundung scheitert.
- **Kapitalbindung des Carry:** Anteil der Stunden mit vollständig
  abgesichertem Paar. Abgesichert ist das ganze Teilkapital gebunden (§5).
