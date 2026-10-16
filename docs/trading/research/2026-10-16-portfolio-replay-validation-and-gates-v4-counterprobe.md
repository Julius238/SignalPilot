# Validierung der Portfolio-Simulation und Gegenprobe zu Gates v4 (2026-10-16)

Protokoll der Prüfungen **vor** dem Festschreiben von
[Gates v4](2026-10-16-evolution-gates-v4-preregistration.md).

- Kein neuer Kandidat, kein Forschungszyklus, kein API-Aufruf, keine
  Datenbank-Schreibung.
- Gerechnet wurden nur die Referenzstrategien (Champion
  `CRYPTO_TREND_CORE_LONG_V1`, Challenger `CRYPTO_REGIME_LONG_V1`) und bekannte
  Genome aus den Läufen vom 2026-10-15.
- Der Mehrfachtest-Zähler bleibt bei **N = 52**.

| | |
|---|---|
| Daten | echte Binance-Stundenkerzen BTCUSDT und ETHUSDT, Fingerprint `5c7459f3825b…`, Sperre ab 2026-10-15 |
| Zeitraum | Entdeckung + Validierung, 2018-04-01 – 2023-12-31; kein Holdout, kein Forward |
| Code | Stand `e2e24ec` plus Gates v4 (Arbeitsstand dieses Pakets) |
| Werkzeug | `apps/evolution-worker/src/validation/run.ts` (ein Teil je Prozess, JSON-Bericht) |

## 1. Datenbank-Tests des Trading-Workers

Die 17 Tests, die bisher ohne `DATABASE_URL` übersprungen wurden, liefen
gegen eine eigene Testdatenbank (`signalpilot_test`, Port 55432): **270 von
270 bestanden.** Die Entwicklungsdatenbank wurde nur lesend benutzt
(Exposure-Ledger, Genome der Läufe vom 2026-10-15).

## 2. Gleichwertigkeit: ein Portfolio, ein Symbol

Je Strategie und Symbol einmal im Einzel-Replay und einmal als einziges
Portfolio der Portfolio-Simulation (Startkapital 10 000 USDT, Stufe 2 aktiv):

| Strategie | Symbol | Trades | End-Equity (beide) | `outputHash` gleich | Stufe-2-Aufrufe | Ablehnungen |
|---|---|---:|---:|:---:|---:|---:|
| Champion | BTCUSDT | 73 | 10 472,2536 | ja | 85 | 0 |
| Champion | ETHUSDT | 78 | 9 921,7824 | ja | 102 | 0 |
| Challenger | BTCUSDT | 62 | 10 676,2043 | ja | 73 | 0 |
| Challenger | ETHUSDT | 59 | 10 624,6038 | ja | 74 | 0 |

- Der `outputHash` umfasst Trades, Ledger, Equity-Kurve und
  Entscheidungsprotokoll; alle vier stimmen bitgenau überein.
- Laufzeit: Einzel-Replay 220–263 s, Portfolio-Simulation 241–267 s.

## 3. Vergleich A auf echten Daten

Champion und Challenger auf je einem Platz à 20 000 USDT mit BTC und ETH,
dazu ein Reserveplatz à 20 000 USDT als Kasse; Gesamtkapital 60 000 USDT.

| Größe | Wert |
|---|---:|
| End-Equity der Gruppe | 61 986,16 USDT |
| Nettorendite | 3,31 % |
| max. Drawdown | 1,57 % |
| Ø / Spitze gleichzeitiges Risiko | 0,048 % / 0,34 % |
| Ø / Spitze Kapitalbindung | 0,75 % / 12,11 % |
| Stunden | 50 345 |
| Prüfungen der Gruppe (Stufe 2) | 321, keine Ablehnung, kein Gruppen-Kill-Switch |
| Laufzeit | 17,4 min |

| Portfolio | Trades (BTC/ETH) | Netto-PnL | Σ R | Gebühren | Spread | Slippage | Kill-Switch | Ledger-Verstöße |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Champion | 138 (68/70) | −543,57 | −10,55 | 630,53 | 63,66 | 190,99 | 24 | 0 |
| Challenger | 122 (63/59) | +2 529,73 | +48,37 | 147,59 | 14,92 | 44,77 | 13 | 0 |

### Konsistenzprüfungen (alle bestanden)

| Prüfung | Ergebnis |
|---|---|
| Ledger-Invarianten je Portfolio | 0 und 0 Verstöße |
| Gruppen-Equity = Σ Portfolios + Reserve, täglich | 2 102 Tage, größte Abweichung 7·10⁻¹² |
| End-Equity der Gruppe = Σ Portfolios + Reserve | Abweichung 0 |
| Netto-PnL = Brutto-PnL − Gebühren | 0 Abweichungen |
| Gebühren = 10 bp auf Ein- und Ausstiegs-Notional | größte relative Abweichung 0 |
| Preiswirkung aufgeteilt Spread 1 bp : Slippage 3 bp | 0 Abweichungen |
| Zuordnung der Trades zu ihrem Portfolio | eindeutig |
| Kapitalbindung innerhalb der Brutto-Grenze | Ø 0,75 %, Spitze 12,1 % |

