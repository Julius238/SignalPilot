# 04 – Zustandsmaschinen

## Gemeinsame Regeln

- Nur die hier aufgeführten Übergänge sind erlaubt. Direkte Prisma-Updates ohne Transition Guard sind verboten.
- Jeder Übergang prüft erwarteten Zustand und `version`, schreibt Reason Code und `TradingAuditEvent` in derselben Transaktion.
- Terminalzustände sind unveränderlich. Fachliche Korrekturen erzeugen neue Events/Aggregate, kein Zurücksetzen.
- Ein Retry desselben Übergangs mit gleichem Idempotenzschlüssel liefert das vorhandene Resultat. Gleicher Schlüssel plus anderer Payload-Hash führt zu `ERROR_LOCKED`.
- Direction ist nach Anlage unveränderlich. Candidate, StrategyVersion, Assignment, Entry-/Exit-Order, Fills und Position müssen dieselbe Direction-Kette belegen; ein Widerspruch führt fail-closed zu `ERROR_LOCKED`.
- Side ist richtungsabhängig: Long `BUY -> SELL`, Short `SELL -> BUY`. Ein Spot- oder Exchange-Adapter darf Short niemals annehmen; Short ist nur im internen Shadow-Simulator zulässig.

## Trade Candidate

```text
CREATED -> VALIDATING -> READY_FOR_RISK -> APPROVED_FOR_SHADOW
                    \-> INVALID          \-> RISK_REJECTED
CREATED/VALIDATING/READY_FOR_RISK -> EXPIRED | CANCELLED
```

| Von                        | Nach                  | Auslöser und Guard                                                                              |
| -------------------------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| –                          | `CREATED`             | eindeutiger Candidate-Key, aktive Zuweisung, geschlossene Anker-Candle; Kandidat/Evidenz atomar |
| `CREATED`                  | `VALIDATING`          | Worker-Claim erfolgreich, Session darf Kandidaten erzeugen                                      |
| `VALIDATING`               | `INVALID`             | Strategie-/Inputvalidierung scheitert; `invalidReasonCode` Pflicht                              |
| `VALIDATING`               | `READY_FOR_RISK`      | vollständiger Snapshot, Hash, Entry/Stop/TP/RR formal valide                                    |
| `READY_FOR_RISK`           | `APPROVED_FOR_SHADOW` | RiskAssessment PASS, Decision und reservierte Order in gleicher Transaktion                     |
| `READY_FOR_RISK`           | `RISK_REJECTED`       | mindestens ein BLOCKER/CRITICAL oder Engine-ERROR; Decision Pflicht                             |
| nichtterminal vor Approval | `EXPIRED`             | `now >= expiresAt`, keine Entry-Order                                                           |
| nichtterminal vor Approval | `CANCELLED`           | Assignment/Strategie deaktiviert oder Adminaktion; auditierter Grund                            |

Terminal: `INVALID`, `RISK_REJECTED`, `APPROVED_FOR_SHADOW`, `EXPIRED`, `CANCELLED`. `APPROVED_FOR_SHADOW` bedeutet nur Shadow-Order angelegt und Cash reserviert, niemals Fill.

Geblockt: Bei Session `PAUSED/KILLED/ERROR_LOCKED/STOPPED` dürfen vorhandene `CREATED/VALIDATING` nur nach `CANCELLED` oder `EXPIRED`, nicht zu `READY_FOR_RISK`. Ein bereits `READY_FOR_RISK` stehender Kandidat wird abgelehnt oder abgebrochen; er wird nach Reaktivierung nicht nachträglich freigegeben.

## Shadow Order

```text
PROPOSED -> ACCEPTED -> WAITING_FOR_ENTRY -> PARTIALLY_FILLED -> FILLED
              |               |                    |
              +---------------+--------------------+-> CANCELLED | EXPIRED
PROPOSED -> REJECTED
```

| Von                                           | Nach                | Auslöser und Guard                                                                |
| --------------------------------------------- | ------------------- | --------------------------------------------------------------------------------- |
| –                                             | `PROPOSED`          | positive Risk Decision; noch keine Portfolioänderung                              |
| `PROPOSED`                                    | `ACCEPTED`          | Reserve atomar erfolgreich, Session aktiv, Profile/Präzision valide               |
| `PROPOSED`                                    | `REJECTED`          | Reservation/Instrumentminimum/Invariante scheitert; keine Reserve bleibt          |
| `ACCEPTED`                                    | `WAITING_FOR_ENTRY` | `earliestFillAt` gesetzt; Entry frühestens nächste 1h-Candle                      |
| `WAITING_FOR_ENTRY`                           | `PARTIALLY_FILLED`  | erster Fill kleiner Restmenge; Position `OPENING`                                 |
| `WAITING_FOR_ENTRY`                           | `FILLED`            | gesamte Menge in einem Fill; Position `OPEN`                                      |
| `PARTIALLY_FILLED`                            | `PARTIALLY_FILLED`  | weiterer, aber nicht finaler Fill; Sequenz steigt                                 |
| `PARTIALLY_FILLED`                            | `FILLED`            | Rest vollständig gefüllt; Position `OPEN`                                         |
| `ACCEPTED/WAITING_FOR_ENTRY/PARTIALLY_FILLED` | `CANCELLED`         | Kill Switch/Admin/Assignment off; ungefüllte Reserve freigeben                    |
| `WAITING_FOR_ENTRY/PARTIALLY_FILLED`          | `EXPIRED`           | Fill-Fenster vorbei; ungefüllte Reserve freigeben, gefüllter Teil bleibt Position |

