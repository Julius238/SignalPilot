# Vorregistrierung `RISK_BUDGET_V1` (D1): Portfolioweites Risikobudget statt fester Risikozuweisung je Trade

> **Status: ENTWURF zur Freigabe, nicht eingefroren.** Erstellt am
> 2026-10-18 auf `claude/inspiring-noether-rjh92d`, Grundlage ist die
> [strategische Bestandsaufnahme](2026-10-18-strategic-review-next-phase.md)
> (`3dd09ec`, Richtung D1).
>
> - Es gab keinen Backtest, keine Renditeberechnung, keine
>   Parameteroptimierung, keinen Download und keinen KI-Lauf (0 USD).
> - An Risk Engine, Champion, Challenger, Arena, Gates, VPS und dem
>   offiziellen Forward-Test `OFFICIAL_V1` wurde nichts geändert.
> - Mehrfachtest-Zähler unverändert **N = 57**.
> - Eingefroren wird erst nach der Freigabe des Betreibers und nach den
>   Entscheidungen E1–E7 (Abschnitt 10). Jeder spätere Schritt braucht eine
>   eigene Freigabe.
> - Keine Handels-, Anlage- oder Steuerberatung.

## Kurz und verständlich

- **Frage:** Bringt es nach Kosten mehr Rendite **je Einheit Risiko**, das
  Risikobudget portfolioweit und abhängig vom Zustand des Portfolios zu
  vergeben, statt jedem Trade fest 0,25 % zuzuteilen?
- **Gemessen wird nicht, ob mehr Risiko mehr Rendite bringt.** Das ist
  trivial. Deshalb gibt es eine Größenreferenz C: dieselben Trades, einfach
  doppelt so groß. Eine neue Regel B besteht nur, wenn sie C bei gleichem
  Risiko schlägt.
- **Ehrliche Erwartung:**
  - Die Rechnung aus den Regeln (Abschnitt 2) sagt voraus, dass das Budget vor
    allem deshalb ungenutzt bleibt, weil keine Position offen ist, also aus
    Mangel an Signalen.
  - Das wahrscheinlichste Ergebnis ist deshalb `NUR_SKALIERUNG`: Mehrertrag
    nur durch mehr Risiko. Dann ist die Höhe des Risikos eine Entscheidung
    des Betreibers, keine Forschungsfrage, und die Studie liefert die Zahlen
    dafür.
- **Aufwand:** ein additiver Forschungsschalter im Replay, ein
  Auswertungsskript, ein Lauf; 3–4 Arbeitssitzungen. Kein Gates v5, keine
  Änderung an der Risk Engine.

## 1. Forschungsfrage und Hypothese

**Frage:** Liefert eine portfolioweite, zustandsabhängige Risikobudgetierung
bei denselben Signalen, Einstiegen und Ausstiegen eine höhere
risikobereinigte Nettorendite als die feste Zuweisung von 0,25 % je Trade?
Und gilt das auch dann, wenn man den Effekt größerer Positionen herausrechnet?

- **H0:** Jeder Mehrertrag von B gegenüber A erklärt sich durch mehr Risiko.
  Bei gleichem Risiko ist B nicht besser als die Größenreferenz C.
- **H1:** B ist bei gleichem Risiko besser als C, gemessen an der Rendite je
  Risiko oder am Verlustrand. Das zeigt sich im Primärfenster und mit
  gleichem Vorzeichen im Holdout.

**Die vier Dinge, die getrennt werden:**

| Begriff | Messung | Bedeutung |
|---|---|---|
| Höhere Marktexposition | Ø und Spitze des Notionals je Equity, Zeit im Markt (M4) | wie viel Kapital im Markt ist; **kein** Gütemaß |
| Bloße Größenerhöhung | C gegenüber A: dieselben Trades mit konstant doppeltem Risiko | erwartet: Rendite und Drawdown etwa ×2, Sharpe etwa gleich |
| Bessere Kapitalallokation | B gegenüber C bei gleicher Volatilität (C\*, Abschnitt 3) | der einzige Teil, der ein Vorteil sein könnte |
| Höhere risikobereinigte Rendite | Sharpe, Calmar, Rendite je eingesetztem Risiko, Verlustrand (M2, M3, M5) | Grundlage jedes Urteils |

