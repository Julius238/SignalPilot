# ADR 0023 – Integrität des Execution Profiles: Kosten und Filter sind ungeprüft

- Status: Proposed
- Datum: 2026-10-18
- Entscheidung: Betreiber (offen)
- Bezug: ADR 0003, ADR 0009, [ADR 0021](0021-risk-limit-set-value-integrity.md)
  (Folgearbeit 4), ADR 0022 (Entwurf: `ERROR_LOCK` im Worker) ·
  [Dokument 06](../06-risk-engine-specification.md) (R-018, R-019, R-026) ·
  [Dokument 07](../07-shadow-execution-model.md) ·
  [Offizieller Forward-Test V1](../research/official-forward-test-v1.md)

> **Entwurf zur Entscheidung, Option W umgesetzt, noch nicht übernommen.**
> Option W ist auf dem lokalen Branch `claude/execution-profile-integrity-draft`
> umgesetzt und getestet (Abschnitt „Umsetzung“). Der Branch ist nicht
> gepusht, nicht gemergt und nicht deployt. Der offizielle VPS-Forward-Test
> läuft unverändert. Solange der Status „Proposed“ lautet, gilt dieser ADR
> nicht. Die Zeilenangaben in Kontext und Optionen beziehen sich auf
> `da5dc66` (ADR 0021, Option A umgesetzt, lokal).

## Kurzantwort

- **Ja, dieselbe Lückenform wie in ADR 0021, nur breiter.** Ein gespeichertes
  `InstrumentExecutionProfile` kann Gebühr, Spread, Slippage, alle Filter,
  `version`, `assetId` und sogar den Hash-Text ändern. R-026 meldet trotzdem
  PASS, Eligibility meldet `READY`.
- **Breiter, weil das Profil an sieben Stellen gelesen wird.** Fünf davon
  liegen außerhalb der Risk Engine: Order, Fill, Exit, Bewertung und
  Eligibility. Eine Korrektur nur in R-026 schließt die Lücke nicht.
- **Vertrauenswürdige Referenz sind die Code-Konstanten.** Aus
  `BOOTSTRAP_EXECUTION_PROFILES` und `BINANCE_SPOT_VIP0_ESTIMATE_V1` ergibt
  `buildSpecificationHash` für BTCUSDT Version 2 exakt `0fba0118…`. Das ist
  der Hash der eingefrorenen `OFFICIAL_V1`-Konfiguration. Code und
  Forward-Test-Dokument bestätigen sich gegenseitig. Die DB-Zeile ist nur der
  Prüfling.
- **Schwere wie in ADR 0021.** Von außen nicht ausnutzbar, nötig ist
  Schreibzugriff auf die DB. Im Shadow-Betrieb mittel: Die Evidenz wird still
  verfälscht, etwa durch Fills ohne Gebühr, einen umgangenen Recheck aus
  ADR 0009 und größere Positionen. Mit Echtgeld hoch.
- **Empfehlung: Option W.** Eine gepinnte Profil-Registry im Code. Der Worker
  vergleicht die Zeile an allen Lesestellen nach Wert und sperrt bei einer
  Abweichung ausdrücklich. Engine, Snapshot, Input-Hashes und Policy-Hash
  bleiben bytegleich. Replays und Evolution, die bewusst mit anderen
  Kostenprofilen rechnen, sind nicht betroffen.
- **Zuerst die lesende SQL-Prüfung auf dem VPS (Z1).**

## Kontext

### Der Befund in einem Satz

R-026 liest vom Profil nur den `status` in sein `inputJson`. R-018 und
R-019 prüfen Spread und Slippage nur nach oben, nicht nach unten. Hash,
Version, `assetId`, Gebühr und Filter prüft keine Regel und keine
Worker-Stelle. Eligibility prüft vom Hash nur das Format.

### Wo das Profil gelesen wird

| # | Stelle | Ort | Wofür | Geprüft | Nicht geprüft |
|---|---|---|---|---|---|
| 1 | Strategie-Assembler | `strategyInputAssembler.ts:248-251, 364-383` | Tick-Ausrichtung des Plans, Evidenz | `status ACTIVE` (`strategy-engine/src/validate-input.ts:638-660`) | Werte, Hash |
| 2 | Risk-Assembler und Engine | `riskInputAssembler.ts:217-220, 431-451`; `evaluate-risk.ts:178-240` | Sizing, R-007, R-008, R-018, R-019, R-025 | R-018: `ACTIVE`, Spread 0–20 bp. R-019: Slippage 0–15 bp (`rules.ts:1322-1470`) | Hash, Version, `assetId` gegen Candidate, Gebühr, Filter. R-026 (`rules.ts:1917-2004`) nur `executionProfileStatus` |
| 3 | Order-Anlage | `shadowOrderPersistence.ts:347-369, 469-488` | Precision- und Cost-Snapshot der Order | `id` und Hash-Text gegen den Risk-Snapshot | Werte. Beide Seiten stammen aus derselben Zeile |
| 4 | Entry-Fill, Recheck ADR 0009 | `shadowFillPersistence.ts:152-198, 378, 401` | Fill-Preis, Gebühr, Netto-CRV nach Fill | Typen des Order-Snapshots | Werte |
| 5 | Exit | `shadowPositionMonitor.ts:304-313, 478-491, 862-884` | Exit-Order und Exit-Fill | nur „vorhanden“ | Werte. Gelesen wird die **aktuelle** Zeile, nicht der Entry-Snapshot |
| 6 | Bewertung | `shadowPortfolioValuation.ts:81-107` | konservativer Mark und Exit-Gebühr, damit Equity, Tages-PnL, R-010 und Kill Switch | nur „vorhanden“ | Werte |
| 7 | Eligibility, Check 8 | `shadowEligibility.ts:712-760` | Startfreigabe | positiv bzw. ≥ 0, Quelle nicht leer, Hash `^[a-f0-9]{64}$` (`:739`) | Werte, Hash-Inhalt, Anzahl `ACTIVE` |

Dazu kommen drei Stellen, die Profile anlegen oder zählen:

- **Session-Aktivierung** (`shadowSessionOps.ts:626, 663`): verlangt nur
  mindestens ein `ACTIVE`-Profil.
- **Bootstrap** (`shadowBootstrap.ts:394-424`): verwendet eine vorhandene v1
  ungeprüft weiter (`existingProfile ??`).
- **Kalibrierung** (`shadowExecutionProfileCalibrate.ts:129-178`): vergleicht
  nur Gebühr, Spread, Slippage und Quelle. Die Filter für v2 kopiert sie aus
  der DB-Zeile.

Alle Lesestellen wählen die höchste `version` mit `status ACTIVE`. Der
Unique-Index auf `activeAssetKey` (Migration `20260802090000…:722`) lässt
mehrere `NULL` zu. Wie beim Limit-Set reicht deshalb eine **zweite**
`ACTIVE`-Zeile mit höherer Version.

