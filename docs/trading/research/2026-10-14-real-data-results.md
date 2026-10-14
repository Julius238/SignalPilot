# Echtdaten-Replay: Ergebnisse Training und Test (2026-10-14)

Vorregistrierung: [2026-10-14-preregistration.md](2026-10-14-preregistration.md)
(Commit `6b9d8b5`, vor dem ersten Testlauf). Trainingsdetails:
[2026-10-14-training-results.md](2026-10-14-training-results.md). Rohtabellen
des Tests: Anhang unten.

## Daten und Methode

- Binance-Spot BTCUSDT/ETHUSDT 1h/4h/1d, 2017-08-17 → 2026-10-14 (je 80 156
  Stundenkerzen), lokal über `data-api.binance.vision` geladen. SPY/QQQ als
  FRED-Index-Proxys (S&P 500, Nasdaq-100), IWM fehlt.
- Unveränderte Produktions-Engines (Strategie, Risk, Simulation, Portfolio,
  Performance) stündlich über die Historie (`shadow-replay-v1/1.1.0`).
  Kostenprofile BOOTSTRAP 10/10/10, PESSIMISTIC 10/4/5, REALISTIC 10/2/3 bp
  (Gebühr / voller Spread / Slippage). 0,25 % Risiko je Trade.
- Training 2018-03 → 2023-12, Test 2024-01 → 2026-10 mit frischem Portfolio.
  Der Test wurde genau einmal für das eingefrorene Set ausgewertet.

## Kernergebnisse

**Basisstrategie (CRYPTO_MTF_BREAKOUT_LONG_V1): 0 Trades** in 8,6 Jahren auf
BTC und ETH. Die Signal-Engine vergibt BULLISH nur in 3–5 % der Stunden; die
Strategie verlangt es auf 1h, 4h und 1d gleichzeitig plus MTF-Alignment.
Von den acht vorregistrierten Varianten handeln nur die, die diese
Konjunktion entfernen (PRICE_ONLY, NO_HTF_SIGNALS, COMBINED).

**BTCUSDT, SPEC, REALISTIC** (Ø R und t aus den Einzeltrades):

| Variante · Regime | Training: Trades / PF / Ø R / t | Test: Trades / PF / Ø R / t |
|---|---|---|
| COMBINED · AS_SPECIFIED (K1) | 38 / 2,40 / +0,64 / 2,4 | 24 / 0,30 / −0,64 / −2,8 |
| COMBINED · CRYPTO_NATIVE_V1 | 47 / 1,58 / +0,33 / 1,4 | 27 / 0,61 / −0,32 / −1,2 |
| TREND_CORE · AS_SPECIFIED | 60 / 1,16 / +0,10 / 0,5 | 45 / 0,70 / −0,21 |
| TREND_CORE_3R · AS_SPECIFIED | 55 / 1,33 / +0,20 / 0,9 | 41 / 0,66 / −0,25 / −1,2 |
| TREND_CORE_3R · CRYPTO_NATIVE_V1 (K2) | 73 / 1,42 / +0,26 / 1,3 | 49 / 1,12 / +0,08 / 0,4 |

Mit den live konfigurierten BOOTSTRAP-Kosten ist K2 im Test leicht negativ
(PF 0,96, Ø R −0,02). ETHUSDT zeigt weder im Training noch im Test eine
Variante mit belastbarem Vorteil.

**Buy & Hold** (ein Round-Trip derselben Kosten): BTC Training +266 %, Test
+96 %; ETH Training +163 %, Test +9 %. Die Breakout-Varianten sind bei
0,25 % Risiko je Trade und 1–5 % Zeit im Markt in absoluten Renditen
nicht vergleichbar (≤ ±6 % über den ganzen Zeitraum); risikobereinigt
(Sharpe) liegen sie im Test unter Buy & Hold.

## Was gute Setups blockiert (Bedingungs-Studie, Training)

Forward-Rendite 72 h, erfüllt − verfehlt (BTC / ETH, %-Punkte):

- Informativ: Regime +0,72 / +1,11, Trend 1D +0,85 / +0,90, Trend 4H
  +0,42 / +1,09, Trend 1H +0,33 / +0,69, Ausbruch +0,32 / +0,38,
  Signal-Engine 1h/4h/1d +0,45 … +1,41 (aber nur 1–2 % der Stunden erfüllt).
- Ohne Information, blockieren viel: relatives Volumen ≥ 1,5 (85 % der
  Stunden, +0,07 / +0,05), RSI-Band (60 %, −0,03 / −0,01).
- Kontraproduktiv: ATR-Band (−0,17 / −0,05) und 3-%-Stop-Kappe
  (−0,71 / −0,49): Die ausgeschlossenen volatilen Stunden liefen besser.
- Beinahe-Treffer (genau eine verfehlte Bedingung) sind selten, weil fast
  immer mehrere Bedingungen gleichzeitig scheitern; die Bedingungs-Studie
  ersetzt sie als Aussage.

## Marktregime

Ohne Aktien-Daten erreicht das Produktionsregime höchstens Konfidenz 51
(2 von 5 Benchmarks) und LONG_V1 scheitert immer an Konfidenz ≥ 60. Live ist
genau das der Fall: Finnhub `/stock/candle` liefert mit dem vorhandenen Key
403. Aktien-`MIXED` setzt den Risk Mode `DEFENSIVE`, Aktien-`RISK_OFF`
`HIGH_RISK` — beide sperren Krypto-Einstiege.

Regime als reiner Halte-Filter (BTC/ETH nur bei offenem LONG_V1-Gate halten,
ohne Kosten; Umschaltkosten ≈ 2–4 %-Punkte p. a.):

| | Training CAGR / DD / Sharpe | Test Rendite / DD / Sharpe |
|---|---|---|
| BTC Buy & Hold | 32 % / 77 % / 0,76 | +88 % / 53 % / 0,72 |
| BTC AS_SPECIFIED (Aktien) | 42 % / 42 % / 1,15 | +26 % / 30 % / 0,48 |
| BTC CRYPTO_NATIVE_V1 | 50 % / 38 % / 1,30 | +91 % / 20 % / 1,04 |
| ETH Buy & Hold | 29 % / 90 % / 0,74 | +6 % / 68 % / 0,37 |
| ETH AS_SPECIFIED (Aktien) | 65 % / 28 % / 1,35 | +73 % / 45 % / 0,76 |
| ETH CRYPTO_NATIVE_V1 | 57 % / 30 % / 1,25 | +115 % / 35 % / 0,95 |

Die starke Aktien-Abhängigkeit ist für Krypto nicht sinnvoll: Sie ist live
mangels Daten gar nicht erfüllbar, und das versionierte Crypto-native Regime
(nur BTC/ETH, 200-Tage-Trendfilter) ist im unberührten Test auf beiden
Assets besser als das Produktionsregime und als Buy & Hold (risikobereinigt).

## Entscheidung nach der Vorregistrierung

- K1 ist im Test durchgefallen (Ø R −0,64, t −2,8): typischer Fall von
  Überanpassung an das Trainingsjahr 2020.
- K2 erfüllt die Regel formal (49 Trades, Ø R +0,08, PF 1,12, PESSIMISTIC
  +0,05) und ist damit der Kandidat für den ersten längeren Shadow-Test. Die
  Evidenz für einen echten Vorteil ist schwach (t 0,4, abnehmend:
  2024 +8,0 R, 2025 −0,8 R, 2026 −3,2 R); der Shadow-Test ist ein
  Forward-Test, kein Beleg.
- Das robusteste Ergebnis ist das Crypto-native Regime selbst. Eine
  Regime-Halte-Strategie ist der naheliegende nächste Forschungskandidat; sie
  muss als Strategie (mit Stop, Kosten, Risk-Engine) erst im Replay und dann
  im Shadow-Forward-Test bestehen — der Testzeitraum ist dafür verbraucht.

## Anhang: Rohtabellen des Tests

