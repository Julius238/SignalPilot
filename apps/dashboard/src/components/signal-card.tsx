import Link from "next/link";

import { ContextBadge, DirectionBadge, RiskBadge, ScoreBadge, StatusBadge } from "./badges";
import { formatDateTime } from "../lib/format";
import {
  assetTypeLabel,
  germanizeAnalysisText,
  signalTypeLabel,
  timeframeLabel
} from "../lib/labels";
import { NEWS_HIGH_RELEVANCE } from "../lib/score-scale";
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
  // relevanceScore ist 0–100 (packages/news-intelligence). Die frühere Schwelle 7 stammte
  // von einer 0–10-Annahme und stufte praktisch jede Meldung als "hoch" ein.
  if (
    (newsContext.relevanceScore ?? 0) >= NEWS_HIGH_RELEVANCE ||
    (newsContext.relevantNewsCount ?? 0) >= 3
  ) {
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
            {assetTypeLabel(signal.asset.assetType)} · {timeframeLabel(signal.timeframe)} ·{" "}
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
      {counter ? (
        <p className="signal-card-counter">
          Was dagegen spricht: {germanizeAnalysisText(counter)}
        </p>
      ) : null}
      {trigger ? (
        <p className="signal-card-trigger">
          Worauf zu achten ist: {germanizeAnalysisText(trigger)}
        </p>
      ) : null}

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
