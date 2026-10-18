# Datenqualitätsbericht der Machbarkeitsstudie Relative Stärke (Schritte 1.4 und 1.4b, 2026-10-18)

> **Ergebnis: Alle Pflichtprüfungen D0–D12 sind bestanden, kein Halt.**
>
> - Die Datenbasis trägt die einmalige Auswertung (Schritt 1.5) unverändert
>   nach der Vorregistrierung V1 mit der freigegebenen Präzisierung P7.
> - Die Auswertung braucht eine eigene Freigabe.
> - Grundlage: [Vorregistrierung](2026-10-17-relative-strength-feasibility-preregistration.md)
>   (Text `c188c38`, Blob `96525664…`, unverändert), [P7](2026-10-17-relative-strength-d0b-precision-p7.md)
>   (aktiv), [Metadatenprüfung 1.2](2026-10-17-relative-strength-metadata-check.md).
> - **Nicht berechnet:** keine Strategierendite, keine Sharpe-, α- oder
>   Performancewerte, keine Forschungsvariante. Geladen wurden nur
>   Ankündigungstexte und Dateilisten (Metadaten), keine weiteren Kursdateien.
>   Risk Engine, Strategien, Gates und VPS sind unverändert.

## 1. Pflichtprüfungen

Ausgeführt mit `relative_strength_v1.py check-data`, im Hauptcheckout auf
`data/market-snapshots/relative-strength-v1` (Bericht
`checks/check-data-2.json`), Exit 0.

| Prüfung | Schwelle (V1) | Ergebnis | Urteil |
|---|---|---|---|
| D0 bekannte Fälle (ERD, LUNA, FTT, XMR, MATIC) | alle im Archiv | alle 5 | ✔ |
| D0b Wiederfindung angekündigter Delistings | ≥ 90 % je Jahr | P7: 2020–2025 je 3 Ankündigungen, 37 von 37 Paaren; V1-Lesart ebenso bestanden (Abschnitt 4) | ✔ |
| D0c Abgleich mit heutiger Symbolliste | Bericht | 1 von 254 nicht mehr gehandelten Paaren fehlt (`USDSOLDUSDT`) | – |
| D1 Vollständigkeit und Prüfsummen | jede Datei der Liste mit passender `.CHECKSUM` | 27 818 von 27 818 Monatsdateien, 0 fehlend, 0 Abweichung; zusätzlich alle neu gegen ihre `.CHECKSUM` gerechnet, 0 Abweichung | ✔ |
| D2 Format, Zeitstempel (ms und ab 2025 µs), OHLC | Fehleranteil klein | 4 von 832 496 Zeilen fehlerhaft: 3 byte-gleiche Doppelzeilen (AXS 2026-02, UMA 2026-07, USDP 2026-07), 1 OHLC-Verletzung (AUDUSDT 2020-11-13, Fiat, X1). Die Zeilen werden verworfen, nichts wird ergänzt | ✔ |
| D3 Lücken nach E1 | ≤ 0,5 % fehlende Symbol-Tage; BTC/ETH lückenlos; kein marktweiter Ausfall | 22 von 819 518 Symbol-Tagen (0,003 %); BTC/ETH lückenlos; kein marktweiter Ausfall | ✔ |
| D4 Ereignisfälle | Bericht | E2 7, E3 9, E4 33, E5 58, E6W 30, E7 167 (alle Symbole; E7 außerhalb von Uₜ ohne Wirkung) | – |
| D5 Ausschlüsse | Bericht | X4 35, X1 23, X5 3, X3 2, X2 1 | – |
| D6 Abgleich mit dem BTC/ETH-Bestand | exakt | 4 930 Kerzen, 0 Abweichung | ✔ |
| D7 Regime-Nachbildung | exakt 829/633/275/728 | 829/633/275/728 | ✔ |
| D8 Kostenstufen-Plausibilität | Bericht | keine Stufe auffällig | – |
| D9 Universum, nicht nur Gewinner | Halt, falls kein Mitglied endet | 352 Mitglieder, davon 88 mit endgültigem Reihenende (25 % der Symbole, 11,8 % der Symbol-Tage); an 5,6 % der Tage weniger als 20 Mitglieder | ✔ |
| D10 Ergänzungen aus dem Tagesarchiv | Bericht | 20 Tage ergänzt | – |
| D11 Ereignisnachweise | ≥ 80 % der endgültigen Reihenenden belegt | 87 von 87 (100 %); 3 lange Lücken geprüft, alle ohne Befund | ✔ |
| D12 Sprungtage, Monats- gegen Tagesdatei | Datenfehler werden belegt | 5 Sprungtage von Uₜ-Mitgliedern geprüft, 0 Datenfehler | ✔ |

