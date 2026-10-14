# ADR 0015 – SignalPilot Arena: Überleben mit eigenem Kapital

- Status: Accepted
- Datum: 2026-10-14

## Kontext

SignalPilot soll mehrere Strategien bzw. Trading-Agenten parallel betreiben.
Champion und Challenger laufen seit dem 2026-10-14 als Forward-Tests in
getrennten Portfolios. Es fehlte ein fester Rahmen, der

- sie nach einem einheitlichen Maßstab vergleicht,
- schwache Teilnehmer erkennt,
- dabei nie ein Risiko-Limit aufweicht, Kapital erfindet oder die Historie
  verändert.

## Entscheidung

1. **Ein Teilnehmer ist eine unveränderliche StrategyVersion in einem
   eigenen Portfolio.** Sein Kapital ist allein das Ledger dieses Portfolios.
   Bestehende Portfolios werden ohne Reset registriert.
2. **Der Maßstab ist risikobereinigtes logarithmisches Kapitalwachstum nach
   allen Kosten** (`arena-fitness-v1`).
   - Er ist transparent zerlegt in neun Komponenten mit festen Gewichten.
   - Eine Risiko-Obergrenze bindet die Fitness an den Drawdown.
   - Die Fitness wird mit dem Evidenzfortschritt zur neutralen Mitte
     geschrumpft.
3. **Evidence Gate vor jeder Leistungsentscheidung**: 30 Trades und 30 Tage,
   oder 182 Tage und 10 Trades. Harte technische und Risk-Verstöße wirken
   sofort.
4. **Die Arena-Policy ist Konfiguration der Kohorte**, gehasht und
   versioniert, und nie Teil von Strategieparametern. Hard-Risk-Limits
   bleiben allein Sache der Risk Engine.
5. **Arena V1 empfiehlt nur.** Statuswechsel sind geprüfte
   Operator-Kommandos. Es gibt keine automatische Abschaltung, keine
   Kapitalverschiebung und kein Auffüllen.
6. **Evaluationen sind append-only und je Teilnehmer hash-verkettet.**
   PROBATION und RETIRED frieren ein Post-Mortem-Dossier ein, die Grundlage
   für eine spätere Analyse und eine versionierte Nachfolgestrategie.

## Folgen

- Neue Tabellen in einer rein additiven Migration. Bestehende Tabellen und
  laufende Forward-Tests bleiben unverändert.
- Ein stündlicher, rein lesender Job auf die Handelstabellen; er schreibt
  nur Arena-Tabellen.
- Gebaut ist Folgendes noch nicht:
  - eine automatische Ausführung der Empfehlungen;
  - eine Kapitalallokation (`CapitalAllocationDecision`, siehe 17-arena.md);
  - eine automatisierte Post-Mortem-Analyse.

  Jedes davon braucht eine eigene ADR.
