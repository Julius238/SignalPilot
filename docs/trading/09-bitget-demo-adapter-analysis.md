# 09 – Bitget-Demo-Adapter-Analyse für eine spätere Phase

## Status und Bewertungsgrenze

Quellen wurden am 2026-08-01 ausschließlich gegen offizielle Anbieter-Dokumentation geprüft. APIs, Produktumfang, Berechtigungen und regionale Verfügbarkeit ändern sich. Dieses Dokument ist deshalb keine Integrationsfreigabe, keine Rechtsberatung und kein Ersatz für eine erneute Prüfung unmittelbar vor Implementierung.

Shadow v1 enthält keinen Adapter, keinen API-Key und keine Verbindung zu einer Demo- oder Live-Börse.

## Ergebnis

**Technisch** ist Bitget ein geeigneter und wegen der Nutzerpräferenz grundsätzlich bevorzugter Demo-Kandidat: separate Demo-Keys, expliziter `paptrading: 1`-Header, eigene Demo-WebSockets, Spot und USDT-Futures in der Unified API, `clientOid`, Orders/Fills/Positionen/Assets sowie nachvollziehbare REST-/WebSocket-Reconciliation sind offiziell dokumentiert.

**Aktuell regulatorisch** besteht jedoch ein zwingendes No-Go für einen in Deutschland ansässigen Nutzer: Bitgets am 16. Juni 2026 aktualisierte Terms of Use führen Deutschland als „Prohibited Country“. Eine separate Januar-2026-Mitteilung stoppte neue deutsche Registrierungen und stellte weitere Änderungen für Bestandsnutzer in Aussicht. Dass ein vorhandenes Konto genutzt wird, beweist weder die regionale Berechtigung noch die API-/Demo-Berechtigung. Ohne positive, aktuelle und dokumentierte Eligibility-Prüfung darf kein Bitget-Adapter begonnen oder aktiviert werden.

Empfehlung: Bitget bleibt **conditional preferred**, Gate derzeit **rot**. Binance Spot Testnet/Demo und Bybit Demo sind technische Alternativen, unterliegen aber ebenfalls regionalen und produktbezogenen Prüfungen.

## Bitget – technische Befunde

### Demo-Zugang und Endpunkte

