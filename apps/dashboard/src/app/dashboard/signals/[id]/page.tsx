import { CandlestickChart } from "../../../../components/CandlestickChart";
import { DirectionBadge, RiskBadge, StatusBadge } from "../../../../components/badges";
import { ErrorState } from "../../../../components/empty-state";
import { formatDateTime, formatJson, formatScore } from "../../../../lib/format";
import { fetchApi, type SignalDetail } from "../../../../lib/signalpilot-api";

type SignalDetailPageProps = {
  params: Promise<{ id: string }>;
};

const scoreKeys = [
  "trendScore",
  "momentumScore",
  "volumeScore",
  "volatilityScore",
  "rsiScore",
  "newsScore",
  "socialScore",
  "eventScore",
  "riskScore"
] as const;

export default async function SignalDetailPage({ params }: SignalDetailPageProps) {
  const { id } = await params;
  const signal = await fetchApi<SignalDetail>(`/signals/${encodeURIComponent(id)}`);

  if (signal.error) {
    return <ErrorState title="Could not load signal" message={signal.error} />;
  }

  const data = signal.data;

  if (!data) {
    return <ErrorState title="Signal missing" message="The API returned no signal payload." />;
  }

  return (
    <>
      <div className="page-header">
        <h1>
          {data.signal.symbol} · {data.signal.timeframe}
        </h1>
        <p>
          {data.signal.signalType} · {formatDateTime(data.signal.createdAt)}
        </p>
      </div>

      <section className="grid metrics">
        <div className="card">
          <span className="metric-label">Status</span>
          <span className="metric-value">
            <StatusBadge value={data.signal.status} />
          </span>
        </div>
        <div className="card">
          <span className="metric-label">Direction</span>
          <span className="metric-value">
            <DirectionBadge value={data.signal.direction} />
          </span>
        </div>
        <div className="card">
          <span className="metric-label">Score</span>
          <span className="metric-value">{formatScore(data.signal.score)}</span>
        </div>
        <div className="card">
          <span className="metric-label">Risk</span>
          <span className="metric-value">
            <RiskBadge value={data.signal.riskLevel} />
          </span>
        </div>
      </section>

      <CandlestickChart
        candles={data.candles.map((candle) => ({
          time: candle.openTime,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume
        }))}
        signalMarker={{
          time: data.candles.at(-1)?.openTime ?? data.signal.createdAt,
          direction: data.signal.direction,
          status: data.signal.status,
          label: data.signal.signalType
        }}
        title={`Candles · ${data.signal.symbol} · ${data.signal.timeframe}`}
      />

      <section className="card">
        <h2>Signal Scores</h2>
        <div className="score-grid">
          {scoreKeys.map((key) => (
            <div className="score-item" key={key}>
              <span>{key}</span>
              <strong>{formatScore(data.signal[key])}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="detail-grid" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Signal Output</h2>
          <h3>Short Conclusion</h3>
          <p>{data.signalOutput?.shortConclusion ?? "-"}</p>
          <h3>Counter Argument</h3>
          <p>{data.signalOutput?.counterArgument ?? "-"}</p>
          <h3>Next Trigger</h3>
          <p>{data.signalOutput?.nextTrigger ?? "-"}</p>
          <h3>Telegram Text</h3>
          <pre className="telegram-text">{data.signalOutput?.telegramText ?? "-"}</pre>
        </div>
        <div className="card">
          <h2>Structured JSON</h2>
          <h3>Technical</h3>
          <pre>{formatJson(data.signalOutput?.technicalJson)}</pre>
          <h3>Intelligence</h3>
          <pre>{formatJson(data.signalOutput?.intelligenceJson)}</pre>
          <h3>Market Confirmation</h3>
          <pre>{formatJson(data.signalOutput?.marketConfirmationJson)}</pre>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Latest 250 Candles</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Open Time</th>
                <th>Open</th>
                <th>High</th>
                <th>Low</th>
                <th>Close</th>
                <th>Volume</th>
              </tr>
            </thead>
            <tbody>
              {data.candles.map((candle) => (
                <tr key={candle.id}>
                  <td>{formatDateTime(candle.openTime)}</td>
                  <td>{candle.open}</td>
                  <td>{candle.high}</td>
                  <td>{candle.low}</td>
                  <td>{candle.close}</td>
                  <td>{candle.volume}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
