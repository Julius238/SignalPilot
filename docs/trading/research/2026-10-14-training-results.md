# Trainingsergebnisse (2018-03 → 2023-12, vor Öffnung des Testzeitraums)

Erzeugt mit `shadowReplayResearch` (RESEARCH_PHASE=TRAINING), `shadowRegimeStudy` und `shadowConditionStudy` am 2026-10-14. Vorregistrierung: [2026-10-14-preregistration.md](2026-10-14-preregistration.md).

### Regime-Studie (2018-03-26 → 2024-01-01, nur vor 2024-01-01T00:00:00.000Z)

2108 Tage. Gate = Einstiegsbedingung von LONG_V1: cryptoRegime RISK_ON, Risk Mode nicht DEFENSIVE/HIGH_RISK/UNKNOWN, Konfidenz ≥ 60. AS_SPECIFIED nutzt S&P 500 und Nasdaq-100 (FRED) als SPY/QQQ-Proxy; IWM fehlt.

### BTCUSDT

| Filter | Tage offen | Ø 7d % | Ø 14d % | Ø 30d % | positiv 14d % | Gesamtrendite % | CAGR % | Max. DD % | Sharpe | Zeit im Markt % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Buy & Hold (immer offen) | 2108 | 1.03 | 2.16 | 4.74 | 54.2 | 399.2 | 32.1 | 76.6 | 0.76 | 100.0 |
| Gate AS_SPECIFIED | 602 | 1.99 | 3.41 | 7.33 | 57.5 | 662.2 | 42.2 | 41.5 | 1.15 | 28.5 |
| Gate CRYPTO_ONLY | 731 | 1.93 | 3.67 | 8.00 | 59.1 | 755.4 | 45.0 | 48.5 | 1.14 | 34.6 |
| Gate CRYPTO_NATIVE_V1 | 631 | 2.64 | 5.04 | 10.61 | 59.8 | 951.2 | 50.3 | 38.0 | 1.30 | 29.9 |
| AS_SPECIFIED gesperrt trotz Krypto RISK_ON (Aktien-Veto) | 129 | 1.64 | 4.84 | 10.98 | 66.7 | 12.2 | 2.0 | 26.2 | 0.21 | 6.1 |
| Krypto RISK_ON (Produktionsregel, ohne Aktien) | 731 | 1.93 | 3.67 | 8.00 | 59.1 | 755.4 | 45.0 | 48.5 | 1.14 | 34.6 |

### ETHUSDT

| Filter | Tage offen | Ø 7d % | Ø 14d % | Ø 30d % | positiv 14d % | Gesamtrendite % | CAGR % | Max. DD % | Sharpe | Zeit im Markt % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Buy & Hold (immer offen) | 2108 | 1.33 | 2.81 | 6.18 | 53.1 | 335.7 | 29.0 | 89.8 | 0.74 | 100.0 |
| Gate AS_SPECIFIED | 602 | 3.26 | 5.79 | 12.13 | 62.4 | 1685.9 | 64.8 | 28.3 | 1.35 | 28.5 |
| Gate CRYPTO_ONLY | 731 | 2.79 | 5.47 | 11.73 | 62.6 | 1380.2 | 59.5 | 44.5 | 1.21 | 34.6 |
| Gate CRYPTO_NATIVE_V1 | 631 | 3.26 | 6.90 | 14.60 | 64.5 | 1235.7 | 56.7 | 30.0 | 1.25 | 29.9 |
| AS_SPECIFIED gesperrt trotz Krypto RISK_ON (Aktien-Veto) | 129 | 0.61 | 3.98 | 9.93 | 63.6 | -17.1 | -3.2 | 38.2 | -0.08 | 6.1 |
| Krypto RISK_ON (Produktionsregel, ohne Aktien) | 731 | 2.79 | 5.47 | 11.73 | 62.6 | 1380.2 | 59.5 | 44.5 | 1.21 | 34.6 |


### Bedingungs-Studie BTCUSDT (Regime CRYPTO_NATIVE_V1, nur vor 2024-01-01T00:00:00.000Z)

Forward-Rendite ab Eröffnung der Folgestunde, ohne Kosten. Spread = Ø Rendite (erfüllt) − Ø Rendite (verfehlt).

| Bedingung | erfüllt Std. | Anteil erfüllt % | Ø 24h erfüllt % | Ø 24h verfehlt % | Spread 24h | Ø 72h erfüllt % | Ø 72h verfehlt % | Spread 72h | positiv 72h erfüllt % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ATR_1H | 32314 | 79.6 | 0.099 | 0.148 | -0.048 | 0.280 | 0.449 | -0.169 | 51.6 |
| BREAKOUT_PRIOR_HIGH | 1627 | 4.0 | 0.255 | 0.103 | 0.152 | 0.624 | 0.302 | 0.322 | 51.8 |
| CANDIDATE_VALIDITY | 40585 | 100.0 | 0.109 | – | – | 0.315 | – | – | 52.1 |
| CONTEXT_EVENTS | 40585 | 100.0 | 0.109 | – | – | 0.315 | – | – | 52.1 |
| HIGHER_TIMEFRAME_1D | 700 | 1.7 | 0.520 | 0.102 | 0.418 | 1.359 | 0.296 | 1.063 | 70.6 |
| HIGHER_TIMEFRAME_4H | 940 | 2.3 | 0.471 | 0.101 | 0.370 | 0.759 | 0.304 | 0.455 | 51.6 |
| MTF_ALIGNMENT | 32 | 0.1 | 0.990 | 0.108 | 0.881 | 1.060 | 0.314 | 0.746 | 84.4 |
| PRICE_TICK_ALIGNMENT | 40585 | 100.0 | 0.109 | – | – | 0.315 | – | – | 52.1 |
| REGIME | 11489 | 28.3 | 0.298 | 0.035 | 0.263 | 0.830 | 0.111 | 0.720 | 55.0 |
| RELATIVE_VOLUME_1H | 6194 | 15.3 | 0.178 | 0.097 | 0.081 | 0.372 | 0.304 | 0.068 | 52.5 |
| REWARD_RISK | 40585 | 100.0 | 0.109 | – | – | 0.315 | – | – | 52.1 |
| RSI_1H | 16525 | 40.7 | 0.053 | 0.148 | -0.095 | 0.299 | 0.325 | -0.027 | 50.8 |
| SIGNAL_1H | 571 | 1.4 | 0.475 | 0.104 | 0.371 | 0.959 | 0.305 | 0.654 | 54.3 |
| STOP_DISTANCE_BASIS | 40585 | 100.0 | 0.109 | – | – | 0.315 | – | – | 52.1 |
| STOP_DISTANCE_CAP | 38551 | 95.0 | 0.076 | 0.745 | -0.670 | 0.279 | 0.989 | -0.710 | 51.9 |
| STOP_PRICE | 40585 | 100.0 | 0.109 | – | – | 0.315 | – | – | 52.1 |
| TREND_1D | 11886 | 29.3 | 0.317 | 0.023 | 0.293 | 0.915 | 0.066 | 0.849 | 55.4 |
| TREND_1H | 7825 | 19.3 | 0.166 | 0.096 | 0.070 | 0.579 | 0.251 | 0.327 | 50.5 |
| TREND_4H | 12625 | 31.1 | 0.250 | 0.046 | 0.204 | 0.600 | 0.186 | 0.415 | 53.7 |

### Bedingungs-Studie ETHUSDT (Regime CRYPTO_NATIVE_V1, nur vor 2024-01-01T00:00:00.000Z)

Forward-Rendite ab Eröffnung der Folgestunde, ohne Kosten. Spread = Ø Rendite (erfüllt) − Ø Rendite (verfehlt).