### Regime-Studie (2024-01-02 → 2026-10-14, nur Testzeitraum ab 2024-01-01T00:00:00.000Z)

1017 Tage. Gate = Einstiegsbedingung von LONG_V1: cryptoRegime RISK_ON, Risk Mode nicht DEFENSIVE/HIGH_RISK/UNKNOWN, Konfidenz ≥ 60. AS_SPECIFIED nutzt S&P 500 und Nasdaq-100 (FRED) als SPY/QQQ-Proxy; IWM fehlt.

#### BTCUSDT

| Filter | Tage offen | Ø 7d % | Ø 14d % | Ø 30d % | positiv 14d % | Gesamtrendite % | CAGR % | Max. DD % | Sharpe | Zeit im Markt % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Buy & Hold (immer offen) | 1017 | 0.64 | 1.31 | 3.01 | 53.2 | 88.3 | 25.5 | 53.0 | 0.72 | 100.0 |
| Gate AS_SPECIFIED | 283 | 1.24 | 2.41 | 2.36 | 54.9 | 26.4 | 8.8 | 29.6 | 0.48 | 27.9 |
| Gate CRYPTO_ONLY | 318 | 1.04 | 2.09 | 3.07 | 52.6 | 39.2 | 12.6 | 29.6 | 0.60 | 31.3 |
| Gate CRYPTO_NATIVE_V1 | 309 | 1.13 | 2.27 | 4.81 | 53.8 | 91.1 | 26.2 | 20.3 | 1.04 | 30.4 |
| AS_SPECIFIED gesperrt trotz Krypto RISK_ON (Aktien-Veto) | 35 | -0.57 | -0.38 | 8.38 | 34.3 | 10.1 | 3.5 | 10.7 | 0.49 | 3.4 |
| Krypto RISK_ON (Produktionsregel, ohne Aktien) | 318 | 1.04 | 2.09 | 3.07 | 52.6 | 39.2 | 12.6 | 29.6 | 0.60 | 31.3 |

#### ETHUSDT

| Filter | Tage offen | Ø 7d % | Ø 14d % | Ø 30d % | positiv 14d % | Gesamtrendite % | CAGR % | Max. DD % | Sharpe | Zeit im Markt % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Buy & Hold (immer offen) | 1017 | 0.50 | 1.03 | 2.49 | 48.3 | 6.2 | 2.2 | 67.6 | 0.37 | 100.0 |
| Gate AS_SPECIFIED | 283 | 1.63 | 3.35 | 2.21 | 53.1 | 72.8 | 21.7 | 44.7 | 0.76 | 27.9 |
| Gate CRYPTO_ONLY | 318 | 1.40 | 3.26 | 3.52 | 52.3 | 78.4 | 23.1 | 44.7 | 0.77 | 31.3 |
| Gate CRYPTO_NATIVE_V1 | 309 | 1.73 | 4.12 | 6.14 | 54.8 | 114.5 | 31.5 | 35.4 | 0.95 | 30.4 |
| AS_SPECIFIED gesperrt trotz Krypto RISK_ON (Aktien-Veto) | 35 | -0.43 | 2.63 | 13.38 | 45.7 | 3.2 | 1.1 | 14.0 | 0.16 | 3.4 |
| Krypto RISK_ON (Produktionsregel, ohne Aktien) | 318 | 1.40 | 3.26 | 3.52 | 52.3 | 78.4 | 23.1 | 44.7 | 0.77 | 31.3 |


### Shadow-Replay-Research (nur Testzeitraum, frisches Portfolio)

Datenquelle: /Users/juliuseggert/Dev/SignalPilot/data/market-snapshots/real · Split 2024-01-01T00:00:00.000Z (vorab festgelegt) · 120 Läufe

Kosten = Gebühren + Spread + Slippage (Quote-Währung). Buy & Hold mit einem Round-Trip derselben Kosten.

#### BTCUSDT · SIGNAL_EDGE · Regime AS_SPECIFIED · Kosten BOOTSTRAP

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |
| COMBINED · Test | 28 | -421.07 | -4.21 | 0.29 | 17.9 | 34.17 | -25.74 | -0.613 | 4.21 | -1.68 | 1.5 | 6 | 204.40 | 95.80 |
| NO_HTF_SIGNALS · Test | 17 | -193.02 | -1.93 | 0.41 | 23.5 | 33.09 | -25.03 | -0.457 | 2.49 | -1.01 | 0.5 | 10 | 129.21 | 95.80 |
| NO_REGIME · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |
| PRICE_ONLY · Test | 20 | -263.06 | -2.63 | 0.33 | 20.0 | 33.00 | -24.69 | -0.532 | 2.66 | -1.31 | 0.6 | 10 | 155.80 | 95.80 |
| RELAXED_ENTRY · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |
| TP_3R · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |
| TREND_CORE · Test | 51 | -303.38 | -3.03 | 0.65 | 29.4 | 37.51 | -24.06 | -0.240 | 3.55 | -0.89 | 4.8 | 9 | 279.15 | 95.80 |
| TREND_CORE_3R · Test | 47 | -165.79 | -1.66 | 0.79 | 29.8 | 44.92 | -24.08 | -0.140 | 2.65 | -0.41 | 4.9 | 9 | 258.67 | 95.80 |
| WIDE_STOP · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |

#### BTCUSDT · SIGNAL_EDGE · Regime AS_SPECIFIED · Kosten PESSIMISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.11 |
| COMBINED · Test | 28 | -391.05 | -3.91 | 0.34 | 17.9 | 40.80 | -25.87 | -0.568 | 3.91 | -1.47 | 1.5 | 6 | 154.20 | 96.11 |
| NO_HTF_SIGNALS · Test | 17 | -169.91 | -1.70 | 0.48 | 23.5 | 38.89 | -25.04 | -0.393 | 2.48 | -0.83 | 0.5 | 10 | 96.81 | 96.11 |
| NO_REGIME · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.11 |
| PRICE_ONLY · Test | 20 | -236.01 | -2.36 | 0.40 | 20.0 | 38.79 | -24.45 | -0.476 | 2.55 | -1.10 | 0.6 | 10 | 116.20 | 96.11 |
| RELAXED_ENTRY · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.11 |
| TP_3R · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.11 |
| TREND_CORE · Test | 51 | -231.22 | -2.31 | 0.73 | 29.4 | 42.43 | -24.10 | -0.182 | 3.09 | -0.62 | 4.8 | 9 | 204.99 | 96.11 |
| TREND_CORE_3R · Test | 47 | -89.53 | -0.90 | 0.89 | 29.8 | 50.46 | -24.12 | -0.074 | 2.57 | -0.20 | 4.9 | 9 | 189.97 | 96.11 |
| WIDE_STOP · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.11 |

#### BTCUSDT · SIGNAL_EDGE · Regime AS_SPECIFIED · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.23 |
| COMBINED · Test | 28 | -378.03 | -3.78 | 0.37 | 17.9 | 43.69 | -25.93 | -0.548 | 3.78 | -1.38 | 1.5 | 6 | 132.46 | 96.23 |
| NO_HTF_SIGNALS · Test | 17 | -158.47 | -1.58 | 0.51 | 23.5 | 41.33 | -24.91 | -0.364 | 2.46 | -0.75 | 0.5 | 10 | 82.43 | 96.23 |
| NO_REGIME · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.23 |
| PRICE_ONLY · Test | 20 | -222.37 | -2.22 | 0.43 | 20.0 | 41.23 | -24.21 | -0.452 | 2.49 | -1.02 | 0.6 | 10 | 98.67 | 96.23 |
| RELAXED_ENTRY · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.23 |
| TP_3R · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.23 |
| TREND_CORE · Test | 51 | -201.12 | -2.01 | 0.77 | 29.4 | 44.48 | -24.12 | -0.157 | 2.90 | -0.52 | 4.8 | 9 | 174.04 | 96.23 |
| TREND_CORE_3R · Test | 47 | -57.65 | -0.58 | 0.93 | 29.8 | 52.77 | -24.13 | -0.047 | 2.56 | -0.12 | 4.9 | 9 | 161.27 | 96.23 |
| WIDE_STOP · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.23 |

