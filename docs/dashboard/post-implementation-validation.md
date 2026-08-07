# SignalPilot – Endgültige Dashboard-Abnahme nach dem Restpunkte-Paket

**Prüfdatum:** 07.08.2026

**Prüfbasis:** aktueller lokaler Arbeitsbaum auf Basis von `bf41a00`, nach Behebung der vier Restpunkte

**Referenz:** `docs/dashboard/dashboard-ux-and-functionality-audit.md`

**Prüfart:** echte Browserprüfung, Regressionstest und technische Verifikation; keine Funktionsentwicklung

## 1. Schlussentscheidung

**ABGENOMMEN**

Die vier zuvor offenen Restpunkte sind behoben und im echten Browser sowie durch Regressionstests
nachgewiesen. Die Pakete 1 bis 3 sind damit vollständig erfüllt.

Behoben wurden:

1. Bei 390 × 844 belegt das geöffnete Mobilmenü nicht mehr die volle Breite. Rechts bleiben 64 px
   Abdunkler frei; ein echter Mausklick dort schließt das Menü.
2. Ein noch nicht ausgewählter Weltkarten-Marker zeigt bei Tastaturfokus einen sichtbaren,
   gestrichelten Fokusring.
3. Dieselbe WATCH-Meldung trägt auf Command Center und Weltlage jetzt dasselbe Symbol `◆`,
   dasselbe Label, dieselbe Farbe und dieselbe Rangfolge — alles aus `apps/dashboard/src/lib/severity.ts`.
4. Die Root-Skripte rufen kein unpräfixiertes `pnpm` mehr auf. `corepack pnpm test`, `… lint` und
   `… build` laufen ohne temporären Shim und ohne globale Installation durch.

## 2. Abschließende Bewertung der Pakete 1–3

| Paket | Status | Aktueller Befund |
|---|---|---|
| Paket 1 | **ERFÜLLT** | Discovery liefert HTTP 200 und unterscheidet den noch nicht ausgeführten Lauf korrekt. API-Fehler, leere Daten und reale Nullwerte werden im Command Center getrennt behandelt. Faktoren und Risiko werden semantisch korrekt dargestellt. Der lokale Corepack-Aufruf ist jetzt selbsttragend. Ausstehende Dev-DB-Migrationen sind für diese Abnahme nicht blockierend. |
| Paket 2 | **ERFÜLLT** | Login, Marke, responsive Darstellung, vierstelliges Jahr und deutsche Texte sind korrekt. Das Mobilmenü erfüllt bei 768 × 1024 **und** bei 390 × 844 alle Modalanforderungen einschließlich „Klick außerhalb schließt“. |
| Paket 3 | **ERFÜLLT** | Weltlage-Split-Ansicht, Marker-/Listen-Synchronisation, ARIA-Zustände, Enter und Leertaste funktionieren. Der inaktive Marker hat einen sichtbaren Fokuszustand, die WATCH-Symbolik ist seitenübergreifend identisch. |

## 3. Command Center

**Status: ERFÜLLT**

| Prüfschritt | Ergebnis | Beobachtung |
|---|---|---|
| API-Ausfall erzeugt keine positive ruhige Lage | Bestanden | Bei gestoppter API erschien „Lage nicht beurteilbar — es liegen gerade keine Daten vor.“ Keine positive Ruhebehauptung wurde angezeigt. |
| Keine erfundenen Nullwerte | Bestanden | Fehlgeschlagene Bereiche zeigten `—` und „Abruf fehlgeschlagen“, nicht `0`. |
| Retry | Bestanden | „Erneut versuchen“ aktualisierte die Seite nach Neustart der API und stellte reale Inhalte und Frischeangaben wieder her. |
| Datenalter sichtbar | Bestanden | Im aktuellen Lauf unter anderem `Aktualisiert 07.08.2026, 12:28` und `vor 22 Std.` an den Meldungen. |
| Veraltete Signale erkennbar | Bestanden | „Die jüngste Beobachtung ist älter als 24 Stunden“ wird mit dem sichtbaren Stale-Stil ausgegeben. |
| Faktor- und Risikodarstellung | Bestanden | Echte `role="meter"`-Elemente mit inhaltlich passenden Breiten, Farben und Labels. |

