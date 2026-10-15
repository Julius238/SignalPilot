# Vorregistrierung Evolution Engine V1 (2026-10-15)

Diese Datei legt Datenaufteilung, Kostenmodell, Suchraum, Prüfungen und
Schwellen der Evolution Engine V1 fest — **bevor** der erste
Forschungsdurchlauf auf echten Daten läuft. Sie wird mit dem Code committet
und danach nicht mehr geändert. Jede Änderung an einem Wert hier ist eine neue
Version (neuer Split- oder Gate-Schlüssel) und wird nie mit V1-Ergebnissen
vermischt.

Spezifikation: [20-evolution-engine.md](../20-evolution-engine.md), ADR
[0016](../decisions/0016-evolution-engine-isolated-research.md).

## Datenaufteilung `evolution-split-v1`

Hash `838ce3bfe2ee7740f053435c3300337a4a7b3c4fbd1cb0fbcfbba88388e22f00`
(`EVOLUTION_DATA_SPLIT_V1_HASH`, `packages/evolution/src/split.ts`).

| Fenster | Zeitraum (Anker, UTC) | Rolle | Was die KI sieht | Status |
|---|---|---|---|---|
| Entdeckung | 2018-04-01 – 2022-06-30 | Suche | Kennzahlen | In-Sample |
| Validierung | 2022-07-01 – 2023-12-31 | Auswahl | nur das Urteil (bestanden / Gate) | In-Sample |
| Holdout | 2024-01-01 – 2026-10-14 | Bestätigung der Finalisten | nichts | **bereits analysiert** |
| Forward | ab 2026-10-15 | — | wird nie geladen | nur Shadow-Forward-Tests / Arena |

Walk-Forward-Segmente: 2018 (ab April), 2019, 2020, 2021, 2022H1 (Entdeckung),
2022H2, 2023 (Validierung).

**Ehrliche Einordnung der Zeiträume.** Die Forschung vom 2026-10-14 hat
2018-03 – 2023-12 als Training (rund 30 Varianten × Regime-Konfigurationen)
und 2024-01 – 2026-10-14 einmal als Test verwendet; der Challenger
`CRYPTO_REGIME_LONG_V1` stützt sich auch auf die Regime-Studie des
Testzeitraums. Kein historischer Zeitraum ist deshalb unberührt:

- Der Holdout ist ausdrücklich `PREVIOUSLY_ANALYZED` und wird nie als
  unberührter Out-of-Sample-Beweis dargestellt.
- Die einzigen unbekannten Daten sind die ab dem offiziellen Forward-Test
  (2026-10-15). Der Snapshot-Lader verwirft jede Kerze ab diesem Zeitpunkt,
  unabhängig vom Dateiinhalt.
- Die 30 Trainingskonfigurationen der Vorforschung zählen als bereits
  getestete Konfigurationen in der Mehrfachtest-Schwelle.

## Kosten und Ausführung (nicht veränderbar)

`BINANCE_SPOT_VIP0_ESTIMATE_V1`: 10 bp Gebühr je Seite, 2 bp Spread, 3 bp
Slippage je Seite, maximale Teilnahme 1 % — identisch mit dem offiziellen
Forward-Test. Backtest = unveränderter historischer Shadow-Replay
(`shadow-replay-v1/1.3.0`), Modus `SPEC` (alle 26 Risk-Regeln), Regime
`CRYPTO_NATIVE_V1`, je Symbol ein eigenes Konto mit 10 000 USDT,
0,25 % Risiko je Trade. Kostenstress: alle Ausführungskosten ×2, analytisch
auf denselben Trades.

## Suchraum

Nur geschlossene Parametergenome zweier Familien, jeweils als
Research-Identität eines registrierten Evaluators (nie registriert, nie live):

- `BREAKOUT_LONG` (Familie des Champions `CRYPTO_TREND_CORE_LONG_V1`):
  Signalbestätigungen an/aus, Regime an/aus, Regime-Konfidenz 40–90 (5),
  Ausbruchsfenster 10–60 (5), relatives Volumen 0–2,5 (0,1), RSI-Band,
  ATR-Band, Stop-ATR 1–4 (0,25), Stop-Boden 0,75–4 % (0,25), Stop-Kappe
  2–10 % (1), Ziel 2,5–6 R (0,25), Zeit-Exit 24–336 h (24).