### Synthetische Probe

Die Probe lief auf `da5dc66`, ohne DB und ohne echte Daten. Die
Engine-Fälle bauen auf `buildApprovableSnapshot` auf. Die Worker-Fälle
nutzen das In-Memory-Prisma der bestehenden Tests
(`test/support/shadowExecutionFixtures.ts`). Die Probe ist nicht committet,
eine Umsetzung kann sie als Testfälle übernehmen.

**Engine (R-026).** Alle Fälle tragen, wo nicht anders angegeben, den
offiziellen Hash `0fba0118…`. Ausgangswerte sind die von BTCUSDT v2:
10/2/3 bp, Tick 0,01, Step 0,00001, Mindestnotional 10, Teilnahme 1 %.

| Fall | Änderung | R-026 | Ergebnis |
|---|---|---|---|
| B0 | keine, weiter Take Profit | PASS | APPROVED, 0,04395 BTC, Risiko 24,997 USDT, Netto-CRV 2,70 |
| B1 | keine, 2R-Plan der Strategie | PASS | REJECT, R-008 FAIL, Netto-CRV 1,64 |
| E1 | Gebühr, Spread, Slippage 0, 2R-Plan | PASS | **APPROVED**, Netto-CRV 2,00, 0,0498 BTC. Der Trade aus B1 wird genehmigt |
| E2 | nur Gebühr 0 | PASS | APPROVED, 0,04797 BTC (+9 %). Die Engine meldet 24,995 USDT Risiko, mit den echten v2-Kosten sind es 27,28 USDT, also das 1,09-Fache des Budgets |
| E3 | Gebühr 25 bp, also strenger | PASS | APPROVED, 0,03904 BTC (−11 %) |
| E4 | `stepSize` 0,001 | PASS | APPROVED, 0,043 BTC |
| E5 | `minNotional`, `minQuantity` 1e-12 | PASS | R-025 PASS |
| E6 | `tickSize` 1e-12 | PASS | APPROVED |
| E7 | fremde `id`, `assetId` `asset-eth`, `version` 99 | PASS | APPROVED. Kein Abgleich von `assetId` mit dem Candidate |
| E8 | `specificationHash` = `not-a-hash` | PASS | APPROVED |
| E9 | `maxParticipationRate` 1 | PASS | APPROVED. Die Engine liest den Wert nicht, die Fill-Simulation schon |
| E10 | Spread 20, Slippage 15 (an den Grenzen) | PASS | APPROVED, 0,03737 BTC |

In allen Fällen bleibt `policyHash` gleich `RISK_POLICY_HASH`. Die Policy
enthält keine Kostenwerte (`policy-v1.ts:123-157`).

**Worker.** Die Profilzeile behält `id` und Hash, nur ihre Werte ändern sich.

| Fall | Änderung | Ergebnis |
|---|---|---|
| W1 | Kontrolle mit v2-Werten | Order `CREATED`, Fill 24 119,65, Gebühr 2,41 USDT |
| W2 | Zeile nach der Freigabe auf 0/0/0 bp | Order `CREATED` statt `EXECUTION_PROFILE_CHANGED`. Der Snapshot trägt 0/0/0, Fill zum Kerzen-Open 24 110,00, Gebühr 0 |
| W3 | Take Profit 25 150 | mit v2: `FILLED_CRV_SHORTFALL` und ein CRITICAL RiskEvent (ADR 0009). Mit 0/0/0: `FILLED`, kein RiskEvent, normale Position |
| W4 | Entry mit v2, danach Zeile auf 0/0/0 | Die Exit-Order trägt 0/0/0, Stop-Fill exakt 23 600, Gebühr 0 |
| EL1 | Hash `0fba0118…`, alle Kosten 0 | `READY` |
| EL2 | zweite `ACTIVE`-Zeile, Version 7, `activeAssetKey` `NULL`, Kosten 0 | `READY`. Der Bericht zeigt die neue Zeile |
| EL3 | v1-Werte, beliebiger 64-Hex-Hash | `READY` |

Ergebnis: 1 Engine-Probe mit 12 Fällen und 7 Worker-Proben, alle grün. Die
Lücke ist damit bestätigt. Das In-Memory-Prisma kennt keine Unique-Indizes.
EL2 gilt für PostgreSQL trotzdem, wegen der `NULL`-Regel oben.

### Vertrauenswürdige Referenz

Bootstrap und Kalibrierung berechnen den Hash so:

```ts
buildSpecificationHash({
  symbol, version,
  tickSize, stepSize, minQuantity, minNotional, maxQuantity,   // 12 Stellen
  feeBps, fullSpreadBps, slippageBps, maxParticipationRate, source
})
```

Nachgerechnet aus den Code-Konstanten, ohne DB:

| Profil | Quelle der Werte | Hash |
|---|---|---|
| BTCUSDT v1 | Bootstrap, `MANUAL_CONSERVATIVE_V1` 10/10/10 | `dfa54a9ba6d42e4f9ac29ca7dc58e7e72ae68dad7f09fa667ab2be831ce805c4` |
| **BTCUSDT v2** | Bootstrap-Filter + `BINANCE_SPOT_VIP0_ESTIMATE_V1` 10/2/3 | `0fba0118f710413a0b9811a15726f69ddb48131c26725775d1f0799de43eed13`, **gleich dem dokumentierten Wert** |
| ETHUSDT v1 | Bootstrap, `MANUAL_CONSERVATIVE_V1` | `73a04a79253cac09dbfbd7fb9cbf9fced43742f63e9306b689c4cdaba2153514` |
| ETHUSDT v2 | Bootstrap-Filter + VIP0 | `fc2ec20033490fdc14b5d2538b091116daa81c43905a3465b597d52aed601d8a`, nicht dokumentiert, ETH ist deaktiviert |

**Was die Übereinstimmung belegt:** Die VPS-Zeile v2 wurde am 2026-10-15
mit genau diesen Werten angelegt. Auch die v1-Filter, die die Kalibrierung
kopiert hat, waren zu diesem Zeitpunkt unverändert. Über die **heutigen**
Werte sagt sie nichts: Ein späteres `UPDATE` lässt den Hash stehen.

| Kandidat | Vertrauenswürdig? | Grund |
|---|---|---|
| Code-Konstanten in Bootstrap und Kalibrierung | **ja** | über Git und Review freigegeben, reproduzieren den dokumentierten Hash |
| Hash `0fba0118…` im Forward-Test-Dokument | **ja, als Gegenprobe** | am 2026-10-15 eingefroren, unabhängig von der DB |
| gespeicherter `specificationHash` | nein | Eine Zeile bürgt nicht für sich selbst |
| Audit `EXECUTION_PROFILE_CALIBRATED` (`afterState`) | nein, nur Forensik | liegt in derselben DB |
| `costModelSnapshotJson` der Orders | nein | Kopie der Zeile |