| Bedingung | erfüllt Std. | Anteil erfüllt % | Ø 24h erfüllt % | Ø 24h verfehlt % | Spread 24h | Ø 72h erfüllt % | Ø 72h verfehlt % | Spread 72h | positiv 72h erfüllt % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ATR_1H | 36200 | 89.2 | 0.154 | 0.243 | -0.089 | 0.515 | 0.565 | -0.050 | 52.5 |
| BREAKOUT_PRIOR_HIGH | 1781 | 4.4 | 0.254 | 0.159 | 0.094 | 0.880 | 0.504 | 0.376 | 53.5 |
| CANDIDATE_VALIDITY | 40585 | 100.0 | 0.164 | – | – | 0.520 | – | – | 52.3 |
| CONTEXT_EVENTS | 40585 | 100.0 | 0.164 | – | – | 0.520 | – | – | 52.3 |
| HIGHER_TIMEFRAME_1D | 777 | 1.9 | 1.648 | 0.135 | 1.514 | 1.663 | 0.498 | 1.165 | 57.8 |
| HIGHER_TIMEFRAME_4H | 972 | 2.4 | 0.805 | 0.148 | 0.657 | 1.896 | 0.486 | 1.410 | 61.6 |
| MTF_ALIGNMENT | 39 | 0.1 | 0.939 | 0.163 | 0.776 | 1.739 | 0.519 | 1.220 | 71.8 |
| PRICE_TICK_ALIGNMENT | 40585 | 100.0 | 0.164 | – | – | 0.520 | – | – | 52.3 |
| REGIME | 11489 | 28.3 | 0.421 | 0.062 | 0.359 | 1.319 | 0.205 | 1.114 | 55.5 |
| RELATIVE_VOLUME_1H | 6562 | 16.2 | 0.217 | 0.153 | 0.064 | 0.560 | 0.512 | 0.047 | 52.5 |
| REWARD_RISK | 40585 | 100.0 | 0.164 | – | – | 0.520 | – | – | 52.3 |
| RSI_1H | 16143 | 39.8 | 0.147 | 0.174 | -0.027 | 0.514 | 0.524 | -0.009 | 51.5 |
| SIGNAL_1H | 633 | 1.6 | 0.502 | 0.158 | 0.344 | 1.116 | 0.511 | 0.605 | 54.0 |
| STOP_DISTANCE_BASIS | 40585 | 100.0 | 0.164 | – | – | 0.520 | – | – | 52.3 |
| STOP_DISTANCE_CAP | 36387 | 89.7 | 0.122 | 0.522 | -0.400 | 0.469 | 0.962 | -0.492 | 52.0 |
| STOP_PRICE | 40585 | 100.0 | 0.164 | – | – | 0.520 | – | – | 52.3 |
| TREND_1D | 12673 | 31.2 | 0.362 | 0.073 | 0.289 | 1.140 | 0.239 | 0.901 | 53.4 |
| TREND_1H | 7963 | 19.6 | 0.418 | 0.102 | 0.316 | 1.077 | 0.384 | 0.693 | 52.7 |
| TREND_4H | 12799 | 31.5 | 0.427 | 0.042 | 0.384 | 1.264 | 0.177 | 1.087 | 53.7 |

### Shadow-Replay-Research (nur Trainingszeitraum)

Datenquelle: /Users/juliuseggert/Dev/SignalPilot/data/market-snapshots/real · Split 2024-01-01T00:00:00.000Z (vorab festgelegt) · 120 Läufe

Kosten = Gebühren + Spread + Slippage (Quote-Währung). Buy & Hold mit einem Round-Trip derselben Kosten.

### BTCUSDT · SIGNAL_EDGE · Regime AS_SPECIFIED · Kosten BOOTSTRAP

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.37 |
| COMBINED | 40 | 368.63 | 3.69 | 1.74 | 47.5 | 45.45 | -23.57 | 0.365 | 1.37 | 0.67 | 0.9 | 4 | 281.70 | 265.37 |
| NO_HTF_SIGNALS | 19 | -45.41 | -0.45 | 0.83 | 36.8 | 31.58 | -22.21 | -0.094 | 1.32 | -0.14 | 0.3 | 5 | 142.08 | 265.37 |
| NO_REGIME | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.37 |
| PRICE_ONLY | 23 | 47.68 | 0.48 | 1.16 | 43.5 | 34.10 | -22.56 | 0.084 | 1.32 | 0.15 | 0.4 | 5 | 170.07 | 265.37 |
| RELAXED_ENTRY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.37 |
| TP_3R | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.37 |
| TREND_CORE | 68 | 42.02 | 0.42 | 1.04 | 35.3 | 43.60 | -22.83 | 0.027 | 2.87 | 0.07 | 2.8 | 5 | 360.01 | 265.37 |
| TREND_CORE_3R | 65 | 194.66 | 1.95 | 1.20 | 35.4 | 51.65 | -23.65 | 0.121 | 2.24 | 0.28 | 2.7 | 5 | 349.53 | 265.37 |
| WIDE_STOP | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.37 |

### BTCUSDT · SIGNAL_EDGE · Regime AS_SPECIFIED · Kosten PESSIMISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.96 |
| COMBINED | 40 | 508.59 | 5.09 | 2.03 | 50.0 | 50.17 | -24.74 | 0.499 | 1.42 | 0.82 | 0.9 | 4 | 212.11 | 265.96 |
| NO_HTF_SIGNALS | 19 | 1.22 | 0.01 | 1.00 | 42.1 | 32.82 | -23.76 | 0.003 | 1.31 | 0.01 | 0.3 | 5 | 105.98 | 265.96 |
| NO_REGIME | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.96 |
| PRICE_ONLY | 23 | 112.68 | 1.13 | 1.39 | 47.8 | 36.47 | -24.04 | 0.196 | 1.31 | 0.31 | 0.4 | 5 | 126.95 | 265.96 |
| RELAXED_ENTRY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.96 |
| TP_3R | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.96 |
| TREND_CORE | 68 | 171.86 | 1.72 | 1.17 | 35.3 | 49.00 | -22.82 | 0.103 | 2.64 | 0.27 | 2.8 | 5 | 264.42 | 265.96 |
| TREND_CORE_3R | 65 | 331.40 | 3.31 | 1.33 | 35.4 | 57.68 | -23.69 | 0.204 | 2.07 | 0.43 | 2.7 | 5 | 256.93 | 265.96 |
| WIDE_STOP | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.96 |

### BTCUSDT · SIGNAL_EDGE · Regime AS_SPECIFIED · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 266.18 |
| COMBINED | 40 | 569.27 | 5.69 | 2.15 | 50.0 | 53.23 | -24.77 | 0.557 | 1.44 | 0.87 | 0.9 | 4 | 182.04 | 266.18 |
| NO_HTF_SIGNALS | 19 | 22.21 | 0.22 | 1.09 | 42.1 | 35.01 | -23.44 | 0.045 | 1.30 | 0.07 | 0.3 | 5 | 89.99 | 266.18 |
| NO_REGIME | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 266.18 |
| PRICE_ONLY | 23 | 141.53 | 1.42 | 1.50 | 47.8 | 38.80 | -23.77 | 0.244 | 1.30 | 0.37 | 0.4 | 5 | 107.96 | 266.18 |
| RELAXED_ENTRY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 266.18 |
| TP_3R | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 266.18 |
| TREND_CORE | 68 | 226.09 | 2.26 | 1.23 | 35.3 | 51.25 | -22.82 | 0.134 | 2.56 | 0.34 | 2.8 | 5 | 224.52 | 266.18 |
| TREND_CORE_3R | 65 | 388.55 | 3.89 | 1.39 | 35.4 | 60.19 | -23.71 | 0.238 | 2.00 | 0.49 | 2.7 | 5 | 218.22 | 266.18 |
| WIDE_STOP | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 266.18 |