**Feste Regel:** Mehr Kapital im Markt zählt nie als besseres Signal, als
Alpha oder als Bestehen. Eine höhere absolute Rendite bei höherem Risiko führt
nie allein zum Bestehen.

## 2. Ausgangslage und Vorhersage aus den Regeln (ohne neue Daten)

**Warum ist das Budget ungenutzt?** Die mittlere Ausnutzung lässt sich
zerlegen:

> Ausnutzung = Zeitanteil mit offener Position × Ausnutzung des Deckels,
> solange eine Position offen ist.

Den Deckel bilden R-011 (höchstens 2 Positionen) mal R-009 (0,25 %), also
0,50 % offenes Risiko je Portfolio.

| | Challenger `CRYPTO_REGIME_LONG_V1` | Champion `CRYPTO_TREND_CORE_LONG_V1` |
|---|---|---|
| Einstieg | Gate offen; BTC und ETH bekommen ihr Signal im selben Scan | Ausbruch je Symbol, zeitlich versetzt |
| Stop | 2 × ATR(14, 1d), Median rund 9 % | 1,5 × ATR, Untergrenze 1,75 %, Obergrenze 6 % (`specification-v1.ts:250-251`) |
| Notional je Position bei 0,25 % | rund 2,8 % (P10–P90: 1,8–4,2 %) | 4,2–14,3 % (Überschlag: 0,25 % ÷ Stop) |
| Zeit im Markt | 25–30 % | kürzer, Ø-Bindung 0,9 % |
| Ø Bindung | 2,1 % | 0,9 % |

**Vorhersage V1 (in Phase 1 als Kennzahl M4 zu prüfen):**

- Ist der Challenger investiert, sind meist beide Positionen offen. Er nutzt
  dann den Deckel nahezu voll.
- Sein ungenutztes Budget stammt also fast nur aus den 70–75 % der Zeit ohne
  Position. Das ist das geschlossene Gate, also **fehlende Signale**, nicht
  ungenutzter Spielraum.
- Beim Champion ist auch der Deckel häufiger halb genutzt (eine Position).

**Wodurch eine Größenregel überhaupt wirken kann.** Sind die Trades fest,
bekommt jeder Trade i nur einen Größenfaktor kᵢ. Das lässt sich zerlegen in
das **Niveau** (Mittel der kᵢ, das ist die Wirkung von C) und die
**Streuung** (Allokation). Die Streuung kann nur über Informationen wirken,
die beim Einstieg vorliegen:

| Kanal | Stand | Folge für B |
|---|---|---|
| 1. Stopabstand / Volatilität | Schon in A enthalten: Notional = Risiko ÷ Stop, und der Stop ist ein ATR-Vielfaches. Das **ist** bereits Volatilitäts-Sizing | Ein „Volatilitätsziel“ würde nur das Niveau ändern, also C. Ausgeschlossen |
| 2. Gleichzeitigkeit / Korrelation BTC–ETH | Beim Challenger kommen Einstiege paarweise. Offene Positionen lassen sich nicht umschichten: kein Nachkauf (R-022), und Order-Zwecke kennen nur `ENTRY` und `EXIT` (`trading-domain/src/types.ts:396`). Eine Gruppenregel wird so entweder zu C oder ändert die Menge der Trades | Ausgeschlossen; nur als Kennzahl (M4, M5) |
| 3. Zustand des Portfolios (Drawdown, Verlustserie) | in A nur grob: R-021, R-010 | **Kanal von B** |
| 4. Stärke des Signals | wäre ein neues Signal | ausgeschlossen (Abschnitt 1) |

**Folge:** B testet Kanal 3. Das ist eine echte, falsifizierbare Frage: Häufen
sich Verluste so, dass eine Bremse nach Verlusten die Rendite je Risiko
verbessert? Treten Verluste unabhängig auf, kostet die Bremse nur Rendite.

## 3. Szenarien (fest, keine weiteren)

Alle Szenarien laufen mit identischen Daten, Fenstern, Startkapital,
Handelsgelegenheiten (Kandidaten), Kosten und allen Regeln der Risk Engine.
Geändert wird **nur** das Risikobudget je Bewertung, also der Wert von
`maxRiskPerTradePct`.