### Gruppengrenzen

Höchste Auslastung der Grenzen in Stufe 2, gemessen bei jeder Prüfung:

| Regel | höchste Auslastung | Ablehnungen | Fehler |
|---|---:|---:|---:|
| R-010 Tagesverlust | 28,5 % | 0 | 0 |
| R-013 Brutto-Exposure | 30,1 % | 0 | 0 |
| R-014 Asset-Exposure | 33,0 % | 0 | 0 |
| R-015 Korrelation | 40,1 % | 0 | 0 |

- Ohne Stufe 2 liefert derselbe Lauf für beide Portfolios identische
  `outputHash`-Werte (`51f5600b933d…`, `a4667adb8f37…`). Der Gruppen-Hash
  unterscheidet sich nur, weil die gewählte Gruppenprüfung Teil der
  Konfiguration ist.
- Die Gruppenprüfung wird also bei jeder Freigabe korrekt ausgeführt,
  verändert hier aber kein Ergebnis. Das entspricht der Analyse im
  [Entwurf, Abschnitt 4.6](2026-10-15-evolution-gates-v4-draft.md): Bei
  gleichen Prozentgrenzen je Portfolio und Gruppe greifen die Gruppenregeln
  nur durch Kursdrift oder Kurslücken.
- Die Duplikatsperre von R-014 (209 bzw. 22 263 Ablehnungen in Stufe 1)
  wirkt nur innerhalb des eigenen Portfolios, wie vorregistriert.

### Befund T1: gemeinsames Konto je Strategie

- Im Einzel-Backtest erzielt der Champion je Symbol in getrennten Konten
  zusammen etwa +15,8 R (BTC +4,7 %, ETH −0,8 % auf je 10 000 USDT).
- In Vergleich A handelt er BTC und ETH in **einem** Portfolio. Dann zählt die
  Verlustserie (R-021) über beide Symbole: 24 Kill-Switch-Auslösungen, 63
  Ablehnungen wegen gesperrter Sitzung, Ergebnis **−10,6 R**.
- Der Challenger ist robuster (+48,4 R gegenüber etwa +52 R getrennt).
- Das ist eine Eigenschaft des vorregistrierten Modells „ein Platz, beide
  Symbole“, kein Rechenfehler. A und B nutzen es gleich, der Vergleich
  bleibt fair. Die Bestandskennzahlen in v4 weichen deshalb von den
  Standard-Backtests ab.

## 4. Gegenprobe: Kopien und bekannte Varianten

Vergleich B mit bekannten Strategien auf dem Reserveplatz.

- Die Strukturprüfung ist bewusst als „eigenständig“ gesetzt, damit allein
  der Portfolio-Weg entscheidet: Eine Probe soll am fehlenden Wert
  scheitern, nicht an der Familienerklärung.
- **Kopien:** Champion und Challenger noch einmal. Im Rahmen fester Plätze ist
  das die bestehende Strategie mit doppeltem Gewicht.
- **Ausstiegs- und Schwellenvarianten:** EVO-REG-0004 bis 0010 des
  Challengers mit ihren gespeicherten Genomen.
- Referenzläufe ohne Urteil: Am Status dieser Kandidaten ändert sich nichts.

N = 52; Schwelle für α und Zuwachs 2,81.

| Probe | Δ Netto (Pp.) | Δ Sharpe | α-t | Zuwachs-t | R² | Korr. Champion / Challenger | gescheitert an | Urteil |
|---|---:|---:|---:|---:|---:|---|---|---|
| Kopie Champion | −0,91 | −0,25 | nicht testbar | −0,60 | 1,00 | 1,00 / 0,36 | Netto, Sharpe, Drawdown, Risiko-Eff., Kapital-Eff., Phasen, Kostenstress, **α**, Zuwachs-t | abgelehnt |
| Kopie Challenger | +4,22 | +0,23 | nicht testbar | 2,22 | 1,00 | 0,36 / 1,00 | **α**, Zuwachs-t | abgelehnt |
| EVO-REG-0004 | +3,48 | +0,24 | 1,63 | 2,49 | 0,88 | 0,35 / 0,88 | Geometrie, **α**, Zuwachs-t | abgelehnt |
| EVO-REG-0005 | +4,10 | +0,28 | 1,13 | 2,16 | 0,90 | 0,37 / 0,94 | Geometrie, **α**, Zuwachs-t | abgelehnt |
| EVO-REG-0006 | +4,03 | +0,25 | 1,00 | 2,44 | 0,82 | 0,35 / 0,87 | Geometrie, **α**, Zuwachs-t | abgelehnt |
| EVO-REG-0007 | +5,36 | +0,33 | 0,80 | 2,15 | 0,95 | 0,36 / 0,96 | **α**, Zuwachs-t | abgelehnt |
| EVO-REG-0008 | +4,36 | +0,26 | 0,74 | 2,19 | 0,83 | 0,33 / 0,88 | Geometrie, **α**, Zuwachs-t | abgelehnt |
| EVO-REG-0009 | +3,68 | +0,27 | 1,31 | 2,23 | 0,92 | 0,37 / 0,95 | Geometrie, **α**, Zuwachs-t | abgelehnt |
| EVO-REG-0010 | +3,94 | +0,30 | 1,31 | 2,40 | 0,81 | 0,34 / 0,89 | **α**, Zuwachs-t | abgelehnt |