#### BTCUSDT · SPEC · Regime AS_SPECIFIED · Kosten BOOTSTRAP

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |
| COMBINED · Test | 4 | -100.15 | -1.00 | 0.00 | 0.0 | – | -25.04 | -1.006 | 1.00 | -1.12 | 0.2 | 4 | 21.20 | 95.80 |
| NO_HTF_SIGNALS · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |
| NO_REGIME · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |
| PRICE_ONLY · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |
| RELAXED_ENTRY · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |
| TP_3R · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |
| TREND_CORE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |
| TREND_CORE_3R · Test | 41 | -331.05 | -3.31 | 0.56 | 22.0 | 47.25 | -23.63 | -0.327 | 3.52 | -0.97 | 3.9 | 10 | 221.53 | 95.80 |
| WIDE_STOP · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |

#### BTCUSDT · SPEC · Regime AS_SPECIFIED · Kosten PESSIMISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.11 |
| COMBINED · Test | 16 | -203.81 | -2.04 | 0.43 | 18.8 | 50.97 | -27.44 | -0.512 | 2.08 | -0.95 | 0.7 | 6 | 81.91 | 96.11 |
| NO_HTF_SIGNALS · Test | 1 | -30.41 | -0.30 | 0.00 | 0.0 | – | -30.41 | -1.217 | 0.30 | -0.60 | 0.0 | 1 | 3.23 | 96.11 |
| NO_REGIME · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.11 |
| PRICE_ONLY · Test | 1 | -30.41 | -0.30 | 0.00 | 0.0 | – | -30.41 | -1.217 | 0.30 | -0.60 | 0.0 | 1 | 3.23 | 96.11 |
| RELAXED_ENTRY · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.11 |
| TP_3R · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.11 |
| TREND_CORE · Test | 2 | -55.33 | -0.55 | 0.00 | 0.0 | – | -27.67 | -1.109 | 0.55 | -0.84 | 0.0 | 2 | 6.34 | 96.11 |
| TREND_CORE_3R · Test | 41 | -279.87 | -2.80 | 0.63 | 22.0 | 52.87 | -23.62 | -0.275 | 3.43 | -0.76 | 3.9 | 10 | 162.40 | 96.11 |
| WIDE_STOP · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.11 |

#### BTCUSDT · SPEC · Regime AS_SPECIFIED · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.23 |
| COMBINED · Test | 24 | -379.88 | -3.80 | 0.30 | 12.5 | 53.69 | -25.76 | -0.644 | 3.80 | -1.45 | 1.1 | 9 | 112.28 | 96.23 |
| NO_HTF_SIGNALS · Test | 1 | -30.54 | -0.31 | 0.00 | 0.0 | – | -30.54 | -1.222 | 0.31 | -0.60 | 0.0 | 1 | 2.72 | 96.23 |
| NO_REGIME · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.23 |
| PRICE_ONLY · Test | 1 | -30.54 | -0.31 | 0.00 | 0.0 | – | -30.54 | -1.222 | 0.31 | -0.60 | 0.0 | 1 | 2.72 | 96.23 |
| RELAXED_ENTRY · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.23 |
| TP_3R · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.23 |
| TREND_CORE · Test | 45 | -233.24 | -2.33 | 0.70 | 26.7 | 46.12 | -23.84 | -0.208 | 2.42 | -0.67 | 4.2 | 7 | 151.88 | 96.23 |
| TREND_CORE_3R · Test | 41 | -258.57 | -2.59 | 0.66 | 22.0 | 55.21 | -23.61 | -0.253 | 3.39 | -0.68 | 3.9 | 10 | 137.77 | 96.23 |
| WIDE_STOP · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.23 |

#### ETHUSDT · SIGNAL_EDGE · Regime AS_SPECIFIED · Kosten BOOTSTRAP

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 8.87 |
| COMBINED · Test | 36 | -164.91 | -1.65 | 0.74 | 27.8 | 46.57 | -24.25 | -0.183 | 2.38 | -0.53 | 1.5 | 9 | 242.60 | 8.87 |
| NO_HTF_SIGNALS · Test | 20 | -32.40 | -0.32 | 0.89 | 35.0 | 38.55 | -23.25 | -0.063 | 1.40 | -0.14 | 0.7 | 5 | 141.17 | 8.87 |
| NO_REGIME · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 8.87 |
| PRICE_ONLY · Test | 21 | -57.32 | -0.57 | 0.82 | 33.3 | 38.55 | -23.37 | -0.108 | 1.40 | -0.25 | 0.7 | 5 | 149.87 | 8.87 |
| RELAXED_ENTRY · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 8.87 |
| TP_3R · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 8.87 |
| TREND_CORE · Test | 46 | -317.87 | -3.18 | 0.61 | 26.1 | 40.74 | -23.73 | -0.279 | 3.73 | -1.03 | 3.4 | 12 | 243.22 | 8.87 |
| TREND_CORE_3R · Test | 43 | -174.75 | -1.75 | 0.76 | 27.9 | 46.03 | -23.45 | -0.162 | 3.21 | -0.52 | 3.6 | 11 | 229.76 | 8.87 |
| WIDE_STOP · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 8.87 |

#### ETHUSDT · SIGNAL_EDGE · Regime AS_SPECIFIED · Kosten PESSIMISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.04 |
| COMBINED · Test | 36 | -90.79 | -0.91 | 0.86 | 27.8 | 54.13 | -24.31 | -0.099 | 2.30 | -0.27 | 1.5 | 9 | 181.86 | 9.04 |
| NO_HTF_SIGNALS · Test | 20 | 13.79 | 0.14 | 1.05 | 35.0 | 44.44 | -22.87 | 0.030 | 1.40 | 0.06 | 0.7 | 5 | 104.28 | 9.04 |
| NO_REGIME · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.04 |
| PRICE_ONLY · Test | 21 | -11.24 | -0.11 | 0.97 | 33.3 | 44.44 | -23.02 | -0.019 | 1.40 | -0.04 | 0.7 | 5 | 110.97 | 9.04 |
| RELAXED_ENTRY · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.04 |
| TP_3R · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.04 |
| TREND_CORE · Test | 46 | -258.90 | -2.59 | 0.68 | 26.1 | 45.70 | -23.75 | -0.226 | 3.40 | -0.78 | 3.4 | 12 | 178.26 | 9.04 |
| TREND_CORE_3R · Test | 43 | -109.61 | -1.10 | 0.85 | 30.2 | 47.52 | -24.25 | -0.100 | 2.87 | -0.30 | 3.6 | 11 | 168.48 | 9.04 |
| WIDE_STOP · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.04 |

#### ETHUSDT · SIGNAL_EDGE · Regime AS_SPECIFIED · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.11 |
| COMBINED · Test | 36 | -58.61 | -0.59 | 0.91 | 27.8 | 57.41 | -24.34 | -0.063 | 2.31 | -0.16 | 1.5 | 9 | 155.76 | 9.11 |
| NO_HTF_SIGNALS · Test | 20 | 33.17 | 0.33 | 1.11 | 35.0 | 46.91 | -22.71 | 0.070 | 1.41 | 0.14 | 0.7 | 5 | 88.74 | 9.11 |
| NO_REGIME · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.11 |
| PRICE_ONLY · Test | 21 | 8.93 | 0.09 | 1.03 | 33.3 | 46.91 | -22.82 | 0.019 | 1.41 | 0.04 | 0.7 | 5 | 94.34 | 9.11 |
| RELAXED_ENTRY · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.11 |
| TP_3R · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.11 |
| TREND_CORE · Test | 46 | -234.36 | -2.34 | 0.71 | 26.1 | 47.77 | -23.75 | -0.204 | 3.26 | -0.69 | 3.4 | 12 | 151.20 | 9.11 |
| TREND_CORE_3R · Test | 43 | -82.54 | -0.83 | 0.89 | 30.2 | 49.65 | -24.27 | -0.074 | 2.85 | -0.22 | 3.6 | 11 | 142.94 | 9.11 |
| WIDE_STOP · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.11 |