Schwächen der Referenz:

- Die Werte liegen heute in drei Kopien: Bootstrap, Kalibrierung und
  `packages/evolution/src/costs.ts:13-51`. Die Kopien sind gleich, aber
  nicht verbunden.
- Die Versionsnummer 2 vergibt die DB (`active.version + 1`). Gepinnt ist sie
  nur im Forward-Test-Dokument.
- Der Hash ist formatempfindlich: `"0.01"` statt `"0.010000000000"` ergibt
  `c8d13640…`.

### Warum es nicht auffiel

- Dokument 06 verlangt in R-026 „Risk/Profile-Hashes entsprechen“. ADR 0003
  erklärt das `ExecutionProfile` ab Freigabe für immutable. Beides ist nicht
  durchgesetzt.
- Der Order-Pfad hat einen eigenen Reason Code `EXECUTION_PROFILE_CHANGED`.
  Das sieht nach Schutz aus, vergleicht aber nur zwei Kopien derselben Zeile.
- Die Test-Fixtures tragen Platzhalter-Hashes: `"d".repeat(64)` in der
  Engine, `"a".repeat(64)` in Eligibility, `"profile-hash-1"` im
  Ausführungstest. Kein Test erwartet eine Hash- oder Wertprüfung. Die
  Engine-Tests decken nur das fehlende Profil ab, und
  `EXECUTION_PROFILE_CHANGED` hat gar keinen Test.
- R-018 und R-019 wirken wie Kostenschutz, prüfen aber nur nach oben. Ein zu
  optimistisches Profil fällt nie auf.

### Was die Lücke heute begrenzt

- Nötig ist Schreibzugriff auf die DB, wie in ADR 0021 beschrieben.
- Spread und Slippage sind nach oben begrenzt (20 und 15 bp). Spot, kein
  Hebel, Sizing durch Cash gedeckelt.
- Jede Bewertung speichert die benutzten Profilwerte in
  `inputsJson.snapshot.executionProfile`. Jede Order speichert ihre
  Cost- und Precision-Snapshots, Entry wie Exit. Rückwirkend ist das prüfbar
  (Z1). Bewertungen speichern nur die `executionProfileId`, ihre Werte sind
  rückwirkend nicht prüfbar.
- Replays und Evolution rechnen mit Code-Konstanten, nicht mit der DB. Die
  Forschung ist also nicht betroffen. Forward-Test und Forschung würden aber
  still auseinanderlaufen.

Realistische Auslöser sind dieselben wie in ADR 0021. Dazu kommt ein
legitimer Weg ohne DB-Manipulation: Ein neuer Schätzwert in
`EXECUTION_COST_ESTIMATES` und ein Lauf der Kalibrierung legen eine neue
`ACTIVE`-Version an. Damit wechselt der Forward-Test seine Kosten ohne neue
Regelversion und ohne Spur im Policy-Hash.

### Auswirkungen

**Shadow (heute).**

- In B0 machen die Kosten 66,79 von 568,76 USDT Stückrisiko aus, also rund
  12 %. Ohne Kosten ist jeder Trade um 28 bp je Round Trip zu gut.
- R-008 genehmigt Pläne unter netto 2R (E1). Der Recheck aus ADR 0009
  verschweigt Shortfalls (W3).
- Positionen werden größer (E2). Die Equity steigt über die Bewertung (Punkt
  6), damit greifen Tagesverlust und Kill Switch später.
- Champion und Challenger handeln unterschiedlich oft und mit
  unterschiedlich weiten Stops. Kosten treffen sie deshalb unterschiedlich
  stark, die Rangfolge kann kippen.
- Dashboard und Arena zeigen das alles als V1-Ergebnis.

**Spätere Echtgeldausführung.** Ein Adapter speichert die echte Gebühr je
Fill (Dokument 07). Freigabe und Größe kommen aber weiter aus dem Profil.
Vor jeder Demo- oder Echtgeldstufe muss die Lücke geschlossen sein.

## Zu entscheiden

- **F1:** Wo und wogegen wird das Profil geprüft?
- **F2:** Welche Profilversionen gelten als freigegeben?
- **F3:** Wann wird die Prüfung eingeführt, gemessen am laufenden
  `OFFICIAL_V1`?

## Optionen zu F1

### Gemeinsamer Baustein: eine gepinnte Profil-Registry

Eine eingefrorene Konstante ersetzt die drei Kopien, Vorschlag
`packages/risk-engine/src/execution-profile-v1.ts` neben `RISK_LIMIT_SET_V1`:

```ts
export const EXECUTION_PROFILES_V1 = Object.freeze({
  BTCUSDT: Object.freeze({
    symbol: "BTCUSDT", version: 2, source: "BINANCE_SPOT_VIP0_ESTIMATE_V1",
    tickSize: "0.010000000000", stepSize: "0.000010000000",
    minQuantity: "0.000010000000", minNotional: "10.000000000000", maxQuantity: null,
    feeBps: 10, fullSpreadBps: 2, slippageBps: 3, maxParticipationRate: "0.010000000000"
  }),
  ETHUSDT: Object.freeze({ /* gleiche Kosten, Step und Minimum 0.0001 */ })
});

/** Felder, in denen ein Profil vom freigegebenen abweicht; leer = identisch. */
export function executionProfileDeviations(profile, symbol): readonly string[];
```

- **Verglichen werden** `version`, `specificationHash`, die drei
  `…Bps`-Ganzzahlen und alle Dezimalfelder **nach Wert** (`DecimalValue.eq`,
  wie in ADR 0021). Dazu `maxQuantity` exakt und `source`. Was nicht lesbar
  ist, zählt als Abweichung. Die Funktion wirft nie.
- **Der Hash** jedes Eintrags wird beim Laden aus dem Eintrag berechnet. Ein
  Test pinnt BTCUSDT auf `0fba0118…`, als Gegenprobe zum
  Forward-Test-Dokument.
- **Bootstrap und Kalibrierung** schreiben nur Registry-Werte. Die
  Evolution liest dieselben Werte später ebenfalls von hier (Folgearbeit 4).
- Die Registry ist bei Option W **nicht** Teil von `RISK_POLICY_V1`.
  Policy-Hash und Regelversion bleiben gleich.

### Option W – Prüfung an jeder Lesestelle im Worker (empfohlen)

Bevor der Worker eine Profilzeile benutzt, vergleicht er sie mit der
Registry:

| Stelle | Bei Abweichung |
|---|---|
| Risk-Job, vor dem Assembler (`shadowAssessRisk.ts`) | keine Bewertung. Session und Portfolio `ERROR_LOCKED`, CRITICAL RiskEvent, BotRun `FAILED`. Ausdrücklich kein stilles Überspringen im Assembler, das ist die Lehre aus ADR 0021 |
| Order-Anlage | `BLOCKED` mit eigenem Reason Code, dazu die Sperre |
| Exit-Monitor | vorhandener Pfad `SIMULATION_INVALID_EXECUTION_PROFILE` mit `ERROR_LOCK` |
| Bewertung | vorhandener Abbruch des Jobs, dazu die Sperre |
| Eligibility, Check 8 | `NOT_READY` mit Feldliste. Verlangt genau eine `ACTIVE`-Zeile je zugewiesenem Asset |
| Bootstrap | lehnt eine abweichende vorhandene Zeile vor jedem Schreiben ab |
| Kalibrierung | schreibt nur Registry-Werte. Weicht der berechnete Hash vom Registry-Hash ab, lehnt sie ab (Option B als Gegenprobe) |

Der Strategie-Assembler braucht keine eigene Prüfung. Jeder Candidate läuft
vor einer Freigabe durch den Risk-Job.

- **Pro:**
  - Schließt alle sieben Stellen, auch Order, Exit und Bewertung. Die sieht
    R-026 nie.
  - Engine, Snapshot, Input-Hashes, Policy-Hash und Regelversion bleiben
    bytegleich. Für die echte Zeile ändert sich nichts, nicht einmal ein
    Identitätsfeld. Das ist ein Vorteil gegenüber ADR 0021.
  - Replays und Evolution bleiben unberührt, sie lesen keine DB-Profile.
- **Contra:**
  - R-026 prüft das Profil weiterhin nicht. Die R-026-Zeile in Dokument 06
    muss deshalb benennen, wo die Prüfung tatsächlich liegt.
  - Die Sperre braucht einen Weg im Worker: entweder ADR 0022, falls
    angenommen, oder ein gezielter Helfer wie `engageRiskLimitSetErrorLock`
    aus ADR 0021, verallgemeinert auf beide Befunde.
- **Umfang:**
  - Registry und Vergleich, etwa 60 Zeilen;
  - ein Worker-Helfer analog `riskLimitSetIntegrity.ts`;
  - sieben Aufrufstellen und die Tests.

### Option A – zusätzlich in R-026 (wie ADR 0021)

R-026 vergleicht den Snapshot mit der Registry. Die Registry wird Teil von
`RISK_POLICY_V1`.

- **Pro:**
  - Der Befund steht im RuleResult jeder Bewertung.
  - Dokument 06 ist wörtlich erfüllt.
  - Schützt jeden Aufrufer von `evaluateRisk`.
- **Contra, entscheidend:**
  - Die Forschung bricht. Replays rechnen bewusst mit den Kostenprofilen
    `BOOTSTRAP` (10/10/10) und `PESSIMISTIC` (10/4/5)
    (`apps/trading-worker/src/jobs/shadowReplay.ts:64-71`). Ihr Profil trägt
    außerdem Version 1 und einen eigenen Hash
    (`shadow-replay/src/replay-core.ts:998, 1447-1463`). Die Evolution hat
    die richtigen Werte, aber dieselbe fremde Identität.
  - Jeder dieser Läufe würde `ERROR`. Nötig wäre der Forschungseinstieg S1
    aus ADR 0021, den der Betreiber am 2026-10-18 zurückgestellt hat.
  - Regelversion und Policy-Hash springen erneut.
- **Einordnung:** später, nur zusammen mit S1.

### Option B – Hash aus den Werten nachrechnen

Hier ist das anders als in ADR 0021 machbar: Die Nachrechnung trifft
`0fba0118…`.

- **Contra:**
  - Der Risk-Snapshot enthält kein `source` (`contracts.ts:215-232`). Für
    eine Prüfung in der Engine müsste sich der Snapshot-Vertrag ändern.
  - Ein Fehlschlag sagt nicht, welches Feld abweicht.
  - Der Hash ist formatempfindlich, die Fixtures schreiben `"0.01"`.
- **Einordnung:** als zusätzliche Gegenprobe in Kalibrierung und
  Eligibility sinnvoll, nicht als Gate.

### Option C – Schutz in der Datenbank

Wie in ADR 0021:
`CHECK (status <> 'ACTIVE' OR "activeAssetKey" IS NOT NULL)` und ein
Trigger gegen Änderungen an `ACTIVE`-Zeilen. Das braucht eine Migration
während `OFFICIAL_V1`. Neu bewerten mit einer Echtgeldstufe.

### Nicht weiter verfolgt

- **Nur Eligibility härten:** Der Bericht ist kein Gate im Handelslauf.
- **Nur den Order-Pfad schärfen:** schützt weder R-008 noch das Sizing.

## Optionen zu F2 (freigegebene Versionen)

- **P1 – nur die aktuelle Version je Symbol (empfohlen).** Freigegeben sind
  BTCUSDT v2 und ETHUSDT v2. Die v1-Zeilen bleiben als `RETIRED`-Historie.
  Wird eine v1 reaktiviert, greift die Sperre. Nach einem frischen Bootstrap
  meldet Eligibility `NOT_READY`, bis kalibriert ist. Runbook 18 sieht die
  Kalibrierung ohnehin vor (`18-vps-24-7-shadow-runbook.md:206`).
- **P2 – v1 zusätzlich zulassen.** Kein Zwischenzustand nach dem Bootstrap.
  Dafür könnte eine reaktivierte v1 still die Kosten des Forward-Tests
  wechseln, entgegen Regel 1.
- In beiden Fällen gilt: Jedes neue Profil, etwa mit gemessenen Kosten, ist
  ein Registry-Eintrag mit ADR und eine neue Forward-Test-Version.

**Nebenbefund, eigene Entscheidung:** Der Exit liest die aktuelle Zeile,
nicht den Entry-Snapshot (W4). Auch eine **legitime** neue Profilversion
ändert damit die Exit-Kosten offener Positionen. Dokument 07 (`:64`) lässt
offen, ob das gewollt ist. Option W ändert daran nichts.

## Optionen zu F3 (Zeitpunkt und `OFFICIAL_V1`)

### Z1 – Jetzt nur lesend prüfen (empfohlen, Betreiber)

Wie in ADR 0021: psql im `postgres`-Container (Runbook 18). Keine der drei
Abfragen wurde in diesem Entwurf ausgeführt.