| | Rolle | Risiko je Trade rₜ | zählt für N |
|---|---|---|---|
| **A** Bestand | unveränderte Strategien, wie Vergleich A in Gates v4 | 0,25 % fest (R-009) | nein |
| **B** Portfolio-Risikobudget | Kandidat | r_max × max(0; 1 − DDₜ ÷ DD_max), mit r_max = 0,50 % und DD_max = 5 % (E1, E2) | **ja** |
| **C** Größenreferenz | isoliert die reine Größe | 0,50 % fest | nein |
| **C\*** | C, linear auf die tägliche Volatilität von B skaliert (Arithmetik, keine Simulation) | – | nein |
| **P** passive Referenz | BTC/ETH 50/50, konstanter Anteil f, monatlich zurückgesetzt, f so gewählt, dass die Tagesvolatilität der von B bzw. C entspricht. Rest Kasse S1 (0 %) und S2 (`DTB3`) | – | nein |

**Begründungen, alle ohne Blick auf Renditen:**

- **r_max = 0,50 % = R-010 ÷ R-011.** Das ist das größte Risiko je Trade, bei
  dem das bestehende Limit-Set in sich stimmig bleibt: Treffen beide erlaubten
  Positionen am selben Tag ihren Stop, bleibt der Verlust vor Kosten und
  Lücken innerhalb der Tagesgrenze von 1 %. A nutzt genau die Hälfte.
- **B folgt der Drawdown-Regel nach Grossman und Zhou (1993):**
  - Das Risiko wächst mit dem Abstand zur Verlustgrenze. Bei neuem Hoch ist
    B gleich C, bei halb verbrauchtem Budget gleich A, an der Grenze null.
  - Die Regel hat nur die zwei Betreiber-Vorgaben als Parameter.
  - DDₜ ist der Drawdown des Strategie-Portfolios zum Hochwasserstand bei der
    Bewertung. Der Replay führt ihn bereits (`highWaterMark`).
  - Bei DDₜ ≥ DD_max gibt es keine neuen Einstiege mehr, bis zum Ende des
    Fensters (absorbierend). Das ist der in Dokument 06 offene
    Drawdown-Kill, hier nur in der Forschungsvariante.
- **C\* macht B und C bei gleichem Risiko vergleichbar.** B hat im Mittel
  weniger Risiko als C, also wäre ein kleinerer Drawdown von B allein noch
  kein Vorteil. Die Skalierung wird ex post aus Volatilitäten bestimmt, nicht
  aus Renditen, und offengelegt.
- **„Innerhalb der bestehenden Risikogrenzen“** heißt hier: alle Regeln
  unverändert, auch R-010 mit 1 %, R-011, R-013 bis R-015, R-020, R-021 und
  die Gruppenprüfung (Stufe 2). Ersetzt wird nur der feste Wert von R-009
  (und damit die 0,25 %-Referenz von R-024) durch rₜ (E6).
- **Einheit der Bewertung:** je Strategie-Portfolio, wie in ADR 0015 (eigenes
  Kapital, keine Umverteilung zwischen Teilnehmern).
  - Primär ist der Challenger, die einzige Strategie mit positivem
    dokumentiertem Erwartungswert.
  - Sekundär der Champion, mit eigenem Urteil.
  - Die Gruppe wird nur berichtet.
  - Ein Vorteil, der nur entsteht, weil eine Verlust-Strategie gebremst wird,
    ist eine Abschaltregel. Die bekäme man über die Arena direkter.
- **Ausdrücklich nicht Teil:** Kapitalverschiebung zwischen Teilnehmern
  (`CapitalAllocationDecision`, eigene ADR), Hebel, neue Instrumente, neue
  Signale, Umschichtung offener Positionen.

## 4. Kennzahlen (vorab festgelegt)

Je Szenario, je Platz (Challenger, Champion) und für die Gruppe; je Fenster,
Kalenderjahr und Regime-Phase.

