# ADR 0024 – Teilgefüllte Entry-Order läuft ab, die Position bleibt unüberwacht in `OPENING`

- Status: Proposed; Option K freigegeben und lokal umgesetzt (2026-10-19),
  Rollout offen
- Datum: 2026-10-18, Umsetzung 2026-10-19
- Entscheidung: Betreiber. F1 = Option K (Freigabe 2026-10-19, nur lokale
  Umsetzung mit synthetischen Regressionstests). F2 und F3 offen
- Bezug: ADR 0004, ADR 0005, ADR 0009,
  [ADR 0023](0023-execution-profile-value-integrity.md) ·
  [Dokument 04](../04-state-machines.md) („Shadow Order“, „Shadow Position“) ·
  [Dokument 07](../07-shadow-execution-model.md) („Liquidität und
  Teilausführungen“) ·
  [Offizieller Forward-Test V1](../research/official-forward-test-v1.md)

> **Umsetzung:** Option K liegt seit 2026-10-19 auf dem lokalen Branch
> `hotfix/official-v1-security` (Basis `16d6d0f`, zusammen mit ADR 0021 und
> ADR 0023), siehe Abschnitt „Umsetzung“ am Ende. Nicht gepusht, nicht
> deployt. Der Text bis dorthin ist der Entwurf vom 2026-10-18.
>
> **Entwurf: nur Analyse.** Kein Produktivcode ist geändert, auf dem VPS
> wurde nichts ausgeführt. Der Branch `claude/opening-after-partial-expiry-draft`
> baut auf `0c55e52` auf (ADR 0023 umgesetzt, lokal) und enthält nur dieses
> Dokument und eine lesende SQL-Datei. Zeilenangaben beziehen sich auf
> `0c55e52`. Die betroffenen Codeblöcke sind im deployten `16d6d0f`
> textgleich, dort stehen sie in Klammern.

## Kurzantwort

- **Der Fehler ist bestätigt.** Synthetisch, ohne DB, gegen `0c55e52` und
  gegen den VPS-Stand `16d6d0f`. Eine Entry-Order füllt auf der ersten Kerze
  teilweise, die Position steht auf `OPENING`. Ist die zweite Kerze nicht
  füllbar, setzt `expireOrderAndReleaseReserve` die Order auf `EXPIRED` und
  gibt die Reserve frei. Die Position bleibt `OPENING`.
- **Kein Exit-Pfad erreicht diese Position je wieder.** Der Monitor wählt nur
  `OPEN` und `PARTIALLY_CLOSED`. Der manuelle Risk Close lehnt `OPENING` ab.
  Der Fill-Job ignoriert die terminale Order. Stop, Take Profit, Zeit-Exit
  und manueller Close greifen nie, die Exposure bleibt bestehen.
- **Teilgefüllt ist etwas anderes als reserviert.** Eine Order ohne Fill läuft
  korrekt ab: Es gibt keine Position, die Reserve wird frei, es besteht kein
  Marktrisiko. Betroffen ist nur eine Order mit `filledQuantity > 0`. Im
  Probe waren das bis zu 99,97 % der Ordermenge.
- **Spezifikation und Zustandsmaschine verlangen das Gegenteil.** Dokument 04:
  `OPENING → OPEN`, sobald die Entry-Order „voll gefüllt oder terminal mit
  positiver gefüllter Menge“ ist. `checkPositionTransition` erlaubt genau das.
  Der Codekommentar am Ablauf („if nothing has filled at all yet“) passt
  nicht zum Code, der nicht prüft, ob schon etwas gefüllt ist.
- **Schweregrad:** Die Auswirkung ist hoch, weil eine Position ohne jeden
  Exit-Schutz bleibt. In `OFFICIAL_V1` ist der Eintritt sehr
  unwahrscheinlich: Dazu muss eine BTCUSDT-1h-Kerze weniger als das
  100-Fache der Ordermenge handeln. Die Erkennung ist nur indirekt.
  Mit Echtgeld wäre der Fehler kritisch.
