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
import { DebugJsonBlock } from "../../../../components/debug-json-block";
import { ErrorState } from "../../../../components/empty-state";
import { SectionCard } from "../../../../components/ui";
import { formatDateTime, formatScore } from "../../../../lib/format";
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

const SCORE_FACTORS: { key: keyof SignalDetail["signal"]; label: string }[] = [
  { key: "trendScore", label: "Trend" },
  { key: "momentumScore", label: "Momentum" },
  { key: "volumeScore", label: "Volumen" },
  { key: "volatilityScore", label: "Volatilität" },
  { key: "rsiScore", label: "RSI" },
  { key: "newsScore", label: "News" },
  { key: "socialScore", label: "Social" },
  { key: "eventScore", label: "Events" },
  { key: "riskScore", label: "Risiko" }
];

const OUTCOME_LABELS: Record<string, string> = {
  POSITIVE: "Positiv",
  NEGATIVE: "Negativ",
  NEUTRAL: "Neutral",
  TARGET_REACHED: "Ziel beobachtet",
  INVALIDATED: "Invalidiert"
};

const KIND_LABELS: Record<string, string> = {
  DIRECTIONAL_BULLISH: "Aufwärts-Beobachtung",
  DIRECTIONAL_BEARISH: "Abwärts-Beobachtung",
  RISK_WARNING: "Risikowarnung",
  OBSERVATION: "Beobachtung",
  SKIPPED: "Übersprungen"
};

const MOVE_DIRECTION_LABELS: Record<string, string> = {
  UP: "Aufwärts",
  DOWN: "Abwärts",
  ANY: "Beliebig",
  NONE: "Keine"
};

const EVAL_STATUS_LABELS: Record<string, string> = {
  OPEN: "Offen",
  EVALUATED: "Ausgewertet",
  EXPIRED: "Abgelaufen",
  SKIPPED: "Übersprungen"
};

function scoreBarColor(val: number | null | undefined): string {
  if (typeof val !== "number") return "var(--line)";
  if (val >= 7) return "var(--good)";
  if (val >= 4) return "var(--accent)";
  return "var(--bad)";
}

function sentimentLabel(s: string): string {
  const map: Record<string, string> = {
    POSITIVE: "Positiv",
    NEGATIVE: "Negativ",
    NEUTRAL: "Neutral",
    MIXED: "Gemischt",
    UNKNOWN: "Unbekannt"
  };
  return map[s] ?? s;
}

function sentimentColor(s: string): string | undefined {
  if (s === "POSITIVE") return "var(--good)";
  if (s === "NEGATIVE") return "var(--bad)";
  return undefined;
}

function eventRiskLabel(level: string): string {
  const map: Record<string, string> = {
    HIGH: "Hoch",
    MEDIUM: "Mittel",
    LOW: "Niedrig",
    NONE: "Keines"
  };
  return map[level] ?? level;
}

function eventRiskColor(level: string): string | undefined {
  if (level === "HIGH") return "var(--bad)";
  if (level === "MEDIUM") return "var(--warn)";
  return undefined;
}

function conflictLabel(level: string): string {
  const map: Record<string, string> = {
    NONE: "Kein Konflikt",
    LOW: "Niedrig",
    MEDIUM: "Mittel",
    HIGH: "Hoch"
  };
  return map[level] ?? level;
}