#### ETHUSDT · SPEC · Regime AS_SPECIFIED · Kosten BOOTSTRAP

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 8.87 |
| COMBINED · Test | 12 | -60.74 | -0.61 | 0.72 | 25.0 | 53.07 | -24.44 | -0.201 | 1.38 | -0.38 | 0.8 | 5 | 65.03 | 8.87 |
| NO_HTF_SIGNALS · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 8.87 |
| NO_REGIME · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 8.87 |
| PRICE_ONLY · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 8.87 |
| RELAXED_ENTRY · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 8.87 |
| TP_3R · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 8.87 |
| TREND_CORE · Test | 2 | -14.73 | -0.15 | 0.41 | 50.0 | 10.27 | -25.00 | -0.294 | 0.67 | -0.26 | 0.5 | 1 | 6.12 | 8.87 |
| TREND_CORE_3R · Test | 37 | -248.38 | -2.48 | 0.62 | 24.3 | 44.64 | -23.22 | -0.270 | 3.93 | -0.87 | 3.1 | 12 | 194.93 | 8.87 |
| WIDE_STOP · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 8.87 |

#### ETHUSDT · SPEC · Regime AS_SPECIFIED · Kosten PESSIMISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.04 |
| COMBINED · Test | 28 | -106.29 | -1.06 | 0.79 | 28.6 | 48.98 | -24.91 | -0.150 | 2.30 | -0.34 | 1.1 | 8 | 138.07 | 9.04 |
| NO_HTF_SIGNALS · Test | 1 | 50.77 | 0.51 | – | 100.0 | 50.77 | – | 2.031 | 0.19 | 0.60 | 0.0 | 0 | 3.44 | 9.04 |
| NO_REGIME · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.04 |
| PRICE_ONLY · Test | 1 | 50.77 | 0.51 | – | 100.0 | 50.77 | – | 2.031 | 0.19 | 0.60 | 0.0 | 0 | 3.44 | 9.04 |
| RELAXED_ENTRY · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.04 |
| TP_3R · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.04 |
| TREND_CORE · Test | 7 | -52.32 | -0.52 | 0.54 | 28.6 | 31.08 | -22.90 | -0.298 | 1.11 | -0.54 | 0.6 | 3 | 20.94 | 9.04 |
| TREND_CORE_3R · Test | 37 | -126.37 | -1.26 | 0.80 | 29.7 | 45.48 | -24.10 | -0.135 | 3.03 | -0.40 | 3.3 | 12 | 143.28 | 9.04 |
| WIDE_STOP · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.04 |

#### ETHUSDT · SPEC · Regime AS_SPECIFIED · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.11 |
| COMBINED · Test | 31 | -8.19 | -0.08 | 0.98 | 32.3 | 52.36 | -25.32 | -0.008 | 1.84 | -0.02 | 1.2 | 7 | 136.26 | 9.11 |
| NO_HTF_SIGNALS · Test | 3 | 88.53 | 0.89 | 7.15 | 66.7 | 51.46 | -14.40 | 1.179 | 0.22 | 0.77 | 0.1 | 1 | 9.76 | 9.11 |
| NO_REGIME · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.11 |
| PRICE_ONLY · Test | 3 | 88.53 | 0.89 | 7.15 | 66.7 | 51.46 | -14.40 | 1.179 | 0.22 | 0.77 | 0.1 | 1 | 9.76 | 9.11 |
| RELAXED_ENTRY · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.11 |
| TP_3R · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.11 |
| TREND_CORE · Test | 37 | -235.01 | -2.35 | 0.64 | 24.3 | 46.88 | -23.46 | -0.255 | 3.03 | -0.77 | 2.8 | 12 | 120.01 | 9.11 |
| TREND_CORE_3R · Test | 37 | -104.17 | -1.04 | 0.83 | 29.7 | 47.53 | -24.11 | -0.111 | 2.94 | -0.32 | 3.3 | 12 | 121.51 | 9.11 |
| WIDE_STOP · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.11 |

#### Ablehnungsgründe und Beinahe-Treffer (BASELINE, REALISTIC)

### BTCUSDT · SIGNAL_EDGE · Regime AS_SPECIFIED

Zyklen 24416 · ungültig 0 · kein Kandidat 24416 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 19578, TREND_FILTER_4H_FAILED 1959, BREAKOUT_NOT_CONFIRMED 1554, TREND_FILTER_1D_FAILED 1133, RSI_OUT_OF_RANGE 125, ATR_RATIO_OUT_OF_RANGE 21, HIGHER_TIMEFRAME_4H_CONFLICT 20, RELATIVE_VOLUME_BELOW_MINIMUM 16
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 24340, HIGHER_TIMEFRAME_4H_CONFLICT 23784, HIGHER_TIMEFRAME_1D_CONFLICT 23624, SIGNAL_1H_DIRECTION_NOT_BULLISH 23516, BREAKOUT_NOT_CONFIRMED 23231, RELATIVE_VOLUME_BELOW_MINIMUM 19894, TREND_FILTER_1H_FAILED 19578, REGIME_NOT_RISK_ON 16761, TREND_FILTER_4H_FAILED 16651, TREND_FILTER_1D_FAILED 15552, RSI_OUT_OF_RANGE 14378, ATR_RATIO_OUT_OF_RANGE 8056
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 24416 | 0.095 | 0.274 | 52.1 | 52.1 |
| Echte Kandidaten | 0 | – | – | – | – |
| RSI_OUT_OF_RANGE | 2 | -3.385 | 0.910 | 0.0 | 50.0 |

### BTCUSDT · SPEC · Regime AS_SPECIFIED

Zyklen 24416 · ungültig 0 · kein Kandidat 24416 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 19578, TREND_FILTER_4H_FAILED 1959, BREAKOUT_NOT_CONFIRMED 1554, TREND_FILTER_1D_FAILED 1133, RSI_OUT_OF_RANGE 125, ATR_RATIO_OUT_OF_RANGE 21, HIGHER_TIMEFRAME_4H_CONFLICT 20, RELATIVE_VOLUME_BELOW_MINIMUM 16
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 24340, HIGHER_TIMEFRAME_4H_CONFLICT 23784, HIGHER_TIMEFRAME_1D_CONFLICT 23624, SIGNAL_1H_DIRECTION_NOT_BULLISH 23516, BREAKOUT_NOT_CONFIRMED 23231, RELATIVE_VOLUME_BELOW_MINIMUM 19894, TREND_FILTER_1H_FAILED 19578, REGIME_NOT_RISK_ON 16761, TREND_FILTER_4H_FAILED 16651, TREND_FILTER_1D_FAILED 15552, RSI_OUT_OF_RANGE 14378, ATR_RATIO_OUT_OF_RANGE 8056
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 24416 | 0.095 | 0.274 | 52.1 | 52.1 |
| Echte Kandidaten | 0 | – | – | – | – |
| RSI_OUT_OF_RANGE | 2 | -3.385 | 0.910 | 0.0 | 50.0 |

### ETHUSDT · SIGNAL_EDGE · Regime AS_SPECIFIED