- **`OFFICIAL_V1` ist bisher nicht betroffen.** Laut der lesenden VPS-Prüfung
  vom 2026-10-18, 18:13 UTC, gibt es noch keine einzige Order. Kommt die
  Korrektur vor dem ersten Candidate, läuft kein offizieller Trade unter
  diesem Fehler.
- **Empfehlung: Option K.** Der Ablaufpfad öffnet die Position genauso wie
  der Shortfall aus ADR 0009 und der Profil-Stopp aus ADR 0023. Das ist ein
  gemeinsamer Helfer in `shadowFillPersistence.ts`, sonst ändert sich
  nichts. Vorher prüft der Betreiber lesend auf dem VPS (Abschnitt „Z1“).

## Kontext

### Der Befund in einem Satz

`processEntryOrderFillForCandle` (`shadowFillPersistence.ts:479-495`,
deployt `:420-436`) ruft bei `!fill.fillable` ab der zweiten Kerze
`expireOrderAndReleaseReserve` (`:1213-1314`, deployt `:993`) auf. Diese
Funktion ändert nur Order, Reserve-Ledger und Audit. Die Position fasst sie
nicht an.

### Wann eine zweite Kerze nicht füllbar ist

`computeMarketFill` (`trading-simulation/src/market-fill-v1.ts:202-270`)
liefert `fillable: false` ohne Fehlerpfad in diesen Fällen:

- `SIMULATION_NO_LIQUIDITY`: Das Volumen mal 1 %, abgerundet auf den Step,
  ergibt null.
- `SIMULATION_BELOW_MIN_QUANTITY`: Die mögliche Menge liegt unter dem Minimum.
- `SIMULATION_BELOW_MIN_NOTIONAL`: Der Rest ist kleiner als 10 USDT. Das
  passiert auch bei normaler zweiter Kerze, wenn die erste Kerze fast alles
  gefüllt hat.

`INVALID_*` und `RESERVE_EXCEEDED` sperren dagegen die Session. Diese Fälle
gehören nicht zu diesem Befund.

### Synthetische Probe

Grundlage ist das In-Memory-Prisma aus `test/support/shadowExecutionFixtures.ts`,
ohne DB und ohne echte Daten. Die Probe ist nicht committet. Sie liegt mit
beiden Varianten im Notizordner der Sitzung
(`opening-after-partial-expiry/probe-0c55e52.test.ts` und `-16d6d0f.test.ts`).
Für `16d6d0f` wurde das Seed-Profil auf die Werte von BTCUSDT v2 gesetzt
(10/2/3 bp, Teilnahme 1 %). Ergebnis: 9 von 9 Fällen grün auf beiden Ständen.

| Fall | Ablauf | Ergebnis |
|---|---|---|
| L1 | LONG 0,1 BTC. C1 mit Volumen 0,1 füllt 0,001 BTC, C2 mit Volumen 0,0005 | Order `EXPIRED` (`SIMULATION_NO_LIQUIDITY`), Reserve 0. Position `OPENING`, 0,001 BTC, `openedAt` leer, ExitPlan `ACTIVE` |
| L2 | C1 mit Volumen 9,997 füllt 0,09997 BTC, C2 normal mit 1000 | Rest 0,00003 BTC ≈ 0,72 USDT. Order `EXPIRED` (`SIMULATION_BELOW_MIN_NOTIONAL`). **99,97 % der Order stehen ohne Exit-Schutz in `OPENING`** |
| S1 | SHORT wie L1 | Wie L1. Die Collateral-Reserve von 24,98 USDT bleibt an der Position gebunden |
| alle | danach: Stop-Kerze (low 23 500 < Stop 23 600) und eine Kerze nach `maxHoldUntil` | Monitor-Funktion `NOT_APPLICABLE`, Monitor-Job `scanned = 0`. Fill-Job `scanned = 0`. Manueller Risk Close `POSITION_NOT_OPEN`. Kein Exit-Fill |
| W1 | C1, C2 und C3 je mit Volumen 0,1 | C3 füllt noch, obwohl `expiresAt` = C3-Open. Siehe Nebenbefund N1 |
| K1 | C1 teilgefüllt, danach Kill Switch, C2 ist Stop-Kerze | Fill-Job bekommt das Portfolio nicht (`scanned = 0`), Monitor `scanned = 0`. Order bleibt `PARTIALLY_FILLED`, Position `OPENING`, für die Dauer der Sperre unüberwacht |

