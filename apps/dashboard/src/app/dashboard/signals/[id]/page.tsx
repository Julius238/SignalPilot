import { CandlestickChart } from "../../../../components/CandlestickChart";
import { DirectionBadge, RiskBadge, StatusBadge } from "../../../../components/badges";
import { ErrorState } from "../../../../components/empty-state";
import { formatDateTime, formatJson, formatScore } from "../../../../lib/format";
import {
  fetchApi,
  type EventContext,
  type NewsContext,
  type SignalDetail,
  type SignalRuleApplication,
  type SignalRegimeContext
} from "../../../../lib/signalpilot-api";

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
  const [signal, newsContext, eventContext, marketRegimeContext, ruleApplication] = await Promise.all([
    fetchApi<SignalDetail>(`/signals/${encodeURIComponent(id)}`),
    fetchApi<NewsContext>(`/signals/${encodeURIComponent(id)}/news-context`),
    fetchApi<EventContext>(`/signals/${encodeURIComponent(id)}/event-context`),
    fetchApi<SignalRegimeContext | null>(`/signals/${encodeURIComponent(id)}/market-regime-context`),
    fetchApi<SignalRuleApplication>(`/signals/${encodeURIComponent(id)}/rule-application`)
  ]);

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

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Market Regime Context</h2>
        {marketRegimeContext.data ? (
          <div className="stack-list">
            <div className="list-row">
              <strong>{marketRegimeContext.data.overallRegime}</strong>
              <span>{marketRegimeContext.data.riskMode}</span>
              <span>{marketRegimeContext.data.conflictLevel}</span>
            </div>
            <p>{marketRegimeContext.data.summary}</p>
            <p>{marketRegimeContext.data.riskNote}</p>
          </div>
        ) : (
          <p>Market Regime: Noch nicht berechnet.</p>
        )}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Score Adjustments</h2>
        {ruleApplication.data ? (
          <div className="stack-list">
            <div className="list-row">
              <strong>
                {formatScore(ruleApplication.data.originalScore)} → {formatScore(ruleApplication.data.adjustedScore)}
              </strong>
              <span>{ruleApplication.data.originalStatus} → {ruleApplication.data.adjustedStatus}</span>
            </div>
            <p>{ruleApplication.data.summary}</p>
            {ruleApplication.data.adjustments.map((adjustment) => (
              <div className="list-row" key={`${adjustment.category}-${adjustment.reason}`}>
                <div>
                  <strong>{adjustment.reason}</strong>
                  <span>{adjustment.category}</span>
                </div>
                <span>{formatScore(adjustment.scoreDelta)}</span>
              </div>
            ))}
            {ruleApplication.data.warnings.length > 0 ? <p>{ruleApplication.data.warnings.join(" | ")}</p> : null}
          </div>
        ) : (
          <p>Score Adjustments: Keine Rule Application gefunden.</p>
        )}
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

      {data.paperEvaluation ? (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Paper Evaluation</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <th>Hypothetical outcome</th>
                  <td>{data.paperEvaluation.outcome ?? data.paperEvaluation.evaluationStatus}</td>
                </tr>
                <tr>
                  <th>Evaluation Kind</th>
                  <td>{data.paperEvaluation.evaluationKind}</td>
                </tr>
                <tr>
                  <th>Expected Move</th>
                  <td>{data.paperEvaluation.expectedMoveDirection}</td>
                </tr>
                {data.paperEvaluation.skipReason ? (
                  <tr>
                    <th>Skip Reason</th>
                    <td>{data.paperEvaluation.skipReason}</td>
                  </tr>
                ) : null}
                <tr>
                  <th>Entry Price</th>
                  <td>{data.paperEvaluation.entryPrice}</td>
                </tr>
                <tr>
                  <th>Target Price</th>
                  <td>{data.paperEvaluation.targetPrice ?? "-"}</td>
                </tr>
                <tr>
                  <th>Invalidation Price</th>
                  <td>{data.paperEvaluation.invalidationPrice ?? "-"}</td>
                </tr>
                <tr>
                  <th>Return 1h</th>
                  <td>
                    {data.paperEvaluation.returnAfter1h === null
                      ? "-"
                      : `${data.paperEvaluation.returnAfter1h.toFixed(2)}%`}
                  </td>
                </tr>
                <tr>
                  <th>Return 4h</th>
                  <td>
                    {data.paperEvaluation.returnAfter4h === null
                      ? "-"
                      : `${data.paperEvaluation.returnAfter4h.toFixed(2)}%`}
                  </td>
                </tr>
                <tr>
                  <th>Return 1d</th>
                  <td>
                    {data.paperEvaluation.returnAfter1d === null
                      ? "-"
                      : `${data.paperEvaluation.returnAfter1d.toFixed(2)}%`}
                  </td>
                </tr>
                <tr>
                  <th>Opened</th>
                  <td>{formatDateTime(data.paperEvaluation.openedAt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {newsContext.data && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>News Context</h2>
          <div className="score-grid">
            <div className="score-item">
              <span>Recent News</span>
              <strong>{newsContext.data.hasRecentNews ? "Yes" : "No"}</strong>
            </div>
            <div className="score-item">
              <span>News Count</span>
              <strong>{newsContext.data.recentNewsCount}</strong>
            </div>
            <div className="score-item">
              <span>Relevance Score</span>
              <strong>{newsContext.data.relevanceScore}</strong>
            </div>
            <div className="score-item">
              <span>Sentiment</span>
              <strong>{newsContext.data.sentiment}</strong>
            </div>
          </div>
          {newsContext.data.summary && (
            <p style={{ marginTop: 8 }}>{newsContext.data.summary}</p>
          )}
          {newsContext.data.riskNote && (
            <p className="muted small">{newsContext.data.riskNote}</p>
          )}
          {newsContext.data.sourceNote && (
            <p className="muted small">{newsContext.data.sourceNote}</p>
          )}
          {newsContext.data.topNews.length > 0 && (
            <>
              <h3 style={{ marginTop: 12 }}>Top News</h3>
              <div className="stack-list">
                {newsContext.data.topNews.map((item, i) => (
                  <div key={i} className="list-row">
                    <div>
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noopener noreferrer">
                          {item.headline}
                        </a>
                      ) : (
                        <span>{item.headline}</span>
                      )}
                    </div>
                    <div className="nowrap muted small">
                      {item.source} · {formatDateTime(item.publishedAt)} · {item.sentiment}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {eventContext.data && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Event Context</h2>
          <div className="score-grid">
            <div className="score-item">
              <span>Risk Level</span>
              <strong
                style={{
                  color:
                    eventContext.data.eventRiskLevel === "HIGH"
                      ? "var(--color-danger, #e53e3e)"
                      : eventContext.data.eventRiskLevel === "MEDIUM"
                        ? "var(--color-warn, #dd6b20)"
                        : undefined
                }}
              >
                {eventContext.data.eventRiskLevel}
              </strong>
            </div>
            <div className="score-item">
              <span>Upcoming Event</span>
              <strong>{eventContext.data.hasUpcomingEvent ? "Yes" : "No"}</strong>
            </div>
            <div className="score-item">
              <span>Recent Event</span>
              <strong>{eventContext.data.hasRecentEvent ? "Yes" : "No"}</strong>
            </div>
            {eventContext.data.daysToNearestEvent !== null && (
              <div className="score-item">
                <span>Days to Event</span>
                <strong>{eventContext.data.daysToNearestEvent}</strong>
              </div>
            )}
            {eventContext.data.daysSinceRecentEvent !== null && (
              <div className="score-item">
                <span>Days Since Event</span>
                <strong>{eventContext.data.daysSinceRecentEvent}</strong>
              </div>
            )}
          </div>
          {eventContext.data.summary && (
            <p style={{ marginTop: 8 }}>{eventContext.data.summary}</p>
          )}
          {eventContext.data.riskNote && (
            <p className="muted small">{eventContext.data.riskNote}</p>
          )}
          {eventContext.data.nearestEvent && (
            <>
              <h3 style={{ marginTop: 12 }}>Nearest Event</h3>
              <div className="stack-list">
                <div className="list-row">
                  <div>
                    <strong>{eventContext.data.nearestEvent.title}</strong>
                    {eventContext.data.nearestEvent.fiscalQuarter && (
                      <span className="muted small">
                        {" "}
                        · Q{eventContext.data.nearestEvent.fiscalQuarter}{" "}
                        {eventContext.data.nearestEvent.fiscalYear}
                      </span>
                    )}
                  </div>
                  <div className="nowrap muted small">
                    {formatDateTime(eventContext.data.nearestEvent.eventDate)}
                    {eventContext.data.nearestEvent.daysFromNow > 0
                      ? ` · in ${eventContext.data.nearestEvent.daysFromNow}d`
                      : ` · ${Math.abs(eventContext.data.nearestEvent.daysFromNow)}d ago`}
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      )}

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
