# ADR 0009 – Netto-CRV-Recheck nach dem tatsächlichen Entry-Fill

- Status: Accepted
- Datum: 2026-08-10

## Kontext

Dokument 05 verlangt: "Nach tatsächlichem Entry-Fill werden Risikobudget und RR mit dem adversen Fill erneut geprüft. Liegt RR dann unter 2,0, darf die Order vor Fill auslaufen/abgelehnt werden; ein bereits erfolgter Fill erhält unverzüglich einen gültigen ExitPlan und wird nicht 'unsichtbar' gemacht." P4 hat das bewusst als offenen Punkt dokumentiert: `R-008-MIN-RR` prüft nur die Vorab-Planpreise mit der worst-case *projizierten* Entry-Preisannahme. Der tatsächliche Fill kann davon abweichen (Gap, reales Spread/Slippage/Fee auf der konkreten Kerze), sodass das reale Netto-CRV nach dem Fill niedriger sein kann als beim Pre-Trade-Check.

## Entscheidung

`packages/risk-engine` bekommt eine neue reine Funktion `computePostFillNetRewardRisk`, die aus dem tatsächlichen gewichteten Entry-Preis, der tatsächlich gezahlten Entry-Gebühr, dem geplanten Stop/TP und demselben Kostenprofil (Fee/Spread/Slippage-bps, Tick Size) das reale Netto-CRV berechnet. Anders als die Vorab-Formel wird die Entry-Seite **nicht** erneut advers verschoben — sie ist bereits real; nur die Stop-Seite bleibt eine konservative Projektion (`computeWorstSellFill`, dieselbe Formel wie in `computePositionSizing`).

`apps/trading-worker/src/lib/shadowFillPersistence.ts` ruft diese Funktion nach jedem Entry-Fill in derselben Transaktion auf und liest dabei das aktuell aktive `RiskLimitSet.minRewardRisk` frisch (nicht aus einem gecachten Wert). Ergebnis:

- **Netto-CRV ≥ Minimum:** keine Änderung gegenüber P4 — Order/Position laufen normal weiter.
- **Netto-CRV < Minimum oder nicht berechenbar oder kein aktives RiskLimitSet:** fail-closed.
  - Der bereits gefüllte Teil bleibt bestehen und bekommt weiterhin sein `ExitPlan` — nichts wird unsichtbar gemacht.
  - Ein noch unausgefüllter Rest der Order verfolgt keine weitere Auffüllung mehr: die Order wird `CANCELLED` (Grund `POST_FILL_NET_CRV_BELOW_MINIMUM`) statt `PARTIALLY_FILLED`, und die verbleibende Reserve wird atomar über die bestehende `computeReleaseReservation`-Buchung freigegeben.
  - Ein unbestätigtes, kritisches `RiskEvent` (Typ `RISK_RULE_BLOCK`) wird an die Position gehängt; `apps/trading-worker/src/lib/shadowPositionMonitor.ts` erkennt dieses Event und erzwingt beim nächsten verarbeiteten Candle einen `MANUAL_RISK_CLOSE`, sofern nicht ohnehin ein härterer Stop/TP zuerst greift.
  - Ein `ShadowPositionEvent` (`MARKED`) und der reguläre Fill-Audit-Eintrag dokumentieren die Rechenwerte (Recheck-Ergebnis, verwendetes Minimum) nachvollziehbar.

Keine Risiko-Grenze, kein Kostenprofil und kein Limitset wird zur Vermeidung dieses Falls abgeschwächt; `R-008-MIN-RR`'s 2,0-Minimum bleibt exakt dasselbe.

## Folgen

- Ein Fill kann jetzt zu einer erzwungenen, risikoreduzierenden Schließung führen, ohne die Position vor dieser Schließung ungeschützt zu lassen.
- Zusätzliche RiskEvent-/PositionEvent-Historie pro betroffener Position; kein neues Datenbankmodell nötig (bestehende `RiskEvent`/`ShadowPositionEvent`-Tabellen reichen).
- `packages/risk-engine/src/position-sizing.ts` wurde minimal refaktoriert (gemeinsame `computeWorstSellFill`-Hilfsfunktion), ohne die bestehende Sizing-Formel fachlich zu ändern; alle 86 vorhandenen Tests bleiben unverändert grün.

## Verworfene Alternativen

- Vorab-Formel (`computePositionSizing`) unverändert mit dem tatsächlichen Fillpreis als `referenceEntryPrice` erneut aufrufen: hätte die Entry-Seite ein zweites Mal advers verschoben und damit systematisch strengere, nicht dokumentierte Ergebnisse erzeugt.
- Bei Unterschreitung sofort eine synthetische Gegenkerze simulieren und den Fill spekulativ "zurückdrehen": erzeugt einen erfundenen Preis außerhalb der belegten Kerzenhistorie (verboten laut ADR 0005).
- Minimum-CRV für den Recheck lockern oder aus dem Ausführungsprofil ableiten statt aus `RiskLimitSet`: widerspricht der expliziten Vorgabe, keine Grenzen abzuschwächen.