### Alle Pfade, die eine `OPENING`-Position erreichen könnten

| Pfad | Ort | Wirkung auf `OPENING` |
|---|---|---|
| Ablauf nach der zweiten Kerze | `shadowFillPersistence.ts:479-495`, `:1213-1314` | Order `EXPIRED`, Position unverändert. **Gestrandet** |
| Ablauf des Order-Zeitfensters | `shadowOrderPersistence.ts:82, 496-497` (`expiresAt` = `earliestFillAt` + 2 h) | Kein Code liest `expiresAt`. Das Fenster läuft nur über den Kerzen-Cursor (N1). Kein eigener Ablaufjob |
| Entry-Gap auf C1 | `shadowFillPersistence.ts:353-384` | Nur vor jedem Fill möglich, also keine Position. Korrekt |
| Rest auf C2 gefüllt | `:779-798` | Order `FILLED`, Position `OPEN`. Korrekt, aber siehe N2 |
| Shortfall nach Teilfill (ADR 0009) | `:786-798`, `:953-978` | Order `CANCELLED`, Reserve frei, Position `OPEN`, Zwangs-Close markiert. Korrekt |
| Profil-Stopp (ADR 0023) | `stopEntryOrderOnInvalidProfile`, `:1083-1205` | Order `CANCELLED`, Reserve frei, Position `OPEN`, `OPENED`-Event. Korrekt. Nur auf `0c55e52`, nicht deployt |
| Position Monitor | `jobs/shadowMonitorPositions.ts:97-99`, `lib/shadowPositionMonitor.ts:93-96, 259-263` | Wählt nur `OPEN`/`PARTIALLY_CLOSED`, sonst `NOT_APPLICABLE` |
| Manueller Risk Close | `manualRiskClose.ts:44, 70-76` | `POSITION_NOT_OPEN`. Selbst ein Event würde der Monitor nicht lesen |
| Kill Switch, `ERROR_LOCKED`, `PAUSED`, Entry-Breaker | `scheduler.ts:105-111` (Fill-Job im ENTRY-Scope, nur entry-bereite Portfolios) | `PARTIALLY_FILLED` bleibt eingefroren, die Position bleibt `OPENING` und unüberwacht (K1). Kein Code bricht Entry-Orders bei Kill Switch ab, obwohl Dokument 04 `→ CANCELLED` vorsieht |
| Reconciliation | `shadowReconciliation.ts:51-56` | Zählt `OPENING` als Exposure. Eine Prüfung „`OPENING` mit terminaler Entry-Order“ gibt es nicht. Indirekt siehe unten |
| Alerts | `alertCollector.ts:229-231, 256-284` | `POSITION_WITHOUT_SAFE_EXIT` nur ohne ExitPlan (hier vorhanden), `POSITION_MONITOR_STALE` nur ohne Monitor-Erfolg (der Monitor läuft). Kein Alert |
| Eligibility, Check 11 | `shadowEligibility.ts:1134-1150` | Prüft nur „ExitPlan vorhanden“. Besteht |
| Bewertung und Risk | `shadowPortfolioValuation.ts:17`, `riskInputAssembler.ts:35-40` | Zählen die Position als Exposure. Der `openScopeKey` sperrt neue Entries im Asset |

### Was die vorhandenen Schutzmechanismen leisten

**Erkennung nur indirekt.** Den Equity-Cache einer `OPENING`-Position bewertet
niemand neu. Der Fill schreibt ihn, der Ablauf nicht. Der Monitor schreibt
ihn nur für `OPEN`, der Tagesstart einmal am Tag. Sobald sich der Mark bewegt, meldet
die Reconciliation `PORTFOLIO_EQUITY_MISMATCH`. Im Probe passierte das bei
der ersten Reconciliation nach C2. Folge: CRITICAL `RiskEvent`, Session und
Portfolio `ERROR_LOCKED`, Alert.

Das ist ein Nebeneffekt, keine gezielte Prüfung:

- Die Meldung nennt weder die Position noch die Ursache. Sie sieht aus wie
  ein Ledger-Problem.
- Sie schließt nichts und überwacht nichts. Die Position läuft weiter ohne
  Stop.
- `ERROR_LOCKED` hat im Worker keinen Rückweg (ADR 0022, Entwurf).
- Im Probe meldete die Reconciliation nach der Teilfüllung zusätzlich
  `DUPLICATE_ENTRY_ORDER_SCOPE` und beim Short `COLLATERAL_MISMATCH`. Beides
  sind Artefakte des Fakes, siehe „Regressionstests“.

**Behebung: keine.** Kein Pfad befördert oder schließt eine gestrandete
Position.

### Kann das in `OFFICIAL_V1` passieren?

**Ja, im Prinzip.** Code und Pfad sind im deployten `16d6d0f` identisch, der
Probe läuft dort mit dem v2-Profil grün. Die Vorbedingung ist allerdings
streng:

1. **Teilfüllung auf C1.** Bei 1 % Teilnahme braucht es ein 1h-Volumen
   unter dem 100-Fachen der Ordermenge. `OFFICIAL_V1` handelt mit 10 000 USDT
   und 0,25 % Risiko. ADR 0023 rechnet dafür rund 0,044 BTC je Order, die
   Schwelle liegt also bei etwa 4,4 BTC in der Stunde. Der Daten-Worker
   speichert nur geschlossene Kerzen (`fetchCryptoCandles.ts`,
   `skippedOpenCandleCount`). Eine solche Kerze müsste also echt dünn sein
   oder ein Datenfehler.
2. **Danach eine nicht füllbare Kerze.** Entweder praktisch kein Volumen,
   oder der Rest liegt unter 10 USDT.

**Stand heute: kein betroffener Fall.** Die lesende VPS-Prüfung vom
2026-10-18, 18:13:22 UTC
([Bericht](../research/2026-10-18-official-v1-security-report.md) auf
`claude/risk-directive-enforcement-draft`, `bb912bf`) fand seit dem Start keine
`RiskAssessment`, keine Order und keine nicht terminale Position. Eine
gestrandete Position kann es bis dahin also nicht geben. Der Pfad ist aber
scharf: Er kann bei jeder künftigen Teilfüllung eintreten. Ob es seitdem
Orders gab, zeigen Q1 bis Q5 der lesenden Prüfung.

### Warum es nicht auffiel

Die Tests decken Teilfüllung → Rest gefüllt (Short), Teilfüllung → Shortfall
und Teilfüllung → Profil-Stopp ab. Teilfüllung → Ablauf fehlt. Die Lücke
besteht seit P4 (`e6c47d1`, 2026-08-02).

## Zu entscheiden

- **F1:** Wie wird der Ablaufpfad korrigiert?
- **F2:** Sollen Kill-Switch-Variante (K1) und Zeitfenster (N1) mitkorrigiert
  werden, oder getrennt?
- **F3:** Wann und wie wird ausgerollt?

## Optionen zu F1

### Option K – Ablauf öffnet die Position (empfohlen)

Kleinste sichere Korrektur, nur in `shadowFillPersistence.ts`:

- Aus `stopEntryOrderOnInvalidProfile` wird der Teil „Position öffnen“ ein
  Helfer, etwa `openPositionAfterTerminalEntry(tx, …)`. Der Ablaufpfad und
  der Profil-Stopp verwenden beide diesen Helfer.
- `expireOrderAndReleaseReserve` bekommt `shadowPositionId` und
  `filledQuantity` der Order. Beide Zweige (mit und ohne Reserve) laufen in
  einer Transaktion. Nach dem Order-Update gilt: Ist `filledQuantity > 0` und
  die Position `OPENING`, wird sie `OPEN`. `openedAt` ist die Zeit des ersten
  Entry-Fills. Dazu kommt ein `ShadowPositionEvent` `OPENED` mit
  `reasonCode` (dem Ablaufgrund) und `expiredRemainder`.
- `lastProcessedCandleId` der Position bleibt auf der letzten Fill-Kerze.
  Der Monitor wertet deshalb die Ablaufkerze C2 als Nächstes aus, wie im
  Profil-Stopp aus ADR 0023.
