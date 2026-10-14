# 17 — SignalPilot Arena

Die Arena betreibt mehrere unabhängige Strategien (später Trading-Agenten)
parallel. Jede lebt ausschließlich von ihrem eigenen virtuellen Kapital.

**Ziel:** langfristiges, risikobereinigtes Kapitalwachstum nach allen Kosten
maximieren, unter unveränderbaren externen Risikogrenzen.

Arena V1 beobachtet, bewertet und empfiehlt. Sie führt keine Entscheidung
selbst aus.

## Grundsätze

| Ein Agent darf nicht … | Wie das durchgesetzt wird |
|---|---|
| Risk-Limits verändern | Die Risk Engine liegt außerhalb jeder Strategie. Die Arena-Policy ist eigene Konfiguration der Kohorte, gehasht, und nie Teil der Strategieparameter. Die Arena lockert kein Limit. |
| Kill Switches umgehen | Die Arena schreibt keine Session. Kill Switch, `KILLED` und `ERROR_LOCKED` erscheinen als **harter Stopp**. |
| zusätzliches Kapital erzeugen | Kapital ist allein das Portfolio-Ledger. Genau ein `INITIAL_CASH` ist erlaubt; jede weitere Buchung braucht eine Order-, Fill- oder Positionsreferenz. Sonst entsteht der harte Stopp `CAPITAL_INTEGRITY_*`. |
| Verluste zurücksetzen | Bei der Registrierung bleibt alles, wie es ist. `initialCapital` ist unveränderlich. Es gibt keinen Reset-Pfad. |
| historische Performance verändern | Evaluationen sind append-only und je Teilnehmer hash-verkettet. `verify-chain` erkennt jede nachträgliche Änderung (getestet). |
| die eigene Version still ändern | Der Teilnehmer ist an `strategyVersionId` und Hash gebunden. Eine andere aktivierte Version im Portfolio ergibt den harten Stopp `STRATEGY_VERSION_DRIFT`. |

## Domänenmodell (Migration `20261014160000_add_arena`, rein additiv)

| Tabelle | Inhalt |
|---|---|
| `ArenaCohort` | Kohorte mit versionierter, gehashter Policy: Fitness, Evidenz, Survival Floor, Bänder |
| `ArenaParticipant` | eine StrategyVersion in **einem eigenen** Portfolio |
| `ArenaParticipantEvent` | Lifecycle-Historie, append-only: Registrierung und jeder Statuswechsel mit Grund, Akteur und zugrunde liegender Evaluation |
| `ArenaEvaluation` | stündlicher Snapshot, append-only und hash-verkettet: Kennzahlen, Fitness-Aufschlüsselung, Evidenz, Floor, harte Stopps, Empfehlung, Rang |
| `ArenaPostMortem` | Fall mit eingefrorenem Dossier, Hypothese und Nachfolger |

`ArenaParticipant` hält:

- Participant-ID und `participantKey`
- Kohorte und Portfolio (unique)
- StrategyVersion, Strategy-Key und Spezifikations-Hash
- `initialCapital` und `forwardStartAt` (Aktivierung der Session)
- Status
- `parentParticipantId` für die Linie V1 → V2

Das aktuelle Kapital, die Kosten und die Kennzahlen stehen in der jeweils
neuesten `ArenaEvaluation`. Sie werden nie im Teilnehmer dupliziert.

**Erste Kohorte `ARENA_V1`** (`scripts/ops/local-shadow.sh arena bootstrap-v1`):

| Teilnehmer | Status | Portfolio | Forward-Start |
|---|---|---|---|
| `CRYPTO_TREND_CORE_LONG_V1` | `CHAMPION` (Operator-Designation) | `SHADOW_V1` | 2026-10-14T13:59:19.759Z |
| `CRYPTO_REGIME_LONG_V1` | `ACTIVE` | `SHADOW_CHALLENGER_V1` | 2026-10-14T14:41:21.532Z |

## Lifecycle

```
CANDIDATE ──► ACTIVE ──► PROVEN ──► CHAMPION
              │  ▲         │ ▲          │
              ▼  │         ▼ │          ▼
             PROBATION ◄────┴─┴──────────┘
              │
              ▼
            RETIRED  (terminal; ein Nachfolger ist ein neuer Teilnehmer)
```

| Ziel | erlaubte Gründe | Evidenz nötig? |
|---|---|---|
| `ACTIVE` | `FORWARD_TEST_STARTED`, `PERFORMANCE`, `OPERATOR_REVIEW` | nur bei `PERFORMANCE` |
| `PROBATION` | `PERFORMANCE`, `SURVIVAL_FLOOR`, `HARD_STOP`, `OPERATOR_REVIEW` | nur bei `PERFORMANCE`; Floor und harter Stopp müssen real vorliegen |
| `PROVEN`, `CHAMPION` | `PERFORMANCE` | ja; nur ein Champion je Kohorte |
| `RETIRED` | `PERFORMANCE`, `SURVIVAL_FLOOR`, `STRATEGY_DEFECT`, `OPERATOR_WITHDRAWAL` | ja bei `PERFORMANCE` und `SURVIVAL_FLOOR`; außerdem muss die Session gestoppt sein |

