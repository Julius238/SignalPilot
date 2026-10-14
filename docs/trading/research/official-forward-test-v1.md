# Offizieller Forward-Test V1 (VPS, 24/7) — Champion gegen Challenger

**Phase `OFFICIAL`.** Das ist der offizielle Forward-Test.

Der lokale Mac-Betrieb ab 2026-10-14 ist `LOCAL_SHAKEDOWN`, ein Systemtest.
Seine Ergebnisse werden nie mit diesem Test verglichen oder zusammengeführt:

- [Shakedown TREND_CORE](forward-test-trend-core-long-v1.md)
- [Shakedown REGIME_LONG](forward-test-regime-long-v1.md)

Kein Echtgeldhandel. Ablauf: [Runbook 18](../18-vps-24-7-shadow-runbook.md).

## Startzeitpunkte

> **Noch nicht gestartet.** Wird bei der Aktivierung auf dem VPS eingetragen.
> Maßgeblich ist das Audit-Event `SESSION_ACTIVATED` der jeweiligen Session.

| Teilnehmer | Portfolio | Forward-Start (UTC) | `SESSION_ACTIVATED` |
|---|---|---|---|
| Champion `CRYPTO_TREND_CORE_LONG_V1` | `OFFICIAL_TREND_CORE_LONG_V1` | — | — |
| Challenger `CRYPTO_REGIME_LONG_V1` | `OFFICIAL_REGIME_LONG_V1` | — | — |

Arena-Kohorte: `ARENA_OFFICIAL_V1`, Phase `OFFICIAL`, Policy
`arena-policy-v1`. Der Policy-Hash ist derselbe wie lokal, weil die Policy
unverändert bleibt.

## Eingefrorene Konfiguration

| | |
|---|---|
| Strategien | `CRYPTO_TREND_CORE_LONG_V1`: `crypto-mtf-breakout-v1/1.2.0`, Hash `8bb3bb93798b2adc8ee33b64181b99d49961385e0bb733f611689322eca6c7dd` |
| | `CRYPTO_REGIME_LONG_V1`: `crypto-regime-long-v1/1.0.0`, Hash `4708eaf89a39a2db9cebfd20564fce2f912dd731da74c5f658eb76c1ed64df6c` |
| Regime | `crypto-native-regime-v1/1.0.0` |
| Markt | Binance Spot BTCUSDT, 1h; ETH-Zuweisungen deaktiviert |
| Startkapital | je 10 000 USDT, eigenes Portfolio, eigenes Ledger, eigene Session, eigener Kill Switch |
| Risk | RiskLimitSet `SHADOW_V1` v1, `risk-rules-v1/1.3.0`, 0,25 % Risiko je Trade |
| Kosten | `BINANCE_SPOT_VIP0_ESTIMATE_V1`: 10 bp Gebühr je Seite, 2 bp Spread, 3 bp Slippage je Seite; Profil-Hash: — (bei Aktivierung) |
| Daten | Binance über den Daten-Worker des VPS, kein synthetischer Feed |
| Build bei Start | — (Commit bei Aktivierung) |

## Regeln

1. **Strategien und Arena bleiben unverändert.** Jede Änderung an Regeln,
   Parametern, Regime, Kosten oder Arena-Policy ist eine neue Version mit
   neuem Startzeitpunkt.
2. **Bugfixes und Betrieb werden getrennt protokolliert**, mit Datum, Commit
   und Wirkung. Das gilt auch für jeden Worker-Neustart und jede Downtime.
3. **Ausfälle werden notiert, nicht aufgefüllt.** Verpasste Kerzen lädt der
   Daten-Worker nach. Einen verpassten Scan-Tick holt der 5-Minuten-Scan mit
   Anker-Cursor nach.
4. **Entscheidungen fallen nur auf Forward-Daten.** Historische Replays
   bleiben getrennt.

## Änderungsprotokoll (Bugfixes und Betrieb, keine Strategieänderungen)

| Datum (UTC) | Commit | Art | Beschreibung |
|---|---|---|---|
| — | — | — | Noch keine Einträge. |