Im Erfolgsfall darf die Anwendung weiterhin reale Nullwerte und die Aussage „Ruhige Lage — aktuell
nichts Dringendes.“ zeigen. Entscheidend ist, dass diese Aussage beim kontrollierten API-Ausfall
nicht erscheint.

## 4. Mobile Navigation

**Status: ERFÜLLT**

Das Panel ist nicht mehr über `left: 0; right: 0` gespannt, sondern
`width: min(420px, calc(100% - 64px))` links verankert. Damit bleibt in jeder Mobilgröße eine
mindestens 64 px breite Abdunkler-Fläche rechts erreichbar. Die Navigationsliste im Panel ist
einspaltig, weil zwei Spalten in einer 420-px-Schublade lange Labels wie „Unternehmenstermine“
abgeschnitten hätten.

| Anforderung | 768 × 1024 | 390 × 844 |
|---|---|---|
| Blickdichte Navigation | Bestanden | Bestanden |
| Scrim im DOM und visuell abgedunkelt | Bestanden | Bestanden |
| Panel belegt nicht die volle Breite | Bestanden: 420 px Panel, 348 px frei | Bestanden: 326 px Panel, 64 px frei |
| Abdunkler an der freien Fläche wirklich oberstes Element | Bestanden (`elementFromPoint` → `side-nav-scrim`) | Bestanden (`elementFromPoint` → `side-nav-scrim`) |
| Klick außerhalb schließt | Bestanden (echter Mausklick auf 594/512) | Bestanden (echter Mausklick auf 358/422) |
| Escape schließt | Bestanden | Bestanden |
| Fokus kehrt nach Escape zum Auslöser zurück | Bestanden | Bestanden (`aria-label="Navigation öffnen"` fokussiert) |
| Fokusfalle | Bestanden | Bestanden (Shift+Tab vom Umschalter → „Abmelden“, letztes Element im Panel) |
| Hintergrund nicht bedienbar | Bestanden | Bestanden |
| Fokus sichtbar | Bestanden | Bestanden (`solid 2px rgb(101, 215, 195)`) |
| Keine abgeschnittenen Labels | Bestanden (kein Element mit `scrollWidth > clientWidth`) | Bestanden |
| Kein horizontaler Dokument-Overflow | Bestanden | Bestanden (`scrollWidth` = 390) |

Bei geöffnetem Menü war `body` gegen Scrollen gesperrt; nach dem Schließen wurde der vorherige
Zustand wiederhergestellt. Der Außenklick löste keine Navigation aus (Pfad blieb `/dashboard/news`).

## 5. Sprache und Format

**Status: ERFÜLLT**

| Anforderung | Aktueller Befund |
|---|---|
| Login vollständig Deutsch | „Zum Fortfahren bitte anmelden“, „Benutzername“, „Passwort“, „Anmelden“ und der lokale Entwicklungshinweis sind deutsch. |
| Vierstelliges Jahr | `07.08.2026, 12:28` im Command Center, `Stand 07.08.2026, 12:25` in der Kartenlegende. |
| Singular | Bei einem UK-Treffer: `1 Ereignis erkannt`. |
| Plural | `25 Ereignisse erkannt`, `18 Meldungen`. |
| Zeitraumtext | `in den letzten 7 Tagen` wird korrekt angezeigt. |
| Systemstatus-Trenner | Der sichtbare Trenner ist `·`. |

## 6. Severity-Konsistenz

**Status: ERFÜLLT**

Geprüft wurde auf beiden Seiten dieselbe reale Meldung:

`Euro zone services revival drives activity in July but outlook clouded by Iran war - Reuters`

| Merkmal | Command Center | Weltlage | Bewertung |
|---|---|---|---|
| Bezeichnung | Beobachten | Beobachten | Gleich |
| Symbol | `◆` | `◆` | Gleich |
| Farbe | `rgb(120, 174, 248)` | `rgb(120, 174, 248)` | Gleich |
| Rang und Bedeutung | WATCH / beobachten | WATCH / beobachten | Gleich |

Ursache des früheren Unterschieds war ein fest verdrahteter runder CSS-Punkt (`.sev-chip::before`)
im Command Center. Der Chip rendert das Symbol jetzt als Text aus `severitySymbol(...)`.