### BTCUSDT · SPEC · Regime AS_SPECIFIED · Kosten BOOTSTRAP

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.37 |
| COMBINED | 14 | -34.55 | -0.35 | 0.86 | 28.6 | 53.41 | -24.82 | -0.096 | 1.98 | -0.09 | 0.4 | 7 | 76.38 | 265.37 |
| NO_HTF_SIGNALS | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.37 |
| NO_REGIME | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.37 |
| PRICE_ONLY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.37 |
| RELAXED_ENTRY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.37 |
| TP_3R | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.37 |
| TREND_CORE | 6 | -52.15 | -0.52 | 0.50 | 16.7 | 51.19 | -20.67 | -0.347 | 0.83 | -0.36 | 0.1 | 4 | 18.86 | 265.37 |
| TREND_CORE_3R | 55 | 118.10 | 1.18 | 1.14 | 36.4 | 48.02 | -24.07 | 0.088 | 1.81 | 0.19 | 2.4 | 5 | 292.27 | 265.37 |
| WIDE_STOP | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.37 |

### BTCUSDT · SPEC · Regime AS_SPECIFIED · Kosten PESSIMISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.96 |
| COMBINED | 30 | 287.01 | 2.87 | 1.74 | 46.7 | 48.25 | -24.28 | 0.380 | 1.17 | 0.56 | 0.7 | 4 | 146.62 | 265.96 |
| NO_HTF_SIGNALS | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.96 |
| NO_REGIME | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.96 |
| PRICE_ONLY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.96 |
| RELAXED_ENTRY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.96 |
| TP_3R | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.96 |
| TREND_CORE | 17 | -66.57 | -0.67 | 0.76 | 29.4 | 42.39 | -23.21 | -0.155 | 1.46 | -0.29 | 0.4 | 3 | 50.74 | 265.96 |
| TREND_CORE_3R | 55 | 229.77 | 2.30 | 1.27 | 36.4 | 53.70 | -24.12 | 0.168 | 1.53 | 0.33 | 2.4 | 5 | 214.50 | 265.96 |
| WIDE_STOP | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.96 |

### BTCUSDT · SPEC · Regime AS_SPECIFIED · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 266.18 |
| COMBINED | 38 | 622.31 | 6.22 | 2.40 | 52.6 | 53.35 | -24.71 | 0.639 | 1.19 | 0.96 | 0.8 | 3 | 173.12 | 266.18 |
| NO_HTF_SIGNALS | 1 | 50.11 | 0.50 | – | 100.0 | 50.11 | – | 2.005 | 0.12 | 0.41 | 0.0 | 0 | 3.61 | 266.18 |
| NO_REGIME | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 266.18 |
| PRICE_ONLY | 1 | 50.11 | 0.50 | – | 100.0 | 50.11 | – | 2.005 | 0.12 | 0.41 | 0.0 | 0 | 3.61 | 266.18 |
| RELAXED_ENTRY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 266.18 |
| TP_3R | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 266.18 |
| TREND_CORE | 60 | 140.09 | 1.40 | 1.16 | 35.0 | 48.87 | -22.72 | 0.095 | 2.19 | 0.23 | 2.4 | 5 | 196.16 | 266.18 |
| TREND_CORE_3R | 55 | 276.39 | 2.76 | 1.33 | 36.4 | 56.07 | -24.15 | 0.201 | 1.54 | 0.39 | 2.4 | 5 | 182.07 | 266.18 |
| WIDE_STOP | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 266.18 |

### ETHUSDT · SIGNAL_EDGE · Regime AS_SPECIFIED · Kosten BOOTSTRAP

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 161.98 |
| COMBINED | 48 | -175.81 | -1.76 | 0.79 | 27.1 | 49.87 | -23.55 | -0.146 | 2.81 | -0.32 | 1.0 | 7 | 279.90 | 161.98 |
| NO_HTF_SIGNALS | 26 | 31.57 | 0.32 | 1.08 | 38.5 | 40.91 | -23.59 | 0.050 | 1.12 | 0.09 | 0.5 | 4 | 157.41 | 161.98 |
| NO_REGIME | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 161.98 |
| PRICE_ONLY | 29 | -43.41 | -0.43 | 0.90 | 34.5 | 40.74 | -23.73 | -0.058 | 1.50 | -0.10 | 0.6 | 4 | 176.12 | 161.98 |
| RELAXED_ENTRY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 161.98 |
| TP_3R | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 161.98 |
| TREND_CORE | 79 | -315.16 | -3.15 | 0.76 | 29.1 | 44.11 | -23.75 | -0.160 | 3.90 | -0.46 | 2.2 | 6 | 394.91 | 161.98 |
| TREND_CORE_3R | 76 | -285.02 | -2.85 | 0.79 | 26.3 | 52.20 | -23.73 | -0.150 | 3.37 | -0.39 | 2.4 | 7 | 375.18 | 161.98 |
| WIDE_STOP | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 161.98 |

### ETHUSDT · SIGNAL_EDGE · Regime AS_SPECIFIED · Kosten PESSIMISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.40 |
| COMBINED | 48 | -87.37 | -0.87 | 0.89 | 27.1 | 56.71 | -23.56 | -0.071 | 2.38 | -0.14 | 1.0 | 7 | 207.66 | 162.40 |
| NO_HTF_SIGNALS | 26 | 91.50 | 0.92 | 1.24 | 38.5 | 46.83 | -23.55 | 0.145 | 1.04 | 0.23 | 0.5 | 4 | 116.60 | 162.40 |
| NO_REGIME | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.40 |
| PRICE_ONLY | 29 | 16.10 | 0.16 | 1.04 | 34.5 | 46.65 | -23.70 | 0.027 | 1.20 | 0.04 | 0.6 | 4 | 130.70 | 162.40 |
| RELAXED_ENTRY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.40 |
| TP_3R | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.40 |
| TREND_CORE | 79 | -202.21 | -2.02 | 0.85 | 29.1 | 49.24 | -23.84 | -0.101 | 3.28 | -0.27 | 2.2 | 6 | 289.56 | 162.40 |
| TREND_CORE_3R | 76 | -170.68 | -1.71 | 0.87 | 26.3 | 58.16 | -23.82 | -0.088 | 2.89 | -0.21 | 2.4 | 7 | 274.80 | 162.40 |
| WIDE_STOP | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.40 |

### ETHUSDT · SIGNAL_EDGE · Regime AS_SPECIFIED · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.56 |
| COMBINED | 48 | -49.74 | -0.50 | 0.94 | 27.1 | 59.62 | -23.57 | -0.039 | 2.35 | -0.08 | 1.0 | 7 | 177.08 | 162.56 |
| NO_HTF_SIGNALS | 26 | 116.42 | 1.16 | 1.31 | 38.5 | 49.19 | -23.47 | 0.186 | 1.04 | 0.28 | 0.5 | 4 | 98.99 | 162.56 |
| NO_REGIME | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.56 |
| PRICE_ONLY | 29 | 41.30 | 0.41 | 1.09 | 34.5 | 48.99 | -23.61 | 0.063 | 1.12 | 0.09 | 0.6 | 4 | 110.91 | 162.56 |
| RELAXED_ENTRY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.56 |
| TP_3R | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.56 |
| TREND_CORE | 79 | -155.20 | -1.55 | 0.88 | 29.1 | 51.38 | -23.87 | -0.077 | 3.02 | -0.20 | 2.2 | 6 | 245.65 | 162.56 |
| TREND_CORE_3R | 76 | -122.96 | -1.23 | 0.91 | 26.3 | 60.65 | -23.86 | -0.062 | 2.80 | -0.15 | 2.4 | 7 | 233.08 | 162.56 |
| WIDE_STOP | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.56 |