Zwei Regeln aus dem Pflichtenheft folgen direkt aus dieser Tabelle:

- Wegen kurzfristiger Verluste wird niemand vor dem Evidence Gate endgültig
  retired.
- Ein Defekt (Bug) oder ein bewusster Rückzug kann jederzeit dokumentiert
  werden.

## Fitness (`arena-fitness-v1/1.0.0`, Policy `arena-policy-v1`)

Jede Komponente ist ein Score in [0, 1], wobei 0,5 neutral ist. Die meisten
nutzen `squash(x, ref) = 0,5 + 0,5 · tanh(x / ref)`. Grundgröße ist die
konservativ bewertete Equity E (Mark-to-Market mit Liquidationskosten) gegen
das eigene Startkapital E₀, also immer nach allen Kosten.

| Komponente | Gewicht | Messwert → Score |
|---|---:|---|
| Kapitalwachstum | 30 | g = ln(E/E₀) · 365 / max(Tage, 30) → squash(g, 0,05) |
| Wachstum je Drawdown | 25 | g / max(−ln(1−DD), −ln(0,99)) → squash(·, 1) |
| Max. Drawdown | 15 | 1 − (−ln(1−DD)) / (−ln(0,9)), wobei DD aus der stündlichen Kapitalkurve seit Start kommt |
| Profit Factor | 7 | squash(ln PF, ln 2) |
| Ø R | 7 | squash(Ø R, 0,5) |
| Trefferquote vs. Break-even | 4 | squash(Quote − \|Ø Verlust\|/(Ø Gewinn+\|Ø Verlust\|), 0,10) |
| Größte Verlustserie | 4 | 1 − Serie/10 |
| Kosten | 4 | 1 − Kosten / (Netto-PnL + Kosten), also der Anteil des Vorkosten-Ertrags, den Kosten fressen |
| Wachstum je Zeit im Markt | 4 | g / max(Zeit im Markt, 5 %) → squash(·, 0,20) |

**Rohwert** = min(Σ Gewicht · Score, **Risiko-Obergrenze 50 + 50 ·
Drawdown-Score**). Ein Drawdown ab der Referenz von 10 % bleibt damit
höchstens neutral, egal wie hoch der Gewinn ist. Der Test „+40 % mit 50 %
Drawdown“ landet so bei 50, eine robuste Strategie mit +5 % und 2 % Drawdown
bei 86.

**Fitness** = 50 + Evidenzfortschritt · (Rohwert − 50). Vor dem Evidence Gate
schrumpft sie zur Mitte, damit wenige Glückstreffer nicht vorne landen.

Ohne Trades sind alle handelsabhängigen Komponenten neutral, und die Fitness
ist genau 50. Gespeichert werden Rohwert, Obergrenze und jede Komponente mit
Gewicht, Messwert, Score und Beitrag.

## Evidence Gate

Ausreichende Evidenz liegt vor, wenn einer der beiden Pfade erfüllt ist:

- **Pfad A:** ≥ 30 geschlossene Trades **und** ≥ 30 Tage
- **Pfad B:** ≥ 182 Tage **und** ≥ 10 Trades

Das entspricht der vorab registrierten Vergleichsregel („30 Trades oder 6
Monate“), jeweils mit Untergrenze. Davor ist jede Fitness `PROVISIONAL`, und es
gibt keine Leistungsentscheidung. Harte Stopps und der Survival Floor gelten
sofort. Die Schwellen sind Policy-Werte der Kohorte und lassen sich per
`set-policy` mit Audit-Event ändern. Jede Evaluation speichert den
Policy-Hash, mit dem sie gerechnet wurde.

## Survival Floor und Empfehlungen

Der Survival Floor liegt bei 90 % des eigenen Startkapitals. Es gibt kein
Auffüllen und keine Umverteilung. Die Empfehlungen pro Evaluation, in dieser
Reihenfolge:

1. **Harter Stopp** → `PROBATION`, unabhängig von der Evidenz. Auslöser:
   - `PORTFOLIO_ERROR_LOCKED`, `SESSION_ERROR_LOCKED`, `SESSION_KILLED`,
     `SESSION_MISSING`;
   - `KILL_SWITCH:<Grund>`;
   - `CRITICAL_RISK_EVENTS`;
   - `STRATEGY_VERSION_DRIFT`, `STRATEGY_SPECIFICATION_DRIFT`;
   - `CAPITAL_INTEGRITY_INITIAL_CASH`, `CAPITAL_INTEGRITY_UNEXPLAINED_ENTRY`.
