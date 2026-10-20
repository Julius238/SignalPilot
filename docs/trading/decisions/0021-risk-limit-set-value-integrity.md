# ADR 0021 – Integrität des Limit-Sets: R-026 prüft die Prozentwerte nicht

- Status: Proposed
- Datum: 2026-10-18
- Entscheidung: Betreiber (offen)
- Bezug: ADR 0003, ADR 0009 · [Dokument 06](../06-risk-engine-specification.md)
  (R-026) · [RISK_BUDGET_V1-Vorregistrierung](../research/2026-10-18-risk-budget-v1-preregistration.md),
  Abschnitt 8 · [Offizieller Forward-Test V1](../research/official-forward-test-v1.md)

> **Entwurf zur Entscheidung, Option A umgesetzt, noch nicht übernommen.**
> Option A ist auf dem lokalen Branch `claude/risk-limit-integrity-draft`
> umgesetzt und getestet (Abschnitt „Umsetzung“). Der Branch ist nicht
> gepusht, nicht gemergt und nicht deployt. S1 ist auf Entscheidung des
> Betreibers vom 2026-10-18 zurückgestellt. Der offizielle
> VPS-Forward-Test läuft unverändert mit `risk-rules-v1/1.3.0`. Solange der
> Status „Proposed“ lautet, gilt dieser ADR nicht (README: Bei Konflikten
> gelten _akzeptierte_ ADRs). Die Zeilenangaben in Kontext und Optionen
> beziehen sich auf `eee0af5`.

## Kurzantwort

- **Ja, das ist eine echte Integritätslücke.** Ein gespeichertes Limit-Set
  kann sechs seiner elf Limits sowie `key`, `version` und `scope` ändern und
  trotzdem alle Regeln bestehen, solange der Hash-Text stehen bleibt. Weder
  R-026 noch der Eligibility-Report bemerkt das.
- **Von außen ist sie nicht ausnutzbar.** Nötig ist Schreibzugriff auf die
  Produktionsdatenbank. Die API hat keinen Schreibpfad für Limit-Sets.
- **Schwere heute (Shadow): mittel.** Es geht kein Geld verloren. Still
  verfälscht werden könnten aber die Forward-Test-Evidenz, die Schwelle des
  Kill Switch und das Audit. Das Audit behauptet dann weiterhin die
  V1-Policy.
- **Schwere mit Echtgeld: hoch.** Die Lücke blockiert jede Demo- oder
  Echtgeldausführung.
- **Behebung, minimal:** eine reine Vergleichsfunktion für alle Felder
  gegen `RISK_LIMIT_SET_V1`. Dezimalwerte werden als Wert verglichen, nicht
  als Text. Die Funktion läuft in R-026 und wird in Eligibility,
  Fill-Recheck und Bootstrap wiederverwendet. Es braucht keine Migration
  und keine neue Infrastruktur.
- **Konflikt:** `RISK_BUDGET_V1` baut in Abschnitt 8 genau auf dieser Lücke
  auf. Nach der Korrektur ist die Studie wie vorregistriert nicht
  ausführbar. Sie braucht einen separat freizugebenden, isolierten
  Research-Pfad (F2, zurückgestellt).

## Kontext

### Der Befund in einem Satz

R-026 vergleicht den gespeicherten `specificationHash` als Text mit dem
Konstanten-Hash und die fünf ganzzahligen Limits mit `RISK_LIMIT_SET_V1`.
Die sechs Dezimal-Limits, die Sizing, R-008, R-009, R-010, R-013 bis R-015
und R-024 steuern, vergleicht es nicht. Ebenso wenig vergleicht es `key`,
`version` und `scope`.

### Wie Limits heute entstehen, geladen, gehasht und geprüft werden

| Stufe | Ort | Was passiert | Was nicht passiert |
|---|---|---|---|
| Referenz | `packages/risk-engine/src/policy-v1.ts:97-112` | `RISK_LIMIT_SET_V1` als eingefrorene Code-Konstante (Dokument 06, „Verbindliches Limitset v1“) | – |
| Erwarteter Hash | `policy-v1.ts:152-153` | `buildSpecificationHash(RISK_LIMIT_SET_V1)` beim Laden des Moduls: `ff9ab296…`, derselbe wie im Forward-Test-Dokument | wird nie aus gespeicherten Werten berechnet |
| Anlage | `apps/trading-worker/src/jobs/shadowBootstrap.ts:310-341` | legt `SHADOW_V1` v1 mit den Konstanten an: typisierte Spalten, `parametersJson` = Konstante, `specificationHash` = Konstanten-Hash | eine **vorhandene** Zeile wird ungeprüft weiterverwendet (`existingLimitSet ??`) |
| Speicherung | `packages/database/prisma/schema.prisma:1629-1662`, Migration `20260802090000…:316-345` | drei Darstellungen derselben Limits: typisierte `Decimal(30,12)`-Spalten, `parametersJson`, Hash-Text | kein CHECK, kein Trigger, keine Unveränderlichkeit. `activeScopeKey` ist nullbar, mehrere `ACTIVE`-Zeilen sind möglich |
| Laden | `apps/trading-worker/src/lib/riskInputAssembler.ts:220-223`, `:452-478` | höchste `version` mit `status ACTIVE` und `scope PORTFOLIO`, Spalten unverändert in den Snapshot (`toFixed(12)`) | kein Filter auf `key`, kein Abgleich |
| Prüfung im Lauf | `packages/risk-engine/src/rules.ts:1964-1999` (R-026) | `status`, Hash-Text, fünf Ganzzahlen | sechs Dezimalwerte, `key`, `version`, `scope` |
| Bericht | `apps/trading-worker/src/lib/shadowEligibility.ts:1164-1192` | sucht `SHADOW_V1` v1 `ACTIVE` und vergleicht den Hash-Text | keine Werte. Eine zweite aktive Zeile bleibt unsichtbar. Der Bericht ist kein Gate im Handelslauf |
| Session-Aktivierung | `packages/trading-domain/src/state-machines.ts:253-257`, `apps/trading-worker/src/lib/shadowSessionOps.ts:625` | genau eine `ACTIVE`-Zeile, aber nur beim Übergang auf `SHADOW_ACTIVE` | keine Werte, keine Prüfung während laufender Sessions |
| Fill-Recheck (ADR 0009) | `apps/trading-worker/src/lib/shadowFillPersistence.ts:503-506`, `:671-674` | liest `minRewardRisk` frisch aus der höchsten `ACTIVE`-Zeile, gleich welcher `key` und `scope` | weder Hash noch Werte |
| Audit | `apps/trading-worker/src/lib/shadowRiskPersistence.ts:184`, `packages/risk-engine/src/evaluate-risk.ts:365` | `inputsJson` speichert den vollständigen Snapshot. `policyHash` ist **immer** `RISK_POLICY_HASH` | `policyHash` beschreibt die eingebaute V1-Policy, nicht die tatsächlich benutzten Werte |