### ETHUSDT · SPEC · Regime AS_SPECIFIED · Kosten BOOTSTRAP

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 161.98 |
| COMBINED | 30 | -161.66 | -1.62 | 0.70 | 23.3 | 53.37 | -23.27 | -0.215 | 2.72 | -0.36 | 0.7 | 9 | 153.03 | 161.98 |
| NO_HTF_SIGNALS | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 161.98 |
| NO_REGIME | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 161.98 |
| PRICE_ONLY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 161.98 |
| RELAXED_ENTRY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 161.98 |
| TP_3R | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 161.98 |
| TREND_CORE | 7 | -71.15 | -0.71 | 0.43 | 14.3 | 53.28 | -20.74 | -0.406 | 0.95 | -0.31 | 0.3 | 4 | 22.11 | 161.98 |
| TREND_CORE_3R | 67 | -135.05 | -1.35 | 0.88 | 28.4 | 53.39 | -23.95 | -0.079 | 2.37 | -0.19 | 1.9 | 7 | 329.99 | 161.98 |
| WIDE_STOP | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 161.98 |

### ETHUSDT · SPEC · Regime AS_SPECIFIED · Kosten PESSIMISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.40 |
| COMBINED | 42 | -22.22 | -0.22 | 0.97 | 28.6 | 57.03 | -23.55 | -0.019 | 2.10 | -0.03 | 0.8 | 6 | 176.82 | 162.40 |
| NO_HTF_SIGNALS | 5 | -121.00 | -1.21 | 0.00 | 0.0 | – | -24.20 | -0.973 | 1.29 | -0.93 | 0.1 | 5 | 14.34 | 162.40 |
| NO_REGIME | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.40 |
| PRICE_ONLY | 6 | -145.70 | -1.46 | 0.00 | 0.0 | – | -24.28 | -0.977 | 1.53 | -1.01 | 0.1 | 6 | 17.45 | 162.40 |
| RELAXED_ENTRY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.40 |
| TP_3R | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.40 |
| TREND_CORE | 24 | -263.04 | -2.63 | 0.44 | 16.7 | 51.45 | -23.44 | -0.442 | 2.67 | -0.82 | 0.5 | 7 | 67.76 | 162.40 |
| TREND_CORE_3R | 67 | -24.39 | -0.24 | 0.98 | 28.4 | 59.43 | -24.03 | -0.012 | 2.16 | -0.03 | 1.9 | 7 | 241.45 | 162.40 |
| WIDE_STOP | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.40 |

### ETHUSDT · SPEC · Regime AS_SPECIFIED · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.56 |
| COMBINED | 45 | 18.64 | 0.19 | 1.02 | 28.9 | 59.51 | -23.60 | 0.019 | 2.11 | 0.04 | 0.9 | 6 | 166.51 | 162.56 |
| NO_HTF_SIGNALS | 11 | -98.10 | -0.98 | 0.51 | 18.2 | 50.84 | -22.20 | -0.357 | 1.85 | -0.42 | 0.3 | 8 | 31.95 | 162.56 |
| NO_REGIME | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.56 |
| PRICE_ONLY | 11 | -98.11 | -0.98 | 0.51 | 18.2 | 50.84 | -22.20 | -0.357 | 1.85 | -0.43 | 0.3 | 8 | 31.31 | 162.56 |
| RELAXED_ENTRY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.56 |
| TP_3R | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.56 |
| TREND_CORE | 69 | 23.19 | 0.23 | 1.02 | 31.9 | 51.77 | -23.74 | 0.016 | 1.92 | 0.04 | 2.1 | 6 | 213.27 | 162.56 |
| TREND_CORE_3R | 67 | 21.74 | 0.22 | 1.02 | 28.4 | 61.95 | -24.07 | 0.016 | 2.07 | 0.04 | 1.9 | 7 | 204.73 | 162.56 |
| WIDE_STOP | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.56 |

### Ablehnungsgründe und Beinahe-Treffer (BASELINE, REALISTIC)

### BTCUSDT · SIGNAL_EDGE · Regime AS_SPECIFIED

Zyklen 50985 · ungültig 10328 · kein Kandidat 40657 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 32832, CANDLE_SERIES_GAP 8187, TREND_FILTER_4H_FAILED 2736, TREND_FILTER_1D_FAILED 2445, BREAKOUT_NOT_CONFIRMED 2378, DATA_QUALITY_INSUFFICIENT 2141, RSI_OUT_OF_RANGE 184, HIGHER_TIMEFRAME_4H_CONFLICT 36
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 40613, HIGHER_TIMEFRAME_1D_CONFLICT 39957, HIGHER_TIMEFRAME_4H_CONFLICT 39717, SIGNAL_1H_DIRECTION_NOT_BULLISH 39503, BREAKOUT_NOT_CONFIRMED 39025, RELATIVE_VOLUME_BELOW_MINIMUM 34451, TREND_FILTER_1H_FAILED 32832, TREND_FILTER_1D_FAILED 28699, TREND_FILTER_4H_FAILED 28032, REGIME_NOT_RISK_ON 26902, RSI_OUT_OF_RANGE 24093, DATA_QUALITY_INSUFFICIENT 12245
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 50985 | 0.126 | 0.383 | 51.7 | 52.4 |
| Echte Kandidaten | 0 | – | – | – | – |
| RSI_OUT_OF_RANGE | 2 | 3.363 | 3.273 | 100.0 | 100.0 |

### BTCUSDT · SPEC · Regime AS_SPECIFIED

Zyklen 50985 · ungültig 10328 · kein Kandidat 40657 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 32832, CANDLE_SERIES_GAP 8187, TREND_FILTER_4H_FAILED 2736, TREND_FILTER_1D_FAILED 2445, BREAKOUT_NOT_CONFIRMED 2378, DATA_QUALITY_INSUFFICIENT 2141, RSI_OUT_OF_RANGE 184, HIGHER_TIMEFRAME_4H_CONFLICT 36
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 40613, HIGHER_TIMEFRAME_1D_CONFLICT 39957, HIGHER_TIMEFRAME_4H_CONFLICT 39717, SIGNAL_1H_DIRECTION_NOT_BULLISH 39503, BREAKOUT_NOT_CONFIRMED 39025, RELATIVE_VOLUME_BELOW_MINIMUM 34451, TREND_FILTER_1H_FAILED 32832, TREND_FILTER_1D_FAILED 28699, TREND_FILTER_4H_FAILED 28032, REGIME_NOT_RISK_ON 26902, RSI_OUT_OF_RANGE 24093, DATA_QUALITY_INSUFFICIENT 12245
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 50985 | 0.126 | 0.383 | 51.7 | 52.4 |
| Echte Kandidaten | 0 | – | – | – | – |
| RSI_OUT_OF_RANGE | 2 | 3.363 | 3.273 | 100.0 | 100.0 |

### ETHUSDT · SIGNAL_EDGE · Regime AS_SPECIFIED

