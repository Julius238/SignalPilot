# Evolution Engine — erster Forschungszyklus mit der echten Claude API

Datum: 2026-10-15 · lokal (Mac, Dev-Datenbank) · Code `54962b0` ·
Gates `evolution-gates-v2` (Hash `8341a3c7…`, vorregistriert und gepusht vor
diesem Lauf) · Split `evolution-split-v1` · Durchlauf
`EVO-RUN-20261015T152351-22d709`.

> Historische Simulation mit eingefrorenem Kostenmodell
> (BINANCE_SPOT_VIP0_ESTIMATE_V1). Kein Forward-Ergebnis, keine Prognose,
> keine Handelsempfehlung. Kein Kandidat wurde freigegeben. Der offizielle
> Forward-Test auf dem VPS blieb unberührt.

## Ablauf und Kosten

Budget für diesen Test: 2 USD gesamt (`EVOLUTION_AI_MONTHLY_BUDGET_USD=2`),
höchstens 1 USD je Durchlauf. Kosten aus den von der API gemeldeten Tokens.

| Aufruf | Modell | Eingabe | Ausgabe | Kosten (USD) | Dauer |
|---|---|---:|---:|---:|---:|
| Verbindungstest (ungültiger Key, 401) | Haiku 5.5 | 0 | 0 | 0,0000 | 0,4 s |
| Verbindungstest | Haiku 5.5 | 474 | 65 | 0,0001 | 3,3 s |
| Verbindungstest (mit Refusal-Fallback-Parametern) | Opus 5.5 | 474 | 74 | 0,0034 | 2,8 s |
| Hypothesen | Opus 5.5 (effort medium) | 19 645 | 4 339 | 0,1654 | 43,8 s |
| Zusammenfassung | Haiku 5.5 (effort low) | 2 960 | 1 566 | 0,0011 | 8,4 s |
| **Gesamt** | | **23 553** | **6 044** | **0,1699** | |

Reserviert wurde vor dem Hypothesen-Aufruf der schlechteste Fall von
0,3652 USD. Verbleibend: 1,8301 USD.

Backtests: 18 neue (Referenzen neu wegen neuem Code-Stand, 4 Kandidaten,
2 Nachbarn, Holdout), 56,7 CPU-Minuten, 13,5 Minuten Wandzeit mit 6
Prozessen. Audit-Kette intakt (38 Ereignisse). Der lokale Agent wurde danach
pausiert.

## Claudes Hypothesen

Claudes eigene Lageeinschätzung: Trades verlieren in Phasen hoher Volatilität
ihren Vorteil; die Ausbruchsfamilie hat nach Kosten zu wenig Erwartungswert
und scheitert an ETH-Fehlausbrüchen; Regime-Varianten sollen strukturell
abweichen, weil Einzelparameter-Varianten zuvor an der Redundanz-Prüfung
scheiterten.

| # | Hypothese | Änderungen | Kandidat |
|---|---|---|---|
| H1 | Ausbruch: Kosten je R senken, Hochvolatilitäts-Ausbrüche ausschließen | Mindest-Stop 1,75 → 2,5 %, Stop-Kappe 6 → 4 % | EVO-BRK-0005 |
| H2 | Ausbruch: Volumenbestätigung plus 1h-Signal gegen Fehlausbrüche | relatives Volumen ≥ 1,5, 1h-Signal wieder an | EVO-BRK-0006 |
| H3 | Regime: Gate-Exit abschalten, 14-Tage-Backstop, weiterer Stop | Gate-Exit aus, Backstop 720 → 336 h, Stop 2 → 2,5 × ATR(1d) | EVO-REG-0004 |
| H4 | Regime: früherer Einstieg, größeres Ziel, weiterer Stop | Konfidenz 60 → 50, Ziel 4 → 6 R, Stop 2 → 2,5 × ATR(1d) | EVO-REG-0005 |

Jede Hypothese enthielt eine konkrete Beobachtung, eine ökonomische
Begründung, eine erwartete Wirkung und ein Kriterium, an dem sie scheitert
(Wortlaut im Dashboard und in `EvolutionHypothesis`).

## Ergebnisse (Entdeckung + Validierung, BTC + ETH)

| Kandidat | Trades | Ø R | PF | Sharpe | Max. DD | Ø R Validierung | Korrelation | Ergebnis |
|---|---:|---:|---:|---:|---:|---:|---|---|
| Champion (Referenz) | 151 | +0,10 | 1,16 | 0,30 | 2,19 % | −0,30 | – | – |
| Challenger (Referenz) | 121 | +0,42 | 2,35 | 1,07 | 0,94 % | +0,48 | – | – |
| EVO-BRK-0005 | 126 | −0,01 | 0,99 | −0,02 | 3,30 % | −0,16 | 0,81 Champion | verworfen |
| EVO-BRK-0006 | 93 | +0,13 | 1,21 | 0,31 | 1,73 % | −0,39 | 0,72 Champion | verworfen |
| EVO-REG-0004 | 111 | +0,36 | 2,25 | 1,11 | 0,70 % | +0,35 | 0,89 Challenger | **vorgeschlagen** |
| EVO-REG-0005 | 106 | +0,45 | 2,89 | 1,20 | 0,78 % | +0,37 | 0,95 Challenger | verworfen (Nachfolger-Regel) |

