# ADR 0007 – Bitget ist technisch bevorzugt, aber nicht freigegeben

- Status: Accepted
- Datum: 2026-08-01

## Kontext

Der Nutzer bevorzugt Bitget. Offizielle Dokumentation belegt separate Demo-Keys, `paptrading: 1`, Demo-WebSockets, UTA Spot/USDT-Futures, `clientOid` und Reconciliation-Schnittstellen. Die am 16. Juni 2026 aktualisierten Bitget Terms führen Deutschland jedoch als „Prohibited Country“; weitere Mitteilungen betreffen deutsche Nutzer.

## Entscheidung

Bitget bleibt conditional preferred für eine spätere Demo-Phase, ist aber nicht genehmigt. P10 beginnt nur nach erneuter offizieller Quellenprüfung und positiv dokumentiertem Region-/Entity-/Account-/Demo-/Permission-Gate. Bei deutschem Wohn-/Unternehmenssitz und fortbestehender Sperre ist der Adapter No-Go; Beschränkungen werden niemals technisch umgangen.

Wenn das Gate grün wird: separater Demo-Key, nur notwendige Read- und Spot-Trade-Rechte, keine Transfer-/Withdrawal-/Copy-/Futuresrechte, IP-Allowlist und hardcoded Demo-Environment. Shadow v1 bleibt adapterfrei.

## Folgen

- Nutzerpräferenz bleibt berücksichtigt, ohne aktuelle regulatorische Hinweise zu ignorieren.
- Binance/Bybit können erst nach eigener aktueller Regional-/Technikprüfung Alternativen sein.
- Bereits vorhandene Kontonutzung ist kein Freigabenachweis.

## Verworfene Alternativen

- Adapter jetzt vorbereiten: würde eine aktuell ungeklärte/verbotene Richtung normalisieren.
- VPN/Region-Workaround: unzulässig und sicherheitswidrig.
- Live-Key mit eingeschränkten Rechten für Demo: klare Environment-Trennung fehlt.
