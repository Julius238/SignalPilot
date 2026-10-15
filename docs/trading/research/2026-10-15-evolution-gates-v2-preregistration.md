# Vorregistrierung Gates v2: Nachfolger-Regel (2026-10-15)

Festgeschrieben **vor** dem ersten Forschungsdurchlauf mit Gates v2. Gates v1
([Vorregistrierung](2026-10-15-evolution-v1-preregistration.md)) bleibt
vollständig unverändert und für Reproduktionen wählbar. Entscheidung:
[ADR 0017](../decisions/0017-evolution-gates-v2-successor-rule.md).

| | Hash (`canonicalHash`) |
|---|---|
| `evolution-gates-v1` (unverändert seit `efe4df8`) | `65da3536653e56c054dd1aea13cba824e30b509085bbe0d367487639d6e82c76` |
| `evolution-gates-v2` | `8341a3c7bcd6a09d852187d5e55ef6190765a7659702d9e620d9817ad8fd5e96` |

Beide Hashes sind in `packages/evolution/test/gates-v2.test.ts` festgenagelt;
jede Änderung eines Werts lässt den Test scheitern und braucht eine neue
Version. Split (`evolution-split-v1`), Kostenmodell und Suchraum bleiben
unverändert. Jeder Durchlauf schreibt `gatesVersion` und `gatesHash` in sein
Manifest, jeder Kandidat seine Gate-Version in die Kennzahlen.

## Was v2 ändert

v1 verwirft jeden Kandidaten, dessen Tagesrenditen mit einer bestehenden
Strategie über 0,90 korrelieren. v2 übernimmt alle v1-Prüfungen mit
identischen Schwellen und ändert genau eines: Ist der Kandidat eine
Fast-Kopie **nur seiner eigenen eingefrorenen Wurzel** (Champion für
`BREAKOUT_LONG`, Challenger für `REGIME_LONG`), wird die
Redundanz-Prüfung durch die Nachfolger-Prüfung ersetzt. Kopiert er zugleich
oder nur eine fremde Strategie, bleibt er redundant und wird verworfen.

## Nachfolger-Kriterien (alle müssen erfüllt sein)

Gemessen auf Entdeckung + Validierung (2018-04 – 2023-12), BTC + ETH
kombiniert (je 10 000 USDT), gegen die eingefrorene Wurzel auf denselben
Daten und Kosten:

| Prüfung | Bestanden, wenn |
|---|---|
| Monatslimit | ≤ 8 Nachfolger-Prüfungen je Wurzel und Kalendermonat (UTC), über alle Durchläufe |
| Deutliche Verbesserung | Referenz-Sharpe ≥ 0,5: ΔSharpe ≥ +0,15 **und** Sharpe ≥ 1,10 × Referenz. Referenz-Sharpe < 0,5 (schwach, null oder negativ): ΔSharpe ≥ +0,15 **und** eigene Sharpe ≥ 0,5 |
| Beide Zeiträume | ΔSharpe > 0 in der Entdeckung **und** in der Validierung |
| Gepaarte Signifikanz | t ≥ max(2,0; √(2·ln N); t₀,₉₇₅ mit n − 1 Freiheitsgraden), mindestens 36 Monate, davon mindestens 24 mit Unterschied |
| Keine Verschlechterung | Ø R Validierung ≥ Referenz − 0,05 R; max. Drawdown ≤ 1,1 × Referenz; Ø R bei doppelten Kosten ≥ Referenz − 0,05 R; Trades ≥ 80 % der Referenz |
| Finale | alle v1-Finalprüfungen (Nachbarn, Walk-Forward, Holdout) **plus** Holdout-Schutz: ΔSharpe im Holdout ≥ −0,10 |

Höchstens **ein** Nachfolger-Finalist je Durchlauf.

## Statistik im Detail

- **Sharpe**: tägliche Renditen der kombinierten Mark-to-Market-Equity,
  annualisiert mit √365 — dieselbe Berechnung wie in v1.
- **Monatsrenditen**: Monatsend-Equity / vorherige Monatsend-Equity − 1; der
  erste Monat startet bei der Equity vor dem Fenster. Differenzen
  dₘ = Rₘ(Kandidat) − Rₘ(Wurzel) für alle gemeinsamen Monate (69 Monate).
