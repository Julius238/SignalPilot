# ADR 0008 – Take-Profit auf 2,5R brutto angehoben

- Status: Accepted
- Datum: 2026-08-02

## Kontext

`CRYPTO_MTF_BREAKOUT_V1` plante ein Bruttoziel von genau 2,0R (`takeProfitRMultiple = "2"`). Die Risk Engine verlangt in `R-008-MIN-RR` (`docs/trading/06-risk-engine-specification.md`) ein **Netto**-CRV von mindestens 2,0 nach Spread, Slippage und Roundtrip-Gebühren. Da Kosten den Bruttogewinn immer verkleinern, ohne das Risiko zu verkleinern, konnte ein exakt 2,0R-Bruttoziel das 2,0-Netto-Minimum bei keinem realistischen Kostenprofil erreichen: `netRewardRisk = (TP - worstEntry) / perUnitRisk` liegt bei Spread/Slippage/Fee > 0 systematisch unter dem Bruttowert. Jeder Kandidat, der die Risk Engine erreichte, war damit rechnerisch nicht genehmigungsfähig, unabhängig von Marktqualität oder Sizing.

## Entscheidung

Das Strategy-v1-Bruttoziel wird von 2,0R auf **2,5R** angehoben (`packages/strategy-engine/src/specification-v1.ts`, `takeProfitRMultiple`). Das Mindest-Netto-CRV der Risk Engine bleibt unverändert bei 2,0 (`R-008-MIN-RR`, `RiskLimitSet.minRewardRisk`); es wird nicht gesenkt oder umdefiniert. Keine Gebühren-, Spread-, Slippage- oder Risikowerte werden reduziert, um die Lücke stattdessen künstlich zu schließen.

2,5R brutto ist eine Kopfraum-Korrektur, keine Freigabegarantie: Bei ungewöhnlich hohem Spread/Slippage (bis zu den Grenzen 20 bp / 15 bp aus `R-018`/`R-019`) kann `netRewardRisk` weiterhin unter 2,0 fallen und `R-008` lehnt den Kandidaten dann weiterhin ab. Das ist beabsichtigt.

Die Änderung ändert `CRYPTO_MTF_BREAKOUT_V1_SPECIFICATION_HASH` und ist damit eine versionierte Spezifikationsänderung (ADR 0003, "Deterministische, versionierte Engines"). Eine bereits angelegte `StrategyVersion`-Zeile mit dem alten Hash darf nicht in-place überschrieben werden; eine neue Version wird angelegt, wenn diese Parameter erstmals oder erneut seedet werden. Zum Zeitpunkt dieser Entscheidung existiert noch keine seedete `StrategyVersion`-Datenbankzeile (Setup ist P5/P9-Scope), daher entsteht kein Migrationskonflikt.

`minimumRewardRisk` (strategy-interner Sanity-Floor auf das geplante *Brutto*-RR, geprüft vor Erzeugung eines Kandidaten) bleibt bei 2,0 und ist von dieser Änderung fachlich unberührt: Ein 2,5R-Bruttoplan erfüllt diesen Floor weiterhin trivial.

## Folgen

- Ein Kandidat mit dem im Bootstrap hinterlegten konservativen Ausführungsprofil (10 bp Fee, 10 bp Spread, 10 bp Slippage) kann `R-008` jetzt tatsächlich erreichen, statt strukturell daran zu scheitern.
- Golden-Fixtures und Tests von `packages/strategy-engine` wurden neu generiert bzw. angepasst (`btc-pass.json`, `crypto-mtf-breakout-v1.test.ts`).
- `packages/risk-engine`-Fixtures sind unverändert: ihre Testkandidaten sind synthetisch und unabhängig von `packages/strategy-engine` konstruiert.
- Dokument 05 (`docs/trading/05-strategy-v1-specification.md`) ist entsprechend aktualisiert.

## Verworfene Alternativen

- Risk-Engine-Mindest-CRV auf < 2,0 senken: widerspricht der expliziten Vorgabe dieses Auftrags und Dokument 06.
- Kosten (Fee/Spread/Slippage) im Execution Profile künstlich senken, um 2,0R brutto passieren zu lassen: verschleiert reale Ausführungskosten und widerspricht ADR 0005 (konservative Simulation).
- Bestehende `StrategyVersion` in-place aktualisieren, statt zu versionieren: widerspricht ADR 0003 und Dokument 03 ("Ab Freigabe sind Parameter/Hashes unveränderlich").
