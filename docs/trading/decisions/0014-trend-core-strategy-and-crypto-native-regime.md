# ADR 0014 – CRYPTO_TREND_CORE_LONG_V1 und das crypto-native Regime

- Status: Accepted
- Datum: 2026-10-14

## Kontext

Auf 8,6 Jahren echter Binance-Daten macht `CRYPTO_MTF_BREAKOUT_LONG_V1` keinen
einzigen Trade: Die Signal-Engine vergibt BULLISH nur in 3–5 % der Stunden,
die Strategie verlangt es auf 1h, 4h und 1d gleichzeitig. Live kommt hinzu,
dass Finnhub `/stock/candle` mit dem vorhandenen Key 403 liefert; ohne
SPY/QQQ/IWM erreicht das Produktionsregime höchstens Konfidenz 51, und
LONG_V1 scheitert immer an Konfidenz ≥ 60. Ein Shadow-Test mit LONG_V1 würde
nichts messen.

Die vorregistrierte Echtdaten-Studie (docs/trading/research/2026-10-14-*)
hat aus dem Training (2018–2023) zwei Kandidaten abgeleitet und den Test
(2024–2026) genau einmal ausgewertet. K2 — Variante TREND_CORE_3R unter dem
crypto-nativen Regime — hat die vorab festgelegte Regel erfüllt (BTC, SPEC,
REALISTIC: 49 Trades, Ø R +0,08, PF 1,12; PESSIMISTIC Ø R +0,05). Die Evidenz
ist schwach (t ≈ 0,4); der Shadow-Betrieb ist der Forward-Test.

## Entscheidung

1. **Eigene, versionierte Strategie** `CRYPTO_TREND_CORE_LONG_V1`
   (`crypto-mtf-breakout-v1/1.2.0`) neben LONG_V1, nicht als Änderung von
   LONG_V1. Gleicher Breakout-Evaluator; das Regelwerk steht vollständig in
   den gehashten Parametern: ohne Signal-Engine-Bestätigungen, ohne Volumen-,
   RSI- und ATR-Filter, Stop-Kappe 6 %, Mindest-Stop 1,75 %, Ziel 3R,
   `regimeSource: crypto-native-regime-v1/1.0.0`. Sie entscheidet im Replay
   Trade für Trade identisch zur Research-Variante TREND_CORE_3R.
2. **Crypto-natives Regime live, additiv.** Der Regime-Job speichert den
   Report von `calculateCryptoNativeRegimeReport` zusätzlich unter
   `MarketRegimeSnapshot.reportJson.cryptoNative`; die Spalten bleiben der
   Produktionsreport, den alle bisherigen Leser (Dashboard, Nexus, LONG_V1,
   Signal-Regeln) unverändert sehen. Keine Migration.
3. **Eine Regime-Auswahl für Strategie und Risk.** `regimeSource.ts` wählt für
   beide Assembler aus der StrategyVersion: Produktionsspalten ohne
   `regimeSource`, sonst den deklarierten Report. Fehlt er, ist das Regime
   `null` (fail closed) — nie ersatzweise das andere Modell. Der Snapshot
   trägt die Quelle (`marketRegime.source`); eine Strategie, die eine Quelle
   deklariert, lehnt jede andere mit `REGIME_SOURCE_MISMATCH` ab, und LONG_V1
   lehnt umgekehrt einen crypto-nativen Report ab.
4. **Freigabe in der Risk-Engine** über die neue, gehashte Allowlist
   `APPROVED_LONG_STRATEGY_KEYS` (Regelwerk `risk-rules-v1/1.2.0`). Jede
   nicht gelistete Long-Identität bleibt kritisch abgelehnt. Die Golden
   Fixtures sind regeneriert; geändert haben sich nur Versions-Strings und
   davon abgeleitete Hashes, kein Urteil.
5. **Nichts wird aktiviert.** Der Setup-Job legt Strategie, StrategyVersion
   und BTC/ETH-Zuweisungen deaktiviert an. Die Long-Freigabe bleibt
   `TRADING_STRATEGY_LONG_V1_ENABLED` (sie steuert die Long-Richtung); welche
   Strategie läuft, entscheidet die aktivierte Zuweisung.

## Konsequenzen

- Für den ersten längeren Shadow-Test wird die BTC-Zuweisung von
  `CRYPTO_TREND_CORE_LONG_V1` aktiviert (Runbook 14), nicht LONG_V1. ETH
  zeigte in keiner Variante einen Vorteil und bleibt deaktiviert.
- Das Kostenprofil muss kalibriert sein (`shadowExecutionProfileCalibrate`):
  mit dem Bootstrap-Profil 10/10/10 bp ist K2 im Test leicht negativ.
- Ein späteres Nachjustieren ist ein neuer Trainingsschritt und braucht neue,
  ungesehene Daten — den Shadow-Forward-Test.