Zyklen 50985 · ungültig 10328 · kein Kandidat 40657 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 32694, CANDLE_SERIES_GAP 8187, TREND_FILTER_4H_FAILED 2979, BREAKOUT_NOT_CONFIRMED 2501, TREND_FILTER_1D_FAILED 2181, DATA_QUALITY_INSUFFICIENT 2141, RSI_OUT_OF_RANGE 188, HIGHER_TIMEFRAME_4H_CONFLICT 56
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 40593, HIGHER_TIMEFRAME_1D_CONFLICT 39880, HIGHER_TIMEFRAME_4H_CONFLICT 39685, SIGNAL_1H_DIRECTION_NOT_BULLISH 39387, BREAKOUT_NOT_CONFIRMED 38875, RELATIVE_VOLUME_BELOW_MINIMUM 34088, TREND_FILTER_1H_FAILED 32694, TREND_FILTER_1D_FAILED 27912, TREND_FILTER_4H_FAILED 27823, REGIME_NOT_RISK_ON 26902, RSI_OUT_OF_RANGE 24486, DATA_QUALITY_INSUFFICIENT 12245
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 50985 | 0.151 | 0.459 | 51.1 | 51.9 |
| Echte Kandidaten | 0 | – | – | – | – |

### ETHUSDT · SPEC · Regime AS_SPECIFIED

Zyklen 50985 · ungültig 10328 · kein Kandidat 40657 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 32694, CANDLE_SERIES_GAP 8187, TREND_FILTER_4H_FAILED 2979, BREAKOUT_NOT_CONFIRMED 2501, TREND_FILTER_1D_FAILED 2181, DATA_QUALITY_INSUFFICIENT 2141, RSI_OUT_OF_RANGE 188, HIGHER_TIMEFRAME_4H_CONFLICT 56
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 40593, HIGHER_TIMEFRAME_1D_CONFLICT 39880, HIGHER_TIMEFRAME_4H_CONFLICT 39685, SIGNAL_1H_DIRECTION_NOT_BULLISH 39387, BREAKOUT_NOT_CONFIRMED 38875, RELATIVE_VOLUME_BELOW_MINIMUM 34088, TREND_FILTER_1H_FAILED 32694, TREND_FILTER_1D_FAILED 27912, TREND_FILTER_4H_FAILED 27823, REGIME_NOT_RISK_ON 26902, RSI_OUT_OF_RANGE 24486, DATA_QUALITY_INSUFFICIENT 12245
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 50985 | 0.151 | 0.459 | 51.1 | 51.9 |
| Echte Kandidaten | 0 | – | – | – | – |


### Shadow-Replay-Research (nur Trainingszeitraum)

Datenquelle: /Users/juliuseggert/Dev/SignalPilot/data/market-snapshots/real · Split 2024-01-01T00:00:00.000Z (vorab festgelegt) · 60 Läufe

Kosten = Gebühren + Spread + Slippage (Quote-Währung). Buy & Hold mit einem Round-Trip derselben Kosten.

### BTCUSDT · SPEC · Regime CRYPTO_NATIVE_V1 · Kosten BOOTSTRAP

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.37 |
| COMBINED | 19 | -9.23 | -0.09 | 0.97 | 31.6 | 53.21 | -25.27 | -0.017 | 1.98 | -0.02 | 0.4 | 7 | 105.52 | 265.37 |
| PRICE_ONLY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.37 |
| TREND_CORE | 6 | -56.83 | -0.57 | 0.47 | 16.7 | 51.16 | -21.60 | -0.378 | 0.87 | -0.38 | 0.1 | 4 | 19.24 | 265.37 |
| TREND_CORE_3R | 73 | 250.25 | 2.50 | 1.22 | 37.0 | 51.00 | -24.50 | 0.138 | 3.19 | 0.32 | 2.8 | 7 | 397.47 | 265.37 |

### BTCUSDT · SPEC · Regime CRYPTO_NATIVE_V1 · Kosten PESSIMISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.96 |
| COMBINED | 38 | 249.48 | 2.49 | 1.46 | 42.1 | 49.36 | -24.56 | 0.262 | 1.37 | 0.43 | 0.8 | 4 | 185.50 | 265.96 |
| PRICE_ONLY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.96 |
| TREND_CORE | 20 | -68.89 | -0.69 | 0.79 | 30.0 | 44.11 | -23.83 | -0.136 | 1.75 | -0.26 | 0.4 | 4 | 59.89 | 265.96 |
| TREND_CORE_3R | 73 | 406.76 | 4.07 | 1.36 | 37.0 | 57.03 | -24.63 | 0.222 | 2.95 | 0.47 | 2.8 | 7 | 292.64 | 265.96 |

### BTCUSDT · SPEC · Regime CRYPTO_NATIVE_V1 · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 266.18 |
| COMBINED | 47 | 388.25 | 3.88 | 1.58 | 42.6 | 53.06 | -24.93 | 0.327 | 1.85 | 0.57 | 0.9 | 6 | 212.91 | 266.18 |
| PRICE_ONLY | 2 | 100.63 | 1.01 | – | 100.0 | 50.31 | – | 2.008 | 0.15 | 0.59 | 0.1 | 0 | 7.20 | 266.18 |
| TREND_CORE | 75 | 141.96 | 1.42 | 1.12 | 34.7 | 49.58 | -23.41 | 0.078 | 3.49 | 0.20 | 2.9 | 7 | 249.25 | 266.18 |
| TREND_CORE_3R | 73 | 472.25 | 4.72 | 1.42 | 37.0 | 59.55 | -24.69 | 0.256 | 2.86 | 0.52 | 2.8 | 7 | 248.73 | 266.18 |

### BTCUSDT · SPEC · Regime CRYPTO_ONLY · Kosten BOOTSTRAP

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.37 |
| COMBINED | 17 | -36.64 | -0.37 | 0.88 | 29.4 | 53.24 | -25.24 | -0.084 | 1.98 | -0.09 | 0.4 | 7 | 93.75 | 265.37 |
| PRICE_ONLY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.37 |
| TREND_CORE | 6 | -56.83 | -0.57 | 0.47 | 16.7 | 51.16 | -21.60 | -0.378 | 0.87 | -0.38 | 0.1 | 4 | 19.24 | 265.37 |
| TREND_CORE_3R | 63 | -3.60 | -0.04 | 1.00 | 33.3 | 48.14 | -24.15 | 0.000 | 2.70 | 0.00 | 2.6 | 6 | 334.09 | 265.37 |

### BTCUSDT · SPEC · Regime CRYPTO_ONLY · Kosten PESSIMISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.96 |
| COMBINED | 36 | 295.91 | 2.96 | 1.60 | 44.4 | 49.43 | -24.75 | 0.327 | 1.18 | 0.53 | 0.8 | 4 | 174.23 | 265.96 |
| PRICE_ONLY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 265.96 |
| TREND_CORE | 18 | -96.10 | -0.96 | 0.69 | 27.8 | 42.30 | -23.66 | -0.213 | 1.75 | -0.40 | 0.4 | 4 | 52.92 | 265.96 |
| TREND_CORE_3R | 63 | 112.98 | 1.13 | 1.11 | 33.3 | 53.84 | -24.23 | 0.074 | 2.36 | 0.16 | 2.6 | 6 | 245.34 | 265.96 |

### BTCUSDT · SPEC · Regime CRYPTO_ONLY · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 266.18 |
| COMBINED | 43 | 458.66 | 4.59 | 1.76 | 46.5 | 53.13 | -26.26 | 0.421 | 1.70 | 0.68 | 0.9 | 5 | 193.96 | 266.18 |
| PRICE_ONLY | 2 | 100.63 | 1.01 | – | 100.0 | 50.31 | – | 2.008 | 0.15 | 0.59 | 0.1 | 0 | 7.20 | 266.18 |
| TREND_CORE | 67 | -31.97 | -0.32 | 0.97 | 31.3 | 48.46 | -22.82 | -0.017 | 2.90 | -0.04 | 2.6 | 6 | 216.87 | 266.18 |
| TREND_CORE_3R | 63 | 161.71 | 1.62 | 1.16 | 33.3 | 56.23 | -24.26 | 0.105 | 2.23 | 0.21 | 2.6 | 6 | 208.30 | 266.18 |

