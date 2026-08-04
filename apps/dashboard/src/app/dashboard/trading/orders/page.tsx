import { EmptyState, ErrorState } from "../../../../components/empty-state";
import { DirectionBadge } from "../../../../components/badges";
import { PageHeader, SectionCard } from "../../../../components/ui";
import { OrderStatusBadge } from "../../../../components/trading/trading-status";
import { TradingDisabled } from "../../../../components/trading/trading-disabled";
import { TradingPagination } from "../../../../components/trading/trading-pagination";
import {
  fetchShadowFills,
  fetchShadowOrders
} from "../../../../lib/trading-api";
import {
  formatDecimalAmount,
  formatUtcDateTime
} from "../../../../lib/trading-format";
import { TRADING_DASHBOARD_ENABLED } from "../../../../lib/trading-flag";

const LIMIT = 50;

const ORDER_STATUS_OPTIONS = [
  "",
  "PROPOSED",
  "ACCEPTED",
  "WAITING_FOR_ENTRY",
  "PARTIALLY_FILLED",
  "FILLED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED"
];

type PageProps = {
  searchParams: Promise<{
    status?: string;
    purpose?: string;
    direction?: string;
    strategyVersionId?: string;
    orderOffset?: string;
    fillOffset?: string;
  }>;
};

