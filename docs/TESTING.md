# Tests und CI

Alle Pakete testen mit dem Node-Test-Runner (`tsx --test`). Die Tests laufen ohne Netzwerk,
ohne Secrets und ohne Exchange-Verbindung. Nur 16 Trading-Worker-Tests brauchen eine echte
PostgreSQL-Datenbank.

## Reihenfolge

Die Workspace-Pakete exportieren ihren gebauten Stand (`dist/`). Vor den Tests muss deshalb
gebaut werden — sonst scheitern ganze Testdateien mit `ERR_MODULE_NOT_FOUND` oder
`@prisma/client did not initialize yet`.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate          # Prisma-Client
corepack pnpm db:migrate:deploy    # nur gegen die Testdatenbank, siehe unten
corepack pnpm build                # erst packages/**, dann apps/**
corepack pnpm lint
corepack pnpm ops:test:scripts     # Syntax- und Sicherheitsprüfungen der Ops-Skripte
corepack pnpm test
```

`corepack pnpm build` baut auch die Apps. Das ist nötig, weil die API-Tests den gebauten
Trading-Worker importieren (`@signalpilot/trading-worker/dist/...`).

`corepack pnpm test` bricht beim ersten fehlschlagenden Paket ab. Für einen vollständigen
Überblick über alle Pakete:

```bash
corepack pnpm -r --no-bail --if-present test
```

## Testdatenbank für den Trading-Worker

Diese Tests prüfen, was ein In-Memory-Fake nicht beweisen kann: dass das atomare
`UPDATE` der Job-Leases auch bei echten parallelen Zugriffen nur einem Aufrufer gelingt.

| Datei | Tests mit echter Datenbank |
|---|---|
| `apps/trading-worker/test/leases.test.ts` | 13 (acquire, heartbeat, release, Parallelität, `withJobLease`) |
| `apps/trading-worker/test/jobRunner.test.ts` | 3 (Lease-Integration von `runScheduledJob`) |

Die Tests lesen `DATABASE_URL` aus der Umgebung, sonst aus der Root-`.env`. Jede Zeile trägt
einen pro Lauf eindeutigen `jobKey` und wird im `after`-Hook wieder gelöscht.

**`DATABASE_URL` zeigt beim Testen nie auf die produktive oder eine gemeinsam genutzte
Datenbank.** Für lokale Läufe gibt es eine eigene, flüchtige Instanz:

```bash
docker compose -f docker-compose.test.yml up -d --wait
export DATABASE_URL="postgresql://postgres@127.0.0.1:55432/signalpilot_test?schema=public"
corepack pnpm db:migrate:deploy
corepack pnpm --filter @signalpilot/trading-worker test
docker compose -f docker-compose.test.yml down
```

`docker-compose.test.yml` ist von Entwicklung und Produktion getrennt: eigener Container,
Port `55432` nur auf `127.0.0.1`, Daten nur im RAM (tmpfs), kein Passwort. Jede andere
lokale PostgreSQL-16-Instanz mit einer leeren Datenbank funktioniert genauso.

Ohne erreichbare Datenbank scheitern genau diese 16 Tests — alle anderen laufen weiter.

### Evolution Engine

`apps/evolution-worker` testet Budget-Schutz, Lease, Audit-Kette, Freigaben und
vollständige Forschungszyklen (Mock-KI → Hypothese → Kandidat → Backtest →
Bewertung → Persistenz) unter Gates v1, v2 und v3 gegen echte PostgreSQL,
einschließlich „keine rückwirkende Neubewertung“ und Familien-Monatsbudget. Diese Tests laufen
nur, wenn der Datenbankname auf `_test` endet (`EVOLUTION_TEST_DATABASE_URL`
oder `DATABASE_URL`), weil sie alle `Evolution*`-Zeilen löschen; sonst werden
sie mit Begründung übersprungen. Die Dateien laufen nacheinander
(`--test-concurrency=1`); die End-to-End-Datei dauert rund zwölf Minuten.

## pnpm-Shim-Test ohne Netzwerk

`scripts/pnpm` leitet die Root-Skripte an ein vorhandenes `pnpm` oder an `corepack pnpm`
weiter. `apps/dashboard/test/local-setup.test.ts` prüft das in zwei Stufen:

1. **Stub-Tests:** Mit Stub-Programmen in einem sonst leeren `PATH` werden alle drei Zweige
   geprüft — vorhandenes pnpm, Corepack-Fallback, Abbruch mit Exit 127. Kein Netzwerk,
   kein echtes pnpm, überall gleich.
2. **Echter Corepack-Weg:** Im `PATH` liegen nur `node` und `corepack`, mit
   `COREPACK_ENABLE_NETWORK=0`. pnpm muss also aus dem lokalen Corepack-Cache kommen; die
   Version muss exakt `packageManager` entsprechen. Ein Zeitlimit verhindert jedes Hängen.

Früher stand das Verzeichnis von `node` im `PATH` des Tests. Liegt dort ein global
installiertes pnpm, lädt dieses für `packageManager` selbst pnpm 9.15.0 aus dem Netz nach.
Ohne Proxy-Variablen hing der Test dadurch in der Cloud-Sandbox unbegrenzt.

Fehlt pnpm im Corepack-Cache (etwa wenn nie `corepack pnpm install` lief), wird Stufe 2
lokal mit Begründung übersprungen. In CI (`CI` gesetzt) schlägt sie stattdessen fehl,
damit der echte Weg dort immer geprüft wird.

## CI-Pipeline

`.github/workflows/ci.yml` läuft bei jedem Push auf jeden Branch, bei Pull Requests und
manuell. Ein Job auf `ubuntu-24.04` mit Node 22 und einem PostgreSQL-16-Service-Container
(`signalpilot_test`, ohne Passwort, nur vom Runner erreichbar):

1. Checkout, Node 22, pnpm über Corepack (füllt zugleich den Corepack-Cache)
2. `pnpm install --frozen-lockfile`
3. `pnpm db:generate`
4. `pnpm db:migrate:deploy` gegen die leere Testdatenbank — prüft zugleich, dass alle
   Migrationen auf einer frischen Datenbank durchlaufen
5. `pnpm build` (Pakete, Apps, Next.js mit `NEXT_PUBLIC_TRADING_DASHBOARD_ENABLED=false`)
6. `pnpm lint`
7. `pnpm ops:test:scripts` (auf dem Runner mit shellcheck, Schwelle `warning`)
8. `pnpm -r --no-bail --if-present test`
9. Zusammenfassung pro Paket (`scripts/ci/test-summary.sh`): Tabelle mit Tests, bestanden,
   fehlgeschlagen und übersprungen — im Log und als Job Summary auf der Run-Seite. Der
   Schritt schlägt fehl, wenn ein Test fehlschlug oder keine Ergebnisse gefunden wurden.

Die Pipeline verwendet keine Secrets, hat nur Leserechte am Repository und startet weder
Worker, Scheduler noch Trading-Prozesse.