**Zur Frage „Hash berechnet oder nur Text verglichen“:** Der Hash wird nur
aus der Code-Konstante berechnet. Der gespeicherte Hash ist ein Text, den
der Bootstrap geschrieben hat, und niemand rechnet ihn aus den gespeicherten
Werten nach. Die Engine liest ausschließlich die typisierten Spalten,
`parametersJson` liest niemand. Alle drei Darstellungen können daher
unbemerkt auseinanderlaufen.

### Synthetische Probe

Die Probe war ein Testfile in der Risk-Engine-Suite, ohne DB und ohne echte
Daten, basierend auf `buildApprovableSnapshot`. Sie lief auf `eee0af5` und
ist nicht committet: Sie hält den heutigen Zustand fest und wäre nach dem
Fix rot. Den Quelltext übernimmt die Umsetzung als Testfälle T1–T6.

Alle Fälle unten tragen den unveränderten V1-Hash `ff9ab296…`.

| Fall | Änderung | R-026 | Ergebnis |
|---|---|---|---|
| Basis | – | PASS | APPROVED, 0,04024 BTC, Risiko 24,998 USDT (Budget 25), gekappt durch `RISK_BUDGET` |
| P1 | `maxRiskPerTradePct` 0.01 | PASS | APPROVED, 0,08286 BTC, Risiko 51,48 USDT, gekappt durch die 20-%-Asset-Exposure |
| P2 | wie P1, dazu alle drei Exposure-Kappen auf 1 (100 %) | PASS | APPROVED, 0,16097 BTC, Risiko 99,999 USDT, also **4,0 × V1**. `policyHash` bleibt `c8c0fefa…` (V1) |
| P3 | `maxDailyLossPct` 0.05, Tages-PnL −150 USDT (−1,5 %) | PASS | R-010 PASS. Mit V1: FAIL `DAILY_LOSS_LIMIT_REACHED` und `ENGAGE_KILL_SWITCH` |
| P4 | `minRewardRisk` 1, Take Profit des 2R-Plans | PASS | R-008 PASS statt BLOCK, gesamt APPROVED |
| P5 | `key` `SOMETHING_ELSE`, `version` 99, `scope` `STRATEGY` | PASS | APPROVED |
| P6 | Equity 10 000 → 9 900 nach Verlust, vorheriges Risiko 24,90 USDT, dann wie P2 | PASS | R-024 PASS bei 99,00 USDT Risiko. R-024 rechnet mit dem *aktuellen* Prozentwert und sieht die Erhöhung nicht |
| P7 | V1-Werte im 12-Stellen-Format (`0.002500000000`), wie Assembler und Replay sie liefern | PASS | APPROVED, die Kontrolle für den Fix |
| Skizze | Wertvergleich (Option A) gegen beide Formate und 14 Abweichungen | – | akzeptiert beide Formate und lehnt alle 14 Varianten ab, auch `2.5e-3`, `""` und negative Werte |

Ergebnis: 10 von 10 Probe-Tests grün. Die Lücke ist damit bestätigt.

### Betroffene Felder

| Feld | Wirkt auf | Folge einer Lockerung | Von R-026 geprüft |
|---|---|---|---|
| `maxRiskPerTradePct` | Sizing (`evaluate-risk.ts:225`), R-009 (`rules.ts:802`), R-024 (`:1738`) | größere Positionen. R-024 schützt nicht | **nein** |
| `maxDailyLossPct` | R-010 (`:864-866`), Auslöser des Kill Switch | Tages-Kill erst später | **nein** |
| `minRewardRisk` | R-008 (`:723-725`), Fill-Recheck | schlechtere CRV werden genehmigt | **nein** |
| `maxGrossExposurePct` | Sizing, R-013 (`:1066`) | höhere Gesamtexposure | **nein** |
| `maxAssetExposurePct` | Sizing, R-014 (`:1077`) | Konzentration in einem Asset | **nein** |
| `maxCorrelatedExposurePct` | Sizing, R-015 (`:1102`) | BTC+ETH zusammen über 30 % | **nein** |
| `key`, `version`, `scope` | Identität, Assessment-Key | eine fremde Zeile gilt als V1 | **nein** |
| `maxOpenPositions`, `maxNewTradesPerDay`, `maxConsecutiveLosses`, `maxSpreadBps`, `maxSlippageBps` | R-011, R-012, R-021, R-018, R-019 | – | ja (`:1987-1993`) |
| `status` | – | – | ja |

### Zweiter Weg: eine zusätzliche aktive Zeile

Die bestehende Zeile muss man gar nicht ändern. Es reicht eine neue Zeile
mit `status ACTIVE`, `scope PORTFOLIO`, höherer `version` und kopiertem
Hash-Text. `activeScopeKey` bleibt dabei `NULL`, der Unique-Index erlaubt
mehrere `NULL`. Die Folgen:

- Der Assembler nimmt die neue Zeile, weil er nach höchster Version sortiert.
- Der Fill-Recheck nimmt sie ebenfalls.
- Eligibility findet weiterhin die echte `SHADOW_V1` v1 und meldet `READY`.
- R-026 prüft `key` und `version` nicht.
- Erst eine *neue* Session-Aktivierung scheitert am Zähler. Laufende
  Sessions handeln weiter.

### Warum es nicht auffiel