1. **Profilzeilen.** Erwartet wird:
   - BTCUSDT v1 `RETIRED` mit `MANUAL_CONSERVATIVE_V1`, 10/10/10 und
     `dfa54a9b…`;
   - BTCUSDT v2 `ACTIVE`, ID `cmv97zpa60002pp6hbjnkevrx`, VIP0, 10/2/3,
     Tick 0.01, Step 0.00001, Minimum 0.00001, Notional 10, ohne
     `maxQuantity`, Teilnahme 0.01, Hash `0fba0118…`, `activeAssetKey`
     gesetzt;
   - ETHUSDT entsprechend, falls kalibriert (`fc2ec200…`);
   - genau eine `ACTIVE`-Zeile je Asset.

   ```sql
   SELECT a."symbol", p."id", p."version", p."status", p."activeAssetKey",
          p."tickSize", p."stepSize", p."minQuantity", p."minNotional", p."maxQuantity",
          p."feeBps", p."fullSpreadBps", p."slippageBps", p."maxParticipationRate",
          p."source", p."specificationHash", p."effectiveFrom", p."effectiveTo",
          p."createdAt", p."updatedAt"
   FROM "InstrumentExecutionProfile" p JOIN "Asset" a ON a."id" = p."assetId"
   ORDER BY a."symbol", p."version";
   ```

2. **Rückwirkend über alle Bewertungen.** Erwartet wird für BTCUSDT
   `abweichend = 0`.

   ```sql
   SELECT s.symbol, count(*) AS gesamt,
          count(*) FILTER (WHERE
               (p->>'specificationHash') IS DISTINCT FROM '0fba0118f710413a0b9811a15726f69ddb48131c26725775d1f0799de43eed13'
            OR (p->>'version')       IS DISTINCT FROM '2'
            OR (p->>'feeBps')        IS DISTINCT FROM '10'
            OR (p->>'fullSpreadBps') IS DISTINCT FROM '2'
            OR (p->>'slippageBps')   IS DISTINCT FROM '3'
            OR (p->>'tickSize')::numeric             IS DISTINCT FROM 0.01
            OR (p->>'stepSize')::numeric             IS DISTINCT FROM 0.00001
            OR (p->>'minQuantity')::numeric          IS DISTINCT FROM 0.00001
            OR (p->>'minNotional')::numeric          IS DISTINCT FROM 10
            OR (p->>'maxParticipationRate')::numeric IS DISTINCT FROM 0.01
            OR (p->'maxQuantity') IS DISTINCT FROM 'null'::jsonb
          ) AS abweichend
   FROM (SELECT "inputsJson"->'snapshot'->'candidate'->>'symbol' AS symbol,
                "inputsJson"->'snapshot'->'executionProfile'      AS p
         FROM "RiskAssessment") s
   GROUP BY s.symbol;
   ```

3. **Rückwirkend über alle Orders, Entry und Exit.** Erwartet wird
   `abweichend = 0`.

   ```sql
   SELECT a."symbol", o."purpose", count(*) AS gesamt,
          count(*) FILTER (WHERE
               (c->>'executionProfileSpecificationHash') IS DISTINCT FROM '0fba0118f710413a0b9811a15726f69ddb48131c26725775d1f0799de43eed13'
            OR (c->>'feeBps')        IS DISTINCT FROM '10'
            OR (c->>'fullSpreadBps') IS DISTINCT FROM '2'
            OR (c->>'slippageBps')   IS DISTINCT FROM '3'
            OR (c->>'maxParticipationRate')::numeric IS DISTINCT FROM 0.01
            OR (q->>'tickSize')::numeric    IS DISTINCT FROM 0.01
            OR (q->>'stepSize')::numeric    IS DISTINCT FROM 0.00001
            OR (q->>'minQuantity')::numeric IS DISTINCT FROM 0.00001
            OR (q->>'minNotional')::numeric IS DISTINCT FROM 10
            OR (q->'maxQuantity') IS DISTINCT FROM 'null'::jsonb
          ) AS abweichend
   FROM (SELECT "assetId", "purpose",
                "costModelSnapshotJson" AS c, "precisionSnapshotJson" AS q
         FROM "ShadowOrder") o
   JOIN "Asset" a ON a."id" = o."assetId"
   GROUP BY a."symbol", o."purpose";
   ```

Ergeben alle drei das Erwartete, ist die bisherige `OFFICIAL_V1`-Evidenz in
diesem Punkt belegt sauber. Die Bewertungen der Equity sind davon
ausgenommen, siehe oben.

### Z2 – Umsetzung und Rollout

- **Umsetzung** auf eigenem Branch, nur mit Freigabe des Betreibers.
- **Einstufung:** Option W lässt Urteile, Mengen, Trades und alle Hashes für
  die echte Zeile bytegleich. Als protokollierter Bugfix nach Regel 2 ist
  sie deshalb leichter einzuordnen als ADR 0021. Die Entscheidung bleibt
  beim Betreiber.
- **Rollout:** gebündelt mit ADR 0021, also ein Image, ein Eintrag im
  Änderungsprotokoll, ein `consistency-snapshot`/`-compare`. Nur nach
  bestandenem Z1. Weicht die VPS-Zeile ab, würde die Sperre beide Sessions
  sofort anhalten. Dann gibt es keinen Rollout, erst wird der Befund
  geklärt.

## Empfehlung

1. **Jetzt:** Z1, lesend, durch den Betreiber.
2. **F1:** Option W mit der Registry in `packages/risk-engine`, nicht Teil
   von `RISK_POLICY_V1`. Option B nur als Gegenprobe in der Kalibrierung.
3. **F2:** P1.
4. **Später:** Option A nur zusammen mit S1 aus ADR 0021. Option C bei einer
   Echtgeldstufe.
5. **Sperre:** über ADR 0022, falls angenommen. Sonst ein gezielter Helfer
   wie in ADR 0021.

## Entscheidungen (Stand 2026-10-18)

- **F1: Option W.** Der Betreiber hat die lokale Umsetzung auf diesem
  Branch freigegeben, ausdrücklich ohne Push, Merge, VPS-Zugriff und
  Deployment. Übernommen ist sie noch nicht.
- **F2: P1, als Teil der Empfehlung umgesetzt.** Freigegeben sind BTCUSDT v2
  und ETHUSDT v2. Die Bestätigung erfolgt mit der Übernahme.
- **F3: offen.** Siehe „Voraussetzungen für den Rollout“.

## Umsetzung (Option W)

Branch `claude/execution-profile-integrity-draft` auf Basis `da5dc66`, nur
lokal committet.

### Was geändert wurde