### ETHUSDT · SPEC · Regime CRYPTO_NATIVE_V1 · Kosten BOOTSTRAP

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 161.98 |
| COMBINED | 35 | -204.06 | -2.04 | 0.68 | 22.9 | 54.22 | -23.62 | -0.233 | 4.22 | -0.40 | 0.8 | 17 | 177.86 | 161.98 |
| PRICE_ONLY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 161.98 |
| TREND_CORE | 10 | -68.87 | -0.69 | 0.61 | 20.0 | 52.76 | -21.80 | -0.275 | 0.95 | -0.25 | 0.3 | 4 | 31.46 | 161.98 |
| TREND_CORE_3R | 78 | -245.38 | -2.45 | 0.82 | 26.9 | 53.36 | -23.96 | -0.125 | 4.23 | -0.33 | 2.1 | 8 | 382.03 | 161.98 |

### ETHUSDT · SPEC · Regime CRYPTO_NATIVE_V1 · Kosten PESSIMISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.40 |
| COMBINED | 45 | -244.07 | -2.44 | 0.70 | 22.2 | 58.24 | -23.61 | -0.217 | 5.26 | -0.41 | 0.9 | 21 | 183.29 | 162.40 |
| PRICE_ONLY | 7 | -96.34 | -0.96 | 0.34 | 14.3 | 49.49 | -24.31 | -0.551 | 1.29 | -0.59 | 0.1 | 5 | 21.05 | 162.40 |
| TREND_CORE | 30 | -177.64 | -1.78 | 0.67 | 23.3 | 52.00 | -23.55 | -0.237 | 2.38 | -0.48 | 0.7 | 7 | 83.79 | 162.40 |
| TREND_CORE_3R | 78 | -127.32 | -1.27 | 0.91 | 26.9 | 59.26 | -24.07 | -0.063 | 3.66 | -0.16 | 2.1 | 8 | 279.81 | 162.40 |

### ETHUSDT · SPEC · Regime CRYPTO_NATIVE_V1 · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.56 |
| COMBINED | 49 | -227.33 | -2.27 | 0.75 | 22.4 | 60.82 | -23.59 | -0.185 | 4.97 | -0.36 | 1.1 | 21 | 175.42 | 162.56 |
| PRICE_ONLY | 13 | -72.13 | -0.72 | 0.68 | 23.1 | 51.19 | -22.57 | -0.221 | 2.09 | -0.27 | 0.3 | 9 | 38.04 | 162.56 |
| TREND_CORE | 81 | -179.07 | -1.79 | 0.87 | 28.4 | 51.85 | -23.65 | -0.087 | 3.74 | -0.23 | 2.1 | 8 | 246.41 | 162.56 |
| TREND_CORE_3R | 78 | -78.22 | -0.78 | 0.94 | 26.9 | 61.73 | -24.11 | -0.037 | 3.43 | -0.09 | 2.1 | 8 | 237.31 | 162.56 |

### ETHUSDT · SPEC · Regime CRYPTO_ONLY · Kosten BOOTSTRAP

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 161.98 |
| COMBINED | 35 | -206.11 | -2.06 | 0.67 | 22.9 | 52.83 | -23.29 | -0.236 | 3.16 | -0.43 | 0.8 | 11 | 179.30 | 161.98 |
| PRICE_ONLY | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 161.98 |
| TREND_CORE | 9 | -43.99 | -0.44 | 0.71 | 22.2 | 52.89 | -21.40 | -0.194 | 0.95 | -0.16 | 0.3 | 4 | 28.27 | 161.98 |
| TREND_CORE_3R | 72 | -107.77 | -1.08 | 0.91 | 29.2 | 53.25 | -24.04 | -0.058 | 2.57 | -0.15 | 2.2 | 7 | 353.91 | 161.98 |

### ETHUSDT · SPEC · Regime CRYPTO_ONLY · Kosten PESSIMISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.40 |
| COMBINED | 43 | -125.73 | -1.26 | 0.83 | 25.6 | 56.98 | -23.52 | -0.115 | 2.93 | -0.23 | 0.8 | 6 | 179.99 | 162.40 |
| PRICE_ONLY | 7 | -96.34 | -0.96 | 0.34 | 14.3 | 49.49 | -24.31 | -0.551 | 1.29 | -0.59 | 0.1 | 5 | 21.05 | 162.40 |
| TREND_CORE | 28 | -204.07 | -2.04 | 0.60 | 21.4 | 51.90 | -23.43 | -0.293 | 2.38 | -0.56 | 0.6 | 7 | 78.59 | 162.40 |
| TREND_CORE_3R | 72 | 11.76 | 0.12 | 1.01 | 29.2 | 59.19 | -24.14 | 0.009 | 2.36 | 0.02 | 2.2 | 7 | 259.08 | 162.40 |

### ETHUSDT · SPEC · Regime CRYPTO_ONLY · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.56 |
| COMBINED | 46 | -87.97 | -0.88 | 0.89 | 26.1 | 59.38 | -23.54 | -0.074 | 2.59 | -0.14 | 0.9 | 6 | 169.07 | 162.56 |
| PRICE_ONLY | 12 | -122.86 | -1.23 | 0.45 | 16.7 | 50.84 | -22.45 | -0.410 | 2.09 | -0.52 | 0.3 | 9 | 34.58 | 162.56 |
| TREND_CORE | 75 | 34.93 | 0.35 | 1.03 | 32.0 | 52.12 | -23.84 | 0.021 | 2.07 | 0.05 | 2.2 | 5 | 231.22 | 162.56 |
| TREND_CORE_3R | 72 | 61.55 | 0.62 | 1.05 | 29.2 | 61.67 | -24.19 | 0.037 | 2.27 | 0.09 | 2.2 | 7 | 219.70 | 162.56 |

### Ablehnungsgründe und Beinahe-Treffer (BASELINE, REALISTIC)

### BTCUSDT · SPEC · Regime CRYPTO_NATIVE_V1

Zyklen 50985 · ungültig 10328 · kein Kandidat 40657 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 32832, CANDLE_SERIES_GAP 8187, TREND_FILTER_4H_FAILED 2736, TREND_FILTER_1D_FAILED 2445, BREAKOUT_NOT_CONFIRMED 2378, DATA_QUALITY_INSUFFICIENT 2141, RSI_OUT_OF_RANGE 184, HIGHER_TIMEFRAME_4H_CONFLICT 36
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 40613, HIGHER_TIMEFRAME_1D_CONFLICT 39957, HIGHER_TIMEFRAME_4H_CONFLICT 39717, SIGNAL_1H_DIRECTION_NOT_BULLISH 39503, BREAKOUT_NOT_CONFIRMED 39025, RELATIVE_VOLUME_BELOW_MINIMUM 34451, TREND_FILTER_1H_FAILED 32832, REGIME_NOT_RISK_ON 29167, TREND_FILTER_1D_FAILED 28699, TREND_FILTER_4H_FAILED 28032, RSI_OUT_OF_RANGE 24093, DATA_QUALITY_INSUFFICIENT 12245
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 50985 | 0.126 | 0.383 | 51.7 | 52.4 |
| Echte Kandidaten | 0 | – | – | – | – |
| RSI_OUT_OF_RANGE | 2 | 3.363 | 3.273 | 100.0 | 100.0 |