`verify --data` bestätigt:

- die eingefrorene Vorregistrierung (Blob `965256641b15…`);
- den Konfigurations-Hash `800da68d…`;
- das Manifest über alle 56 544 Dateien.

## 2. Fehlende Tagesdateien

**Zählung:**

- `plan` verlangte 3 515 Tagesdateien für fehlende Tage (E1) und 5 für
  Sprungtage (D12), zusammen 3 520 Abrufe.
- Davon waren 25 vorhanden (20 E1, 5 D12) und 3 495 nicht im Archiv
  (HTTP 404), alle aus E1.
- Nach der Ergänzung bleiben genau diese 3 495 Tage ohne Kerze. Nichts davon
  wurde ergänzt oder geschätzt.

**Einordnung:**

- Die 3 495 Tage bilden 21 zusammenhängende Lücken (`checks/missing-daily-classification.json`).
- Keine Lücke liegt vor der Notierung eines Coins. E1 betrachtet nur Tage
  zwischen erster und letzter Kerze; Tage nach einem Delisting stehen im
  Archiv gar nicht erst an.
- Für jede Lücke ist geprüft, ob das Stundenarchiv in der Lücke Dateien hat:
  keine Lücke hat welche. Die Monate um jede Lücke sind dagegen im
  Stundenarchiv belegt (57–117 Dateien).
- Damit sind alle Lücken mit echten Handelspausen vereinbar. Keine sieht
  nach einem Archivfehler aus.

| Art | Lücken | Tage | Fälle |
|---|---|---|---|
| Neu vergebenes Symbol | 2 | 2 131 | USDS (alter Stablecoin bis 2020-06, anderer Token ab 2026-04, X1); LUNA (altes LUNA bis 2022-05-13, Terra 2.0 ab 2022-05-31) |
| Stablecoin-Paare ausgesetzt (BUSD-Autokonvertierung) | 3 | 495 | TUSD, USDC, USDP 2022-09-27 bis 2023-03-10 (X1) |
| Paar entfernt und später wieder aufgenommen | 3 | 490 | FTT (2022-11-16 bis 2023-09-21), CVC (2022-12-10 bis 2023-05-11), KEY (2023-02-11 bis 2023-03-09); Entfernung je mit Ankündigung |
| Vorübergehender Handelsstopp | 4 | 342 | ETHBULL, ETHBEAR (2020-01, Stopp und Wiederaufnahme angekündigt); BCHUP, BCHDOWN (2020-11 bis 2021-04, Hebel-Token, X4, nie im Universum; **Grund nicht belegt**) |
| Tausch oder Redenominierung mit Wiedereröffnung | 8 | 35 | VIDT 8, STRAX 7, BNX 5, COCOS, BTCST, DREP, SUN, QUICK je 3 Tage; alle angekündigt |
| Kurze Stablecoin-Pause | 1 | 2 | AEUR (X1) |

- **Für die Bewertung zählt:**
  - Kurze Lücken (1–6 Tage, 22 Symbol-Tage) behandelt E2 als Pause.
  - Lange Lücken sind E3 oder E7. Bei FTT, CVC, KEY und STRAX ist der
    Ausstieg durch die Ankündigung belegt; diese Fälle stehen dadurch als E5
    bzw. E6W statt E3.
  - Nichts wird stillschweigend als Pause gewertet: Die drei langen Lücken
    von Uₜ-Mitgliedern ohne Pausenbeleg (CVC, FTT, STRAX) hat `gap-check`
    geprüft.

## 3. Ereignisnachweise D11

