# ADR 0011 – Getrennte Long- und Short-Strategien statt einer Richtungs-Flagge

- Status: Accepted
- Datum: 2026-08-04

## Kontext

Das Shadow-System kannte bisher genau eine Strategie, `CRYPTO_MTF_BREAKOUT_V1`, und genau eine Richtung: `TradeDirection` hatte nur das Mitglied `LONG`. Für einen Short-Test gäbe es zwei Wege: die bestehende Strategie um einen Richtungsparameter erweitern, oder eine zweite, eigenständige Strategie danebenstellen.

## Entscheidung

Zwei getrennte Strategien mit eigenem Schlüssel, eigener `parametersJson` und eigenem `specificationHash`:

- `CRYPTO_MTF_BREAKOUT_LONG_V1` — die bestehende Long-Logik, fachlich unverändert
- `CRYPTO_MTF_BREAKDOWN_SHORT_V1` — eine eigene Breakdown-Strategie

Nicht ein gemeinsamer Code mit `if (direction === "SHORT")`.

Begründung:

1. **Die Regeln sind nicht spiegelsymmetrisch.** Long verlangt Regime `RISK_ON`, RSI 50–72, bullishes MTF-Alignment. Short verlangt `RISK_OFF` und einen eigenen bearishen RSI-Bereich. Eine bloße Vorzeichenumkehr wäre fachlich falsch — Aufwärts- und Abwärtsbewegungen an Kryptomärkten haben unterschiedliche Volatilitäts- und Volumencharakteristik. Die Aufgabenstellung verlangt ausdrücklich „keine bloße Vorzeichenumkehr ohne fachliche Prüfung".
2. **Der Spezifikations-Hash ist die Identität.** Ein Richtungsparameter innerhalb einer Strategie würde bedeuten, dass ein Long- und ein Short-Candidate denselben `specificationHash` tragen. Performance-Segmentierung, Audit und Reproduzierbarkeit hängen aber genau daran, dass der Hash eindeutig sagt, welches Regelwerk entschieden hat.
3. **Getrennte Freigabe.** `StrategyAssignment` ist pro Strategie aktivierbar. Zwei Strategien heißen: BTC-Long testen, ohne BTC-Short zu aktivieren — mit einer Flagge innerhalb einer Strategie ginge das nicht ohne einen zusätzlichen, parallelen Aktivierungsbegriff.
4. **Die bestehende Long-Historie bleibt unangetastet.** Bereits entschiedene Candidates verweisen weiter auf ihren Hash.

## Umbenennung und Kompatibilität

`CRYPTO_MTF_BREAKOUT_V1` → `CRYPTO_MTF_BREAKOUT_LONG_V1` ist eine **identitätsrelevante** Änderung: der Schlüssel steht in `parametersJson` und geht damit in den Hash ein. Sie darf deshalb keine bestehende `StrategyVersion` in place ändern (docs/trading/03: „Ab Freigabe sind Parameter/Hashes unveränderlich").

Der Kompatibilitätspfad ist deshalb: der alte Schlüssel bleibt als Registry-Alias auflösbar, damit historische Candidates weiter evaluierbar und reproduzierbar bleiben; neue Assignments verwenden ausschließlich den neuen Schlüssel und eine neue, additive `StrategyVersion`. Kein bestehender Datensatz wird überschrieben.

## Folgen

- Zwei Registry-Einträge, zwei Spezifikationen, zwei Hashes, zwei Feature-Flags.
- `TradeDirection` bekommt `SHORT` (siehe ADR 0012) und wird damit an jeder Stelle, die bisher Long annehmen durfte, zu einer echten Fallunterscheidung.
- Performance wird zusätzlich nach Richtung segmentiert.

## Verworfene Alternativen

- **Ein Richtungsparameter in `CRYPTO_MTF_BREAKOUT_V1`:** hätte die Long-Spezifikation und damit ihren Hash geändert, also die freigegebene Long-Version berührt — genau das, was ADR 0003 verbietet.
- **Short als „Long auf einem invertierten Preis":** erzeugt Preise, die in keiner Kerzenhistorie stehen (verboten laut ADR 0005) und macht jede Kosten- und Rundungsrechnung unnachvollziehbar.
