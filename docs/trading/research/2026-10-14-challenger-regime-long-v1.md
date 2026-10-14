# Challenger CRYPTO_REGIME_LONG_V1 — Regeln vor dem ersten Forward-Trade

Festgeschrieben am 2026-10-14, bevor die Strategie einen einzigen
Forward-Trade gemacht hat. Ab dem Commit dieses Dokuments werden Regeln und
Parameter nicht mehr geändert; jede Änderung wäre eine neue Version mit
eigenem Startzeitpunkt.

## Hypothese

Der Echtdaten-Research ([Ergebnisse](2026-10-14-real-data-results.md)) zeigt:
Das crypto-native Regime als reiner Halte-Filter war in Training und Test
robuster als jede Breakout-Einstiegsregel (BTC Test: Sharpe 1,04 gegenüber
Buy & Hold 0,72, Drawdown 20 % gegenüber 53 %, ohne Kosten). Die Strategie
prüft, ob dieser Befund als handelbare Long-Strategie mit Stop, Kosten und
Risk-Engine im Forward-Test besteht.

**Wichtig:** Die Hypothese stammt aus Daten, die den Zeitraum 2024–2026
enthalten. Dieser Zeitraum ist für den Challenger kein unabhängiger
Out-of-Sample-Test mehr. Unabhängig ist nur der Forward-Test.

## Regeln

| | |
|---|---|
| Schlüssel / Engine | `CRYPTO_REGIME_LONG_V1`, `crypto-regime-long-v1/1.0.0` |
| Spezifikations-Hash | `4708eaf89a39a2db9cebfd20564fce2f912dd731da74c5f658eb76c1ed64df6c` |
| Markt | Binance Spot, nur BTCUSDT (ETH-Zuweisung bleibt aus), 1h-Scan, nur Long |
| Regime | `crypto-native-regime-v1/1.0.0` (`reportJson.cryptoNative`); andere Modelle werden abgelehnt |
| **Einstieg** | Regime-Gate offen: Krypto `RISK_ON`, Risk Mode nicht `DEFENSIVE`/`HIGH_RISK`/`UNKNOWN`, Konfidenz ≥ 60. Keine Trend-, Ausbruchs-, Momentum-, Volumen- oder Signal-Regel. Kritische bärische Kontext-Events blockieren (wie bei allen Long-Strategien). |
| Stop | Einstieg − 2 × ATR(14) der Tageskerzen, auf den Tick abgerundet |
| Ziel | Einstieg + 4 × Stop-Abstand, auf den Tick abgerundet; Mindest-CRV 2 |
| **Exit auf Regime** | Sobald im neuesten Regime-Report, der bis zum Schluss der überwachten 1h-Kerze erzeugt wurde, das Gate geschlossen ist: Market-Exit zum Kerzenschluss (`INVALIDATION`, Position `INVALIDATED`). Fehlender, fremder oder > 26 h alter Report gilt als geschlossen. |
| Zeit-Backstop | 720 h (30 Tage); bei weiter offenem Gate Neueinstieg beim nächsten Scan |
| Einstiegslücke | höchstens 0,5 × ATR(14, 1h) über dem Referenzpreis (wie LONG_V1) |
| Validierung | Eingangs-, Frische- und Datenqualitätsprüfung von LONG_V1 |

Keiner dieser Werte ist auf Daten angepasst: 2 × ATR(1d) ist ein
Standard-Schutzstop für Tagesschwankungen, 4R hält das Ziel weit genug weg,
dass meist der Regime-Exit entscheidet und R-008 (netto 2R) nach Kosten hält,
30 Tage sind ein grober Backstop.

## Risiko, Kosten, Kapital

Gleich wie der Champion: 0,25 % Risiko je Trade (Risk-Engine,
`risk-rules-v1/1.3.0`), Kostenprofil BTCUSDT v2 (10 bp Gebühr, 2 bp Spread,
3 bp Slippage), 10 000 USDT Startkapital — in einem **eigenen virtuellen
Portfolio** mit eigenem Ledger, eigener Session und eigenen Kennzahlen.

## Technischer Plausibilitätscheck (kein Beleg)

Replay BTCUSDT 2018–2026, SPEC, REALISTIC, crypto-natives Regime, ein
durchgehendes Portfolio (Engine `shadow-replay-v1/1.3.0`): 104 Trades,
keine Invariantenverletzung, Exits 71 × Regime, 15 × Stop, 14 × Ziel,
4 × Zeit; Ø Haltedauer rund eine Woche, Ø Stop-Abstand 7,7 %, Zeit im Markt
25–30 %. Kennzahlen (PF ≈ 2,3 bis 2023, ≈ 2,1 ab 2024) sind wegen der oben
genannten Vorkenntnis **nicht** als Test zu lesen.

Der Check hat zwei technische Fehler gefunden, die vor dem Einfrieren behoben
wurden (keine Strategie-Anpassung):

1. Der Regime-Exit fehlte, obwohl `REGIME_INVALIDATED` spezifiziert war — jetzt
   umgesetzt, aber nur für Versionen, die `exitPolicy` deklarieren (der
   laufende Champion ist nicht betroffen).
2. R-024 verglich nach einem Verlust mit dem vorherigen *genehmigten Betrag*
   statt mit dem vorherigen *Budget* (Spezifikation). Rundungsreste der Menge
   wurden so zu einer kritischen „Risikoerhöhung“ mit `ERROR_LOCK` — das hätte
   auch den Champion nach einem Verlust gesperrt.

## Vergleich Champion gegen Challenger (vorab festgelegt)

Beide laufen auf denselben BTC-Live-Daten mit denselben Kosten und demselben
Startkapital in getrennten Portfolios. Verglichen werden nur Forward-Daten ab
dem jeweiligen Startzeitpunkt: Netto-PnL, Profit Factor, Ø R, Max. Drawdown,
Zeit im Markt, Kosten. Eine Aussage ist frühestens nach 30 geschlossenen
Trades je Strategie oder 6 Monaten sinnvoll; vorher wird nichts umgestellt.