**Quelle und Vorgehen:**

- Quelle sind öffentliche, datierte Binance-Ankündigungen.
- Katalog 157 („Maintenance Updates“) kam hinzu, weil Binance dort ab 2022
  die Token-Tausche und Umbenennungen ablegt.
- Je Fall wurde automatisch vorgesucht: Titel mit dem Token rund um das
  Datenende, dazu die Texte der Paar-Entfernungen.
- Entschieden ist jeder Fall von Hand am Text. Die Entscheidungen liegen
  versioniert in
  [`d11-evidence.json`](../../../scripts/research/relative-strength-v1/d11-evidence.json),
  die Kopie im Datenverzeichnis ist `events/evidence.json`.

| Fälle (94) | belegt | Art des Belegs |
|---|---|---|
| 85 Reihenenden (E7 vor der Prüfung) | 84 | 55 Delistings (davon 4 Paar-Entfernungen ohne Token-Delisting: ANC, BTCST, HNT, SRM), 29 Migrationen mit Nachfolger und Verhältnis (z. B. MATIC→POL 1:1, FTM→S 1:1, MKR→SKY 1:24 000, AGIX/OCEAN→FET 0,433350/0,433226, GAL→G 1:60) |
| 4 lange Lücken (E3) | 4 | FTT, CVC, KEY: Paar-Entfernung; STRAX: Tausch 1:10 mit Wiedereröffnung unter demselben Symbol |
| 5 Kurssprünge (E4) | 3 | Redenominierungen COCOS (1 000:1), SUN (1:1 000), BNX (1:100), je mit Wiedereröffnungstag |

**Ungeklärt (3, ausdrücklich markiert):**

- **LUNA 2022-05-11 und 2022-05-12 (E4):** Kurssturz beim
  Terra-Zusammenbruch, keine Umstellung angekündigt. Nach §4.3 eine echte
  Marktbewegung; der Sturz bleibt in beiden Lesarten stehen.
- **LUNA 2022-05-13 (E7):**
  - Das alte LUNA/USDT endet an diesem Tag, aber keine gefundene
    Binance-Ankündigung nennt dieses Ende. Am 2022-05-13 wurde nur LUNA/BUSD
    ausgesetzt und wieder geöffnet.
  - Die Neuvergabe des Symbols ist belegt (2022-05-28: altes LUNA heißt LUNC,
    Terra 2.0 ab 2022-05-31 unter LUNA), aber erst nach dem Datenende.
  - Der Fall bleibt E7 (`LONG_GAP_REOPEN_JUMP`): Lesart A friert die Position
    zum letzten Schluss ein, Lesart B setzt sie auf 0.
  - Nach §4.3 zählt der Fall nicht zu den endgültigen Reihenenden. Er geht
    also nicht in die 87 ein.

**Point-in-Time:**

- **Veröffentlichung vor dem Ende:** Jede verwendete Ankündigung ist vor dem
  angekündigten Handelsende veröffentlicht.
- **Ausführungsfenster:** Jede liegt mindestens einen Tag vor der letzten
  Kerze; die kürzeste ist FTT mit Veröffentlichung 2022-11-14 04:55 UTC und
  letzter Kerze 2022-11-15. Damit hat jedes belegte Ende ein
  Ausführungsfenster: Ausstieg zur ersten Eröffnung nach der Veröffentlichung
  (E5/E6W). Kein Fall braucht E6C oder `DELISTING_NO_WINDOW`.
- **Abgleich mit der letzten Kerze:**
  - 87 Belege liegen genau auf der letzten Kerze.
  - KLAY endet 2 Tage nach dem angekündigten Delisting (2024-10-28). Die
    Kerzen 2024-10-29/30 haben 0 Trades und 0 Volumen, sind also
    Platzhalter. Das hat keine Wirkung, weil der Ausstieg zur Eröffnung des
    2024-10-17 erfolgt.
  - Ansonsten gibt es im ganzen Archiv nur zwei weitere Kerzen ohne Handel
    (BCHUP, BCHDOWN am Reihenende).
