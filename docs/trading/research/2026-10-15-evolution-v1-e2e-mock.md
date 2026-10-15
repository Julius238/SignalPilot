# Evolution Engine V1 — erster End-to-End-Lauf auf echten Daten (Mock-KI)

Datum: 2026-10-15 · lokal (Mac, Dev-Datenbank) · Code `efe4df8` ·
Vorregistrierung committet und gepusht **vor** diesem Lauf
([2026-10-15-evolution-v1-preregistration.md](2026-10-15-evolution-v1-preregistration.md)).

> Historische Simulation mit eingefrorenem Kostenmodell. Kein Forward-Ergebnis,
> keine Prognose, keine Handelsempfehlung. Kein Kandidat wurde freigegeben;
> der offizielle Forward-Test auf dem VPS blieb unberührt.

## Ablauf

Mock-KI (`EVOLUTION_AI_PROVIDER=mock`, kein API-Key) → Hypothese → Genom →
technischer Test → Backtest (unveränderter Shadow-Replay, `SPEC`,
`CRYPTO_NATIVE_V1`, BINANCE_SPOT_VIP0_ESTIMATE_V1) → Gates → Speicherung →
Dashboard `Trading → Evolution` und API `/trading/evolution` (Ports 3110/3010).

Daten: Binance-Snapshots BTCUSDT/ETHUSDT 1h/4h/1d bis 2026-10-14
(`data/market-snapshots/real`), Lader-Schnitt bei 2026-10-15.

| Durchlauf | Dauer | Backtests (neu) | CPU | Hypothesen → Kandidaten | Ergebnis |
|---|---:|---:|---:|---|---|
| `EVO-RUN-20261015T095145-ab8da3` | 9 min | 12 | 38 CPU-min (6 Prozesse) | 4 → 4 | 4 verworfen |
| `EVO-RUN-20261015T100135-8f981f` | 4 min | 6 (Referenzen aus Cache) | 22 CPU-min | 4 → 3 (eine Wiederholung übersprungen) | 3 verworfen |

Audit-Kette geprüft (`evolution verify-audit`: 23 Ereignisse, intakt).
Daten-Exposure: Entdeckung 14× Suche + 8× Referenz, Validierung 14× Auswahl +
8× Referenz, Holdout 0× (kein Finalist), Forward 0×.

## Referenzen auf Entdeckung + Validierung (2018-04 – 2023-12, BTC + ETH)

| | Trades | Ø R | PF | Rendite | Max. DD | Sharpe | Exposition | Ø R bei 2× Kosten |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Champion `CRYPTO_TREND_CORE_LONG_V1` | 151 | +0,10 | 1,16 | +1,97 % | 2,19 % | 0,30 | 2,5 % | −0,02 |
| — davon Validierung 2022-07 – 2023-12 | 30 | −0,30 | 0,59 | −1,14 % | 1,18 % | −1,24 | | −0,44 |
| Challenger `CRYPTO_REGIME_LONG_V1` | 121 | +0,42 | 2,35 | +6,50 % | 0,94 % | 1,07 | 25,5 % | +0,39 |
| — davon Validierung | 30 | +0,48 | 2,52 | +1,81 % | 0,60 % | 1,15 | | +0,44 |

Buy & Hold im selben Fenster (gleichgewichtet BTC/ETH): +490 % bei 84 % maximalem Drawdown. Die kleinen
Renditen der Strategien folgen aus 0,25 % Risiko je Trade; verglichen wird
risikobereinigt.

## Kandidaten

| Kandidat | Änderung | Score | Evidenz | Ergebnis und Grund |
|---|---|---:|---|---|
| EVO-BRK-0001 | Regime-Konfidenz 60 → 70 | 50,3 | keine | verworfen: identisch mit dem Champion (Korrelation 1,00), Validierung −0,30 R, doppelte Kosten negativ |
| EVO-BRK-0002 | Stop 1,5 → 2 × ATR | 50,7 | keine | verworfen: Validierung −0,23 R, doppelte Kosten negativ, eine Phase trägt 75 % |
| EVO-BRK-0003 | Ausbruchsfenster 20 → 30 | 49,2 | keine | verworfen: Validierung negativ, Fast-Kopie des Champions |
| EVO-BRK-0004 | Zeit-Exit 72 → 120 h | 49,8 | keine | verworfen: Validierung −0,30 R, Fast-Kopie des Champions |
| EVO-REG-0001 | Regime-Konfidenz 60 → 70 | 81,9 | mittel | verworfen: Korrelation 0,98 mit dem Challenger, eine Phase trägt 69 % |
| EVO-REG-0002 | Stop 2 → 2,5 × ATR(1d) | 84,8 | mittel | verworfen: Korrelation 0,98 mit dem Challenger (alle anderen 9 Prüfungen bestanden; PF 2,61, Sharpe 1,15) |
| EVO-REG-0003 | Ziel 4 → 6 R | 86,3 | mittel | verworfen: Korrelation mit dem Challenger, eine Phase trägt 72 % |

Evidenzgrad: t = 2,94 gegen die Schwelle 2,66 bei 34 Konfigurationen
(30 Vorforschung + 4) — „mittel“, d. h. knapp über dem Zufallsniveau der
Mehrfachtests.

## Einordnung

1. **Die Maschine arbeitet ehrlich.** Sie verwirft Varianten, die nur
   kopieren (Korrelation ≈ 1), an Kosten oder an der Validierung scheitern, mit
   konkreten Gründen, und wiederholt keine getesteten Kombinationen.
2. **Der Champion besteht die eigenen Gates nicht.** Er ist in der
   Validierung negativ und bei doppelten Kosten im Minus — konsistent mit dem
   „formal bestanden, aber schwach“-Befund vom 2026-10-14 (PF 1,12 im Test).
3. **Der robuste Teil ist das Regime-Halten.** Challenger-Varianten
   verbessern einzelne Kennzahlen leicht, sind aber zu 0,98 mit ihm
   korreliert und werden vom vorregistrierten Redundanz-Gate verworfen. Eine
   „Nachfolger“-Regel (darf korreliert sein, muss den Elternteil aber
   deutlich schlagen) wäre eine **neue** Gate-Version und dürfte erst nach
   einer Entscheidung, vor weiteren Läufen, eingeführt werden.
4. **Der Mock ist bewusst einfach** (Einzelschritte am Raster). Wirklich neue
   Kombinationen sind die Aufgabe der echten Claude-Hypothesen.

## Kosten

Mock-Aufrufe wurden zum Listenpreis protokolliert, aber nicht abgerechnet:
Hypothesen-Prompt 13,5 k bzw. 24,4 k Zeichen (wächst mit der Historie),
Zusammenfassung 2 k Zeichen. Mit Opus 5.5 entspräche das etwa 4–8 k
Eingabe-Tokens; mit Denk- und Antwort-Tokens erwartet ≈ 0,10–0,25 USD je
Durchlauf, reserviert werden höchstens 0,35 USD.
