# Evolution Engine — drei Claude-Forschungszyklen unter Gates v3

Datum: 2026-10-15 · lokal (Mac, Dev-Datenbank) · Gates `evolution-gates-v3`
(Hash `250bf745…`, vorregistriert und gepusht in `e2e6f45` **vor** dem
ersten Lauf) · Split `evolution-split-v1` · Code `e2e6f45` (Läufe 1–2),
`0ec1ea0` (Lauf 3, nur Textkorrektur der Unabhängigkeits- und α-Meldungen und
des KI-Kontexts; Schwellen, Methoden und Hash unverändert).

> Historische Simulation mit eingefrorenem Kostenmodell
> (BINANCE_SPOT_VIP0_ESTIMATE_V1). Kein Forward-Ergebnis, keine Prognose,
> keine Handelsempfehlung. Kein Kandidat wurde vorgeschlagen oder
> freigegeben. Der offizielle Forward-Test auf dem VPS blieb unberührt, es gab
> kein Deployment und keinen Echtgeldhandel. Der lokale Agent blieb pausiert;
> jeder Lauf wurde einzeln mit `run-cycle --force` gestartet.

## Läufe und Kosten

Budgetgrenze wie vorgegeben: 2 USD gesamt für die echten Läufe
(`EVOLUTION_AI_MONTHLY_BUDGET_USD=2`, höchstens 1 USD je Lauf). Kosten aus den
von der API gemeldeten Tokens.

| Lauf | Hypothesen (Opus 5.5, effort medium) | Zusammenfassung (Haiku 5.5) | Kosten (USD) | Backtests | Wandzeit |
|---|---|---|---:|---:|---:|
| `EVO-RUN-20261015T170555-7d4ef6` | 23 410 ein / 4 882 aus | 3 106 / 1 544 | 0,1924 | 12 (41 CPU-min) | 10,6 min |
| `EVO-RUN-20261015T171726-362baa` | 25 787 / 4 161 | 2 899 / 1 641 | 0,1875 | 8 (32 CPU-min) | 7,9 min |
| `EVO-RUN-20261015T172741-8e8d2e` | 28 057 / 5 095 | 2 160 / 1 626 | 0,2152 | 6 (18 CPU-min) | 7,0 min |
| **Summe v3** | **77 254 / 14 138** | **8 165 / 4 811** | **0,5950** | 26 | 25,5 min |

Oktober insgesamt (inklusive Verbindungstests und erstem Claude-Lauf):
**0,7649 USD von 2 USD**, verbleibend 1,2351 USD. Audit-Kette intakt
(70 Ereignisse).

Mehrfachtest-Zähler: N = 43 vor den v3-Läufen, **N = 52** danach. Die
Signifikanzschwelle stieg von 2,74 auf 2,81.

Familien-Budget Oktober (10 Validierungsprüfungen je Familie, alle
Versionen):

| Familie | vor v3 | nach Lauf 1 | nach Lauf 2 | nach Lauf 3 |
|---|---:|---:|---:|---:|
| BREAKOUT_LONG | 6 | 8 | 10 | 10 |
| REGIME_LONG | 5 | 7 | 9 | 10 |

Damit ist für beide Familien im Oktober keine weitere Prüfung auf
Validierungsdaten möglich. Ein weiterer Lauf würde nur noch API-Kosten
verursachen.

## Kandidaten (Entdeckung + Validierung, BTC + ETH)

Referenz jeder Familie ist ihre Wurzel. Freigegebene Kandidaten gibt es
nicht, die Elternstrategie war immer die Wurzel; damit ist die Wurzel
zugleich bester Familienvertreter. Champion: Sharpe 0,30, Ø R Validierung
−0,30. Challenger: Sharpe 1,07, Ø R Validierung 0,48, Drawdown 0,94 %,
Marktexposition 25,5 %.