- Unverändert bleiben Orderstatus `EXPIRED`, Ablaufgrund, Reserve-Buchung,
  Fills, Mengen, Ledger, Risk Engine, Strategien, Gates und Arena. Für jede
  Order ohne Fill und jeden normalen Trade ändert sich nichts.

Die Transition ist durch Dokument 04 und `checkPositionTransition` gedeckt:
Die Entry-Order ist terminal, die Menge positiv, der ExitPlan vorhanden. Eine
Risikoregel ändert sich nicht.

### Option R – zusätzlich eine Reconciliation-Prüfung

Ein eigener Befund für „`OPENING` mit terminaler Entry-Order“ statt des
indirekten Equity-Mismatch. Er braucht einen neuen `PortfolioReasonCode` in
`packages/portfolio` und sperrt fail-closed. Das ist sinnvoll als zweite
Verteidigungslinie, aber keine Korrektur. Empfehlung: Folgearbeit.

### Verworfen

- **Monitor nimmt `OPENING` mit:** Dann gäbe es zwei Schreiber im
  Fill-Fenster, und Exits würden mit laufenden Entry-Fills kollidieren.
- **Selbstheilung im Monitor** (gestrandete Position beim Lesen befördern):
  verdeckt die Ursache und ändert die Monitor-Semantik. Liefert Q1 Treffer,
  gehört die Reparatur als geprüfte Admin-Korrektur nach ADR 0004 in einen
  eigenen Schritt.
- **Nur Doku anpassen:** lässt Exposure ohne Schutz und widerspricht
  Dokument 04.

## Optionen zu F2

- **K1, Sperre während `PARTIALLY_FILLED`:** Dokument 04 sieht bei Kill
  Switch `→ CANCELLED` vor. Eine Korrektur müsste den Rest im
  MONITORING-Scope abbrechen und die Position öffnen, weil der Fill-Job
  gesperrt ist. Das berührt Scheduler-Scopes und ist größer als K.
  Empfehlung: eigene Entscheidung nach K. Mit K allein holt der Monitor die
  verpassten Kerzen nach dem Entsperren historisch nach. Bei einem
  dauerhaften `ERROR_LOCKED` bleibt die Lücke aber offen.
- **N1, Fenster nach Teilfüllungen:** ADR 0005 und Dokument 07 sagen „Rest
  läuft nach zwei Kerzen ab“. Der Code expiriert nur bei einer nicht
  füllbaren Kerze. Eine Korrektur (Ablauf, sobald `candle.openTime >=
  expiresAt`) ändert das Fill-Ergebnis. Empfehlung: eigener Commit mit
  eigener Freigabe. Mit K öffnet auch dieser Ablauf die Position korrekt.

## Regressionstests (mit der Korrektur)

Die Probe lässt sich direkt übernehmen. Erwartungen nach K:

1. L1, L2, S1: Order `EXPIRED` mit unverändertem Grund, Position `OPEN`,
   `openedAt` = Zeit des ersten Fills, genau ein `OPENED`-Event mit Grund und
   Restmenge.
2. Danach eine Stop-Kerze: `STOPPED_OUT`. Ein Stop in C2 selbst wird erkannt.
3. Kerze nach `maxHoldUntil`: `TIME_EXIT`. Ein manueller Risk Close wird
   angenommen und ausgeführt.
4. Reconciliation nach Ablauf und Monitorlauf: konsistent, kein Equity-Mismatch.
5. Short: Collateral bleibt bis zum Exit an der Position und wird danach frei.
6. Wiederholter Aufruf mit derselben Kerze: `ALREADY_PROCESSED`, kein
   zweites Event.
7. Unverändert: Ablauf ohne Fill (Entry-Gap, zwei leere Kerzen), voller
   Fill, Shortfall nach ADR 0009 und Profil-Stopp nach ADR 0023 liefern
   dieselben Zeilen wie vorher.

**Fake vorher reparieren**, sonst melden Reconciliation-Tests auf
Teilfüllungen Artefakte:

- `applyData` schreibt `undefined` in die Zeile. Prisma lässt solche Felder
  weg. Folge: `openEntryScopeKey` verschwindet, und es kommt ein falsches
  `DUPLICATE_ENTRY_ORDER_SCOPE`.
- Die Relation `shadowOrder.tradeDecision` (und weiter `riskAssessment`)
  fehlt. Folge: ein falsches `COLLATERAL_MISMATCH` für offene Shorts.

## Optionen zu F3 (Rollout)

### Z1 – Lesende Prüfung auf dem VPS (zuerst, Betreiber)

Die Abfragen stehen in `scripts/ops/opening-after-partial-expiry-check.sql`.
Sie laufen in einer Transaktion `REPEATABLE READ READ ONLY` mit `ROLLBACK`,
der Aufruf steht im Dateikopf. Geprüft wurden sie gegen eine Wegwerf-DB mit
den Migrationen von `16d6d0f`. Ein synthetischer gestrandeter Fall wurde
gefunden, eine normale offene Position nicht. Auf dem VPS ist nichts
ausgeführt.

Die Kernabfrage Q1:

```sql
SELECT pf."key" AS portfolio, a."symbol", p."id" AS position_id, p."direction",
       p."openQuantity", p."averageEntryPrice", p."stopPrice", p."maxHoldUntil",
       p."openedAt", p."createdAt" AS position_created_at,
       o."id" AS entry_order_id, o."status" AS order_status, o."cancelReasonCode",
       o."requestedQuantity", o."filledQuantity", o."remainingQuantity",
       o."reservedQuoteAmount", o."expiresAt", o."updatedAt" AS order_updated_at
FROM "ShadowPosition" p
JOIN "ShadowOrder" o ON o."id" = p."entryOrderId"
JOIN "Portfolio"  pf ON pf."id" = p."portfolioId"
JOIN "Asset"       a ON a."id" = p."assetId"
WHERE p."status" = 'OPENING'
  AND o."status" IN ('FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED')
ORDER BY p."createdAt";
```

| Abfrage | Inhalt | Erwartet |
|---|---|---|
| Q1 | `OPENING` mit terminaler Entry-Order | 0 Zeilen |
| Q2 | jede `OPENING`-Position mit Alter, Fenster, Session und Kill Switch | 0 Zeilen, höchstens eine unter 2 h alte mit `PARTIALLY_FILLED` |
| Q3 | Entry-Orders mit Teilfüllung oder mehreren Entry-Fills je Portfolio | `teilgefuellt = 0`, `mehrere_entry_fills = 0` |
| Q4 | Reconciliation-Befunde nach Grund | keine Zeile `PORTFOLIO_EQUITY_MISMATCH` |
| Q5 | dünnste BTCUSDT-1h-Kerze seit Start gegen 100 × größte Entry-Order | `kerzen_unter_schwelle = 0` |

### Z2 – Umsetzung und Rollout

- **Wenn Q1 bis Q5 das Erwartete ergeben:** Die Evidenz ist sauber. K ändert
  keine bestehende Zeile und kein Ergebnis eines normalen Trades. Der Fix
  lässt sich als protokollierter Bugfix ins Änderungsprotokoll von
  `OFFICIAL_V1` eintragen. Umsetzung als Hotfix auf `16d6d0f`, wie für ADR
  0021 vorgesehen, nie über `da5dc66` oder `0c55e52`. Am besten kommt K in den
  vorbereiteten ADR-0021-Hotfix (`bb912bf`), und zwar vor dem ersten
  Candidate. Dann läuft kein einziger `OFFICIAL_V1`-Trade unter diesem Fehler.
  Der dort erwartete Tree-Hash ändert sich dadurch. Ergebnis: ein Image, ein
  Eintrag, ein Konsistenz-Snapshot. Neu gebaut wird nur das
  Trading-Worker-Image.
- **Neue VPS-Abfrage nur mit neuer Freigabe.** Die Freigabe vom 18:13-Lauf
  deckte genau diesen einen Lauf ab. Gab es seitdem keine Order, reicht Q3
  (`entry_orders`) als kurze Kontrolle vor dem Rollout.