2. **Floor unterschritten** → vor dem Gate `PROBATION`, mit ausreichender
   Evidenz `RETIRE`.
3. Vor dem Gate → `HOLD`.
4. Mit ausreichender Evidenz gelten die Fitness-Bänder:

   | Status | Bedingung | Empfehlung |
   |---|---|---|
   | `ACTIVE` | Fitness < 40 | `PROBATION` |
   | `ACTIVE` | Fitness ≥ 60 und Gewinn | `PROMOTE_PROVEN` |
   | `PROBATION` | Fitness < 35 | `RETIRE` |
   | `PROBATION` | Fitness ≥ 50 | `REINSTATE` |
   | `PROVEN` / `CHAMPION` | Fitness < 40 | `PROBATION` |
   | fittester `PROVEN` | gibt es keinen Champion oder schlägt er ihn um ≥ 5 Punkte | `PROMOTE_CHAMPION`; der bisherige Champion bekommt `DEMOTE_CHAMPION` |

**Rangliste:** nach Fitness, dann Rohwert. Exakte Gleichstände teilen den
Rang (1, 1, 3), damit nie ein Name entscheidet. `CANDIDATE` und `RETIRED`
werden nicht gerankt.

## Betrieb

Der Job `trading:arena-evaluate` läuft stündlich zur Minute 20, nach dem
Performance-Refresh um :15. Scope `MONITORING`, Flags `TRADING_ARENA_ENABLED`
und `TRADING_ARENA_SCHEDULE_ENABLED`. Er schreibt nur `ArenaEvaluation`.

```
scripts/ops/local-shadow.sh arena bootstrap-v1 --actor=<name>
scripts/ops/local-shadow.sh arena evaluate
scripts/ops/local-shadow.sh arena transition --participant=<id|key> --to=PROBATION --reason=OPERATOR_REVIEW --actor=<name> --idempotency-key=<key> [--note=…]
scripts/ops/local-shadow.sh arena export-dossier --participant=<id|key> [--out=datei.json]
scripts/ops/local-shadow.sh arena record-hypothesis --case=<id> --author=<name> --text=… [--proposed-strategy-key=…]
scripts/ops/local-shadow.sh arena register --cohort=ARENA_V1 --portfolio=<key> --status=CANDIDATE|ACTIVE --parent=<participant> --actor=<name>
scripts/ops/local-shadow.sh arena verify-chain --participant=<id|key>
```

Das Dashboard zeigt unter `Trading → Arena` (API `GET /trading/arena`):

- Rangliste der Teilnehmer;
- Policy der Kohorte und aktuelles Regime;
- je Teilnehmer alle Kennzahlen, die Fitness-Aufschlüsselung,
  Lifecycle und Post-Mortems;
- getrennt und gestrichelt markiert den historischen Replay, der in keine Zahl
  der Arena einfließt.

## Post-Mortem-Grundlage

Ein Übergang nach `PROBATION` oder `RETIRED` legt einen `ArenaPostMortem` an.
Sein Dossier `arena-dossier-v1` ist eingefroren und gehasht. Es enthält:

- Strategie-Parameter und Version;
- Lifecycle;
- jeden Forward-Trade mit Kosten, R, Exit-Grund und **Regime beim Einstieg**;
- die Ablehnungsgründe der Strategie nach Häufigkeit und Kandidaten nach
  Status;
- die Regime-Zeitlinie;
- die tägliche Kapitalkurve und die täglichen Evaluationen.

Danach geht der Fall weiter:

1. `record-hypothesis` hält die Hypothese und die vorgeschlagene neue
   Version fest.
2. `register --parent` verknüpft den Nachfolger als neuen Teilnehmer.
3. Der Fall springt dann auf `SUCCESSOR_REGISTERED`.

Arena V1 programmiert selbst keine Strategie um.

## Spätere Kapitalallokation (vorbereitet, nicht gebaut)

Das Kapital eines Teilnehmers ändert sich heute nur durch eigene Trades.
Eine spätere `CapitalAllocationDecision` würde so aussehen:

- **eigene Tabelle:** Kohorte, Teilnehmer, Evaluation, Betrag, Richtung,
  Grund, Policy-Hash und Genehmigung;
- **genehmigt** von einer übergeordneten Portfolio-/Risk-Schicht mit eigenen
  Gesamtlimits;
- **gebucht** als neuer, referenzierter Ledger-Typ (etwa
  `CAPITAL_ALLOCATION`), damit die Kapital-Integritätsprüfung ihn als erklärt
  erkennt;
- **Grundlage** sind Fitness, Rang und Evidenz der Evaluationen, also nur
  Forward-Daten.

Bis dahin wäre jede solche Buchung ein harter Stopp. Genau das ist gewollt.
