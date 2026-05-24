import Link from "next/link";

import { CandlestickChart } from "../../../../components/CandlestickChart";
import {
  ContextBadge,
  DirectionBadge,
  RegimeBadge,
  RiskBadge,
  RiskModeBadge,
  ScoreBadge,
  StatusBadge
} from "../../../../components/badges";
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
  { key: "trendScore" as const, label: "Trend" },
  { key: "momentumScore" as const, label: "Momentum" },
  { key: "volumeScore" as const, label: "Volumen" },
  { key: "volatilityScore" as const, label: "Volatilität" },
  { key: "rsiScore" as const, label: "RSI" },
  { key: "newsScore" as const, label: "News" },
  { key: "socialScore" as const, label: "Social" },
  { key: "eventScore" as const, label: "Events" },
  { key: "riskScore" as const, label: "Risiko" }
];

export default async function SignalDetailPage({ params }: SignalDetailPageProps) {
  const { id } = await params;
  const [signal, newsContext, eventContext, marketRegimeContext, ruleApplication] =
    await Promise.all([
      fetchApi<SignalDetail>(`/signals/${encodeURIComponent(id)}`),
      fetchApi<NewsContext>(`/signals/${encodeURIComponent(id)}/news-context`),
      fetchApi<EventContext>(`/signals/${encodeURIComponent(id)}/event-context`),
      fetchApi<SignalRegimeContext | null>(
        `/signals/${encodeURIComponent(id)}/market-regime-context`
      ),
      fetchApi<SignalRuleApplication>(
        `/signals/${encodeURIComponent(id)}/rule-application`
      )
    ]);

  if (signal.error) {
    return <ErrorState title="Signal konnte nicht geladen werden" message={signal.error} />;
  }

  const data = signal.data;
  if (!data) {
    return (
      <ErrorState title="Signal fehlt" message="Die API hat keine Signal-Daten zurückgegeben." />
    );
  }

  const s = data.signal;
  const out = data.signalOutput;
  const rule = ruleApplication.data;
  const isAdjusted = rule && Math.abs(rule.originalScore - rule.adjustedScore) > 0.05;

  const newsLevel =
    !newsContext.data?.hasRecentNews
      ? "none"
      : (newsContext.data.relevanceScore ?? 0) >= 7
        ? "high"
        : "relevant";
  const eventLevel =
    !eventContext.data?.hasUpcomingEvent
      ? "none"
      : eventContext.data.eventRiskLevel === "HIGH"
        ? "high"
        : "upcoming";
  const regimeLevel =
    !marketRegimeContext.data
      ? "neutral"
      : marketRegimeContext.data.conflictLevel === "HIGH" ||
          marketRegimeContext.data.conflictLevel === "MEDIUM"
        ? "conflict"
        : marketRegimeContext.data.isAlignedWithRegime
          ? "aligned"
          : "neutral";
  const rulesLevel = isAdjusted ? "adjusted" : "none";

  return (
    <>
      {/* ── Breadcrumb & Header ── */}
      <div className="page-header">
        <div>
          <p className="page-header-breadcrumb">
            <Link href={`/dashboard/assets/${encodeURIComponent(s.symbol)}`}>
              {s.symbol}
            </Link>
            {" / "}
            <Link href="/dashboard/signals">Signals</Link>
            {" / "}
            {s.timeframe} · {s.signalType}
          </p>
          <h1>
            {s.symbol} · {s.timeframe}
          </h1>
          <p className="muted small">{s.signalType} · {formatDateTime(s.createdAt)}</p>
        </div>
        <div className="page-actions">
          <Link
            className="primary-link secondary-link"
            href={`/dashboard/assets/${encodeURIComponent(s.symbol)}`}
          >
            Asset-Profil
          </Link>
          <Link className="primary-link secondary-link" href="/dashboard/scanner">
            Scanner
          </Link>
        </div>
      </div>

      {/* ── Status row ── */}
      <section className="grid metrics" style={{ marginBottom: 20 }}>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="metric-label">Status</span>
          <span className="metric-value">
            <StatusBadge value={s.status} />
          </span>
        </div>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="metric-label">Richtung</span>
          <span className="metric-value">
            <DirectionBadge value={s.direction} />
          </span>
        </div>
        <div className="card">
          <span className="metric-label">Signalqualität</span>
          <ScoreBadge
            value={rule ? rule.adjustedScore : s.score}
            originalValue={rule && isAdjusted ? rule.originalScore : undefined}
          />
        </div>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="metric-label">Risiko</span>
          <span className="metric-value">
            <RiskBadge value={s.riskLevel} />
          </span>
        </div>
        <div className="card">
          <span className="metric-label">Kontext</span>
          <div className="signal-card-badges" style={{ marginTop: 8 }}>
            <ContextBadge type="news" level={newsLevel} />
            <ContextBadge type="events" level={eventLevel} />
            <ContextBadge type="regime" level={regimeLevel} />
            <ContextBadge type="rules" level={rulesLevel} />
          </div>
        </div>
      </section>

      {/* ── Main conclusion ── */}
      <div className="grid two">
        <div className="card">
          <div className="section-header">
            <h2 className="section-title">Schlussfolgerung</h2>
          </div>
          {out?.shortConclusion ? (
            <p style={{ lineHeight: 1.6, marginTop: 0, marginBottom: 12 }}>{out.shortConclusion}</p>
          ) : (
            <p className="muted small">Keine Schlussfolgerung vorhanden.</p>
          )}

          {out?.counterArgument ? (
            <>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--warn)", margin: "0 0 6px" }}>
                Gegenargument
              </h3>
              <p className="signal-card-counter">{out.counterArgument}</p>
            </>
          ) : null}

          {out?.nextTrigger ? (
            <>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", margin: "12px 0 4px" }}>
                Nächster Auslöser / Beobachtung
              </h3>
              <p className="signal-card-trigger">{out.nextTrigger}</p>
            </>
          ) : null}
        </div>

        {/* Score adjustments */}
        <div className="card">
          <div className="section-header">
            <h2 className="section-title">Score-Anpassungen</h2>
          </div>
          {rule ? (
            <div className="score-breakdown">
              <div className="health-row">
                <span className="health-row-label">Original-Score</span>
                <span className="health-row-value">{formatScore(rule.originalScore)}</span>
              </div>
              <div className="health-row">
                <span className="health-row-label">Angepasster Score</span>
                <span className="health-row-value" style={{ color: isAdjusted ? "var(--accent)" : undefined }}>
                  {formatScore(rule.adjustedScore)}
                  {isAdjusted ? (
                    <span className="muted small" style={{ marginLeft: 6 }}>
                      ({rule.adjustedScore > rule.originalScore ? "+" : ""}
                      {(rule.adjustedScore - rule.originalScore).toFixed(1)})
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="health-row">
                <span className="health-row-label">Status-Änderung</span>
                <span className="health-row-value muted small">
                  {rule.originalStatus} → {rule.adjustedStatus}
                </span>
              </div>
              {rule.summary ? (
                <p className="muted small" style={{ marginTop: 8 }}>
                  {rule.summary}
                </p>
              ) : null}
              {rule.adjustments.length > 0 ? (
                <div style={{ marginTop: 8 }}>
                  <h3 className="context-block-title">Einzelne Anpassungen</h3>
                  <div className="stack-list">
                    {rule.adjustments.map((adj) => (
                      <div
                        key={`${adj.category}-${adj.reason}`}
                        className="list-row"
                        style={{ padding: "8px 10px" }}
                      >
                        <div>
                          <strong style={{ fontSize: 13 }}>{adj.reason}</strong>
                          <span className="muted small" style={{ display: "block" }}>
                            {adj.category}
                            {adj.explanation ? ` · ${adj.explanation}` : ""}
                          </span>
                        </div>
                        <span
                          className="health-row-value"
                          style={{
                            color:
                              adj.scoreDelta > 0
                                ? "var(--good)"
                                : adj.scoreDelta < 0
                                  ? "var(--bad)"
                                  : undefined
                          }}
                        >
                          {adj.scoreDelta > 0 ? "+" : ""}
                          {adj.scoreDelta.toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="muted small" style={{ marginTop: 8 }}>
                  Keine Rule-Anpassungen.
                </p>
              )}
            </div>
          ) : (
            <p className="muted small">Keine Rule-Application gefunden.</p>
          )}
        </div>
      </div>

      {/* ── Chart ── */}
      <CandlestickChart
        candles={data.candles.map((c) => ({
          time: c.openTime,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume
        }))}
        signalMarker={{
          time: data.candles.at(-1)?.openTime ?? s.createdAt,
          direction: s.direction,
          status: s.status,
          label: s.signalType
        }}
        title={`Kerzen · ${s.symbol} · ${s.timeframe}`}
      />

      {/* ── Score breakdown ── */}
      <section className="card" style={{ marginTop: 16 }}>
        <div className="section-header">
          <h2 className="section-title">Score-Aufschlüsselung</h2>
        </div>
        <div className="score-breakdown">
          {scoreKeys.map(({ key, label }) => {
            const val = s[key];
            const pct = typeof val === "number" ? Math.min(100, (val / 10) * 100) : 0;
            return (
              <div key={key} className="score-bar-row">
                <span className="score-bar-label">{label}</span>
                <div className="progress-track">
                  <div className="score-bar-fill progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="score-bar-value">{formatScore(val)}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Context sections ── */}
      <section style={{ marginTop: 16 }}>
        <div className="section-header">
          <h2 className="section-title">Kontext-Analyse</h2>
        </div>
        <div className="context-grid">

          {/* Market Regime */}
          <div className="context-block">
            <h3 className="context-block-title">Markt-Regime</h3>
            {marketRegimeContext.data ? (
              <div className="context-stats">
                <div className="context-stat-row">
                  <span className="context-stat-label">Gesamt-Regime</span>
                  <RegimeBadge value={marketRegimeContext.data.overallRegime} />
                </div>
                <div className="context-stat-row">
                  <span className="context-stat-label">Risiko-Modus</span>
                  <RiskModeBadge value={marketRegimeContext.data.riskMode} />
                </div>
                <div className="context-stat-row">
                  <span className="context-stat-label">Ausrichtung</span>
                  <span
                    className="context-stat-value"
                    style={{ color: marketRegimeContext.data.isAlignedWithRegime ? "var(--good)" : "var(--warn)" }}
                  >
                    {marketRegimeContext.data.isAlignedWithRegime ? "Bestätigt" : "Nicht ausgerichtet"}
                  </span>
                </div>
                <div className="context-stat-row">
                  <span className="context-stat-label">Konflikt-Level</span>
                  <span
                    className="context-stat-value"
                    style={{
                      color:
                        marketRegimeContext.data.conflictLevel === "HIGH"
                          ? "var(--bad)"
                          : marketRegimeContext.data.conflictLevel === "MEDIUM"
                            ? "var(--warn)"
                            : undefined
                    }}
                  >
                    {marketRegimeContext.data.conflictLevel}
                  </span>
                </div>
                {marketRegimeContext.data.summary ? (
                  <p className="muted small" style={{ marginTop: 6 }}>
                    {marketRegimeContext.data.summary}
                  </p>
                ) : null}
                {marketRegimeContext.data.riskNote ? (
                  <p className="muted small" style={{ color: "var(--warn)", marginTop: 4 }}>
                    {marketRegimeContext.data.riskNote}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="muted small">Noch nicht berechnet.</p>
            )}
          </div>

          {/* News Context */}
          <div className="context-block">
            <h3 className="context-block-title">News-Kontext</h3>
            {newsContext.data ? (
              <div className="context-stats">
                <div className="context-stat-row">
                  <span className="context-stat-label">Aktuelle News</span>
                  <span className="context-stat-value">
                    {newsContext.data.hasRecentNews
                      ? `${newsContext.data.recentNewsCount} gefunden`
                      : "Keine"}
                  </span>
                </div>
                <div className="context-stat-row">
                  <span className="context-stat-label">Relevanz</span>
                  <span className="context-stat-value">
                    {newsContext.data.relevantNewsCount} relevant
                  </span>
                </div>
                <div className="context-stat-row">
                  <span className="context-stat-label">Sentiment</span>
                  <span
                    className="context-stat-value"
                    style={{
                      color:
                        newsContext.data.sentiment === "POSITIVE"
                          ? "var(--good)"
                          : newsContext.data.sentiment === "NEGATIVE"
                            ? "var(--bad)"
                            : undefined
                    }}
                  >
                    {newsContext.data.sentiment}
                  </span>
                </div>
                {newsContext.data.summary ? (
                  <p className="muted small" style={{ marginTop: 6 }}>
                    {newsContext.data.summary}
                  </p>
                ) : null}
                {newsContext.data.topNews.length > 0 ? (
                  <details style={{ marginTop: 8 }}>
                    <summary>Top-News anzeigen ({newsContext.data.topNews.length})</summary>
                    <div className="stack-list">
                      {newsContext.data.topNews.map((item, i) => (
                        <div key={i} className="list-row" style={{ padding: "6px 10px" }}>
                          <div>
                            {item.url ? (
                              <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>
                                {item.headline}
                              </a>
                            ) : (
                              <span style={{ fontSize: 13 }}>{item.headline}</span>
                            )}
                          </div>
                          <span className="muted small nowrap">
                            {item.source} · {item.sentiment}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            ) : (
              <p className="muted small">Keine News-Daten verfügbar.</p>
            )}
          </div>

          {/* Event Context */}
          <div className="context-block">
            <h3 className="context-block-title">Event-Kontext</h3>
            {eventContext.data ? (
              <div className="context-stats">
                <div className="context-stat-row">
                  <span className="context-stat-label">Event-Risiko</span>
                  <span
                    className="context-stat-value"
                    style={{
                      color:
                        eventContext.data.eventRiskLevel === "HIGH"
                          ? "var(--bad)"
                          : eventContext.data.eventRiskLevel === "MEDIUM"
                            ? "var(--warn)"
                            : undefined
                    }}
                  >
                    {eventContext.data.eventRiskLevel}
                  </span>
                </div>
                <div className="context-stat-row">
                  <span className="context-stat-label">Kommendes Event</span>
                  <span className="context-stat-value">
                    {eventContext.data.hasUpcomingEvent
                      ? `in ${eventContext.data.daysToNearestEvent}d`
                      : "Keines"}
                  </span>
                </div>
                {eventContext.data.nearestEvent ? (
                  <div className="context-stat-row">
                    <span className="context-stat-label">Nächstes Event</span>
                    <span className="context-stat-value small">
                      {eventContext.data.nearestEvent.title}
                    </span>
                  </div>
                ) : null}
                {eventContext.data.summary ? (
                  <p className="muted small" style={{ marginTop: 6 }}>
                    {eventContext.data.summary}
                  </p>
                ) : null}
                {eventContext.data.riskNote ? (
                  <p className="muted small" style={{ color: "var(--warn)", marginTop: 4 }}>
                    {eventContext.data.riskNote}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="muted small">Keine Event-Daten verfügbar.</p>
            )}
          </div>
        </div>
      </section>

      {/* ── Paper Evaluation ── */}
      {data.paperEvaluation ? (
        <section className="card" style={{ marginTop: 16 }}>
          <div className="section-header">
            <h2 className="section-title">Hypothetische Auswertung (Paper)</h2>
          </div>
          <div className="context-grid">
            <div className="context-block">
              <h3 className="context-block-title">Ergebnis</h3>
              <div className="context-stats">
                <div className="context-stat-row">
                  <span className="context-stat-label">Outcome</span>
                  <span
                    className="context-stat-value"
                    style={{
                      color:
                        data.paperEvaluation.outcome === "POSITIVE" ||
                        data.paperEvaluation.outcome === "TARGET_REACHED"
                          ? "var(--good)"
                          : data.paperEvaluation.outcome === "NEGATIVE"
                            ? "var(--bad)"
                            : undefined
                    }}
                  >
                    {data.paperEvaluation.outcome ?? data.paperEvaluation.evaluationStatus}
                  </span>
                </div>
                <div className="context-stat-row">
                  <span className="context-stat-label">Art</span>
                  <span className="context-stat-value">{data.paperEvaluation.evaluationKind}</span>
                </div>
                <div className="context-stat-row">
                  <span className="context-stat-label">Erwartete Bewegung</span>
                  <span className="context-stat-value">
                    {data.paperEvaluation.expectedMoveDirection}
                  </span>
                </div>
                {data.paperEvaluation.skipReason ? (
                  <div className="context-stat-row">
                    <span className="context-stat-label">Übersprungen wegen</span>
                    <span className="context-stat-value muted small">
                      {data.paperEvaluation.skipReason}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="context-block">
              <h3 className="context-block-title">Preise (hypothetisch)</h3>
              <div className="context-stats">
                {[
                  { label: "Einstieg (hypothetisch)", val: data.paperEvaluation.entryPrice },
                  { label: "Zielzone", val: data.paperEvaluation.targetPrice ?? "—" },
                  { label: "Invalidierung", val: data.paperEvaluation.invalidationPrice ?? "—" }
                ].map(({ label, val }) => (
                  <div key={label} className="context-stat-row">
                    <span className="context-stat-label">{label}</span>
                    <span className="context-stat-value">{val}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="context-block">
              <h3 className="context-block-title">Rendite nach Zeit (hypothetisch)</h3>
              <div className="context-stats">
                {[
                  { label: "Nach 1h", val: data.paperEvaluation.returnAfter1h },
                  { label: "Nach 4h", val: data.paperEvaluation.returnAfter4h },
                  { label: "Nach 1d", val: data.paperEvaluation.returnAfter1d },
                  { label: "Nach 3d", val: data.paperEvaluation.returnAfter3d }
                ].map(({ label, val }) => (
                  <div key={label} className="context-stat-row">
                    <span className="context-stat-label">{label}</span>
                    <span
                      className="context-stat-value"
                      style={{
                        color:
                          typeof val === "number"
                            ? val > 0
                              ? "var(--good)"
                              : val < 0
                                ? "var(--bad)"
                                : undefined
                            : undefined
                      }}
                    >
                      {typeof val === "number" ? `${val.toFixed(2)}%` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            Eröffnet: {formatDateTime(data.paperEvaluation.openedAt)}
            {data.paperEvaluation.evaluatedAt
              ? ` · Ausgewertet: ${formatDateTime(data.paperEvaluation.evaluatedAt)}`
              : ""}
          </p>
        </section>
      ) : null}

      {/* ── Structured output (collapsible) ── */}
      <section className="card" style={{ marginTop: 16 }}>
        <div className="section-header">
          <h2 className="section-title">Strukturierte Signal-Ausgabe</h2>
        </div>
        <details>
          <summary>Technical JSON anzeigen</summary>
          <pre>{formatJson(out?.technicalJson)}</pre>
        </details>
        <details style={{ marginTop: 8 }}>
          <summary>Intelligence JSON anzeigen</summary>
          <pre>{formatJson(out?.intelligenceJson)}</pre>
        </details>
        <details style={{ marginTop: 8 }}>
          <summary>Market Confirmation JSON anzeigen</summary>
          <pre>{formatJson(out?.marketConfirmationJson)}</pre>
        </details>
        {out?.telegramText ? (
          <details style={{ marginTop: 8 }}>
            <summary>Alert-Text anzeigen</summary>
            <pre className="telegram-text">{out.telegramText}</pre>
          </details>
        ) : null}
      </section>

      {/* ── Candle table (collapsible) ── */}
      <section className="card" style={{ marginTop: 16 }}>
        <details>
          <summary>Letzte {data.candles.length} Kerzen anzeigen</summary>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>Zeit (Open)</th>
                  <th>Open</th>
                  <th>High</th>
                  <th>Low</th>
                  <th>Close</th>
                  <th>Volumen</th>
                </tr>
              </thead>
              <tbody>
                {data.candles.map((c) => (
                  <tr key={c.id}>
                    <td>{formatDateTime(c.openTime)}</td>
                    <td>{c.open}</td>
                    <td>{c.high}</td>
                    <td>{c.low}</td>
                    <td>{c.close}</td>
                    <td>{c.volume}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </>
  );
}
