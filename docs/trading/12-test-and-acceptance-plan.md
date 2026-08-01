# 12 – Test- und Abnahmeplan

## Qualitätsziele

1. Keine technische Fähigkeit zu Live-/Exchange-Orders in Shadow v1.
2. Gleiche versionierte Inputs erzeugen gleiche Entscheidungen, Fills, Ledger und Performance.
3. Kein Prozessabbruch, Retry oder Parallelstart erzeugt doppelte Kandidaten, Orders, Fills oder Geldbuchungen.
4. Fehlende/widersprüchliche Daten erhöhen niemals Exposure.
5. Jede Geld-/Statuswirkung ist mit Rule Result, Domain Event und atomarem Audit belegbar.
6. Kill Switch blockiert neue Risiken, ohne Monitoring und risikoreduzierende Aktionen zu blockieren.

## Testpyramide

| Ebene | Fokus | Ausführungszeitpunkt |
| --- | --- | --- |
| Unit | Decimal, State Guards, Strategiebedingungen, 26 Risk Rules, Simulation, Ledger | jeder Commit |
| Property/Invariant | Grenzen, Monotonie, Replay, keine negativen Beträge/Mengen | jeder PR der Domainpakete |
| Contract | Paket-DTOs, Prisma-Constraints, API-DTOs | jeder PR |
| DB-Integration | Transaktionen, Isolation, Claims, Unique/FK, Recovery | P1/P5+ |
| Worker E2E | Candidate -> Risk -> Order -> Fill -> Exit -> Performance | P5+ |
| API/UI | Auth, Idempotenz, Transitions, Rendering/Accessibility | P6/P7+ |
| Chaos/Soak | Restart, Timeout, Doppellauf, stale Daten, Kill, Reconcile | P9 |
| Security/Capability | kein Adapter/Secret/Livehost, fail-closed Config | jeder Release |

## Domain- und Schema-Abnahme

- Jede erlaubte Transition mindestens ein Positivtest, jede nicht aufgelistete Kante generisch negativ.
- Terminalzustände können nicht verlassen werden.
- Optimistic-Lock-Konflikt ändert keine Zeile und schreibt kein falsches Audit.
- Unique-Schlüssel für Candidate, Decision, Order, Fill, PositionEvent, Ledger, Snapshot, Audit und Jobcursor werden in echter PostgreSQL-Integration geprüft.
- Delete von Strategie/Portfolio/Order mit Historie wird abgelehnt.
- Migration mit vorhandenen Legacy-Paper-Daten ändert weder Zeile noch Enumwert dieser Modelle.
- Decimalgrenzen, adverses ceil/floor und Serialisierung ohne JS-Precisionverlust.
- JSON-Kanonisierung: Keyreihenfolge irrelevant; Arrayreihenfolge relevant; Date/Decimal eindeutig.

## Strategy-v1-Testmatrix

Für jede Bedingung: exakt unterhalb, auf Grenze, exakt oberhalb; jeweils nur ein Merkmal variieren.

- Scope: BTC/ETH pass; anderes Symbol, non-USDT, leveraged/inverse/stablecoin, Futures fail.
- 200/250 Candles; 199 fail; Lücke/duplizierte/open Candle/future timestamp/OHLC-Invariante fail.
- Freshnessgrenzen 1h/4h/1d/DQ/Regime.
- Trendketten auf jedem TF und jede verletzte Ungleichung.
- Breakout über vorherige 20; Gleichheit fail; C0 darf Vergleichshoch nicht beeinflussen.
- RSI 50 und 72 pass, außerhalb fail; Relative Volume 1,50 pass; ATR/Close 0,5/4 % pass.
- Signale Status/Richtung/Score/Risk; MTF nur `BULLISH_ALIGNED`; Regime/Confidence/Risk Mode.
- News leer/neutral ohne Bonus; deterministisch negativer High Impact blockiert.
- Stopdistance 0,75%-Floor, 1,5 ATR, 3%-Cap; RR und Candidate-TTL/Gap.
- gleicher Snapshot -> gleicher Hash/Output auf unterstützten Node-Plattformen.
- Look-ahead-Negativtest: Änderung irgendeiner Candle nach `asOf` verändert Output nicht.

## Risk-v1-Testmatrix

Jede Zeile aus dem Regelkatalog Dokument 06 einschließlich PASS-Ergebnis persistieren. Zusätzlich:

- 10.000 USDT -> Worst-Case-Risk maximal 25 USDT inklusive Roundtripfees.
- Sizing bleibt nach Tick/Step-Rundung unter Limit; unter Minimum wird nicht aufgerundet.
- aktuelle Equity sinkt -> Riskbudget/Menge steigt nicht.
- Exposure zählt Reserven, partially filled, `OPENING`, `PARTIALLY_CLOSED` und `ERROR` mit positiver Menge.
- vier gefüllte Entry-Orders pro UTC-Tag; Partial Fills derselben Entry-Order zählen einmal.
- Tages-P&L exakt -1 % blockiert/killt; UTC-Tageswechsel resettet nicht automatisch die Session.
- drei Nettoverluste; Gewinn reset; Break-even unterbricht Serie nicht.
- BTC+ETH feste Korrelationsgruppe und Cap-Sizing.
- Portfolio-Invariante innerhalb/außer Toleranz; fehlender Start-of-Day-Snapshot.
- jede Pflichtquelle null/stale/unknown führt nie PASS.
- Hash-/Version-/Idempotenzkonflikt -> Critical/ERROR_LOCK.

## Simulations- und Portfolio-Testmatrix

### Preise und Fills

- Buy/Sell mit 0/typischem/maximalem Spread und Slippage; adverses Tickrounding.
- Fee pro Fill und Rundungsrest beim finalen Exit.
- Full Fill, mehrere Partial Fills, null Liquidität, minQty/-notional, Ablauf nach zwei Candles.
- Entry frühestens C1; zu großer Entry-Gap -> kein Fill.
- Stop only, TP only, beide -> Stop-first, Stop-Gap, TP-Gap ohne positiven Bonus.
- Entry und Stop/TP in derselben C1; Stop-first.
- Invalid Candle -> kein erfundener Fill/ERROR_LOCK.

### Ledger/P&L

- Reserve/Teilnutzung/Überschuss/Cancel/Expiry; verfügbare und reservierte Cashsumme.
- Entry/Exit/Teil-Exit; anteilige Entryfee; letzter Rundungsrest.
- realisiertes/unrealisiertes P&L, conservative bid mark, Equity/High Water Mark/Drawdown.
- Replay aller Ledgerentries reproduziert Caches exakt.
- gleiche Eventkeys zweimal ändern Ledger nur einmal.
- Gegenbuchung statt Mutation; unbekannte Differenz wird nicht automatisch korrigiert.

Property-Invarianten nach jeder generierten Ereignisfolge:

```text
availableCash >= 0
reservedCash >= 0
openQuantity >= 0
filledQuantity <= requestedQuantity
sum(reservations) == reservedCash
sum(fills) == order.filledQuantity
entryQuantity - exitQuantity == position.openQuantity
ledgerReplay == portfolioCache
```

## Transaktions-, Idempotenz- und Recoverytests

Für jede in Dokument 02 definierte Transaktion Fehler injizieren:

1. vor erstem Write;
2. nach jedem Zwischenwrite;
3. unmittelbar vor Commit;
4. simulierte Verbindungsunterbrechung nach unklarem Commit;
5. Retry durch gleichen und konkurrierenden Worker.

Erwartung: entweder keine Wirkung oder genau eine vollständige Wirkung. Danach Reconcile ohne unklaren Fund.

Weitere Szenarien:

- zwei Prozesse claimen denselben Kandidaten/Order/Candle;
- Advisory Lock verloren, Unique Constraints bleiben wirksam;
- Claim läuft ab, ursprünglicher Worker kommt verspätet zurück;
- Restart mit `VALIDATING`, `PARTIALLY_FILLED`, `OPENING`, `TRIGGERED`;
- Cursor hinter/auf/vor vorhandenen Events;
- Fill vorhanden, Projektion fehlt -> rebuild; Fill/Ledger widersprechen -> ERROR_LOCK;
- Scheduler feuert während graceful shutdown;
- DB-Zeit vs Host-Zeit/UTC-Tagesgrenze.

## Kill-Switch-/Session-Abnahme

Jeder Zustand aus Dokument 04 wird geprüft. In `STOPPED`, `PAUSED`, `KILLED`, `ERROR_LOCKED`:

- kein neuer Candidate, Approval, Reserve oder Entry-Fill;
- wartende Entry-Orders canceln und Reserve freigeben;
- Positionmonitor, Stop/TP/Max-Hold und risikoreduzierender Exit laufen;
- Reconcile und Read-API laufen;
- keine automatische Liquidation nur wegen Kill.

Trigger: Admin, Tagesverlust, Loss Streak, Portfolioinkonsistenz, Hashkonflikt, kritische Datenstale, Workerfehler. Auflösung nur `KILLED/ERROR_LOCKED -> STOPPED` nach Acknowledge/Reconcile; Aktivierung separater Schritt. Gleichzeitige Kill-/Fill-Race wird mehrfach getestet; Ergebnis darf Exposure nie erhöhen und muss eindeutig auditiert sein.

## API-, UI- und Securitytests