- **Symbolidentität:**
  - Jede Ankündigung nennt den Token mit Namen. Bei Neuvergaben (USDS, LUNA,
    SKY) ist der alte Token vom neuen getrennt; das Studienskript führt beide
    als getrennte Instrumente.
  - In den 22 archivierten Binance-Symbollisten (2019-10 bis 2025-12) hat
    jedes der 6 043 Paare im Status `TRADING` eine Archivdatei für denselben
    Monat.

## 4. D0b nach der Korrektur der Quellen

- Katalog 157 enthält Umbenennungsmeldungen, die das endende USDT-Paar
  ausdrücklich nennen. Für 2025 sind das Litentry (LIT, 2025-01-22) und
  BinaryX (BNX, 2025-02-26).
- Damit hat 2025 auch nach der V1-Lesart drei Ankündigungen: LIT, AMB, BNX.
  Für 2022–2024 bringt Katalog 157 vor dem dritten Treffer nichts Neues; er
  beginnt 2022.
- **D0b ist jetzt in beiden Lesarten durchführbar und bestanden.** P7 bleibt
  aktiv und ändert das Urteil nicht. Es unterscheidet sich von V1 nur in der
  Stichprobe:

  | Jahr | Stichprobe V1 | Stichprobe P7 |
  |---|---|---|
  | 2020 | FTX-Hebel-Token, BKRW, DAI | FTX-Hebel-Token, STORM, USDS |
  | 2022 | BTT, ANY, SUSD | Hebel-Token 2022-01-06, BTT, ANY |

- Alle Paare beider Stichproben sind im Archiv.
- Meine Aussage in 1.2 und im P7-Entwurf, V1 sei wegen 2025 nicht
  durchführbar, beruhte auf den fehlenden Katalogen 48 und 157. Sie ist
  hiermit korrigiert.

## 5. Manifest

| Teil | Inhalt |
|---|---|
| `manifest.sha256` | SHA-256 jeder Datei unter `data/market-snapshots/relative-strength-v1/`, 56 544 Einträge, selbst `297ab134bd93e1382482725186bab1e12b2204cdf64e4dd65f61482de568241b` |
| `data-manifest.json` | Quellen mit Zeiträumen und Abrufzeiten, Dateizahlen, Ergänzungen (E1, D12, Belege), Prüfergebnisse D0–D12 und offene Qualitätsfragen |
| Monatsarchiv | `binance/spot/monthly/klines/<SYM>/1d/`, 27 818 Zip und `.CHECKSUM`, 2019-07 bis 2026-09, 753 Paare (delistete eingeschlossen), geladen 2026-10-17 21:32 bis 23:51 UTC |
| Tagesarchiv | `binance/spot/daily/klines/<SYM>/1d/`, 25 Zip und `.CHECKSUM` (20 E1, 5 D12) |
| Metadaten | `listing/` (Verzeichnisliste, heutige `exchangeInfo`, 22 archivierte `exchangeInfo`, Ankündigungstexte der Kataloge 48/49/157/161, D0b-Stichproben V1 und P7) |
| Ereignisse | `events/evidence.json` (91 Belege), `events/long-gap-check.json` |
| Zins und Benchmarks | `fred/DTB3.csv` (= Manifest carry-v2), `benchmarks/` (Laufhashes `39095a44…`, `2a8b05fb…`, siehe `benchmarks/SOURCE.json`) |
| Prüfberichte | `checks/check-data-2.json` (maßgeblich), `checks/all-gaps-hourly-check.json`, `checks/missing-daily-classification.json`, `plan/` |

- **BTC/ETH-Bestand:** Der zusätzlich gelesene Bestand
  (`data/market-snapshots/real`, D6 und D7) liegt außerhalb dieses
  Verzeichnisses und ist unverändert.
- **Gültigkeit:** Jede neue Datei im Datenverzeichnis macht das Manifest
  ungültig; `evaluate --real` lehnt den Lauf dann ab. Die Auswertung schreibt
  nur nach `data/replay-research/relative-strength-v1/evaluation`.

## 6. Survivorship- und Lookahead-Risiko