`REJECTED`, `FILLED`, `CANCELLED`, `EXPIRED` sind terminal. Bei einem teilweise gefüllten Entry dürfen Cancel/Expiry die existierende Position nicht löschen. Für Exit-Orders gilt dieselbe Maschine, aber Kill Switch blockiert sie nicht; ein risikoreduzierender Exit darf aus `PROPOSED` trotz nicht aktiver Session akzeptiert werden, sofern Portfolio konsistent ist.

Für synthetische Shorts wird bei `ACCEPTED` ungehebeltes Quote-Collateral reserviert, mit jedem Entry-Teilfill anteilig an die Position übertragen und erst bei Exit/Cancel/Expiry freigegeben. Keine Zustandsänderung darf Collateral verschwinden lassen oder erhöhen, ohne die korrespondierende Ledgerbuchung atomar zu schreiben.

V1 kennt keine Orderänderung und kein Wiederöffnen terminaler Orders. Eine Änderung erzeugt Cancel + neue Order mit neuer ID/Key und Kausalbezug.

## Shadow Position

```text
OPENING -> OPEN -> PARTIALLY_CLOSED -> CLOSED
   |        |             |
   |        +-------------+-> STOPPED_OUT | INVALIDATED
   +-----------------------------> ERROR
```

| Von                     | Nach               | Auslöser und Guard                                                               |
| ----------------------- | ------------------ | -------------------------------------------------------------------------------- |
| –                       | `OPENING`          | erster positiver Entry-Fill, ExitPlan in derselben Transaktion                   |
| `OPENING`               | `OPEN`             | Entry-Order voll gefüllt oder terminal mit positiver gefüllter Menge             |
| `OPENING`               | `ERROR`            | Position/ExitPlan/Ledger nicht konsistent; Session `ERROR_LOCKED`                |
| `OPEN`                  | `PARTIALLY_CLOSED` | Exit-Fill kleiner offener Menge                                                  |
| `PARTIALLY_CLOSED`      | `PARTIALLY_CLOSED` | weiterer Teilfill, Restmenge positiv                                             |
| `OPEN/PARTIALLY_CLOSED` | `CLOSED`           | Menge null durch Take Profit, Time Exit oder manuellen Risiko-Close              |
| `OPEN/PARTIALLY_CLOSED` | `STOPPED_OUT`      | Menge null, abschließender Trigger `STOP`                                        |
| `OPEN/PARTIALLY_CLOSED` | `INVALIDATED`      | Menge null, abschließender Trigger `DATA_INVALIDATION` oder Regime-Invalidierung |
| jeder nichtterminale    | `ERROR`            | unauflösbare Invariante; keine weitere Entry-/Exposure-Erhöhung                  |

Terminal: `CLOSED`, `STOPPED_OUT`, `INVALIDATED`, `ERROR`. `ERROR` mit positiver Menge bedeutet nicht, dass Exposure verschwunden ist: Monitoring/Reconciliation muss sie weiterhin als offen und maximal riskant zählen; nur risikoreduzierende Schließung/Korrektur ist zulässig.

V1 erlaubt keine Positionsvergrößerung nach Abschluss des Entry-Fensters, kein Averaging Down, Martingale, Pyramiding, Stop-Weiten und keine Wiedereröffnung desselben Aggregats.

Die Preisguards sind gerichtet: Long verlangt `stop < entry < takeProfit`, Short `takeProfit < entry < stop`. Für beide Richtungen gelten identische Zustände und Exitgründe; nur Side, Schwellenlage, adverse Fillrichtung und P&L-Vorzeichen unterscheiden sich.

## ExitPlan

| Von         | Nach        | Regel                                                                 |
| ----------- | ----------- | --------------------------------------------------------------------- |
| –           | `ACTIVE`    | atomar mit erstem Entry-Fill; Stop, TP und Max-Hold valide            |
| `ACTIVE`    | `TRIGGERED` | genau ein konservativ priorisierter Exitgrund und Source-Candle       |
| `TRIGGERED` | `COMPLETED` | Position terminal, sämtliche Exitfills verbucht                       |
| `ACTIVE`    | `CANCELLED` | nur wenn Position ohne Exposure durch Gegenkorrektur aufgehoben wurde |

