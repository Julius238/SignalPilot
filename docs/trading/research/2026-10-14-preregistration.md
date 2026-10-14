# Vorregistrierung des Testzeitraums (2026-10-14)

Geschrieben und committet **bevor** ein einziger Replay-Lauf den Testzeitraum
gesehen hat. Alles hier ist aus dem Trainingszeitraum abgeleitet.

## Daten und Split

- Binance-Spot BTCUSDT und ETHUSDT, 1h/4h/1d, 2017-08-17 bis 2026-10-14
  (`exportBinanceHistory`), Regime-Benchmarks SPY/QQQ als FRED-Index-Proxys
  (S&P 500, Nasdaq-100; IWM fehlt).
- Training: alle Anker vor **2024-01-01T00:00:00Z** (handelbar ab 2018-03
  nach 200 Tageskerzen Vorlauf). Test: ab 2024-01-01, frisches Portfolio
  (`RESEARCH_PHASE=TEST`), frühere Kerzen nur als Indikator-Vorlauf.
- Engine `shadow-replay-v1/1.1.0`: Datenqualität über 250-Kerzen-Fenster,
  Kill-Switch-Freigabe nach 24 h (R-021), Kosten getrennt nach Gebühr,
  Spread und Slippage.

## Eingefrorenes Variantenset

Die acht ursprünglich vorregistrierten Varianten (BASELINE, WIDE_STOP, TP_3R,
NO_HTF_SIGNALS, PRICE_ONLY, RELAXED_ENTRY, NO_REGIME, COMBINED) und die zwei
aus der Bedingungs-Studie auf Trainingsdaten abgeleiteten (TREND_CORE,
TREND_CORE_3R). Regime-Varianten: AS_SPECIFIED, CRYPTO_ONLY,
CRYPTO_NATIVE_V1 (`crypto-native-regime-v1/1.0.0`). Nach diesem Commit wird
keine Variante, kein Parameter und keine Regime-Regel mehr geändert.

## Kandidaten für einen ersten längeren Shadow-Test

Aus dem Training (BTCUSDT, SPEC, Kosten REALISTIC):

| Kandidat | Trades | PF | Ø R | t(Ø R) |
|---|---:|---:|---:|---:|
| K1: COMBINED · AS_SPECIFIED | 38 | 2,40 | +0,64 | 2,4 |
| K2: TREND_CORE_3R · CRYPTO_NATIVE_V1 | 73 | 1,42 | +0,26 | 1,3 |

ETHUSDT zeigt im Training in keiner Variante und keinem Regime einen
belastbaren Vorteil und ist kein Kandidat.

## Entscheidungsregel (vor dem Test festgelegt)

1. Ein Kandidat gilt im Test als **plausibel bestätigt**, wenn er auf BTCUSDT
   (SPEC, REALISTIC) im Testzeitraum mindestens 10 Trades, Ø R > 0 und einen
   Profit Factor > 1 erreicht und unter PESSIMISTIC nicht ins Negative kippt.
2. Bestätigen sich beide, wird K2 bevorzugt: Er braucht keine Aktien-Daten,
   die live nicht verfügbar sind (Finnhub `/stock/candle` liefert 403), hat im
   Training mehr Trades und bleibt als einziger auch mit den live
   konfigurierten BOOTSTRAP-Kosten positiv.
3. Bestätigt sich keiner, wird **keine** Variante in die produktive
   Shadow-Strategie übernommen; der Shadow-Betrieb bleibt Datensammlung.
4. Der Testzeitraum wird genau einmal ausgewertet. Ein Nachjustieren danach
   wäre ein neuer Trainingsschritt und bräuchte einen neuen, späteren
   Testzeitraum (Forward-Test im Shadow-Betrieb).

Keiner der beiden Kandidaten ist im Training statistisch signifikant
(|t| < 2,5 bei rund 20 getesteten Zellen); K1 verdankt 16,6 R seiner 24,3 R
dem Jahr 2020, K2 verliert 2023 −5,9 R. Der Test kann deshalb nur
„plausibel“ bestätigen, nicht beweisen.

## Regime als reiner Halte-Filter

Die Regime-Studie (`shadowRegimeStudy`, Halten von BTC/ETH nur an Tagen mit
offenem LONG_V1-Regime-Gate, ohne Kosten) wird im Test ebenfalls genau einmal
für AS_SPECIFIED, CRYPTO_ONLY und CRYPTO_NATIVE_V1 ausgewertet. Im Training:
BTC CRYPTO_NATIVE_V1 CAGR 50 %, Max. DD 38 %, Sharpe 1,30 gegenüber
Buy & Hold 32 % / 77 % / 0,76.