- **Survivorship: gering.**
  - Das Archiv enthält delistete Paare aller Jahre. Alle 37 Paare der
    D0b-Stichprobe sind darin, ebenso alle 193 Paare, die laut den
    archivierten Binance-Listen 2020–2025 enden.
  - Jedes der 6 043 Paar-Monate mit Status `TRADING` hat eine Datei.
  - Von 254 heute nicht mehr gehandelten USDT-Paaren fehlt nur eines.
  - 88 der 352 Universumsmitglieder enden im Fenster, also nicht nur heutige
    Gewinner.
  - Restrisiko: Paare, die zwischen zwei Aufnahmen kamen und gingen, und von
    Binance gelöschte Ankündigungen.
- **Lookahead: gering.**
  - Universum, Rang und Regime nutzen nur Kerzen bis zum Vortag; das ist
    synthetisch getestet.
  - Ereignisse wirken frühestens zur Eröffnung nach ihrer Veröffentlichung.
    Alle Belege sind vorher veröffentlicht, die Veröffentlichungszeiten
    stammen aus der Binance-Schnittstelle.
  - Dass ein Paar später endet, bestimmt nur, welche Fälle nachgeschlagen
    werden, nie einen Preis.
  - Die heutige `exchangeInfo` wirkt nur in D0c.
  - Restrisiko: Eine Ankündigung könnte früher anderswo erschienen sein (etwa
    als Tweet). Das würde Ausstiege eher verspäten, also konservativ wirken.

## 7. Unsicherheiten und ihre Wirkung

| Unsicherheit | Wirkung auf die Auswertung |
|---|---|
| LUNA-Ende 2022-05-13 ungeklärt | Lesart A und B unterscheiden sich, falls eine Variante oder die Kontrolle LUNA am 2022-05-13 hält. Darauf ist die Bestimmbarkeitsregel ausgelegt (`NICHT_BESTIMMBAR`, falls das Urteil daran hängt) |
| 3 495 Tage ohne Kerze | alle Ereignissen zugeordnet; wirken als E2/E3-Pausen oder Instrumentwechsel wie in §4.3; D3-Anteil 0,003 % |
| 4 fehlerhafte Zeilen | 3 identische Doppelzeilen ohne Wirkung; AUD (X1) nie im Universum |
| Zwei Kerzen ohne Handel (KLAY) | ohne Wirkung, Ausstieg vorher |
| Katalog-Vollständigkeit | D0b und D11 sind voll erfüllt; eine fehlende Ankündigung würde einen Ausstieg verspäten oder einen Fall zu E7 machen, beides konservativ |
| Gebühr nur im heutigen Stand geprüft | Kostenstufen L1–L3 unverändert; Rabatte bleiben unberücksichtigt, eher zu teuer |

## 8. Urteil

- Alle Pflichtprüfungen sind bestanden: D1–D3, D6, D7 blockierend sowie D0,
  D0b, D9, D11 als Halte-Prüfungen.
- Die Datenbasis ist vollständig, geprüft und durch ein Manifest
  festgeschrieben.
- **Die einmalige Auswertung kann unverändert nach der Vorregistrierung V1
  mit P7 laufen**, ohne `--accept-halt`. Sie braucht die gesonderte Freigabe
  des Betreibers. Aufruf (README):

  ```
  relative_strength_v1.py evaluate --real --confirm RELATIVE_STRENGTH_FEASIBILITY_V1 --data data/market-snapshots/relative-strength-v1 --out data/replay-research/relative-strength-v1/evaluation
  ```

## 9. Technische Korrekturen dieses Schritts

- `fetch_metadata.py`: Katalog 157 gehört zu den Ankündigungsquellen.
- `d0b-review-decisions.json`: Entscheidungen zu den Katalog-157-Meldungen.
- Neu: `d11-evidence.json` mit den 91 Belegen und 3 ungeklärten Fällen.
- Vorher in 1.3: `plan` ohne Lückenprüfungsdatei (`9acc9fc`), parallele
  Downloads (`a17af31`).

## 10. Unverändert

- Vorregistrierung V1, B1–B6, Schwellen, P7-Regeltext;
- Risk Engine, Strategien, Gates, Arena;
- VPS und offizieller Forward-Test;
- main.