- Der Kopfkommentar von `policy-v1.ts:8-12` beschreibt den Schutz als
  vorhanden: „so an edited row cannot silently loosen a limit“.
- ADR 0003 sagt: „Ab Freigabe sind … RiskLimitSet … immutable“.
  Durchgesetzt wird das weder in der DB noch im Code.
- Der einzige Test (`packages/risk-engine/test/rules.test.ts:897-925`)
  ändert nur `maxOpenPositions`, eine Ganzzahl, und den Hash. Beides wird
  geprüft, der Test ist also grün und klingt umfassender, als er ist.
- Die Fixtures schreiben die Dezimalwerte als `"0.0025"`, die DB liefert
  `"0.002500000000"`. Ein naiver Textvergleich wäre in Tests grün und in
  Produktion sofort rot gewesen. Vielleicht wurde er deshalb weggelassen.
  Das ist eine Vermutung, kein Beleg.

### Was die Lücke heute begrenzt

- Postgres ist auf dem VPS nicht nach außen offen
  (`docker-compose.prod.yml`, „Postgres is NOT exposed externally“). Kein
  API-Endpunkt schreibt `RiskLimitSet`. Der Bootstrap legt nur an.
- Die ganzzahligen Limits greifen weiter: höchstens 2 Positionen, 4 Entries
  pro Tag und ein Tages-Kill nach 3 Verlusten. Ebenso die Spread- und
  Slippage-Grenzen.
- Spot ohne Hebel (R-006), und das Sizing ist durch `availableCash`
  gedeckelt. Mehr als die Equity kann keine Position binden.
- `inputsJson` jeder Assessment-Zeile enthält den vollständigen Snapshot
  einschließlich der benutzten Limits. Rückwirkend lässt sich also exakt
  prüfen, ob je abweichende Werte benutzt wurden (Abschnitt F3).
- Beim Start von `OFFICIAL_V1` meldete Eligibility `READY`. Das belegt aber
  nur den Hash-Text, nicht die Werte.

Realistische Auslöser sind keine Angreifer von außen, sondern:

- ein manuelles `UPDATE` zum Ausprobieren,
- der Restore eines fremden oder alten Dumps (etwa vom Mac-Shakedown),
- ein Skript, das auf die falsche `DATABASE_URL` zeigt,
- ein fehlerhaftes Daten-Update in einer künftigen Migration,
- eine kompromittierte Maschine. Dann wäre die Lücke aber nur eine von
  mehreren Folgen.

### Auswirkungen

**Shadow (heute).** Es wird kein Geld bewegt. Getroffen wäre der Zweck des
Forward-Tests:

- Positionsgrößen bis zum 4-Fachen bei P2.
- Ein Tages-Kill, der erst bei 5 % statt 1 % greift.
- Genehmigte Trades unter dem Mindest-CRV.

Dashboard, Arena und Performance zeigen diese Ergebnisse als
V1-Ergebnisse, denn das `policyHash` lautet weiter `c8c0fefa…`. Die
Evidenz für Champion und Challenger wäre still verfälscht. Zu erkennen wäre
das nur durch einen gezielten Blick in `inputsJson`.

**Spätere Echtgeldausführung.** Dieselben Werte würden echte Orders
dimensionieren:

- Risiko je Trade beliebig hoch, bis die Equity- und Cash-Kappen greifen.
- Exposure bis 100 % in einem Asset.
- Tagesverlust bis zur gesetzten Schwelle.
- R-024 hält nach einem Verlust nichts auf.

Wer einmal Schreibzugriff auf die DB hat, wählt damit die Risikopolitik
der Ausführung, ohne Code-Review und ohne Audit-Spur im Policy-Hash. Vor
jeder Demo- oder Echtgeldstufe muss die Lücke geschlossen sein.

## Zu entscheiden

- **F1:** Wie wird die Integrität des Limit-Sets geprüft?
- **F2:** Wie wird eine Forschungs-Policy (`RISK_BUDGET_V1`) von den
  produktiven Limits getrennt?
- **F3:** Wann wird die Prüfung eingeführt, gemessen am laufenden
  `OFFICIAL_V1`?

## Optionen zu F1

### Option A – Wertvergleich aller Felder mit `RISK_LIMIT_SET_V1` (empfohlen, umgesetzt)

Eine neue reine Funktion in `packages/risk-engine/src/limit-set-integrity.ts`,
exportiert über `index.ts`:

```ts
const EXACT_FIELDS = [
  "key", "version", "scope",
  "maxOpenPositions", "maxNewTradesPerDay", "maxConsecutiveLosses",
  "maxSpreadBps", "maxSlippageBps"
] as const;
const DECIMAL_FIELDS = [
  "maxRiskPerTradePct", "maxDailyLossPct", "minRewardRisk",
  "maxGrossExposurePct", "maxAssetExposurePct", "maxCorrelatedExposurePct"
] as const;

/** Felder, in denen das Limit-Set von der freigegebenen Policy abweicht; leer = identisch. */
export function riskLimitSetDeviations(
  set: RiskLimitSetInputV1,
  pinned: PinnedLimitSet = RISK_LIMIT_SET_V1,
  pinnedHash: string = RISK_LIMIT_SET_SPECIFICATION_HASH
): readonly string[] {
  const deviations: string[] = [];
  for (const field of EXACT_FIELDS)
    if (set[field] !== pinned[field]) deviations.push(field);
  for (const field of DECIMAL_FIELDS)
    if (!sameDecimal(set[field], pinned[field])) deviations.push(field); // DecimalValue.eq, unlesbar = Abweichung
  if (set.specificationHash !== pinnedHash) deviations.push("specificationHash");
  return deviations;
}
```

R-026 ersetzt den Hash-Vergleich und `limitsMatchPolicy`
(`rules.ts:1980-1999`) durch diese Funktion. Bei einer Abweichung gilt
wie bisher `critical(IDEMPOTENCY_OR_VERSION_CONFLICT)`, also `ERROR` und
`ERROR_LOCK`. Die abweichenden Feldnamen stehen nur im Fehlerfall in
`inputJson`. Der PASS-Pfad bleibt Byte für Byte gleich.