| Datei | Änderung |
|---|---|
| `apps/trading-worker/src/lib/executionProfileIntegrity.ts` (neu) | Registry `APPROVED_EXECUTION_PROFILES_V1`: BTCUSDT v2 `0fba0118…`, ETHUSDT v2 `fc2ec200…`. Dazu eine Vergleichsfunktion `executionProfileDeviations` für Werte (Dezimalwerte nach Wert), Identität und Hash. `loadActiveExecutionProfile` lädt alle `ACTIVE`-Zeilen eines Assets. `riskReducingExecutionProfile` liefert die Werte für Exit und Bewertung. `engageExecutionProfileIntegrityLock` schreibt einen CRITICAL RiskEvent `CONFIGURATION_INVALID`, setzt Session und Portfolio auf `ERROR_LOCKED` mit Kill Switch und schreibt das Audit `SESSION_ERROR_LOCKED` mit Feldliste |
| `shadowEligibility.ts` (Check 8) | gemeinsame Prüfung. Verlangt genau eine `ACTIVE`-Zeile je zugewiesenem Asset. Feldliste und Anzahl stehen in `details` |
| `shadowSessionOps.ts` (Aktivierung) | `validExecutionProfilesPresent` heißt jetzt: Jedes zugewiesene Asset hat genau ein freigegebenes Profil. Vorher genügte irgendeine `ACTIVE`-Zeile |
| `jobs/shadowAssessRisk.ts` | prüft vor `evaluateRisk` das Snapshot-Profil, also genau die Werte der Engine, und die Zahl der `ACTIVE`-Zeilen. Bei Abweichung: keine Bewertung, Sperre, `errored`, BotRun `FAILED`. Ein fehlendes Profil bleibt der CRITICAL-Befund der Engine |
| `shadowOrderPersistence.ts` | prüft die aktive Zeile und die Profilkopie der Bewertung. Neuer Reason Code `SHADOW_ORDER_EXECUTION_PROFILE_INVALID` mit Sperre. Der bisherige Vergleich von id und Hash bleibt: Ein Versionswechsel heißt weiter `EXECUTION_PROFILE_CHANGED`, ohne Sperre |
| `shadowFillPersistence.ts` | prüft vor der Simulation den Order-Snapshot und die aktive Zeile. Bei Abweichung: Eine Order ohne Fill läuft ab, die Reserve wird frei. Eine teilgefüllte Order wird storniert, die Restreserve frei, die Position geht von `OPENING` auf `OPEN`. Danach die Sperre. Der Post-Fill-Recheck rechnet damit nur noch mit geprüften Werten |
| `shadowPositionMonitor.ts` | Exit: Eine abweichende Zeile wird durch das freigegebene Profil ersetzt, der Exit läuft weiter. Die Exit-Order vermerkt `executionProfileDeviations` und `approvedProfileSubstituted`. Gesperrt werden nur neue Einstiege. Ein fehlendes Profil wird behandelt wie bisher |
| `shadowPortfolioValuation.ts` | Mark mit dem freigegebenen Profil statt mit einer abweichenden Zeile. Wirft deswegen nie |
| `jobs/shadowExecutionProfileCalibrate.ts` | schreibt nur das freigegebene Profil, die Filter aus der Registry statt aus der DB-Zeile, und prüft den Hash vor dem Schreiben. `UNCHANGED` gibt es nur bei voller Übereinstimmung, sonst `REFUSED` ohne Schreibzugriff und BotRun `FAILED` |
| Tests | neu: `executionProfileIntegrity.test.ts`, `test/support/executionProfileRows.ts`. Ergänzt: Eligibility, Session-Ops, Ausführung, Kalibrierung. Fixtures tragen das freigegebene Profil |
| Docs | Dokument 06 (R-026, Abschnitt Spread/Slippage), Runbook 18 (Kalibrierung) |

**Nicht geändert:**

- die Risk Engine: R-026, Regeln, Limits, `risk-rules-v1/1.4.0` aus ADR 0021 und `RISK_POLICY_HASH`;
- Strategie-Assembler, Bootstrap, Replays, Evolution, Arena und Schema.

### Abweichungen vom Entwurf

- **Die Registry liegt im Worker, nicht in `packages/risk-engine`.** Unter
  Option W nutzt nur der Worker sie, so bleibt das Engine-Paket bytegleich.
  Die Evolution behält ihre Kopie (Folgearbeit 3).
- **Die Session-Aktivierung prüft zusätzlich**, denn sie gibt neue
  Einstiege frei.
- **Der Order-Pfad prüft zusätzlich die Profilkopie der Bewertung**, denn
  Menge und Reserve wurden damit berechnet.
- **Order-Snapshots werden gegen das freigegebene Profil mit ihrem eigenen
  Hash geprüft, nicht gegen das aktuelle.** Bei einem künftigen
  Versionswechsel bleibt eine schon angenommene Order mit der älteren
  freigegebenen Version füllbar (Dokument 07: Es gilt der Snapshot). Neue
  Einstiege verlangen immer die aktuelle Version. Heute gibt es je Symbol nur
  eine.
- **Teilfüllung:** Ohne den Übergang nach `OPEN` bliebe die Position
  `OPENING`. Der Monitor überwacht nur `OPEN` und `PARTIALLY_CLOSED`, die
  Position wäre also ohne Exit. Deshalb dasselbe Ergebnis wie beim Shortfall
  aus ADR 0009.
- **Nebenbefund:** Der Risk-Assembler macht aus einer unlesbaren Profilspalte
  `0.000000000000` (`riskInputAssembler.ts:87-98`). Die Prüfung vor der
  Engine erkennt das jetzt als Abweichung (Test „plain-string column“).

### Tests

| Suite | vorher (`da5dc66`) | nachher |
|---|---|---|
| trading-worker ohne DB | 276/276 (Stand ADR 0021) | 382/382 (+106) |
| trading-worker mit PostgreSQL (arena, jobRunner, leases) | 17 rot, kein `DATABASE_URL` lokal | unverändert 17 rot aus demselben Grund. Sie berühren keine Profile, CI |
| risk-engine | 114/114 | 114/114 |
| trading-simulation | 32/32 | 32/32 |
| shadow-replay | 58/58 | 58/58, Regressionshashes unverändert |
| evolution | 122/122 | 122/122 |
| arena | 16/16 | 16/16 |
| api | 199/199 | 199/199 |
| evolution-worker | – | lokal nicht gelaufen (braucht PostgreSQL), CI |
| Lint trading-worker, Typecheck `src` | sauber | sauber |
| Typecheck `test/` (nicht in CI) | 83 Altfehler | 83, keine neuen |

Die neuen Tests decken ab:

- **Referenz:**
  - `0fba0118…` wird aus den Werten nachgerechnet;
  - die Registry entspricht den Bootstrap-Filtern plus
    `BINANCE_SPOT_VIP0_ESTIMATE_V1`;
  - der Platzhalter v1 `MANUAL_CONSERVATIVE_V1` ist nicht freigegeben.