Zyklen 24416 · ungültig 0 · kein Kandidat 24416 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 19831, TREND_FILTER_4H_FAILED 1972, TREND_FILTER_1D_FAILED 1290, BREAKOUT_NOT_CONFIRMED 1172, RSI_OUT_OF_RANGE 88, HIGHER_TIMEFRAME_4H_CONFLICT 27, RELATIVE_VOLUME_BELOW_MINIMUM 22, HIGHER_TIMEFRAME_1D_CONFLICT 10
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 24364, HIGHER_TIMEFRAME_4H_CONFLICT 23748, HIGHER_TIMEFRAME_1D_CONFLICT 23600, SIGNAL_1H_DIRECTION_NOT_BULLISH 23597, BREAKOUT_NOT_CONFIRMED 23304, RELATIVE_VOLUME_BELOW_MINIMUM 19927, TREND_FILTER_1H_FAILED 19831, TREND_FILTER_1D_FAILED 17961, TREND_FILTER_4H_FAILED 17604, REGIME_NOT_RISK_ON 16761, RSI_OUT_OF_RANGE 14484, ATR_RATIO_OUT_OF_RANGE 2710
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 24416 | 0.069 | 0.207 | 51.6 | 52.0 |
| Echte Kandidaten | 0 | – | – | – | – |
| TREND_FILTER_1D_FAILED | 3 | -0.378 | -3.218 | 33.3 | 0.0 |
| RSI_OUT_OF_RANGE | 2 | 0.525 | 5.718 | 50.0 | 100.0 |

### ETHUSDT · SPEC · Regime AS_SPECIFIED

Zyklen 24416 · ungültig 0 · kein Kandidat 24416 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 19831, TREND_FILTER_4H_FAILED 1972, TREND_FILTER_1D_FAILED 1290, BREAKOUT_NOT_CONFIRMED 1172, RSI_OUT_OF_RANGE 88, HIGHER_TIMEFRAME_4H_CONFLICT 27, RELATIVE_VOLUME_BELOW_MINIMUM 22, HIGHER_TIMEFRAME_1D_CONFLICT 10
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 24364, HIGHER_TIMEFRAME_4H_CONFLICT 23748, HIGHER_TIMEFRAME_1D_CONFLICT 23600, SIGNAL_1H_DIRECTION_NOT_BULLISH 23597, BREAKOUT_NOT_CONFIRMED 23304, RELATIVE_VOLUME_BELOW_MINIMUM 19927, TREND_FILTER_1H_FAILED 19831, TREND_FILTER_1D_FAILED 17961, TREND_FILTER_4H_FAILED 17604, REGIME_NOT_RISK_ON 16761, RSI_OUT_OF_RANGE 14484, ATR_RATIO_OUT_OF_RANGE 2710
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 24416 | 0.069 | 0.207 | 51.6 | 52.0 |
| Echte Kandidaten | 0 | – | – | – | – |
| TREND_FILTER_1D_FAILED | 3 | -0.378 | -3.218 | 33.3 | 0.0 |
| RSI_OUT_OF_RANGE | 2 | 0.525 | 5.718 | 50.0 | 100.0 |


### Shadow-Replay-Research (nur Testzeitraum, frisches Portfolio)

Datenquelle: /Users/juliuseggert/Dev/SignalPilot/data/market-snapshots/real · Split 2024-01-01T00:00:00.000Z (vorab festgelegt) · 60 Läufe

Kosten = Gebühren + Spread + Slippage (Quote-Währung). Buy & Hold mit einem Round-Trip derselben Kosten.

#### BTCUSDT · SPEC · Regime CRYPTO_NATIVE_V1 · Kosten BOOTSTRAP

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |
| COMBINED · Test | 4 | -100.15 | -1.00 | 0.00 | 0.0 | – | -25.04 | -1.006 | 1.00 | -1.12 | 0.2 | 4 | 21.20 | 95.80 |
| PRICE_ONLY · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |
| TREND_CORE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |
| TREND_CORE_3R · Test | 49 | -32.13 | -0.32 | 0.96 | 32.7 | 48.05 | -24.27 | -0.024 | 2.60 | -0.07 | 5.3 | 7 | 273.43 | 95.80 |

#### BTCUSDT · SPEC · Regime CRYPTO_NATIVE_V1 · Kosten PESSIMISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.11 |
| COMBINED · Test | 18 | -169.53 | -1.70 | 0.56 | 22.2 | 54.22 | -27.60 | -0.377 | 2.37 | -0.67 | 0.8 | 9 | 92.86 | 96.11 |
| PRICE_ONLY · Test | 1 | -30.41 | -0.30 | 0.00 | 0.0 | – | -30.41 | -1.217 | 0.30 | -0.60 | 0.0 | 1 | 3.23 | 96.11 |
| TREND_CORE · Test | 2 | -55.33 | -0.55 | 0.00 | 0.0 | – | -27.67 | -1.109 | 0.55 | -0.84 | 0.0 | 2 | 6.34 | 96.11 |
| TREND_CORE_3R · Test | 49 | 59.31 | 0.59 | 1.07 | 32.7 | 53.88 | -24.32 | 0.051 | 2.59 | 0.14 | 5.3 | 7 | 201.02 | 96.11 |

#### BTCUSDT · SPEC · Regime CRYPTO_NATIVE_V1 · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.23 |
| COMBINED · Test | 27 | -217.97 | -2.18 | 0.61 | 22.2 | 56.20 | -26.44 | -0.324 | 3.90 | -0.72 | 1.4 | 12 | 129.04 | 96.23 |
| PRICE_ONLY · Test | 1 | -30.54 | -0.31 | 0.00 | 0.0 | – | -30.54 | -1.222 | 0.31 | -0.60 | 0.0 | 1 | 2.72 | 96.23 |
| TREND_CORE · Test | 53 | -97.20 | -0.97 | 0.89 | 32.1 | 44.97 | -23.94 | -0.072 | 2.48 | -0.24 | 5.3 | 6 | 182.27 | 96.23 |
| TREND_CORE_3R · Test | 49 | 97.53 | 0.98 | 1.12 | 32.7 | 56.31 | -24.35 | 0.082 | 2.58 | 0.22 | 5.3 | 7 | 170.75 | 96.23 |

#### BTCUSDT · SPEC · Regime CRYPTO_ONLY · Kosten BOOTSTRAP

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |
| COMBINED · Test | 4 | -100.15 | -1.00 | 0.00 | 0.0 | – | -25.04 | -1.006 | 1.00 | -1.12 | 0.2 | 4 | 21.20 | 95.80 |
| PRICE_ONLY · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |
| TREND_CORE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 95.80 |
| TREND_CORE_3R · Test | 41 | -331.05 | -3.31 | 0.56 | 22.0 | 47.25 | -23.63 | -0.327 | 3.52 | -0.97 | 3.9 | 10 | 221.53 | 95.80 |

#### BTCUSDT · SPEC · Regime CRYPTO_ONLY · Kosten PESSIMISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.11 |
| COMBINED · Test | 16 | -203.81 | -2.04 | 0.43 | 18.8 | 50.97 | -27.44 | -0.512 | 2.08 | -0.95 | 0.7 | 6 | 81.91 | 96.11 |
| PRICE_ONLY · Test | 1 | -30.41 | -0.30 | 0.00 | 0.0 | – | -30.41 | -1.217 | 0.30 | -0.60 | 0.0 | 1 | 3.23 | 96.11 |
| TREND_CORE · Test | 2 | -55.33 | -0.55 | 0.00 | 0.0 | – | -27.67 | -1.109 | 0.55 | -0.84 | 0.0 | 2 | 6.34 | 96.11 |
| TREND_CORE_3R · Test | 41 | -279.87 | -2.80 | 0.63 | 22.0 | 52.87 | -23.62 | -0.275 | 3.43 | -0.76 | 3.9 | 10 | 162.40 | 96.11 |

