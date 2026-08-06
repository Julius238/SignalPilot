# SignalPilot — Dashboard-, UX- und Funktionsaudit

**Datum:** 2026-08-06
**Umgebung:** ausschließlich lokal (macOS, Node 22.22.3, pnpm 9.15.0 via corepack)
**Getestet gegen:** lokaler Dev-Postgres `127.0.0.1:5432/signalpilot` (nativ, verdeckt den Docker-Container), lokales Redis
**Nicht berührt:** VPS, Produktions-Datenbank, `.env.production`, Deployment, Git-Commits
**Trading-Sicherheitslage während des Audits:** `ENABLE_LIVE_TRADING=false`, `PAPER_TRADING_ONLY=true`, `NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED` nicht gesetzt — verifiziert über `GET /config/public` (`liveTradingEnabled:false`, `paperTradingOnly:true`) und über die Seite `/dashboard/trading`, die auf `TradingDisabled` kurzschließt.

---

## A. Executive Summary

### Gesamtzustand

SignalPilot ist technisch deutlich weiter, als das Dashboard sichtbar macht. Die Analyse-Pipeline (Signale, Radar, Marktregime, Events, Impact-Engine), das Shadow-Trading-Fundament (23 Tabellen, Strategy/Risk/Simulation/Worker/API/Dashboard) und die Betriebsschicht (Scheduler, Circuit Breaker, Audit, Retention) sind vorhanden und dokumentiert. Die Navigations-Informationsarchitektur (fünf deutsche Gruppen) und der Verständlichkeits-Layer in `components/dashboard/shared.ts` sind eine gute, tragfähige Grundlage.

Die Schwäche liegt fast vollständig in der **Präsentationsschicht**: Rohe Enums, englische Reste aus den Analyse-Paketen, ASCII-Umlaute, Kennzahlen ohne Skala, ein sachlich falsch gerendertes Faktoren-Panel, eine nicht interaktive Weltkarte und Seiten, die im Leerzustand fast nichts kommunizieren. Dazu kommt ein echter, reproduzierbarer Serverfehler auf `/dashboard/discovery`.

### Größte Stärken

1. **Informationsarchitektur der Navigation** — „Lage / Beobachten / Kontext / Research / System" ist verständlich, deutsch und konsistent; Icons und Zweitzeilen helfen.
2. **Command Center als Fünf-Band-Story** — Statuszeile → Lagebild mit Puls-Satz → „Wichtig jetzt" → Karte + Impact → Radar/Signale kompakt ist eine richtige Erzählreihenfolge.
3. **Konsequente Research-Sprache** — keine Kauf-/Verkaufssprache, Disclaimer auf jeder relevanten Seite, „keine Handlungsempfehlung"-Chip. Das ist ein Alleinstellungsmerkmal und sollte nicht verwässert werden.
4. **Sicherheitsgrenze Trading hält** — Feature-Flag blendet Navigationsgruppe und Routen aus, die Route schließt serverseitig kurz, keine Trading-API-Aufrufe.
5. **Leerzustände sind erklärend formuliert** — sie sagen meist, *warum* nichts da ist und *was* den Bereich füllt.

### Größte Schwächen

1. **`/dashboard/discovery` ist funktional kaputt** (HTTP 500), und der gleiche Fehler wird auf der Startseite als „Asset Discovery ist sicher deaktiviert" **falsch beschriftet**.
2. **Das Panel „Technische Faktoren" auf der Signal-Detailseite ist inhaltlich falsch** — alle Balken sind immer voll und immer grün, unabhängig vom Wert.
3. **Sprach- und Enum-Brüche über das gesamte UI** — englische Sätze aus `scoring-engine`, ASCII-Umlaute aus `multi-timeframe`, rohe `NO_SIGNAL`/`AVOID`-Enums.
4. **Datenalter wird nicht kommuniziert** — 2,5 Monate alte Signale erscheinen unter „Aktuelle Signale" ohne jeden Hinweis.
5. **Die News-Weltkarte ist ein Bild, kein Werkzeug** — kein Klick, keine Detailansicht, keine Verbindung zur Liste, keine eigene Seite.

### Wichtigste nächste Entscheidung