Ablehnungsgründe:

- **EVO-BRK-0005**: kein Vorteil in der Entdeckung (Ø 0,03 R, PF 1,04),
  Validierung negativ, bei doppelten Kosten −339 USDT, nur 2 von 4 Phasen
  positiv, kein Vorteil gegen den Champion. Claudes eigenes
  Widerlegungskriterium (Stress-Ø-R > 0,12) ist ebenfalls verfehlt.
- **EVO-BRK-0006**: Entdeckung positiv (Ø 0,22 R, PF 1,36), aber Validierung
  Ø −0,39 R (13 Trades) und eine Phase trägt 68 % des Gewinns. Die
  Ausbruchsfamilie scheitert damit zum dritten Mal am Zeitraum 2022-H2/2023.
- **EVO-REG-0005**: Fast-Kopie des Challengers (0,95), deshalb nach der
  Nachfolger-Regel geprüft: ΔSharpe +0,12 (verlangt 0,15), in der Validierung
  schlechter (ΔSharpe −0,18, Ø R 0,37 statt 0,48), gepaarter Monatsvergleich
  t = −0,55 gegen die Schwelle 2,73, dazu eine Phase mit 68 %. Die höhere
  Sharpe beruht also nicht auf höheren Monatsrenditen.
- **EVO-REG-0004**: alle 13 Prüfungen bestanden — Screening (Validierung
  Ø 0,35 R, PF 2,79; doppelte Kosten Ø 0,33 R; 4 von 4 Phasen positiv;
  Drawdown 0,70 %), Nachbarn (Ø 0,27 R und 0,34 R), rollierender Walk-Forward
  (außerhalb der Stichprobe Ø 0,33 R über 106 Trades, Effizienz 0,81),
  Holdout 65 Trades, Ø 0,19 R, PF 1,52. Evidenz nach Mehrfachtest „mittel“
  (t = 3,17, Schwelle 2,74 bei N = 43).

## Einordnung von EVO-REG-0004

Formal korrekt vorgeschlagen, inhaltlich **nicht besser als der Challenger**:

| Holdout 2024 – 2026-10-14 (bereits analysiert) | Challenger | EVO-REG-0004 |
|---|---:|---:|
| Trades | 83 | 65 |
| Ø R | 0,28 | 0,19 |
| Profit Factor | 2,00 | 1,52 |
| Sharpe | 1,08 | 0,68 |
| Max. Drawdown | 1,26 % | 1,21 % |
| Marktexposition | 29,9 % | 39,4 % |

Gepaarter Monatsvergleich auf dem Holdout: t = −1,67 zuungunsten des
Kandidaten. Auch in der Validierung liegt er unter dem Challenger
(Ø 0,35 R gegenüber 0,48 R), bei mehr Kapitalbindung. Über Entdeckung +
Validierung ist er mit Sharpe 1,11 gegenüber 1,07 praktisch gleichauf.

Warum er trotzdem besteht: Mit einer Korrelation von 0,89 liegt er knapp
unter der Schwelle 0,90, ab der die Nachfolger-Regel ihn mit dem Challenger
vergleicht. Als „eigenständiger“ Kandidat muss er sich nur gegen den Champion
behaupten (Sharpe 0,30), und das schafft fast jede Regime-Variante. Claude hat
die Redundanz-Prüfung aus der Historie gelernt und die Hypothese ausdrücklich
so formuliert, dass die Tagesrenditen abweichen.

Empfehlung: **nicht freigeben**. Der Kandidat bleibt `PROPOSED` und wird
nicht rückwirkend neu bewertet. Die Lücke — sehr ähnliche Kandidaten werden nur
gegen die schwächere Referenz gemessen — wäre eine neue, vor dem nächsten Lauf
vorzuregistrierende Gate-Version (z. B. Vergleich mit der stärksten
bestehenden Strategie derselben Familie bei Korrelation > 0,8).

## Was der Lauf zeigt

- Die echte Anbindung funktioniert: Structured Output, Streaming,
  Refusal-Fallback-Parameter, Budget-Reservierung und Kostenbuchung.
- Claude formuliert nachvollziehbare, falsifizierbare Hypothesen und nutzt
  die Befunde (Volatilitäts-Buckets, Ausstiegsarten, frühere Ablehnungsgründe)
  gezielt.
- Die Ausbruchsfamilie scheitert wiederholt an 2022-H2/2023; die
  Regime-Familie bleibt der robuste Kern, ohne dass eine Variante den
  Challenger nachweisbar übertrifft.
- Die Zusammenfassung durch Haiku sieht nur Screening-Urteile und nennt
  deshalb einzelne Prüfungen (Kostenstress, Mehrfachtest) als fehlend, die
  die Engine tatsächlich durchführt.