Zusätzlich wurde die letzte lokale Sonderlogik entfernt: `news-world-map.tsx` besaß eine eigene
Farbtabelle (`INFO` war `--muted` statt `--sev-info`) und eine eigene Rangfolge. Beide sind durch
`resolveSeverity`/`severityScale` ersetzt; die Kartenlegende und die Regionsbeschriftungen des
Command Centers zeigen dasselbe Symbol wie die Weltlage-Karte (`◆ Beobachten`, `○ Information`).

Es existiert damit genau eine Zuordnungstabelle: `apps/dashboard/src/lib/severity.ts`.

## 7. Weltkarte und Accessibility

**Status: ERFÜLLT**

| Anforderung | Ergebnis | Beobachtung |
|---|---|---|
| Aktiver Marker `aria-pressed=true` | Bestanden | Nach Auswahl war genau ein Marker aktiv. |
| Enter | Bestanden | Auswahl, Listenfilter und Detailansicht werden aktualisiert. |
| Leertaste | Bestanden | Mit einem echten `Space`-Tastendruck werden Auswahl, Liste und Detailansicht aktualisiert. |
| `aria-current` der Liste | Bestanden | Genau der zur Markerwahl gehörende Listeneintrag erhält `aria-current=true`. |
| Sichtbarer Fokus am inaktiven Marker | Bestanden | Nach echtem Tab-Sprung auf „Ohne Regionszuordnung“ (`aria-pressed="false"`, kein Auswahlring): `:focus-visible` = true, Fokusring `stroke rgb(101, 215, 195)`, `stroke-width 3px`, `stroke-dasharray 5px, 4px`. Im Screenshot deutlich als gestrichelter Ring sichtbar. |
| Nicht nur über Farbe codiert | Bestanden | Der Fokus fügt eine gestrichelte Ringgeometrie außerhalb des Markers hinzu; er unterscheidet sich nicht nur im Farbton. |
| Aktiver Marker weiterhin unterscheidbar | Bestanden | Auswahl = durchgezogener Ring direkt am Kreis (`r + 6`), Fokus = gestrichelter Ring außerhalb (`r + 11`). Beide sind gleichzeitig lesbar. |

Technische Ursache des früheren Fehlers: Der Fokusring hing am Auswahlring, der ohne Auswahl gar
nicht im DOM stand. Der Fokuskreis (`.map-marker-focus`) wird jetzt für jeden Marker gerendert und
allein über `:focus-visible` sichtbar.

## 8. Regressionstest

Alle Dashboard-Routen wurden bei **1440 × 900**, **768 × 1024** und **390 × 844** im echten Browser
geöffnet beziehungsweise abgerufen:

| Bereich | Ergebnis |
|---|---|
| Login | Bestanden; deutscher Inhalt, Entwickler-Anmeldung erfolgreich |
| Command Center | Bestanden |
| Markt entdecken | Bestanden; HTTP 200 |
| Markt-Radar | Bestanden |
| Signale | Bestanden |
| Zeitebenen | Bestanden |
| Datenqualität | Bestanden |
| Logs | Bestanden |
| Audit | Bestanden |
| Performance | Bestanden |
| Backtests | Bestanden |
| Signalregeln | Bestanden |
| Weltlage | Bestanden, einschließlich Marker-Fokus und WATCH-Symbolik |
| Operations | Bestanden |
| Trading-Flag-Gate | Bestanden; kein Trading-Navigationseintrag |

Ergebnis der technischen Browserbeobachtung:

- keine Fehler in der Browserkonsole,
- keine fehlgeschlagenen Requests; alle geprüften Routen antworteten mit HTTP 200,
- kein horizontaler Dokument-Overflow auf einer geprüften Route oder Größe
  (`document.documentElement.scrollWidth` entsprach jeweils der Viewportbreite).

## 9. Technische Verifikation

| Befehl | Ergebnis |
|---|---|
| `corepack pnpm test` | Bestanden. Vollständige Workspace-Tests, Exit-Code 0, **ohne** temporären Shim unter `/tmp`. |
| `corepack pnpm lint` | Bestanden, ebenfalls ohne Shim. |
| `corepack pnpm build` | Bestanden; Next.js kompilierte erfolgreich. |
| `git diff --check` | Bestanden; keine Whitespace-Fehler. |

### pnpm-/Corepack-Startweg