### BTCUSDT · SPEC · Regime CRYPTO_ONLY

Zyklen 50985 · ungültig 10328 · kein Kandidat 40657 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 32832, CANDLE_SERIES_GAP 8187, TREND_FILTER_4H_FAILED 2736, TREND_FILTER_1D_FAILED 2445, BREAKOUT_NOT_CONFIRMED 2378, DATA_QUALITY_INSUFFICIENT 2141, RSI_OUT_OF_RANGE 184, HIGHER_TIMEFRAME_4H_CONFLICT 36
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 40613, HIGHER_TIMEFRAME_1D_CONFLICT 39957, HIGHER_TIMEFRAME_4H_CONFLICT 39717, SIGNAL_1H_DIRECTION_NOT_BULLISH 39503, BREAKOUT_NOT_CONFIRMED 39025, RELATIVE_VOLUME_BELOW_MINIMUM 34451, TREND_FILTER_1H_FAILED 32832, TREND_FILTER_1D_FAILED 28699, TREND_FILTER_4H_FAILED 28032, REGIME_NOT_RISK_ON 26902, RSI_OUT_OF_RANGE 24093, DATA_QUALITY_INSUFFICIENT 12245
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 50985 | 0.126 | 0.383 | 51.7 | 52.4 |
| Echte Kandidaten | 0 | – | – | – | – |
| RSI_OUT_OF_RANGE | 2 | 3.363 | 3.273 | 100.0 | 100.0 |

### ETHUSDT · SPEC · Regime CRYPTO_NATIVE_V1

Zyklen 50985 · ungültig 10328 · kein Kandidat 40657 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 32694, CANDLE_SERIES_GAP 8187, TREND_FILTER_4H_FAILED 2979, BREAKOUT_NOT_CONFIRMED 2501, TREND_FILTER_1D_FAILED 2181, DATA_QUALITY_INSUFFICIENT 2141, RSI_OUT_OF_RANGE 188, HIGHER_TIMEFRAME_4H_CONFLICT 57
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 40593, HIGHER_TIMEFRAME_1D_CONFLICT 39880, HIGHER_TIMEFRAME_4H_CONFLICT 39685, SIGNAL_1H_DIRECTION_NOT_BULLISH 39387, BREAKOUT_NOT_CONFIRMED 38875, RELATIVE_VOLUME_BELOW_MINIMUM 34088, TREND_FILTER_1H_FAILED 32694, REGIME_NOT_RISK_ON 29167, TREND_FILTER_1D_FAILED 27912, TREND_FILTER_4H_FAILED 27823, RSI_OUT_OF_RANGE 24486, DATA_QUALITY_INSUFFICIENT 12245
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 50985 | 0.151 | 0.459 | 51.1 | 51.9 |
| Echte Kandidaten | 0 | – | – | – | – |

### ETHUSDT · SPEC · Regime CRYPTO_ONLY

Zyklen 50985 · ungültig 10328 · kein Kandidat 40657 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 32694, CANDLE_SERIES_GAP 8187, TREND_FILTER_4H_FAILED 2979, BREAKOUT_NOT_CONFIRMED 2501, TREND_FILTER_1D_FAILED 2181, DATA_QUALITY_INSUFFICIENT 2141, RSI_OUT_OF_RANGE 188, HIGHER_TIMEFRAME_4H_CONFLICT 56
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 40593, HIGHER_TIMEFRAME_1D_CONFLICT 39880, HIGHER_TIMEFRAME_4H_CONFLICT 39685, SIGNAL_1H_DIRECTION_NOT_BULLISH 39387, BREAKOUT_NOT_CONFIRMED 38875, RELATIVE_VOLUME_BELOW_MINIMUM 34088, TREND_FILTER_1H_FAILED 32694, TREND_FILTER_1D_FAILED 27912, TREND_FILTER_4H_FAILED 27823, REGIME_NOT_RISK_ON 26902, RSI_OUT_OF_RANGE 24486, DATA_QUALITY_INSUFFICIENT 12245
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 50985 | 0.151 | 0.459 | 51.1 | 51.9 |
| Echte Kandidaten | 0 | – | – | – | – |


### Shadow-Replay-Research (nur Trainingszeitraum)

Datenquelle: /Users/juliuseggert/Dev/SignalPilot/data/market-snapshots/real · Split 2024-01-01T00:00:00.000Z (vorab festgelegt) · 20 Läufe

Kosten = Gebühren + Spread + Slippage (Quote-Währung). Buy & Hold mit einem Round-Trip derselben Kosten.

### BTCUSDT · SIGNAL_EDGE · Regime CRYPTO_NATIVE_V1 · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 266.18 |
| COMBINED | 53 | 403.09 | 4.03 | 1.51 | 41.5 | 53.90 | -25.25 | 0.302 | 2.18 | 0.57 | 1.1 | 8 | 240.16 | 266.18 |
| PRICE_ONLY | 33 | -31.78 | -0.32 | 0.94 | 36.4 | 39.63 | -24.16 | -0.047 | 2.50 | -0.07 | 0.6 | 10 | 151.08 | 266.18 |
| TREND_CORE | 87 | 67.39 | 0.67 | 1.05 | 32.2 | 51.67 | -23.38 | 0.033 | 4.50 | 0.10 | 3.4 | 10 | 288.71 | 266.18 |
| TREND_CORE_3R | 82 | 387.66 | 3.88 | 1.29 | 34.1 | 61.47 | -24.69 | 0.189 | 3.91 | 0.43 | 3.3 | 9 | 278.83 | 266.18 |

### BTCUSDT · SIGNAL_EDGE · Regime CRYPTO_ONLY · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 266.18 |
| COMBINED | 47 | 438.69 | 4.39 | 1.64 | 44.7 | 53.53 | -26.37 | 0.369 | 1.69 | 0.64 | 1.0 | 6 | 211.83 | 266.18 |
| PRICE_ONLY | 30 | 9.15 | 0.09 | 1.02 | 40.0 | 39.71 | -25.96 | 0.012 | 2.04 | 0.02 | 0.5 | 8 | 137.61 | 266.18 |
| TREND_CORE | 78 | 41.77 | 0.42 | 1.03 | 32.1 | 50.86 | -23.20 | 0.024 | 3.60 | 0.06 | 3.0 | 8 | 255.79 | 266.18 |
| TREND_CORE_3R | 74 | 225.12 | 2.25 | 1.19 | 32.4 | 59.95 | -24.27 | 0.123 | 3.01 | 0.28 | 2.9 | 8 | 246.86 | 266.18 |

### ETHUSDT · SIGNAL_EDGE · Regime CRYPTO_NATIVE_V1 · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.56 |
| COMBINED | 57 | -171.59 | -1.72 | 0.83 | 24.6 | 60.28 | -23.62 | -0.119 | 4.05 | -0.24 | 1.2 | 11 | 209.50 | 162.56 |
| PRICE_ONLY | 33 | -51.76 | -0.52 | 0.90 | 30.3 | 49.18 | -23.63 | -0.060 | 2.08 | -0.10 | 0.6 | 7 | 128.15 | 162.56 |
| TREND_CORE | 93 | -324.42 | -3.24 | 0.80 | 26.9 | 51.77 | -23.80 | -0.140 | 5.29 | -0.40 | 2.6 | 10 | 284.57 | 162.56 |
| TREND_CORE_3R | 90 | -270.58 | -2.71 | 0.83 | 24.4 | 61.43 | -23.85 | -0.119 | 4.79 | -0.31 | 2.9 | 10 | 272.72 | 162.56 |

### ETHUSDT · SIGNAL_EDGE · Regime CRYPTO_ONLY · Kosten REALISTIC