#### BTCUSDT · SPEC · Regime CRYPTO_ONLY · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.23 |
| COMBINED · Test | 24 | -379.88 | -3.80 | 0.30 | 12.5 | 53.69 | -25.76 | -0.644 | 3.80 | -1.45 | 1.1 | 9 | 112.28 | 96.23 |
| PRICE_ONLY · Test | 1 | -30.54 | -0.31 | 0.00 | 0.0 | – | -30.54 | -1.222 | 0.31 | -0.60 | 0.0 | 1 | 2.72 | 96.23 |
| TREND_CORE · Test | 45 | -233.24 | -2.33 | 0.70 | 26.7 | 46.12 | -23.84 | -0.208 | 2.42 | -0.67 | 4.2 | 7 | 151.88 | 96.23 |
| TREND_CORE_3R · Test | 41 | -258.57 | -2.59 | 0.66 | 22.0 | 55.21 | -23.61 | -0.253 | 3.39 | -0.68 | 3.9 | 10 | 137.77 | 96.23 |

#### ETHUSDT · SPEC · Regime CRYPTO_NATIVE_V1 · Kosten BOOTSTRAP

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 8.87 |
| COMBINED · Test | 13 | -4.29 | -0.04 | 0.98 | 30.8 | 53.98 | -24.47 | -0.011 | 1.02 | -0.02 | 0.9 | 3 | 71.17 | 8.87 |
| PRICE_ONLY · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 8.87 |
| TREND_CORE · Test | 2 | -14.73 | -0.15 | 0.41 | 50.0 | 10.27 | -25.00 | -0.294 | 0.67 | -0.26 | 0.5 | 1 | 6.12 | 8.87 |
| TREND_CORE_3R · Test | 40 | -181.93 | -1.82 | 0.73 | 27.5 | 44.90 | -23.31 | -0.181 | 3.28 | -0.58 | 3.5 | 7 | 211.84 | 8.87 |

#### ETHUSDT · SPEC · Regime CRYPTO_NATIVE_V1 · Kosten PESSIMISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.04 |
| COMBINED · Test | 31 | -103.66 | -1.04 | 0.81 | 29.0 | 49.38 | -24.91 | -0.132 | 2.30 | -0.32 | 1.1 | 8 | 153.86 | 9.04 |
| PRICE_ONLY · Test | 1 | 50.77 | 0.51 | – | 100.0 | 50.77 | – | 2.031 | 0.19 | 0.60 | 0.0 | 0 | 3.44 | 9.04 |
| TREND_CORE · Test | 7 | -52.32 | -0.52 | 0.54 | 28.6 | 31.08 | -22.90 | -0.298 | 1.11 | -0.54 | 0.6 | 3 | 20.94 | 9.04 |
| TREND_CORE_3R · Test | 40 | -48.22 | -0.48 | 0.93 | 32.5 | 46.52 | -24.18 | -0.046 | 2.27 | -0.13 | 3.7 | 7 | 155.84 | 9.04 |

#### ETHUSDT · SPEC · Regime CRYPTO_NATIVE_V1 · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.11 |
| COMBINED · Test | 34 | -0.15 | -0.00 | 1.00 | 32.4 | 52.74 | -25.23 | 0.003 | 1.76 | 0.01 | 1.4 | 6 | 148.05 | 9.11 |
| PRICE_ONLY · Test | 3 | 88.53 | 0.89 | 7.15 | 66.7 | 51.46 | -14.40 | 1.179 | 0.22 | 0.77 | 0.1 | 1 | 9.76 | 9.11 |
| TREND_CORE · Test | 40 | -149.58 | -1.50 | 0.78 | 27.5 | 48.49 | -23.55 | -0.149 | 2.19 | -0.45 | 3.1 | 7 | 130.55 | 9.11 |
| TREND_CORE_3R · Test | 40 | -21.31 | -0.21 | 0.97 | 32.5 | 48.62 | -24.20 | -0.019 | 2.13 | -0.05 | 3.7 | 7 | 132.18 | 9.11 |

#### ETHUSDT · SPEC · Regime CRYPTO_ONLY · Kosten BOOTSTRAP

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 8.87 |
| COMBINED · Test | 12 | -60.74 | -0.61 | 0.72 | 25.0 | 53.07 | -24.44 | -0.201 | 1.38 | -0.38 | 0.8 | 5 | 65.03 | 8.87 |
| PRICE_ONLY · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 8.87 |
| TREND_CORE · Test | 2 | -14.73 | -0.15 | 0.41 | 50.0 | 10.27 | -25.00 | -0.294 | 0.67 | -0.26 | 0.5 | 1 | 6.12 | 8.87 |
| TREND_CORE_3R · Test | 37 | -248.38 | -2.48 | 0.62 | 24.3 | 44.64 | -23.22 | -0.270 | 3.93 | -0.87 | 3.1 | 12 | 194.93 | 8.87 |

#### ETHUSDT · SPEC · Regime CRYPTO_ONLY · Kosten PESSIMISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.04 |
| COMBINED · Test | 28 | -106.29 | -1.06 | 0.79 | 28.6 | 48.98 | -24.91 | -0.150 | 2.30 | -0.34 | 1.1 | 8 | 138.07 | 9.04 |
| PRICE_ONLY · Test | 1 | 50.77 | 0.51 | – | 100.0 | 50.77 | – | 2.031 | 0.19 | 0.60 | 0.0 | 0 | 3.44 | 9.04 |
| TREND_CORE · Test | 7 | -52.32 | -0.52 | 0.54 | 28.6 | 31.08 | -22.90 | -0.298 | 1.11 | -0.54 | 0.6 | 3 | 20.94 | 9.04 |
| TREND_CORE_3R · Test | 37 | -126.37 | -1.26 | 0.80 | 29.7 | 45.48 | -24.10 | -0.135 | 3.03 | -0.40 | 3.3 | 12 | 143.28 | 9.04 |

#### ETHUSDT · SPEC · Regime CRYPTO_ONLY · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.11 |
| COMBINED · Test | 31 | -8.19 | -0.08 | 0.98 | 32.3 | 52.36 | -25.32 | -0.008 | 1.84 | -0.02 | 1.2 | 7 | 136.26 | 9.11 |
| PRICE_ONLY · Test | 3 | 88.53 | 0.89 | 7.15 | 66.7 | 51.46 | -14.40 | 1.179 | 0.22 | 0.77 | 0.1 | 1 | 9.76 | 9.11 |
| TREND_CORE · Test | 37 | -235.01 | -2.35 | 0.64 | 24.3 | 46.88 | -23.46 | -0.255 | 3.03 | -0.77 | 2.8 | 12 | 120.01 | 9.11 |
| TREND_CORE_3R · Test | 37 | -104.17 | -1.04 | 0.83 | 29.7 | 47.53 | -24.11 | -0.111 | 2.94 | -0.32 | 3.3 | 12 | 121.51 | 9.11 |

#### Ablehnungsgründe und Beinahe-Treffer (BASELINE, REALISTIC)

### BTCUSDT · SPEC · Regime CRYPTO_NATIVE_V1

Zyklen 24416 · ungültig 0 · kein Kandidat 24416 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 19578, TREND_FILTER_4H_FAILED 1959, BREAKOUT_NOT_CONFIRMED 1554, TREND_FILTER_1D_FAILED 1133, RSI_OUT_OF_RANGE 125, ATR_RATIO_OUT_OF_RANGE 21, HIGHER_TIMEFRAME_4H_CONFLICT 20, RELATIVE_VOLUME_BELOW_MINIMUM 16
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 24340, HIGHER_TIMEFRAME_4H_CONFLICT 23784, HIGHER_TIMEFRAME_1D_CONFLICT 23624, SIGNAL_1H_DIRECTION_NOT_BULLISH 23516, BREAKOUT_NOT_CONFIRMED 23231, RELATIVE_VOLUME_BELOW_MINIMUM 19894, TREND_FILTER_1H_FAILED 19578, REGIME_NOT_RISK_ON 16977, TREND_FILTER_4H_FAILED 16651, TREND_FILTER_1D_FAILED 15552, RSI_OUT_OF_RANGE 14378, ATR_RATIO_OUT_OF_RANGE 8056
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 24416 | 0.095 | 0.274 | 52.1 | 52.1 |
| Echte Kandidaten | 0 | – | – | – | – |
| RSI_OUT_OF_RANGE | 2 | -3.385 | 0.910 | 0.0 | 50.0 |

