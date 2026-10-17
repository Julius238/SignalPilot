# Vorregistrierung der Machbarkeitsstudie Funding-/Basis-Carry BTC/ETH, V2 (2026-10-17)

> **Endstatus 2026-10-17: `KOMPRIMIERT`.** Die einmalige Auswertung erfüllt
> B1 und B3–B6, scheitert aber an B2 (seit 2024 unter Geldmarkt plus
> Abschlag). Der Carry ist in dieser Form geschlossen (V1 §8.4):
> [Ergebnisbericht](2026-10-17-funding-carry-v2-results.md).
>
> **Status 2026-10-17: freigegeben und eingefroren (V2).**
>
> - Der Betreiber hat V2 freigegeben.
> - Eingefrorene Fassung: Commit `2f75ef0`, Blob
>   `0bc948df03807b0ba9884dd50934de027d1f9fa4` dieser Datei.
> - Schritt 1.1 ist erlaubt: Werkzeuge erweitern, nur synthetisch testen.
> - Download (Schritt 1.2) und Auswertung (Schritt 1.5) brauchen je eine
>   gesonderte Freigabe.
>
> Der Text unten bleibt als Festschreibung unverändert, nur dieser Statusblock
> ist neu.

> **Status: Entwurf zur Freigabe.** V2 wird geschrieben, nachdem V1 an der
> Datenprüfung gescheitert ist
> ([Bericht](2026-10-17-funding-carry-data-check.md): D4, ganze Tage fehlen im
> Monatsarchiv der BTCUSDT-Mark- und Indexpreise).
>
> - Bisher wurde **keine Rendite** berechnet, keine Funding-Statistik über die
>   Datenqualität hinaus erhoben und keine Auswertung gestartet.
> - Für V2 wurde nichts heruntergeladen.
> - Unverändert und unberührt: Code, Risk Engine, Strategien, Gates,
>   offizieller Forward-Test, VPS.
> - Keine Handelsempfehlung, keine Anlage-, Rechts- oder Steuerberatung.

## 0. Grundsatz: V1 gilt wörtlich, mit genau einer Änderung der Datenquelle

V2 übernimmt die eingefrorene
[Vorregistrierung V1](2026-10-16-funding-carry-feasibility-preregistration.md)
vollständig und wörtlich. Maßgeblich ist Commit `248b739`, Blob
`9b00cc9232efac8755496259cc9ff734d5620774`. Übernommen werden:

- Hypothese;
- Halteregeln und Varianten;
- Kosten, Kapital- und Collateral-Modell;
- Kennzahlen M1–M21;
- Kriterien B1–B6 mit allen Schwellen;
- Ergebnisklassen und Auswahlregel;
- Abschlag, Phase 1B;
- Grundsatzentscheidungen;
- die Freigaben F1–F6 vom 2026-10-17.

**Geändert wird nur eines:** Ein UTC-Tag, der im Monatsarchiv einer
Kerzenreihe vollständig fehlt, wird aus der Tagesdatei desselben Anbieters
ergänzt (Abschnitt 1). Die übrigen Abschnitte dieses Dokuments regeln nur, was
daraus zwingend folgt: Prüfung, Datenablage, Kennung, Zählung und offengelegte
Vorkenntnis. Wo V2 nichts sagt, gilt V1.

| | V1 | V2 |
|---|---|---|
| Studienkennung | `FUNDING_CARRY_FEASIBILITY_V1` | `FUNDING_CARRY_FEASIBILITY_V2` |
| Status | `NICHT_AUSWERTBAR` (D4), nie ausgewertet | Entwurf zur Freigabe |
| Kerzen (Perp, Mark, Index) | nur Monatsarchiv | Monatsarchiv, ganz fehlende Tage aus dem Tagesarchiv |
| alles Übrige | – | wie V1 |

**Kein kanonischer Hash**, aus demselben Grund wie in V1. Eingefroren wird
V2 durch den Commit, den der Betreiber freigibt. Der Ergebnisbericht nennt ihn
und den Blob-Hash dieser Datei. V1 und V2 werden nie vermischt; da V1 keine
Ergebnisse hat, gibt es nichts zu vermischen.

## 1. Die Änderung: Lückenfüllung aus dem Binance-Tagesarchiv

**Regel (ersetzt für die Kerzen die Quellenangabe in V1 §2.1):**

1. **Primärquelle** bleibt das Monatsarchiv
   `data/futures/um/monthly/{klines,markPriceKlines,indexPriceKlines}/<SYM>/1h/`.