- Alle Trading-Routen unter bestehender Auth; unauthentifizierte Reads/Mutationen abgelehnt, falls Auth aktiviert.
- Mutationen mit Idempotency-Key, Requesthash, expectedVersion; Replay/409/Hashkonflikt.
- Keine freie Enum-/Statusmutation, keine Live/Futures/Margin/Leverage-/Exchange-Key-Felder.
- Pagination begrenzt; Decimal/UTC korrekt; sensible JSONfelder nur in autorisiertem Detailkontext.
- Audit synchron zur Mutation; Auditfehler rollt fachliche Mutation zurück.
- UI kennzeichnet überall Shadow und modellierte Kosten; Unknown/stale als blockiert; Paper vs Shadow getrennt.
- Kill Control accessible, confirmation-safe und auch bei Entryflags-off funktionsfähig.
- statische Suche/Dependency- und Egressprüfung: kein Exchange-SDK, kein privater Orderendpoint, kein Exchange-Credentialname in Shadow-Binary; `ENABLE_LIVE_TRADING=true`/unknown mode starten nicht.
- Logs/Audit/Errors enthalten keine Secrets, Cookies, Authorization-, Signatur- oder vollständige Env-Werte.

## Bestandsschutztests

Vor und nach jedem Paket bestehende Tests für Analyse, Discovery, Alerts, Dashboard, Paper Evaluation, Backtesting und Strategy Lab ausführen. Spezifisch:

- gleiche vorhandene Signal-/Paper-Evaluation-Fixtures und Ergebnisse;
- keine neue Relation/Query verändert aktive Analyseuniversen;
- `Asset.isActive` aktiviert kein Trading;
- Scheduler des bestehenden Workers behält Jobs/Defaults;
- Legacy-Paper-Exports bleiben bis eigener Deprecationphase verfügbar;
- `PaperSignalEvaluation` bleibt aus Shadow-Performance ausgeschlossen.

## Shadow-E2E-Szenarien

1. Voller Gewinntrade: Candidate -> PASS -> Reserve -> Fill -> TP -> Ledger/Performance/Audit.
2. Stoptrade mit Gap: adverse Ausführung, Tages-P&L/Loss Streak.
3. Same-candle Konflikt: Stop-first.
4. Teilfill dann Expiry: Teilposition, Restreserve frei, gültiger ExitPlan.
5. Risk Reject je harte Limitfamilie: keine Order/Reserve.
6. Kill zwischen Approval und Fill: Entry cancel, keine Position.
7. Kill mit offener Position: Stop/TP weiter aktiv.
8. Stale Daten vor Entry: cancel; stale Daten bei Position: lock/alert, kein erfundener Preis.
9. Prozessabbruch an jeder Transaktionskante: exakt einmal nach Recovery.
10. Zwei BTC/ETH-Setups: Asset-/Portfolio-/Korrelationscaps.

## Staged Shadow-Testphase

### Gate A – offline/replay

- alle Unit/Property/Integration/E2E/Golden-Tests grün;
- mindestens 1.000 historische, chronologisch abgespielte 1h-Cycles ohne Invariantenverletzung;
- identischer Replay zweimal: identische fachliche IDs/Hashes/Endsalden (technische `createdAt` ausgenommen und nicht im Fachhash);
- bewusste Chaosfehler vollständig recovered.

### Gate B – interner BTC-Soak

- nur BTC-Assignment, alle Dashboards/Alerts beobachtet;
- mindestens 14 Tage und 100 Schedulercycles;
- keine ungeklärten Critical Events, Duplicate- oder Ledgerabweichungen;
- mindestens eine geplante Restart-, Kill- und Datenlückenübung.

### Gate C – BTC+ETH-Soak

- ETH erst nach Gate B;
- Gesamtmessfenster mindestens 60 Kalendertage;
- Ziel mindestens 50 geschlossene Positionen. Ist Strategie seltener, Fenster verlängern; Schwellen nicht lockern;
- 0 ungeklärte Critical Events, 0 Cash/Ledger/Fill/Position-Invariantenfehler, 100 % finale Decisions mit vollständigen Rule Results/Audits;
- Recovery-Zeit und Monitoring-Freshness innerhalb dokumentierter Operationsziele.

### Gate D – Abschlussreview

- Codex vergleicht Implementierung erneut mit Dokumenten/ADRs;
- alle offenen Defects klassifiziert, Blocker/Critical geschlossen;
- Strategy-/Risk-/Simulationversion während Messfenster unverändert oder Zeiträume sauber getrennt;
- Backups/Restore/Reconcile mit Shadowtabellen getestet;
- Capability-/Netzwerkaudit bestätigt keine Exchangeausführung;
- Nutzer entscheidet separat, ob überhaupt eine Demo-Adapteranalyse fortgesetzt wird.

## Kein automatischer Promotionpfad

Bestandene Shadow-Abnahme aktiviert weder Bitget Demo noch Live Trading. P10 braucht neuen Prompt, aktuelle offizielle Quellen, grünes Regional-/Legal-Gate, eigene ADR/Threat Model und neue Abnahme. Live bleibt vollständig außerhalb dieses Plans.