| Nr. | Kennzahl | Zweck |
|---|---|---|
| M1 | Nettorendite nach Kosten p. a., S1 (Kasse 0 %); S2 (`DTB3`) als Bericht | Ertrag |
| M2 | Sharpe (Monatsbasis, wie Gates v4), Sortino, Calmar, Netto-PnL ÷ Σ eingeplantes Risiko | Rendite je Risiko |
| M3 | max. Drawdown (Tages- und Stundenwerte), längste Erholung, schlechtester Tag, schlechteste Woche, schlechtester Monat | Verlust |
| M4 | Zeit im Markt; Anteil der Stunden mit 0, 1, 2 Positionen; Ø und Spitze des Notionals; Ausnutzung des Deckels gesamt und solange investiert (Zerlegung aus Abschnitt 2) | Kapitalbindung, „ungenutzt oder fehlende Signale“ |
| M5 | längste Verlustserie, Tage mit gleichzeitigem Verlust von BTC und ETH, Häufigkeit eines Verlusts nach einem Verlust gegenüber der Grundrate, Expected Shortfall 95 % (Tag) | Verlustcluster, Tail; Prüfung des Kanals von B |
| M6 | Stops mit Füllung durch eine Kurslücke: Anzahl, Ø und größter Fehlbetrag in R und in % Equity | Lückenrisiko, historisch |
| M7 | Rendite je Kalenderjahr und je Regime-Phase, Vorzeichen-Konsistenz | Stabilität |
| M8 | Auslösungen von R-010, R-021 und Gruppen-Kill; Anteil der Gate-Stunden mit Sperre; Ablehnungen je Regel; Einstiege, die von R-013/R-014/R-015/Kasse gekappt wurden; gegenüber A weggefallene Trades | Regelwirkung |
| M9 | Notional, Kappung und Ergebnis in R nach Stopabstand (< 2,5 %, 2,5–6 %, 6–10 %, > 10 %) | unterschiedliche Stopabstände |
| M10 | Kosten absolut und als Anteil am Bruttogewinn | Kosten |
| M11 | P bei gleicher Volatilität, S1 und S2; Anteil der Gewinne aus Haltedauern unter einem Jahr (DE-Steuer, § 23 EStG, nur Bericht) | wirtschaftliche Einordnung |

## 5. Kriterien, Klassen, Abbruch

### 5.1 Entscheidendes Kriterium zuerst: K1 Kontrollierbarkeit

K1 wird für B je Platz zuerst ausgewertet. Renditekennzahlen werden erst
berichtet, wenn K1 auf dem Challenger-Platz besteht.

| | Bedingung (alle nötig) |
|---|---|
| K1a | max. Drawdown von B ≤ DD_max + 2 pp (Toleranz für Lücken und Kosten), in beiden Fenstern |
| K1b | Lückenprobe: größter gleichzeitiger Notional-Bestand × 20 % ≤ F2 = 5 % der Platz-Equity (E3) |
| K1c | Anteil der Stunden mit offenem Gate, in denen ein Kill Switch Einstiege sperrte, ≤ 10 % (E4) |
| K1d | technisch: 0 `ERROR` von R-024/R-026, 0 Ledger-Verstöße |

- K1b ist eine reine Bestandsrechnung auf dem Exposure-Pfad, keine Rendite.
  −20 % in einer Stunde ist eine angenommene extreme Lücke. Dokumentiert sind
  Bewegungen bis rund 46–48 % in 24 h (2020-03); in diesem Tempo greifen aber
  die stündlichen Stops.
- **Erwartung, offen benannt:**
  - Beim Champion dürfte K1b scheitern. Enge Stops (ab 1,75 %) treiben das
    Notional bei 0,50 % Risiko an die Grenzen R-014 (20 %) und R-015 (30 %).
    30 % × 20 % = 6 % > 5 %.
  - Schon heute (A) kann der Champion rund 28 % Notional halten. Das
    Lückenrisiko kommt also aus dem engen Stop, nicht aus dem Budget.

### 5.2 Allokationskriterien (nur wenn K1 besteht)

Ausgewertet je Platz, primär im Fenster Entdeckung + Validierung, mit
gleichem Vorzeichen im Holdout.

| | Kriterium | Schwelle |
|---|---|---|
| K2 | eigenes α von B gegen C (Monatsrenditen, Newey-West, Lag 3) | t ≥ √(2·ln 59) = **2,86** |
| K3 | Verlustrand bei gleicher Volatilität: max. Drawdown B ≤ 0,8 × C\* **und** Expected Shortfall 95 % B ≤ C\* **und** Netto p. a. B ≥ C\* − 0,5 pp | alle drei |
| K4 | Stabilität: B schlägt C\* bei gleicher Volatilität in mindestens zwei Dritteln der Kalenderjahre des Primärfensters mit mindestens 5 geschlossenen Trades (2022 hatte beim Challenger keinen `RISK_ON`-Tag) | – |