- **Autokorrelation**: Standardfehler des Mittelwerts nach Newey–West
  (Bartlett-Kern, Lag ⌊4·(n/100)^(2/9)⌋, bei 69 Monaten Lag 3). Verwendet
  wird **max(Newey–West, iid)**: negative Autokorrelation darf ein Ergebnis
  nie signifikanter machen als eine unabhängige Stichprobe.
- **Kleine Stichproben**: kritischer Wert ist das Student-t-Quantil mit
  n − 1 Freiheitsgraden (Cornish-Fisher-Näherung, Fehler < 0,005 ab 3 FG), nie
  die Normalverteilung. Unter 36 Monaten oder 24 informativen Monaten wird
  nicht getestet, sondern verworfen (`INSUFFICIENT_PAIRED_SAMPLE`).
- **Keine Streuung** (identische Monatsrenditen): t ist undefiniert, der
  Kandidat scheitert (`PAIRED_DIFFERENCE_UNDEFINED`) — nie „unendlich
  signifikant“.
- **Schwache oder negative Referenz-Sharpe**: Eine relative Verbesserung ist
  bei Referenzwerten nahe null oder negativ nicht aussagekräftig (Division
  durch fast null, Vorzeichenwechsel). Unter 0,5 gilt deshalb statt der
  relativen eine absolute Untergrenze von 0,5 für den Kandidaten. Den
  schwachen Champion (Sharpe 0,30) nur knapp zu schlagen genügt nicht.
- **Mehrfachtests**: N ist derselbe Zähler wie beim Evidenzgrad — 30
  Trainingskonfigurationen der Vorforschung plus jede in Entdeckung und
  Validierung geprüfte Konfiguration (Kandidaten und Nachbarn, v1 und v2).
  Er wird nie zurückgesetzt; Stand dieser Vorregistrierung in der lokalen
  Forschungsdatenbank: 37.

## Schutz bekannter Ergebnisse

1. **Keine rückwirkende Neubewertung.** Die sieben unter v1 verworfenen
   Kandidaten behalten ihr Urteil; v2 entscheidet nur Kandidaten neuer
   Durchläufe. Ein Test prüft, dass ein v2-Durchlauf frühere Zeilen
   bytegleich lässt.
2. **Bekannte Genome kommen nicht zurück.** Ein Genom, das schon als
   Kandidat **oder als Nachbarvariante** geprüft wurde, wird als Duplikat
   verworfen; sein bekanntes historisches Ergebnis zählt nie als neuer
   Nachweis.
3. **Holdout nur als Schutz.** Der Holdout 2024–2026 wurde bereits analysiert
   und hat den Challenger mitbegründet. Für Nachfolger darf er nur ein
   Verschlechtern stoppen, nie eine Verbesserung belegen.
4. **Begrenzte Abnutzung der Validierung**: Monatslimit je Wurzel und ein
   Nachfolger-Finalist je Durchlauf verhindern ein schrittweises
   „Hochklettern“ an derselben Wurzel.
5. **Die KI erfährt nur die Regel**, keine Validierungs- oder
   Holdout-Zahlen; die Prompt-Version bleibt, der Kontext nennt die Regel
   nur unter v2.

## Gegenprobe mit den bekannten Kandidaten

Die drei unter v1 verworfenen Challenger-Verfeinerungen würden auch unter v2
scheitern (Test „rejects the three challenger refinements“). Sie werden
dadurch nicht neu bewertet; die Gegenprobe zeigt nur, dass die Schwellen
nicht so gewählt sind, dass ein bekannter Kandidat durchkommt.

| Kandidat | ΔSharpe | Δ Ø R Validierung | Ergebnis |
|---|---:|---:|---|
| EVO-REG-0002 | +0,08 | −0,10 | keine deutliche Verbesserung, nicht in beiden Zeiträumen, Verschlechterung |
| EVO-REG-0003 | +0,03 | −0,03 | keine deutliche Verbesserung |
| EVO-REG-0001 | −0,07 | −0,21 | keine deutliche Verbesserung |

## Was ein Nachfolger-Vorschlag bedeutet

Dasselbe wie jeder Vorschlag: ein bestandener historischer Test, mehr
nicht. Er bekommt erst nach ausdrücklicher Freigabe einen **eigenen**
Shadow-Forward-Test parallel zu seiner Wurzel. Er ersetzt Champion oder
Challenger nie automatisch; ein Wechsel ist eine spätere
Operator-Entscheidung auf Basis von Forward-Evidenz in der Arena.
