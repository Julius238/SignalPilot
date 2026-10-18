# ADR 0021 – Integrität des Limit-Sets: R-026 prüft die Prozentwerte nicht

- Status: Proposed
- Datum: 2026-10-18
- Entscheidung: Betreiber (offen)
- Bezug: ADR 0003, ADR 0009 · [Dokument 06](../06-risk-engine-specification.md)
  (R-026) · [RISK_BUDGET_V1-Vorregistrierung](../research/2026-10-18-risk-budget-v1-preregistration.md),
  Abschnitt 8 · [Offizieller Forward-Test V1](../research/official-forward-test-v1.md)

> **Entwurf zur Entscheidung.** Dieser ADR ändert keinen Code, keine
> Risk-Regel, keinen Test, kein Limit und kein Flag.
> `RISK_RULE_SET_VERSION` bleibt `risk-rules-v1/1.3.0`. Der offizielle
> VPS-Forward-Test bleibt unberührt. Solange der Status „Proposed“ lautet,
> gilt dieser ADR nicht (README: Bei Konflikten gelten _akzeptierte_ ADRs).
> Alle Zeilenangaben beziehen sich auf `eee0af5`.

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
  auf. Die Studie braucht deshalb einen eigenen Forschungseinstieg mit
  expliziter Policy (F2).

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

### Option A – Wertvergleich aller Felder mit `RISK_LIMIT_SET_V1` (empfohlen)

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

### S1 – Eigener Forschungseinstieg mit expliziter Policy (empfohlen)

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

## Konkrete Änderungen (erst nach Freigabe)

| Datei | Änderung | Umfang |
|---|---|---|
| `packages/risk-engine/src/limit-set-integrity.ts` (neu), `index.ts` | `riskLimitSetDeviations` (A) | ~40 Zeilen |
| `packages/risk-engine/src/rules.ts:1980-1999` | R-026 nutzt die Funktion gegen die Referenz aus dem Kontext | ~15 Zeilen |
| `packages/risk-engine/src/evaluate-risk.ts`, `rules.ts` (`RiskEvaluationContext`) | gemeinsame Kernfunktion, `evaluateRiskForResearch`, `policyHash` aus der benutzten Policy (S1) | ~40 Zeilen |
| `packages/risk-engine/src/policy-v1.ts:17-18` | `RISK_RULE_SET_VERSION` → `risk-rules-v1/1.4.0`, `RISK_ENGINE_VERSION` → `risk-engine-v1/1.2.0` (S1 ist neue Engine-API). Der Kopfkommentar beschreibt danach den echten Schutz | 2 Zeilen |
| `packages/risk-engine/test/fixtures/*.json` | über `generate-fixtures.ts` neu erzeugen, nur Versions- und Hash-Felder ändern sich, im Commit begründen | generiert |
| `apps/trading-worker/src/lib/riskInputAssembler.ts:452-478` | Mapping als `riskLimitSetInputFromRow(row)` exportieren, damit alle Stellen dieselbe Dezimaldarstellung prüfen | Umbau, kein Verhalten |
| `apps/trading-worker/src/lib/shadowEligibility.ts:1164-1192` | Check 12 nutzt die Funktion, nennt die abweichenden Felder und verlangt genau eine `ACTIVE`-Zeile | ~20 Zeilen |
| `apps/trading-worker/src/lib/shadowFillPersistence.ts:503-506`, `:671-674` | eine abweichende Zeile behandeln wie eine fehlende: der vorhandene Fail-closed-Pfad | ~5 Zeilen |
| `apps/trading-worker/src/jobs/shadowBootstrap.ts:310-341` | eine vorhandene abweichende Zeile blockiert mit `RISK_LIMIT_SET_CONFLICT`, statt still weiterverwendet zu werden. Vorbild: `shadowStrategySetup.ts:391-402` | ~10 Zeilen |
| `apps/trading-worker/src/lib/shadowRiskPersistence.ts` | speichert nur `policyHash === RISK_POLICY_HASH` (S1) | ~5 Zeilen |
| `docs/trading/06-risk-engine-specification.md` (R-026), RISK_BUDGET_V1-Vorregistrierung Abschnitte 8 und 11 | an die neue Prüfung und den Forschungseinstieg anpassen, *bevor* E1–E7 eingefroren werden | Text |