### 5.3 Klassen

| Klasse | Bedingung | Bedeutung |
|---|---|---|
| `ALLOKATIONSVORTEIL` | K1, K4 und (K2 oder K3), auf dem Challenger-Platz | Die Zustandsregel verbessert die Rendite je Risiko oder den Verlustrand über die reine Größe hinaus |
| `NUR_SKALIERUNG` | K1 besteht, aber nicht (K2 oder K3) oder nicht K4 | Mehrertrag nur durch mehr Risiko. Die Risikohöhe ist eine Betreiberentscheidung; die Studie liefert Drawdown-, Kill- und Lückenzahlen dafür |
| `NICHT_TRAGFÄHIG` | K1 scheitert auf dem Challenger-Platz | Selbst die in sich stimmige Stufe 0,50 % ist mit den bestehenden Grenzen nicht kontrollierbar |

- Der Champion bekommt mit denselben Regeln ein eigenes Urteil. Es ändert die
  Hauptklasse nicht.
- **Wirtschaftliche Einordnung,** unabhängig von der Klasse und ohne Einfluss
  auf sie: `ÜBER_PASSIV`, wenn B (bzw. C) bei gleicher Volatilität mindestens
  1 pp p. a. über P liegt (Primärfenster in S1; S2 ab 2020-01, soweit `DTB3`
  lokal vorliegt) und im Holdout nicht darunter. Sonst `NICHT_ÜBER_PASSIV`.
  Dazu der Abstand zum Geldmarkt (S2, 2020-01 – 2026-09).

### 5.4 Abbruch und Halt

- **D1:** A muss Vergleich A exakt reproduzieren, sonst Halt vor jeder
  Auswertung.
  - Entdeckung + Validierung: Champion 138 Trades, −543,57 USDT; Challenger
    122 Trades, +2 529,73 USDT; Gruppe 61 986,16 USDT.
  - `outputHash` je Portfolio `51f5600b933d…` bzw. `a4667adb8f37…` (mit
    und ohne Stufe 2 gleich).
  - Holdout: 85 bzw. 80 Trades, Lauf-Hash `2a8b05fb…`.
  - Weicht ein Hash nur wegen einer späteren, dokumentierten Codeänderung
    ab, müssen Trades, PnL und Equity-Kurven trotzdem exakt gleich sein. Die
    Abweichung ist vor jeder Auswertung zu erklären.
- **D2:** Mit ausgeschaltetem Forschungsschalter sind alle bestehenden
  Golden-, Replay- und Portfolio-Tests bitgleich. Sonst Halt.
- **D3:** K1d verletzt → Halt (technischer Fehler, kein Ergebnis).
- **Ein Lauf.** Höchstens ein technischer Korrekturlauf bei nachgewiesenem
  Implementierungsfehler, mit Freigabe des Betreibers und bitgleicher
  Reproduktion aller nicht betroffenen Werte (wie bei der relativen Stärke).
- **Keine Nachjustierung:** kein anderes r_max, kein anderes DD_max, keine
  andere Zustandsgröße nach Kenntnis der Ergebnisse. Das wäre eine neue
  Studie mit neuer Vorregistrierung und bewertbar nur auf Forward-Daten.

## 6. Risikomodell und Stressfälle