- **Wenn Q1 Treffer liefert:** kein Rollout von K als Reparatur, denn K
  verhindert nur neue Fälle. Zuerst entscheidet der Betreiber über eine
  geprüfte Einzelkorrektur nach ADR 0004: Position auf `OPEN` heben, der
  Monitor holt die Kerzen ab `lastProcessedCandleId` historisch nach. Danach
  wird der bestehende `ERROR_LOCKED` geklärt.
- **Wenn nur Q3 oder Q5 auffällig ist** (Teilfüllung kam vor, aber ohne
  Strandung): K vorziehen, nicht bündeln.

## Empfehlung

1. Z1 ausführen.
2. Option K mit den Regressionstests umsetzen, auf eigenem Branch von
   `16d6d0f`, nur nach Freigabe.
3. K1 und N1 als eigene Entscheidungen.
4. Option R als Folgearbeit.

Vorrang: Dieser Befund verletzt die Invariante „jede Exposure hat einen
wirksamen Exit-Pfad“. Er geht deshalb rein dokumentarischen Abweichungen vor.

## Nebenbefunde (nicht Teil dieser Entscheidung)

- **N1 – Fill-Fenster:** Teilfüllungen auf C1, C2, C3 … halten die Order über
  `expiresAt` hinaus offen (Probe W1). Das widerspricht ADR 0005 und
  Dokument 07. Siehe F2.
- **N2 – Die Fill-Kerze wird nie auf Exits geprüft.** Nach einem Fill steht
  `lastProcessedCandleId` der Position auf der Fill-Kerze, der Monitor beginnt
  bei der nächsten. Ein Stop innerhalb von C1 wird nie gebucht. Bei
  Teilfüllung gilt das auch für C2, wenn C2 den Rest füllt. Dokument 07
  (Zeile 106) verlangt: „der gesamte OHLC-Range von C1“ ist Exitpfad. Das
  betrifft jeden Trade, auch in `OFFICIAL_V1`, und verzerrt optimistisch.
  Es braucht eine eigene Analyse und einen eigenen ADR, denn eine Änderung
  verschiebt Ergebnisse des eingefrorenen Tests.
- **N3 – Gleichstand bei Equity-Mismatch.** Für `OPEN`-Positionen kann die
  Reconciliation (`*/4`) einen neuen Mark sehen, bevor der Monitor (`*/2`)
  ihn bucht. Das ist ungeprüft und nur eine Vermutung aus dem Code. Es kann
  durch Q4 auffallen.

## Belegstellen (Stand `0c55e52`, in Klammern `16d6d0f`)

- `apps/trading-worker/src/lib/shadowFillPersistence.ts:479-495` (`:420-436`)
  Ablauf ab der zweiten Kerze; `:794-798` (`:721`) Positionsstatus nach Fill;
  `:1083-1205` Profil-Stopp (nur `0c55e52`); `:1213-1314` (`:993`)
  `expireOrderAndReleaseReserve`.
- `apps/trading-worker/src/jobs/shadowMonitorPositions.ts:97-99`,
  `apps/trading-worker/src/lib/shadowPositionMonitor.ts:93-96, 259-263, 851`.
- `apps/trading-worker/src/lib/manualRiskClose.ts:44, 70-76`.
- `apps/trading-worker/src/jobs/shadowProcessFills.ts:45-46, 116-140, 146-197`,
  `apps/trading-worker/src/scheduler.ts:105-111`.
- `apps/trading-worker/src/lib/shadowReconciliation.ts:51-56, 393-420`,
  `packages/portfolio/src/invariants.ts:101-104`.
- `apps/trading-worker/src/lib/alertCollector.ts:229-231, 256-284`.
- `apps/trading-worker/src/lib/shadowOrderPersistence.ts:82, 496-497`.
- `packages/trading-domain/src/state-machines.ts:931-951, 1018-1031`.
- `packages/trading-simulation/src/market-fill-v1.ts:202-270`.
- Dokument 04, Tabellen „Shadow Order“ und „Shadow Position“; Dokument 07,
  „Liquidität und Teilausführungen“ und Zeile 106; ADR 0005.

## Umsetzung (2026-10-19, Option K)

