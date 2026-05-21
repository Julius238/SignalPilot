import { ErrorState, EmptyState } from "../../../components/empty-state";
import { formatDateTime, formatScore } from "../../../lib/format";
import { fetchApi, type MarketRegimeSnapshot } from "../../../lib/signalpilot-api";

export default async function MarketRegimePage() {
  const [latest, history] = await Promise.all([
    fetchApi<MarketRegimeSnapshot | null>("/market-regime/latest"),
    fetchApi<MarketRegimeSnapshot[]>("/market-regime/history?limit=50")
  ]);
  const snapshot = latest.data;
  const report = snapshot?.report ?? snapshot?.reportJson;
  const errors = [latest.error, history.error].filter(Boolean);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Market Regime</h1>
          <p>Benchmark context for equity, crypto and overall risk mode.</p>
        </div>
      </div>

      {errors.length > 0 ? <ErrorState title="Could not load market regime" message={errors.join(" | ")} /> : null}

      {!snapshot || !report ? (
        <EmptyState title="Market Regime noch nicht berechnet." />
      ) : (
        <>
          <section className="grid metrics">
            <Metric label="Equity Regime" value={snapshot.equityRegime} />
            <Metric label="Crypto Regime" value={snapshot.cryptoRegime} />
            <Metric label="Overall Regime" value={snapshot.overallRegime} />
            <Metric label="Risk Mode" value={snapshot.riskMode} />
            <Metric label="Confidence" value={formatScore(snapshot.confidence)} />
            <Metric label="Generated" value={formatDateTime(snapshot.generatedAt)} />
          </section>

          <section className="card" style={{ marginTop: 16 }}>
            <h2>Latest Regime Summary</h2>
            <p>{snapshot.summary}</p>
            <p>{snapshot.riskNote}</p>
            <div className="stack-list">
              {report.recommendations.map((recommendation) => (
                <div className="list-row" key={recommendation}>
                  <span>{recommendation}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card" style={{ marginTop: 16 }}>
            <h2>Benchmark Summaries</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Trend</th>
                    <th>Momentum</th>
                    <th>Volatility</th>
                    <th>Vs SMA50</th>
                    <th>Vs SMA200</th>
                    <th>RSI</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {report.benchmarkSummaries.map((benchmark) => (
                    <tr key={benchmark.symbol}>
                      <td>{benchmark.symbol}</td>
                      <td>{benchmark.trendDirection}</td>
                      <td>{benchmark.momentumState}</td>
                      <td>{benchmark.volatilityState}</td>
                      <td>{formatPercent(benchmark.priceVsSma50)}</td>
                      <td>{formatPercent(benchmark.priceVsSma200)}</td>
                      <td>{formatScore(benchmark.rsi)}</td>
                      <td>{formatScore(benchmark.score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="card" style={{ marginTop: 16 }}>
        <h2>History</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Generated</th>
                <th>Equity</th>
                <th>Crypto</th>
                <th>Overall</th>
                <th>Risk Mode</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {(history.data ?? []).map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.generatedAt)}</td>
                  <td>{row.equityRegime}</td>
                  <td>{row.cryptoRegime}</td>
                  <td>{row.overallRegime}</td>
                  <td>{row.riskMode}</td>
                  <td>{formatScore(row.confidence)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <span className="metric-label">{label}</span>
      <span className="metric-value metric-value-text">{value}</span>
    </div>
  );
}

function formatPercent(value: number | null) {
  return value === null ? "-" : `${value.toFixed(2)}%`;
}