export default async function OrdersPage({ searchParams }: PageProps) {
  if (!TRADING_DASHBOARD_ENABLED) {
    return <TradingDisabled />;
  }

  const params = await searchParams;
  const orderOffset = Math.max(0, Number(params.orderOffset) || 0);
  const fillOffset = Math.max(0, Number(params.fillOffset) || 0);

  const [ordersResult, fillsResult] = await Promise.all([
    fetchShadowOrders({
      status: params.status || undefined,
      purpose: params.purpose || undefined,
      direction: params.direction || undefined,
      strategyVersionId: params.strategyVersionId || undefined,
      limit: LIMIT,
      offset: orderOffset
    }),
    fetchShadowFills({
      direction: params.direction || undefined,
      strategyVersionId: params.strategyVersionId || undefined,
      limit: LIMIT,
      offset: fillOffset
    })
  ]);

  const orders = ordersResult.data ?? [];
  const fills = fillsResult.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Shadow Trading"
        title="Orders & Fills"
        subtitle="Shadow-Order-Lebenszyklus und simulierte Ausführungen (Referenz → Spread → Slippage → Fee)"
      />

      {ordersResult.error ? (
        <ErrorState
          title="Orders konnten nicht geladen werden"
          message={ordersResult.error}
        />
      ) : null}
      {fillsResult.error ? (
        <ErrorState
          title="Fills konnten nicht geladen werden"
          message={fillsResult.error}
        />
      ) : null}

      <form className="filter-bar" method="GET">
        <select name="status" defaultValue={params.status ?? ""}>
          {ORDER_STATUS_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value || "Alle Status"}
            </option>
          ))}
        </select>
        <select name="purpose" defaultValue={params.purpose ?? ""}>
          <option value="">Entry & Exit</option>
          <option value="ENTRY">Nur Entry</option>
          <option value="EXIT">Nur Exit</option>
        </select>
        <select name="direction" defaultValue={params.direction ?? ""}>
          <option value="">Long &amp; Short</option>
          <option value="LONG">Nur Long</option>
          <option value="SHORT">Nur Short</option>
        </select>
        <input
          name="strategyVersionId"
          placeholder="StrategyVersion-ID"
          defaultValue={params.strategyVersionId ?? ""}
        />
        <button type="submit">Filtern</button>
        {params.status ||
        params.purpose ||
        params.direction ||
        params.strategyVersionId ? (
          <a
            href="/dashboard/trading/orders"
            className="section-link"
            style={{ alignSelf: "center" }}
          >
            Zurücksetzen
          </a>
        ) : null}
      </form>

      <SectionCard
        title="Shadow Orders"
        subtitle={`${orders.length} Einträge auf dieser Seite`}
      >
        {orders.length > 0 ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Richtung</th>
                    <th>Strategie</th>
                    <th>Zweck</th>
                    <th>Seite</th>
                    <th>Status</th>
                    <th>Angefordert</th>
                    <th>Gefüllt</th>
                    <th>Rest</th>
                    <th>Referenzpreis</th>
                    <th>Reserve</th>
                    <th>Ablehnungsgrund</th>
                    <th>Erstellt</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td>{order.symbol ?? order.assetId}</td>
                      <td>
                        <DirectionBadge value={order.direction} />
                      </td>
                      <td className="muted small">
                        {order.strategyKey ?? "—"}
                        {order.strategyVersion === null
                          ? ""
                          : ` v${order.strategyVersion}`}
                      </td>
                      <td>{order.purpose}</td>
                      <td>{order.side}</td>
                      <td>
                        <OrderStatusBadge value={order.status} />
                      </td>
                      <td>
                        {formatDecimalAmount(order.requestedQuantity, {
                          maximumFractionDigits: 6
                        })}
                      </td>
                      <td>
                        {formatDecimalAmount(order.filledQuantity, {
                          maximumFractionDigits: 6
                        })}
                      </td>
                      <td>
                        {formatDecimalAmount(order.remainingQuantity, {
                          maximumFractionDigits: 6
                        })}
                      </td>
                      <td>{formatDecimalAmount(order.referencePrice)}</td>
                      <td>{formatDecimalAmount(order.reservedQuoteAmount)}</td>
                      <td className="muted small">
                        {order.rejectionReasonCode ??
                          order.cancelReasonCode ??
                          "—"}
                      </td>
                      <td className="nowrap">
                        {formatUtcDateTime(order.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TradingPagination
              basePath="/dashboard/trading/orders"
              searchParams={params}
              offset={orderOffset}
              limit={LIMIT}
              count={orders.length}
              paramName="orderOffset"
            />
          </>
        ) : (
          <EmptyState title="Keine Orders gefunden." />
        )}
      </SectionCard>

      <div style={{ marginTop: 16 }}>
        <SectionCard
          title="Shadow Fills"
          subtitle="Preisbrücke Referenz → Spread → Slippage → Rundung → Fee — Spread/Slippage sind simuliert, nicht beobachtet"
        >
          {fills.length > 0 ? (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Richtung</th>
                      <th>Strategie</th>
                      <th>Seite</th>
                      <th>Auslöser</th>
                      <th>Menge</th>
                      <th>Referenzpreis</th>
                      <th>Spread (simuliert)</th>
                      <th>Slippage (simuliert)</th>
                      <th>Fill-Preis</th>
                      <th>Notional</th>
                      <th>Gebühr</th>
                      <th>Zeitpunkt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fills.map((fill) => (
                      <tr key={fill.id}>
                        <td>{fill.symbol ?? fill.assetId}</td>
                        <td>
                          {fill.direction ? (
                            <DirectionBadge value={fill.direction} />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="muted small">
                          {fill.strategyKey ?? "—"}
                          {fill.strategyVersion === null
                            ? ""
                            : ` v${fill.strategyVersion}`}
                        </td>
                        <td>{fill.side}</td>
                        <td>{fill.triggerType}</td>
                        <td>
                          {formatDecimalAmount(fill.quantity, {
                            maximumFractionDigits: 6
                          })}
                        </td>
                        <td>{formatDecimalAmount(fill.referencePrice)}</td>
                        <td>{formatDecimalAmount(fill.spreadAmount)}</td>
                        <td>{formatDecimalAmount(fill.slippageAmount)}</td>
                        <td>{formatDecimalAmount(fill.fillPrice)}</td>
                        <td>{formatDecimalAmount(fill.notional)}</td>
                        <td>
                          {formatDecimalAmount(fill.feeAmount, {
                            maximumFractionDigits: 6
                          })}{" "}
                          {fill.feeAsset}
                        </td>
                        <td className="nowrap">
                          {formatUtcDateTime(fill.occurredAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TradingPagination
                basePath="/dashboard/trading/orders"
                searchParams={params}
                offset={fillOffset}
                limit={LIMIT}
                count={fills.length}
                paramName="fillOffset"
              />
            </>
          ) : (
            <EmptyState title="Keine Fills gefunden." />
          )}
        </SectionCard>
      </div>
    </>
  );
}