- **Vertrauenswürdige Referenz:** die Code-Konstante. Sie ist über Git,
  Review und Dokument 06 freigegeben. Die DB-Zeile wird geprüft und ist
  nie die Quelle der Wahrheit.
- **Fail-closed:** Jede Abweichung lehnt ab, auch eine *strengere*.
  Authentisch heißt unverändert. Eine gewollte Änderung ist eine neue
  Version mit ADR.
- **Klein:** etwa 40 Zeilen Engine-Code. Keine Migration, kein neues
  Paket, kein Schlüsselmanagement.

### Option B – Hash aus den gespeicherten Werten neu berechnen

`buildSpecificationHash` über die gespeicherten Spalten rechnen und mit
der Konstante vergleichen.

- Mathematisch ist das gleichwertig zu A, aber nur, wenn die Spalten exakt
  wie die Konstante formatiert werden. `0.002500000000` muss dafür zu
  `0.0025` werden und `2.000000000000` zu `2`. Diese Normalisierung ist
  eine neue, fehleranfällige Kanonisierungsregel.
- Ein Hash-Fehlschlag sagt nicht, welches Feld abweicht.
- Den Hash gegen den *gespeicherten* Hash zu prüfen, wäre wertlos: Wer die
  Werte ändern kann, ändert den Hash mit.
- Nicht empfohlen. Der Hash-Text bleibt in A als Identitätsmerkmal
  erhalten.

### Option C – Schutz in der Datenbank (Trigger oder CHECK)

Ein `BEFORE UPDATE`-Trigger lehnt Änderungen an Limit-Spalten einer
`ACTIVE`-Zeile ab. Dazu käme `CHECK (status <> 'ACTIVE' OR "activeScopeKey" IS NOT NULL)`.

- Schließt den Änderungsweg und den Weg über eine zweite Zeile schon beim
  Schreiben.
- Braucht aber eine Migration auf der VPS-Datenbank während
  `OFFICIAL_V1`. Gegen Superuser, Restore oder `DROP TRIGGER` hilft er
  nicht.
- Er prüft auch nicht, ob die Werte stimmen, nur dass sie gleich bleiben.
  Eine falsch angelegte Zeile bliebe falsch.
- Höchstens als Ergänzung später, nicht als Ersatz für A.

### Nicht weiter verfolgt

- **Signierte Zeilen (HMAC mit Server-Schlüssel):** Das wäre neue
  Infrastruktur mit Schlüsselverwaltung. Gegen dieselbe Bedrohung reicht
  der Vergleich mit dem Code.
- **Nur die Eligibility härten:** Der Bericht ist kein Gate im Handelslauf.
  Laufende Sessions würden nichts bemerken.

## Optionen zu F2 (`RISK_BUDGET_V1` und andere Forschungs-Policies)

**Heutiger Plan:** Abschnitt 8 der Vorregistrierung setzt im Replay-Snapshot
`maxRiskPerTradePct = rₜ` und hält ausdrücklich fest, dass R-026 den
Prozentwert nicht prüft und der Schalter „deshalb ohne Fehler“ läuft.

**Mit Option A wäre das ein `ERROR`.** Abbruchkriterium K1d („0 `ERROR`
von R-024/R-026“) würde die Studie sofort anhalten. Die Studie *nutzt* die
Lücke heute also. Nach dem Fix braucht sie einen sauberen Weg.

### S1 – Eigener Forschungseinstieg mit expliziter Policy (empfohlen, am 2026-10-18 zurückgestellt)

- **Gemeinsame Kernfunktion:** `evaluateRisk(snapshot)` bleibt mit
  unveränderter Signatur der einzige produktive Einstieg. Intern ruft er
  eine gemeinsame Kernfunktion mit der Referenz `RISK_LIMIT_SET_V1` auf.
- **Neuer Export für die Forschung:**
  `evaluateRiskForResearch(snapshot, researchLimitSet)`.
  - R-026 vergleicht den Snapshot gegen den übergebenen Satz und dessen
    Hash.
  - Der `key` muss mit `RESEARCH:` beginnen, etwa `RESEARCH:RISK_BUDGET_V1:B`.
    So kann ein Forschungssatz nie als `SHADOW_V1` auftreten.
  - Das `policyHash` der Ausgabe wird über
    `{ ...RISK_POLICY_V1, limitSet: researchLimitSet }` berechnet und ist
    damit nie gleich `RISK_POLICY_HASH`.
- **Wo die Forschungs-Policy lebt:** in `shadow-replay` (Konfiguration
  `riskBudgetPolicy`). Für B baut der Replay je Bewertung einen Satz mit
  `maxRiskPerTradePct = rₜ`, für C einen festen mit 0,005. Ins Manifest
  kommt der Hash der Policy-*Definition* (r_max, DD_max, Formel), nicht der
  Satz je Bewertung.
- **Durchsetzung der Trennung**, zwei kleine Sperren im Worker:
  1. `shadowRiskPersistence.ts` speichert nur Bewertungen mit
     `policyHash === RISK_POLICY_HASH`. Andere lehnt es ab (fail-closed).
  2. Ein Quelltext-Test stellt sicher, dass `apps/trading-worker/src`
     `evaluateRiskForResearch` nirgends verwendet. Vorbild ist
     `apps/dashboard/test/local-setup.test.ts`.
- **Gewinn für die Studie:** K1d bleibt aussagekräftig. R-026 prüft in der
  Forschung tatsächlich, dass der Snapshot der vorregistrierten Policy
  entspricht. Heute ist das ein blinder Fleck.

### S2 – Forschungssätze in der Risk Engine registrieren

Eine Liste zugelassener Sätze, also `SHADOW_V1` und `RISK_BUDGET_V1_C`,
in `policy-v1.ts`.

- Ein fester Satz wie C passt in diese Liste.
- B ändert `rₜ` stetig und passt nicht hinein, ohne eine neue
  Spannen-Semantik in R-026 einzubauen.
- Forschungswerte landeten im produktiven Paket. Nicht empfohlen.

### S3 – Schalter im Snapshot, der R-026 für Forschung lockert

Abgelehnt. Ein Feld im Snapshot ist genau die Art Eingabe, die aus der DB
oder einem Fehler kommen kann. Es würde die Lücke an anderer Stelle neu
öffnen.

