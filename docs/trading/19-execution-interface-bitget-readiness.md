# 19 — Execution-Interface: Bereitschaft für einen späteren `BitgetExecutionAdapter`

Stand 2026-10-14. Es gibt keine Bitget-Keys und keine echte Execution. Dieses
Dokument prüft nur, ob die heutige Architektur einen Adapter später aufnehmen
kann, ohne Strategy-, Arena- oder Risk-Engine umzubauen.

Zielreihenfolge:

```
Strategy / Arena  →  zentrale Risk Engine  →  Execution Interface  →  ShadowExecution | BitgetExecution
```

## Ergebnis

**Ja, der Zielfluss ist erreichbar.** Die Engines oberhalb der Execution
bleiben unverändert. Gebaut werden muss die Execution-Schicht selbst. Ein
Interface gibt es heute bewusst noch nicht; nach Doc 02 und ADR 0001 wird es
erst mit der Demo-Phase spezifiziert.

| Baustein | Wiederverwendbar? |
|---|---|
| `packages/strategy-engine` | unverändert: pur, kennt keine Ausführung |
| `packages/arena`, Arena im Worker | unverändert: liest nur Portfolio, Ledger und Bewertung. Speist ein Adapter das Ledger mit echten Fills, rechnet die Arena gleich weiter |
| `packages/risk-engine` | Regeln, Sizing und Post-Fill-CRV unverändert. Bewusst und auditiert anzupassen sind die Capability-Regel R-001 (heute strikt `SHADOW_ONLY`) und der Ergebnisname `APPROVE_SHADOW` |
| `packages/portfolio` | Ledger-, Reservierungs-, Positions- und Bewertungsfunktionen arbeiten mit bestätigten Domain-Events und funktionieren auch mit echten Fills |
| `packages/trading-simulation` | bleibt die Implementierung von `ShadowExecution` |
| Worker-Infrastruktur | Sessions, Kill Switch, Entry-Guard pro Portfolio, Leases, Circuit Breaker, Outbox-Muster (Vorlage für eine Execution-Outbox) |

## Schnittstelle

Die Risk Engine endet mit `TradeDecision(APPROVE_SHADOW)` und dem Sizing in
`RiskAssessment` (`shadowRiskPersistence.ts`). Ab
`createShadowOrderForCandidate` (`shadowOrderPersistence.ts`) beginnt die
Ausführung. Heute ist sie in drei Worker-Modulen fest mit der Simulation
verschmolzen:

- **Order:** `shadowOrderPersistence.ts` geht sofort auf
  `WAITING_FOR_ENTRY`, ohne Submit/Ack.
- **Entry-Fill:** `shadowFillPersistence.ts` arbeitet kerzenbasiert, in einer
  DB-Transaktion mit Position, Fill und Ledger.
- **Exit:** `shadowPositionMonitor.ts` vermischt Trigger-Erkennung und
  simulierten Fill.

Diese drei Module werden die `ShadowExecution`-Implementierung hinter einem
neutralen Port.

## Was für Bitget fehlt

1. **Execution-Port** (eigenes Paket, nicht im Trading-Worker): `submit`,
   `cancel`, `queryByClientOid`, `fetchFills`, `fetchBalances`, mit neutralen
   Typen statt `Shadow*`.
2. **Asynchroner Order-Lebenszyklus:** `SUBMITTED`, `ACKED`,
   `UNKNOWN_OUTCOME` und `CANCEL_PENDING` plus Exchange-Order-ID und
   Umgebung. Ein Ack ist kein Fill. Nach einem Timeout wird nie blind erneut
   gesendet, sondern erst per `clientOid` abgefragt.
3. **Fills ohne Kerzenpflicht:** `ShadowFill.sourceCandleId` ist Pflicht. Es
   braucht ein eigenes `ExchangeFill` mit `execId`, echter Gebühr und
   Gebühren-Asset.
4. **Transaktionen trennen:** Intent und Outbox in der DB, Senden außerhalb
   der Transaktion, Inbox-Events werden zu Fill, Ledger und Position.
5. **`clientOid` ≤ 32 Zeichen:** `buildClientOrderId` erzeugt heute
   `sp-` plus 32 Hex-Zeichen, also 35 Zeichen. Das passt nicht zu Bitget und
   muss vor dem Adapter gekürzt werden. Im laufenden Shadow-Test wird es
   bewusst nicht angefasst.
6. **Reconciliation gegen die Börse:** Salden, offene Orders und Fills; REST-Snapshot, WebSocket,
   Lückenerkennung, periodischer REST-Abgleich. Fills werden zeitnah
   persistiert, weil die Historie der Börse nur 90 Tage zurückreicht.
7. **Credentials:** Secret-Store (nie DB, Logs oder UI), Signatur, Prüfung
   beim Start auf minimale Rechte, IP-Allowlist und Umgebung. Ein Demo-Key ist
   nie zu Live hochstufbar.
8. **Kill Switch bis zur Börse:** offene Börsen-Orders stornieren;
   risikoreduzierende Aktionen bleiben erlaubt.
9. **Capability und Modus:** `TradingBuildCapability` und `TradingMode` über
   `SHADOW_ONLY`/`SHADOW` hinaus erweitern, `EXECUTION_MODE=DISABLED|BITGET_DEMO`
   ohne Live-Wert im Binary, `safety.ts` und R-001 anpassen. Jede dieser
   Änderungen braucht eine eigene ADR.
10. **Rate-Limiter und Exchange-Circuit-Breaker** (der heutige Breaker
    arbeitet auf Job-Ebene).
11. **Exit-Strategie:** Trigger weiter aus Kerzen, dann Market-Order — oder
    Stop-Orders an der Börse.
12. **Venue-Daten:** Bitget-Filter und -Gebühren statt modellierter bp sowie
    eine Basis-Prüfung Binance-Signal gegen Bitget-Ausführung (OD-36).
13. **Kapital-Zuordnung:** Arena-Teilnehmer haben virtuelles Kapital je
    Portfolio. Auf einem echten Konto braucht es Sub-Accounts oder eine
    virtuelle Aufteilung mit eigener Reconciliation. Das passt zur späteren
    `CapitalAllocationDecision` (Doc 17).

## Regulatorischer Vorbehalt

ADR 0007 hält fest: Bitget ist für einen in Deutschland ansässigen Nutzer
nach den geprüften Nutzungsbedingungen ausgeschlossen, ohne Umgehung. Vor
jedem Adapter-Code steht eine erneute rechtliche Prüfung. Das ist eine
Entscheidung für dich, keine Code-Frage.

## Was das VPS-Deployment schon berücksichtigt

- Der offizielle Forward-Test läuft vollständig über das portfoliobezogene
  Ledger. Ein späterer Adapter speist dasselbe Ledger, und die Arena-Historie
  bleibt vergleichbar.
- Eine Kapitalbuchung ohne Order-, Fill- oder Positionsreferenz ist in der
  Arena ein harter Stopp. Ein Adapter muss deshalb jede Buchung referenzieren,
  was der gewünschten Disziplin entspricht.
- Es gibt genau einen Trading-Worker je Datenbank (`preflight`). Ein späterer
  `execution-worker` wäre ein eigener Prozess, kein zweiter Scheduler.
