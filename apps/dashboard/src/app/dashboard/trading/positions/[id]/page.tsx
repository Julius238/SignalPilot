import Link from "next/link";
import { notFound } from "next/navigation";

import { DirectionBadge } from "../../../../../components/badges";
import { ErrorState } from "../../../../../components/empty-state";
import {
  MetricCard,
  PageHeader,
  SectionCard
} from "../../../../../components/ui";
import { PositionStatusBadge } from "../../../../../components/trading/trading-status";
import { TradingDisabled } from "../../../../../components/trading/trading-disabled";
import { fetchShadowPositionDetail } from "../../../../../lib/trading-api";
import {
  decimalTone,
  formatDecimalAmount,
  formatSignedDecimal,
  formatUtcDateTime,
  toneColor
} from "../../../../../lib/trading-format";
import { TRADING_DASHBOARD_ENABLED } from "../../../../../lib/trading-flag";

type PageProps = { params: Promise<{ id: string }> };

export default async function PositionDetailPage({ params }: PageProps) {
  if (!TRADING_DASHBOARD_ENABLED) {
    return <TradingDisabled />;
  }

  const { id } = await params;
  const result = await fetchShadowPositionDetail(id);

  if (result.error && result.error.toLowerCase().includes("not found")) {
    notFound();
  }

  const position = result.data;

  return (
    <>
      <PageHeader
        eyebrow="Position"
        title={position?.symbol ?? position?.assetId ?? id}
        subtitle={position ? position.positionKey : undefined}
        actions={
          <Link
            className="primary-link secondary-link"
            href="/dashboard/trading/positions"
          >
            ← Alle Positionen
          </Link>
        }
      />

      {result.error ? (
        <ErrorState
          title="Position konnte nicht geladen werden"
          message={result.error}
        />
      ) : null}

      {position ? (
        <>
          <div className="grid metrics">
            <MetricCard
              label="Status"
              value={<PositionStatusBadge value={position.status} />}
            />
            <MetricCard
              label="Richtung"
              value={<DirectionBadge value={position.direction} />}
            />
            <MetricCard
              label="Strategie"
              value={`${position.strategyKey ?? "—"}${position.strategyVersion === null ? "" : ` v${position.strategyVersion}`}`}
            />
            <MetricCard
              label="Anfangsmenge"
              value={formatDecimalAmount(position.initialQuantity, {
                maximumFractionDigits: 6
              })}
            />
            <MetricCard
              label="Offene Menge"
              value={formatDecimalAmount(position.openQuantity, {
                maximumFractionDigits: 6
              })}
            />
            <MetricCard
              label="Geschlossene Menge"
              value={formatDecimalAmount(position.closedQuantity, {
                maximumFractionDigits: 6
              })}
            />
            <MetricCard
              label="Ø Entry"
              value={formatDecimalAmount(position.averageEntryPrice)}
            />
            <MetricCard
              label="Ø Exit"
              value={formatDecimalAmount(position.averageExitPrice)}
            />
            <MetricCard
              label="Stop"
              value={formatDecimalAmount(position.stopPrice)}
            />
            <MetricCard
              label="Take Profit"
              value={formatDecimalAmount(position.takeProfitPrice)}
            />
            <MetricCard
              label="Realisiertes P&L"
              value={
                <span
                  style={{
                    color: toneColor(decimalTone(position.realizedPnl))
                  }}
                >
                  {formatSignedDecimal(position.realizedPnl)}
                </span>
              }
            />
            <MetricCard
              label="Gebühren"
              value={formatDecimalAmount(position.feesPaid)}
            />
            <MetricCard
              label="Reserviertes Collateral"
              value={formatDecimalAmount(position.reservedCollateral)}
            />
            <MetricCard label="Exit-Grund" value={position.exitReason ?? "—"} />
          </div>

          <div className="grid two" style={{ marginTop: 16 }}>
            <SectionCard
              title="P&L-Brücke: Brutto → Fees → Netto"
              subtitle={
                position.direction === "SHORT"
                  ? "Synthetischer, ungehebelter Shadow-Short — keine Börsenposition"
                  : "Shadow-Long — keine echte Börsenorder"
              }
            >
              <div className="stack-list compact">
                <div className="list-row">
                  <span>Brutto-Entry-Notional</span>
                  <strong>
                    {formatDecimalAmount(position.grossEntryNotional)}
                  </strong>
                </div>
                <div className="list-row">
                  <span>Brutto-Exit-Notional</span>
                  <strong>
                    {formatDecimalAmount(position.grossExitNotional)}
                  </strong>
                </div>
                <div className="list-row">
                  <span>Gebühren</span>
                  <strong>{formatDecimalAmount(position.feesPaid)}</strong>
                </div>
                <div className="list-row">
                  <span>Reserviertes Collateral</span>
                  <strong>
                    {formatDecimalAmount(position.reservedCollateral)}
                  </strong>
                </div>
                <div className="list-row">
                  <span>Netto realisiertes P&L</span>
                  <strong
                    style={{
                      color: toneColor(decimalTone(position.realizedPnl))
                    }}
                  >
                    {formatSignedDecimal(position.realizedPnl)}
                  </strong>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Zeiten">
              <div className="stack-list compact">
                <div className="list-row">
                  <span>Eröffnet</span>
                  <strong>{formatUtcDateTime(position.openedAt)}</strong>
                </div>
                <div className="list-row">
                  <span>Geschlossen</span>
                  <strong>{formatUtcDateTime(position.closedAt)}</strong>
                </div>
                <div className="list-row">
                  <span>Max. Haltedauer bis</span>
                  <strong>{formatUtcDateTime(position.maxHoldUntil)}</strong>
                </div>
                <div className="list-row">
                  <span>Letzte Bewertung</span>
                  <strong>{formatUtcDateTime(position.lastValuationAt)}</strong>
                </div>
              </div>
            </SectionCard>
          </div>

          <div style={{ marginTop: 16 }}>
            <SectionCard
              title="Position Events"
              subtitle="Chronologische Ereignisfolge dieser Position"
            >
              {position.events.length > 0 ? (
                <div className="table-wrap">
                  <table className="responsive-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Typ</th>
                        <th>Menge</th>
                        <th>Preis</th>
                        <th>P&L-Delta</th>
                        <th>Zeitpunkt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {position.events.map((event) => (
                        <tr key={event.id}>
                          <td data-label="#">{event.sequence}</td>
                          <td data-label="Typ">{event.type}</td>
                          <td data-label="Menge">
                            {formatDecimalAmount(event.quantity, {
                              maximumFractionDigits: 6
                            })}
                          </td>
                          <td data-label="Preis">
                            {formatDecimalAmount(event.price)}
                          </td>
                          <td data-label="P&L-Delta">
                            <span
                              style={{
                                color: toneColor(
                                  decimalTone(event.realizedPnlDelta)
                                )
                              }}
                            >
                              {formatSignedDecimal(event.realizedPnlDelta)}
                            </span>
                          </td>
                          <td data-label="Zeitpunkt" className="nowrap">
                            {formatUtcDateTime(event.occurredAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted small">Keine Events vorhanden.</p>
              )}
            </SectionCard>
          </div>
        </>
      ) : null}
    </>
  );
}