2. **Fehlender Tag:** ein UTC-Tag *d* zwischen dem Start des Teils
   (2020-01-08, V1 §2.1) und dem 2026-09-30, für den die Monatsdatei seines
   Monats **keine einzige** Kerze mit Eröffnungszeit in *d* enthält. Die Regel
   gilt für alle drei Kerzenreihen und beide Symbole.
3. Für jeden fehlenden Tag wird **genau die Tagesdatei dieses Tages**
   ergänzt: `data/futures/um/daily/<Reihe>/<SYM>/1h/<SYM>-1h-YYYY-MM-DD.zip`
   mit `.CHECKSUM`.
   - Aus ihr zählen nur Kerzen mit Eröffnungszeit in *d*.
   - Liegt eine Stunde in beiden Quellen vor, gilt das Monatsarchiv.
4. **Nicht ergänzt** werden:
   - teilweise gefüllte Tage;
   - Funding-Raten (es gibt kein Tagesarchiv, und D2 fand in V1 keine Lücke);
   - Spot-Kerzen.
5. **Keine andere Quelle**, keine Interpolation, kein Ersatz eines Markpreises
   durch den Perp-Kurs.

**Erwarteter Umfang:** Nach der V1-Datenprüfung erfüllen 29 Tage die Regel
(BTCUSDT Mark 9, Index 13; ETHUSDT Mark 3, Index 4). Laut Verzeichnisliste
vom 2026-10-17 gibt es für alle eine Tagesdatei. Ihr Inhalt ist ungeprüft.
Maßgeblich ist die Regel, nicht diese Liste. Ergibt die Regel andere Tage,
werden diese ergänzt, und der Bericht nennt den Unterschied.

## 2. Folgen für die Datenprüfung (ergänzt V1 §2.2)

| Nr. | Änderung |
|---|---|
| D1 | gilt zusätzlich für jede benötigte Tagesdatei. Sie muss vorhanden sein, ihr SHA-256 gleich `.CHECKSUM`. Bei Abweichung wird einmal neu geladen; fehlt sie oder bleibt die Abweichung, gilt `NICHT_AUSWERTBAR` |
| D4 | bewertet unverändert, mit denselben Grenzen (≤ 0,5 % fehlende Stunden, keine Lücke > 24 h), die **zusammengeführte** Reihe |
| D5, D8 | unverändert; D5 läuft auf der zusammengeführten Reihe |
| neu D9 (nur Bericht) | Liste der ergänzten Tage je Reihe und Symbol mit der Zahl der Stunden aus der Tagesdatei; ob eine Tagesdatei Kerzen außerhalb ihres Tages enthielt; Stunden, die in beiden Quellen vorlagen |

**Blockierend** sind wie in V1 D1, D2, D4, D6 und D8. Scheitert eine davon,
endet V2 als `NICHT_AUSWERTBAR`, vor jeder Renditeberechnung. Eine weitere
Quelle, etwa REST-Kerzen, wäre eine V3 mit eigener Vorregistrierung.

## 3. Datenablage und Abruf (ergänzt V1 §2.1)

- **Neues, gitignoriertes Verzeichnis** `data/market-snapshots/carry-v2/`.
  - Die V1-Dateien (Monatsarchive, Prüfsummen, REST-Stichprobe, DTB3) werden
    unverändert hineinkopiert, nicht neu geladen.
  - Jede Kopie wird gegen `carry-v1/manifest.sha256` geprüft (SHA-256 des
    Manifests `c1d349467279355b525a003c74371aab60457fe63bab7a7e4ff06d2f12138908`).
  - Weicht eine Datei ab, wird abgebrochen.
- **Neu geladen** werden nur die Tagesdateien der fehlenden Tage mit ihren
  Prüfsummen. Erwartet sind rund 58 Dateien, Größenordnung unter 1 MB
  (geschätzt, nicht geprüft). Abruf nacheinander mit Pause, wie in V1.
- **Fehlende Tage bestimmen:** Dazu liest das Werkzeug aus den vorhandenen
  Monatsdateien nur die Zeitstempel, wie in der V1-Datenprüfung.
- `sources.json` und ein neues `manifest.sha256` beschreiben den V2-Bestand.
  Die Lizenz ist dieselbe wie in V1 (CC BY-NC-SA 4.0, nur nicht-kommerzielle
  Forschung, keine Weitergabe).
- Der Download braucht wie in V1 eine **eigene, ausdrückliche Freigabe**.
  Nichts wird auf den VPS übertragen.