Alle Werte über Entdeckung + Validierung (69 Monate). Δ Netto ist die
Nettorendite des Gesamtkapitals von 60 000 USDT in B minus A.

**Ergebnis: Alle neun Proben werden abgelehnt.**

- **Kopien:** Für beide Kopien ist α „nicht testbar“. Die Kopie und ihr
  Original handeln auf gleich großen Plätzen dieselben Trades; die
  Bestandsportfolios erklären die Monatsrenditen vollständig (R² = 1,
  Rest-Quadratsumme 0). Eine Kopie kann also nie ein eigenes α zeigen.
- **Die Kopie des Challengers ist der entscheidende Fall.** Sie besteht
  **jede** reine Wertprüfung:
  - Netto +4,2 Pp., Sharpe 0,50 → 0,73;
  - Rendite je Drawdown 2,57 → 4,23;
  - Risiko- und Kapitaleffizienz, alle Phasen positiv, Kostenstress;
  - die Trade-Geometrie, weil sie die Qualität des Challengers hält.

  Eine doppelte Gewichtung einer profitablen Strategie hebt Rendite und
  Sharpe des Gesamtportfolios eben auch. Gestoppt wird sie allein durch
  `OWN_ALPHA` und durch die Signifikanz des Zuwachses (t 2,22 < 2,81).
- **Varianten des Challengers (EVO-REG-0004 – 0010):** Jede hebt Netto
  (+3,5 bis +5,4 Pp.) und Sharpe (+0,24 bis +0,33) und besteht alle
  reinen Wertprüfungen. Ihr eigenes α ist klein und weit unter der Schwelle
  (t 0,74 – 1,63; α-Anteil 8 – 25 %; R² 0,81 – 0,95). Fünf von sieben
  scheitern zusätzlich an der Trade-Geometrie.
- **Zuwachs-t** liegt bei allen profitablen Proben zwischen 2,15 und 2,49,
  also 0,3 bis 0,7 unter der Schwelle.

### Folgerungen

1. Kopien, Neugewichtungen und Ausstiegsvarianten bestehender Strategien
   gelten in v4 nicht als zusätzlicher Edge. Keine Schwelle muss vor dem
   Festschreiben verschärft werden.
2. Im Portfolio-Weg ist `OWN_ALPHA` die einzige Prüfung, die eine reine
   Kopie sicher stoppt. Die Zuwachs-Signifikanz stoppt sie hier nur knapp
   und würde mit mehr Monaten nachgeben; die Wertprüfungen stoppen sie gar
   nicht. Die zweite Sperre ist strukturell: `INDEPENDENT_FAMILY` verlangt
   einen eigenen Einstiegs-Evaluator, nur Einstiegsparameter und feste
   Ausstiege. Die Proben haben diese Prüfung nur bestanden, weil sie für die
   Gegenprobe bewusst als bestanden gesetzt war.
3. Die reinen Wertprüfungen sind für jede profitable RISK_ON-Long-Strategie
   leicht: Mehr Kapital im Markt hebt Netto und Sharpe, weil A eine
   ungenutzte Reserve enthält. Sie sind Mindestbedingungen, kein Beleg.
   Den Ausschlag geben `OWN_ALPHA` und `INCREMENT_SIGNIFICANCE`.

## 5. Laufzeit und T7

- Vergleich A: 17,4 min, ein Vergleich B rund 25 min auf einem
  ausgelasteten Entwicklungsrechner.
- Der Vorab-Cache der Bestandsbewertungen (T7) würde B etwa auf ein Drittel
  verkürzen.
- Für das Screening eines Startgenoms ist T7 nicht nötig: Vergleich A wird je
  Lauf nur einmal gerechnet und von allen Kandidaten geteilt.
- Vor regelmäßigen Läufen auf dem VPS (0,75 CPU) ist T7 zu empfehlen; das
  wird mit der Verdrahtung der Familie entschieden.

## 6. Datenzugriffe dieses Protokolls

| Lauf | Zeitraum | Strategien | zählt für N |
|---|---|---|---|
| Gleichwertigkeit (4×) | 2018-04 – 2023-12 | Champion, Challenger | nein (Referenz) |
| Vergleich A mit und ohne Stufe 2 | 2018-04 – 2023-12 | Champion, Challenger | nein (Referenz) |
| Gegenprobe (Vergleich A + 9 × B) | 2018-04 – 2023-12 | Wurzeln, Kopien, EVO-REG-0004 – 0010 | nein (bekannte Genome) |

Der Holdout (2024-01 – 2026-10-14) und der Forward-Zeitraum ab 2026-10-15
wurden nicht berührt.
