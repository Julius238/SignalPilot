# Werkzeuge Relative Stärke V1 (`RELATIVE_STRENGTH_FEASIBILITY_V1`)

Setzt die eingefrorene
[Vorregistrierung](../../../docs/trading/research/2026-10-17-relative-strength-feasibility-preregistration.md)
um (Text `c188c38`, Blob `96525664…`, Statusblock `6520f42`). Abschnittsangaben
(§) beziehen sich auf sie.

**Stand 2026-10-17: Schritt 1.1.**

- Das Skript ist fertig und nur gegen synthetische Daten getestet.
- Es enthält keinen Netzwerkcode und hat nie echte Marktdaten gelesen.
- Verzeichnisliste (1.2), Download (1.3) und Auswertung (1.5) stehen aus.
  Download und Auswertung brauchen je eine eigene Freigabe.

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

1. B3(c) vergleicht die Monats-Sharpe. Die Tages-Sharpe steht als
   `cWithDailySharpe` daneben.
2. Ein positives Ergebnis vor Phase 1B heißt wie beim Carry
   `AUSSTEHEND_PHASE_1B`.
3. D3 zählt nur Lücken von 1–6 Tagen als fehlend; lange Lücken sind keine
   Handelszeit und stehen in D4.
4. Die Mindestorder von 10 USDT gilt für Käufe und reguläre Verkäufe.
   Erzwungene Ausstiege (E2–E7) und die Glattstellung am Ende entfallen nie.
5. S2-Zins: DTB3/365 je Tag an Nicht-`RISK_ON`-Tagen außer dem Ausstiegstag.
6. Lesart B rechnet bei einem ungeklärten Sprung nach oben den gemessenen
   Faktor (Schluss zu Vorschluss) heraus. Die Eröffnung des Sprungtags bleibt
   in alten Einheiten, wenn der Sprung im Tagesverlauf lag.
7. Ein Ankündigungsnachweis gehört zu einem Ereignis, wenn sein `day`
   höchstens drei Tage vom Datenende abweicht (bei Umstellungen ein Tag). Der
   früheste Ausstieg ist die Eröffnung des Tags nach der Veröffentlichung.

## Eingaben, die vor 1.2 und 1.3 noch fehlen

- **Abrufwerkzeug** für die Verzeichnisliste
  (`listing/spot-monthly-klines-1d.json`) und `listing/exchangeInfo.json`.
  Bewusst noch nicht geschrieben; es gehört zu Schritt 1.2.
- **Stichprobe D0b:** Für jedes Jahr 2020–2025 die ersten drei
  Binance-Ankündigungen zum Handelsende von USDT-Spot-Paaren, als
  `listing/announcements-d0b.json`. Das muss von Hand über die öffentlichen
  Ankündigungsseiten geschehen. Ob diese aus Deutschland abrufbar sind, ist
  ungeprüft.
- **Vor dem Download (§4.1, §7):** VIP0-Spotgebühr an der offiziellen Tabelle
  und Mikrosekunden-Zeitstempel an der Archiv-Dokumentation bestätigen.
- **Für 1.3:**
  - Download-Werkzeug für Monats- und Tagesdateien mit `.CHECKSUM` und
    `manifest.sha256`;
  - Kopie von `fred/DTB3.csv` und der Benchmark-Datei aus dem Carry, je gegen
    deren Manifest geprüft;
  - `events/evidence.json` aus 1.4b.
- Der echte Lauf findet im Checkout statt, in dem die Daten liegen, also im
  Hauptcheckout des gemeinsamen Branches.

## Testabdeckung (synthetisch)

`test_relative_strength_v1.py`, 45 Tests:

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
