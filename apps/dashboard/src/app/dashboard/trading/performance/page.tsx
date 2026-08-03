import { EmptyState, ErrorState } from "../../../../components/empty-state";
import { PageHeader, SectionCard } from "../../../../components/ui";
import { TradingBarChart, TradingLineChart } from "../../../../components/trading/trading-line-chart";
import { TradingDisabled } from "../../../../components/trading/trading-disabled";
import {
  PerformanceOverallCard,
  PerformanceSegmentTable
} from "../../../../components/trading/performance-segment-table";
import {
  fetchLatestPerformanceRun,
  fetchShadowPositions,
  fetchStrategyPerformance,
  fetchTradingPortfolioSnapshots
} from "../../../../lib/trading-api";
import {
  decimalTone,
  formatDecimalAmount,
  formatSignedDecimal,
  formatUtcDateTime,
  toneColor
} from "../../../../lib/trading-format";
import { TRADING_DASHBOARD_ENABLED } from "../../../../lib/trading-flag";

const SNAPSHOT_LIMIT = 200;
const CLOSED_POSITION_LIMIT = 200;

type PageProps = {
  searchParams: Promise<{ window?: string }>;
};

export default async function PerformancePage({ searchParams }: PageProps) {
  if (!TRADING_DASHBOARD_ENABLED) {
    return <TradingDisabled />;
  }

  const params = await searchParams;
  const window = params.window || "ALL_TIME";

  const [performanceResult, snapshotsResult, closedPositionsResult, latestRunResult] = await Promise.all([
    fetchStrategyPerformance({ window, limit: 50 }),
    fetchTradingPortfolioSnapshots({ limit: SNAPSHOT_LIMIT }),
    fetchShadowPositions({ open: "false", limit: CLOSED_POSITION_LIMIT }),
    fetchLatestPerformanceRun({ window })
  ]);

  const performance = performanceResult.data ?? [];
  const latestRun = latestRunResult.data ?? null;
  const segments = latestRun?.segments ?? [];
  // Alle Segmente stammen per Konstruktion aus demselben inputHash — die API
  // gruppiert den Lauf, damit hier nie zwei Datenstände vermischt werden.
  const overallSegment = segments.find((segment) => segment.segmentType === "OVERALL") ?? null;
  const assetSegments = segments.filter((segment) => segment.segmentType === "ASSET");
  const regimeSegments = segments.filter((segment) => segment.segmentType === "MARKET_REGIME");
  const versionSegments = segments.filter((segment) => segment.segmentType === "STRATEGY_VERSION");
  const exitSegments = segments.filter((segment) => segment.segmentType === "EXIT_REASON");
  const snapshots = snapshotsResult.data ?? [];
  const closedPositions = closedPositionsResult.data ?? [];

  const equityPoints = snapshots.map((snapshot) => ({ time: snapshot.asOf, value: snapshot.equity }));
  const cumulativePnlPoints = snapshots.map((snapshot) => ({
    time: snapshot.asOf,
    value: snapshot.realizedPnl
  }));
  const drawdownPoints = snapshots.map((snapshot) => ({
    time: snapshot.asOf,
    value: `-${snapshot.drawdownAmount}`
  }));
  const perTradePnlPoints = closedPositions
    .filter((position) => position.closedAt)
    .map((position) => ({ time: position.closedAt as string, value: position.realizedPnl }));

  return (
    <>
      <PageHeader
        eyebrow="Shadow Trading"
        title="Strategy Performance"
        subtitle="Ausschließlich Shadow-Trades je StrategyVersion — nicht die Paper-/Signal-Auswertung"
      />

      {performanceResult.error ? (
        <ErrorState title="Performance konnte nicht geladen werden" message={performanceResult.error} />
      ) : null}
      {snapshotsResult.error ? (
        <ErrorState title="Portfolio-Snapshots konnten nicht geladen werden" message={snapshotsResult.error} />
      ) : null}

      <form className="filter-bar" method="GET">
        <select name="window" defaultValue={window}>
          <option value="DAILY">Täglich</option>
          <option value="ROLLING_30D">Rollierend 30 Tage</option>
          <option value="ALL_TIME">Gesamt</option>
        </select>
        <button type="submit">Filtern</button>
      </form>

      <div className="grid two">
        <TradingLineChart points={equityPoints} title="Equity-Kurve" emptyLabel="Keine Portfolio-Snapshots vorhanden." />
        <TradingLineChart
          points={drawdownPoints}
          title="Drawdown"
          lineColor="#ff8580"
          emptyLabel="Keine Portfolio-Snapshots vorhanden."
        />
      </div>
      <div className="grid two" style={{ marginTop: 16 }}>
        <TradingLineChart
          points={cumulativePnlPoints}
          title="Kumuliertes realisiertes P&L"
          lineColor="#62d69b"
          emptyLabel="Keine Portfolio-Snapshots vorhanden."
        />
        <TradingBarChart points={perTradePnlPoints} title="P&L je abgeschlossenem Trade" />
      </div>

      <div style={{ marginTop: 16 }}>
        <SectionCard title="Strategy Performance je StrategyVersion" subtitle={`Fenster: ${window}`}>
          {performance.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>StrategyVersion</th>
                    <th>Zeitraum</th>
                    <th>Abgeschlossene Trades</th>
                    <th>Gewinne</th>
                    <th>Verluste</th>
                    <th>Breakeven</th>
                    <th>Brutto-P&L</th>
                    <th>Netto-P&L</th>
                    <th>Gebühren</th>
                    <th>Ø R</th>
                    <th>Profit-Faktor</th>
                    <th>Max. Drawdown %</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.map((row) => (
                    <tr key={row.id}>
                      <td>{row.strategyVersionId}</td>
                      <td className="nowrap">
                        {formatUtcDateTime(row.from)} – {formatUtcDateTime(row.to)}
                      </td>
                      <td>{row.closedTrades}</td>
                      <td>{row.wins}</td>
                      <td>{row.losses}</td>
                      <td>{row.breakeven}</td>
                      <td>{formatDecimalAmount(row.grossPnl)}</td>
                      <td>
                        <span style={{ color: toneColor(decimalTone(row.netPnl)) }}>
                          {formatSignedDecimal(row.netPnl)}
                        </span>
                      </td>
                      <td>{formatDecimalAmount(row.fees)}</td>
                      <td>{formatDecimalAmount(row.averageR)}</td>
                      <td>{formatDecimalAmount(row.profitFactor)}</td>
                      <td>{formatDecimalAmount(row.maxDrawdownPct)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Keine Performance-Daten für dieses Fenster." />
          )}
        </SectionCard>
      </div>

      {latestRunResult.error ? (
        <div style={{ marginTop: 16 }}>
          <ErrorState
            title="Segmentierte Performance konnte nicht geladen werden"
            message={latestRunResult.error}
          />
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <SectionCard title="Datenbasis und Berechnungsversion" subtitle={`Fenster: ${window}`}>
          {latestRun?.provenance ? (
            <div className="table-wrap">
              <table>
                <tbody>
                  <tr>
                    <th>Stand (asOf)</th>
                    <td>{formatUtcDateTime(latestRun.provenance.asOf)}</td>
                    <th>Berechnet am</th>
                    <td>{formatUtcDateTime(latestRun.provenance.computedAt)}</td>
                  </tr>
                  <tr>
                    <th>Datenstand bis</th>
                    <td>{formatUtcDateTime(latestRun.provenance.dataThroughAt)}</td>
                    <th>Zeitraum (UTC)</th>
                    <td className="nowrap">
                      {formatUtcDateTime(latestRun.provenance.from)} – {formatUtcDateTime(latestRun.provenance.to)}
                    </td>
                  </tr>
                  <tr>
                    <th>Engine-Version</th>
                    <td>{latestRun.provenance.engineVersion}</td>
                    <th>Code-Version</th>
                    <td>{latestRun.provenance.codeVersion}</td>
                  </tr>
                  <tr>
                    <th>Input-Hash</th>
                    <td className="mono">{latestRun.provenance.inputHash.slice(0, 16)}…</td>
                    <th>Output-Hash</th>
                    <td className="mono">{latestRun.provenance.outputHash.slice(0, 16)}…</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Noch keine Performance-Berechnung vorhanden."
              description="Der Job trading-worker:shadow-performance-refresh ist standardmäßig deaktiviert (TRADING_PERFORMANCE_JOB_ENABLED)."
            />
          )}
        </SectionCard>
      </div>

      {overallSegment ? (
        <div style={{ marginTop: 16 }}>
          <PerformanceOverallCard segment={overallSegment} />
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <PerformanceSegmentTable
          title="Performance nach Asset"
          segments={assetSegments}
          keyHeader="Asset"
          emptyLabel="Keine Aufschlüsselung nach Asset vorhanden."
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <PerformanceSegmentTable
          title="Performance nach Marktregime"
          subtitle="Regime zum Entscheidungszeitpunkt des Candidates, nicht das heutige"
          segments={regimeSegments}
          keyHeader="Marktregime"
          emptyLabel="Keine Aufschlüsselung nach Marktregime vorhanden."
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <PerformanceSegmentTable
          title="Performance nach StrategyVersion"
          segments={versionSegments}
          keyHeader="StrategyVersion"
          emptyLabel="Keine Aufschlüsselung nach StrategyVersion vorhanden."
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <PerformanceSegmentTable
          title="Performance nach Exit-Grund"
          segments={exitSegments}
          keyHeader="Exit-Grund"
          emptyLabel="Keine Aufschlüsselung nach Exit-Grund vorhanden."
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <SectionCard title="Portfolio-Snapshots" subtitle={`Letzte ${snapshots.length} Snapshots`}>
          {snapshots.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Datum (UTC)</th>
                    <th>Equity</th>
                    <th>Verfügbares Cash</th>
                    <th>Reserviertes Cash</th>
                    <th>Marktwert</th>
                    <th>Realisiertes P&L</th>
                    <th>Unrealisiertes P&L</th>
                    <th>Tages-P&L</th>
                    <th>Drawdown</th>
                    <th>Offene Positionen</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((snapshot) => (
                    <tr key={snapshot.id}>
                      <td className="nowrap">{formatUtcDateTime(snapshot.asOf)}</td>
                      <td>{formatDecimalAmount(snapshot.equity)}</td>
                      <td>{formatDecimalAmount(snapshot.availableCash)}</td>
                      <td>{formatDecimalAmount(snapshot.reservedCash)}</td>
                      <td>{formatDecimalAmount(snapshot.marketValue)}</td>
                      <td>{formatDecimalAmount(snapshot.realizedPnl)}</td>
                      <td>{formatDecimalAmount(snapshot.unrealizedPnl)}</td>
                      <td>
                        <span style={{ color: toneColor(decimalTone(snapshot.dailyPnl)) }}>
                          {formatSignedDecimal(snapshot.dailyPnl)}
                        </span>
                      </td>
                      <td>
                        {formatDecimalAmount(snapshot.drawdownAmount)} ({formatDecimalAmount(snapshot.drawdownPct)}%)
                      </td>
                      <td>{snapshot.openPositionCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Keine Portfolio-Snapshots vorhanden." />
          )}
        </SectionCard>
      </div>
    </>
  );
}
