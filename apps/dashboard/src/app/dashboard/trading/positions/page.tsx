import Link from "next/link";

import { EmptyState, ErrorState } from "../../../../components/empty-state";
import { PageHeader, SectionCard } from "../../../../components/ui";
import { PositionStatusBadge } from "../../../../components/trading/trading-status";
import { TradingDisabled } from "../../../../components/trading/trading-disabled";
import { TradingPagination } from "../../../../components/trading/trading-pagination";
import { fetchShadowPositions } from "../../../../lib/trading-api";
import {
  decimalTone,
  formatDecimalAmount,
  formatSignedDecimal,
  formatUtcDateTime,
  toneColor
} from "../../../../lib/trading-format";
import { TRADING_DASHBOARD_ENABLED } from "../../../../lib/trading-flag";

const LIMIT = 50;

type PageProps = {
  searchParams: Promise<{ open?: string; offset?: string }>;
};

export default async function PositionsPage({ searchParams }: PageProps) {
  if (!TRADING_DASHBOARD_ENABLED) {
    return <TradingDisabled />;
  }

  const params = await searchParams;
  const offset = Math.max(0, Number(params.offset) || 0);
  const openFilter = params.open === "false" ? "false" : params.open === "true" ? "true" : undefined;

  const result = await fetchShadowPositions({
    open: openFilter,
    limit: LIMIT,
    offset
  });

  const positions = result.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Shadow Trading"
        title="Positionen"
        subtitle="Offene und geschlossene Shadow-Positionen mit unrealisiertem/realisiertem P&L"
      />

      {result.error ? (
        <ErrorState title="Positionen konnten nicht geladen werden" message={result.error} />
      ) : null}

      <form className="filter-bar" method="GET">
        <select name="open" defaultValue={params.open ?? ""}>
          <option value="">Alle Positionen</option>
          <option value="true">Nur offene</option>
          <option value="false">Nur geschlossene</option>
        </select>
        <button type="submit">Filtern</button>
        {params.open ? (
          <a href="/dashboard/trading/positions" className="section-link" style={{ alignSelf: "center" }}>
            Zurücksetzen
          </a>
        ) : null}
      </form>

      <SectionCard title="Positionen" subtitle={`${positions.length} Einträge auf dieser Seite`}>
        {positions.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Status</th>
                    <th>Offene Menge</th>
                    <th>Ø Entry</th>
                    <th>Stop</th>
                    <th>Take Profit</th>
                    <th>Realisiertes P&L</th>
                    <th>Eröffnet</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((position) => (
                    <tr key={position.id}>
                      <td data-label="Symbol">
                        <Link href={`/dashboard/trading/positions/${position.id}`}>
                          {position.symbol ?? position.assetId}
                        </Link>
                      </td>
                      <td data-label="Status">
                        <PositionStatusBadge value={position.status} />
                      </td>
                      <td data-label="Offene Menge">{formatDecimalAmount(position.openQuantity, { maximumFractionDigits: 6 })}</td>
                      <td data-label="Ø Entry">{formatDecimalAmount(position.averageEntryPrice)}</td>
                      <td data-label="Stop">{formatDecimalAmount(position.stopPrice)}</td>
                      <td data-label="Take Profit">{formatDecimalAmount(position.takeProfitPrice)}</td>
                      <td data-label="Realisiertes P&L">
                        <span style={{ color: toneColor(decimalTone(position.realizedPnl)) }}>
                          {formatSignedDecimal(position.realizedPnl)}
                        </span>
                      </td>
                      <td data-label="Eröffnet" className="nowrap">
                        {formatUtcDateTime(position.openedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TradingPagination
              basePath="/dashboard/trading/positions"
              searchParams={params}
              offset={offset}
              limit={LIMIT}
              count={positions.length}
            />
          </>
        ) : (
          <EmptyState title="Keine Positionen gefunden." />
        )}
      </SectionCard>
    </>
  );
}