| Kandidat | Änderung | Trades | Ø R | PF | Sharpe | Ø R Valid. | Korr. Linie | bespielte Einstiege | ΔSharpe (Entd. / Valid.) | gepaart t | Portfolio ΔSharpe | α-t | v1-Basis | v3 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---|---|
| EVO-BRK-0007 | ATR/Schluss ≤ 2 %, Stop-Kappe 4 % | 141 | 0,13 | 1,19 | 0,34 | −0,30 | 0,94 | 94 % | +0,04 (+0,05 / 0,00) | 0,34 | −0,15 | 0,56 | Validierung, Kostenstress | verworfen |
| EVO-BRK-0008 | RSI 55–75 | 93 | 0,13 | 1,21 | 0,29 | −0,14 | 0,74 | 88 % | 0,00 (−0,13 / +0,94) | −0,22 | −0,11 | 0,16 | Validierung, Phasen, Champion | verworfen |
| EVO-REG-0006 | Konfidenz 70, ohne Gate-Exit, Backstop 336 h | 115 | 0,41 | 2,17 | 1,05 | 0,29 | **0,88** | 100 % | −0,02 (+0,10 / −0,36) | −0,33 | +0,15 | 0,83 | **alle bestanden** | verworfen |
| EVO-REG-0007 | Ziel 8 R, Backstop 1008 h, Konfidenz 65 | 104 | 0,60 | 3,14 | 1,25 | 0,71 | 0,95 | 99 % | +0,18 (+0,26 / −0,04) | 1,35 | +0,22 | 0,70 | Phasen (71 %) | verworfen |
| EVO-BRK-0009 | 4h/1d-Signale an | 5 | −1,33 | 0,00 | −0,84 | – | 0,02 | 100 % | −1,13 | −0,97 | −0,09 | – | fast alle | verworfen |
| EVO-BRK-0010 | Ziel 4 R, Backstop 144 h | 129 | 0,05 | 1,06 | 0,10 | −0,35 | 0,82 | 91 % | −0,19 (−0,24 / +0,43) | −0,83 | −0,25 | −0,92 | Validierung, Kosten, Phasen, Champion | verworfen |
| EVO-REG-0008 | ohne Gate-Exit, Backstop 504 h, Ziel 6 R | 90 | 0,62 | 2,43 | 1,14 | 0,56 | **0,89** | 99 % | +0,07 (+0,15 / −0,16) | 0,52 | +0,19 | 0,87 | **alle bestanden** | verworfen |
| EVO-REG-0009 | Stop 3 × ATR(1d), Ziel 5 R, Backstop 1008 h | 94 | 0,45 | 3,70 | 1,26 | 0,48 | 0,96 | 98 % | +0,19 (+0,28 / −0,05) | −1,07 | +0,18 | 1,26 | Phasen (65 %) | verworfen |
| EVO-REG-0010 | ohne Gate-Exit, Backstop 504 h, Stop 3 × ATR(1d) | 77 | 0,54 | 3,05 | 1,25 | 0,42 | **0,89** | 99 % | +0,18 (+0,30 / −0,15) | −0,90 | +0,18 | 1,18 | **alle bestanden** | verworfen |

„Bespielte Einstiege“ bezieht sich auf die eigene Wurzel. Gegenüber der
jeweils anderen Familie lag die Korrelation bei 0,11–0,45. Die Einstiege der
Ausbruchs-Kandidaten fielen dagegen zu 100 % in Zeiten, in denen auch die
Regime-Strategie im Markt war.

In Lauf 3 wurden drei weitere Regime-Hypothesen ohne Backtest verworfen
(`LINEAGE_BUDGET_EXHAUSTED`): Gate-Exit aus mit Stop 3 und Ziel 5; Konfidenz
75 mit Stop 3; Ziel 10 R mit Backstop 1440 h und Stop 3. Ihre Validierungsdaten
wurden nicht angefasst.

## Befunde

1. **Die Lücke trat dreimal live auf.** Unter v2 hätten drei Kandidaten das
   Screening bestanden: EVO-REG-0006 (Korrelation 0,88), EVO-REG-0008 (0,89)
   und EVO-REG-0010 (0,89).
   - Alle drei bestanden sämtliche v1-Basisprüfungen.
   - Unter der Nachfolger-Schwelle 0,90 hätte v2 sie nur am Champion gemessen
     (Sharpe 1,05 – 1,25 gegen 0,30). Wie EVO-REG-0004 wären sie Finalisten
     geworden.
   - v3 verwirft alle drei. Gegenüber dem Challenger sind sie in der
     Validierung schlechter (ΔSharpe −0,36, −0,16, −0,15), gepaart nicht
     signifikant (t −0,33, 0,52, −0,90) und wesentlich schlechter bei
     Validierungs-R, Kapitalbindung oder Stichprobe.
   - Mit 99 – 100 % bespielten Einstiegen und α-t unter 1 sind sie auch keine
     Diversifikation.
   - Zusammen mit EVO-REG-0004 (0,887) liegen damit vier der sieben bisher von
     Claude formulierten Regime-Kandidaten knapp unter 0,90 (0,88 – 0,89). Das ist kein
     Zufall, sondern das Ergebnis gelernter Ablehnungsgründe.