Lokal auf `hotfix/official-v1-security`, nach ADR 0021 und ADR 0023. Nicht
gepusht, nicht deployt, auf dem VPS nichts ausgeführt.

**Code, nur `apps/trading-worker/src/lib/shadowFillPersistence.ts`:**

- Neuer Helfer `openPositionAfterTerminalEntry(tx, …)`: hebt eine
  `OPENING`-Position mit positiver Füllmenge auf `OPEN`, `openedAt` = erster
  Entry-Fill, und schreibt genau ein `OPENED`-Event. `lastProcessedCandleId`
  der Position bleibt auf der letzten Fill-Kerze. Ohne Fill oder außerhalb
  von `OPENING` tut er nichts.
- Der Profil-Stopp aus ADR 0023 nutzt den Helfer. Seine Zeilen und sein
  Payload (`reasonCode`, `cancelledRemainder`) bleiben gleich.
- `expireOrderAndReleaseReserve` ruft den Helfer in derselben Transaktion
  auf, in beiden Zweigen (mit und ohne Reserve). Payload des Events:
  `jobKey`, `reasonCode` (der Ablaufgrund), `expiredRemainder`.
- Unverändert: Orderstatus `EXPIRED`, Ablaufgrund, Reserve-Buchung,
  Audit-Event `SHADOW_ENTRY_ORDER_EXPIRED`, Fills, Mengen, Ledger, Equity,
  Rückgabewert `EXPIRED`. Keine Sperre, kein RiskEvent. Für eine Order ohne
  Fill und für jeden normalen Trade ändert sich keine Zeile.

**Testhilfe:** Der In-Memory-Fake (`test/support/shadowExecutionFixtures.ts`)
lässt `undefined` jetzt wie Prisma unverändert und kennt die Relationen
`shadowOrder.tradeDecision` und `tradeDecision.riskAssessment`. Die beiden
Artefakte aus „Regressionstests“ treten nicht mehr auf.

**Regressionstests** (`test/shadowExecution.test.ts`, Block „ADR 0024“, 9
Fälle). Gegen den Code ohne K schlagen die ersten sechs fehl, die letzten drei
sind auf beiden Ständen grün:

1. LONG, C2 ohne Liquidität: Order `EXPIRED` (`SIMULATION_NO_LIQUIDITY`),
   Reserve frei, Position `OPEN`, Events `OPENING` → `OPENED`, keine Sperre.
2. 99,97 % gefüllt, Rest unter `minNotional`, C2 läuft durch den Stop: der
   Monitor erkennt den Stop in C2 selbst (`STOPPED_OUT`).
3. Der Monitor-Job findet die Position und arbeitet C2, C3 und die
   TP-Kerze C4 ab (`CLOSED`, Take Profit).
4. Zeit-Exit nach `maxHoldUntil`; manueller Risk Close wird angenommen und
   ausgeführt.
5. Reconciliation nach dem Monitorlauf auf C2: konsistent.
6. SHORT: Collateral bleibt bis zum Exit an der Position, danach frei;
   Reconciliation konsistent.
7. Wiederholter Aufruf mit C2: `NOT_APPLICABLE`, kein zweites Event, keine
   Buchung.
8. Ablauf ohne Fill: keine Position, kein Event, Reserve vollständig frei.
9. Entry-Gap auf C1: unverändert `ENTRY_GAP_EXPIRED`.

**Bestätigter Nebenbefund N3.** Die Reconciliation bewertet mit der neuesten
geschlossenen Kerze, der Equity-Cache trägt den Mark der letzten Buchung.
Liegt eine neue Kerze vor, die der Monitor noch nicht gebucht hat, meldet sie
`PORTFOLIO_EQUITY_MISMATCH` und sperrt die Session. Synthetisch bestätigt für
eine normale, voll gefüllte Position, also unabhängig von K. Auch eine nach
K geöffnete Position ist erst nach dem nächsten Monitorlauf konsistent. N3
ist nicht Teil dieser Korrektur und braucht eine eigene Entscheidung.

**Offen bleiben:** K1 (Sperre während `PARTIALLY_FILLED`), N1
(Fill-Fenster), N2 (Fill-Kerze), N3 und Option R.