Ein ausgelöster Plan wird nicht zurück auf aktiv gesetzt. Bei Teil-Exit bleibt er `TRIGGERED`, bis die offene Menge null ist; Stop-Schutz für den Rest wird in der Exit-Order/Planprojektion erhalten.

## Trading Session und Kill Switch

```text
STOPPED -> SHADOW_ACTIVE <-> PAUSED
   |             |           |
   +-------------+-----------+-> KILLED
   +-------------+-----------+-> ERROR_LOCKED
SHADOW_ACTIVE/PAUSED/KILLED/ERROR_LOCKED -> CLOSED (nur ohne Exposure/Orders)
KILLED/ERROR_LOCKED -> STOPPED (nur manuell nach Reconcile und Auflösung)
```

| Zustand         | Neue Kandidaten | Risk Approval/Reserve | Entry-Fills                       | Monitoring/Exit                 | Reconcile/Cancel |
| --------------- | --------------- | --------------------- | --------------------------------- | ------------------------------- | ---------------- |
| `STOPPED`       | blockiert       | blockiert             | blockiert                         | erlaubt für bestehende Exposure | erlaubt          |
| `SHADOW_ACTIVE` | erlaubt         | erlaubt               | erlaubt                           | erlaubt                         | erlaubt          |
| `PAUSED`        | blockiert       | blockiert             | blockiert; offene Entries canceln | erlaubt                         | erlaubt          |
| `KILLED`        | blockiert       | blockiert             | blockiert; offene Entries canceln | erlaubt                         | erlaubt          |
| `ERROR_LOCKED`  | blockiert       | blockiert             | blockiert; offene Entries canceln | nur risikoreduzierend           | zwingend         |
| `CLOSED`        | blockiert       | blockiert             | blockiert                         | keine Exposure zulässig         | read-only        |

### Aktivierungs-Guards

`STOPPED -> SHADOW_ACTIVE` ist nur erlaubt, wenn:

- Build und Konfiguration Shadow-only sind (`ENABLE_LIVE_TRADING != true`, `TRADING_MODE=SHADOW`, Master-/Jobflag aktiv);
- Portfolio `ACTIVE`, Cash/Ledger/Reserven reconciled und `reconciledAt` frisch sind;
- exakt ein aktives `RiskLimitSet` und gültige Execution Profiles vorhanden sind;
- mindestens eine, höchstens die explizit erlaubten BTC-/ETH-Zuweisungen aktiv sind;
- für aktive aktuelle Long-/Short-Assignments die jeweiligen Flags gelten; Short zusätzlich `TRADING_SHADOW_SHORT_ENABLED=true`, immer ohne Live-/Exchange-/Margin-/Futures-Capability;
- je Portfolio/Asset weder gegensätzliche aktive Entry-Orders oder Positionen noch doppelte richtungsfreie Scopes existieren;
- keine unbestätigten Critical Risk Events, keine abgelaufenen Claims und keine unbekannten offenen Aggregate existieren;
- Adminaktion, erwartete Sessionversion und Idempotency-Key vorliegen.

### Kill-Switch-Auslöser

- Admin-Kommando;
- Tagesverlustgrenze erreicht/überschritten;
- drei aufeinanderfolgende Nettoverluste am selben UTC-Handelstag;
- Ledger-/Cash-/Reserve-/Positionswiderspruch;
- unbekannter Modus, Hash-/Idempotenzkonflikt oder Strategy-/Risk-Versionsbruch;
- stale Daten über einem Critical-Grenzwert bei bestehender Exposure;
- wiederholter Worker-/Simulationfehler mit unklarem Zustand.

Risk Engine liefert nur eine deterministische Direktive (`BLOCK_NEW`, `ENGAGE_KILL_SWITCH`, `ERROR_LOCK`). Die Orchestrierung setzt Session/RiskEvent/Audit atomar.

### Verhalten beim Kill

Default `liquidationPolicy=MANAGE_EXISTING`: keine automatische sofortige Liquidation allein wegen des Kill Switch. Alle ungefüllten Entry-Orders werden gecancelt und Reserven freigegeben. Offene Positionen behalten Stop, TP und Max-Hold und werden weiter überwacht. Ein Admin kann separat einen `MANUAL_RISK_CLOSE` anfordern; dieser ist risikoreduzierend und auditpflichtig. Damit kann ein Kill keine neuen Risiken erzeugen, verhindert aber auch nicht die sichere Reduktion bestehender Risiken.

`KILLED/ERROR_LOCKED -> STOPPED` erfordert behobenen Grund, bestätigten Risk Event, erfolgreiches Reconcile und keine unklare Order. Reaktivierung erfolgt anschließend als separater Übergang; ein einzelner Klick darf nicht zugleich entsperren und aktivieren.