- **Jede nachgewiesene Manipulation einzeln:** Gebühr 0 und 25, Spread 0 und
  20, Slippage 0 und 15, Tick, Step, Mindestmenge, Mindestnotional klein und
  groß, Mengenobergrenze, Teilnahmequote, Hash-Text, fremder Hash, Version 99
  und 1, Quelle, Status, fremdes Asset. Alle 21 in der Vergleichsfunktion,
  18 im Risk-Job (Status, Asset und Quelle filtert dort schon die Abfrage
  bzw. bindet der Hash), je 10 bis 11 in Order, Exit und Eligibility, eine
  Auswahl in Aktivierung, Fill und Kalibrierung.
- **Ungültige Werte:** zehn unlesbare Dezimalwerte, Text statt Ganzzahl,
  eine Textspalte, die der Assembler als 0 preisen würde.
- **Gültige Formen:** `Prisma.Decimal`, 12 Stellen, Kurzform.
- **Mehrfachbelegung**, also eine zweite `ACTIVE`-Zeile: in Vergleich,
  Risk-Job, Order, Fill, Eligibility, Aktivierung, Kalibrierung, Exit und
  Bewertung.
- **Profilversionswechsel:**
  - eine Order nach einem Wechsel ergibt `EXECUTION_PROFILE_CHANGED` ohne
    Sperre;
  - die Kalibrierung v1 → v2 schreibt exakt das freigegebene Profil, auch bei
    abweichenden v1-Filtern; der zweite Lauf ergibt `UNCHANGED`;
  - eine abweichende v2 und zwei `ACTIVE`-Zeilen ergeben `REFUSED`;
  - der Platzhalter blockiert Eligibility und Aktivierung.
- **Fill und Post-Fill:**
  - fünf Snapshot-Manipulationen, eine abweichende aktive Zeile, eine zweite
    Zeile: keine Position, Reserve vollständig frei;
  - ein kostenfreier Snapshot beim Shortfall-Take-Profit eröffnet keine
    normale Position;
  - eine Teilfüllung bleibt gebucht, die Position steht auf `OPEN` und wird
    später per Stop geschlossen.
- **Exit und Bewertung:**
  - der Exit läuft bei jeder Manipulation zu exakt demselben Preis, derselben
    Gebühr und demselben realisierten PnL wie mit dem freigegebenen Profil;
  - der Exit läuft auch bei schon gesperrtem Portfolio und zweiter
    `ACTIVE`-Zeile;
  - ein manueller Risk Close unter der Sperre wird mit freigegebenen Kosten
    gebucht;
  - die Bewertung bleibt gleich und wirft nicht.

**Fixtures.** Vier Fixture-Stellen trugen Platzhalter: `"d"×64`, `"a"×64`,
`"profile-hash-1"`, dazu 10/10/10 bp und Teilnahme 0,5. Sie tragen jetzt das
freigegebene Profil. Drei Shortfall-Tests nutzen den Take Profit 25 150 statt
25 350, weil 25 350 mit 10/2/3 bp nicht mehr unter netto 2R fällt. Ihre
Aussage bleibt gleich.

### Gleiches Verhalten bei gültigem Profil

Ein einmaliges Vergleichsskript, nicht committet, rechnet sechs Szenarien
mit dem freigegebenen BTCUSDT-v2-Profil (`Prisma.Decimal`), einmal gegen
`da5dc66` und einmal gegen diesen Branch:

- Fill mit Stop-Exit und Fill mit TP-Exit;
- Post-Fill-Shortfall mit Zwangsschließung;
- Teilfüllung über zwei Kerzen mit Stop-Exit;
- Risk-Freigabe und Risk-Ablehnung des 2R-Plans.

Verglichen wurden:

- Orders samt Snapshots, Fills, Gebühren, Positionen, Positionsereignisse,
  Exit-Pläne und Ledger;
- Portfolio, Session, RiskEvents und Audit;
- Bewertung, Assessments mit Input- und Output-Hash sowie alle 26
  Regelergebnisse.

**Ergebnis: identisch.** Abweichen nur Hashes, die aus zufälligen Test-IDs
abgeleitet sind (`clientOrderId`, Audit-Schlüssel, ein `inputHash`). Sie
weichen zwischen zwei Läufen derselben Basis genauso ab.

### Auswirkung auf `OFFICIAL_V1`

| Größe | Wirkung bei unveränderter VPS-Zeile |
|---|---|
| Urteile, Mengen, Fills, Gebühren, Exits, Bewertungen | identisch (Vergleich oben) |
| `ruleSetVersion`, `RISK_POLICY_HASH`, Input- und Output-Hashes | unverändert, denn die Engine ist nicht geändert. Bei einem gemeinsamen Rollout mit ADR 0021 springen sie, aber wegen ADR 0021 |
| Profil-Hash `0fba0118…`, Strategie- und Arena-Hashes | unverändert |
| Schema, Migrationen, DB-Zeilen | keine Änderung |
| laufende Sessions | unberührt. Die Aktivierung prüft nur bei einer neuen Aktivierung |
| ETHUSDT | ETH-Zuweisungen sind deaktiviert. Eligibility und Aktivierung prüfen nur zugewiesene Assets. Ein ETH-Profil zählt erst mit einer ETH-Zuweisung oder -Position |
| offene Positionen | Exit und Bewertung laufen wie bisher. Weicht die Zeile ab, wird mit dem freigegebenen Profil geschlossen und bewertet. Gesperrt werden nur neue Einstiege |
| wartende Entry-Orders und freigegebene Candidates beim Deployment | werden beim nächsten Kontakt gegen ihren Snapshot geprüft. Stimmen die Snapshots (Z1, Abfragen 2 und 3), läuft alles wie bisher |
| spätere Kalibrierung | `UNCHANGED` für die VPS-Zeile. Eine andere Kostenschätzung oder gemessene Kosten brauchen einen Registry-Eintrag, also Code, ADR und eine neue Forward-Test-Version (Regel 1). Ohne Eintrag lehnt der Job ab |
| nur bei einer abweichenden VPS-Zeile | Der erste Kontakt (Bewertung, Order, Fill, Monitor) sperrt das jeweilige Portfolio für neue Einstiege. Beide offiziellen Portfolios teilen sich die BTC-Zeile. Das ist gewollt, deshalb steht Z1 zwingend vorher |

### Voraussetzungen für den Rollout

Nichts davon ist ausgeführt. Jeder Schritt braucht eine eigene Freigabe.

1. **Z1 auf dem VPS, nur lesend.** Erwartet wird:
   - genau eine `ACTIVE`-Zeile BTCUSDT mit den Werten oben und `0fba0118…`;
   - v1 auf `RETIRED` mit `activeAssetKey` `NULL`;
   - 0 Abweichungen in Bewertungen und Orders.

   Den Stand von ETHUSDT notieren. Bei einer Abweichung gibt es keinen
   Rollout, erst wird der Befund geklärt.