| Risiko | Abbildung |
|---|---|
| Gleichzeitige BTC/ETH-Positionen, Korrelation | R-015 (30 % Gruppe) unverändert; M5 zählt gemeinsame Verlusttage; Korrelation nur als Bericht |
| Tages- und Gesamtverlust | R-010 (1 % inklusive unrealisierter Verluste) unverändert; Gesamtverlust: DD_max nur in B. C hat bewusst keine Grenze und zeigt, was ohne sie passiert. Für C wird zusätzlich berichtet, wann ein virtueller Stopp bei DD_max gegriffen hätte |
| Kill Switch, Portfolio-Regeln | R-010, R-021, Gruppen-Kill (Stufe 2), Freigabe nach 24 h wie in Vergleich A (`killSwitchReviewHours`) |
| Slippage bei größeren Positionen | Kostenmodell der Evolution (10 bp Gebühr, Spread 1 bp, Slippage 3 bp, Teilnahme ≤ 1 % des Kerzenvolumens) unverändert. Bei höchstens 8 000 USDT Notional je Platz (R-013) ist eine Größenwirkung nicht zu erwarten. Stress: Kosten × 2 und Slippage × 5, analytisch auf denselben Trades |
| Unterschiedliche Stopabstände | M9; der Champion mit Stops ab 1,75 % ist der kritische Fall |
| Kurslücken, schnelle Bewegungen | historisch: Stopfüllung zum ungünstigen Eröffnungskurs bei einer Lücke (`exit-resolution-v1.ts`), M6. Hypothetisch: K1b (−20 %), dazu −45 % als Bericht |
| Verfügbares Kapital, Liquidität | Kassen-Kappung der Positionsgröße und R-025 unverändert; M8 zählt Kappungen. Kein Hebel: höchstens 40 % brutto (R-013) |
| Nicht abgebildet | Ausfall des Handelsplatzes, Stablecoin, Steuern, EUR/USD. Benannt, nicht modelliert |

## 7. Daten und Fenster

| Daten | Zeitraum | Status | Rolle |
|---|---|---|---|
| BTCUSDT/ETHUSDT Spot 1h/4h/1d, lokale Snapshots (Datenstand wie in Vergleich A) | 2018-04-01 – 2023-12-31 | **vorbelastet** (Entdeckung + Validierung, Gates v2–v4, Analysen) | Primärfenster |
| dieselben | 2024-01-01 – 2026-10-14 | **vorbelastet** (Holdout `PREVIOUSLY_ANALYZED`, Carry, relative Stärke) | Sekundärfenster, nur Vorzeichen |
| `DTB3` (vorhanden aus Carry/relativer Stärke) | 2020-01 – 2026-09 | bekannt | S2 nur in diesem Zeitraum; davor und danach kein S2 (kein Download) |
| Forward ab 2026-10-15 | – | gesperrt (Lader verwirft) | nicht verwendet |

- **Kein Download.** Alle Daten liegen lokal.
- **Folge der Vorbelastung:**
  - Ein positives Ergebnis von B ist kein unabhängiger Nachweis, nur ein
    Hinweis.
  - Belastbar wird es erst forward, mit einem eigenen Shadow-Teilnehmer in
    getrennter Kohorte (eigene Freigabe und ADR, `OFFICIAL_V1` bleibt
    unberührt).
  - Für die Risikogrößen (Volatilität, Lückengrößen, Kill-Häufigkeit) sind die
    Daten tauglicher als für Mittelwerte.

**Mehrfachtest:**

| Prüfung | Wirkung auf N |
|---|---|
| Phase 1: B auf Challenger- und Champion-Platz (zwei Urteile) | **57 → 59**, Schwelle 2,86 |
| A, C, C\*, P | keine: Bestand und Referenzen, nie „bestanden“; C hat konstruktionsbedingt nahezu die Sharpe von A |
| Spätere Betreiberentscheidung für eine Risikostufe ohne Auswahl über Renditen | keine |
| Jede weitere B-Variante (anderes r_max, DD_max, andere Zustandsgröße) | +1 je Variante, neue Vorregistrierung |
| Späterer Forward-Teilnehmer mit derselben B-Konfiguration | keine (dieselbe Konfiguration, neue Daten) |
| Technischer Korrekturlauf | keine |

## 8. Technische Umsetzung und Aufwand

> **Stand 2026-10-18: so nicht ausführbar.** Mit
> [ADR 0021](../decisions/0021-risk-limit-set-value-integrity.md), Option A
> (`risk-rules-v1/1.4.0`, Branch `claude/risk-limit-integrity-draft`, noch
> nicht übernommen) prüft R-026 jedes Feld des Limit-Sets gegen
> `RISK_LIMIT_SET_V1`. Ein Replay-Snapshot mit `maxRiskPerTradePct = rₜ`
> endet dann in `ERROR`, und K1d hält die Studie an. Es gibt bewusst keine
> Ausnahme und kein Flag. Eine spätere Untersuchung braucht einen separat
> freizugebenden, isolierten Research-Pfad mit eigener Policy-Identität
> (ADR 0021, S1, zurückgestellt). Der Rest dieses Abschnitts beschreibt den
> ursprünglichen Plan.

