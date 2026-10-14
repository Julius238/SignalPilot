# Forward-Test CRYPTO_TREND_CORE_LONG_V1 (Champion)

Echter Shadow-Forward-Test auf unbekannten Live-Marktdaten (Binance Spot,
BTCUSDT). Alles nach dem Startzeitpunkt sind Forward-Daten, die beim Entwurf
der Strategie nicht bekannt waren. Kein Echtgeldhandel.

## Startzeitpunkt

**2026-10-14T13:59:19.759Z** — Aktivierung der Session
(`SESSION_ACTIVATED`, Audit-Event `cmv86esj70001itykupihtlgm`), in derselben
Sekunde Start des Trading-Workers (`de.jul1us.signalpilot-trading-worker`).
Die BTC-Zuweisung wurde um 2026-10-14T13:58:44.922Z aktiviert
(`STRATEGY_ASSIGNMENT_ENABLED`, `cmv86e1na0000ituouch2p0wu`).

Ausgewertet wird jede `TradeCandidate`/`ShadowPosition` der unten genannten
StrategyVersion mit `createdAt` ≥ Startzeitpunkt.

## Eingefrorene Konfiguration

| | |
|---|---|
| Strategie | `CRYPTO_TREND_CORE_LONG_V1`, StrategyVersion `cmv86cr4e000aitrktpz6ioh0` (v1) |
| Engine / Spezifikation | `crypto-mtf-breakout-v1/1.2.0`, Hash `8bb3bb93798b2adc8ee33b64181b99d49961385e0bb733f611689322eca6c7dd` |
| Regime | `crypto-native-regime-v1/1.0.0` (`MarketRegimeSnapshot.reportJson.cryptoNative`) |
| Zuweisung | BTCUSDT, 1h, `cmv86cr4f000citrkmvqshcpd`; ETH und LONG_V1 deaktiviert |
| Portfolio | `SHADOW_V1` (`cmssq3g6s000106dvosc5cz6f`), Startkapital 10 000 USDT |
| Risk | RiskLimitSet `SHADOW_V1` v1 (`ff9ab296…`), Regelwerk `risk-rules-v1/1.2.0`, 0,25 % Risiko je Trade |
| Kosten | InstrumentExecutionProfile BTCUSDT v2 (`cmv86cx7t0002its9urai7gi8`), siehe unten |
| Build bei Start | `400ed95` (Branch `claude/inspiring-noether-rjh92d`) |
| Daten | Binance Spot über den laufenden Daten-Worker (`de.jul1us.signalpilot-worker`), kein synthetischer Feed |

## Execution-Kosten

Profil `BINANCE_SPOT_VIP0_ESTIMATE_V1` (`shadowExecutionProfileCalibrate`):

| | Annahme | Begründung | Gemessen am 2026-10-14 (Binance-Orderbuch BTCUSDT) |
|---|---:|---|---|
| Gebühr | 10 bp je Seite | Spot-Taker-Gebühr der Basisstufe VIP 0 ohne BNB-Rabatt (mit BNB 7,5 bp) — die höchste reguläre Gebühr | — |
| Spread (voll) | 2 bp | Puffer; BTCUSDT handelt praktisch immer mit einem Tick (0,01 USDT) Spread | 0,0012 bp |
| Slippage | 3 bp je Seite | Puffer für die Zeit zwischen Entscheidung und Fill; die Shadow-Orders (≈ 400–1 500 USDT) liegen weit unter der Top-of-Book-Tiefe | 0 bp bei 1 500 und 25 000 USDT (Top-Ask-Tiefe 97 000–495 000 USDT) |

Der Fill-Preis liegt damit je Seite 4 bp (halber Spread + Slippage) über bzw.
unter dem Referenzpreis, plus 10 bp Gebühr. Das ist exakt das
REALISTIC-Profil, unter dem die Strategie den vorregistrierten Test bestand.
Der frühere Platzhalter `MANUAL_CONSERVATIVE_V1` (10/10/10 bp) ist `RETIRED`.

## Regeln während des Forward-Tests

1. **Strategie unverändert.** Jede Änderung an Regeln, Parametern oder
   Regime-Modell ist eine neue StrategyVersion (anderer Hash) und beendet
   diesen Forward-Test; sie bekommt einen eigenen Startzeitpunkt.
2. **Bugfixes getrennt.** Fehlerbehebungen außerhalb der Strategie-Identität
   (Daten, Jobs, Betrieb) werden unten mit Datum, Commit und Wirkung
   eingetragen. Die StrategyVersion bleibt; ein späterer Build ist im
   Eligibility-Report als `STRATEGY_VERSION_BUILD`-Warnung sichtbar.
3. Der Test misst auch Betriebsausfälle: Zeiten ohne Scheduler (z. B.
   schlafender Mac) werden hier notiert, nicht nachträglich aufgefüllt.

## Änderungsprotokoll (Bugfixes und Betrieb, keine Strategieänderungen)

| Datum (UTC) | Commit | Art | Beschreibung |
|---|---|---|---|
| 2026-10-14 13:55 | — | Betrieb | Daten-Worker mit dem aktuellen Build neu gestartet (schreibt das crypto-native Regime); Migrationen 26/27 angewendet; alte LONG_V1-Zuweisung deaktiviert, Session vor der Umstellung pausiert. |