2. **Der Betreiber stuft ein:** protokollierter Bugfix nach Regel 2, denn
   Urteile und Hashes bleiben gleich, oder Übernahme mit der nächsten
   Version nach Regel 1. Zusammen mit F3 aus ADR 0021 entscheiden.
   Empfohlen ist ein gemeinsamer Rollout.
3. **Branch pushen**, CI grün einschließlich der DB-Suiten und des
   Evolution-Workers, Review. Merge nur mit Freigabe.
4. **Deployment:**
   - Vollsicherung und `consistency-snapshot`;
   - Images von Trading-Worker **und** API neu bauen, denn die API nutzt
     Session-Ops aus dem Worker;
   - den Trading-Worker mit `--no-deps` neu erstellen;
   - `consistency-compare` und ein Eintrag im Änderungsprotokoll.
5. **Danach prüfen:**
   - Eligibility `READY` für beide offiziellen Portfolios, mit
     `deviations: []` und `activeProfiles: 1`;
   - kein RiskEvent `EXECUTION_PROFILE_INTEGRITY_VIOLATION`, kein
     `SESSION_ERROR_LOCKED`;
   - `calibrate-execution-profile`, falls ausgeführt, ergibt `UNCHANGED`.

**Rollback:** das vorherige Image. Es gibt keine Migration.

### Verbleibende Risiken

| Punkt | Einordnung |
|---|---|
| fehlendes Profil | unverändert: Der Monitor sperrt ohne Exit (`SIMULATION_INVALID_EXECUTION_PROFILE`), die Bewertung wirft. Kein Fall dieses ADR, eigene Entscheidung |
| vorbestehend: Läuft eine Entry-Order nach einer Teilfüllung auf der zweiten Kerze ohne Fill ab, bleibt die Position `OPENING` (`expireOrderAndReleaseReserve`) | nicht Teil dieser Korrektur. Der neue Pfad vermeidet das für seinen Fall. Eigene Prüfung |
| vierte Sperr-Implementierung neben Monitor, Fill und ADR 0021 | gleiche Wirkung. Zusammenführung mit ADR 0022 |
| die Bewertung ersetzt still | gewollt, damit Exits nie blockieren. Gemeldet und gesperrt wird an Risk-Job, Order, Fill, Monitor und Eligibility |
| eine Zeile sperrt beide offiziellen Portfolios | gewollt, jeweils beim ersten Kontakt |
| der Strategie-Assembler prüft nicht | kein Gate. Jeder Candidate läuft vor einer Freigabe durch den Risk-Job |
| wer DB-Schreibzugriff hat, kann entsperren | Entsperren bleibt manuell und auditiert. Die Registry lässt sich über die DB nicht ändern |
| DB-Suiten und Evolution-Worker liefen nicht lokal | CI vor jeder Übernahme |

## Was diese Änderung nicht ändert

- Kostenwerte und freigegebene Profile: BTCUSDT v2 bleibt `0fba0118…`;
- die Risk Engine: R-026, Regeln, Limits, Regelversion, Policy-Hash;
- Strategien, Gates, Arena, Evolution und Replays;
- Schema, Migrationen, VPS, `OFFICIAL_V1`, die produktive Datenbank und
  main.

## Folgearbeiten

1. Betreiber: Z1 auf dem VPS, separat.
2. Betreiber: F3 und Rollout nach den Voraussetzungen oben, am besten
   zusammen mit ADR 0021.
3. `packages/evolution/src/costs.ts` übernimmt die Werte aus der Registry.
   Das ist eine Forschungsänderung mit eigener Freigabe; die Werte sind
   gleich.
4. Das Profil-Mapping im Risk-Assembler setzt eine unlesbare Spalte
   weiterhin auf 0. Die Prüfung davor fängt das ab; ein sauberes Mapping wie
   in ADR 0021 ist eine kleine eigene Änderung.
5. Exit-Profil offener Positionen bei einem legitimen Versionswechsel
   (Nebenbefund zu F2): eigene Entscheidung.
6. Vorbestehend: eine `OPENING`-Position nach dem Ablauf einer teilgefüllten
   Order, sowie Exits bei fehlendem Profil: eigene Prüfung.

## Belegstellen (Stand `da5dc66`)

- `packages/risk-engine/src/rules.ts:628-660, 722-800, 1322-1470, 1777-1800, 1917-2004`
- `packages/risk-engine/src/evaluate-risk.ts:178-240, 365, 410`
- `packages/risk-engine/src/contracts.ts:215-232`, `policy-v1.ts:123-157`
- `packages/risk-engine/test/support/build-risk-snapshot.ts:187-203`
- `packages/strategy-engine/src/validate-input.ts:638-660`
- `apps/trading-worker/src/lib/strategyInputAssembler.ts:240-251, 364-383`
- `apps/trading-worker/src/lib/riskInputAssembler.ts:87-98, 217-220, 431-451`
- `apps/trading-worker/src/lib/shadowOrderPersistence.ts:162-181, 347-369, 469-488`
- `apps/trading-worker/src/lib/shadowFillPersistence.ts:152-198, 378, 401`
- `apps/trading-worker/src/lib/shadowPositionMonitor.ts:304-313, 478-491, 862-884`
- `apps/trading-worker/src/lib/shadowPortfolioValuation.ts:81-107`
- `apps/trading-worker/src/lib/shadowEligibility.ts:712-760` (v. a. `:739`)
- `apps/trading-worker/src/lib/shadowSessionOps.ts:626, 663`
- `apps/trading-worker/src/jobs/shadowBootstrap.ts:96-127, 394-424`
- `apps/trading-worker/src/jobs/shadowExecutionProfileCalibrate.ts:60-68, 129-178`
- `apps/trading-worker/src/jobs/shadowReplay.ts:64-71, 130-142`
- `apps/trading-worker/test/shadowEligibility.test.ts:115-131`, `shadowExecution.test.ts:146-164`
- `packages/shadow-replay/src/replay-core.ts:986-998, 1216-1232, 1447-1463`
- `packages/evolution/src/costs.ts:13-51`
- `packages/trading-domain/src/idempotency.ts:82-84`
- `packages/database/prisma/schema.prisma:1419-1449`, Migration `20260802090000_add_shadow_trading_domain/migration.sql:185, 722`
- `docs/trading/06-risk-engine-specification.md:91-92, 99, 136`
- `docs/trading/03-domain-model.md:145-158`, `07-shadow-execution-model.md:13, 44-51, 64, 201-208`
- `docs/trading/decisions/0003-deterministic-versioned-engines.md:12`, `11-open-decisions.md:13` (OD-03)
- `docs/trading/18-vps-24-7-shadow-runbook.md:44, 206`
- `docs/trading/research/official-forward-test-v1.md:53` und Regeln 1–2