Die aktuelle [Bitget Unified Trading Account Quick Start](https://www.bitget.com/api-doc/uta/guide) dokumentiert:

- im Demo-Modus separat erzeugten Demo API Key;
- REST über `https://api.bitget.com` mit zusätzlichem Request-Header `paptrading: 1`;
- Demo WebSocket Public `wss://wspap.bitget.com/v3/ws/public`;
- Demo WebSocket Private `wss://wspap.bitget.com/v3/ws/private`;
- Authheader `ACCESS-KEY`, `ACCESS-SIGN`, `ACCESS-TIMESTAMP`, `ACCESS-PASSPHRASE`;
- HMAC-SHA256 oder RSA-Signaturen;
- REST- und WebSocket-Limits teilen sich Quota, Gesamtlimit 6.000 Requests/IP/Minute; Endpunktlimits gelten zusätzlich.

Die weiterhin publizierte [Classic Demo Trading Seite](https://www.bitget.com/api-doc/classic/demotrading/restapi) nennt ebenfalls separaten Demo-Key, `paptrading: 1` und KYC als Voraussetzung. Vor Adapterbau muss geklärt werden, ob der Zielaccount UTA V3 nutzen kann und welche Demo-/KYC-/Entity-Regeln tatsächlich gelten; V2-/Classic- und V3-Verträge dürfen nicht vermischt werden.

### Spot und USDT-Futures

Die [UTA Place Order API](https://www.bitget.com/api-doc/uta/trade/Place-Order) unterstützt Kategorien `SPOT` und `USDT-FUTURES` am gemeinsamen Endpoint `POST /api/v3/trade/place-order`, Market/Limit und `clientOid`. Die aktuelle Dokumentation empfiehlt ausdrücklich, `clientOid` immer zu setzen. Das [UTA Best-Practices-Dokument](https://www.bitget.com/api-doc/uta/best-practices) unterscheidet Accountmodi: Spot Mode unterstützt kein Margin/Futures; Basic/Advanced können unter ihren Voraussetzungen Spot und USDT-Futures umfassen.

Für SignalPilot gilt auch in einer späteren Demo-v1 zunächst **nur Spot Long, kein Margin/Futures/Hebel**. USDT-Futures werden analysiert, aber nicht im ersten Adapter-Scope aktiviert. Ein gemeinsamer UTA-Endpoint ist kein Grund, Futures-Felder oder -Rechte vorsorglich zu erlauben.

### Client-Order-ID und Idempotenz

Bitgets Best Practices geben für `clientOid` ein 1–32-Zeichen-Format an und weisen darauf hin, dass die Exchange-Eindeutigkeitsprüfung nur pending Orders abdeckt. Daher:

- SignalPilot erzeugt global einzigartige, deterministische Client IDs, höchstens 32 erlaubte Zeichen;
- lokale Unique Constraint bleibt die primäre Idempotenz;
- ein Timeout/unklarer ACK darf nicht blind neu senden;
- zuerst Query nach `clientOid`, dann Fills und offene Orders reconciliieren;
- Exchange `orderId`, `clientOid` und lokale Order-ID immer gemeinsam speichern.

Der Order-ACK bedeutet laut [Best Practices](https://www.bitget.com/api-doc/uta/best-practices) nur Annahme/Order-ID-Zuteilung, nicht Matching oder Fill.

### Orders, Fills, Positionen und Kontostände

Relevante offizielle V3-Schnittstellen:

| Zweck | Offizielle Schnittstelle | Reconciliation-Hinweis |
| --- | --- | --- |
| Order anlegen | [`POST /api/v3/trade/place-order`](https://www.bitget.com/api-doc/uta/trade/Place-Order) | ACK nicht als Fill behandeln |
| Order per `orderId`/`clientOid` | [`GET /api/v3/trade/order-info`](https://www.bitget.com/api-doc/uta/trade/Get-Order-Details) | 20/s/UID; beide IDs unterstützt |
| Orderhistorie | [`GET /api/v3/trade/history-orders`](https://www.bitget.com/api-doc/uta/trade/Get-Order-History) | Status/CumQty/AvgPrice übernehmen |
| Fills | [`GET /api/v3/trade/fills`](https://www.bitget.com/api-doc/uta/trade/Get-Order-Fills) | 20/s/UID, letzte 90 Tage, max. 30 Tage je Query, `execId` deduplizieren |
| aktuelle Futures-Positionen | [`GET /api/v3/position/current-position`](https://www.bitget.com/api-doc/uta/trade/Get-Position) | 20/s/UID; Spot-Bestand kommt aus Assets/Fills |
| Futures-Positionshistorie | [`GET /api/v3/position/history-position`](https://www.bitget.com/api-doc/uta/trade/Get-Position-History) | 90-Tage-Fenster; für späteren Futures-Scope |
| Assets/Balance | [`GET /api/v3/account/assets`](https://www.bitget.com/api-doc/uta/account/Get-Account) | 20/s/UID; available/locked/balance/equity |
| Gebühren | [`GET /api/v3/account/fee-rate`](https://www.bitget.com/api-doc/uta/account/Get-Account-Fee-Rate) | 3/s/UID; maker/taker je Kategorie/Symbol |
| Order Stream | [Private Order Channel](https://www.bitget.com/api-doc/uta/websocket/private/Order-Channel) | kein Initialsnapshot; REST-Bootstrap nötig |
| Fill Stream | [Private Fill Channel](https://www.bitget.com/api-doc/uta/websocket/private/Fill-Channel) | `execId`, `orderId`, `clientOid`, Fee |
| Account Stream | [Private Account Channel](https://www.bitget.com/api-doc/uta/websocket/private/Account-Channel) | Initialsnapshot und Updates |

Die private Order-/Fill-Subscription ersetzt REST nicht: Streams können beim Start keinen vollständigen Orderzustand liefern. Pflichtmuster ist REST-Snapshot -> WebSocket-Subscription -> sequenz-/ID-basierte Verarbeitung -> periodisches REST-Reconcile -> historische Lücken schließen. Wegen der 90-Tage-Historiengrenze müssen Fills/Orders lokal dauerhaft und zeitnah persistiert werden.

### Rate Limits

Die UTA-Quick-Start-Seite dokumentiert 6.000 Requests/IP/Minute insgesamt und gemeinsame REST-/WebSocket-Quota. Einzelendpunkte dokumentieren typischerweise 10/s/UID für Place Order, 20/s/UID für Order-/Fill-/Position-/Asset-Queries und 3/s/UID für Fee Rate. Ein späterer Adapter braucht:

- zentralen Token-Bucket je IP, UID und Endpoint;
- Quota-Header-Auswertung;
- exponentielles Backoff mit Jitter für sichere Reads;
- keine automatische Orderwiederholung bei unbekanntem Ausgang;
- Prioritätsbudget für Cancel/risikoreduzierende Aktionen;
- Circuit Breaker und Risk Event bei 429/Timeout-/Stream-Lücken.

Limits werden bei Implementierung erneut je tatsächlich verwendeter API geprüft; Werte gehören nicht unversioniert in Businesslogik.

### Berechtigungen und IP-Allowlisting

Die offizielle [Bitget Quick Start Seite zu API Permissions](https://www.bitget.com/api-doc/common/quick-start) trennt Read-only, Trade, Transfer und Withdrawal und empfiehlt IP-Bindung. Die [API Key Terms](https://www.bitget.com/support/articles/12560603797947) verlangen Least Privilege, Einzweck-Keys und IP-Allowlisting als Sicherheitsmaßnahmen. Die [UTA Account Info API](https://www.bitget.com/api-doc/uta/account/Get-Account-Info) kann Permission Type, Permissions und IPs zurückgeben.

Zwingende spätere Key Policy:

- separater **Demo**-Key ausschließlich für SignalPilot und Umgebung;
- nur erforderliche Read- und Spot-Trade-Rechte;
- **keine Transfer-Rechte**;
- **keine Withdrawal-Rechte**;
- keine Copy-Trading-, Margin-, Futures- oder Account-Management-Schreibrechte, solange nicht im explizit genehmigten Scope;
- statische Egress-IP(s) allowlisten; Startabbruch bei leerer/abweichender Allowlist;
- Secret/Passphrase nur in dafür vorgesehenem Secret Store, nie DB/Logs/UI/Repository;
- Startup-Self-Check liest Permission/Account/Environment und failt bei Überberechtigung;
- Demo-Key kann niemals durch Konfigurationswechsel auf Live-Domain/Live-Account „hochgestuft“ werden.

Falls die Bitget-UI/API Read und Trade nur als gröberes `read-and-write` plus Permissions abbildet, muss der konkrete Permission-Snapshot nachweisen, dass Withdrawal/Transfer fehlen. Unklare Rechte sind No-Go.

### Demo-Einschränkungen und offene technische Prüfungen

Vor Implementierung in einer isolierten Spike-Phase nachzuweisen:

- UTA V3 Demo unterstützt die konkret benötigten Spot-Endpunkte tatsächlich; dokumentierte Classic-Fehler nennen Einschränkungen für Spot-Demo-Endpunkte.
- Demo-Marketdata/-Matching, Reset-/Retentionverhalten und verfügbare BTCUSDT-/ETHUSDT-Filter.
- Verhalten von Market Buy (`qty`/Quote-Amount), Partial Fills, Fees, Cancel-vs-Fill-Races, Reconnect und Duplicate `clientOid`.
- ob Demo-Order-/Fill-/Balance-Streams identische Felder und Sequenzgarantien wie dokumentiert liefern.
- KYC, Accountmode, regionale Entity und Demo-API-Key-Erzeugung.

Kein Spike darf mit einem Live-Key oder Echtgeldkonto erfolgen.

## Regionale Verfügbarkeit

Die offiziellen [Bitget Terms of Use, zuletzt aktualisiert am 16. Juni 2026](https://www.bitget.com/support/articles/360014944032/) nennen unter „Prohibited Countries“ unter anderem Deutschland, Frankreich und Österreich. Die [Mitteilung für Frankreich und Deutschland vom 16. Januar 2026](https://www.bitget.com/support/articles/12560603848103) stoppte neue Anmeldungen aus Deutschland; für Bestandsnutzer wurden mögliche weitere Änderungen angekündigt. Diese Quellen sind für den Standortkontext des Projekts materiell.

Freigabegate unmittelbar vor jeder Demo-Phase:

1. tatsächlichen Wohn-/Unternehmenssitz und zuständige Bitget-Entity klären;
2. aktuelle Terms, lokale Bitget-Seite, Accountanzeige und API-/Demo-Verfügbarkeit prüfen;
3. bei Deutschland oder anderem gesperrten Land: **kein Zugriff, keine Umgehung/VPN, kein Adapterbetrieb**;
4. gegebenenfalls schriftliche Anbieterbestätigung und rechtliche Prüfung dokumentieren;
5. Gate mindestens vor Key-Erzeugung und vor jedem produktnahen Rollout wiederholen.

## Vergleich

| Kriterium | Bitget Demo | Binance Spot Testnet / Demo | Bybit Demo/Testnet |
| --- | --- | --- | --- |
| getrennte Umgebung/Keys | separater Demo-Key; REST gleicher Host + `paptrading:1`, eigene WS | Testnet eigene Keys/Hosts; seit 2026 zusätzlich Spot Demo mit eigenen Hosts/Keys | Demo ist eigenes Konto/UID und eigener Key; Testnet separat |
| Marktbezug | reale/realitätsnahe Demo-Umgebung laut Anbieter | Spot Testnet unabhängige Preise/Orderbücher; Spot Demo ähnelt Live | Demo nutzt für Public Data Mainnet, private Demo separat |
| Spot | offiziell vorhanden | Spot Testnet nur `/api`, kein `/sapi`; Spot Demo Featureparität laut Anbieter | V5 Demo Place/Amend/Cancel/History/Fills vorhanden |
| Futures | UTA dokumentiert USDT-Futures, Demo-Support konkret zu verifizieren | USD-M Testnet `https://demo-fapi.binance.com`, WS `wss://demo-fstream.binance.com` | Demo listet Position-/Leverage-Endpunkte; nicht alle APIs verfügbar |
| WebSocket | Demo public/private V3 | Testnet und Demo getrennte WS | Demo-WS nur private; Public Mainnet; WS Trade nicht unterstützt |
| Reconciliation | `clientOid`, REST Orders/Fills/Assets/Positions + private Streams | standardisierte Order-/Account/User-Data APIs; Testnet regelmäßige Resets | REST Orders/Executions/Wallet + private Streams |
| Einschränkungen | KYC/UTA/Endpunktumfang verifizieren; regionale Sperre kritisch | Testnet ungefähr monatlicher Reset ohne Vorankündigung, virtuelle Assets, nur `/api`; Demo-Wartung möglich | nicht jede API; Orders nur 7 Tage; Standardlimit nicht erhöhbar |
| Region für EEA/Deutschland | aktuelle Bitget Terms nennen Deutschland verboten | Verfügbarkeit/entitybezogen bei Gate neu prüfen | globale EEA-Dienste werden 2026 schrittweise eingeschränkt; Bybit-EU/-Domain separat prüfen |
| Bewertung | technisch bevorzugt, regulatorisch derzeit conditional/no-go für Deutschland | stärkster neutraler Fallback für isolierte Spot-API-Tests; Demo realistischer als Testnet | brauchbarer Fallback, aber eingeschränkter Demo-WS/API-Umfang und EEA-Gate |

### Binance-Quellen

Die offizielle [Binance Spot Test Network Dokumentation](https://github.com/binance/binance-spot-api-docs/blob/master/testnet/general-info.md) nennt `https://testnet.binance.vision/api`, eigene WebSockets, ausschließlich `/api`-Endpunkte, virtuelle nicht transferierbare Assets, grundsätzlich gleiche Filter/Limits und ungefähr monatliche Komplettresets ohne Vorankündigung. Die neue [Spot Demo Mode Dokumentation](https://github.com/binance/binance-spot-api-docs/blob/master/demo-mode/general-info.md) nennt `https://demo-api.binance.com/api`, separate Demo-WebSockets, ähnliche Live-Preise/Orderbücher und manuell rücksetzbare Balances; realistisch sei ausdrücklich nicht real. Die offizielle [USD-M Futures General Info](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/general-info) nennt Testnet REST `https://demo-fapi.binance.com` und WS `wss://demo-fstream.binance.com` sowie die Pflicht, unbekannte Timeoutausgänge vor Retry zu reconciliieren.

### Bybit-Quellen

Die offizielle [Bybit Demo Trading Dokumentation](https://bybit-exchange.github.io/docs/v5/demo) nennt ein vom Mainnetkonto aus erzeugtes unabhängiges Demo-Konto/UID, REST `https://api-demo.bybit.com`, privaten WS `wss://stream-demo.bybit.com`, Mainnet-Public-WS, keine WS-Trade-Unterstützung, unvollständigen API-Umfang, sieben Tage Orderretention und nicht erhöhbare Standardlimits. Die [Integration Guidance](https://bybit-exchange.github.io/docs/v5/guide) trennt Testnet `https://api-testnet.bybit.com`, nennt regionale Domains und Einschränkungen. Bybits [EEA-Mitteilung vom 29. Juni 2026](https://announcements.bybit.com/en/article/important-notice-for-users-in-the-european-economic-area-eea--blt4135ab861456d7bf/) kündigt schrittweise Einschränkungen der globalen Plattform für EEA-Bewohner einschließlich Deutschland an; Bybit EU und konkrete Produkt-/API-Verfügbarkeit müssen separat geprüft werden.

## Späterer Adapter-Sicherheitsentwurf (noch nicht implementieren)

Erst nach bestandenem Eligibility-Gate folgt eine eigene ADR/Spezifikation mit:

- `exchange-adapter`-Port und isoliertem Demo-Adapter-Prozess;
- fest verdrahteter Environment Identity `BITGET_DEMO`, kein Runtime-Umschalten;
- Request Signing in isolierter Secret Boundary;
- persistierter Outbox für Orderintent und Inbox für WS/REST-Events;
- deterministischer `clientOid` und unbekannter-Outcome-Zustand;
- Bootstrap-/periodischem Reconcile von Account, offenen Orders, History, Fills und – falls Futures später separat freigegeben – Positionen;
- Credential-/Permission-/IP-/Domain-Attestation bei Startup;
- Kill Switch, der neue Orders blockiert, aber Cancel/risk-reducing erlaubt;
- Chaos-/Disconnect-/Rate-Limit-/Duplicate-/Race-Tests;
- weiterhin keinerlei Withdrawal/Transfer-Rechte.

Das ist Phase 10 des Implementierungsplans, nicht Teil von Shadow v1.