2. **Höhere Sharpe ist kein höherer Ertrag.** EVO-REG-0007, -0009 und -0010
   erreichen ΔSharpe +0,18 / +0,19 / +0,18 und erfüllen damit allein die
   Verbesserungsschwelle.
   - Der gepaarte Monatsvergleich ergibt aber t = 1,35, −1,07 und −0,90.
     Teils verdienen sie im Monatsmittel weniger als der Challenger.
   - Die Validierung ist jeweils schlechter.
   - Die höhere Sharpe kommt aus geringerer Schwankung und weniger Trades,
     nicht aus mehr Rendite.
   - Ohne Konsistenz- und Signifikanzprüfung wären diese Kandidaten
     „Verbesserungen“.
3. **Portfolio-Gewinn ohne eigenen Beitrag.** Jede Regime-Variante hebt das
   Portfolio aus Champion und Challenger um +0,15 bis +0,22 Sharpe.
   - Das α gegenüber den beiden Strategien bleibt aber bei t ≤ 1,26, mit
     β ≈ 0,6 – 1,2 auf den Challenger.
   - Der Gewinn entsteht nur, weil die starke Regime-Linie gegenüber dem
     schwachen Champion höher gewichtet wird.
   - Die Vorregistrierung hatte genau das vorhergesagt. Der α-Test gegen jede
     Strategie einzeln ist deshalb notwendig.
4. **Die Regime-Familie ist um den Challenger ausgereizt.**
   - Alle fünf Regime-Kandidaten teilen 98 – 100 % der Einstiege mit dem
     Challenger. Sie verändern nur Ausstieg, Ziel, Stop oder Haltedauer.
   - Keiner ist auf beiden Zeiträumen besser. Die Entdeckung gewinnt
     (ΔSharpe +0,10 bis +0,30), die Validierung verliert (−0,04 bis −0,36):
     das typische Bild einer Anpassung an den Suchzeitraum.
5. **Die Ausbruchsfamilie scheitert weiter an der Validierung.** Im Oktober
   wurden 10 von 10 Ausbruchs-Kandidaten verworfen, fast immer an
   2022-H2/2023. Die 4h/1d-Bestätigung lässt nur 5 Trades übrig.
6. **Claude hält sich an Budget und Regeln.**
   - In Lauf 3 hat Claude ohne Ausbruchsbudget nur Regime-Hypothesen
     formuliert, sie priorisiert und das Budget im Text benannt.
   - Alle Hypothesen enthielten Beobachtung, Begründung, erwartete Wirkung
     und Widerlegungskriterium.
   - Trotz der v3-Regel im Kontext blieben die Regime-Ideen
     Ausstiegsvarianten. Dass „geringere Korrelation allein nicht hilft“, hat
     die Ideenrichtung nicht verändert.
7. **Die Zusammenfassung durch Haiku ist unzuverlässig im Detail.** Sie
   spricht in Lauf 1 und 2 von „acht Kandidaten“, obwohl je Lauf vier geprüft
   wurden: Sie vermischt die Kandidaten aus den Bedingungsbefunden.
   Entscheidungen hängen nicht von ihr ab. Die Zusammenfassung bleibt
   informativ.

## Unverändert

- EVO-REG-0004 bleibt `REJECTED_BY_OPERATOR`, die Prüfsummen von
  `gatesJson` (`625070ae…`) und `metricsJson` (`47eb093c…`) sind nach allen
  drei Läufen identisch.
- Keine frühere Entscheidung wurde neu bewertet.
- Kein Kandidat wurde vorgeschlagen, also war auch nichts freizugeben.
- Champion, Challenger, Arena V1, Portfolios und Sessions des offiziellen
  Forward-Tests wurden nicht berührt.

## Einordnung und nächste Schritte

- **Keine neuen Prüfungen mehr im Oktober.** Für beide Familien ist das
  Validierungsbudget ausgeschöpft. Neue Prüfungen sind frühestens im
  November möglich. Der Mehrfachtest-Zähler steht dann bei mindestens 52.
- **Der Parameterraum um den Challenger liefert nichts Belastbares mehr.**
  Belastbarer Fortschritt braucht neue Einstiegslogik, also eine neue Familie
  oder die vorbereitete Code-Sandbox mit eigener Vorregistrierung, statt
  weiterer Ausstiegsvarianten.
- **Nachweis nur durch Forward-Daten.** Die wichtigste Evidenz bleibt der
  laufende Forward-Test der bestehenden Strategien auf neuen, ungesehenen
  Daten.
