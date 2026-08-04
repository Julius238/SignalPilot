# ADR 0012 – Shadow-Shorts sind synthetisch und ungehebelt

- Status: Accepted
- Datum: 2026-08-04

## Kontext

Ein echter Short an einem Kryptomarkt braucht entweder ein Margin-Konto mit geliehener Ware oder einen Futures-Kontrakt. Beides bringt Borrow-Gebühren, Funding-Raten, Margin-Anforderungen und Liquidation mit sich. SignalPilot hat keinen Exchange-Adapter, keine Kontoanbindung und laut ADR 0001 auch keine Capability, eine zu haben: der Build meldet unveränderlich `SHADOW_ONLY`.

## Entscheidung

Der Shadow-Short ist eine **synthetische, ungehebelte Simulation**. Modelliert werden ausschließlich:

- Entry als simuliertes Short-Eröffnen (`SELL` to open), Exit als simuliertes Zurückkaufen (`BUY` to close)
- Stop oberhalb, Take-Profit unterhalb des Entry
- Spread, Slippage, Gebühren und adverse Rundung — spiegelbildlich, aber mit denselben konservativen Regeln wie Long
- reserviertes Collateral im internen Ledger, damit Exposure und Limits überhaupt greifen

**Nicht** modelliert und ausdrücklich nicht erfunden werden: Borrow-Verfügbarkeit, Borrow-Zins, Funding-Raten, Margin-Level, Nachschusspflicht, Liquidation, Hebel. Es gibt im internen Modell keinen Hebel — die Positionsgröße wird wie bei Long aus `availableCash` gedeckt.

## Warum nicht „realistischer"

Eine erfundene Funding- oder Borrow-Rate wäre eine Zahl ohne Beleg. Sie würde in Performance-Kennzahlen einfließen und dort so aussehen wie eine gemessene Größe. Das widerspricht demselben Prinzip, das in P8 dazu geführt hat, nicht berechenbare Kennzahlen als `null` mit Begründung auszuweisen statt als `0`: **lieber eine ehrlich unvollständige Simulation als eine plausibel aussehende falsche.**

Konsequenz, die explizit benannt sein muss: die Shadow-Short-Performance ist gegenüber einem echten Short **systematisch zu optimistisch**, weil Haltekosten fehlen. Sie taugt zur Prüfung der Signalqualität und der Mechanik, **nicht** als Renditeerwartung.

## Kennzeichnung

Jede Oberfläche, die einen Short zeigt, kennzeichnet ihn als synthetische Simulation ohne echte Börsenposition. Es gibt keine Funktion, die einen echten Short aktivieren könnte, und es entsteht keine.

## Folgen

- Eine spätere echte Short-Ausführung ist ein **eigenes** Arbeitspaket mit Futures-/Margin-Capability, eigener Risikoprüfung und eigener ADR. Der Shadow-Short ist kein Vorbote davon und rechtfertigt ihn nicht.
- Die Feature-Flags sind so geschnitten, dass ein Short nur bei `TRADING_MODE=SHADOW`, `TRADING_SHADOW_ENABLED=true`, `TRADING_SHADOW_SHORT_ENABLED=true`, `TRADING_STRATEGY_SHORT_V1_ENABLED=true` und `ENABLE_LIVE_TRADING=false` läuft — alle fünf gleichzeitig, alle fail-closed.

## Verworfene Alternativen

- **Funding/Borrow mit einer angenommenen Rate simulieren:** erfundene Kosten, die als gemessene erscheinen.
- **Short ganz weglassen und nur Long testen:** hätte die Frage, ob die Signalmechanik in fallenden Märkten trägt, unbeantwortet gelassen.
- **Hebel im internen Modell zulassen:** widerspricht `R-005-NO-LEVERAGE` und der gesamten Cash-Deckungslogik des Portfolios.