### BTCUSDT · SPEC · Regime CRYPTO_ONLY

Zyklen 24416 · ungültig 0 · kein Kandidat 24416 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 19578, TREND_FILTER_4H_FAILED 1959, BREAKOUT_NOT_CONFIRMED 1554, TREND_FILTER_1D_FAILED 1133, RSI_OUT_OF_RANGE 125, ATR_RATIO_OUT_OF_RANGE 21, HIGHER_TIMEFRAME_4H_CONFLICT 20, RELATIVE_VOLUME_BELOW_MINIMUM 16
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 24340, HIGHER_TIMEFRAME_4H_CONFLICT 23784, HIGHER_TIMEFRAME_1D_CONFLICT 23624, SIGNAL_1H_DIRECTION_NOT_BULLISH 23516, BREAKOUT_NOT_CONFIRMED 23231, RELATIVE_VOLUME_BELOW_MINIMUM 19894, TREND_FILTER_1H_FAILED 19578, REGIME_NOT_RISK_ON 16761, TREND_FILTER_4H_FAILED 16651, TREND_FILTER_1D_FAILED 15552, RSI_OUT_OF_RANGE 14378, ATR_RATIO_OUT_OF_RANGE 8056
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 24416 | 0.095 | 0.274 | 52.1 | 52.1 |
| Echte Kandidaten | 0 | – | – | – | – |
| RSI_OUT_OF_RANGE | 2 | -3.385 | 0.910 | 0.0 | 50.0 |

### ETHUSDT · SPEC · Regime CRYPTO_NATIVE_V1

Zyklen 24416 · ungültig 0 · kein Kandidat 24416 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 19831, TREND_FILTER_4H_FAILED 1972, TREND_FILTER_1D_FAILED 1290, BREAKOUT_NOT_CONFIRMED 1172, RSI_OUT_OF_RANGE 88, HIGHER_TIMEFRAME_4H_CONFLICT 27, RELATIVE_VOLUME_BELOW_MINIMUM 22, HIGHER_TIMEFRAME_1D_CONFLICT 10
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 24364, HIGHER_TIMEFRAME_4H_CONFLICT 23748, HIGHER_TIMEFRAME_1D_CONFLICT 23600, SIGNAL_1H_DIRECTION_NOT_BULLISH 23597, BREAKOUT_NOT_CONFIRMED 23304, RELATIVE_VOLUME_BELOW_MINIMUM 19927, TREND_FILTER_1H_FAILED 19831, TREND_FILTER_1D_FAILED 17961, TREND_FILTER_4H_FAILED 17604, REGIME_NOT_RISK_ON 16977, RSI_OUT_OF_RANGE 14484, ATR_RATIO_OUT_OF_RANGE 2710
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 24416 | 0.069 | 0.207 | 51.6 | 52.0 |
| Echte Kandidaten | 0 | – | – | – | – |
| RSI_OUT_OF_RANGE | 2 | 0.525 | 5.718 | 50.0 | 100.0 |
| TREND_FILTER_1D_FAILED | 2 | 0.019 | -4.071 | 50.0 | 0.0 |

### ETHUSDT · SPEC · Regime CRYPTO_ONLY

Zyklen 24416 · ungültig 0 · kein Kandidat 24416 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 19831, TREND_FILTER_4H_FAILED 1972, TREND_FILTER_1D_FAILED 1290, BREAKOUT_NOT_CONFIRMED 1172, RSI_OUT_OF_RANGE 88, HIGHER_TIMEFRAME_4H_CONFLICT 27, RELATIVE_VOLUME_BELOW_MINIMUM 22, HIGHER_TIMEFRAME_1D_CONFLICT 10
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 24364, HIGHER_TIMEFRAME_4H_CONFLICT 23748, HIGHER_TIMEFRAME_1D_CONFLICT 23600, SIGNAL_1H_DIRECTION_NOT_BULLISH 23597, BREAKOUT_NOT_CONFIRMED 23304, RELATIVE_VOLUME_BELOW_MINIMUM 19927, TREND_FILTER_1H_FAILED 19831, TREND_FILTER_1D_FAILED 17961, TREND_FILTER_4H_FAILED 17604, REGIME_NOT_RISK_ON 16761, RSI_OUT_OF_RANGE 14484, ATR_RATIO_OUT_OF_RANGE 2710
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 24416 | 0.069 | 0.207 | 51.6 | 52.0 |
| Echte Kandidaten | 0 | – | – | – | – |
| TREND_FILTER_1D_FAILED | 3 | -0.378 | -3.218 | 33.3 | 0.0 |
| RSI_OUT_OF_RANGE | 2 | 0.525 | 5.718 | 50.0 | 100.0 |


### Shadow-Replay-Research (nur Testzeitraum, frisches Portfolio)

Datenquelle: /Users/juliuseggert/Dev/SignalPilot/data/market-snapshots/real · Split 2024-01-01T00:00:00.000Z (vorab festgelegt) · 20 Läufe

Kosten = Gebühren + Spread + Slippage (Quote-Währung). Buy & Hold mit einem Round-Trip derselben Kosten.

#### BTCUSDT · SIGNAL_EDGE · Regime CRYPTO_NATIVE_V1 · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.23 |
| COMBINED · Test | 31 | -138.39 | -1.38 | 0.77 | 29.0 | 50.20 | -26.83 | -0.177 | 3.12 | -0.42 | 1.8 | 6 | 150.77 | 96.23 |
| PRICE_ONLY · Test | 23 | -103.77 | -1.04 | 0.74 | 30.4 | 41.18 | -24.50 | -0.161 | 2.49 | -0.42 | 0.7 | 10 | 115.48 | 96.23 |
| TREND_CORE · Test | 61 | -118.22 | -1.18 | 0.88 | 31.1 | 46.98 | -24.07 | -0.076 | 3.66 | -0.28 | 5.9 | 8 | 210.76 | 96.23 |
| TREND_CORE_3R · Test | 57 | -13.74 | -0.14 | 0.99 | 29.8 | 55.55 | -23.95 | -0.007 | 3.05 | -0.02 | 6.2 | 9 | 197.35 | 96.23 |

#### BTCUSDT · SIGNAL_EDGE · Regime CRYPTO_ONLY · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 96.23 |
| COMBINED · Test | 28 | -378.03 | -3.78 | 0.37 | 17.9 | 43.69 | -25.93 | -0.548 | 3.78 | -1.38 | 1.5 | 6 | 132.46 | 96.23 |
| PRICE_ONLY · Test | 20 | -222.37 | -2.22 | 0.43 | 20.0 | 41.23 | -24.21 | -0.452 | 2.49 | -1.02 | 0.6 | 10 | 98.67 | 96.23 |
| TREND_CORE · Test | 51 | -201.12 | -2.01 | 0.77 | 29.4 | 44.48 | -24.12 | -0.157 | 2.90 | -0.52 | 4.8 | 9 | 174.04 | 96.23 |
| TREND_CORE_3R · Test | 47 | -57.65 | -0.58 | 0.93 | 29.8 | 52.77 | -24.13 | -0.047 | 2.56 | -0.12 | 4.9 | 9 | 161.27 | 96.23 |