## 4. Mehrfachtest-Zähler (ergänzt V1 §11)

V1 wurde nie ausgewertet. V2 prüft dieselben zwei Konfigurationen auf
denselben Funding-Daten und unterscheidet sich nur in der Vollständigkeit der
Kerzen. Die Varianten zählen deshalb **einmal**: N = 53 → 55, wenn V2
ausgewertet wird, nicht 57. Wird auch V2 nicht ausgewertet, bleibt N = 53.

## 5. Bereits gesehene Daten und Vorkenntnis (ergänzt V1 §11)

Zusätzlich zur Vorkenntnis aus V1 sind seit der V1-Datenprüfung bekannt:

| Bekannt | Inhalt |
|---|---|
| Datenqualität aller Reihen | Zählungen, fehlende Tage (Liste im Bericht), Lücken, keine fehlerhaften Kerzen |
| D2 | je 7 395 Abrechnungen, keine fehlend, Intervall durchgehend 8 h |
| D3 | keine Abrechnung mit \|Rate\| > 0,375 % |
| D5 | markierte Zeitpunkte: 2020-03-13, 2021-02-11, 2021-05-19, 2023-03-24 |
| D6 | REST gleich Archiv |
| D7 | 33,7 % (BTC) bzw. 33,8 % (ETH) der 8h-Abrechnungen genau 0,0100 % |

- **Nicht bekannt:** Renditen, Funding-Mittelwerte, -Summen und -Verteilungen
  sowie jede Kennzahl M1–M21 und jedes Kriterium B1–B6.
- **Keine Schwelle, kein Parameter und keine Regel ändert sich** gegenüber V1.
  Die einzige Änderung betrifft die Vollständigkeit der Kerzen und folgt aus
  einem Datenqualitätsbefund, nicht aus einem Ergebnis.
- D7 ist eine Eigenschaft der Funding-Verteilung. Sie wurde vor jeder
  Auswertung gesehen und beeinflusst keinen Wert dieser Vorregistrierung.

## 6. Untersuchungsplan V2 (ersetzt V1 §12 ab Schritt 1.1)

| Schritt | Inhalt | Freigabe |
|---|---|---|
| 0.1 | diesen Entwurf committen | – |
| 0.2 | Review; der freigegebene Commit friert V2 ein | **ja** |
| 1.1 | Skript erweitern und **vor** dem Abruf synthetisch testen: Studienkennung und Referenz V2, Lückenfüllung nach Abschnitt 1, D1 für Tagesdateien, Bericht D9, Werkzeug zum Kopieren und Abgleichen der V1-Dateien. Die V1-Logik für alles Übrige bleibt unverändert, die bestehenden Tests bleiben grün | mit 0.2 |
| 1.2 | V1-Dateien kopieren und abgleichen, Tagesdateien der fehlenden Tage laden | **ja, ausdrücklich** |
| 1.3 | Datenprüfung D1–D9 und Bericht; bei einer gescheiterten Pflichtprüfung halt und Meldung | – |
| 1.4 | Export von Champion und Challenger (vorbereitet, `2ad7d05`) | mit 1.5 |
| 1.5 | einmalige Auswertung beider Varianten | **ja, gesondert** (Auflage des Betreibers vom 2026-10-17) |
| 1.6 | Phase 1B Verfügbarkeit, wie V1 | **ja** (Download) |
| 1.7 | Ergebnisbericht mit Ergebnisklasse; N auf 55 | – |

Die Einmaligkeit nach V1 §8.4 gilt für V2 neu: ein Lauf, höchstens ein
korrigierter Lauf. Für V1 gab es keinen Lauf.

## 7. Was unverändert bleibt

- Alles aus V1 außer der Datenquelle der Kerzen, also unter anderem:
  - Fenster 2020-01-01 – 2026-09-30, Teilstart 2020-01-08;
  - Varianten A und B mit allen festen Werten aus V1 §3.4;
  - Kostenmodell, Collateral 1:1, Rebalancing ±20 %, Wartungsmarge 0,5 %;
  - Abschlag 1,5 pp, Zinshürde `DTB3`;
  - Kriterien B1–B6, Ergebnisklassen, Auswahlregel;
  - Phase 1B.
- Code der Produktpakete, Risk Engine, Strategien, Gates v1–v4, Arena,
  offizieller Forward-Test `OFFICIAL_V1`, VPS.
- `ENABLE_LIVE_TRADING=false`, `PAPER_TRADING_ONLY=true`; kein
  Exchange-Adapter, keine Order, kein Echtgeld.