## Optionen zu F3 (Zeitpunkt und `OFFICIAL_V1`)

Laut Forward-Test-Regel 1 ist jede Änderung an Regeln eine neue Version
mit neuem Startzeitpunkt. Regel 2 verlangt, Bugfixes getrennt zu
protokollieren. Die Prüfung ändert für die echte Zeile weder ein Urteil
noch eine Menge noch einen Trade. Sie ändert aber `RISK_RULE_SET_VERSION`
und damit `RISK_POLICY_HASH`. Ob das ein protokollierter Bugfix ist oder
eine neue Version, entscheidet der Betreiber.

### Z1 – Jetzt nur lesend prüfen, Fix ohne VPS-Deployment (empfohlen)

1. **Jetzt, Betreiber, nur lesend auf dem VPS** (psql im
   `postgres`-Container wie in Runbook 18). Erwartet wird genau eine Zeile:
   `SHADOW_V1`, 1, `ACTIVE`, `PORTFOLIO`, 0.0025 / 0.01 / 2 / 2 / 4 / 3 /
   0.4 / 0.2 / 0.3 / 20 / 15, Hash `ff9ab296…`.

   `updatedAt` liegt nur Millisekunden nach `createdAt`. Ein späteres
   `updatedAt` deutet auf eine Änderung über Prisma hin. Ein direktes
   SQL-`UPDATE` setzt `updatedAt` aber nicht. Maßgeblich sind deshalb die
   Werte selbst.

   ```sql
   SELECT "id", "key", "version", "status", "scope",
          "maxRiskPerTradePct", "maxDailyLossPct", "minRewardRisk",
          "maxOpenPositions", "maxNewTradesPerDay", "maxConsecutiveLosses",
          "maxGrossExposurePct", "maxAssetExposurePct", "maxCorrelatedExposurePct",
          "maxSpreadBps", "maxSlippageBps", "specificationHash",
          "activeScopeKey", "createdAt", "updatedAt"
   FROM "RiskLimitSet" ORDER BY "version";
   ```

   Rückwirkend über alle Bewertungen. Erwartet wird `0` abweichende,
   `gesamt` ist nur die Kontrollzahl:

   ```sql
   SELECT count(*) AS gesamt,
          count(*) FILTER (WHERE
               (l->>'key') IS DISTINCT FROM 'SHADOW_V1'
            OR (l->>'version') IS DISTINCT FROM '1'
            OR (l->>'maxRiskPerTradePct')::numeric       IS DISTINCT FROM 0.0025
            OR (l->>'maxDailyLossPct')::numeric          IS DISTINCT FROM 0.01
            OR (l->>'minRewardRisk')::numeric            IS DISTINCT FROM 2
            OR (l->>'maxGrossExposurePct')::numeric      IS DISTINCT FROM 0.4
            OR (l->>'maxAssetExposurePct')::numeric      IS DISTINCT FROM 0.2
            OR (l->>'maxCorrelatedExposurePct')::numeric IS DISTINCT FROM 0.3
          ) AS abweichend
   FROM (SELECT "inputsJson"->'snapshot'->'riskLimitSet' AS l FROM "RiskAssessment") s;
   ```

   Ergeben beide Abfragen das Erwartete, ist die bisherige
   `OFFICIAL_V1`-Evidenz in diesem Punkt belegt sauber. Beide Abfragen sind
   in diesem Entwurf nicht ausgeführt worden.
2. **Fix auf einem eigenen Branch** umsetzen und testen: Option A, S1 und
   die Worker-Stellen unten.
3. **Deployment** erst zum Ende von `OFFICIAL_V1` oder mit dessen nächster
   Version. Alternativ früher, wenn der Betreiber die Änderung als
   Bugfix einstuft (Z2).

### Z2 – Fix als protokollierter Bugfix während `OFFICIAL_V1`

- Ablauf: neues Image für den Trading-Worker, Neustart mit `--no-deps`,
  Eintrag im Änderungsprotokoll, Sessions bleiben aktiv.
- Begründung: Die Absicht stand schon vorher in Code-Kommentar, ADR 0003
  und Dokument 06 (R-026: „Risk/Profile-Hashes entsprechen“). Die
  Trade-Folge bleibt gleich.
- Voraussetzung: Schritt 1 von Z1 ist bestanden. Bei einer abweichenden
  Zeile würde der Fix beide Sessions sofort per `ERROR_LOCK` sperren.

## Entscheidungen (Stand 2026-10-18)

- **F1: Option A.** Die Umsetzung hat der Betreiber freigegeben. Sie liegt
  auf dem Branch (Abschnitt „Umsetzung“). Übernommen ist sie noch nicht.
- **F2: S1 ausdrücklich zurückgestellt.** Es gibt keine Ausnahme, kein Flag
  und keinen Forschungseinstieg. Die Folge für `RISK_BUDGET_V1` steht
  weiter unten.
- **F3: offen.** Die tatsächliche `OFFICIAL_V1`-Konfiguration auf dem VPS
  prüft der Betreiber separat.

## Umsetzung (Option A)

Branch `claude/risk-limit-integrity-draft` auf Basis `eee0af5`, nur lokal
committet.

### Was geändert wurde

