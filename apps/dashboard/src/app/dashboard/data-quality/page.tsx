import Link from "next/link";

import { ErrorState, EmptyState } from "../../../components/empty-state";
import { formatDateTime } from "../../../lib/format";
import {
  buildQuery,
  fetchApi,
  type AssetCoverage,
  type DataQualityReport
} from "../../../lib/signalpilot-api";

type DataQualityPageProps = {
  searchParams: Promise<{
    assetType?: string;
    minQualityScore?: string;
  }>;
};

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(2)}%` : "-";
}

function TimeframeCoverage({ asset }: { asset: AssetCoverage }) {
  return (
    <div className="stack-list compact">
      {Object.entries(asset.candleCountsByTimeframe).map(([timeframe, count]) => (
        <div key={timeframe} className="list-row">
          <strong>{timeframe}</strong>
          <span>
            {count} candles
            {asset.hasMinimumCandlesByTimeframe[timeframe] ? "" : " below minimum"}
          </span>
        </div>
      ))}
    </div>
  );
}

export default async function DataQualityPage({ searchParams }: DataQualityPageProps) {
  const params = await searchParams;
  const query = buildQuery({
    assetType: params.assetType,
    minQualityScore: params.minQualityScore,
    limit: 100
  });
  const [report, assets] = await Promise.all([
    fetchApi<DataQualityReport>("/data-quality/report"),
    fetchApi<AssetCoverage[]>(`/data-quality/assets${query}`)
  ]);
  const data = report.data;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Data Quality</h1>
          <p>Coverage checks for candles, signals, evaluations and alerts.</p>
        </div>
        <Link className="primary-link" href="/dashboard/performance">
          Performance
        </Link>
      </div>

      {report.error ? <ErrorState title="Could not load data quality report" message={report.error} /> : null}
      {assets.error ? <ErrorState title="Could not load asset coverage" message={assets.error} /> : null}

      <form className="filter-bar">
        <label>
          Asset Type
          <select name="assetType" defaultValue={params.assetType ?? ""}>
            <option value="">All</option>
            <option value="CRYPTO">CRYPTO</option>
            <option value="STOCK">STOCK</option>
            <option value="ETF">ETF</option>
          </select>
        </label>
        <label>
          Min Quality Score
          <input name="minQualityScore" defaultValue={params.minQualityScore ?? ""} inputMode="numeric" />
        </label>
        <button type="submit">Apply</button>
      </form>

      <section className="grid metrics">
        <div className="card">
          <span className="metric-label">Signals</span>
          <span className="metric-value">{data?.signalCoverage.totalSignals ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Signals 24h</span>
          <span className="metric-value">{data?.signalCoverage.signalsLast24h ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Missing Eval</span>
          <span className="metric-value">{data?.signalCoverage.signalsWithoutEvaluation ?? 0}</span>
        </div>
        <div className="card">
          <span className="metric-label">Eval Coverage</span>
          <span className="metric-value">{formatPercent(data?.signalCoverage.evaluationCoverageRate)}</span>
        </div>
        <div className="card">
          <span className="metric-label">Skipped Rate</span>
          <span className="metric-value">{formatPercent(data?.evaluationCoverage.skippedRate)}</span>
        </div>
        <div className="card">
          <span className="metric-label">Successful Alerts</span>
          <span className="metric-value">{data?.alertCoverage.successfulAlertCount ?? 0}</span>
        </div>
      </section>

      {data ? (
        <div className="grid two" style={{ marginTop: 16 }}>
          <section className="card">
            <h2>Overall Warnings</h2>
            {data.warnings.length > 0 ? (
              <ul>
                {data.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p>No data quality warnings.</p>
            )}
          </section>
          <section className="card">
            <h2>Recommendations</h2>
            <ul>
              {data.recommendations.map((recommendation) => (
                <li key={recommendation}>{recommendation}</li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Asset Coverage</h2>
        {assets.data && assets.data.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Type</th>
                  <th>Quality</th>
                  <th>Candles</th>
                  <th>Signals</th>
                  <th>Evaluations</th>
                  <th>Skipped</th>
                  <th>Alerts</th>
                  <th>Latest Signal 1h</th>
                  <th>Warnings</th>
                </tr>
              </thead>
              <tbody>
                {assets.data.map((asset) => (
                  <tr key={asset.symbol}>
                    <td>
                      <Link href={`/dashboard/assets/${encodeURIComponent(asset.symbol)}`}>
                        {asset.symbol}
                      </Link>
                    </td>
                    <td>{asset.assetType}</td>
                    <td>
                      <div className="progress-cell">
                        <span>{asset.qualityScore}</span>
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: `${asset.qualityScore}%` }} />
                        </div>
                      </div>
                    </td>
                    <td>
                      <TimeframeCoverage asset={asset} />
                    </td>
                    <td>{asset.signalCount}</td>
                    <td>{asset.evaluationCount}</td>
                    <td>{asset.skippedEvaluationCount}</td>
                    <td>{asset.alertCount}</td>
                    <td>{formatDateTime(asset.latestSignalByTimeframe["1h"])}</td>
                    <td>{asset.warnings.join(" ") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Keine Asset Coverage gefunden." />
        )}
      </section>
    </>
  );
}