**Machbarkeit mit vorhandenem Code: ja, ohne Änderung an der Risk Engine.**

- `runPortfolioReplay` (`packages/shadow-replay/src/portfolio-replay.ts`)
  bildet Vergleich A bereits ab: je Strategie ein Portfolio, Gruppenprüfung,
  Kill Switch mit Review-Verzögerung, Trades mit `plannedRiskAmount`,
  Stop-, Ein- und Ausstiegspreis sowie Equity-Kurven je Portfolio und Gruppe.
- Der Replay baut den Risk-Snapshot selbst (`replay-core.ts`,
  `buildRiskSnapshot`, `riskLimitSet` ab Zeile 1464, heute aus
  `RISK_LIMIT_SET_V1`). Die unveränderte Risk Engine liest
  `maxRiskPerTradePct` aus dem Snapshot: für die Größe, für R-009 und für
  R-024.
- **Forschungsschalter (additiv, standardmäßig aus):** eine optionale
  `riskBudgetPolicy` in der Replay- und Portfolio-Konfiguration. Sie setzt je
  Bewertung `maxRiskPerTradePct = rₜ`.
  - C: konstant 0,005.
  - B: aus `equity` und `highWaterMark`, die `buildRiskSnapshot` schon
    erhält.
  - Alle übrigen Regeln, Kappungen und Kosten laufen unverändert.
  - Vorbild ist der vorhandene `regimeExit`-Hook.
- **R-024 bleibt erfüllt.** Nach einem Verlust sinkt in B und C das Budget mit
  der Equity und (in B) mit dem Drawdown.
- **R-026 prüft den Prozentwert nicht.** Es vergleicht nur die ganzzahligen
  Grenzen und den gespeicherten Hash-Text (`rules.ts`, rund Zeile 1978–1998).
  Der Schalter läuft deshalb ohne Fehler.
  - Er muss Läufe aber eindeutig als Forschung kennzeichnen: Identität
    `RISK_BUDGET_V1:B` bzw. `:C`, Policy-Hash im Manifest.
  - Nebenbefund für eine eigene Prüfung: Weder R-026 noch die
    Eligibility-Prüfung (`shadowEligibility.ts:1172-1174`) gleichen die
    Prozentwerte eines gespeicherten Limit-Sets mit `RISK_LIMIT_SET_V1` ab.
    Hier nur benannt, nicht geändert.

**Schritte und Aufwand (je mit eigener Freigabe):**

| Schritt | Inhalt | Aufwand | Daten |
|---|---|---|---|
| 1.1 | Schalter in `shadow-replay` mit Tests: Standardpfad bitgleich (D2), synthetische Tests für C, B, Untergrenze und R-024 | 1 Sitzung | synthetisch |
| 1.2 | Läufer auf Basis von `apps/evolution-worker/src/validation/run.ts` (A, B, C, beide Fenster, Export der Trades und Equity-Kurven) und Auswertungsskript (Python, Standardbibliothek, Bausteine aus Carry und relativer Stärke: Newey-West, `DTB3`, passive Referenz) | 1–1,5 Sitzungen | synthetisch |
| 1.3 | D1-Prüfung: A auf echten lokalen Daten reproduzieren | ½ Sitzung, rund 20–40 min Rechenzeit | lokal, bekannt |
| 1.4 | der eine Auswertungslauf B und C (zuerst K1) | ½ Sitzung, rund 1 h Rechenzeit (Vergleich A: 17,4 min je Fenster und Szenario) | lokal, vorbelastet |
| 1.5 | Ergebnisbericht | ½ Sitzung | – |

- **Gesamt rund 3–4 Sitzungen, 0 USD.** Kein Gates v5, keine Migration, kein
  VPS.
- **Kleinster sinnvoller erster technischer Schritt:** Schritt 1.1. Er
  braucht keine echten Daten und keine Rendite. Ein Testergebnis „Standardpfad
  bitgleich“ ist zugleich die Garantie, dass Champion, Challenger und
  `OFFICIAL_V1` unberührt bleiben.

## 9. Hat D1 mehr Potenzial als eine weitere Einstiegsstrategie?

