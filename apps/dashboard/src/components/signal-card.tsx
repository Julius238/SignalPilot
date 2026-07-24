import Link from "next/link";

import { ContextBadge, DirectionBadge, RiskBadge, ScoreBadge, StatusBadge } from "./badges";
import { formatDateTime } from "../lib/format";
import type { SignalListItem } from "../lib/signalpilot-api";

function extractDashboardField<T>(
  dashboardJson: unknown,
  key: string
): T | null {
  if (!dashboardJson || typeof dashboardJson !== "object" || !(key in dashboardJson)) {
    return null;
  }
  return (dashboardJson as Record<string, unknown>)[key] as T;
}

function deriveNewsLevel(dashboardJson: unknown): "none" | "relevant" | "high" {
  const newsContext = extractDashboardField<{
    hasRecentNews?: boolean;
    relevantNewsCount?: number;
    relevanceScore?: number;
  }>(dashboardJson, "newsContext");
  if (!newsContext?.hasRecentNews) return "none";
  if ((newsContext.relevanceScore ?? 0) >= 7 || (newsContext.relevantNewsCount ?? 0) >= 3) {
    return "high";
  }
  return "relevant";
}

function deriveEventLevel(dashboardJson: unknown): "none" | "upcoming" | "high" {
  const eventContext = extractDashboardField<{
    hasUpcomingEvent?: boolean;
    eventRiskLevel?: string;
  }>(dashboardJson, "eventContext");
  if (!eventContext?.hasUpcomingEvent) return "none";
  if (eventContext.eventRiskLevel === "HIGH") return "high";
  return "upcoming";
}

function deriveRegimeLevel(dashboardJson: unknown): "aligned" | "conflict" | "neutral" {
  const regimeContext = extractDashboardField<{
    isAlignedWithRegime?: boolean;
    conflictLevel?: string;
  }>(dashboardJson, "marketRegimeContext");
  if (!regimeContext) return "neutral";
  if (regimeContext.conflictLevel === "HIGH" || regimeContext.conflictLevel === "MEDIUM") {
    return "conflict";
  }
  if (regimeContext.isAlignedWithRegime) return "aligned";
  return "neutral";
}

function deriveRulesLevel(dashboardJson: unknown): "adjusted" | "none" {
  const originalScore = extractDashboardField<number>(dashboardJson, "originalScore");
  if (typeof originalScore === "number") return "adjusted";
  return "none";
}

function assetTypeLabel(value: string) {
  const labels: Record<string, string> = {
    CRYPTO: "Krypto",
    STOCK: "Aktie",
    EQUITY: "Aktie",
    ETF: "ETF",
    INDEX: "Index"
  };
  return labels[value] ?? value;
}

function signalTypeLabel(value: string) {
  const labels: Record<string, string> = {
    MOMENTUM_ALERT: "Momentum",
    TREND_ALERT: "Trend",
    VOLUME_SPIKE: "Ungewöhnliches Volumen",
    VOLATILITY_SPIKE: "Erhöhte Schwankung",
    BREAKOUT_ALERT: "Markante Kurszone",
    NEWS_REACTION: "Nachrichtenreaktion",
    EVENT_IMPACT: "Ereigniseffekt",
    NO_SIGNAL: "Keine besondere Auffälligkeit"
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

export function SignalCard({ signal }: { signal: SignalListItem }) {
  const dashboardJson = signal.signalOutput?.dashboardJson;
  const originalScore = extractDashboardField<number>(dashboardJson, "originalScore");
  const newsLevel = deriveNewsLevel(dashboardJson);
  const eventLevel = deriveEventLevel(dashboardJson);
  const regimeLevel = deriveRegimeLevel(dashboardJson);
  const rulesLevel = deriveRulesLevel(dashboardJson);

  const conclusion = signal.signalOutput?.shortConclusion;
  const counter = signal.signalOutput?.counterArgument;
  const trigger = signal.signalOutput?.nextTrigger;

  return (
    <article className="signal-card">
      <div className="signal-card-header">
        <div className="signal-card-symbol-block">
          <Link href={`/dashboard/signals/${signal.id}`} className="signal-card-symbol">
            {signal.symbol}
          </Link>
          <span className="signal-card-meta">
            {assetTypeLabel(signal.asset.assetType)} · {signal.timeframe} ·{" "}
            {signalTypeLabel(signal.signalType)}
          </span>
          <span className="signal-card-meta">{formatDateTime(signal.createdAt)}</span>
        </div>
        <ScoreBadge
          value={signal.score}
          originalValue={originalScore}
          label="Signalqualität"
        />
      </div>

      <div className="signal-card-badges">
        <StatusBadge value={signal.status} />
        <DirectionBadge value={signal.direction} />
        <RiskBadge value={signal.riskLevel} />
      </div>

      {conclusion ? <p className="signal-card-conclusion">{conclusion}</p> : null}
      {counter ? <p className="signal-card-counter">Gegenargument: {counter}</p> : null}
      {trigger ? <p className="signal-card-trigger">Nächster Auslöser: {trigger}</p> : null}

      <div className="signal-card-footer">
        <div className="signal-card-context">
          <ContextBadge type="news" level={newsLevel} />
          <ContextBadge type="events" level={eventLevel} />
          <ContextBadge type="regime" level={regimeLevel} />
          <ContextBadge type="rules" level={rulesLevel} />
        </div>
        <Link href={`/dashboard/signals/${signal.id}`} className="signal-card-link">
          Detail →
        </Link>
      </div>
    </article>
  );
}