| Lauf | Trades | Netto-PnL | Rendite % | PF | Treffer % | Ø Gewinn | Ø Verlust | Ø R | Max. DD % | Sharpe | Zeit im Markt % | Verlustserie | Kosten | Buy & Hold % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BASELINE | 0 | 0.00 | 0.00 | – | – | – | – | – | 0.00 | – | 0.0 | 0 | 0.00 | 162.56 |
| COMBINED | 51 | -117.39 | -1.17 | 0.87 | 25.5 | 59.48 | -23.44 | -0.090 | 2.77 | -0.18 | 1.1 | 8 | 186.60 | 162.56 |
| PRICE_ONLY | 31 | -8.82 | -0.09 | 0.98 | 32.3 | 48.92 | -23.72 | -0.005 | 1.61 | -0.02 | 0.6 | 4 | 117.88 | 162.56 |
| TREND_CORE | 84 | -191.14 | -1.91 | 0.87 | 28.6 | 51.67 | -23.85 | -0.090 | 3.68 | -0.24 | 2.4 | 6 | 259.02 | 162.56 |
| TREND_CORE_3R | 81 | -147.72 | -1.48 | 0.90 | 25.9 | 61.14 | -23.86 | -0.071 | 3.07 | -0.17 | 2.6 | 7 | 246.66 | 162.56 |

### Ablehnungsgründe und Beinahe-Treffer (BASELINE, REALISTIC)

### BTCUSDT · SIGNAL_EDGE · Regime CRYPTO_NATIVE_V1

Zyklen 50985 · ungültig 10328 · kein Kandidat 40657 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 32832, CANDLE_SERIES_GAP 8187, TREND_FILTER_4H_FAILED 2736, TREND_FILTER_1D_FAILED 2445, BREAKOUT_NOT_CONFIRMED 2378, DATA_QUALITY_INSUFFICIENT 2141, RSI_OUT_OF_RANGE 184, HIGHER_TIMEFRAME_4H_CONFLICT 36
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 40613, HIGHER_TIMEFRAME_1D_CONFLICT 39957, HIGHER_TIMEFRAME_4H_CONFLICT 39717, SIGNAL_1H_DIRECTION_NOT_BULLISH 39503, BREAKOUT_NOT_CONFIRMED 39025, RELATIVE_VOLUME_BELOW_MINIMUM 34451, TREND_FILTER_1H_FAILED 32832, REGIME_NOT_RISK_ON 29167, TREND_FILTER_1D_FAILED 28699, TREND_FILTER_4H_FAILED 28032, RSI_OUT_OF_RANGE 24093, DATA_QUALITY_INSUFFICIENT 12245
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 50985 | 0.126 | 0.383 | 51.7 | 52.4 |
| Echte Kandidaten | 0 | – | – | – | – |
| RSI_OUT_OF_RANGE | 2 | 3.363 | 3.273 | 100.0 | 100.0 |

### BTCUSDT · SIGNAL_EDGE · Regime CRYPTO_ONLY

Zyklen 50985 · ungültig 10328 · kein Kandidat 40657 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 32832, CANDLE_SERIES_GAP 8187, TREND_FILTER_4H_FAILED 2736, TREND_FILTER_1D_FAILED 2445, BREAKOUT_NOT_CONFIRMED 2378, DATA_QUALITY_INSUFFICIENT 2141, RSI_OUT_OF_RANGE 184, HIGHER_TIMEFRAME_4H_CONFLICT 36
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 40613, HIGHER_TIMEFRAME_1D_CONFLICT 39957, HIGHER_TIMEFRAME_4H_CONFLICT 39717, SIGNAL_1H_DIRECTION_NOT_BULLISH 39503, BREAKOUT_NOT_CONFIRMED 39025, RELATIVE_VOLUME_BELOW_MINIMUM 34451, TREND_FILTER_1H_FAILED 32832, TREND_FILTER_1D_FAILED 28699, TREND_FILTER_4H_FAILED 28032, REGIME_NOT_RISK_ON 26902, RSI_OUT_OF_RANGE 24093, DATA_QUALITY_INSUFFICIENT 12245
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 50985 | 0.126 | 0.383 | 51.7 | 52.4 |
| Echte Kandidaten | 0 | – | – | – | – |
| RSI_OUT_OF_RANGE | 2 | 3.363 | 3.273 | 100.0 | 100.0 |

### ETHUSDT · SIGNAL_EDGE · Regime CRYPTO_NATIVE_V1

Zyklen 50985 · ungültig 10328 · kein Kandidat 40657 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 32694, CANDLE_SERIES_GAP 8187, TREND_FILTER_4H_FAILED 2979, BREAKOUT_NOT_CONFIRMED 2501, TREND_FILTER_1D_FAILED 2181, DATA_QUALITY_INSUFFICIENT 2141, RSI_OUT_OF_RANGE 188, HIGHER_TIMEFRAME_4H_CONFLICT 57
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 40593, HIGHER_TIMEFRAME_1D_CONFLICT 39880, HIGHER_TIMEFRAME_4H_CONFLICT 39685, SIGNAL_1H_DIRECTION_NOT_BULLISH 39387, BREAKOUT_NOT_CONFIRMED 38875, RELATIVE_VOLUME_BELOW_MINIMUM 34088, TREND_FILTER_1H_FAILED 32694, REGIME_NOT_RISK_ON 29167, TREND_FILTER_1D_FAILED 27912, TREND_FILTER_4H_FAILED 27823, RSI_OUT_OF_RANGE 24486, DATA_QUALITY_INSUFFICIENT 12245
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 50985 | 0.151 | 0.459 | 51.1 | 51.9 |
| Echte Kandidaten | 0 | – | – | – | – |

### ETHUSDT · SIGNAL_EDGE · Regime CRYPTO_ONLY

Zyklen 50985 · ungültig 10328 · kein Kandidat 40657 · Kandidaten 0 · Risk-OK 0 · Risk-abgelehnt 0 · Fills 0 · verfallen 0

- Erster Ablehnungsgrund: TREND_FILTER_1H_FAILED 32694, CANDLE_SERIES_GAP 8187, TREND_FILTER_4H_FAILED 2979, BREAKOUT_NOT_CONFIRMED 2501, TREND_FILTER_1D_FAILED 2181, DATA_QUALITY_INSUFFICIENT 2141, RSI_OUT_OF_RANGE 188, HIGHER_TIMEFRAME_4H_CONFLICT 56
- Alle verfehlten Bedingungen: MTF_NOT_BULLISH_ALIGNED 40593, HIGHER_TIMEFRAME_1D_CONFLICT 39880, HIGHER_TIMEFRAME_4H_CONFLICT 39685, SIGNAL_1H_DIRECTION_NOT_BULLISH 39387, BREAKOUT_NOT_CONFIRMED 38875, RELATIVE_VOLUME_BELOW_MINIMUM 34088, TREND_FILTER_1H_FAILED 32694, TREND_FILTER_1D_FAILED 27912, TREND_FILTER_4H_FAILED 27823, REGIME_NOT_RISK_ON 26902, RSI_OUT_OF_RANGE 24486, DATA_QUALITY_INSUFFICIENT 12245
- Risk-Ablehnungen: –

| Beinahe-Treffer (genau 1 verfehlte Bedingung) | Stunden | Ø Rendite 24h % | Ø Rendite 72h % | positiv 24h % | positiv 72h % |
|---|---:|---:|---:|---:|---:|
| Alle Stunden (Basis) | 50985 | 0.151 | 0.459 | 51.1 | 51.9 |
| Echte Kandidaten | 0 | – | – | – | – |