**Zuerst Korrektheit, dann Karte.** Ein Nutzer, der auf der Startseite eine falsche Aussage („sicher deaktiviert") und auf der Detailseite ein falsches Diagramm sieht, verliert Vertrauen in *alle* Zahlen — auch in die, die stimmen. Die Weltkarte ist das richtige strategische Ziel, aber sie wird erst dann als Analysewerkzeug ernst genommen, wenn die Anzeigen daneben verlässlich sind. Empfehlung: **Paket 1 (funktionale Fehler) vor Paket 3 (Weltkarte)**, mit Paket 2 (Navigation/Hierarchie) als schnellem Zwischenschritt.

---

## B. Technischer Ist-Stand

### Relevante Anwendungen und Services

| Komponente | Rolle | Zustand |
|---|---|---|
| `apps/dashboard` | Next.js 15.5 (App Router, RSC), Port 3000 | läuft, 22 Routen |
| `apps/api` | Fastify 5, Port 3100 | läuft, 53 Dashboard-Routen + `/trading/*` + `/auth/*` + `/audit-logs` |
| `apps/worker` | Analyse-Jobs + Scheduler (node-cron) | nicht gestartet (für die Darstellungsprüfung nicht nötig) |
| `apps/trading-worker` | Shadow-Trading-Orchestrierung | nicht gestartet, alle Flags aus |
| PostgreSQL 16 | `signalpilot-postgres` (Docker, healthy, 13 Tage) | läuft — **wird aber vom nativen Postgres auf 127.0.0.1:5432 verdeckt** |
| Redis 7 | `signalpilot-redis` (Docker, healthy, 13 Tage) | läuft |
| Externe Provider | Binance (public), Finnhub (Key vorhanden) | nicht aufgerufen |
| `packages/*` | 23 Pakete | alle mit `dist/` gebaut |

### Lokaler Startzustand

Der in `README.md` dokumentierte Weg (`pnpm dev`) **funktioniert so nicht**. Zwei Hürden:

1. **`pnpm` liegt nicht im PATH** dieser Maschine; nur `corepack pnpm` funktioniert. `.claude/launch.json` referenzierte `pnpm` direkt und konnte den Prozess nicht starten.
2. **Next.js liest die Root-`.env` nicht.** Ohne `SIGNALPILOT_API_INTERNAL_URL` fällt `getApiUrl()` (`src/lib/api-url.ts:16`) serverseitig auf den Browser-Default `/api` zurück. Node-`fetch` kann eine relative URL nicht auflösen. Ergebnis auf `/dashboard`:

   > **Daten konnten nicht geladen werden**
   > Failed to parse URL from /api/health | Failed to parse URL from /api/config/public | Failed to parse URL from /api/scanner

   Zusätzlich meldete die Statuszeile fälschlich „Verbindungsproblem", obwohl die API einwandfrei lief. Der `rewrites()`-Pfad in `next.config.ts` deckt nur den Browser ab, nicht die Server-Komponenten.

Der README-Abschnitt „Dashboard" nennt zwar `NEXT_PUBLIC_SIGNALPILOT_API_URL=…`, aber nicht `SIGNALPILOT_API_INTERNAL_URL` — und `NEXT_PUBLIC_…` allein reicht für RSC-Fetches gerade nicht aus.

### Vorgenommene diagnostische Anpassungen (vollständig reversibel, beide gitignored)

| Datei | Änderung | Rücknahme |
|---|---|---|
| `.claude/launch.json` | `runtimeExecutable` von `pnpm` auf den absoluten `corepack`-Pfad, `runtimeArgs` mit vorangestelltem `pnpm` | Datei löschen oder Originalinhalt wiederherstellen |
| `apps/dashboard/.env.local` | **neu angelegt**: `NEXT_PUBLIC_SIGNALPILOT_API_URL`, `SIGNALPILOT_API_INTERNAL_URL`, `DASHBOARD_AUTH_ENABLED` — je `http://localhost:3100` bzw. `true` | Datei löschen |

`git status --short` ist danach weiterhin leer. Keine Code-, Schema-, Daten- oder Env-Datei des Repos wurde verändert.

### Healthchecks

```
GET /health          → {"status":"ok","service":"signalpilot-api","uptime":…}
GET /config/public   → alertMode ALL_ASSETS, authEnabled true, devLoginEnabled true,
                       liveTradingEnabled false, paperTradingOnly true, environment development
GET /signals         → 401 ohne Session (Auth-Gate greift korrekt)
docker compose ps    → postgres healthy, redis healthy
```

Login über **„Continue in Dev Mode"** (`DEV_LOGIN_ENABLED=true`) funktioniert, setzt die HttpOnly-Session und schreibt einen `dev_login`-AuditLog-Eintrag. Das Auth-Middleware-Redirect `/dashboard → /login?next=…` greift.

### Fehler in Logs und Browser-Konsole

**Serverseitig (API), reproduzierbar, HTTP 500:**

```
TypeError: Cannot read properties of undefined (reading '0')
    at toActiveUniverseAsset (apps/api/src/routes/dashboard.ts:2344:44)
    at Array.map (<anonymous>)
    at Object.<anonymous> (apps/api/src/routes/dashboard.ts:449:40)
```

Ursache: In `apps/api/src/routes/dashboard.ts:388-394` wird die Relation bedingt geladen —

```ts
discoveryCandidates: latest
  ? { where: { discoveryRunId: latest.id }, take: 1, include: { scoreSnapshot: true } }
  : false
```

Existiert **kein** `AssetDiscoveryRun` (lokal: 0 Zeilen, aber 20 aktuelle `AssetUniverseMembership`), liefert Prisma das Feld gar nicht mit. `toActiveUniverseAsset` greift trotzdem mit `[0]` darauf zu. Der Typ `ActiveMembershipForDashboard` (Zeile 2229) deklariert die Relation unbedingt, deshalb kann TypeScript das nicht sehen. **Das trifft jede frische Installation und jede Umgebung ohne Discovery-Lauf**, nicht nur diese Dev-DB.

**Browser-Konsole:** keine JavaScript-Fehler. Nur React-DevTools-Hinweise und Fast-Refresh-Meldungen des Dev-Servers.

**Netzwerk:** keine fehlgeschlagenen Requests außer dem obigen 500er.

### Datenlage lokal (relevant für die Bewertung der Leerzustände)

| Tabelle | Zeilen | Aktualität |
|---|---:|---|
| `Candle` | 9 000 | bis 24.05.2026 |
| `Signal` / `SignalOutput` / `SignalRuleApplication` | je 30 | 24.05.2026 |
| `MarketEvent` | 25 | 06.07.2026 |
| `RadarEvent` | 2 | — |
| `Asset` / `AssetUniverseMembership` | je 20 | — |
| `WatchlistItem` | 2 | — |
| `BotLog` | 180 | davon 25 `ERROR` aus Testläufen |
| `AuditLog` | 322 | überwiegend Testdaten |
| `NewsItem`, `Event`, `PaperSignalEvaluation`, `AssetDiscoveryRun`, `BacktestRun`, `MarketRegimeSnapshot` | **0** | — |

**Konsequenz für dieses Audit:** Die 48-h-/24-h-Fenster des Command Centers und die News-Seite sind zwangsläufig leer. Der Versuch, die 25 `MarketEvent`-Zeitstempel für die visuelle Kartenprüfung temporär in das 48-h-Fenster zu verschieben (mit vorherigem CSV-Backup und exakter Rückrechnung), wurde vom Berechtigungs-Klassifikator blockiert. **Die Weltkarte konnte deshalb nur im Leerzustand visuell geprüft werden**; ihr Verhalten mit Daten ist aus `news-world-map.tsx` und den echten `MarketEvent`-Zeilen abgeleitet und im Bericht als solches gekennzeichnet.

**Migrationen:** 3 der 25 Prisma-Migrationen sind auf der Dev-DB nicht angewendet (`20260803090000_add_shadow_performance_and_alert_outbox`, `20260804090000_add_short_direction`, `20260804100000_add_short_collateral`). Für die geprüften Nicht-Trading-Seiten irrelevant, blockiert aber jeden lokalen Shadow-Trading-Test.

### Tatsächlich funktionierende Bereiche

Login/Logout, Auth-Redirect, Navigation (Desktop und Mobil), Command Center, Markt-Radar (Scanner) inkl. Gruppierung und Filterformular, Signalliste, Signal-Detail (bis auf das Faktoren-Panel), Asset-Liste, Asset-Detail inkl. TradingView-Chart, Watchlist inkl. Bearbeitungsformular, Zeitebenen, Signalregeln, Datenqualität, Ausführungsprotokoll, Audit, Marktlage/Nachrichten/Unternehmenstermine/Backtests/Strategie-Labor/Paper/Performance (jeweils korrekter Leerzustand), Trading-Flag-Gate.

### Deaktivierte oder unvollständige Bereiche

- **Shadow Trading** — vollständig implementiert, per `NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED` deaktiviert. 12 Unterseiten existieren, keine ist erreichbar.
- **Asset Discovery** — im Code vorhanden, ohne Lauf nicht anzeigbar (siehe 500er).
- **Marktregime** — kein Snapshot vorhanden; Lagebild degradiert korrekt.
- **News/Events/Paper Evaluation/Backtests/Strategie-Labor** — Code vorhanden, keine Daten.

---

## C. Seiteninventar

Legende Funktionsstatus: ✅ funktioniert · ⚠️ funktioniert mit Einschränkungen · 🚫 sichtbar fehlerhaft · ⬜ nur vorbereitet · 🔒 durch Feature Flag deaktiviert · ❔ nicht ausreichend testbar

---

### `/login`

**Zweck:** Einziger Zugang; Single-Admin-Session.
**Inhalte:** Username/Passwort, „Sign in", „Continue in Dev Mode".
**Status:** ✅
**UX-Bewertung:** funktional, aber unfertig.
**Probleme:**
- Labels stehen links *neben* den Feldern, sind nicht ausgerichtet, und die beiden Eingabefelder haben **unterschiedliche Breiten**.
- Die Seite ist **englisch** („Sign in to continue"), obwohl `html lang="de"` und das gesamte übrige UI deutsch sind.
- Der Dev-Login-Button ist optisch fast so prominent wie der echte Login.
- Kein Fehlertext-Platzhalter, kein „Passwort vergessen"-Hinweis (bewusst, sollte aber erklärt sein).

**Verbesserung:** Labels über die Felder, gleiche Feldbreite, deutscher Text, Dev-Button visuell klar abwerten (Textlink statt Button) und mit „nur lokale Entwicklung" beschriften.

---

### `/dashboard` — Command Center

**Zweck:** Lagebesprechung in einem Screen: Läuft alles? Wie ist die Lage? Was ist wichtig? Wo passiert es? Was ist betroffen?
**Inhalte:** Statuszeile mit 5 Worker-Chips · Lagebild (Puls-Satz + 4 Kennzahlen) · „Wichtig jetzt" · „Heute neu im Blick" (Discovery) · „Wo gerade etwas passiert" (Weltkarte) · „Was betroffen sein könnte" (Impact Map) · „Relevante Nachrichten" · Radar/Signale kompakt · Research-Fußnote.
**Status:** ⚠️

**Probleme:**
1. **Falsche Aussage bei API-Fehler:** `/discovery/overview` liefert 500. `discoveryData` ist dann `undefined`, `discoveryData?.config.enabled` ebenfalls, und `page.tsx:513-516` rendert den Else-Zweig: *„Asset Discovery ist sicher deaktiviert; Vorschläge entstehen erst nach Aktivierung."* Das ist sachlich falsch — die Abfrage ist fehlgeschlagen. `criticalErrors` (Zeile 422) prüft nur `health`, `config`, `scanner`.
2. **16 API-Aufrufe in einem `Promise.all`** (Zeilen 214-231) ohne Streaming/Suspense pro Sektion: Die gesamte Seite wartet auf den langsamsten Aufruf. `loading.tsx` liefert nur ein Gesamt-Skelett.
3. **Leerzustand dominiert**: Vier Kennzahlen mit „0", fünf Sektionen mit Leerzustands-Karten. Ein neuer Nutzer sieht acht gleich aussehende graue Kästen und lernt nichts über das Produkt.
4. **Datum zweistellig** — „Aktualisiert 06.08.26, 08:39". Für ein Finanzwerkzeug ist ein vierstelliges Jahr angemessen (`format.ts:6-9`, `dateStyle: "short"`).
5. **Statuszeile ohne Zeitbezug**: „Alle Systeme laufen" sagt nicht, *wann* zuletzt geprüft/gelaufen wurde. Die Worker-Chips tragen einen Farbpunkt ohne Legende.
6. **Doppelte Einstiegspunkte für dasselbe Ziel**: „Markt-Radar öffnen" (Kopf), „Gesamten Markt-Radar öffnen" (Radar-Sektion), „Markt-Radar" (Navigation).

**Verbesserung:** Discovery-Fehler in `criticalErrors` aufnehmen und getrennt beschriften („Discovery-Daten derzeit nicht abrufbar") statt „deaktiviert"; jede Sektion in eine eigene `<Suspense>`-Grenze mit Skelett; im Gesamt-Leerzustand *eine* erklärende Onboarding-Karte statt acht Leerkarten; vierstelliges Jahr; „zuletzt aktualisiert vor X Min." an der Statuszeile.

---

### `/dashboard/discovery` — Markt entdecken

**Zweck:** Dynamisches Asset-Universum, Kandidaten, Qualitätsgates.
**Inhalte:** im Fehlerfall nur eine rote Box.
**Status:** 🚫 **P0**

**Sichtbar:**
> **Discovery-Daten nicht verfügbar**
> Unexpected API error

**Probleme:** Serverfehler (siehe Abschnitt B). Zusätzlich: Die Fehlermeldung ist für Nutzer wertlos („Unexpected API error"), es gibt keinen Wiederholen-Knopf und keinen Hinweis, ob das ein Konfigurations- oder ein Datenproblem ist.

**Verbesserung:** Null-Guard in `toActiveUniverseAsset` (`membership.asset.discoveryCandidates?.[0] ?? null`) **und** den Typ `ActiveMembershipForDashboard` so ändern, dass die Relation optional ist, damit der Compiler künftig warnt. Zusätzlich: sinnvoller Leerzustand, wenn es noch keinen Lauf gibt („Noch kein Discovery-Lauf durchgeführt").

---

### `/dashboard/scanner` — Markt-Radar

**Zweck:** Aktuelle Signale nach Bedeutung gruppiert.
**Inhalte:** Marktregime-Leiste · 6 Filter · 4 Kennzahlen · 6 Gruppen (Hohe Relevanz, Beobachten, Ungewöhnliche Aktivität, Kurszonen im Fokus, Hohes Risiko, Geringe Relevanz).
**Status:** ⚠️

**Probleme:**
1. **Widersprüchliche Zahlen im Kopf**: Die vier Kacheln zeigen 0/0/0/0, die Zusammenfassungszeile darunter „0 aufwärts bestätigt · **1 abwärts bestätigt** · 0 ohne klare Relevanz", die Gruppen darunter enthalten 14 + 12 Einträge. Drei Zählweisen ohne erklärten Bezug.
2. **`Datenlauf: noch offen · -`** — ein Bindestrich ohne Inhalt hinter einem Trennpunkt.
3. **Englische Sätze in jeder Karte**: „Nächster Auslöser: *Wait for risk to cool down and trend structure to improve.*" (Quelle: `packages/scoring-engine/src/index.ts:492`).
4. **Rohes Enum `NO_SIGNAL`** als Statuszeile jeder Karte.
5. **Datenalter unsichtbar**: 26 Karten tragen „24.05.26, 17:13" — 2,5 Monate alt — unter der Überschrift „Aktuelle Signale".
6. **26 nahezu identische Karten**: gleicher Text, gleicher Score-Bereich (36–45), gleiche Chips. Ohne visuelle Differenzierung ist die Gruppierung wirkungslos.
7. **Leerzustand grün**: `scanner-groups.tsx:83` nutzt `tone="calm"` (grüner Punkt = „gute Nachricht") für „Keine passenden Signale gefunden". Nach einem Filter ist das aber eine Sackgasse, keine gute Nachricht — und es fehlt ein „Filter zurücksetzen".
8. **Filterleiste inkonsistent**: 3 Selects, 1 freies Textfeld („Min. Qualität"), 2 Checkboxen, 1 Akzent-Button. Das Select-Label wird vom Chevron überlagert.

**Verbesserung:** Kopfzahlen auf **eine** Zählweise vereinheitlichen und beschriften; Karten auf 2–3 Zeilen verdichten (Symbol · Zeitebene · Einstufung · Score · Alter) mit Detail auf Klick; ein Altersband („Daten vom 24.05.2026 — älter als 24 h") oben auf der Seite; `tone="neutral"` plus Zurücksetzen-Link im Filter-Leerzustand.

---

### `/dashboard/signals` — Signale

**Zweck:** Gespeicherte Marktbeobachtungen, filterbar.
**Inhalte:** 6 Filter · „30 Signale geladen" · Karten mit Score-Badge, Chips, Kernaussage, Kontext-Chips.
**Status:** ⚠️

**Probleme:** dieselben Sprach- und Enum-Brüche wie im Scanner. Zusätzlich:
- Kontext-Chips „Nachrichten: —" und „Termine: —" — ein Gedankenstrich ohne erklärte Bedeutung (heißt „keine" oder „nicht abgerufen"?).
- Score-Badge „**40.9** / SIGNALQUALITÄT / geringe Relevanz" **ohne Skalenangabe**.
- Select „Alle Asset-Typen" wird vom Chevron überlagert; „Zeitrahmen" ist ein Freitextfeld zwischen Selects.
- Kein Hinweis auf das Datenalter.

**Verbesserung:** Skala explizit („40,9 von 100"), Chips ausformulieren („Keine Nachrichten im Zeitfenster"), Freitext-Zeitrahmen durch Select ersetzen, englische Sätze übersetzen.

---

### `/dashboard/signals/[id]` — Signal-Detail

**Zweck:** Ein Signal vollständig nachvollziehbar machen.
**Inhalte:** Kopf mit Score · Kernaussage + Gegenargument + nächste Bestätigung · **Technische Faktoren** · Score-Anpassungen · (weiter unten Chart, Kontext).
**Status:** 🚫 **P0 im Faktoren-Panel**

**Problem 1 — das Faktoren-Panel ist sachlich falsch.**
`apps/dashboard/src/app/dashboard/signals/[id]/page.tsx:281`:

```ts
const pct = numVal != null ? Math.min(100, (numVal / 10) * 100) : 0;
```

und Zeile 72-77:

```ts
if (val >= 7) return "var(--good)";
if (val >= 4) return "var(--accent)";
return "var(--bad)";
```

Beide nehmen eine 0–10-Skala an. `packages/scoring-engine/src/index.ts:535` klemmt die Werte aber auf **0–100**. Ergebnis im geprüften Signal (Trend 25 · Momentum 50 · Volumen 32 · Volatilität 68 · RSI 30 · News 50 · Social 50 · Events 50 · Risiko 47): **jeder Balken ist zu 100 % gefüllt und grün.** Trend 25 sieht exakt aus wie Volatilität 68; ein Risiko-Score von 47 wird als „gut" eingefärbt. Das Panel transportiert null Information und suggeriert das Gegenteil der Datenlage.

Zum Vergleich: `components/badges.tsx:183-188` (`ScoreBadge`) rechnet korrekt mit 0–100. Der Fehler ist auf diese eine Datei begrenzt.

**Problem 2 — Breadcrumb „Signal Feed / XRPUSDT / 1d · NO_SIGNAL"**: englisch + rohes Enum.
**Problem 3 — englische Fließtexte**: „Price is not close enough to the period high or low." (`scoring-engine/src/index.ts:214`), „Wait for clearer trend, momentum, or volume confirmation."
**Problem 4 — „Score-Anpassungen · Keine Änderung"** nimmt eine volle Karte ein, um „nichts passiert" zu sagen.

**Verbesserung:** Divisor auf 100 korrigieren und die Farbschwellen auf 70/40 setzen; Risiko-Balken invertiert einfärben (hoher Risiko-Score = warnend); Breadcrumb übersetzen; Enum über eine Label-Funktion in `shared.ts` führen; leere Anpassungskarte einklappen.

---

### `/dashboard/assets` — Märkte & Assets

**Zweck:** Instrumentenübersicht.
**Inhalte:** „20 Instrumente im System · 20 werden aktuell beobachtet", Gruppe „Krypto (10)", danach 20 Karten mit Symbol, Name, Börse, Paar.
**Status:** ✅ (technisch) / ⚠️ (inhaltlich)

**Probleme:** Die informationsärmste Seite der Anwendung. Jede Karte ist ~90 px hoch und trägt drei statische Textzeilen — kein Kurs, keine Veränderung, keine Einstufung, kein Datenalter, kein Watchlist-Status. 20 Karten erzeugen ~1 800 px Scroll für Daten, die in eine Tabelle mit 20 Zeilen passen. Kein Suchfeld, kein Filter, keine Sortierung.

**Verbesserung:** Tabelle oder kompakte Zeilen mit Symbol · Name · Typ · letzte Einstufung · Score · letztes Signal (relativ) · Watchlist-Stern; Suchfeld oben; Sortierung nach Score/Alter.

---

### `/dashboard/assets/[symbol]` — Asset-Detail

**Zweck:** Ein Instrument im Detail.
**Inhalte:** Kopf mit Score/Chips · Aktuelle Beobachtung · Multi-Timeframe · Watchlist-Formular · Kerzen-Abdeckung · Chart · Signal-Historie · Events · News.
**Status:** ⚠️

**Positiv:** Der TradingView-Chart rendert korrekt (900 Kerzen, 1d, Preislinie, Signalmarker). Der Seitenaufbau (Kernaussage oben, Technik unten) ist richtig.

**Probleme:**
1. **Kein Kurs im Kopfbereich.** Eine Asset-Detailseite ohne aktuellen Preis und Tagesveränderung ist unvollständig.
2. **ASCII-Umlaute** im Multi-Timeframe-Text: „1d ist der **fuehrende** Timeframe", „ob die **hoehere** Timeframe-Lage weiter **bestaetigt** wird", „Als **naechstes** 4h beobachten" — Quelle `packages/multi-timeframe/src/index.ts:383, 405, 445-458`.
3. **„AVOID auf 1d, 1h: Risiko hat Vorrang vor Alignment. Gesamt-Risiko: LOW."** — zwei rohe Enums plus englisches Fachwort in einem deutschen Satz.
4. **„Alle Signals"** — Denglisch-Button.
5. **Rohes `NO_SIGNAL`** als Überschrift der Karte „Aktuelle Beobachtung" und als Spaltenwert „SIGNALTYP" in der Historie.
6. **„Keine Events gefunden." / „Keine aktuellen News gefunden."** — englische Begriffe, während die Navigation „Unternehmenstermine" und „Nachrichten" heißt.
7. **Chart-Annotation abgeschnitten**: Das Marker-Label („AVOID · NO…") wird von der Preisachse überlagert.
8. **Watchlist-Bearbeitungsformular immer offen** mitten in der Leseansicht.

**Verbesserung:** Kursblock ergänzen; Umlaute in `multi-timeframe` reparieren (oder — da die Texte in der DB liegen — eine Normalisierungsfunktion im Dashboard); Enum-Labels über `shared.ts`; Formular hinter „Bearbeiten" legen; Chart-Marker innerhalb der Zeichenfläche halten.

---

### `/dashboard/watchlist` — Meine Watchlist

**Zweck:** Persönlicher Fokus.
**Inhalte:** 3 Filter · 3 Kennzahlen · pro Asset eine Karte mit Signal, Zeitebenen und Bearbeitungsformular.
**Status:** ✅

**Probleme:** Das Bearbeitungsformular (Priorität, Notizen, Checkbox, Speichern, Entfernen) nimmt pro Karte mehr Platz ein als die Information selbst. „Entfernen" ist ohne Rückfrage direkt anklickbar. Filter-Select „Alle Benachrichtigungszustände" wird vom Chevron abgeschnitten. Rohes `NO_SIGNAL`. „Bestätigung 45.0" / „Bestätigung 0.0" ohne Skala — und „0.0" ist nicht von „nicht berechnet" unterscheidbar.

**Verbesserung:** Karte auf Information reduzieren, Bearbeiten hinter Aufklappen/Modal; Rückfrage vor „Entfernen"; „0.0" durch „—" ersetzen, wenn nicht berechenbar.

---

### `/dashboard/market-regime` — Marktlage

**Status:** ⚠️ (leer, da kein Snapshot)
**Problem:** Der Leerzustand lautet *„Markt-Regime noch nicht berechnet. **Pipeline ausführen.**"* — eine Entwickleranweisung an einen Nutzer, der keine Pipeline ausführen kann. Danach ~85 % leerer Bildschirm.
**Verbesserung:** Erklären, was das Marktregime ist, wann es berechnet wird und wovon es abhängt; ggf. auf `/dashboard/operations` verlinken.

---

### `/dashboard/news` — Nachrichten

**Zweck:** Meldungen zu beobachteten Assets.
**Status:** ⚠️ (leer, `NewsItem` = 0)

**Probleme:**
1. **Nur zwei Filter** (Symbol, Quelle) als Freitextfelder — obwohl die API (`dashboard.ts:1181-1221`) zusätzlich `from`, `to`, `minRelevance` und `maxAgeHours` unterstützt. Kein Zeitraum-, kein Relevanzfilter im UI.
2. **Der grüne „Filtern"-Button nimmt ein Drittel der Filterleiste ein** — die visuell dominanteste Fläche der Seite ist ein Submit-Knopf.
3. **Keine Paginierung** bei `limit: 200`.
4. **`item.category` wird roh gerendert** (`news/page.tsx:114`) — Finnhub liefert dort englische Kategorien.
5. **Diese Seite enthält keine globalen Ereignisse.** `MarketEvent` (Weltgeschehen) und `NewsItem` (Unternehmensnachrichten) sind zwei getrennte Modelle; die Nachrichtenseite zeigt nur letztere.

---

### `/dashboard/events` — Unternehmenstermine

**Status:** ⚠️ (leer, `Event` = 0)
**Probleme:** Platzhalter „Event-Typ (z.B. EARNINGS" wird abgeschnitten; zwei native Datumsfelder (`--.--.----`) brechen die Formsprache der übrigen Filter; danach 90 % leere Fläche.

---

### `/dashboard/multi-timeframe` — Zeitebenen

**Zweck:** Zeigt, ob kurz- und langfristige Beobachtungen übereinstimmen.
**Inhalte:** 3 Filter · Tabelle mit 10 Assets.
**Status:** 🚫 (Layoutfehler)

**Probleme:**
1. **Die Spalte ZUSAMMENFASSUNG wird bei 1440 px rechts abgeschnitten** — Text bricht mitten im Wort ab („…4h und 1d bestaetigen e"). Reproduzierbar bei 1440 und 1280 px Breite.
2. ASCII-Umlaute wie oben.
3. **Score 0.0** bei 5 von 10 Assets, ohne dass erkennbar ist, ob das „kein Score" oder „Score null" heißt.
4. Fachjargon ohne Erklärung: „HTF-Bestätigung", „Multi-TF: Gemischt", „Nur kurzfristig", „PRIMÄR / BESTÄTIGEND / KONFLIKTE".
5. Kein Zeitstempel — 2,5 Monate alte Daten wirken aktuell.

**Verbesserung:** Zusammenfassung umbrechen lassen oder kürzen mit Detail auf Klick; Fachbegriffe mit Tooltip; „0.0" → „—"; Datenstand-Zeile über der Tabelle.

---

### `/dashboard/paper` — Simulierte Auswertung

**Status:** ⚠️ (leer)
**Probleme:** Neun Kennzahlkacheln mit „0" bzw. „0.00 %". Abkürzungen ohne Auflösung: „Ø 1H KURSÄND.", „TREFFERQUOTE (N=0)", „POSITIV (INKL. ZIEL)", „NEGATIV (INKL. INV.)". Drei Namen für dieselbe Sache: Navigation „Paper-Auswertung", Seitentitel „Simulierte Auswertung", Fließtext „Paper Evaluations".

---

### `/dashboard/performance` — Research-Performance

**Status:** ⚠️ (leer)
**Probleme:** Neun Nullkacheln in zwei Reihen mit überlappender Semantik („Auswertungen gesamt" vs. „Beobachtungen"). „Ø 1D KURSÄND. (SIMULIERT)". Der Warnblock „Datenqualität eingeschränkt" ist gut, wiederholt aber unmittelbar darunter dieselbe Aussage in zwei Aufzählungspunkten.
**Positiv:** Untertitel „Muster aus simulierten Auswertungen · keine echten Trades · kein Indikator für zukünftige Ergebnisse" ist exakt richtig.

---

### `/dashboard/backtests`, `/dashboard/strategy-lab`

**Status:** ⚠️ (leer, korrekter Leerzustand, keine Auffälligkeiten)

---

### `/dashboard/rules` — Signalregeln

**Status:** ✅
**Problem:** 30 Zeilen, in denen Original-Score und angepasster Score identisch sind, Delta überall 0.0, Hauptgrund überall „—". Die Tabelle braucht 30 Zeilen, um „keine Regel hat gegriffen" zu sagen. Kennzahlen oben (Aufwertungen 0 / Abwertungen 0) sagen dasselbe bereits.
**Verbesserung:** Standardmäßig nur Anwendungen mit Delta ≠ 0 zeigen, Rest hinter „auch unveränderte anzeigen".

---

### `/dashboard/data-quality` — Datenqualität

**Status:** ✅ (funktional) / ⚠️ (sprachlich)

**Probleme:**
1. **45 Warnungen vollständig auf Englisch**: „AAPL has insufficient 1h candle coverage.", „ADAUSDT has no crypto signals in the last 24h.", „AMZN has no stored events in the +/- 60 day window." — jeweils mit deutschem Präfix „**Nächster Schritt:**". Der Sprachbruch steht damit *innerhalb* jeder einzelnen Karte.
2. **„Empfehlungen" sind CLI-Anweisungen ohne Aktion**: „Backfill candles for low-coverage assets and timeframes.", „Run the Paper Evaluation backfill worker." — englisch, ohne Knopf, ohne Erklärung wo.
3. **Flache Liste von 45 Karten**, nicht nach Asset oder Warnungstyp gruppiert. Drei Warnungen pro Asset × 15 Assets erzeugen dreimal denselben Text.
4. Leerzustand „Führe zunächst einen Candle-Import oder Gap-Audit aus." — wieder eine Entwickleranweisung.

**Positiv:** Diese Seite ist die **einzige**, die das Datenalter ehrlich sichtbar macht („Signale (24 h): 0" neben „Signale gesamt: 30").

**Verbesserung:** Warnungen übersetzen und nach Asset gruppieren (aufklappbar); Empfehlungen als Nutzeraussage formulieren; die 24-h-Kennzahl auch auf Scanner/Signale spiegeln.

---

### `/dashboard/operations` — Systemstatus

**Status:** ❔ **nicht geprüft** — die Navigation zu dieser URL wurde in dieser Sitzung wiederholt vom Berechtigungs-Klassifikator des Werkzeugs blockiert (kein Anwendungsfehler). Die Seite existiert (`src/app/dashboard/operations/page.tsx`) und ist aus der Statuszeile, der Seitenleiste und `/dashboard/discovery` verlinkt. **Muss in einer Folgesitzung visuell nachgeholt werden.**

---

### `/dashboard/logs` — Ausführungsprotokoll

**Status:** ✅
**Probleme:**
1. **25 ERROR-Einträge stammen aus Testläufen**: `test:job-runner:<uuid>:uncaught-error threw past its own error handling` mit `"error": "simulated database failure"`. Ursache: Integrationstests (z. B. `apps/trading-worker/test/leases.test.ts`) laufen gegen die reguläre `DATABASE_URL` — es gibt keine separate Test-Datenbank. Der Betriebslog ist dadurch dauerhaft verunreinigt.
2. **Keinerlei Filter** über 180 Einträge (kein Level-, kein Service-, kein Zeitfilter), obwohl der Warnbanner „25 ERROR-Einträge gefunden" genau dazu auffordert.
3. Rohe JSON-Blöcke — auf einer explizit technischen Seite akzeptabel.

---

### `/dashboard/audit-logs` — Audit

**Status:** ✅
**Probleme:**
1. **Rohe Aktions-Slugs**: `dev_login`, `login_success`, `login_failed`, `trading_activate_portfolio`, `trading_run_job` — ohne deutsche Labels.
2. **Stiller Deckel bei 200 Einträgen** („Einträge (200)"), obwohl 322 in der DB liegen. Keine Paginierung, kein Hinweis.
3. **Keine Filter**, obwohl die API `?action=` unterstützt.
4. **Untrusted Zielbezeichner werden unverändert gerendert**: Ein Testeintrag zeigt `trading_run_job  ManualJobRun #; rm -rf /`. React escaped das korrekt (kein XSS), aber die Darstellung stellt einen frei wählbaren String ungekennzeichnet neben eine legitime Aktion. Zielbezeichner sollten in Anführungszeichen und gekürzt gerendert werden.

---

### `/dashboard/trading/*` — Shadow Trading

**Status:** 🔒 korrekt deaktiviert
**Verifiziert:** Navigationsgruppe fehlt (`nav-bar.tsx:183-197`), `/dashboard/trading` rendert serverseitig „Shadow Trading ist deaktiviert.", keine Trading-API-Aufrufe im Netzwerkprotokoll. 12 Unterseiten existieren im Code.
**Kleinigkeit:** Die Meldung nennt den Env-Variablennamen `NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED`. Für ein Admin-Werkzeug vertretbar.

---

## D. Visuelle Bewertung

### Informationshierarchie

Auf dem Command Center stimmt sie. Auf den Unterseiten kippt sie regelmäßig: Filterleisten mit einem grünen Vollbreiten-Button sind auf `/news`, `/events`, `/data-quality` und `/paper` das **visuell stärkste Element der Seite** — stärker als die eigentlichen Daten. Kennzahlkacheln mit „0" bekommen dieselbe Größe und dasselbe Gewicht wie Kacheln mit Inhalt, wodurch leere Seiten „voll" aussehen, ohne etwas zu sagen.

### Navigation

Stärkster Teil der Anwendung. Fünf deutsche Gruppen, verständliche Labels mit erklärender Zweitzeile, konsistente Icons, korrekte `aria-current`-Markierung. Drei Einschränkungen:

- Bei **1280 × 800** ist die Seitenleiste zu hoch für den Viewport: Die Gruppen „Research" und „System" sind ohne Scrollen nicht erreichbar, und der Fuß („Systemübersicht", „Abmelden") **überlagert** den letzten sichtbaren Navigationseintrag.
- Bei **768 px** siehe unten (Brand-Layout).
- „Systemübersicht" (Fuß) und „Systemstatus" (Gruppe System) verlinken beide auf `/dashboard/operations` — zwei Namen, ein Ziel.

### Layout

Grid und Kartenraster sind sauber. Zwei konkrete Layoutfehler:

1. **Zeitebenen-Tabelle**: Zusammenfassungsspalte wird bei 1440 px abgeschnitten (Wortmitte).
2. **Chart-Marker** auf der Asset-Detailseite wird von der Preisachse überlagert.

Auf sechs Seiten (Marktlage, Nachrichten, Unternehmenstermine, Backtests, Paper, Performance) bleiben im Leerzustand 60–85 % der Bildschirmhöhe ungenutzt.

### Typografie

Inter über `next/font/google`, `html lang="de"`, gute Zeilenlänge, klare Größenstufen. Zwei Punkte:

- **Versal-Abkürzungen** in Kennzahl-Labels („Ø 1D KURSÄND. (SIMULIERT)", „NEGATIV (INKL. INV.)") sind bei 11 px kaum lesbar und inhaltlich unklar.
- Der Sprachbruch (deutsch/englisch/ASCII-Umlaute) fällt typografisch besonders auf, weil er *innerhalb* einzelner Absätze auftritt.

### Farben

Das Severity-Token-System (`--sev-critical/important/watch/info` + `sev-chip`-Klassen) ist konsistent und gut. Zwei Probleme:

- **Der Faktoren-Balken ist immer grün** (siehe Signal-Detail) — Farbe transportiert dort eine falsche Aussage.
- **Grün als Leerzustandsfarbe** in Filterergebnissen (`tone="calm"` im Scanner) verwechselt „ruhig" mit „nichts gefunden".
- **Wichtigkeit hängt in der Weltkarte ausschließlich an Farbe und Kreisfläche**; für Rot-Grün-Sehschwäche gibt es keine zweite Codierung.

### Diagramme

Nur ein echtes Diagramm existiert: der TradingView-Chart auf der Asset-Detailseite. Er funktioniert. Es gibt **keine Zeitreihen-Visualisierung für Score-Verläufe, Regime-Historie oder Performance** — überall dort stehen Tabellen und Zahlenkacheln.

### Tabellen

Vier Tabellen (Zeitebenen, Signalregeln, Signal-Historie, Ausführungsprotokoll). Ordentlich formatiert, aber ohne Sortierung, ohne Spaltenkonfiguration, ohne Paginierung und ohne Zeilen-Hover-Detail. Die Zeitebenen-Tabelle überläuft.

### Responsives Verhalten

| Breite | Ergebnis |
|---|---|
| 1440 × 900 | ✅ bis auf den Tabellenüberlauf |
| 1280 × 800 | ⚠️ Nav-Beschreibungen entfallen (gut), aber Seitenleiste vertikal beschnitten, Fuß überlagert Nav |
| 768 × 1024 | 🚫 **Brand-Block bricht auf drei Zeilen um**, Logo-Marke rutscht unter den Schriftzug, Kopfbereich ~270 px hoch. Ursache: die Alt-Regel `.brand { line-height: 60px; }` in `globals.css:2770` (aus der früheren Top-Nav-Ära) greift bei ≤900 px weiterhin auf die Seitenleisten-Brand. |
| 390 × 844 | ⚠️ grundsätzlich brauchbar; Brand korrekt einzeilig. Aber: **das geöffnete Hamburger-Menü ist nicht deckend** (`.side-nav-panel { background: rgba(7,16,25,0.985) }`, `globals.css:4262`) — Seiteninhalt schimmert durch und beeinträchtigt die Lesbarkeit. Es gibt außerdem keinen Abdunkler und kein Schließen durch Klick daneben. Die fünf Worker-Chips stapeln sich zu fünf fast leeren Vollbreiten-Zeilen; bis zum ersten Inhalt („Lagebild") sind ~640 px zu scrollen. |

### Konsistenz

Wiederkehrende Brüche:

- **Sprache**: deutsch (UI) / englisch (`scoring-engine`, `data-quality`, Login) / ASCII-Umlaute (`multi-timeframe`).
- **Terminologie**: Paper-Auswertung ↔ Simulierte Auswertung ↔ Paper Evaluations; Signale ↔ „Alle Signals"; Nachrichten ↔ News; Unternehmenstermine ↔ Events; Systemstatus ↔ Systemübersicht.
- **Filterleisten**: mit/ohne Labels, Freitext vs. Select, native Datumsfelder vs. Custom-Controls, Buttonbreite von 90 px bis 380 px.
- **Enums**: teils über `shared.ts` übersetzt (Radar, MarketEvent), teils roh (`NO_SIGNAL`, `AVOID`, Audit-Aktionen, News-Kategorien).

---

## E. News- und Weltkartenanalyse

### Aktuelle technische Implementierung

**Datenquelle.** `MarketEvent` wird ausschließlich von `apps/worker/src/jobs/globalEventMonitor.ts` befüllt: Finnhub *General News* → keyword-basierte Klassifikation in `packages/events-intelligence/src/marketEvents.ts` → optionale Anreicherung durch `packages/impact-engine` (16 deterministische Regeln) → Dedup über `dedupKey`, Cooldown pro `eventType`. Confidence ist bewusst auf max. 0,6 gedeckelt.

**Datenmodell (`MarketEvent`).** `eventType` (13 Werte), `severity` (INFO/WATCH/IMPORTANT/CRITICAL), `confidence` (float), `title`, `summary`, **`region` (freies Textfeld, nullable)**, `source`, `sourceUrl`, `affectedAssetClasses[]`, `affectedSectors[]`, `affectedSymbols[]`, `positiveImpact[]`, `negativeImpact[]`, `reasoning`, `publishedAt`, `detectedAt`, `alertSentAt`.

**API.** `GET /market-events` (`dashboard.ts:1709-1760`) filtert nach `eventType`, `severity`, `region`, `limit` (Default 50, Max 200), sortiert nach `detectedAt desc`. **Kein Zeitfilter** — das 48-h-Fenster wird erst im Dashboard angewandt (`page.tsx:248-250`). **Es gibt keine Detail-Route `/market-events/:id`.** Der Listen-Endpunkt liefert allerdings bereits *alle* Felder, die eine Detailansicht braucht.

**Geografische Zuordnung.** Rein textuell. `news-world-map.tsx:19-27` enthält **sieben hartcodierte Anker**: USA, Europa, UK, China, Japan, Russland/Ukraine, Naher Osten. Alles andere landet in `unlocatedCount`.

**Marker / Cluster.** Pro Region eine Bubble. Radius `min(34, 10 + √count × 6)`. Füllung `severityColors[maxSeverity]` bei 22 % Deckkraft. Beschriftung: Anzahl im Kreis, Regionsname darunter. Ein natives `<title>`-Element liefert einen Browser-Tooltip. **Kein `onClick`, kein Link, kein Client-JavaScript** — die Karte ist ein serverseitig projiziertes, statisches SVG (d3-geo Natural Earth + world-atlas).

**Severity.** Die Bubble übernimmt die *höchste* Severity ihrer Region. Einzelne Ereignisse sind dahinter nicht mehr unterscheidbar.

**Filter / Zeiträume / Kategorien.** Auf der Karte: **keine**. Das Fenster ist fest auf 48 h verdrahtet (`page.tsx:41`). Über der Karte stehen Cluster-Chips („Geopolitik 13", „Energie & Rohstoffe 6" …) — sie sind **reine Anzeige, nicht klickbar**.

**News-Liste.** Es gibt keine Liste neben der Karte. Die Sektion „Relevante Nachrichten" darunter zeigt `NewsItem` (Unternehmensnachrichten), **nicht** `MarketEvent`. Globale Ereignisse erscheinen ausschließlich in „Wichtig jetzt" — und dort nur, wenn `severityRank ≥ 2` (also ab WATCH), maximal 5 Einträge gemischt mit Radar-Ereignissen.

**Zusammenfassungen.** `MarketEvent.summary` ist der auf `maxSummaryLength` gekürzte Finnhub-`summary`-Wert (`marketEvents.ts:361`). In den 25 lokalen Zeilen ist er durchgängig **der Titel in leicht anderer Zeichensetzung**. `usefulSummary()` (`page.tsx:133-137`) erkennt das und unterdrückt ihn korrekt. **Es existiert also faktisch keine Zusammenfassung.**

**Quellenlinks.** `sourceUrl` ist in allen 25 lokalen Zeilen gesetzt und wird in „Wichtig jetzt" als externer Link auf dem Titel verwendet (`target="_blank" rel="noreferrer noopener"`). Auf der Karte selbst gibt es keinen Quellenzugang.

**Aktualisierung.** Server-Render pro Seitenaufruf; kein Polling, kein Auto-Refresh. Der Cron `GLOBAL_EVENT_MONITOR_CRON` läuft alle 30 Minuten.

**Leerer Zustand.** Bei 0 Ereignissen in 48 h wird die Karte **komplett ausgeblendet** (`page.tsx:536-543`) und durch eine Textkarte ersetzt: „Keine globalen Ereignisse in den letzten 48 Stunden." Der Nutzer sieht dann *gar keine Weltkarte*.

### Aktuelles visuelles Verhalten

Im lokal geprüften Zustand (jüngstes `MarketEvent` vom 06.07.2026, also ~31 Tage alt) war das 48-h-Fenster leer, **die Karte wurde daher nicht gerendert**. Der Versuch, die Zeitstempel für die Prüfung temporär zu verschieben, wurde vom Berechtigungs-Klassifikator blockiert (vollständig reversibel geplant, mit CSV-Backup). Die folgenden Aussagen zum befüllten Zustand sind daher aus `news-world-map.tsx` plus den echten Daten abgeleitet und **nicht visuell verifiziert** — sie sind vor der Umsetzung mit echten Daten gegenzuprüfen.

Mit den vorhandenen 25 Zeilen ergäbe sich:

| Region | Ereignisse | höchste Severity | auf der Karte? |
|---|---:|---|---|
| Naher Osten | 13 | WATCH | ✅ Bubble |
| *(kein Wert)* | 8 | WATCH | ❌ „Ohne Regionszuordnung: 8" |
| China | 1 | WATCH | ✅ |
| Russland/Ukraine | 1 | INFO | ✅ |
| UK | 1 | INFO | ✅ |
| USA | 1 | IMPORTANT | ✅ |

**Ein Drittel aller Ereignisse (8/25) erscheint überhaupt nicht auf der Karte** — nur als Fußnotenzahl in der Legende. Und die einzige IMPORTANT-Meldung (USA) bekommt die **kleinste** Bubble (Radius 16), während der WATCH-Cluster „Naher Osten" mit Radius 32 doppelt so groß ist. Größe kodiert Menge, Farbe kodiert Wichtigkeit — und Menge gewinnt visuell.

### Datenqualität

| Aspekt | Befund |
|---|---|
| Region | 32 % `NULL`; sonst nur 5 verschiedene Grobregionen. Kein Land, keine Koordinaten. |
| Zusammenfassung | faktisch nicht vorhanden (= Titel) |
| Quelle / Link | vollständig (100 % `sourceUrl`) |
| Betroffene Assetklassen | nur bei den Regel-getroffenen Ereignissen befüllt (z. B. 4 von 8 in der Stichprobe leer) |
| Confidence | 0,35–0,45 in der Stichprobe — durchweg niedrig, wird im UI **nicht angezeigt** |
| Severity | nur INFO/WATCH, ein IMPORTANT, kein CRITICAL |
| `reasoning` | vorhanden, aber bewusst nicht angezeigt (Klassifikator-Debug) |

### Interaktionsprobleme

1. **Marker sind nicht klickbar.** Es gibt keinen Weg von einer Bubble zu den dahinterliegenden Meldungen.
2. **Keine Detailansicht** für ein einzelnes Ereignis — weder Panel noch Drawer noch Dialog noch Seite.
3. **Keine Verbindung Karte ↔ Liste**, weil es keine zugehörige Liste gibt.
4. **Cluster-Chips sind tot** — sie zeigen Zahlen, filtern aber nichts.
5. **Der Tooltip ist ein natives `<title>`** — auf Touch-Geräten nicht erreichbar, mit ~1 s Verzögerung, nicht stylebar.
6. **Kein Filter** für Zeitraum, Kategorie, Wichtigkeit oder Region.
7. **Karte verschwindet im Leerzustand**, statt leer mit Erklärung zu bleiben — der Nutzer verliert die Orientierung, wo die Funktion überhaupt sitzt.
8. **Karte ist ein Nebenelement**: halbe Breite in einem 2-Spalten-Grid, ungefähr auf halber Seitenhöhe, unterhalb von vier anderen Sektionen.

### Fehlende Detailansicht — Vorschlag für das Klickverhalten

**Empfohlene Form: seitliches Detailpanel (Split View) auf Desktop, Bottom-Sheet-Drawer auf Mobil.**

Begründung gegenüber den Alternativen:

- **Dialog/Modal** würde die Karte verdecken — genau den Kontext, den der Nutzer beim Vergleichen braucht.
- **Eigene Detailseite** kostet einen Navigationswechsel pro Meldung; bei 10–30 Meldungen pro Tag ist das zu teuer.
- **Split View** erhält Karte *und* Liste *und* Detail gleichzeitig sichtbar und passt zum bestehenden `cmd-grid-2`-Raster.

Das Panel ist ein **Client Component** mit lokalem `useState` für die aktive Ereignis-ID; die Daten kommen serverseitig vollständig aus `GET /market-events` mit. **Es wird kein neuer API-Endpunkt und keine Migration benötigt.**

### Vorschlag für Zusammenfassungen

Siehe Abschnitt „News-Zusammenfassungen" unten (eigener Block nach F).

### Vorgeschlagenes Karten-/Listen-Layout

Empfehlung: **eine eigene Bereichsseite `/dashboard/weltlage`** (Arbeitstitel), die Karte, Ereignisliste und Detail zusammenführt, plus eine **verkleinerte, klickbare Vorschau** auf dem Command Center, die dorthin verlinkt.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Weltlage                                        [24h][48h][7 Tage]   │
│ Wo gerade etwas passiert — und was es für Märkte bedeuten könnte     │
├──────────────────────────────────────────────────────────────────────┤
│ Wichtigkeit: [Alle][Sehr wichtig][Wichtig][Im Blick]                 │
│ Kategorie:   [Geopolitik 13][Energie 6][Zentralbank 2][Unternehmen 4]│
├───────────────────────────────────┬──────────────────────────────────┤
│                                   │  MELDUNGEN (25)      sortiert ▾  │
│         W E L T K A R T E         │  ┌────────────────────────────┐  │
│         (≈ 60 % Breite,           │  │▌⚠ Wichtig · Geopolitik     │  │
│          dominant, klickbar)      │  │  USA · vor 3 Std.          │  │
│                                   │  │  Titel der Meldung …       │  │
│    ● USA (1)   ● Naher Osten (13) │  │  Reuters ↗                 │  │
│                                   │  └────────────────────────────┘  │
│    ○ ohne Region (8) ← eigene     │  ┌────────────────────────────┐  │
│      Sammelmarke unten links      │  │  Im Blick · Energie …      │  │
│                                   │  └────────────────────────────┘  │
├───────────────────────────────────┴──────────────────────────────────┤
│  ▸ DETAIL (Panel schiebt sich von rechts ein, sobald etwas aktiv ist)│
└──────────────────────────────────────────────────────────────────────┘
```

**Bindung Karte ↔ Liste:**

- Klick auf eine Bubble → Liste filtert auf diese Region, Bubble bekommt einen Aktivring, erster Eintrag wird fokussiert.
- Klick auf einen Listeneintrag → zugehörige Bubble pulsiert kurz und bekommt den Aktivring; Detailpanel öffnet.
- Aktiver Zustand ist **doppelt codiert**: Ring *und* linke Akzentkante am Listeneintrag (nicht nur Farbe).
- Filter (Zeitraum, Wichtigkeit, Kategorie, Region) gelten **gemeinsam** für Karte und Liste; sie leben im URL-Query, damit die Ansicht teil- und aktualisierbar bleibt.
- Cluster mit > 1 Ereignis lösen sich beim Klick in der Liste auf; kein Zoom nötig, da die Regionen ohnehin grob sind.

**Inhalt der Detailansicht** (alle Felder existieren bereits):

| Element | Quelle | Anmerkung |
|---|---|---|
| Überschrift | `title` | |
| Kurz-Zusammenfassung (2–4 Sätze) | siehe unten | wenn nicht verfügbar: Feld weglassen, nicht erfinden |
| Zeitpunkt | `detectedAt` (+ `publishedAt` falls abweichend) | relativ + absolut im Tooltip |
| Land/Region | `region` | bei `NULL`: „Region nicht zuverlässig zuordenbar" |
| Kategorie | `eventType` → `marketEventTypeLabels` | |
| Wichtigkeitsstufe | `severity` → `severityLabel` + `sev-chip` | plus Symbol, nicht nur Farbe |
| Quelle + Link | `source`, `sourceUrl` | externer Link mit ↗ |
| Betroffene Märkte | `affectedAssetClasses`, `affectedSectors` | leer ⇒ Abschnitt entfällt |
| Betroffene Assets | `affectedSymbols` | nur wenn befüllt; verlinkt auf `/dashboard/assets/:symbol` |
| Warum relevant | `positiveImpact` / `negativeImpact` als ↗/↘-Chips | Formulierung: „könnte …" |
| **Unsicherheitshinweis** | `confidence` | **Pflicht.** Bei ≤ 0,6 (heute immer): „Automatische Einordnung, keine bestätigte Marktwirkung — Confidence: erste, noch unsichere Einschätzung." Text über die vorhandene `confidenceWords()` in `shared.ts`. |

`reasoning` bleibt ausgeblendet (Klassifikator-Debug), wie bisher.

**Priorisierung.** Die vorhandene `MarketEventSeverity` (CRITICAL/IMPORTANT/WATCH/INFO) reicht und ist bereits über `severityLabel()` deutsch belegt („Sofort ansehen / Wichtig / Beobachten / Information"). Kein neues Feld nötig. **Mehrfachcodierung ist Pflicht:**

| Stufe | Farbe | Symbol | Text | Größe | Position |
|---|---|---|---|---|---|
| Sofort ansehen | `--sev-critical` | ⛔ | „Sofort ansehen" | größter Ring | immer oben, Liste angepinnt |
| Wichtig | `--sev-important` | ⚠ | „Wichtig" | mittlerer Ring | oben |
| Beobachten | `--sev-watch` | ● | „Beobachten" | normal | chronologisch |
| Information | `--muted` | ○ | „Information" | klein | einklappbar |

**Wichtige Korrektur am heutigen Verhalten:** Die Bubble-Größe muss von *Wichtigkeit* dominiert werden, nicht von *Anzahl*. Vorschlag: Grundradius aus der höchsten Severity, Anzahl nur als kleiner Zuschlag und als Zahl im Kreis.

**Empfohlene Filter** (nur solche, die mit den vorhandenen Daten zuverlässig arbeiten):

| Filter | Empfehlung | Begründung |
|---|---|---|
| Zeitraum (24 h / 48 h / 7 Tage) | ✅ | `detectedAt` vorhanden; API-Seite braucht dafür einen `maxAgeHours`-Parameter analog zu `/news` |
| Wichtigkeit | ✅ | `severity` vorhanden, API unterstützt es bereits |
| Kategorie | ✅ | `eventType` vorhanden, API unterstützt es bereits; die Cluster-Chips einfach klickbar machen |
| Region | ✅ mit Vorbehalt | API unterstützt `region`; UI muss „ohne Zuordnung" als eigene, wählbare Option führen |
| Assetklasse | ⚠️ **später** | `affectedAssetClasses` ist bei etwa der Hälfte der Zeilen leer — ein Filter würde still Ergebnisse verschlucken |
| bestätigte vs. mögliche Marktwirkung | ❌ **nicht bauen** | Es gibt keine „bestätigte" Wirkung. Alles ist regelbasiert vermutet. Ein solcher Filter würde eine Genauigkeit vortäuschen, die es nicht gibt. |
| nur ungelesene | ❌ **nicht bauen** | Kein Lesestatus im Datenmodell; erfordert neue Tabelle + Nutzerkontext |

### Risiken und technische Abhängigkeiten

| Risiko | Bewertung |
|---|---|
| **Regionsabdeckung** | Sieben Anker sind zu wenig; 32 % der Ereignisse fallen heraus. Mittelfristig ein größeres Land→Koordinate-Mapping in `events-intelligence`, damit die Klassifikation feiner zuordnet. Kurzfristig: „Ohne Zuordnung" als sichtbare Sammelmarke auf der Karte, nicht als Fußnote. |
| **Client-JavaScript** | Die Karte ist heute bewusst 0-JS-server-gerendert. Interaktivität erfordert eine Client-Komponente. Das SVG selbst kann serverseitig gerendert und als Kind an die Client-Hülle gereicht werden — die teure d3-geo-Projektion bleibt damit auf dem Server. |
| **RSC-Grenze** | Bekannte Falle im Repo (siehe Deployment-Blocker): Keine **Funktionen** über die Server→Client-Grenze reichen. Handler müssen innerhalb der Client-Komponente entstehen. |
| **Kein Zeitfilter in der API** | `GET /market-events` braucht `maxAgeHours` bzw. `from`/`to` (Muster existiert bereits in `/news`). Kleine, additive Änderung. |
| **Keine Detail-Route** | Nicht nötig — der Listen-Endpunkt liefert alle Felder. |
| **Datenmenge** | 25–50 Ereignisse pro Fenster; Client-seitiges Filtern ist unkritisch. |
| **Bestehende `react-simple-maps`-Sperre** | Weiterhin gültig (React-19-Peer-Deps). d3-geo + world-atlas beibehalten. |
| **Barrierefreiheit** | Klickbare SVG-Marker brauchen `role="button"`, `tabIndex`, Tastaturbedienung und einen sichtbaren Fokusring. Ein reines `<title>` reicht nicht. |

---

## F. Priorisierte Verbesserungen

### P0 — funktionaler Fehler oder Sicherheitsproblem

---

**P0-1 · Discovery-Endpunkt wirft 500 ohne Discovery-Lauf**

- **Bereich:** `apps/api/src/routes/dashboard.ts:388-394, 2229-2344`; betrifft `/dashboard/discovery` und die Startseite
- **Problem:** Bedingtes Prisma-`include` liefert `discoveryCandidates` als `undefined`; `toActiveUniverseAsset` greift ungeprüft mit `[0]` zu. Der Typ deklariert die Relation unbedingt, deshalb schweigt der Compiler.
- **Änderung:** `membership.asset.discoveryCandidates?.[0] ?? null`; Relation im Typ optional machen; Regressionstest mit `AssetDiscoveryRun = 0` und `AssetUniverseMembership > 0`.
- **Nutzen:** Eine komplett unbenutzbare Seite wird benutzbar; jede frische Installation funktioniert.
- **Aufwand:** sehr klein (< 1 h inkl. Test)
- **Abhängigkeiten:** keine · **Risiko:** minimal · **Reihenfolge:** 1

---

**P0-2 · Startseite behauptet „sicher deaktiviert", wenn der Aufruf fehlgeschlagen ist**

- **Bereich:** `apps/dashboard/src/app/dashboard/page.tsx:422, 509-518`
- **Problem:** Bei API-Fehler ist `discoveryData` `undefined` → `discoveryData?.config.enabled` ist falsy → Else-Zweig meldet „Asset Discovery ist sicher deaktiviert". Eine falsche Tatsachenbehauptung an prominenter Stelle.
- **Änderung:** `discovery.error` explizit prüfen und einen eigenen Fehlerzustand rendern; `discovery` zusätzlich in `criticalErrors` aufnehmen. Als Muster für alle 16 Aufrufe: **Fehler nie in „nichts vorhanden" übersetzen.**
- **Nutzen:** Vertrauen in die Startseite; Fehler werden sichtbar statt kaschiert.
- **Aufwand:** klein · **Abhängigkeiten:** keine (unabhängig von P0-1 sinnvoll) · **Risiko:** minimal · **Reihenfolge:** 2

---

**P0-3 · „Technische Faktoren" rendert jeden Balken voll und grün**

- **Bereich:** `apps/dashboard/src/app/dashboard/signals/[id]/page.tsx:72-77, 281`
- **Problem:** 0–10-Annahme auf 0–100-Daten. Jeder Faktor ≥ 10 → 100 % Balken; jeder Faktor ≥ 7 → grün. Ein Risiko-Score von 47 wird als „gut" eingefärbt.
- **Änderung:** `(numVal / 100) * 100`; Farbschwellen auf ≥ 70 / ≥ 40; für `riskScore` die Skala invertieren (hoch = warnend); Skalenbeschriftung „von 100" ergänzen. Einheitstest mit den echten Werten (25/50/68/47).
- **Nutzen:** Der zentrale Erklärbaustein der Detailseite sagt endlich die Wahrheit.
- **Aufwand:** klein · **Abhängigkeiten:** keine · **Risiko:** minimal · **Reihenfolge:** 3

---

### P1 — hohe Wirkung auf Verständnis und Nutzung

---

**P1-1 · Datenalter sichtbar machen**

- **Bereich:** Scanner, Signale, Zeitebenen, Watchlist, Asset-Detail, Command Center
- **Problem:** 2,5 Monate alte Signale stehen unkommentiert unter „Aktuelle Signale". Nur `/dashboard/data-quality` verrät die Wahrheit („Signale (24 h): 0").
- **Änderung:** Zentrale `dataFreshness`-Komponente (Datenstand + Alterschip). Ab einem Schwellwert (z. B. > 24 h für Signale) ein deutlich sichtbares Warnband: „Diese Daten sind vom 24.05.2026 — die Analyse-Pipeline lief seitdem nicht."
- **Nutzen:** verhindert die schwerwiegendste Fehlinterpretation der gesamten Anwendung.
- **Aufwand:** mittel · **Abhängigkeiten:** keine · **Risiko:** gering · **Reihenfolge:** 4

---

**P1-2 · Sprachbereinigung (Englisch, ASCII-Umlaute, rohe Enums)**

- **Bereich:** `packages/scoring-engine/src/index.ts` (214, 492 ff.), `packages/multi-timeframe/src/index.ts` (383, 405, 445-458), `packages/data-quality`, `components/dashboard/shared.ts`, Login-Seite
- **Problem:** Deutscher Satzanfang mit englischem Ende; „fuehrende/bestaetigt/naechstes"; `NO_SIGNAL`, `AVOID`, Audit-Slugs, News-Kategorien roh.
- **Änderung:** Zwei Ebenen. (a) In den Paketen deutsche Texte mit echten Umlauten erzeugen — gilt für alle künftigen Läufe. (b) **Da die vorhandenen Texte in der DB liegen**, im Dashboard eine Übersetzungs-/Normalisierungsschicht in `shared.ts` ergänzen (Satzmuster-Mapping + Umlaut-Reparatur), damit Altdaten sofort korrekt aussehen. Neue Enum-Labels ausschließlich in `shared.ts` — nie lokal in Komponenten.
- **Nutzen:** größter einzelner Sprung in der wahrgenommenen Produktreife.
- **Aufwand:** mittel-groß · **Abhängigkeiten:** keine · **Risiko:** gering (nur Anzeigetexte) · **Reihenfolge:** 5

---

**P1-3 · Weltkarte als klickbares Analysewerkzeug (siehe Abschnitt E)**

- **Bereich:** neue Seite + `news-world-map.tsx`, `page.tsx`, `GET /market-events`
- **Aufwand:** groß · **Abhängigkeiten:** P1-2 (Labels), additiver API-Zeitfilter · **Risiko:** mittel (erste echte Client-Interaktion im Command-Center-Umfeld) · **Reihenfolge:** 7

---

**P1-4 · Responsive-Fehler beheben**

- **Bereich:** `globals.css:2770` (`.brand { line-height: 60px }`), `globals.css:4262` (`.side-nav-panel`), Seitenleiste bei 800 px Höhe, Zeitebenen-Tabelle
- **Änderung:** Alt-Regel `.brand { line-height }` entfernen oder auf `.top-nav .brand` einschränken; Menü-Hintergrund deckend + Abdunkler + Klick-daneben-schließt; `.nav-groups` eigenen Scrollbereich geben, damit der Fuß nichts überlagert; Zusammenfassungsspalte umbrechen lassen.
- **Nutzen:** Tablet wird benutzbar, Mobilmenü lesbar, Laptop-Navigation vollständig erreichbar.
- **Aufwand:** klein-mittel · **Abhängigkeiten:** keine · **Risiko:** gering, aber `globals.css` ist 4 799 Zeilen — Spezifitätsfallen beachten (Regelreihenfolge im Mobilblock erhalten) · **Reihenfolge:** 6

---

**P1-5 · Lokaler Startweg reparieren und dokumentieren**

- **Bereich:** `README.md`, `apps/dashboard`, `.env.example`
- **Problem:** `pnpm dev` erzeugt „Failed to parse URL from /api/health"; `SIGNALPILOT_API_INTERNAL_URL` ist nirgends als lokale Pflichtvariable dokumentiert.
- **Änderung:** `apps/dashboard/.env.local.example` mit beiden Variablen anlegen; README-Abschnitt „Dashboard" ergänzen; in `getApiUrl()` bei serverseitigem Aufruf mit relativer URL eine sprechende Fehlermeldung werfen statt der `fetch`-Rohmeldung.
- **Nutzen:** neue Sitzungen/Entwickler starten ohne Debugging.
- **Aufwand:** klein · **Abhängigkeiten:** keine · **Risiko:** minimal · **Reihenfolge:** 4b (parallel)

---

### P2 — wichtiger visueller oder funktionaler Feinschliff

| ID | Bereich | Problem | Empfohlene Änderung | Aufwand |
|---|---|---|---|---|
| P2-1 | Performance, Paper, Data-Quality | 9 Kacheln mit „0" statt einer ehrlichen Aussage | Bei `total === 0` alle Kacheln durch **eine** erklärende Karte ersetzen | klein |
| P2-2 | alle Score-Anzeigen | Score ohne Skala | Durchgängig „von 100"; `formatScore` um optionale Skala erweitern | klein |
| P2-3 | Kennzahl-Labels | „Ø 1D KURSÄND. (SIMULIERT)", „TREFFERQUOTE (N=0)", „POSITIV (INKL. ZIEL)" | Ausschreiben; Stichprobengröße als Zweitzeile statt in Klammern | klein |
| P2-4 | Scanner | Kopfzahlen widersprechen den Gruppen; „Datenlauf: noch offen · -" | Auf eine Zählweise vereinheitlichen; leere Segmente weglassen | klein |
| P2-5 | Scanner | `tone="calm"` für Filter-Leerzustand (`scanner-groups.tsx:83`) | `tone="neutral"` + „Filter zurücksetzen" | sehr klein |
| P2-6 | `/dashboard/assets` | 20 informationsarme Karten | Kompakte Tabelle mit Score, letztem Signal, Alter, Suche | mittel |
| P2-7 | Watchlist, Asset-Detail | Bearbeitungsformular immer offen; „Entfernen" ohne Rückfrage | Hinter „Bearbeiten"; Bestätigung vor Entfernen | klein |
| P2-8 | Datenqualität | 45 englische Warnungen, flache Liste, CLI-Empfehlungen | Übersetzen, nach Asset gruppieren, Empfehlungen als Nutzeraussage | mittel |
| P2-9 | Marktlage, Datenqualität | „Pipeline ausführen", „Führe zunächst einen Candle-Import aus" | Nutzergerechte Erklärung + Link auf Systemstatus | klein |
| P2-10 | Logs, Audit | keine Filter, stiller 200er-Deckel (322 vorhanden) | Level-/Aktions-/Zeitfilter, Paginierung oder ehrlicher Hinweis | mittel |
| P2-11 | Audit | Zielbezeichner roh gerendert (`ManualJobRun #; rm -rf /`) | In Anführungszeichen, gekürzt, monospaced als Datenwert kennzeichnen | sehr klein |
| P2-12 | Signalregeln | 30 Zeilen mit Delta 0.0 | Standardmäßig nur Δ ≠ 0; „auch unveränderte anzeigen" | klein |
| P2-13 | alle Filterleisten | vier verschiedene Formsprachen | Ein `FilterBar`-Muster; Submit-Button auf Inhaltsbreite | mittel |
| P2-14 | Terminologie | Paper-Auswertung/Simulierte Auswertung/Paper Evaluations; „Alle Signals"; News/Events | Glossar festlegen und durchziehen | klein |
| P2-15 | `format.ts:6-9` | zweistelliges Jahr | `year: "numeric"` | sehr klein |
| P2-16 | Login | englisch, Labels nicht ausgerichtet, ungleiche Feldbreiten | Deutsch, Labels über Feldern, gleiche Breite, Dev-Login abwerten | klein |
| P2-17 | Command Center | 16 Aufrufe in einem `Promise.all` | Pro Sektion eigene `<Suspense>`-Grenze mit Skelett | mittel |
| P2-18 | Testinfrastruktur | Tests schreiben in die Dev-DB (`leases.test.ts` nutzt `DATABASE_URL`) | Separate Test-DB (`TEST_DATABASE_URL`) oder Wegwerf-Schema pro Lauf | mittel |
| P2-19 | Asset-Detail | kein Kurs im Kopf; Chart-Marker von Preisachse überlagert | Kursblock ergänzen; Marker-Offset | klein |
| P2-20 | Dev-DB | 3 ausstehende Migrationen | `prisma migrate deploy` gegen die lokale DB (blockiert lokale Shadow-Tests) | sehr klein |

### P3 — spätere Optimierung

- Score-Verlauf und Regime-Historie als Zeitreihen-Diagramm (heute nur Tabellen).
- Sortierbare, spaltenkonfigurierbare Tabellen mit Paginierung.
- Glossar-Seite bzw. Tooltip-Register für „HTF-Bestätigung", „Multi-TF", „Konfluenz", „CRV", „Regime".
- Feineres Land→Koordinate-Mapping in `packages/events-intelligence`, damit die Weltkarte mehr als sieben Regionen kennt.
- Auto-Refresh bzw. „Neue Meldungen verfügbar"-Hinweis auf der Weltlage-Seite.
- Vollständige Tastaturbedienung und Fokusringe für Karte, Kartenmarker und Filter-Chips.

---

## News-Zusammenfassungen — Analyse und Empfehlung

### Ist-Zustand

Es wird **keine brauchbare Zusammenfassung gespeichert**. `MarketEvent.summary` ist der gekürzte Finnhub-`summary`-Wert (`packages/events-intelligence/src/marketEvents.ts:361`), der bei General News in aller Regel dem Titel entspricht. Das Dashboard erkennt das bereits (`usefulSummary()` in `page.tsx:133-137`) und blendet das Feld dann aus — korrekt, aber es bleibt eine Lücke.

Ein LLM- oder Agentenpfad existiert im Repo **nicht**. Es gibt keine Anthropic-/OpenAI-Abhängigkeit, keinen Prompt-Baustein, keinen Modellaufruf. Die einzige „Intelligenz" ist deterministisch: Keyword-Klassifikation plus die 16 Regeln der `impact-engine`.

### Empfehlung (ohne neue kostenpflichtige API)

**Stufe 1 — deterministische Einordnung, kein Modell (jetzt bauen).**

Statt eine Zusammenfassung zu *erfinden*, aus den vorhandenen strukturierten Feldern einen **Einordnungssatz** erzeugen. Alles Nötige liegt bereits vor:

> „**Konflikt** im **Nahen Osten**, erkannt vor 3 Stunden über **Reuters**. Regelbasiert betroffen sein könnten: **Rohstoffe**, **Edelmetalle** (Gegenwind), **Aktien** (Rückenwind). *Automatische Einordnung — erste, noch unsichere Einschätzung. Keine bestätigte Marktwirkung.*"

- **Ort:** reine Funktion in `apps/dashboard/src/components/dashboard/shared.ts` (z. B. `eventContextSentence(event)`), analog zum bestehenden `buildPulse()` und `regimeSentence()`.
- **Persistierung:** keine. Rein abgeleitet, immer synchron mit den Daten, keine Migration, kein Caching-Problem, keine Wiederholungsvermeidung nötig.
- **Sprache:** deutsch, über die vorhandenen Label-Maps.
- **Quellentreue:** absolut — es werden ausschließlich gespeicherte Felder umformuliert, nie Inhalte generiert.
- **Fallback:** fehlen Felder, entfallen die entsprechenden Satzteile; bei zu wenig Information wird gar kein Satz gezeigt (nie ein leerer Rahmen).
- **Aufwand:** klein. **Das deckt den größten Teil des Bedarfs ab.**

**Stufe 2 — echter Volltext (später, nur wenn Stufe 1 nicht reicht).**

Wenn eine *inhaltliche* Zusammenfassung des Artikeltexts gewünscht ist, braucht es den Artikeltext — den liefert Finnhub General News nicht. Das hieße neue Datenbeschaffung, und damit fällt es unter „noch keine neue kostenpflichtige API". Reihenfolge, falls es später kommt:

1. Feld `summaryGenerated` + `summarySource` + `summaryModel` additiv auf `MarketEvent`.
2. Erzeugung **serverseitig im `globalEventMonitor`**, nicht im Dashboard-Render — sonst pro Seitenaufruf ein Modellaufruf.
3. Idempotenz über den bestehenden `dedupKey`; einmal erzeugte Zusammenfassungen nie neu berechnen.
4. Fail-closed: Fehler ⇒ `summaryGenerated = null` ⇒ das UI fällt auf Stufe 1 zurück. Ein Ausfall darf den Monitor nie blockieren (dasselbe Muster wie die Alert-Outbox).
5. Harte Prompt-Grenzen: keine Prognosen, keine Zahlen, die nicht im Text stehen, maximal 3 Sätze, Sprache deutsch, Quelle immer mitführen.

---

## G. Umsetzungspakete

Empfehlung zur Werkzeugwahl: **Claude** für alles, was das bestehende UI-System, die Verständlichkeits-Schicht und mehrdateiige Konsistenz betrifft; **Codex** für eng umrissene, gut testbare Einzelkorrekturen mit klarer Akzeptanzbedingung.

---

### Paket 1 — Funktionale Fehler und technische Stabilität

**Scope:** P0-1, P0-2, P0-3, P1-5, P2-20
**Dateien:** `apps/api/src/routes/dashboard.ts` · `apps/dashboard/src/app/dashboard/page.tsx` · `apps/dashboard/src/app/dashboard/signals/[id]/page.tsx` · `apps/dashboard/src/lib/api-url.ts` · `README.md` · neu `apps/dashboard/.env.local.example`
**Akzeptanzkriterien:**
- `GET /discovery/overview` liefert 200 bei `AssetDiscoveryRun = 0` und `AssetUniverseMembership > 0`.
- `/dashboard/discovery` zeigt einen sinnvollen Leerzustand statt eines Fehlers.
- Die Startseite unterscheidet sichtbar „deaktiviert" von „Abruf fehlgeschlagen".
- Auf der Signal-Detailseite entspricht die Balkenbreite dem Wert/100; Risiko 47 ist nicht grün.
- Der dokumentierte lokale Startweg funktioniert auf einer frischen Maschine ohne manuelle Env-Eingriffe.

**Testanforderungen:** API-Test für den Null-Fall; Einheitstest für die Balkenberechnung mit (25, 50, 68, 47, null); Dashboard-Test, dass der Fehlerzweig nicht den Deaktiviert-Text rendert.
**Abhängigkeiten:** keine · **Empfehlung: Codex** (eng umrissen, hart testbar)

---

### Paket 2 — Globale Navigation und visuelle Hierarchie

**Scope:** P1-4, P2-13, P2-15, P2-16, P2-1
**Dateien:** `apps/dashboard/src/app/globals.css` (Zeilen ~2770, ~4234-4275) · `components/nav-bar.tsx` · `components/ui.tsx` · `lib/format.ts` · `app/login/page.tsx`
**Akzeptanzkriterien:** Bei 1440/1280/768/390 px kein Überlauf, kein Textabschnitt, kein Überlagern; Brand einzeilig bei allen Breiten; Mobilmenü deckend, mit Abdunkler, schließt bei Klick daneben; Filterleisten folgen einem Muster; vierstelliges Jahr; Login deutsch und ausgerichtet.
**Testanforderungen:** `apps/dashboard/test/dashboard-design.test.ts` um Regeln für `.brand` und `.side-nav-panel` erweitern; visuelle Prüfung in allen vier Breiten.
**Abhängigkeiten:** keine · **Empfehlung: Claude** (`globals.css` hat 4 799 Zeilen und dokumentierte Spezifitätsfallen)

---

### Paket 3 — News-Weltkarte und klickbare Details

**Scope:** P1-3 vollständig — neue Seite, Split View, Detailpanel, gemeinsame Filter, Severity-Mehrfachcodierung, „ohne Region" als sichtbare Marke, Karte bleibt im Leerzustand sichtbar
**Dateien:** neu `app/dashboard/weltlage/page.tsx` · neu `components/dashboard/world-map-explorer.tsx` (Client) · neu `components/dashboard/event-detail-panel.tsx` · `components/dashboard/news-world-map.tsx` (Marker klickbar, Radius severity-dominiert) · `app/dashboard/page.tsx` (Vorschau + Verlinkung) · `apps/api/src/routes/dashboard.ts` (`maxAgeHours` für `/market-events`) · `globals.css`
**Akzeptanzkriterien:**
- Klick auf Marker markiert Listeneintrag; Klick auf Listeneintrag markiert Marker; aktiver Zustand doppelt codiert.
- Detailpanel enthält alle Felder aus Abschnitt E, **inklusive Unsicherheitshinweis**, und erfindet nichts.
- Filter (Zeitraum, Wichtigkeit, Kategorie, Region) wirken gemeinsam auf Karte und Liste und stehen in der URL.
- Ereignisse ohne Region sind erreichbar, nicht nur als Fußnote gezählt.
- Marker sind mit Tastatur erreichbar und haben einen sichtbaren Fokusring.
- Bei 0 Ereignissen bleibt die Karte sichtbar (leer, mit Erklärung).
- Keine Funktions-Props über die RSC-Grenze.

**Testanforderungen:** Einheitstests für Bucket-Bildung, Severity-Radius und Filterlogik; visuelle Prüfung mit echten Daten in allen vier Breiten; Tastaturdurchlauf.
**Abhängigkeiten:** Paket 1 und 2 abgeschlossen; Labels aus Paket 4 hilfreich, nicht blockierend · **Empfehlung: Claude** (konzeptionell, mehrdateiig, RSC/Client-Grenze)

---

### Paket 4 — Sprache, Enums und News-Zusammenfassungen

**Scope:** P1-2 + Stufe 1 der Zusammenfassungen + P2-14
**Dateien:** `components/dashboard/shared.ts` (zentrale Erweiterung) · `packages/scoring-engine/src/index.ts` · `packages/multi-timeframe/src/index.ts` · `packages/data-quality/src/*` · alle Seiten mit rohen Enums
**Akzeptanzkriterien:** Kein englischer Satz und kein ASCII-Umlaut mehr im deutschen UI — auch nicht bei Altdaten aus der DB; kein rohes Enum sichtbar (`NO_SIGNAL`, `AVOID`, Audit-Slugs, News-Kategorien); `eventContextSentence()` liefert für jedes `MarketEvent` mit ausreichenden Feldern einen quellentreuen Einordnungssatz mit Unsicherheitshinweis, sonst nichts; ein Glossarbegriff pro Konzept.
**Testanforderungen:** Test, der die gerenderten Seiten gegen eine Verbotsliste prüft (englische Standardsätze, `ae|oe|ue`-Muster in deutschen Texten, Enum-Muster `[A-Z_]{4,}`); Einheitstests für `eventContextSentence()` inkl. Leerfeld-Fällen.
**Abhängigkeiten:** keine (kann parallel zu 2/3 laufen) · **Empfehlung: Claude** (Formulierungsarbeit + Konsistenz über viele Dateien)

---

### Paket 5 — Dashboard-Startseite

**Scope:** P2-17, Onboarding-Leerzustand, Statuszeile mit Zeitbezug, Kartenvorschau anbinden, doppelte Einstiegspunkte reduzieren
**Dateien:** `app/dashboard/page.tsx` · `components/dashboard/status-line.tsx` · `hero-band.tsx` · `loading.tsx`
**Akzeptanzkriterien:** Jede Sektion streamt einzeln mit eigenem Skelett; im Gesamt-Leerzustand erscheint eine erklärende Onboarding-Karte statt acht Leerkarten; die Statuszeile nennt den Zeitpunkt der letzten Prüfung; die Weltkarten-Vorschau verlinkt auf `/dashboard/weltlage`.
**Abhängigkeiten:** Pakete 1, 3, 4 · **Empfehlung: Claude**

---

### Paket 6 — Tabellen und Detailansichten

**Scope:** P1-1 (Datenalter), P2-2, P2-3, P2-6, P2-7, P2-10, P2-11, P2-12, P2-19
**Dateien:** `app/dashboard/assets/page.tsx` · `assets/[symbol]/page.tsx` · `watchlist/page.tsx` · `multi-timeframe/page.tsx` · `rules/page.tsx` · `logs/page.tsx` · `audit-logs/page.tsx` · `scanner/page.tsx` · `signals/page.tsx` · neu `components/data-freshness.tsx`
**Akzeptanzkriterien:** Jede datengetriebene Seite zeigt Datenstand und warnt bei Überalterung; kein Score ohne Skala; Asset-Liste als durchsuchbare Tabelle; Bearbeitungsformulare hinter einer Aktion; Logs und Audit filter- und paginierbar; Zeitebenen-Tabelle ohne Textabschnitt.
**Abhängigkeiten:** Paket 2 (Filter-Muster), Paket 4 (Labels) · **Empfehlung: Codex** für die mechanischen Teile (Skalen, Datenstand, Filter), **Claude** für Asset-Liste und Watchlist-Umbau

---

### Paket 7 — Responsive und mobile Optimierung

**Scope:** Was Paket 2 an Fehlern behoben hat, für alle Unterseiten und Tabellen durchziehen
**Dateien:** `globals.css` · alle Tabellen-Seiten · `world-map-explorer.tsx`
**Akzeptanzkriterien:** Keine Seite scrollt horizontal in 1440/1280/768/390 px; Tabellen scrollen in einem eigenen Container; Weltlage-Seite stapelt auf Mobil zu Karte-über-Liste mit Bottom-Sheet-Detail; Touch-Ziele ≥ 44 px.
**Abhängigkeiten:** Pakete 2, 3, 6 · **Empfehlung: Claude**

---

### Paket 8 — Konsistenz- und Accessibility-Prüfung

**Scope:** P2-18 (Test-DB-Isolation), Kontrastprüfung, Tastaturbedienung, Fokusringe, Screenreader-Labels, Glossar, abschließender Terminologie-Durchlauf
**Dateien:** repo-weit; `apps/*/test/support/*`; `globals.css`
**Akzeptanzkriterien:** WCAG 2.1 AA für Text- und UI-Kontraste; jede interaktive Fläche per Tastatur erreichbar mit sichtbarem Fokus; Wichtigkeit nirgends nur über Farbe codiert; Tests laufen gegen eine separate Datenbank und hinterlassen keine Zeilen in der Entwickler-DB; ein Begriff pro Konzept in der gesamten Anwendung.
**Abhängigkeiten:** alle vorherigen · **Empfehlung: Claude** für Accessibility/Konsistenz, **Codex** für die Test-DB-Isolation

---

---

## Nachtrag 2026-08-06 — Paket 3 (Weltlage) umgesetzt

`/dashboard/news` ist zur Bereichsseite **„Weltlage & Nachrichten"** ausgebaut: dominante
Karte + priorisierte Liste als Split View, klickbare Marker, synchronisierte Auswahl,
Detailansicht, gemeinsame Filter (Zeitraum · Wichtigkeit · Kategorie · Region) über die
URL. `GET /market-events` hat additiv `maxAgeHours` bekommen sowie `region=__none__` für
Meldungen ohne Zuordnung — keine Migration.

**Korrektur zum Befund oben:** Die sieben Kartenanker sind **nicht** zu wenig. Die
Klassifikation in `packages/events-intelligence` kann genau diese sieben Regionen
erzeugen (`regionRules`), jede hat einen Anker. Das eigentliche Problem waren allein die
Meldungen mit `region = null`; sie haben jetzt eine eigene, anklickbare Gruppe auf der
Karte statt einer Fußnotenzahl. Ein feineres Land→Koordinate-Mapping bleibt trotzdem
sinnvoll — es müsste aber **in der Klassifikation** beginnen, nicht in der Karte.

### Offenes Folgepaket: echte Zusammenfassungen

Umgesetzt ist Stufe 1 aus dem Abschnitt „News-Zusammenfassungen": eine deterministische
Einordnung aus den gespeicherten Feldern (`lib/market-event-detail.ts`), rein abgeleitet,
ohne Persistenz und ohne Modellaufruf. Sie ist im UI als solche gekennzeichnet.

Gemessen an den Daten (Stand 2026-08-06, 25 Zeilen): **24 von 25 gespeicherten
`summary`-Werten sind wörtlich der Titel**; genau eine enthält echten Fließtext. Eine
inhaltliche Zusammenfassung des Artikeltexts ist mit den vorhandenen Daten deshalb nicht
möglich — Finnhub General News liefert den Volltext nicht mit. Stufe 2 bleibt ein eigenes
Paket und braucht zuerst eine Entscheidung über die Textbeschaffung; die Reihenfolge steht
unverändert im Abschnitt „News-Zusammenfassungen".

---

## H. Empfohlener erster Implementierungsschritt

**Paket 1 — Funktionale Fehler und technische Stabilität.**

Begründung der Reihenfolge:

1. **Es sind echte Defekte, keine Geschmacksfragen.** Eine Seite antwortet mit HTTP 500, eine zweite behauptet etwas Falsches, ein Diagramm zeigt konsequent das Gegenteil der Daten. Diese drei Punkte sind unabhängig von jeder Designentscheidung falsch.
2. **Sie untergraben die Glaubwürdigkeit aller anderen Zahlen.** Ein Nutzer, der einmal bemerkt, dass alle Faktorbalken immer voll sind, traut auch dem Score, dem Regime und der Impact Map nicht mehr. Jede UX-Verbesserung, die auf einem solchen Fundament aufsetzt, verpufft.
3. **Der Aufwand ist minimal, die Wirkung überproportional.** Drei kleine, klar testbare Änderungen mit sehr geringem Regressionsrisiko.
4. **P1-5 im selben Paket macht jede Folgesitzung schneller.** Solange der dokumentierte lokale Startweg nicht funktioniert, verliert jede Weiterarbeit Zeit an derselben Stelle.
5. **Die Weltkarte braucht dieses Fundament.** Paket 3 fügt die erste echte Client-Interaktion im Command-Center-Umfeld hinzu. Das sollte nicht in einer Umgebung passieren, in der bereits ein Endpunkt 500 wirft und ein Fehlerpfad still in eine falsche Erfolgsmeldung übersetzt wird.

Unmittelbar danach: **Paket 2** (schnell, sofort sichtbar, macht Tablet und Mobil benutzbar), anschließend **Paket 4** parallel zur Vorbereitung von **Paket 3**.

---

## Offene Punkte für die nächste Sitzung

1. **`/dashboard/operations` visuell prüfen** — in dieser Sitzung durch einen Werkzeug-Berechtigungsblock nicht erreichbar.
2. **Weltkarte mit echten Daten visuell prüfen** — erfordert entweder frische `MarketEvent`-Zeilen (Lauf von `pnpm worker:global-event-monitor`, benötigt Finnhub-Key) oder die Freigabe, Zeitstempel in der lokalen Dev-DB temporär zu verschieben.
3. **3 ausstehende Migrationen** auf der lokalen Dev-DB anwenden, falls lokal am Shadow-Trading gearbeitet werden soll.
4. **Testdaten aus der Dev-DB entfernen** (25 `ERROR`-BotLogs, Test-AuditLogs) und Test-Isolation herstellen — sonst bleiben Ausführungsprotokoll und Audit dauerhaft unbrauchbar für echte Diagnose.