Bewusst unverändert bleiben:

- der Assembler-Filter in `riskInputAssembler.ts:220`. Eine zweite aktive
  Zeile soll *laut* scheitern (R-026 `ERROR_LOCK`), statt still übergangen
  zu werden;
- die Limitwerte selbst;
- Strategien, Gates, Arena und Schema.

## Testfälle

**Risk Engine (synthetisch, `rules.test.ts`):**

| Nr. | Fall | Erwartung |
|---|---|---|
| T1 | je Dezimalfeld (6×) ein höherer **und** ein niedrigerer Wert, V1-Hash unverändert | R-026 CRITICAL `IDEMPOTENCY_OR_VERSION_CONFLICT`, Ergebnis `ERROR`, `ERROR_LOCK`, genehmigte Menge 0, Feldname in `inputJson` |
| T2 | `key`, `version`, `scope` einzeln geändert | wie T1 |
| T3 | V1-Werte im 12-Stellen-Format (Assembler, Replay) | PASS, sonst gleich wie heute (Schutz vor Textvergleich) |
| T4 | `"2.5e-3"`, `""`, `"-0.0025"`, `"0.0025 "` | Abweichung, keine Exception |
| T5 | Probe P2 (1 % + Kappen 100 %) | `ERROR` statt APPROVED: der rot/grüne Kern-Test |
| T6 | Probe P3 (−1,5 %, `maxDailyLossPct` 0.05) | `ERROR`, kein stilles Passieren des Kill-Switch-Pfads |
| T7 | Golden-Fixtures neu erzeugt | Urteile, Mengen, Regel-Ergebnisse gleich, nur Versions- und Hash-Felder neu |
| T8 | `evaluateRiskForResearch` mit `RESEARCH:`-Satz | PASS gegen sich selbst, `policyHash ≠ RISK_POLICY_HASH` |
| T9 | Forschungssatz an `evaluateRisk` übergeben, `SHADOW_V1` als Forschungsschlüssel | beides abgelehnt |

**Trading-Worker (In-Memory-Fakes):**

| Nr. | Fall | Erwartung |
|---|---|---|
| W1 | Eligibility, Zeile mit V1-Hash und `maxRiskPerTradePct` 0.01 | `ACTIVE_RISK_LIMIT_SET` FAIL, `NOT_READY`, Feld benannt |
| W2 | Eligibility, zwei `ACTIVE`-Zeilen | FAIL |
| W3 | `shadowAssessRisk` mit manipulierter Zeile, echte `Prisma.Decimal`-Werte | Assessment `ERROR`, Session `ERROR_LOCK`, RiskEvent CRITICAL, keine Order |
| W4 | `shadowAssessRisk` mit zweiter aktiver Zeile, höhere Version, V1-Hash | `ERROR`, nicht still verwendet |
| W5 | Fill-Recheck, aktive Zeile mit `minRewardRisk` 1 | Fail-closed-Pfad wie bei fehlender Zeile |
| W6 | Bootstrap, vorhandene `SHADOW_V1` v1 mit abweichenden Werten | blockiert, nichts angelegt oder weiterverwendet |
| W7 | Persistenz einer Bewertung mit fremdem `policyHash` | abgelehnt |
| W8 | Quelltext-Scan von `apps/trading-worker/src` | kein `evaluateRiskForResearch` |
| W9 | vorhandene Teil-Fixtures (`shadowEligibility.test.ts:131`, `shadowExecution.test.ts:107`) | auf vollständige V1-Zeilen ergänzt, sonst würden sie fälschlich rot |

**Replay:**

| Nr. | Fall | Erwartung |
|---|---|---|
| R1 | Standardpfad (D2) | alle Golden-, Replay- und Portfolio-Tests bitgleich. Der Replay-`outputHash` enthält keine Risk-Hashes (`replay.ts:236-243`, `portfolio-replay.ts:552-559`), sollte also gleich bleiben. Das ist bei der Umsetzung zu belegen |
| R2 | Forschungsschalter C und B über S1 | kein R-026-`ERROR`, Größe folgt rₜ, R-024 erfüllt |

