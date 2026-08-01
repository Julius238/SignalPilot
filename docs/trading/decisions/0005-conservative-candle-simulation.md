# ADR 0005 – Konservative Candle-Simulation

- Status: Accepted
- Datum: 2026-08-01

## Kontext

Vorhandene Daten sind geschlossene OHLCV-Candles ohne Bid/Ask, Orderbuch oder Intrakerzenpfad. Bestehende Paper-/Backtestauswertungen prüfen bei möglichen Target-/Stopkonflikten Target zuerst; das wäre für Trading-Performance optimistisch.

## Entscheidung

Entry frühestens am Open der nächsten 1h-Candle. Spread, Slippage, Fee, Präzision und Liquiditätscap kommen aus einem versionierten Profil. Buy/ Sell werden advers gerundet. Bei Stop und TP in derselben Candle gilt Stop zuerst; Stop-Gap füllt am adversen Open, TP-Gap höchstens am Ziel. Partial Fills sind auf 1 % Candle-Basisvolumen begrenzt; Orderrest läuft nach zwei Candles ab. Alle Annahmen werden im Fill gespeichert.

## Folgen

- Ergebnisse sind reproduzierbar und übertreiben Performance nicht durch unbekannte Pfade.
- Simulation kann schlechter als eine reale Ausführung sein; das ist eine bewusste Sicherheitsmarge.
- Ohne beobachtete Spreads/Orderbuch bleibt das Modell als „modelliert“ gekennzeichnet.
- Limit Orders erfordern eine neue Spezifikation.

## Verworfene Alternativen

- Target-first: positiver Bias.
- zufälliger Intrabarpfad: nicht reproduzierbar und suggeriert unbelegte Genauigkeit.
- sofortiger Fill auf Signal-Close: Look-ahead-/Ausführungsbias.