| Datei | Änderung |
|---|---|
| `packages/risk-engine/src/limit-set-integrity.ts` (neu) | `riskLimitSetDeviations(set)` vergleicht `key`, `version`, `scope`, die fünf Ganzzahlen, die sechs Dezimalfelder und den Hash mit `RISK_LIMIT_SET_V1`. Dezimalwerte über `DecimalValue.eq`. Alles, was kein reiner Dezimaltext ist, zählt als Abweichung. Die Funktion wirft nie |
| `packages/risk-engine/src/rules.ts` (R-026) | ersetzt Hash-Textvergleich und `limitsMatchPolicy`. Eine Abweichung ergibt CRITICAL `IDEMPOTENCY_OR_VERSION_CONFLICT`, `ERROR` und `ERROR_LOCK`. Die Feldliste `riskLimitSetDeviations` steht nur im Fehlerfall in `inputJson` |
| `packages/risk-engine/src/policy-v1.ts` | `RISK_RULE_SET_VERSION` → `risk-rules-v1/1.4.0`. `RISK_ENGINE_VERSION` bleibt `1.1.0`, ohne S1 gibt es keine neue Engine-API. Der Kopfkommentar beschreibt den tatsächlichen Schutz |
| `packages/risk-engine/test/fixtures/*.json`, `test/support/critical-cases.ts` | neu erzeugt, dazu der kritische Fall `limit-set-percent-tampered-with-v1-hash` |
| `apps/trading-worker/src/lib/riskLimitSetIntegrity.ts` (neu) | gemeinsames Zeilen-Mapping `riskLimitSetInputFromRow`: `Prisma.Decimal` → 12 Stellen wie bisher, eine unlesbare Spalte bekommt keinen Ersatzwert `0` mehr. Dazu `riskLimitSetRowDeviations` |
| `apps/trading-worker/src/lib/riskInputAssembler.ts` | nutzt das Mapping, die Auswahl der Zeile bleibt gleich. Der Assembler urteilt nicht: Sein Fehlerpfad wäre ein stilles Überspringen ohne Sperre (`shadowAssessRisk.ts`, `assemblerFailures` setzen den BotRun nicht auf FAILED) |
| `apps/trading-worker/src/lib/shadowEligibility.ts` (Check 12) | verlangt genau eine `ACTIVE`-Zeile, nämlich `SHADOW_V1` v1 ohne Abweichung. Die Felder stehen in `details.deviations` |
| `apps/trading-worker/src/lib/shadowRiskPersistence.ts`, `jobs/shadowAssessRisk.ts` | `engageRiskLimitSetErrorLock` führt das `ERROR_LOCK` von R-026 für diesen Befund aus: Session `ERROR_LOCKED` mit Kill Switch, Portfolio `ERROR_LOCKED`, Audit `SESSION_ERROR_LOCKED` mit Feldliste. Ergänzt werden der CRITICAL-RiskEvent der Persistenz und der BotRun `FAILED` |
| `apps/trading-worker/src/lib/shadowFillPersistence.ts` | eine abweichende Zeile liefert keine vertrauenswürdige Mindest-CRV. Es greift der vorhandene Fail-closed-Pfad mit eigenem Reason Code `POST_FILL_RISK_LIMIT_SET_INVALID`: Fill gebucht, Rest storniert, Position `MARKED` zur Zwangsschließung, CRITICAL RiskEvent. Danach werden Session und Portfolio `ERROR_LOCKED` |
| `apps/trading-worker/src/jobs/shadowBootstrap.ts` | prüft eine vorhandene `SHADOW_V1` v1 vor jedem Schreibzugriff. Bei Abweichung: `RISK_LIMIT_SET_CONFLICT`, BotRun `FAILED`, nichts wird angelegt oder weiterverwendet |
| `docs/trading/06-risk-engine-specification.md` | R-026-Zeile und ein Absatz zum Limitset |
| RISK_BUDGET_V1-Vorregistrierung, Abschnitt 8 | Hinweis: nach dieser Korrektur nicht ausführbar |

### Abweichungen vom Entwurf

- **Neuer Befund: Der Worker führte `ERROR_LOCK` nie aus.**
  - `applyRiskDirective` setzt nur `ENGAGE_KILL_SWITCH` um. `ERROR_LOCK`
    und `BLOCK_NEW` aus der Engine bleiben ohne Wirkung auf die Session,
    und zwar für jede CRITICAL-Regel (R-001, R-003, R-006, R-017, R-023,
    R-026).
  - Dokument 04 verlangt das Gegenteil: „Die Orchestrierung setzt
    Session/RiskEvent/Audit atomar.“
  - Für die Limit-Set-Integrität setzt `engageRiskLimitSetErrorLock` die
    Sperre jetzt gezielt um.
  - Die allgemeine Lücke bleibt offen (Folgearbeit 3). Sie zu schließen
    würde das Verhalten des laufenden Forward-Tests bei anderen Befunden
    ändern.
- **Post-Fill sperrt zusätzlich.** Eine abweichende Zeile wird nicht nur wie
  eine fehlende behandelt.
- **Eine fehlende Zeile wird behandelt wie bisher.** Ohne aktives Limit-Set
  ist keine Bewertung speicherbar, der Fremdschlüssel ist Pflicht. Der Job
  zählt `errored`, der BotRun steht auf `FAILED`, freigegeben wird nichts.
- **S1 ist nicht umgesetzt.** Deshalb bleibt `RISK_ENGINE_VERSION`
  unverändert.

### Tests

| Suite | vorher | nachher |
|---|---|---|
| risk-engine | 98/98 | 114/114 (+16) |
| trading-worker ohne DB | 250/250 | 276/276 (+26) |
| trading-worker mit echter PostgreSQL (arena, jobRunner, leases) | 17 rot, kein `DATABASE_URL` lokal | unverändert 17 rot aus demselben Grund. Diese Suiten berühren keine Limit-Sets. In CI laufen sie mit PostgreSQL |
| shadow-replay | 58/58 | 58/58, Replay-Regressionshashes unverändert |
| evolution | 122/122 | 122/122 |
| arena | 16/16 | 16/16 |
| api | – | 199/199 (nur nach der Änderung gelaufen) |
| evolution-worker | – | lokal nicht gelaufen (braucht PostgreSQL), CI vor jeder Übernahme |
| Lint risk-engine, trading-worker | sauber | sauber |

Die neuen Tests decken diese Fälle ab:

- **Manipulierte Prozentwerte bei unverändertem Hash:**
  - jedes Dezimalfeld um ±1e-12, dazu die Probe-Fälle P1–P4 und P6
    (`limit-set-integrity.test.ts`);
  - Risk-Job mit drei Prozentfeldern;
  - Eligibility und Post-Fill.
- **Falsche Identität:** `key`, `version` und `scope` einzeln, sowohl in der
  Engine als auch im Job, in Eligibility und im Post-Fill.