## Risiken der Umstellung

| Risiko | Wirkung | Gegenmittel |
|---|---|---|
| Textvergleich statt Wertvergleich | jede echte Zeile (`0.002500000000`) sperrt sofort per `ERROR_LOCK` | Wertvergleich, T3, W3 mit echten `Prisma.Decimal` |
| Fix auf eine abweichende VPS-Zeile deployt | beide offiziellen Sessions gesperrt | erst Z1 Schritt 1, dann deployen |
| Versionssprung 1.3.0 → 1.4.0 | neues `RISK_POLICY_HASH`, neue Golden-Hashes. Die Forward-Test-Dokumente nennen 1.3.0 | Fixtures neu erzeugen und begründen, Eintrag im Änderungsprotokoll. Historische Bewertungen bleiben 1.3.0 (ADR 0003) |
| Strengere Werte werden ebenfalls abgelehnt | eine „vorsichtigere“ Handänderung sperrt auch | gewollt. Jede Limitänderung ist eine neue Version mit ADR |
| Teil-Fixtures im Worker | Tests werden aus falschem Grund rot | W9 |
| `RISK_BUDGET_V1` unverändert gestartet | K1d hält die Studie sofort an | Vorregistrierung vor dem Einfrieren anpassen (S1) |
| Laute Sperre bei einem DB-Versehen | Der Forward-Test steht, bis jemand prüft | gewollt: lieber anhalten als still falsch handeln |
| Neustart des Workers | Downtime-Eintrag nötig | Z1 bevorzugt, sonst Ablauf wie die Probe vom 2026-10-15 |

## Einschätzung des Entwurfs (nicht bindend)

- **F1: Option A.** Sie ist die kleinste Änderung, die gegen eine
  vertrauenswürdige Referenz prüft und bei jeder Abweichung sicher
  ablehnt. B bringt nur zusätzliche Kanonisierung, C nur zusätzlichen
  Betrieb.
- **F2: S1**, im selben Versionssprung wie A. Sonst ist `RISK_BUDGET_V1`
  zwischen den beiden Änderungen blockiert. Die Vorregistrierung ist noch
  nicht eingefroren, die Anpassung kostet also keinen Lauf.
- **F3: Z1.** Erst lesend prüfen, dann auf dem Branch umsetzen. Deployen
  erst nach Entscheidung des Betreibers.

## Was dieser Entwurf nicht ändert

- Risk Engine, Regeln, Limits, Golden Fixtures, `risk-rules-v1/1.3.0`;
- Strategien, Gates v1–v4, Arena und Arena-Policy;
- VPS, `OFFICIAL_V1`, Datenbank, main;
- Die Probe lief nur lokal und synthetisch und wurde wieder entfernt.

## Folgearbeiten nach der Entscheidung

1. Betreiber: lesende Prüfung aus Z1 Schritt 1 auf dem VPS. Das Ergebnis
   kommt ins Änderungsprotokoll von `OFFICIAL_V1`.
2. Umsetzung A + S1 + Worker-Stellen auf eigenem Branch, mit allen Tests
   oben. CI grün, kein Merge nach main ohne Freigabe.
3. Abschnitte 8 und 11 der `RISK_BUDGET_V1`-Vorregistrierung anpassen.
4. **Gleiche Lückenform beim Execution Profile, eigene Prüfung:** R-026
   vergleicht den Hash des Profils nicht, obwohl Dokument 06 das verlangt.
   Eligibility prüft nur das Format des Hashs (`shadowEligibility.ts:739`).
   `feeBps`, `fullSpreadBps` und `slippageBps` steuern Netto-CRV und Größe.
   Die Referenz gibt es im Code bereits:
   - `BOOTSTRAP_EXECUTION_PROFILES` im Bootstrap,
   - `BINANCE_SPOT_VIP0_ESTIMATE_V1` in
     `apps/trading-worker/src/jobs/shadowExecutionProfileCalibrate.ts:60`.
5. Option C (DB-Trigger) erst bei einer Echtgeldstufe neu bewerten.

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