| | weitere Einstiegsfamilie (Long, `RISK_ON`, BTC/ETH) | D1 |
|---|---|---|
| Was sie liefern kann | eigenes α; nötig IR ≈ 1,2 gegen den Bestand | keinen neuen Vorteil, aber die Zahlen für die größte Stellschraube: Risikohöhe und Drawdown-Steuerung |
| Bisherige Evidenz | Pullback: 100 % der Einstiege bei offener Challenger-Position oder binnen ±24 h, α t −0,34; Ausbruch 10 von 10 Validierungen gescheitert | Budget bei 0,048 % gleichzeitigem Risiko, Exposure-Grenzen nie bindend |
| Datenlage | Historie verbraucht | Historie verbraucht, für Risikogrößen aber tauglich |
| Aussicht auf `BESTANDEN` | grob unter 10 % | `ALLOKATIONSVORTEIL` grob 15–25 %, `NUR_SKALIERUNG` grob 60–70 %, `NICHT_TRAGFÄHIG` grob 10–20 % (Einschätzung) |
| Nutzen bei Misserfolg | gering: noch eine geschlossene Familie | hoch: belastbare Grundlage für die Risikoentscheidung, plus ein getesteter Drawdown-Stopp |

**Urteil:** Ja, D1 hat mehr Potenzial, aber nur in einem bestimmten Sinn. Es
verbessert die Entscheidung über die Risikohöhe, nicht die Signale.

- Bei `NUR_SKALIERUNG` würde C die absolute Rendite gegenüber A etwa
  verdoppeln, und den Drawdown auch.
- Ob der Betreiber das will, ist eine Risikoentscheidung, keine
  Forschungsfrage.
- Eine neue Einstiegsstrategie unter denselben drei Wänden hätte nach allen
  bisherigen Befunden weniger Aussicht und weniger Nutzen.

## 10. Entscheidungen des Betreibers vor dem Einfrieren

| # | Entscheidung | Empfehlung | Alternative |
|---|---|---|---|
| E1 | Obergrenze r_max für B und Niveau von C | **0,50 %** (= R-010 ÷ R-011) | 0,375 % (vorsichtiger, weniger trennscharf) |
| E2 | Drawdown-Budget DD_max je Platz für B | **5 %**: Die Bremse greift beim Challenger tatsächlich, das macht B gegenüber C trennscharf | 10 %: B läge beim Challenger nahe C, kaum aussagekräftig |
| E3 | Lückenprobe K1b | **−20 % in 1 h, Grenze 5 % der Platz-Equity** | −45 % (dann scheitert fast alles) |
| E4 | Kill-Switch-Dominanz K1c | **≤ 10 %** der Gate-Stunden gesperrt | ≤ 20 % |
| E5 | Bewertungseinheit | **je Platz**, Challenger primär, Champion eigenes Urteil, N 57 → 59 | nur Challenger, N 57 → 58 |
| E6 | „innerhalb der bestehenden Grenzen“ | **alle Regeln unverändert außer dem Wert von R-009** (und damit der R-024-Referenz) | auch R-009 behalten: Dann kann B nur kleiner werden als A, die Studie wäre sinnlos |
| E7 | passive Referenz P | **BTC/ETH 50/50, konstanter Anteil, monatlich zurückgesetzt, volatilitätsgleich, S1 und S2** | Kaufen und Halten ohne Zurücksetzen (Risiko driftet) |

**Nach Freigabe:** E1–E7 in diesen Text übernehmen, einfrieren
(Commit-Hash und Blob-Hash in einem Statusblock), dann Schritt 1.1 mit eigener
Freigabe.

## 11. Was unverändert bleibt

- Risk Engine (`risk-rules-v1/1.3.0`, Limit-Set v1), Champion, Challenger,
  Spezifikations-Hashes, Golden Fixtures;
- Arena und Arena-Policy, Gates v1–v4, Evolution-Split;
- VPS und `OFFICIAL_V1`;
- main.
- Dieser Entwurf hat nur Code und Berichte gelesen. Er hat keine Marktdaten,
  keine Datenbank und keine Forward-Daten berührt.
- Überschläge (Notional aus Risiko und Stop, Lückenprobe, Schwellen für N)
  sind Arithmetik auf dokumentierten Parametern, keine Renditeberechnungen.