function conflictColor(level: string): string | undefined {
  if (level === "HIGH") return "var(--bad)";
  if (level === "MEDIUM") return "var(--warn)";
  return undefined;
}

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
    return (
      <ErrorState title="Signal konnte nicht geladen werden" message={signal.error} />
    );
  }
  const data = signal.data;
  if (!data) {
    return (
      <ErrorState
        title="Signal fehlt"
        message="Die API hat keine Signal-Daten zurückgegeben."
      />
    );
  }

  const s = data.signal;
  const out = data.signalOutput;
  const rule = ruleApplication.data;
  const paper = data.paperEvaluation;
  const isAdjusted = rule != null && Math.abs(rule.originalScore - rule.adjustedScore) > 0.05;

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
      {/* ── Breadcrumb ── */}
      <p className="page-header-breadcrumb" style={{ marginBottom: 12 }}>
        <Link href="/dashboard/signals">Signal Feed</Link>
        {" / "}
        <Link href={`/dashboard/assets/${encodeURIComponent(s.symbol)}`}>
          {s.symbol}
        </Link>
        {" / "}
        <span>{s.timeframe} · {s.signalType}</span>
      </p>

      {/* ── Signal-Akte Header ── */}
      <div className="card sig-header-card">
        <div className="sig-header-top">
          <div>
            <p className="sig-header-symbol">{s.symbol}</p>
            <p className="sig-header-meta">
              {data.asset.assetType}
              {data.asset.name ? ` · ${data.asset.name}` : ""}
              {" · "}{s.timeframe}
              {" · "}{s.signalType}
            </p>
            <p className="muted small" style={{ marginTop: 3 }}>
              {formatDateTime(s.createdAt)}
            </p>
          </div>
          <ScoreBadge
            value={rule ? rule.adjustedScore : s.score}
            originalValue={rule && isAdjusted ? rule.originalScore : undefined}
            label="Signalqualität"
          />
        </div>

        <div className="sig-header-badges">
          <StatusBadge value={s.status} />
          <DirectionBadge value={s.direction} />
          <RiskBadge value={s.riskLevel} />
        </div>

        <div className="sig-header-footer">
          <div className="signal-card-context">
            <ContextBadge type="news" level={newsLevel} />
            <ContextBadge type="events" level={eventLevel} />
            <ContextBadge type="regime" level={regimeLevel} />
            <ContextBadge type="rules" level={rulesLevel} />
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
      </div>

      {/* ── Kernaussage + Technische Faktoren ── */}
      <div className="detail-grid">

        {/* Kernaussage */}
        <SectionCard title="Kernaussage">
          {out?.shortConclusion ? (
            <p style={{ lineHeight: 1.65, margin: 0 }}>{out.shortConclusion}</p>
          ) : (
            <p className="muted small">Keine Kernaussage vorhanden.</p>
          )}

          {out?.counterArgument ? (
            <div style={{ marginTop: 16 }}>
              <p className="context-block-title">Gegenargument / Konflikt</p>
              <p className="signal-card-counter">{out.counterArgument}</p>
            </div>
          ) : null}

          {out?.nextTrigger ? (
            <div style={{ marginTop: 16 }}>
              <p className="context-block-title">Nächste Bestätigung</p>
              <p className="signal-card-trigger">{out.nextTrigger}</p>
            </div>
          ) : null}
        </SectionCard>

        {/* Technische Faktoren */}
        <SectionCard title="Technische Faktoren">
          <div className="score-breakdown">
            {SCORE_FACTORS.map(({ key, label }) => {
              const val = s[key];
              const numVal = typeof val === "number" ? val : null;
              const pct = numVal != null ? Math.min(100, (numVal / 10) * 100) : 0;
              return (
                <div key={String(key)} className="score-bar-row">
                  <span className="score-bar-label">{label}</span>
                  <div className="progress-track">
                    <div
                      className="score-bar-fill progress-fill"
                      style={{
                        width: `${pct}%`,
                        background: scoreBarColor(numVal)
                      }}
                    />
                  </div>
                  <span className="score-bar-value">{formatScore(numVal)}</span>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>

      {/* ── Score-Anpassungen (nur wenn vorhanden) ── */}
      {rule ? (
        <div style={{ marginTop: 16 }}>
          <SectionCard
            title={
              isAdjusted
                ? "Score-Anpassungen · Aktiv"
                : "Score-Anpassungen · Keine Änderung"
            }
          >
            <div className="health-rows">
              <div className="health-row">
                <span className="health-row-label">Original-Score</span>
                <span className="health-row-value">{formatScore(rule.originalScore)}</span>
              </div>
              <div className="health-row">
                <span className="health-row-label">Angepasster Score</span>
                <span
                  className="health-row-value"
                  style={{ color: isAdjusted ? "var(--accent)" : undefined }}
                >
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
                <span className="health-row-value" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <StatusBadge value={rule.originalStatus} />
                  <span className="muted">→</span>
                  <StatusBadge value={rule.adjustedStatus} />
                </span>
              </div>
            </div>
            {rule.summary ? (
              <p className="muted small" style={{ marginTop: 10 }}>{rule.summary}</p>
            ) : null}
            {rule.adjustments.length > 0 ? (
              <details style={{ marginTop: 12 }}>
                <summary>
                  Einzelne Anpassungen ({rule.adjustments.length})
                </summary>
                <div className="stack-list" style={{ marginTop: 8 }}>
                  {rule.adjustments.map((adj, i) => (
                    <div key={`${adj.category}-${i}`} className="list-row">
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
              </details>
            ) : (
              <p className="muted small" style={{ marginTop: 10 }}>
                Keine Anpassungen durch Regeln.
              </p>
            )}
          </SectionCard>
        </div>
      ) : null}

      {/* ── Kerzenchart ── */}
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

      {/* ── Kontext-Analyse ── */}
      <section style={{ marginTop: 16 }}>
        <div className="section-header" style={{ marginBottom: 12 }}>
          <h2 className="section-title">Kontext-Analyse</h2>
          <Link href="/dashboard/market-regime" className="section-link">
            Markt-Regime →
          </Link>
        </div>
        <div className="context-grid">

          {/* Markt-Regime */}
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
                  <span className="context-stat-label">Signal-Ausrichtung</span>
                  <span
                    className="context-stat-value"
                    style={{
                      color: marketRegimeContext.data.isAlignedWithRegime
                        ? "var(--good)"
                        : "var(--warn)"
                    }}
                  >
                    {marketRegimeContext.data.isAlignedWithRegime
                      ? "Bestätigt"
                      : "Nicht ausgerichtet"}
                  </span>
                </div>
                <div className="context-stat-row">
                  <span className="context-stat-label">Konflikt-Level</span>
                  <span
                    className="context-stat-value"
                    style={{ color: conflictColor(marketRegimeContext.data.conflictLevel) }}
                  >
                    {conflictLabel(marketRegimeContext.data.conflictLevel)}
                  </span>
                </div>
                {marketRegimeContext.data.summary ? (
                  <p className="muted small" style={{ marginTop: 8 }}>
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

          {/* News-Kontext */}
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
                  <span className="context-stat-label">Relevant</span>
                  <span className="context-stat-value">
                    {newsContext.data.relevantNewsCount}
                  </span>
                </div>
                <div className="context-stat-row">
                  <span className="context-stat-label">Sentiment</span>
                  <span
                    className="context-stat-value"
                    style={{ color: sentimentColor(newsContext.data.sentiment) }}
                  >
                    {sentimentLabel(newsContext.data.sentiment)}
                  </span>
                </div>
                {newsContext.data.summary ? (
                  <p className="muted small" style={{ marginTop: 8 }}>
                    {newsContext.data.summary}
                  </p>
                ) : null}
                {newsContext.data.riskNote ? (
                  <p className="muted small" style={{ color: "var(--warn)", marginTop: 4 }}>
                    {newsContext.data.riskNote}
                  </p>
                ) : null}
                {newsContext.data.topNews.length > 0 ? (
                  <details style={{ marginTop: 10 }}>
                    <summary>
                      Top-News ({newsContext.data.topNews.length})
                    </summary>
                    <div className="stack-list" style={{ marginTop: 8 }}>
                      {newsContext.data.topNews.map((item, i) => (
                        <div key={i} className="list-row" style={{ padding: "6px 10px" }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            {item.url ? (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: 13 }}
                              >
                                {item.headline}
                              </a>
                            ) : (
                              <span style={{ fontSize: 13 }}>{item.headline}</span>
                            )}
                            <span
                              className="muted small"
                              style={{ display: "block", marginTop: 2 }}
                            >
                              {item.source}
                              {" · "}
                              {sentimentLabel(item.sentiment)}
                            </span>
                          </div>
                          <span className="muted small nowrap">
                            {formatDateTime(item.publishedAt)}
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

          {/* Event-Kontext */}
          <div className="context-block">
            <h3 className="context-block-title">Event-Kontext</h3>
            {eventContext.data ? (
              <div className="context-stats">
                <div className="context-stat-row">
                  <span className="context-stat-label">Event-Risiko</span>
                  <span
                    className="context-stat-value"
                    style={{ color: eventRiskColor(eventContext.data.eventRiskLevel) }}
                  >
                    {eventRiskLabel(eventContext.data.eventRiskLevel)}
                  </span>
                </div>
                <div className="context-stat-row">
                  <span className="context-stat-label">Kommendes Event</span>
                  <span className="context-stat-value">
                    {eventContext.data.hasUpcomingEvent &&
                    eventContext.data.daysToNearestEvent != null
                      ? `in ${eventContext.data.daysToNearestEvent}d`
                      : "Keines"}
                  </span>
                </div>
                {eventContext.data.nearestEvent ? (
                  <div className="context-stat-row">
                    <span className="context-stat-label">Nächstes Event</span>
                    <span
                      className="context-stat-value small"
                      style={{ textAlign: "right", maxWidth: "60%" }}
                    >
                      {eventContext.data.nearestEvent.title}
                    </span>
                  </div>
                ) : null}
                {eventContext.data.summary ? (
                  <p className="muted small" style={{ marginTop: 8 }}>
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

      {/* ── Simulierte Auswertung (Paper) ── */}
      {paper ? (
        <div style={{ marginTop: 16 }}>
          <SectionCard title="Simulierte Auswertung">
            <div className="context-grid">

              <div className="context-block">
                <h3 className="context-block-title">Ergebnis</h3>
                <div className="context-stats">
                  <div className="context-stat-row">
                    <span className="context-stat-label">Ergebnis</span>
                    <span
                      className="context-stat-value"
                      style={{
                        color:
                          paper.outcome === "POSITIVE" || paper.outcome === "TARGET_REACHED"
                            ? "var(--good)"
                            : paper.outcome === "NEGATIVE"
                              ? "var(--bad)"
                              : undefined
                      }}
                    >
                      {paper.outcome
                        ? (OUTCOME_LABELS[paper.outcome] ?? paper.outcome)
                        : (EVAL_STATUS_LABELS[paper.evaluationStatus] ?? paper.evaluationStatus)}
                    </span>
                  </div>
                  <div className="context-stat-row">
                    <span className="context-stat-label">Bewertungstyp</span>
                    <span className="context-stat-value">
                      {KIND_LABELS[paper.evaluationKind] ?? paper.evaluationKind}
                    </span>
                  </div>
                  <div className="context-stat-row">
                    <span className="context-stat-label">Erwartete Richtung</span>
                    <span className="context-stat-value">
                      {MOVE_DIRECTION_LABELS[paper.expectedMoveDirection] ??
                        paper.expectedMoveDirection}
                    </span>
                  </div>
                  {paper.skipReason ? (
                    <div className="context-stat-row">
                      <span className="context-stat-label">Übersprungen wegen</span>
                      <span className="context-stat-value muted small">
                        {paper.skipReason}
                      </span>
                    </div>
                  ) : null}
                  <p className="muted small" style={{ marginTop: 6 }}>
                    Geöffnet: {formatDateTime(paper.openedAt)}
                    {paper.evaluatedAt
                      ? ` · Ausgewertet: ${formatDateTime(paper.evaluatedAt)}`
                      : ""}
                  </p>
                </div>
              </div>

              <div className="context-block">
                <h3 className="context-block-title">Preisreferenzen (simuliert)</h3>
                <div className="context-stats">
                  {(
                    [
                      { label: "Referenzpreis", val: paper.entryPrice },
                      { label: "Beobachtungszone", val: paper.targetPrice ?? "—" },
                      { label: "Invalidierungsmarke", val: paper.invalidationPrice ?? "—" }
                    ] as { label: string; val: string }[]
                  ).map(({ label, val }) => (
                    <div key={label} className="context-stat-row">
                      <span className="context-stat-label">{label}</span>
                      <span className="context-stat-value">{val}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="context-block">
                <h3 className="context-block-title">Kursveränderung (simuliert)</h3>
                <div className="context-stats">
                  {(
                    [
                      { label: "Nach 1h", val: paper.returnAfter1h },
                      { label: "Nach 4h", val: paper.returnAfter4h },
                      { label: "Nach 1d", val: paper.returnAfter1d },
                      { label: "Nach 3d", val: paper.returnAfter3d }
                    ] as { label: string; val: number | null }[]
                  ).map(({ label, val }) => (
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
                        {typeof val === "number"
                          ? `${val > 0 ? "+" : ""}${val.toFixed(2)}%`
                          : "—"}
                      </span>
                    </div>
                  ))}
                  {paper.maxFavorableMove != null ? (
                    <div className="context-stat-row">
                      <span className="context-stat-label">Max. positiv</span>
                      <span className="context-stat-value" style={{ color: "var(--good)" }}>
                        +{paper.maxFavorableMove.toFixed(2)}%
                      </span>
                    </div>
                  ) : null}
                  {paper.maxAdverseMove != null ? (
                    <div className="context-stat-row">
                      <span className="context-stat-label">Max. negativ</span>
                      <span className="context-stat-value" style={{ color: "var(--bad)" }}>
                        {paper.maxAdverseMove.toFixed(2)}%
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </SectionCard>
        </div>
      ) : null}

      {/* ── Rohdaten (Debug) ── */}
      <div style={{ marginTop: 16 }}>
        <SectionCard title="Rohdaten (Debug)">
          <div style={{ display: "grid", gap: 6 }}>
            <DebugJsonBlock label="Technical JSON" data={out?.technicalJson} />
            <DebugJsonBlock label="Intelligence JSON" data={out?.intelligenceJson} />
            <DebugJsonBlock
              label="Market Confirmation JSON"
              data={out?.marketConfirmationJson}
            />
            <DebugJsonBlock label="Dashboard JSON" data={out?.dashboardJson} />
            {out?.telegramText ? (
              <details>
                <summary>Alert-Text</summary>
                <pre className="telegram-text">{out.telegramText}</pre>
              </details>
            ) : null}
            {data.candles.length > 0 ? (
              <details>
                <summary>Letzte {data.candles.length} Kerzen</summary>
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
            ) : null}
          </div>
        </SectionCard>
      </div>
    </>
  );
}