- `REGIME_LONG` (Familie des Challengers `CRYPTO_REGIME_LONG_V1`):
  Regime-Konfidenz 40–90 (5), Stop 1–4 × ATR(1d) (0,25), Ziel 2,5–10 R (0,5),
  Backstop 168–1440 h (24), Exit bei geschlossenem Gate an/aus.

Höchstens 3 Änderungen je Hypothese, genau eine Elternstrategie
(Generation-0-Wurzel oder ein Kandidat, der das Screening bestanden hat).
Kosten, Positionsgröße, Risk-Regeln, Datenzeiträume, Hebel, Short und
Derivate sind nicht Teil des Raums. Bereits getestete Genome werden verworfen.

Wurzel-Genome (Hash `evolution-genome-v1`):

| Wurzel | Genom-Hash |
|---|---|
| `ROOT:CRYPTO_TREND_CORE_LONG_V1` | `2c3f61546bd8bbd3a52e7a1f0cfb6acb4f5e47af77fee551eb7d8453c9b6cd97` |
| `ROOT:CRYPTO_REGIME_LONG_V1` | `81193e8c0f7aecbfc94f94797c6594e39344549af91dfe372bc4ea6ab15414bb` |

## Prüfungen `evolution-gates-v1`

Screening (Entdeckung + Validierung, BTC + ETH kombiniert):

| Prüfung | Bestanden, wenn |
|---|---|
| Technische Tests | zwei identische Läufe, keine Invariantenverletzung, gültige Entscheidungen |
| Datenintegrität | Daten-Fingerprint gleich, alle Anker im Fenster, keine Forward-Daten |
| Stichprobe | ≥ 20 Trades Entdeckung und ≥ 6 Trades Validierung |
| Vorteil Entdeckung | Ø R ≥ +0,05 und Profit Factor ≥ 1,15 nach Kosten |
| Vorteil Validierung | Ø R > 0 und Profit Factor ≥ 1,0 |
| Doppelte Kosten | Netto-PnL > 0 bei ×2 Gebühren, Spread und Slippage |
| Drawdown | max. Drawdown ≤ 10 % |
| Marktphasen | ≥ 50 % der Segmente mit ≥ 2 Trades positiv, keine Phase > 65 % des Gewinns |
| Eigenständigkeit | Korrelation der Tagesrenditen mit Champion und Challenger ≤ 0,9 |
| Gegen Champion | Sharpe höher als der Champion — oder Sharpe > 0 und Korrelation < 0,5 |

Finale (höchstens 2 Finalisten je Durchlauf, Auswahl nach Forschungs-Score):

| Prüfung | Bestanden, wenn |
|---|---|
| Nachbarvarianten | 2 Varianten je ein Rasterschritt daneben bleiben bei Ø R > 0 |
| Walk-Forward | rollierende Auswahl aus Kandidat + Nachbarn: außerhalb der Stichprobe Ø R > 0 und Effizienz ≥ 0,25 |
| Holdout | ≥ 5 Trades, Ø R > 0, Profit Factor ≥ 1,0 (bereits analysierter Zeitraum) |

Evidenzgrad nach Mehrfachtest: t-Wert des Ø R gegen √(2·ln N), N = 30
Vorforschungs-Konfigurationen + alle bisher in Entdeckung/Validierung
geprüften Kandidaten und Nachbarn. Stark ≥ Schwelle + 1, mittel ≥ Schwelle,
schwach ≥ 1. Der Grad ist Information, kein zusätzliches Gate.

Forschungs-Score (0–100, neutral 50): Ø R Validierung 20, Ø R Entdeckung 10,
Sharpe 20, Ø R bei doppelten Kosten 15, positive Marktphasen 15, Drawdown 10,
Stichprobe 5, Diversifikation 5; −2 Punkte je geändertem Parameter jenseits
von zwei gegenüber der Wurzel.

## Was ein Vorschlag bedeutet

Ein vorgeschlagener Kandidat hat einen historischen Test bestanden, mehr
nicht. Er bekommt erst nach ausdrücklicher Freigabe durch den Betreiber,
Registrierung als eigene StrategyVersion und einen **eigenen**
Shadow-Forward-Test in einem eigenen Portfolio die Chance, sich auf
unbekannten Daten zu beweisen. Über seine Leistung entscheidet die Arena.