- **Fehlende, doppelte oder ungültige `ACTIVE`-Sets:**
  - Eligibility: fehlend, `RETIRED`, zwei aktive Zeilen;
  - Job: zweite aktive Zeile mit höherer Version;
  - Engine: `null` und `RETIRED`;
  - der bestehende Job-Test „missing risk limit set“.
- **Ungültige Dezimalwerte:** 16 Varianten, darunter Exponent, leer,
  Leerzeichen, Komma, `+`, `.0025`, `NaN`, 13 Nachkommastellen, Zahl,
  `null` und Objekt.
- **Gültige DB-Darstellungen:** `0.00250`, `2.0`, 12 Stellen,
  `Prisma.Decimal` und Text. Abgedeckt in Engine, Mapping, Eligibility und
  Job.
- **Bootstrap:** eine abweichende Zeile blockiert vor jedem Schreiben, die
  echte Zeile wird weiterverwendet.
- **Post-Fill:** drei Manipulationen sperren, ein sauberer Fill bleibt ohne
  RiskEvent.
- **Gültige `OFFICIAL_V1`-Limits:**
  - Freigabe mit identischer Menge in allen Darstellungen, ohne Sperre;
  - Eligibility `READY`;
  - die Golden-Fixtures.

### Gleiches Verhalten bei gültigen Limits

1. **Golden-Fixtures:** Nach Normalisierung von Versionstext und Hashes sind
   der PASS-Fall und alle zehn bisherigen kritischen Fälle identisch.
2. **Engine-Vergleich über 2 412 gültige Snapshots**, alte Engine (1.3.0,
   `fbe858c`) gegen neue. Variiert wurden:
   - Equity von 123,45 bis 25 000 USDT;
   - beide Take-Profits;
   - BTC und ETH;
   - Tages-PnL von 0 bis −1,5 %;
   - Verlustserie 0, 2 und 3;
   - mit und ohne Vorfreigabe nach Verlust;
   - mit und ohne offene Position;
   - Dezimalformat als Konstante und mit 12 Stellen;
   - SHORT und alle bisherigen kritischen Fälle.

   **0 Abweichungen** in Urteil, Direktive, Reason Codes, Mengen, Sizing
   und allen 26 Regel-Ergebnissen. Abweichen durften nur Versionstext und
   Hashes. Das Vergleichsskript war einmalig und ist nicht committet.
3. **Worker:**
   - Das Snapshot-Mapping für `Prisma.Decimal` ist unverändert
     (`toFixed(12)`).
   - Alle bisherigen Worker-Tests sind grün; nur zwei Teil-Fixtures wurden
     auf vollständige V1-Zeilen ergänzt.
   - Die Payloads eines gewöhnlichen CRV-Shortfalls sind bytegleich.

### Versionssprung, Rollout und `OFFICIAL_V1`

| Größe | Wirkung des Sprungs auf 1.4.0 |
|---|---|
| `ruleSetVersion` neuer Bewertungen und Regel-Ergebnisse | `risk-rules-v1/1.3.0` → `risk-rules-v1/1.4.0` |
| `RISK_POLICY_HASH` | `c8c0fefa…` → `1fda5380e74e246b442ef79eb3086ec7c54a43ed3bd7c425ef644a5e7f4e81e1` |
| `inputHash`/`outputHash` neuer Bewertungen | neu, weil der Snapshot die Version trägt |
| Limit-Set-Hash `ff9ab296…` | unverändert, das Forward-Test-Dokument bleibt korrekt |
| Strategie-Hashes, Arena-Policy-Hash, Portfolios, Sessions, Ledger | unverändert |
| Replay- und Evolution-Hashes | unverändert: Der Replay-Hash enthält keine Risk-Hashes, die Regressionstests sind grün |
| Schema, Migrationen, bestehende DB-Zeilen | keine Änderung, nichts wird umgeschrieben (ADR 0003) |

**Bestehende Sessions:**

- Der Sprung blockiert sie nicht. Weder Session-Aktivierung noch
  Eligibility, Arena, `opsConsistency` oder Circuit Breaker vergleichen
  `ruleSetVersion` oder `RISK_POLICY_HASH`.
- Die Idempotenzprüfung von R-026 vergleicht nur Bewertungen desselben
  Candidates. Jeder bewertete Candidate trägt bereits eine Entscheidung und
  wird nicht erneut bewertet; Assessment, Entscheidung und Status werden in
  einer Transaktion geschrieben.
- Alte Bewertungen bleiben mit 1.3.0 stehen. Dashboard und Audit-Drilldown
  zeigen das Regelwerk je Bewertung.

**Gesperrt würde nur, wenn die VPS-Zeile abweicht.** Dann ist die Sperre
gewollt. Deshalb steht die lesende Prüfung aus Z1 zwingend vor dem
Rollout.

**Rollout-Weg** (nicht ausgeführt, jeder Schritt mit eigener Freigabe):

1. Betreiber: lesende SQL-Prüfung aus Z1. Bei einer Abweichung gibt es
   keinen Rollout, erst wird der Befund geklärt.
2. Betreiber entscheidet F3: entweder ein Bugfix-Eintrag im laufenden
   `OFFICIAL_V1` (Regel 2) oder Übernahme erst mit dessen nächster Version
   (Regel 1).
   - Für den Bugfix spricht: Urteile, Mengen und Trades sind für die echte
     Zeile nachweislich gleich. Es ändern sich nur Identitätsfelder neuer
     Bewertungen.
   - Dagegen spricht: Die eingefrorene Konfiguration nennt
     `risk-rules-v1/1.3.0`.
3. Branch pushen, CI grün einschließlich der DB-Suiten und des
   Evolution-Workers, Review. Danach Merge auf den Entwicklungsbranch, nach
   main nur mit Freigabe.
4. Vollsicherung wie am 2026-10-15. Dann die Images von Trading-Worker und
   API neu bauen; die API importiert Eligibility und Risk Engine. Vorher
   `consistency-snapshot` ausführen, den Trading-Worker mit `--no-deps` neu
   erstellen, nachher `consistency-compare`. Die Downtime kommt ins
   Änderungsprotokoll.