#### ETHUSDT · SIGNAL_EDGE · Regime CRYPTO_NATIVE_V1 · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.11 |
| COMBINED · Test | 38 | -17.62 | -0.18 | 0.97 | 28.9 | 58.28 | -24.40 | -0.016 | 1.90 | -0.04 | 1.6 | 7 | 164.13 | 9.11 |
| PRICE_ONLY · Test | 22 | 64.74 | 0.65 | 1.20 | 36.4 | 48.06 | -22.84 | 0.119 | 1.41 | 0.25 | 0.8 | 5 | 98.22 | 9.11 |
| TREND_CORE · Test | 48 | -124.22 | -1.24 | 0.85 | 29.2 | 48.95 | -23.81 | -0.102 | 2.17 | -0.34 | 3.7 | 7 | 158.48 | 9.11 |
| TREND_CORE_3R · Test | 45 | 25.58 | 0.26 | 1.04 | 33.3 | 50.36 | -24.33 | 0.025 | 2.03 | 0.07 | 4.0 | 7 | 150.32 | 9.11 |

#### ETHUSDT · SIGNAL_EDGE · Regime CRYPTO_ONLY · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE · Test | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 9.11 |
| COMBINED · Test | 36 | -58.61 | -0.59 | 0.91 | 27.8 | 57.41 | -24.34 | -0.063 | 2.31 | -0.16 | 1.5 | 9 | 155.76 | 9.11 |
| PRICE_ONLY · Test | 21 | 8.93 | 0.09 | 1.03 | 33.3 | 46.91 | -22.82 | 0.019 | 1.41 | 0.04 | 0.7 | 5 | 94.34 | 9.11 |
| TREND_CORE · Test | 46 | -234.36 | -2.34 | 0.71 | 26.1 | 47.77 | -23.75 | -0.204 | 3.26 | -0.69 | 3.4 | 12 | 151.20 | 9.11 |
| TREND_CORE_3R · Test | 43 | -82.54 | -0.83 | 0.89 | 30.2 | 49.65 | -24.27 | -0.074 | 2.85 | -0.22 | 3.6 | 11 | 142.94 | 9.11 |

#### Ablehnungsgründe und Beinahe-Treffer (BASELINE, REALISTIC)

### BTCUSDT · SIGNAL_EDGE · Regime CRYPTO_NATIVE_V1

Zyklen 24416 · ungültig 0 · kein Kandidat 24416 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 19578, TREND_FILTER_4H_FAILED 1959, BREAKOUT_NOT_CONFIRMED 1554, TREND_FILTER_1D_FAILED 1133, RSI_OUT_OF_RANGE 125, ATR_RATIO_OUT_OF_RANGE 21, HIGHER_TIMEFRAME_4H_CONFLICT 20, RELATIVE_VOLUME_BELOW_MINIMUM 16
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 24340, HIGHER_TIMEFRAME_4H_CONFLICT 23784, HIGHER_TIMEFRAME_1D_CONFLICT 23624, SIGNAL_1H_DIRECTION_NOT_BULLISH 23516, BREAKOUT_NOT_CONFIRMED 23231, RELATIVE_VOLUME_BELOW_MINIMUM 19894, TREND_FILTER_1H_FAILED 19578, REGIME_NOT_RISK_ON 16977, TREND_FILTER_4H_FAILED 16651, TREND_FILTER_1D_FAILED 15552, RSI_OUT_OF_RANGE 14378, ATR_RATIO_OUT_OF_RANGE 8056
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 24416 | 0.095 | 0.274 | 52.1 | 52.1 |
| Echte Kandidaten | 0 | – | – | – | – |
| RSI_OUT_OF_RANGE | 2 | -3.385 | 0.910 | 0.0 | 50.0 |

### BTCUSDT · SIGNAL_EDGE · Regime CRYPTO_ONLY

Zyklen 24416 · ungültig 0 · kein Kandidat 24416 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 19578, TREND_FILTER_4H_FAILED 1959, BREAKOUT_NOT_CONFIRMED 1554, TREND_FILTER_1D_FAILED 1133, RSI_OUT_OF_RANGE 125, ATR_RATIO_OUT_OF_RANGE 21, HIGHER_TIMEFRAME_4H_CONFLICT 20, RELATIVE_VOLUME_BELOW_MINIMUM 16
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 24340, HIGHER_TIMEFRAME_4H_CONFLICT 23784, HIGHER_TIMEFRAME_1D_CONFLICT 23624, SIGNAL_1H_DIRECTION_NOT_BULLISH 23516, BREAKOUT_NOT_CONFIRMED 23231, RELATIVE_VOLUME_BELOW_MINIMUM 19894, TREND_FILTER_1H_FAILED 19578, REGIME_NOT_RISK_ON 16761, TREND_FILTER_4H_FAILED 16651, TREND_FILTER_1D_FAILED 15552, RSI_OUT_OF_RANGE 14378, ATR_RATIO_OUT_OF_RANGE 8056
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 24416 | 0.095 | 0.274 | 52.1 | 52.1 |
| Echte Kandidaten | 0 | – | – | – | – |
| RSI_OUT_OF_RANGE | 2 | -3.385 | 0.910 | 0.0 | 50.0 |

### ETHUSDT · SIGNAL_EDGE · Regime CRYPTO_NATIVE_V1

Zyklen 24416 · ungültig 0 · kein Kandidat 24416 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 19831, TREND_FILTER_4H_FAILED 1972, TREND_FILTER_1D_FAILED 1290, BREAKOUT_NOT_CONFIRMED 1172, RSI_OUT_OF_RANGE 88, HIGHER_TIMEFRAME_4H_CONFLICT 27, RELATIVE_VOLUME_BELOW_MINIMUM 22, HIGHER_TIMEFRAME_1D_CONFLICT 10
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 24364, HIGHER_TIMEFRAME_4H_CONFLICT 23748, HIGHER_TIMEFRAME_1D_CONFLICT 23600, SIGNAL_1H_DIRECTION_NOT_BULLISH 23597, BREAKOUT_NOT_CONFIRMED 23304, RELATIVE_VOLUME_BELOW_MINIMUM 19927, TREND_FILTER_1H_FAILED 19831, TREND_FILTER_1D_FAILED 17961, TREND_FILTER_4H_FAILED 17604, REGIME_NOT_RISK_ON 16977, RSI_OUT_OF_RANGE 14484, ATR_RATIO_OUT_OF_RANGE 2710
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 24416 | 0.069 | 0.207 | 51.6 | 52.0 |
| Echte Kandidaten | 0 | – | – | – | – |
| RSI_OUT_OF_RANGE | 2 | 0.525 | 5.718 | 50.0 | 100.0 |
| TREND_FILTER_1D_FAILED | 2 | 0.019 | -4.071 | 50.0 | 0.0 |

### ETHUSDT · SIGNAL_EDGE · Regime CRYPTO_ONLY

Zyklen 24416 · ungültig 0 · kein Kandidat 24416 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 19831, TREND_FILTER_4H_FAILED 1972, TREND_FILTER_1D_FAILED 1290, BREAKOUT_NOT_CONFIRMED 1172, RSI_OUT_OF_RANGE 88, HIGHER_TIMEFRAME_4H_CONFLICT 27, RELATIVE_VOLUME_BELOW_MINIMUM 22, HIGHER_TIMEFRAME_1D_CONFLICT 10
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 24364, HIGHER_TIMEFRAME_4H_CONFLICT 23748, HIGHER_TIMEFRAME_1D_CONFLICT 23600, SIGNAL_1H_DIRECTION_NOT_BULLISH 23597, BREAKOUT_NOT_CONFIRMED 23304, RELATIVE_VOLUME_BELOW_MINIMUM 19927, TREND_FILTER_1H_FAILED 19831, TREND_FILTER_1D_FAILED 17961, TREND_FILTER_4H_FAILED 17604, REGIME_NOT_RISK_ON 16761, RSI_OUT_OF_RANGE 14484, ATR_RATIO_OUT_OF_RANGE 2710
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 24416 | 0.069 | 0.207 | 51.6 | 52.0 |
| Echte Kandidaten | 0 | – | – | – | – |
| TREND_FILTER_1D_FAILED | 3 | -0.378 | -3.218 | 33.3 | 0.0 |
| RSI_OUT_OF_RANGE | 2 | 0.525 | 5.718 | 50.0 | 100.0 |