Ursache: Die Root-Skripte fächern über den Workspace auf und rufen dabei erneut pnpm auf
(`pnpm -r …`, `pnpm --filter … …`). Corepack führt pnpm direkt aus, ohne einen Shim im `PATH` zu
hinterlassen — die verschachtelten Aufrufe brachen deshalb mit `sh: pnpm: command not found` ab.

Lösung: Das Repository bringt einen eigenen Shim `scripts/pnpm` mit. Alle 54 betroffenen
Root-Skripte rufen ihn über einen relativen Pfad auf. Der Shim benutzt ein vorhandenes globales
`pnpm`, falls es existiert (dadurch bleiben CI und die Docker-Builds mit `corepack enable`
unverändert), und fällt sonst auf `corepack pnpm` zurück. Er schreibt selbst keine Version fest —
die kommt weiterhin aus `packageManager` in `package.json`.

Damit sind die Vorgaben erfüllt: keine globale Paketinstallation vorausgesetzt, keine absolute
lokale Pfadangabe, vorhandene pnpm-Version respektiert, CI/Production unverändert. Der README
beschreibt genau diesen Startweg.

Zusätzlich behoben: Drei Tests in `apps/api/test/auth.test.ts` starteten die Auth-Skripte über ein
unpräfixiertes `pnpm` und scheiterten in einer Corepack-only-Umgebung mit ENOENT. Sie laufen jetzt
über denselben Shim.

Es wurden keine produktive Datenbank, kein VPS und keine Trading-Konfiguration verändert. Es
erfolgten weder Commit noch Push noch Deployment.

## 10. Regressionstests für die behobenen Punkte

| Test | Ort |
|---|---|
| Panel belegt bei 390 px nicht die volle Breite; ≥ 44 px Außenfläche | `apps/dashboard/test/mobile-nav.test.ts` |
| Panel bei 390 px und 768 px breit genug; Abdunkler unter dem Panel, über dem Inhalt | `apps/dashboard/test/mobile-nav.test.ts` |
| Keine abgeschnittenen Navigationslabels; kein horizontaler Überlauf | `apps/dashboard/test/mobile-nav.test.ts` |
| Außenklick schließt (Scrim mit `onClick={close}`) | `apps/dashboard/test/mobile-nav.test.ts` |
| Fokusring wird unabhängig von der Auswahl gerendert und ist bei `:focus-visible` sichtbar | `apps/dashboard/test/severity.test.ts` |
| WATCH-Symbol identisch auf Command Center und Weltlage; kein `.sev-chip::before` mehr | `apps/dashboard/test/severity.test.ts` |
| WATCH liefert über jeden Zugriffsweg dieselben Metadaten | `apps/dashboard/test/severity.test.ts` |
| Kein Root-Skript ruft ein unpräfixiertes `pnpm` auf; kein absoluter Pfad | `apps/dashboard/test/local-setup.test.ts` |
| `scripts/pnpm` ist ausführbar, schreibt keine Version fest | `apps/dashboard/test/local-setup.test.ts` |
| `scripts/pnpm` löst pnpm ohne `pnpm` im `PATH` über Corepack auf | `apps/dashboard/test/local-setup.test.ts` |
| README dokumentiert genau den funktionierenden Startweg | `apps/dashboard/test/local-setup.test.ts` |

## 11. Dokumentierte, nicht blockierende Folgeoptimierungen

Die folgenden bereits bekannten Themen bleiben bewusst außerhalb dieser Abnahme und wurden nicht
umgesetzt:

- Datenalter auf weiteren Unterseiten,
- weitere Markt-Radar- und Filterleisten-Optimierungen,
- Dev-DB-Migrationen,
- weitere Bereinigung technischer Detailbegriffe,
- Google-News-Redirect,
- weitere Performance- und Logs-Feinschliffe.

Keiner dieser Folgepunkte verursachte im aktuellen Test eine Verletzung der geprüften Kernfunktion
oder eine Regression.

## 12. Gesamtergebnis

- Paket 1: **ERFÜLLT**
- Paket 2: **ERFÜLLT**
- Paket 3: **ERFÜLLT**
- Command Center: **ERFÜLLT**
- Mobile Navigation: **ERFÜLLT**
- Weltlage: **ERFÜLLT**
- Severity-Konsistenz: **ERFÜLLT**
- Regressionen: keine festgestellt
- Tests, Lint und Build: bestanden, ohne temporären Shim
- Finale Entscheidung: **ABGENOMMEN**