5. Danach prüfen:
   - Eligibility meldet für beide offiziellen Portfolios `READY`;
   - die erste neue Bewertung trägt `risk-rules-v1/1.4.0`;
   - es gibt kein `SESSION_ERROR_LOCKED`-Audit.

**Rollback:** das vorherige Image. Weil es keine Migration gibt, ist das ein
reiner Image-Tausch. Mit 1.4.0 geschriebene Bewertungen bleiben als solche
dokumentiert.

### `RISK_BUDGET_V1` nach dieser Korrektur

- **Wie vorregistriert nicht ausführbar.** Abschnitt 8 setzt im Replay
  `maxRiskPerTradePct = rₜ`. Ab `risk-rules-v1/1.4.0` lehnt R-026 das mit
  `ERROR` ab, und K1d hält die Studie an.
- **Kein Weg vorbei, mit Absicht.** Es gibt kein Flag, keine Ausnahme und
  keinen Forschungseinstieg, denn S1 ist zurückgestellt.
- **Eine spätere Untersuchung** braucht einen separat freizugebenden,
  isolierten Research-Pfad mit eigener Policy-Identität. Der Entwurf S1
  oben kann der Ausgangspunkt sein, mit eigenem ADR oder eigener
  Vorregistrierung.

### Verbleibende Risiken

| Punkt | Einordnung |
|---|---|
| Der Worker führt `ERROR_LOCK` anderer CRITICAL-Regeln nicht aus | offen, eigene Entscheidung nötig (Folgearbeit 3) |
| Execution Profiles ohne Wertprüfung | offen (Folgearbeit 4) |
| Eine abweichende Zeile sperrt ein Portfolio erst bei seinem nächsten Kontakt, also bei einer Bewertung oder einem Fill | Bis dahin kann dort nichts genehmigt werden, und Eligibility meldet sofort `NOT_READY` |
| Wer Schreibzugriff auf die DB hat, kann Zeile und Session wieder entsperren | Entsperren bleibt manuell und auditiert. Eine dauerhaft falsche Zeile sperrt bei jeder Bewertung erneut. Die Code-Konstante lässt sich über die DB nicht ändern |
| Ohne aktives Limit-Set gibt es keine Sperre, nur `errored` und BotRun `FAILED` | unverändert, freigegeben wird nichts |
| DB-Suiten und Evolution-Worker liefen nicht lokal | CI vor jeder Übernahme |
| Strengere Werte werden ebenfalls abgelehnt | gewollt: Jede Limitänderung ist eine neue Version mit ADR |

## Was diese Änderung nicht ändert

- Limitwerte, `RISK_LIMIT_SET_V1`, den Limit-Set-Hash `ff9ab296…` und
  `RISK_ENGINE_VERSION`;
- Strategien, Champion, Challenger, Gates v1–v4, Arena und Arena-Policy;
- Schema, Migrationen, VPS, `OFFICIAL_V1`, die produktive Datenbank, main
  und den gemeinsamen Entwicklungsbranch.

## Folgearbeiten

1. Betreiber: lesende Prüfung aus Z1 auf dem VPS, separat.
2. Betreiber: F3 und Übernahme nach dem Rollout-Weg oben.
3. **`ERROR_LOCK` im Worker allgemein umsetzen:** eigener ADR-Entwurf. Die
   Umsetzung ändert die Reaktion auf R-001, R-003, R-006, R-017 und R-023
   im laufenden Betrieb.
4. **Gleiche Lückenform beim Execution Profile, eigene Prüfung:**
   - R-026 vergleicht den Hash des Profils nicht, obwohl Dokument 06 das
     verlangt.
   - Eligibility prüft nur das Format des Hashs
     (`shadowEligibility.ts:739`).
   - `feeBps`, `fullSpreadBps` und `slippageBps` steuern Netto-CRV und
     Größe.
   - Eine Referenz gibt es im Code bereits: `BOOTSTRAP_EXECUTION_PROFILES`
     im Bootstrap und `BINANCE_SPOT_VIP0_ESTIMATE_V1` in
     `apps/trading-worker/src/jobs/shadowExecutionProfileCalibrate.ts:60`.
5. Ein Research-Pfad für `RISK_BUDGET_V1` nur mit separater Freigabe.
6. Option C (DB-Trigger) erst bei einer Echtgeldstufe neu bewerten.

## Belegstellen (Stand `eee0af5`)

- `packages/risk-engine/src/policy-v1.ts:8-12, 17-18, 97-112, 152-153`
- `packages/risk-engine/src/rules.ts:723-725, 802-857, 864-866, 1012-1135, 1680-1770 (v. a. 1738), 1918-2013 (v. a. 1980-1999)`
- `packages/risk-engine/src/evaluate-risk.ts:178-232, 365, 410`
- `packages/risk-engine/src/position-sizing.ts:251-255`
- `packages/risk-engine/test/rules.test.ts:897-925`
- `apps/trading-worker/src/lib/riskInputAssembler.ts:86-97, 220-223, 452-478`
- `apps/trading-worker/src/lib/shadowEligibility.ts:739, 1164-1192`
- `apps/trading-worker/src/lib/shadowFillPersistence.ts:499-506, 671-703`
- `apps/trading-worker/src/lib/shadowRiskPersistence.ts:184`
- `apps/trading-worker/src/lib/shadowSessionOps.ts:625`, `packages/trading-domain/src/state-machines.ts:253-257`
- `apps/trading-worker/src/jobs/shadowBootstrap.ts:310-341, 446-447`
- `apps/trading-worker/src/jobs/shadowStrategySetup.ts:391-402`
- `packages/database/prisma/schema.prisma:1629-1662`, Migration `20260802090000_add_shadow_trading_domain/migration.sql:316-345, 806, 815`
- `packages/shadow-replay/src/replay-core.ts:1464-1481`, `replay.ts:236-243`, `portfolio-replay.ts:552-559`
- `docs/trading/decisions/0003-deterministic-versioned-engines.md:12`
- `docs/trading/06-risk-engine-specification.md:97`
- `docs/trading/research/2026-10-18-risk-budget-v1-preregistration.md:191, 304-327, 384`
- `docs/trading/research/official-forward-test-v1.md` (Regeln 1–2, Risk-Hash `ff9ab296…`)
